import { SlimeApp } from './engine/SlimeApp.ts';
import { PRESETS } from './render/presets.ts';

const host = document.getElementById('root')!;
host.style.cssText = 'position:fixed;inset:0;';
const p = PRESETS.jelly;
const app = new SlimeApp(host, {
  preset: p.id, color: p.color, iridescence: p.iridescence, gloss: p.gloss,
  background: 'nocturne', behavior: p.behavior,
});
(window as unknown as Record<string, unknown>).__iris = app;
