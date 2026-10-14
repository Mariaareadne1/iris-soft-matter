import { expect, test } from '@playwright/test';
import { blobClip, changedFraction, inspect, metrics, openApp, surfacePoint, waitFrames } from './helpers.ts';

type W = { __iris: { body: { shape: string; morphing: boolean; label: Float32Array } } };
const shape = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const b = (window as unknown as W).__iris.body;
    let printed = 0;
    for (let i = 2; i < b.label.length; i += 3) if (b.label[i] > 0.5) printed++;
    return { shape: b.shape, morphing: b.morphing, printed };
  });

test.describe('butter squishy', () => {
  test('the blob morphs into a printed butter stick and back — still one object', async ({ page }) => {
    await openApp(page);
    const clip = await blobClip(page);
    const blob = await page.screenshot({ clip });
    await page.getByRole('radio', { name: 'Butter Squishy' }).click();
    await expect.poll(async () => (await shape(page)).shape).toBe('stick');
    await expect.poll(async () => (await shape(page)).morphing, { timeout: 60_000 }).toBe(false);
    await waitFrames(page, 4);
    const info = await inspect(page);
    expect(info.slimeMeshes).toBe(1);
    expect((await shape(page)).printed).toBeGreaterThan(200);
    const m = await metrics(page);
    // a stick: much wider than it is tall
    expect((m.max.x - m.min.x) / (m.max.y - m.min.y)).toBeGreaterThan(1.8);
    expect(changedFraction(blob, await page.screenshot({ clip }))).toBeGreaterThan(0.05);

    await page.getByRole('radio', { name: 'Holographic Jelly' }).click();
    await expect.poll(async () => (await shape(page)).shape).toBe('drop');
    await expect.poll(async () => (await shape(page)).morphing, { timeout: 60_000 }).toBe(false);
    expect((await shape(page)).printed).toBe(0);
  });

  test('a press dents the butter and it slowly rises back', async ({ page }) => {
    await openApp(page, '?material=butter');
    await expect.poll(async () => (await shape(page)).shape).toBe('stick');
    const p = await surfacePoint(page, { x: 0, y: 0.1, z: 1 });
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForFunction(
      () => (window as unknown as { __iris: { metrics(): { maxDeviation: number } } }).__iris.metrics().maxDeviation > 0.15,
      undefined,
      { timeout: 60_000 },
    );
    await page.mouse.up();
    await waitFrames(page, 3);
    // slow rise: a few frames after letting go it is still clearly dented
    expect((await metrics(page)).maxDeviation).toBeGreaterThan(0.08);
    await page.waitForFunction(
      () => (window as unknown as { __iris: { metrics(): { maxDeviation: number } } }).__iris.metrics().maxDeviation < 0.05,
      undefined,
      { timeout: 120_000 },
    );
    expect((await metrics(page)).healthy).toBe(true);
  });
});
