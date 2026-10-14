import { describe, expect, test } from 'vitest';
import { SoftBody, SUBSTEP } from '../../src/sim/softBody.ts';
import { STICK_HALF, STICK_PITCH, STICK_YAW } from '../../src/sim/shapes.ts';

const run = (b: SoftBody, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / SUBSTEP); i++) b.step(SUBSTEP);
};

/** butter-squishy behaviour: slow rise, little wobble, little stretch */
const BUTTER = { stretchiness: 0.18, viscosity: 0.85, softness: 0.85, wobble: 0.05, recovery: 0.14 };

describe('butter stick shape', () => {
  test('is a closed box-like volume about the size of a stick', () => {
    const b = new SoftBody({ shape: 'stick', behavior: BUTTER });
    const { x, y, z } = STICK_HALF;
    const boxVolume = 8 * x * y * z;
    // a soft-cornered box fills most of its bounding box (a sphere fills 52 %)
    expect(b.restVolume / boxVolume).toBeGreaterThan(0.8);
    expect(b.restVolume / boxVolume).toBeLessThan(1);
    expect(b.restVolume).toBeGreaterThan(0);
  });

  test('carries a printed label on the front face only', () => {
    const b = new SoftBody({ shape: 'stick' });
    // the front face's normal, after the stick is turned and tipped for a 3/4 view
    const nx = Math.sin(STICK_YAW);
    const ny = -Math.cos(STICK_YAW) * Math.sin(STICK_PITCH);
    const nz = Math.cos(STICK_YAW) * Math.cos(STICK_PITCH);
    let front = 0, back = 0;
    for (let i = 0; i < b.count; i++) {
      if (b.label[i * 3 + 2] < 0.5) continue;
      if (b.rest[i * 3] * nx + b.rest[i * 3 + 1] * ny + b.rest[i * 3 + 2] * nz > STICK_HALF.z * 0.7) front++;
      else back++;
    }
    expect(front).toBeGreaterThan(200);
    expect(back).toBe(0);
    const drop = new SoftBody();
    expect(drop.label.some((v) => v !== 0)).toBe(false);
  });

  test('a press dents it and it slowly rises back', () => {
    const b = new SoftBody({ shape: 'stick', behavior: BUTTER });
    b.idle = 0;
    const i = b.nearestParticle({ x: 0, y: 0, z: 5 });
    const p = b.particle(i);
    b.beginGrab(p, 1, 0);
    b.moveGrab({ x: p.x, y: p.y, z: p.z - 0.35 });
    run(b, 0.8);
    expect(b.particle(i).z).toBeLessThan(p.z - 0.2);
    b.endGrab();
    run(b, 0.25);
    expect(b.particle(i).z).toBeLessThan(p.z - 0.08); // slow rise: still dented
    run(b, 8);
    expect(Math.abs(b.particle(i).z - p.z)).toBeLessThan(0.04);
    expect(b.metrics().healthy).toBe(true);
  });

  test('morphs from the drop into the stick and back, staying healthy', () => {
    const b = new SoftBody();
    b.idle = 0;
    const dropVolume = b.restVolume;
    b.setShape('stick', 0.9);
    expect(b.morphing).toBe(true);
    expect(b.labelVersion).toBe(1);
    run(b, 0.45);
    expect(b.metrics().healthy).toBe(true);
    run(b, 3);
    expect(b.morphing).toBe(false);
    expect(b.metrics().maxDeviation).toBeLessThan(0.1);
    expect(b.restVolume).not.toBeCloseTo(dropVolume, 1);
    b.setShape('drop', 0.9);
    run(b, 3.5);
    expect(b.metrics().maxDeviation).toBeLessThan(0.1);
    expect(b.restVolume).toBeCloseTo(dropVolume, 3);
  });

  test('reset during a morph lands exactly on the new shape', () => {
    const b = new SoftBody();
    b.setShape('stick', 0.9);
    run(b, 0.2);
    b.reset();
    expect(b.morphing).toBe(false);
    expect(b.metrics().maxDeviation).toBe(0);
    expect(b.shape).toBe('stick');
  });
});
