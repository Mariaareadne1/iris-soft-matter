// Records a short showcase clip (video + sound) with the app's own recorder,
// driven by real mouse input at real time on the Mac GPU.
// usage: node scripts/showcase-clip.mjs <baseUrl> <outFile> [material] [bg]
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const [base = 'http://localhost:4173', out = 'captures/showcase.mp4', material = 'butter', bg = 'porcelain'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await page.goto(`${base}/?fixedres=1&material=${material}&bg=${bg}`);
await page.waitForFunction(() => window.__iris && window.__iris.metrics().frames > 60 && !window.__iris.body.morphing, undefined, { timeout: 60000 });
await page.mouse.click(20, 400); // unlock audio on empty space
await page.keyboard.press('h'); // clean view
await page.waitForTimeout(600);
const at = (d) => page.evaluate((dir) => window.__iris.surfacePoint(dir), d);
// screen point of a resting particle nearest a body-space point (for aiming
// at the middle of the label rather than the nearest corner)
const atRest = (q) => page.evaluate((q) => {
  const a = window.__iris, b = a.body, r = b.rest;
  let best = 0, bd = Infinity;
  for (let i = 0; i < b.count; i++) {
    const d = (r[i * 3] - q.x) ** 2 + (r[i * 3 + 1] - q.y) ** 2 + (r[i * 3 + 2] - q.z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return a.interaction.screenPointOf(b.particle(best));
}, q);
const done = page.evaluate(async () => {
  const clip = await window.__iris.startRecording(11.5, 'showcase');
  const bytes = new Uint8Array(await clip.blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return { b64: btoa(s), type: clip.mimeType };
});
await page.waitForTimeout(700);

// slow squeeze in the middle, hold, release → slow rise
let p = await atRest({ x: 0.15, y: 0.1, z: 0.6 });
await page.mouse.move(p.x, p.y);
await page.mouse.down();
await page.waitForTimeout(1500);
await page.mouse.up();
await page.waitForTimeout(1700);

// two quick pokes
for (const q of [{ x: -0.7, y: 0.05, z: 0.75 }, { x: 0.75, y: 0.15, z: 0.35 }]) {
  p = await atRest(q);
  await page.mouse.click(p.x, p.y, { delay: 70 });
  await page.waitForTimeout(600);
}
await page.waitForTimeout(500);

// pull one end out and let go
p = await at({ x: 1, y: 0.1, z: 0.4 });
await page.mouse.move(p.x, p.y);
await page.mouse.down();
for (let i = 1; i <= 40; i++) { await page.mouse.move(p.x + i * 3.5, p.y - i * 1.6); await page.waitForTimeout(20); }
await page.waitForTimeout(450);
await page.mouse.up();

const { b64, type } = await done;
const file = out.replace(/\.[a-z0-9]+$/, type.startsWith('video/mp4') ? '.mp4' : '.webm');
writeFileSync(file, Buffer.from(b64, 'base64'));
console.log('wrote', file, type, Math.round(Buffer.from(b64, 'base64').length / 1024), 'kB');
await browser.close();
