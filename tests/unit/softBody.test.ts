import { describe, expect, test } from 'vitest';
import { buildIcosphere } from '../../src/sim/icosphere.ts';
import { SoftBody, SUBSTEP } from '../../src/sim/softBody.ts';
import { DEFAULT_BEHAVIOR, type SlimeBehavior } from '../../src/sim/params.ts';

const run = (b: SoftBody, seconds: number) => {
  const steps = Math.round(seconds / SUBSTEP);
  for (let i = 0; i < steps; i++) b.step(SUBSTEP);
};

const makeBody = (behavior: Partial<SlimeBehavior> = {}) => {
  const b = new SoftBody({ behavior: { ...DEFAULT_BEHAVIOR, ...behavior } });
  b.idle = 0;
  return b;
};

const topIndex = (b: SoftBody) => b.nearestParticle({ x: 0, y: 5, z: 0 });
const bottomIndex = (b: SoftBody) => b.nearestParticle({ x: 0, y: -5, z: 0 });

/** Grab the top of the blob and pull it straight up by `lift` over `time`. */
function pullUp(b: SoftBody, lift: number, time = 0.8, hold = 0.6) {
  const top = b.particle(topIndex(b));
  expect(b.beginGrab(top)).toBe(true);
  const steps = Math.round(time / SUBSTEP);
  for (let i = 1; i <= steps; i++) {
    b.moveGrab({ x: top.x, y: top.y + (lift * i) / steps, z: top.z });
    b.step(SUBSTEP);
  }
  run(b, hold);
  return top;
}

