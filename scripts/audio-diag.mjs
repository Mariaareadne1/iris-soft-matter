// Diagnose slime audio + audio recording: node scripts/audio-diag.mjs <baseUrl>
import { chromium } from '@playwright/test';
const base = process.argv[2] ?? 'http://localhost:4173';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 480, height: 320 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(base + '/?fixedres=1');
await p.waitForFunction(() => window.__iris && window.__iris.metrics().frames > 5, undefined, { timeout: 120000 });
const pt = await p.evaluate(() => window.__iris.surfacePoint({ x: 0.1, y: 0.3, z: 1 }));
await p.mouse.click(pt.x, pt.y);
const states = [];
for (let i = 0; i < 6; i++) {
  states.push(await p.evaluate(() => {
    const a = window.__iris.audio;
    return `${a.ctx?.state}@${a.ctx?.currentTime.toFixed(2)} lvl=${a.level().toFixed(4)}`;
  }));
  await p.waitForTimeout(250);
}
console.log('ctx:', states.join(' | '));
const rec = await p.evaluate(async () => {
  const a = window.__iris;
  const t0 = performance.now();
  try {
    const c = await Promise.race([a.startRecording(3, 'diag'), new Promise((_, j) => setTimeout(() => j(new Error('timeout 15s')), 15000))]);
    return { ok: true, type: c.mimeType, kb: Math.round(c.blob.size / 1024), secs: ((performance.now() - t0) / 1000).toFixed(1) };
  } catch (e) {
    return { ok: false, e: String(e), recState: a.recorder.recorder?.state, secs: ((performance.now() - t0) / 1000).toFixed(1) };
  }
});
console.log('rec:', JSON.stringify(rec));
await b.close();
