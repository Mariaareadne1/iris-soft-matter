import { expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

export interface Metrics {
  volume: number;
  restVolume: number;
  centroid: { x: number; y: number; z: number };
  maxDeviation: number;
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  healthy: boolean;
  interaction: string;
  frames: number;
  recoveries: number;
}

export type Inspect = {
  preset: string;
  background: string;
  slimeMeshes: number;
  triangles: number;
  particles: number;
  roughness: number;
  metalness: number;
  transmission: number;
  iridescence: number;
  holo: number;
  color: string;
  coefficients: Record<string, number>;
  demoRunning: boolean;
  recording: boolean;
};

type IrisWindow = {
  __iris: {
    metrics(): Metrics;
    inspect(): Inspect;
    surfacePoint(d: { x: number; y: number; z: number }): { x: number; y: number };
    body: { particle(i: number): { x: number; y: number; z: number }; nearestParticle(p: unknown): number };
  };
};

export async function openApp(page: Page, query = '') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  // fixed resolution: adaptive quality would otherwise change pixel density
  // mid-test on a software renderer and make pixel diffs meaningless
  const q = query ? `${query}&fixedres=1` : '?fixedres=1';
  await page.goto(`/${q}`);
  await page.waitForFunction(() => {
    const w = window as unknown as Partial<IrisWindow>;
    return !!w.__iris && w.__iris.metrics().frames > 10;
  }, undefined, { timeout: 150_000 });
  return errors;
}

export const metrics = (page: Page) =>
  page.evaluate(() => (window as unknown as IrisWindow).__iris.metrics());

export const inspect = (page: Page) =>
  page.evaluate(() => (window as unknown as IrisWindow).__iris.inspect());

/** Screen point (CSS px) of the blob surface in a world direction. */
export const surfacePoint = (page: Page, d: { x: number; y: number; z: number }) =>
  page.evaluate((dir) => (window as unknown as IrisWindow).__iris.surfacePoint(dir), d);

/** Wait for the simulation to advance by at least `frames` rendered frames. */
export async function waitFrames(page: Page, frames: number) {
  const start = (await metrics(page)).frames;
  await page.waitForFunction(
    (target) => (window as unknown as IrisWindow).__iris.metrics().frames >= target,
    start + frames,
    { timeout: 150_000 },
  );
}

/** Let the blob settle until nothing is being held and deviation is small. */
export async function settle(page: Page, maxDeviation = 0.06, timeout = 20_000) {
  await page.waitForFunction(
    (lim) => (window as unknown as IrisWindow).__iris.metrics().maxDeviation < lim,
    maxDeviation,
    { timeout },
  );
}

/** Mean absolute RGB difference (0..255) inside a clip rectangle of two screenshots. */
export function pixelDiff(a: Buffer, b: Buffer): number {
  const pa = PNG.sync.read(a), pb = PNG.sync.read(b);
  expect(pa.width).toBe(pb.width);
  expect(pa.height).toBe(pb.height);
  let sum = 0;
  for (let i = 0; i < pa.data.length; i += 4) {
    sum += Math.abs(pa.data[i] - pb.data[i]) + Math.abs(pa.data[i + 1] - pb.data[i + 1]) + Math.abs(pa.data[i + 2] - pb.data[i + 2]);
  }
  return sum / ((pa.data.length / 4) * 3);
}

/** Fraction of pixels whose colour changed noticeably. */
export function changedFraction(a: Buffer, b: Buffer, threshold = 24): number {
  const pa = PNG.sync.read(a), pb = PNG.sync.read(b);
  let changed = 0;
  const n = pa.data.length / 4;
  for (let i = 0; i < pa.data.length; i += 4) {
    const d = Math.abs(pa.data[i] - pb.data[i]) + Math.abs(pa.data[i + 1] - pb.data[i + 1]) + Math.abs(pa.data[i + 2] - pb.data[i + 2]);
    if (d > threshold) changed++;
  }
  return changed / n;
}

export async function blobClip(page: Page) {
  const vp = page.viewportSize()!;
  const w = Math.round(vp.width * 0.6), h = Math.round(vp.height * 0.75);
  return { x: Math.round((vp.width - w) / 2), y: Math.round(vp.height * 0.05), width: w, height: h };
}

/** Real mouse drag (down → stepped moves → optional hold) from a to b. */
export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 20) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await page.waitForTimeout(16);
  }
}
