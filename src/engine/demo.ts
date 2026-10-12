import type { SoftBody, Vec3 } from '../sim/softBody.ts';

/**
 * Scripted showcase driven through the same grab / impulse API the pointer
 * uses — every frame of the demo is live simulation, nothing is canned.
 *
 *   0.6s  grab the crown, draw it slowly upward
 *   2.6s  let go — it sags back with a wobble
 *   4.6s  pull the right flank out sideways and a little toward camera
 *   6.6s  release
 *   8.0s  poke the front
 *  10.5s  settle, done
 */
type Step =
  | { at: number; kind: 'grab'; anchor: Vec3 }
  | { at: number; kind: 'pull'; until: number; offset: Vec3 }
  | { at: number; kind: 'release' }
  | { at: number; kind: 'poke'; anchor: Vec3; dir: Vec3; speed: number }
  | { at: number; kind: 'end' };

const SCRIPT: Step[] = [
  { at: 0.6, kind: 'grab', anchor: { x: 0.05, y: 5, z: 0.4 } },
  { at: 0.6, kind: 'pull', until: 2.3, offset: { x: 0.15, y: 1.45, z: 0.1 } },
  { at: 2.6, kind: 'release' },
  { at: 4.6, kind: 'grab', anchor: { x: 5, y: 0.1, z: 0.6 } },
  { at: 4.6, kind: 'pull', until: 6.2, offset: { x: 1.35, y: -0.15, z: 0.35 } },
  { at: 6.6, kind: 'release' },
  { at: 8.0, kind: 'poke', anchor: { x: -0.25, y: 0.2, z: 5 }, dir: { x: 0.05, y: -0.1, z: -1 }, speed: 7 },
  { at: 10.5, kind: 'end' },
];

export const DEMO_DURATION = 10.5;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class DemoPlayer {
  private time = 0;
  private cursor = 0;
  private origin: Vec3 | null = null;
  private pull: Extract<Step, { kind: 'pull' }> | null = null;
  running = false;
  onEnd: (() => void) | null = null;

  constructor(private body: SoftBody) {}

  start() {
    this.time = 0;
    this.cursor = 0;
    this.origin = null;
    this.pull = null;
    this.running = true;
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.body.endGrab();
    this.onEnd?.();
  }

  update(dt: number) {
    if (!this.running) return;
    this.time += dt;
    while (this.cursor < SCRIPT.length && SCRIPT[this.cursor].at <= this.time) {
      this.run(SCRIPT[this.cursor]);
      this.cursor++;
      if (!this.running) return;
    }
    if (this.pull && this.origin) {
      const p = this.pull;
      const k = easeInOut(Math.min(1, (this.time - p.at) / (p.until - p.at)));
      this.body.moveGrab({
        x: this.origin.x + p.offset.x * k,
        y: this.origin.y + p.offset.y * k,
        z: this.origin.z + p.offset.z * k,
      });
    }
  }

  private run(step: Step) {
    switch (step.kind) {
      case 'grab': {
        const point = this.body.particle(this.body.nearestParticle(step.anchor));
        this.body.beginGrab(point);
        this.origin = point;
        break;
      }
      case 'pull':
        this.pull = step;
        break;
      case 'release':
        this.body.endGrab();
        this.pull = null;
        break;
      case 'poke': {
        const point = this.body.particle(this.body.nearestParticle(step.anchor));
        this.body.impulse(point, step.dir, step.speed, 0.9);
        break;
      }
      case 'end':
        this.stop();
        break;
    }
  }
}
