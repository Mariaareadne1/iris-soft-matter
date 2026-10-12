// Renders public/og-image.png (1200x630) and public/apple-touch-icon.png from the live app.
// usage: node scripts/og.mjs [baseUrl]
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5299';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(base + '/');
await page.waitForFunction(() => window.__iris && window.__iris.metrics().frames > 10);
const frames = (n) => page.evaluate(async (n) => {
  const s = window.__iris.metrics().frames;
  while (window.__iris.metrics().frames < s + n) await new Promise((r) => requestAnimationFrame(r));
}, n);
await page.keyboard.press('h'); // clean view
await page.evaluate(() => {
  const b = window.__iris.body;
  const p = b.particle(b.nearestParticle({ x: 2, y: 4, z: 1.5 }));
  b.beginGrab(p);
  window.__p = p;
});
for (let i = 1; i <= 40; i++) {
  await page.evaluate((k) => {
    const p = window.__p;
    window.__iris.body.moveGrab({ x: p.x + 0.95 * k, y: p.y + 0.75 * k, z: p.z + 0.25 * k });
  }, i / 40);
  await frames(1);
}
await frames(40);
await page.addStyleTag({ content: `
  .og { position: fixed; left: 64px; bottom: 58px; color: rgba(244,241,255,.94); pointer-events: none; }
  .og h1 { margin: 0; font: 600 40px/1 'Fraunces', serif; letter-spacing: .16em; }
  .og h1 span { color: rgba(232,228,250,.35); font-weight: 400; margin: 0 .35em; }
  .og p { margin: 14px 0 0; font: italic 22px 'Fraunces', serif; color: rgba(232,228,250,.62); }` });
await page.evaluate(() => {
  const d = document.createElement('div');
  d.className = 'og';
  d.innerHTML = '<h1>IRIS<span>/</span>SOFT MATTER</h1><p>An experiment in digital tactility.</p>';
  document.body.appendChild(d);
});
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: 'public/og-image.png' });

const icon = await browser.newPage({ viewport: { width: 180, height: 180 } });
const svg = readFileSync('public/favicon.svg', 'utf8');
await icon.setContent(`<body style="margin:0">${svg.replace('<svg ', '<svg width="180" height="180" ')}</body>`);
await icon.screenshot({ path: 'public/apple-touch-icon.png' });
await browser.close();
console.log('wrote public/og-image.png and public/apple-touch-icon.png');
