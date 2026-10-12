import { expect, test } from '@playwright/test';
import { metrics, openApp, surfacePoint, waitFrames } from './helpers.ts';

test('mobile: blob fits, controls fit, touch pokes and drags', async ({ page }) => {
  await openApp(page);
  const vp = page.viewportSize()!;
  const bar = await page.locator('.playbar').boundingBox();
  expect(bar!.x).toBeGreaterThanOrEqual(0);
  expect(bar!.x + bar!.width).toBeLessThanOrEqual(vp.width);

  // the whole resting blob is on screen
  const left = await surfacePoint(page, { x: -1, y: 0, z: 0.2 });
  const right = await surfacePoint(page, { x: 1, y: 0, z: 0.2 });
  expect(left.x).toBeGreaterThan(0);
  expect(right.x).toBeLessThan(vp.width);
  expect(right.x - left.x).toBeGreaterThan(vp.width * 0.4);

  await expect(page.getByText('Drag to stretch. Tap to poke.')).toBeVisible();
  const p = await surfacePoint(page, { x: 0, y: 0.3, z: 1 });
  await page.touchscreen.tap(p.x, p.y);
  await waitFrames(page, 4);
  expect((await metrics(page)).maxDeviation).toBeGreaterThan(0.03);

  // a touch drag via CDP (Playwright has no touch-move helper)
  const top = await surfacePoint(page, { x: 0, y: 1, z: 0.5 });
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', top.x, top.y);
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', top.x, top.y - i * 12);
    await page.waitForTimeout(16);
  }
  await waitFrames(page, 10);
  const m = await metrics(page);
  expect(m.interaction).toBe('dragging');
  expect(m.max.y).toBeGreaterThan(1.3);
  await touch('touchEnd', 0, 0);
  await waitFrames(page, 2);
  expect((await metrics(page)).interaction).toBe('idle');
});
