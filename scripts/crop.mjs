// node scripts/crop.mjs in.png out.jpg x y w h
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const [inp, out, x, y, w, h] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +w, height: +h } });
await p.setContent(`<body style="margin:0;overflow:hidden"><img style="position:absolute;left:${-x}px;top:${-y}px" src="data:image/png;base64,${readFileSync(inp).toString('base64')}">`);
await p.screenshot({ path: out, type: 'jpeg', quality: 88 });
await b.close();
