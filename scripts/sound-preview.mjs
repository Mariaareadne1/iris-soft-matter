// Records the slime's own audio output while playing it, so the sound can be
// auditioned without a browser: node scripts/sound-preview.mjs <baseUrl> <out.webm> [material]
// Runs at real time on the Mac GPU (Metal); a press-and-hold, then the demo.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const [base = 'http://localhost:4173', out = 'captures/sound-preview.webm', material = 'jelly'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
await page.goto(`${base}/?fixedres=1&material=${material}`);
await page.waitForFunction(() => window.__iris && window.__iris.metrics().frames > 30, undefined, { timeout: 60000 });

// unlock audio with a real click on empty space, then start capturing the bus
await page.mouse.click(30, 300);
await page.waitForFunction(() => window.__iris.audio.ready);
await page.evaluate(() => {
  const stream = window.__iris.audio.recordingStream;
  const mimeType = ['audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 192000 });
  window.__chunks = [];
  rec.ondataavailable = (e) => window.__chunks.push(e.data);
  rec.start(200);
  window.__rec = rec;
});
const at = (d) => page.evaluate((dir) => window.__iris.surfacePoint(dir), d);
await page.waitForTimeout(500);

// 1. press and hold (squish), then let go
let p = await at({ x: 0.1, y: 0.25, z: 1 });
await page.mouse.move(p.x, p.y);
await page.mouse.down();
await page.waitForTimeout(1400);
await page.mouse.up();
await page.waitForTimeout(1200);

// 2. three quick pokes
for (const d of [{ x: -0.4, y: 0.3, z: 1 }, { x: 0.35, y: 0.1, z: 1 }, { x: 0, y: -0.2, z: 1 }]) {
  p = await at(d);
  await page.mouse.click(p.x, p.y, { delay: 60 });
  await page.waitForTimeout(450);
}
await page.waitForTimeout(800);

// 3. a slow stretch upward, hold, release
p = await at({ x: 0, y: 1, z: 0.5 });
await page.mouse.move(p.x, p.y);
await page.mouse.down();
for (let i = 1; i <= 60; i++) { await page.mouse.move(p.x + i * 1.2, p.y - i * 3.2); await page.waitForTimeout(25); }
await page.waitForTimeout(500);
await page.mouse.up();
await page.waitForTimeout(1500);

// 4. a fast yank sideways and release
p = await at({ x: 1, y: 0, z: 0.5 });
await page.mouse.move(p.x, p.y);
await page.mouse.down();
for (let i = 1; i <= 14; i++) { await page.mouse.move(p.x + i * 16, p.y - i * 2); await page.waitForTimeout(16); }
await page.mouse.up();
await page.waitForTimeout(1800);

const { b64, type, stats } = await page.evaluate(async () => {
  window.__rec.stop();
  await new Promise((r) => (window.__rec.onstop = r));
  const type = window.__rec.mimeType;
  const blob = new Blob(window.__chunks, { type });
  const buf = await blob.arrayBuffer();
  // loudness check: decode and measure peak + RMS in dBFS
  const audio = await new AudioContext().decodeAudioData(buf.slice(0));
  const ch = audio.getChannelData(0);
  let peak = 0, sum = 0;
  for (const v of ch) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
  const db = (x) => (20 * Math.log10(Math.max(x, 1e-9))).toFixed(1);
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return { b64: btoa(s), type, stats: `peak ${db(peak)} dBFS, rms ${db(Math.sqrt(sum / ch.length))} dBFS, ${audio.duration.toFixed(1)} s` };
});
const file = out.replace(/\.[a-z0-9]+$/, type.startsWith('audio/mp4') ? '.m4a' : '.webm');
writeFileSync(file, Buffer.from(b64, 'base64'));
console.log('wrote', file, '|', stats);
await browser.close();
