import { describe, expect, test } from 'vitest';
import { AdaptiveQuality } from '../../src/engine/adaptiveQuality.ts';

function harness(max = 2) {
  let ratio = max;
  const q = new AdaptiveQuality(() => ratio, () => max, (r) => { ratio = r; });
  const run = (ms: number, seconds: number) => {
    for (let t = 0; t < seconds; t += ms / 1000) q.update(ms / 1000);
  };
  return { q, run, ratio: () => ratio };
}

describe('adaptive quality', () => {
  test('steps resolution down when frames run long', () => {
    const h = harness();
    h.run(16, 2); // warm up at a healthy rate
    h.run(40, 3);
    expect(h.ratio()).toBeLessThan(2);
  });

  test('never drops below the floor', () => {
    const h = harness();
    h.run(100, 60);
    expect(h.ratio()).toBeGreaterThanOrEqual(0.75);
  });

  test('climbs back to the device ratio when there is headroom', () => {
    const h = harness();
    h.run(16, 2);
    h.run(40, 6);
    const dropped = h.ratio();
    h.run(8, 30);
    expect(dropped).toBeLessThan(2);
    expect(h.ratio()).toBe(2);
  });

  test('ignores start-up hitches and hidden-tab gaps', () => {
    const h = harness();
    h.run(80, 1); // shader compile during warm-up
    for (let i = 0; i < 20; i++) h.q.update(2); // tab was hidden
    h.run(16, 3);
    expect(h.ratio()).toBe(2);
  });

  test('holds still while frozen (recording)', () => {
    const h = harness();
    h.run(16, 2);
    h.q.frozen = true;
    h.run(60, 5);
    expect(h.ratio()).toBe(2);
  });
});
