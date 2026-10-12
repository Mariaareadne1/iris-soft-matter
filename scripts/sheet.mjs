// Compose screenshots into one contact sheet: node scripts/sheet.mjs out.jpg cols a.png b.png ...
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
const [out, cols, ...files] = process.argv.slice(2);
const cells = files.map((f) => `<figure><img src="data:image/png;base64,${readFileSync(f).toString('base64')}"><figcaption>${basename(f)}</figcaption></figure>`).join('');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 400 } });
await page.setContent(`<style>body{margin:0;display:grid;grid-template-columns:repeat(${cols},1fr);background:#fff;font:12px sans-serif}figure{margin:0}img{width:100%;display:block}figcaption{padding:2px 4px}</style>${cells}`);
await page.screenshot({ path: out, fullPage: true, type: 'jpeg', quality: 85 });
await browser.close();
