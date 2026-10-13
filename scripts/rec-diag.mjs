// Diagnose clip recording in a given browser: node scripts/rec-diag.mjs <baseUrl>
import { chromium } from '@playwright/test';
const base = process.argv[2] ?? 'http://localhost:4173';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const [vw, vh] = (process.env.VP ?? '960x600').split('x').map(Number);
const p = await b.newPage({ viewport: { width: vw, height: vh } });
p.on('console', (m) => console.log('[console]', m.type(), m.text()));
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
if (process.argv[3] === 'webm') {
  await p.addInitScript(() => {
    const orig = MediaRecorder.isTypeSupported.bind(MediaRecorder);
    MediaRecorder.isTypeSupported = (t) => !t.startsWith('video/mp4') && orig(t);
  });
}
await p.goto(base + '/?fixedres=1');
await p.waitForFunction(() => window.__iris && window.__iris.metrics().frames > 5, undefined, { timeout: 120000 });
const types = await p.evaluate(() => ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8']
  .map((t) => `${t}=${MediaRecorder.isTypeSupported(t)}`).join(' '));
console.log('support:', types);
const fps = await p.evaluate(async () => {
  const f0 = window.__iris.metrics().frames, t0 = performance.now();
  await new Promise((r) => setTimeout(r, 5000));
  return (window.__iris.metrics().frames - f0) / ((performance.now() - t0) / 1000);
});
console.log('fps:', fps.toFixed(2));
const secs = Number(process.argv[4] ?? 3);
const result = await p.evaluate(async (secs) => {
  const log = [];
  const app = window.__iris;
  const t0 = performance.now();
  try {
    const done = app.startRecording(secs, 'diag');
    const clip = await done;
    return { ok: true, type: clip.mimeType, size: clip.blob.size, secs: (performance.now() - t0) / 1000, log };
  } catch (e) {
    return { ok: false, error: String(e), secs: (performance.now() - t0) / 1000, log };
  }
}, secs);
console.log('result:', JSON.stringify(result));
await b.close();
