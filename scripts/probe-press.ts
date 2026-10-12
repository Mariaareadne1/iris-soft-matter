import { SoftBody, SUBSTEP } from '../src/sim/softBody.ts';
for (const softness of [0, 0.55, 1]) {
  const b = new SoftBody({ behavior: { stretchiness: 0.62, viscosity: 0.45, softness, wobble: 0.6, recovery: 0.45 } }); b.idle = 0;
  const ti = b.nearestParticle({ x: 0, y: 5, z: 0 });
  const top = b.particle(ti);
  b.beginGrab(top);
  b.moveGrab({ x: top.x, y: top.y - 0.4, z: top.z });
  const out: string[] = [];
  for (let k = 0; k < 4; k++) { for (let i = 0; i < 24; i++) b.step(SUBSTEP); out.push((top.y - b.particle(ti).y).toFixed(3)); }
  console.log('softness', softness, 'dent over time', out.join(' '), 'vol', (b.volume() / b.restVolume).toFixed(3), b.coefficients.grabRadius);
}
