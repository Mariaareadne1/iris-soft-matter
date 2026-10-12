import { SoftBody, SUBSTEP } from '../src/sim/softBody.ts';
const b = new SoftBody(); b.idle = 0;
const ti = b.nearestParticle({ x: 0, y: 5, z: 0 });
const top = b.particle(ti);
b.beginGrab(top);
for (let i = 1; i <= 96; i++) { b.moveGrab({ x: top.x, y: top.y + 1.2 * i / 96, z: top.z }); b.step(SUBSTEP); }
for (let i = 0; i < 72; i++) b.step(SUBSTEP);
const prof = (label: string) => {
  const rows: string[] = [];
  for (const r of [0, 0.1, 0.2, 0.3, 0.45, 0.6]) {
    // particle at angle r rad from the top in the xz=x plane
    const i = b.nearestParticle({ x: Math.sin(r) * 5, y: Math.cos(r) * 5, z: 0 });
    const p = b.particle(i), q = { x: b.rest[i*3], y: b.rest[i*3+1] };
    rows.push(`${r}: dy=${(p.y - q.y).toFixed(3)}`);
  }
  console.log(label, rows.join(' | '), 'maxDev', b.metrics().maxDeviation.toFixed(3), 'vol', (b.volume()/b.restVolume).toFixed(3));
};
prof('held   ');
b.endGrab();
for (const n of [4, 8, 20, 60, 240]) { for (let i = 0; i < n; i++) b.step(SUBSTEP); prof(`+${n}   `); }
