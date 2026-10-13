import { chromium } from '@playwright/test';
const args = process.argv[2] === 'swift' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [];
const b = await chromium.launch({ args });
const p = await b.newPage();
await p.goto('about:blank');
const r = await p.evaluate(async () => {
  const run = async (kind, w, h, opts) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; document.body.appendChild(c);
    const ctx = kind === '2d' ? c.getContext('2d') : c.getContext(kind, opts);
    let f = 0;
    const draw = () => {
      f++;
      if (kind === '2d') { ctx.fillStyle = `hsl(${f * 40 % 360},80%,50%)`; ctx.fillRect(0, 0, w, h); }
      else { ctx.clearColor((f % 10) / 10, 0.3, 0.6, 1); ctx.clear(ctx.COLOR_BUFFER_BIT); }
    };
    const s = c.captureStream(30); const rec = new MediaRecorder(s, { mimeType: 'video/webm;codecs=vp8' }); let size = 0;
    rec.ondataavailable = (e) => (size += e.data.size);
    const done = new Promise((res) => (rec.onstop = res));
    rec.start(100);
    const t0 = performance.now();
    await new Promise((res) => { const loop = () => { draw(); if (performance.now() - t0 < 800) requestAnimationFrame(loop); else res(); }; loop(); });
    rec.stop(); await done; c.remove();
    return size;
  };
  return {
    '2d 960x600': await run('2d', 960, 600),
    'webgl2 64': await run('webgl2', 64, 64, {}),
    'webgl2 960x600': await run('webgl2', 960, 600, {}),
    'webgl2 960x600 alpha:false': await run('webgl2', 960, 600, { alpha: false }),
    'webgl2 preserve': await run('webgl2', 960, 600, { preserveDrawingBuffer: true }),
  };
});
console.log(process.argv[2] ?? 'default', JSON.stringify(r));
await b.close();
