import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { blobClip, changedFraction, drag, inspect, metrics, openApp, settle, surfacePoint, waitFrames } from './helpers.ts';

const setRange = async (page: Page, label: string, value: number) => {
  await page.getByLabel(label, { exact: true }).fill(String(value));
};

test.describe('materials and studio', () => {
  test('each material preset changes the same single blob', async ({ page }) => {
    await openApp(page);
    const clip = await blobClip(page);
    const shots: Buffer[] = [];
    for (const name of ['Holographic Jelly', 'Liquid Chrome', 'Pastel Putty', 'Clear Slime']) {
      await page.getByRole('radio', { name }).click();
      await waitFrames(page, 6);
      shots.push(await page.screenshot({ clip }));
      const info = await inspect(page);
      expect(info.slimeMeshes).toBe(1);
      await expect(page.locator('.materials__name')).toHaveText(name);
    }
    for (let i = 0; i < shots.length; i++) {
      for (let j = i + 1; j < shots.length; j++) {
        expect(changedFraction(shots[i], shots[j]), `preset ${i} vs ${j}`).toBeGreaterThan(0.05);
      }
    }
    // presets carry their own physics too
    await page.getByRole('radio', { name: 'Pastel Putty' }).click();
    const putty = await inspect(page);
    await page.getByRole('radio', { name: 'Liquid Chrome' }).click();
    const chrome = await inspect(page);
    expect(putty.coefficients.damping60).toBeLessThan(chrome.coefficients.damping60);
    expect(chrome.metalness).toBe(1);
  });

  test('studio controls are wired to the physics and the renderer', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Customize' }).click();
    const panel = page.getByRole('complementary', { name: 'Studio controls' });
    await expect(panel).toBeVisible();
    const clip = await blobClip(page);

    const base = await inspect(page);
    await setRange(page, 'Stretchiness', 0);
    await setRange(page, 'Viscosity', 100);
    await setRange(page, 'Softness', 0);
    await setRange(page, 'Wobble', 0);
    await setRange(page, 'Recovery speed', 100);
    const tuned = await inspect(page);
    expect(tuned.coefficients.edgeCompliance).toBeLessThan(base.coefficients.edgeCompliance);
    expect(tuned.coefficients.damping60).toBeLessThan(base.coefficients.damping60);
    expect(tuned.coefficients.grabRadius).toBeLessThan(base.coefficients.grabRadius);
    expect(tuned.coefficients.elasticFraction).toBeLessThan(base.coefficients.elasticFraction);
    expect(tuned.coefficients.shapeMatch60).toBeGreaterThan(base.coefficients.shapeMatch60);

    const beforeLook = await page.screenshot({ clip });
    await setRange(page, 'Gloss', 0);
    await setRange(page, 'Iridescence', 0);
    await waitFrames(page, 6);
    const look = await inspect(page);
    expect(look.roughness).toBeGreaterThan(base.roughness + 0.2);
    expect(look.holo).toBe(0);
    expect(changedFraction(beforeLook, await page.screenshot({ clip }))).toBeGreaterThan(0.05);

    await page.getByRole('radio', { name: '#7fe6ff' }).click();
    expect((await inspect(page)).color).not.toBe(look.color);

    const corner = { x: 10, y: 300, width: 120, height: 120 };
    const bgBefore = await page.screenshot({ clip: corner });
    await panel.getByRole('button', { name: 'Porcelain' }).click();
    await waitFrames(page, 4);
    expect((await inspect(page)).background).toBe('porcelain');
    expect(changedFraction(bgBefore, await page.screenshot({ clip: corner }))).toBeGreaterThan(0.5);

    await panel.getByRole('button', { name: 'Close studio' }).click();
    await expect(page.locator('.studio')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('.studio')).not.toHaveClass(/is-open/);
  });

  test('extreme slider settings stay stable under rough handling', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Customize' }).click();
    for (const v of [0, 100]) {
      for (const l of ['Stretchiness', 'Viscosity', 'Softness', 'Wobble', 'Recovery speed']) await setRange(page, l, v);
      for (const d of [{ x: 0, y: 1, z: 0.5 }, { x: -1, y: 0, z: 0.5 }]) {
        const p = await surfacePoint(page, d);
        await drag(page, p, { x: p.x - 200, y: p.y - 220 }, 8);
        await page.mouse.up();
        await page.mouse.click(p.x + 20, p.y + 40);
      }
      await waitFrames(page, 30);
      const m = await metrics(page);
      expect(m.healthy).toBe(true);
      expect(m.recoveries).toBe(0);
      expect(m.volume / m.restVolume).toBeGreaterThan(0.75);
      expect(m.volume / m.restVolume).toBeLessThan(1.25);
    }
  });
});

