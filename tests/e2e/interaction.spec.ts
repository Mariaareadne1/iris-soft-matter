import { expect, test } from '@playwright/test';
import { blobClip, changedFraction, drag, inspect, metrics, openApp, settle, surfacePoint, waitFrames } from './helpers.ts';

test.describe('the blob', () => {
  test('launches without errors and renders exactly one volumetric blob', async ({ page }) => {
    const errors = await openApp(page);
    const info = await inspect(page);
    const m = await metrics(page);
    expect(info.slimeMeshes).toBe(1);
    expect(info.triangles).toBeGreaterThan(15000); // smooth render surface
    expect(info.particles).toBeGreaterThan(2000);
    expect(m.healthy).toBe(true);
    expect(m.volume).toBeGreaterThan(3.5); // closed, enclosing a real volume
    expect(Math.abs(m.volume / m.restVolume - 1)).toBeLessThan(0.05);
    await expect(page.locator('canvas')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: /IRIS.*SOFT MATTER/ })).toBeVisible();
    await expect(page.getByText('Drag to stretch. Click to poke.')).toBeVisible();

    // the blob is actually drawn: its centre is far from the background colour
    const shot = await page.screenshot({ clip: await blobClip(page) });
    const empty = await page.screenshot({ clip: { x: 0, y: 0, width: 120, height: 120 } });
    expect(shot.length).toBeGreaterThan(empty.length);
    expect(errors).toEqual([]);
  });

  test('a click pokes a visible dent that recovers', async ({ page }) => {
    await openApp(page);
    await settle(page);
    const clip = await blobClip(page);
    const before = await page.screenshot({ clip });
    const p = await surfacePoint(page, { x: 0.15, y: 0.35, z: 1 });
    await page.mouse.click(p.x, p.y);
    await waitFrames(page, 4);
    const dented = await metrics(page);
    const after = await page.screenshot({ clip });
    expect(dented.maxDeviation).toBeGreaterThan(0.04);
    expect(changedFraction(before, after)).toBeGreaterThan(0.01);
    await expect(page.getByText('Drag to stretch. Click to poke.')).toHaveClass(/is-hidden/);
    await settle(page, 0.05);
  });

  test('dragging stretches part of the blob instead of translating it', async ({ page }) => {
    await openApp(page);
    await settle(page);
    const rest = await metrics(page);
    const clip = await blobClip(page);
    const before = await page.screenshot({ clip });
    const top = await surfacePoint(page, { x: 0, y: 1, z: 0.6 });
    await drag(page, top, { x: top.x + 40, y: top.y - 170 });
    await waitFrames(page, 20);
    const held = await metrics(page);
    const during = await page.screenshot({ clip });

    const topRise = held.max.y - rest.max.y;
    const bottomRise = held.min.y - rest.min.y;
    expect(held.interaction).toBe('dragging');
    expect(topRise).toBeGreaterThan(0.5);
    expect(Math.abs(bottomRise)).toBeLessThan(topRise * 0.3); // local, not rigid
    expect(Math.abs(held.volume / held.restVolume - 1)).toBeLessThan(0.15);
    expect(changedFraction(before, during)).toBeGreaterThan(0.04);

    // release: a gradual return, not a snap
    await page.mouse.up();
    await waitFrames(page, 3);
    const justReleased = await metrics(page);
    expect(justReleased.interaction).toBe('idle');
    expect(justReleased.maxDeviation).toBeGreaterThan(held.maxDeviation * 0.5);
    await settle(page, 0.06);
  });

  test('dragging outside the blob and the canvas keeps the grab alive', async ({ page }) => {
    await openApp(page);
    await settle(page);
    const side = await surfacePoint(page, { x: 1, y: 0.1, z: 0.6 });
    await drag(page, side, { x: page.viewportSize()!.width - 5, y: side.y }, 25);
    await page.mouse.move(page.viewportSize()!.width + 60, side.y + 10); // past the edge
    await waitFrames(page, 10);
    const m = await metrics(page);
    expect(m.interaction).toBe('dragging');
    expect(m.max.x).toBeGreaterThan(1.6);
    await page.mouse.up();
    await waitFrames(page, 2);
    expect((await metrics(page)).interaction).toBe('idle');
  });

  test('pressing and holding squishes the surface inward', async ({ page }) => {
    await openApp(page);
    await settle(page);
    const p = await surfacePoint(page, { x: 0, y: 0.2, z: 1 });
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    // the dent deepens while held (simulation time, independent of frame rate)
    await page.waitForFunction(
      () => (window as unknown as { __iris: { metrics(): { maxDeviation: number } } }).__iris.metrics().maxDeviation > 0.15,
      undefined,
      { timeout: 15_000 },
    );
    const m = await metrics(page);
    expect(m.interaction).toBe('pressing');
    expect(m.max.z).toBeLessThan(1.05); // front face pushed in
    await page.mouse.up();
    await settle(page, 0.06);
  });

  test('repeated rough handling never breaks the simulation', async ({ page }) => {
    await openApp(page);
    const dirs = [
      { x: 0, y: 1, z: 0.5 }, { x: 1, y: 0, z: 0.5 }, { x: -1, y: 0.2, z: 0.5 },
      { x: 0.3, y: -1, z: 0.6 }, { x: -0.6, y: 0.7, z: 0.6 },
    ];
    for (let round = 0; round < 3; round++) {
      for (const [k, d] of dirs.entries()) {
        const p = await surfacePoint(page, d);
        const sign = k % 2 ? -1 : 1;
        await drag(page, p, { x: p.x + sign * 260, y: p.y - sign * 200 }, 6);
        await page.mouse.up();
      }
    }
    const m = await metrics(page);
    expect(m.healthy).toBe(true);
    expect(m.recoveries).toBe(0);
    await settle(page, 0.15, 25_000);
  });

  test('reset restores the resting form', async ({ page }) => {
    await openApp(page);
    const top = await surfacePoint(page, { x: 0, y: 1, z: 0.5 });
    await drag(page, top, { x: top.x, y: top.y - 160 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Reset' }).click();
    await waitFrames(page, 2);
    expect((await metrics(page)).maxDeviation).toBeLessThan(0.05);
  });
});
