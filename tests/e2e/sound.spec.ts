import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { drag, openApp, settle, surfacePoint } from './helpers.ts';

type Audio = { ready: boolean; on: boolean; level: number; pokes: number; releases: number; presses: number; clipHadAudio: boolean };
type W = { __iris: { inspect(): { audio: Audio } }; __peak?: number; __peakTimer?: number };

const audio = (page: Page) => page.evaluate(() => (window as unknown as W).__iris.inspect().audio);

/** Track the loudest master-bus level in-page until `stopPeak` is called. */
const startPeak = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as W;
    w.__peak = 0;
    w.__peakTimer = window.setInterval(() => {
      w.__peak = Math.max(w.__peak ?? 0, w.__iris.inspect().audio.level);
    }, 10);
  });
const stopPeak = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as W;
    clearInterval(w.__peakTimer);
    return w.__peak ?? 0;
  });

/** Wait for the audio clock to tick: one-shots are scheduled on it. */
const listen = (page: Page, ms = 400) => page.waitForTimeout(ms);

test.describe('sound', () => {
  test('poking and stretching make sound', async ({ page }) => {
    await openApp(page);
    await settle(page);
    expect((await audio(page)).ready).toBe(false); // nothing before a gesture

    await startPeak(page);
    const p = await surfacePoint(page, { x: 0.1, y: 0.3, z: 1 });
    await page.mouse.click(p.x, p.y);
    await listen(page);
    const afterPoke = await audio(page);
    expect(afterPoke.ready).toBe(true);
    expect(afterPoke.pokes + afterPoke.presses).toBeGreaterThan(0);
    expect(await stopPeak(page)).toBeGreaterThan(0.002);

    await settle(page);
    await startPeak(page);
    const top = await surfacePoint(page, { x: 0, y: 1, z: 0.6 });
    await drag(page, top, { x: top.x + 40, y: top.y - 170 });
    await page.mouse.up();
    await listen(page, 600);
    expect((await audio(page)).releases).toBeGreaterThan(0);
    expect(await stopPeak(page)).toBeGreaterThan(0.01);
  });

  test('the sound toggle and M key mute everything', async ({ page }) => {
    await openApp(page);
    const toggle = page.getByRole('button', { name: 'Sound', exact: true });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const p = await surfacePoint(page, { x: 0.1, y: 0.3, z: 1 });
    await page.mouse.click(p.x, p.y); // unlock audio
    await listen(page, 800);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await listen(page, 300);
    const before = await audio(page);
    await startPeak(page);
    await page.mouse.click(p.x, p.y);
    await listen(page);
    expect(await stopPeak(page)).toBeLessThan(0.0005);
    expect((await audio(page)).pokes).toBe(before.pokes);

    await page.keyboard.press('m');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  test('?sound=0 starts muted', async ({ page }) => {
    await openApp(page, '?sound=0');
    await expect(page.getByRole('button', { name: 'Sound', exact: true })).toHaveAttribute('aria-pressed', 'false');
    expect((await audio(page)).on).toBe(false);
  });

  test.describe('recording with sound', () => {
    test.use({ viewport: { width: 480, height: 320 } }); // fast enough frames on software GL

    test('captured clips carry the audio track', async ({ page }) => {
      await openApp(page);
      const p = await surfacePoint(page, { x: 0.1, y: 0.3, z: 1 });
      await page.mouse.click(p.x, p.y); // unlock audio
      await listen(page);
      const downloaded = page.waitForEvent('download', { timeout: 120_000 });
      await page.getByRole('button', { name: 'Capture' }).click();
      await page.getByRole('menuitem', { name: /Record 8s clip/ }).click();
      await page.mouse.click(p.x, p.y);
      const stop = page.getByRole('button', { name: 'Stop' });
      await page.waitForTimeout(1500);
      if (await stop.isVisible()) await stop.click({ timeout: 3_000 }).catch(() => {});
      const download = await downloaded;
      const buf = await readFile((await download.path())!);
      expect((await audio(page)).clipHadAudio).toBe(true);
      const text = buf.toString('latin1');
      // AAC in MP4, or Opus in WebM/Matroska
      expect(text.includes('mp4a') || text.includes('A_OPUS') || text.includes('Opus')).toBe(true);
    });
  });
});