describe('surface topology', () => {
  test('icosphere is a closed 2-manifold (every edge shared by two faces)', () => {
    const topo = buildIcosphere(4);
    const counts = new Map<string, number>();
    for (let t = 0; t < topo.triangles.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = topo.triangles[t + k], c = topo.triangles[t + ((k + 1) % 3)];
        const key = a < c ? `${a}_${c}` : `${c}_${a}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    expect([...counts.values()].every((n) => n === 2)).toBe(true);
    const V = topo.positions.length / 3, E = topo.edges.length / 2, F = topo.triangles.length / 3;
    expect(V - E + F).toBe(2);
  });

  test('resting blob encloses a positive volume close to a unit sphere', () => {
    const b = makeBody();
    expect(b.restVolume).toBeGreaterThan(3.6);
    expect(b.restVolume).toBeLessThan(4.6);
  });
});

describe('resting state', () => {
  test('stays put when nobody touches it', () => {
    const b = makeBody();
    run(b, 4);
    const m = b.metrics();
    expect(m.healthy).toBe(true);
    expect(m.maxDeviation).toBeLessThan(0.02);
  });

  test('idle motion is present but nearly imperceptible', () => {
    const b = makeBody();
    b.idle = 1;
    run(b, 3);
    const m = b.metrics();
    expect(m.maxDeviation).toBeGreaterThan(0.001);
    expect(m.maxDeviation).toBeLessThan(0.06);
  });
});

describe('grab and stretch', () => {
  test('pulling the top elongates the blob locally rather than translating it', () => {
    const b = makeBody();
    const restHeight = b.metrics().max.y - b.metrics().min.y;
    const bottomBefore = b.particle(bottomIndex(b));
    const top = pullUp(b, 1.2);
    const m = b.metrics();
    const topNow = b.particle(topIndex(b));
    const bottomNow = b.particle(bottomIndex(b));

    expect(m.max.y - m.min.y).toBeGreaterThan(restHeight * 1.35); // visibly stretched
    expect(m.max.y - top.y).toBeGreaterThan(0.6); // the grabbed region followed
    const bottomMove = Math.abs(bottomNow.y - bottomBefore.y);
    expect(bottomMove).toBeLessThan((m.max.y - top.y) * 0.35); // far side mostly stays
    expect(topNow.y).toBeGreaterThan(top.y);
  });

  test('volume is preserved while stretched', () => {
    const b = makeBody();
    pullUp(b, 1.2);
    const m = b.metrics();
    expect(m.volume / m.restVolume).toBeGreaterThan(0.85);
    expect(m.volume / m.restVolume).toBeLessThan(1.15);
  });

  test('release recovers gradually, not instantly', () => {
    const b = makeBody();
    pullUp(b, 1.2);
    const stretched = b.metrics().maxDeviation;
    b.endGrab();
    run(b, 1 / 30);
    expect(b.metrics().maxDeviation).toBeGreaterThan(stretched * 0.75); // no snap
    run(b, 6);
    expect(b.metrics().maxDeviation).toBeLessThan(0.08); // but it does come home
  });

  test('extreme pulls are softly limited and never tear the body', () => {
    const b = makeBody({ stretchiness: 1, softness: 1 });
    pullUp(b, 30, 0.5, 1);
    const m = b.metrics();
    expect(m.healthy).toBe(true);
    expect(m.max.y).toBeLessThan(4.5);
    expect(b.recoveries).toBe(0);
  });
});

describe('poke and squish', () => {
  test('pressing in dents the surface and bulges the rest', () => {
    const b = makeBody();
    const restWidth = b.metrics().max.x - b.metrics().min.x;
    const top = b.particle(topIndex(b));
    b.beginGrab(top);
    b.moveGrab({ x: top.x, y: top.y - 0.4, z: top.z });
    run(b, 0.8);
    const m = b.metrics();
    expect(b.particle(topIndex(b)).y).toBeLessThan(top.y - 0.25);
    expect(m.max.x - m.min.x).toBeGreaterThan(restWidth * 1.01);
    expect(m.volume / m.restVolume).toBeGreaterThan(0.85);
  });

  test('a poke impulse makes a dent that springs back', () => {
    const b = makeBody();
    const top = b.particle(topIndex(b));
    b.impulse(top, { x: 0, y: -1, z: 0 }, 6);
    run(b, 0.12);
    expect(b.particle(topIndex(b)).y).toBeLessThan(top.y - 0.05);
    run(b, 5);
    expect(Math.abs(b.particle(topIndex(b)).y - top.y)).toBeLessThan(0.03);
  });
});

describe('stability', () => {
  test('hundreds of repeated grabs do not corrupt the simulation', () => {
    const b = makeBody();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let g = 0; g < 120; g++) {
      const dir = { x: rnd(), y: rnd(), z: rnd() };
      const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
      const start = b.particle(b.nearestParticle({ x: dir.x / len * 3, y: dir.y / len * 3, z: dir.z / len * 3 }));
      b.beginGrab(start);
      for (let i = 0; i < 12; i++) {
        b.moveGrab({ x: start.x + rnd() * 1.5, y: start.y + rnd() * 1.5, z: start.z + rnd() * 1.5 });
        b.step(SUBSTEP * 2);
      }
      b.endGrab();
      b.step(SUBSTEP);
    }
    const m = b.metrics();
    expect(m.healthy).toBe(true);
    expect(b.recoveries).toBe(0);
    run(b, 8);
    expect(b.metrics().maxDeviation).toBeLessThan(0.15);
  });

  test.each([
    ['all minimum', { stretchiness: 0, viscosity: 0, softness: 0, wobble: 0, recovery: 0 }],
    ['all maximum', { stretchiness: 1, viscosity: 1, softness: 1, wobble: 1, recovery: 1 }],
    ['bouncy and runny', { stretchiness: 1, viscosity: 0, softness: 1, wobble: 1, recovery: 1 }],
  ])('extreme settings stay stable (%s)', (_, behavior) => {
    const b = makeBody(behavior);
    pullUp(b, 2.5, 0.3, 0.3);
    b.endGrab();
    const top = b.particle(topIndex(b));
    b.impulse(top, { x: 0, y: -1, z: 0 }, 12);
    run(b, 3);
    const m = b.metrics();
    expect(m.healthy).toBe(true);
    expect(b.recoveries).toBe(0);
    expect(m.volume / m.restVolume).toBeGreaterThan(0.7);
    expect(m.volume / m.restVolume).toBeLessThan(1.3);
  });

  test('frame-rate independence: 30 fps and 120 fps land in the same place', () => {
    const a = makeBody(), c = makeBody();
    const go = (b: SoftBody, dt: number) => {
      const top = b.particle(topIndex(b));
      b.beginGrab(top);
      b.moveGrab({ x: top.x + 0.5, y: top.y + 0.8, z: top.z });
      for (let t = 0; t < 1; t += dt) b.step(dt);
    };
    go(a, 1 / 30);
    go(c, 1 / 120);
    expect(Math.abs(a.metrics().max.y - c.metrics().max.y)).toBeLessThan(0.02);
  });

  test('is deterministic', () => {
    const a = makeBody(), c = makeBody();
    pullUp(a, 1);
    pullUp(c, 1);
    expect(Array.from(a.positions)).toEqual(Array.from(c.positions));
  });

  test('reset restores the exact resting form', () => {
    const b = makeBody();
    pullUp(b, 1.5);
    b.reset();
    expect(b.metrics().maxDeviation).toBe(0);
    expect(b.isGrabbing).toBe(false);
  });
});

describe('behaviour controls change the physics', () => {
  const stretchUnderPull = (behavior: Partial<SlimeBehavior>) => {
    const b = makeBody(behavior);
    pullUp(b, 1.4, 0.6, 0.4);
    const m = b.metrics();
    return m.max.y - m.min.y;
  };
  const recoveryAfter = (behavior: Partial<SlimeBehavior>, seconds: number) => {
    const b = makeBody(behavior);
    pullUp(b, 1.2);
    b.endGrab();
    run(b, seconds);
    return b.metrics().maxDeviation;
  };

  test('stretchiness lets the body extend further under the same pull', () => {
    expect(stretchUnderPull({ stretchiness: 1 })).toBeGreaterThan(stretchUnderPull({ stretchiness: 0 }) + 0.1);
  });

  test('recovery speed changes how fast it returns', () => {
    expect(recoveryAfter({ recovery: 1 }, 0.6)).toBeLessThan(recoveryAfter({ recovery: 0 }, 0.6) * 0.8);
  });

  test('viscosity slows the response to a poke', () => {
    const travel = (viscosity: number) => {
      const b = makeBody({ viscosity });
      const top = b.particle(topIndex(b));
      b.impulse(top, { x: 0, y: -1, z: 0 }, 5);
      run(b, 0.15);
      return top.y - b.particle(topIndex(b)).y;
    };
    expect(travel(0)).toBeGreaterThan(travel(1) * 1.2);
  });

  test('wobble adds overshoot on release', () => {
    const overshoot = (wobble: number) => {
      const b = makeBody({ wobble, viscosity: 0.3 });
      const top = b.particle(topIndex(b));
      pullUp(b, 1.0);
      b.endGrab();
      let lowest = Infinity;
      for (let t = 0; t < 3; t += SUBSTEP) {
        b.step(SUBSTEP);
        lowest = Math.min(lowest, b.particle(topIndex(b)).y);
      }
      return top.y - lowest; // how far below rest the top swings
    };
    expect(overshoot(1)).toBeGreaterThan(overshoot(0) + 0.02);
  });

  test('softness makes a press go deeper', () => {
    const dent = (softness: number) => {
      const b = makeBody({ softness });
      const top = b.particle(topIndex(b));
      b.beginGrab(top);
      b.moveGrab({ x: top.x, y: top.y - 0.6, z: top.z });
      run(b, 0.8);
      return b.metrics().volume / b.restVolume;
    };
    expect(dent(1)).toBeLessThan(dent(0) - 0.01);
  });
});