test.describe('capture', () => {
  test('screenshot downloads a valid high-resolution PNG', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Capture' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: /Screenshot/ }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^iris-soft-matter-still-.*\.png$/);
    const buf = await readFile((await download.path())!);
    expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const png = PNG.sync.read(buf);
    expect(png.width).toBeGreaterThanOrEqual(1280 * 2);
    // not a blank frame: the centre differs from the corner
    const at = (x: number, y: number) => {
      const i = (y * png.width + x) * 4;
      return png.data[i] + png.data[i + 1] + png.data[i + 2];
    };
    expect(Math.abs(at(png.width / 2, Math.round(png.height * 0.45)) - at(4, 4))).toBeGreaterThan(60);
  });

  test('recording a clip produces a playable, correctly-labelled video', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Capture' }).click();
    await page.getByRole('menuitem', { name: /Record 8s clip/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'REC' })).toBeVisible();
    await expect(page.locator('.playbar')).toHaveCount(0); // clean frame while recording
    const top = await surfacePoint(page, { x: 0, y: 1, z: 0.5 });
    await drag(page, top, { x: top.x + 60, y: top.y - 150 }, 15);
    await page.mouse.up();
    await page.waitForTimeout(1200);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      page.getByRole('button', { name: 'Stop' }).click(),
    ]);
    const name = download.suggestedFilename();
    expect(name).toMatch(/^iris-soft-matter-clip-.*\.(webm|mp4)$/);
    const buf = await readFile((await download.path())!);
    expect(buf.length).toBeGreaterThan(20_000);
    if (name.endsWith('.webm')) expect(buf.subarray(0, 4).toString('hex')).toBe('1a45dfa3');
    else expect(buf.subarray(4, 8).toString('latin1')).toBe('ftyp');

    // decode it in the browser to prove it plays
    const b64 = buf.toString('base64');
    const mime = name.endsWith('.webm') ? 'video/webm' : 'video/mp4';
    const meta = await page.evaluate(async ({ b64, mime }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const v = document.createElement('video');
      v.muted = true;
      v.src = URL.createObjectURL(new Blob([bytes], { type: mime }));
      await new Promise<void>((res, rej) => {
        v.onloadeddata = () => res();
        v.onerror = () => rej(new Error('video failed to decode'));
      });
      return { w: v.videoWidth, h: v.videoHeight };
    }, { b64, mime });
    expect(meta.w).toBeGreaterThan(0);
    expect(meta.h).toBeGreaterThan(0);
  });

  test('clean view hides every control', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('h');
    await expect(page.locator('.playbar')).toHaveCount(0);
    await expect(page.locator('.wordmark')).toHaveCount(0);
    await page.keyboard.press('h');
    await expect(page.locator('.playbar')).toHaveCount(1);
  });
});

test.describe('demo and embed', () => {
  test('show demo drives the real simulation and hands control back', async ({ page }) => {
    test.setTimeout(420_000);
    await openApp(page);
    await page.getByRole('button', { name: 'Customize' }).click();
    await page.getByRole('button', { name: 'Show demo' }).click();
    expect((await inspect(page)).demoRunning).toBe(true);
    // track the peak in-page (one rAF hook) instead of polling over CDP,
    // which steals time from an already slow software renderer
    await page.evaluate(() => {
      const w = window as unknown as { __iris: { metrics(): { maxDeviation: number; max: { y: number } } }; __peak: { dev: number; top: number } };
      w.__peak = { dev: 0, top: 0 };
      const loop = () => {
        const m = w.__iris.metrics();
        w.__peak.dev = Math.max(w.__peak.dev, m.maxDeviation);
        w.__peak.top = Math.max(w.__peak.top, m.max.y);
        requestAnimationFrame(loop);
      };
      loop();
    });
    await page.waitForFunction(
      () => !(window as unknown as { __iris: { inspect(): { demoRunning: boolean } } }).__iris.inspect().demoRunning,
      undefined,
      { timeout: 360_000, polling: 1000 },
    );
    const peak = await page.evaluate(() => (window as unknown as { __peak: { dev: number; top: number } }).__peak);
    expect(peak.dev).toBeGreaterThan(0.6);
    expect(peak.top).toBeGreaterThan(1.4);
    await settle(page, 0.08);
  });

  test('embed mode hides page chrome and fills its iframe', async ({ page }) => {
    test.setTimeout(300_000);
    await openApp(page, '?embed=1');
    await expect(page.locator('.wordmark')).toHaveCount(0);
    await expect(page.locator('.playbar')).toHaveCount(0);
    expect((await inspect(page)).slimeMeshes).toBe(1);

    await page.setContent(
      `<body style="margin:0;background:#fff"><iframe id="f" src="http://localhost:4173/?embed=1" style="width:420px;height:300px;border:0"></iframe></body>`,
    );
    const frame = page.frameLocator('#f');
    const canvas = frame.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    const box = await canvas.boundingBox();
    expect(Math.round(box!.width)).toBe(420);
    expect(Math.round(box!.height)).toBe(300);
    // resizing the iframe resizes the canvas
    await page.locator('#f').evaluate((el) => { (el as HTMLIFrameElement).style.width = '600px'; });
    await expect.poll(async () => Math.round((await canvas.boundingBox())!.width), { timeout: 90_000 }).toBe(600);
  });
});
