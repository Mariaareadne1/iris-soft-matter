// Visual review: drives the running app and saves screenshots of key states.
// usage: node scripts/shots.mjs <baseUrl> <outDir> [scenario...]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:5299', out = 'shots', ...only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function open(query, viewport = { width: 1280, height: 800 }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.goto(base + '/' + query);
  await page.waitForFunction(() => window.__iris && window.__iris.metrics().frames > 10, undefined, { timeout: 30000 });
  return page;
}
const frames = (page, n) => page.evaluate(async (n) => {
  const s = window.__iris.metrics().frames;
  while (window.__iris.metrics().frames < s + n) await new Promise((r) => requestAnimationFrame(r));
}, n);
const hold = (page, dir, d, shape = 1) => page.evaluate(({ dir, d, shape }) => {
  const b = window.__iris.body; b.reset();
  const p = b.particle(b.nearestParticle(dir)); b.beginGrab(p, 1, shape);
  window.__tgt = { x: p.x + d.x, y: p.y + d.y, z: p.z + d.z }; window.__p = p;
}, { dir, d, shape });
const ease = async (page, n = 40) => { for (let i = 1; i <= n; i++) { await page.evaluate((k) => { const p = window.__p, t = window.__tgt; window.__iris.body.moveGrab({ x: p.x + (t.x - p.x) * k, y: p.y + (t.y - p.y) * k, z: p.z + (t.z - p.z) * k }); }, i / n); await frames(page, 1); } };

const scenarios = {
  async rest(page, tag) { await frames(page, 30); await page.screenshot({ path: `${out}/${tag}-rest.png` }); },
  async stretch(page, tag) {
    await hold(page, { x: 0.4, y: 5, z: 1.2 }, { x: 0.7, y: 1.1, z: 0.3 }); await ease(page); await frames(page, 30);
    await page.screenshot({ path: `${out}/${tag}-stretch.png` });
    await page.evaluate(() => window.__iris.body.endGrab()); await frames(page, 8);
    await page.screenshot({ path: `${out}/${tag}-release.png` });
  },
  async side(page, tag) {
    await hold(page, { x: -5, y: 0.5, z: 1 }, { x: -1.2, y: 0.2, z: 0.4 }); await ease(page); await frames(page, 30);
    await page.screenshot({ path: `${out}/${tag}-side.png` });
  },
  async press(page, tag) {
    await hold(page, { x: 0.2, y: 0.6, z: 5 }, { x: 0, y: -0.15, z: -0.45 }, 0); await ease(page, 20); await frames(page, 30);
    await page.screenshot({ path: `${out}/${tag}-press.png` });
  },
};

const looks = [['jelly', '?material=jelly'], ['chrome', '?material=chrome'], ['putty', '?material=putty'], ['clear', '?material=clear'],
  ['porcelain', '?material=jelly&bg=porcelain'], ['dusk', '?material=clear&bg=dusk']];
for (const [tag, q] of looks) {
  if (only.length && !only.includes(tag)) continue;
  const page = await open(q);
  for (const s of Object.values(scenarios)) await s(page, tag);
  await page.close();
}
if (!only.length || only.includes('mobile')) {
  const page = await open('', { width: 390, height: 844 });
  await scenarios.rest(page, 'mobile');
  await page.close();
}
await browser.close();
console.log('done');
