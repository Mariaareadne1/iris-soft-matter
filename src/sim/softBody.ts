import { buildIcosphere } from './icosphere.ts';
import { deriveCoefficients, DEFAULT_BEHAVIOR, type PhysicalCoefficients, type SlimeBehavior } from './params.ts';
import { extractRotation, quatScaleAngle, quatToMat3, type Quat } from './rotation.ts';

/**
 * Volumetric soft body for one blob of slime.
 *
 * A closed triangulated surface of particles solved with small-step XPBD
 * (Macklin et al. 2019) at a fixed 120 Hz:
 *   - edge distance constraints (compliant → the surface can stretch)
 *     whose rest lengths flow while held and creep back afterwards — a
 *     Maxwell-style viscoelastic skin, so a released stretch sags home
 *     instead of snapping
 *   - one global volume constraint (closed-mesh signed volume → it keeps
 *     its mass: dents bulge out elsewhere, stretches thin out)
 *   - laplacian surface tension (keeps the skin smooth, pulls tendrils in)
 *   - anchored shape matching (Müller 2005) toward the resting form, split
 *     into an elastic part (builds velocity → wobble) and a viscous part
 *     (moves position and history together → a slow, damped creep back)
 * Pointer interaction is a weighted, region-wide attachment constraint.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface SoftBodyOptions {
  subdivisions?: number;
  /** horizontal/vertical scale of the resting form (slight settle) */
  squash?: number;
  behavior?: SlimeBehavior;
}

export interface SoftBodyMetrics {
  volume: number;
  restVolume: number;
  centroid: Vec3;
  /** largest distance of any particle from its resting position */
  maxDeviation: number;
  /** axis-aligned extents */
  min: Vec3;
  max: Vec3;
  healthy: boolean;
}

interface GrabRegion {
  indices: Uint32Array;
  weights: Float32Array;
  /** particle positions relative to the anchor at grab time */
  offsets: Float32Array;
  anchor: Vec3;
  target: Vec3;
}

export const SUBSTEP = 1 / 120;
const MAX_SUBSTEPS = 5;
const ITERATIONS = 2;
/** fraction of rotation the resting frame may follow (rest keeps its pose) */
const ROTATION_FREEDOM = 0.45;
/** how strongly the resting frame stays at the origin (1 = pinned) */
const ANCHOR = 0.86;
const GRAB_PULL = 0.7;
/** inner fraction of the grab radius that is held rigidly */
const GRAB_CORE = 0.35;
const MAX_SPEED = 0.12; // body radii per substep
/** deviation (body radii) beyond which the elastic return stops growing */
const YIELD = 0.14;
const BREATH_PERIOD = 5.2;
const BREATH_AMOUNT = 0.012;

export class SoftBody {
  readonly count: number;
  readonly positions: Float32Array;
  readonly triangles: Uint32Array;
  readonly rest: Float32Array;
  readonly restVolume: number;
  /** times the body self-healed from a non-finite state (should stay 0) */
  recoveries = 0;
  /** 0 = perfectly still at rest, 1 = gentle breathing/undulation */
  idle = 1;

  private prev: Float32Array;
  private edges: Uint32Array;
  private edgeRest0: Float32Array;
  private edgeRest: Float32Array;
  private edgeLambda: Float32Array;
  private nbrStart: Uint32Array;
  private nbrIdx: Uint32Array;
  private idleScale: Float32Array;
  private volGrad: Float32Array;
  private coeffs: PhysicalCoefficients;
  private q: Quat = [0, 0, 0, 1];
  private A = new Float64Array(9);
  private R = new Float64Array(9);
  private scratch = new Float64Array(9);
  private grab: GrabRegion | null = null;
  private accumulator = 0;
  private time = 0;
  private volumeTarget: number;

  constructor(opts: SoftBodyOptions = {}) {
    const topo = buildIcosphere(opts.subdivisions ?? 4);
    const squash = opts.squash ?? 0.9;
    this.count = topo.positions.length / 3;
    this.triangles = topo.triangles;
    this.edges = topo.edges;
    this.nbrStart = topo.nbrStart;
    this.nbrIdx = topo.nbrIdx;

    // resting form: a drop that has settled a little — wider than tall,
    // with a slightly fuller base, so it never reads as a perfect sphere
    const rest = new Float32Array(topo.positions.length);
    const hScale = 1 / Math.sqrt(squash);
    for (let i = 0; i < this.count; i++) {
      const x = topo.positions[i * 3], y = topo.positions[i * 3 + 1], z = topo.positions[i * 3 + 2];
      const base = 1 + 0.06 * Math.max(0, -y) * (1 - y * y * 0.5);
      rest[i * 3] = x * hScale * base;
      rest[i * 3 + 1] = y * squash;
      rest[i * 3 + 2] = z * hScale * base;
    }
    centerInPlace(rest);
    this.rest = rest;
    this.positions = new Float32Array(rest);
    this.prev = new Float32Array(rest);

    const ne = this.edges.length / 2;
    this.edgeRest0 = new Float32Array(ne);
    this.edgeLambda = new Float32Array(ne);
    for (let e = 0; e < ne; e++) {
      const a = this.edges[e * 2] * 3, b = this.edges[e * 2 + 1] * 3;
      this.edgeRest0[e] = Math.hypot(rest[b] - rest[a], rest[b + 1] - rest[a + 1], rest[b + 2] - rest[a + 2]);
    }
    this.edgeRest = new Float32Array(this.edgeRest0);
    this.idleScale = new Float32Array(this.count).fill(1);
    this.volGrad = new Float32Array(this.count * 3);
    this.restVolume = signedVolume(rest, this.triangles);
    this.volumeTarget = this.restVolume;
    this.coeffs = deriveCoefficients(opts.behavior ?? DEFAULT_BEHAVIOR);
  }

  setBehavior(b: SlimeBehavior) {
    this.coeffs = deriveCoefficients(b);
  }

  get coefficients(): Readonly<PhysicalCoefficients> {
    return this.coeffs;
  }

  get isGrabbing() {
    return this.grab !== null;
  }

  get grabTarget(): Vec3 | null {
    return this.grab ? { ...this.grab.target } : null;
  }

  // ─── interaction ────────────────────────────────────────────────────

  /**
   * Attach the surface region around `point` (world space, on or near the
   * surface). Returns false when nothing is within reach.
   */
  beginGrab(point: Vec3, radiusScale = 1): boolean {
    const radius = this.coeffs.grabRadius * radiusScale;
    const p = this.positions;
    const idx: number[] = [], w: number[] = [], off: number[] = [];
    for (let i = 0; i < this.count; i++) {
      const dx = p[i * 3] - point.x, dy = p[i * 3 + 1] - point.y, dz = p[i * 3 + 2] - point.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d >= radius) continue;
      // a held core (plateau) with a smooth shoulder: pulls come out as a
      // rounded glob on a neck, not a cone
      const t = Math.min(1, (1 - d / radius) / (1 - GRAB_CORE));
      idx.push(i);
      w.push(t * t * (3 - 2 * t));
      off.push(dx, dy, dz);
    }
    if (idx.length === 0) return false;
    this.grab = {
      indices: new Uint32Array(idx),
      weights: new Float32Array(w),
      offsets: new Float32Array(off),
      anchor: { ...point },
      target: { ...point },
    };
    return true;
  }

  /** Move the attachment; far pulls are softly limited so it can't tear. */
  moveGrab(target: Vec3) {
    if (!this.grab) return;
    const d = Math.hypot(target.x, target.y, target.z);
    const { softReach, maxReach } = this.coeffs;
    let s = 1;
    if (d > softReach) {
      const span = maxReach - softReach;
      s = (softReach + span * Math.tanh((d - softReach) / span)) / d;
    }
    this.grab.target = { x: target.x * s, y: target.y * s, z: target.z * s };
  }

  endGrab() {
    this.grab = null;
  }

  /** Kick a region with a velocity (body radii per second) — a poke. */
  impulse(point: Vec3, dir: Vec3, speed: number, radiusScale = 1) {
    const radius = this.coeffs.grabRadius * radiusScale;
    const p = this.positions;
    const k = Math.min(speed, 12) * SUBSTEP;
    for (let i = 0; i < this.count; i++) {
      const dx = p[i * 3] - point.x, dy = p[i * 3 + 1] - point.y, dz = p[i * 3 + 2] - point.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d >= radius) continue;
      const t = 1 - d / radius;
      const s = t * t * (3 - 2 * t) * k;
      this.prev[i * 3] -= dir.x * s;
      this.prev[i * 3 + 1] -= dir.y * s;
      this.prev[i * 3 + 2] -= dir.z * s;
    }
  }

  reset() {
    this.positions.set(this.rest);
    this.prev.set(this.rest);
    this.edgeRest.set(this.edgeRest0);
    this.q = [0, 0, 0, 1];
    this.grab = null;
    this.accumulator = 0;
  }

  // ─── simulation ─────────────────────────────────────────────────────

  /** Advance by a frame of `dt` seconds using fixed substeps. */
  step(dt: number) {
    this.accumulator += Math.min(Math.max(dt, 0), MAX_SUBSTEPS * SUBSTEP);
    if (this.accumulator < SUBSTEP) return;
    this.updateIdle();
    let n = 0;
    while (this.accumulator >= SUBSTEP && n < MAX_SUBSTEPS) {
      this.substep();
      this.accumulator -= SUBSTEP;
      this.time += SUBSTEP;
      n++;
    }
    if (!this.checkHealth()) {
      this.recoveries++;
      this.reset();
    }
  }

  private substep() {
    const p = this.positions, prev = this.prev, n = this.count;
    const c = this.coeffs;
    const damp = Math.pow(c.damping60, SUBSTEP * 60);

    for (let i = 0; i < n * 3; i += 3) {
      let vx = (p[i] - prev[i]) * damp;
      let vy = (p[i + 1] - prev[i + 1]) * damp;
      let vz = (p[i + 2] - prev[i + 2]) * damp;
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (sp > MAX_SPEED) {
        const k = MAX_SPEED / sp;
        vx *= k; vy *= k; vz *= k;
      }
      prev[i] = p[i]; prev[i + 1] = p[i + 1]; prev[i + 2] = p[i + 2];
      p[i] += vx; p[i + 1] += vy; p[i + 2] += vz;
    }

    this.edgeLambda.fill(0);
    const h2 = SUBSTEP * SUBSTEP;
    for (let it = 0; it < ITERATIONS; it++) {
      this.solveEdges(c.edgeCompliance / h2);
      this.solveVolume(c.volumeCompliance / h2);
      this.applyGrab();
    }
    this.applySurfaceTension(c.surfaceTension);
    this.applyShapeMatching();
    this.applyGrab();
    this.flowEdges();
  }

  /** Plastic flow of the skin toward its current shape, and slow recovery. */
  private flowEdges() {
    const p = this.positions, E = this.edges, L = this.edgeRest, L0 = this.edgeRest0;
    const flow = 1 - Math.exp(-this.coeffs.edgeFlow * SUBSTEP);
    const back = 1 - Math.exp(-this.coeffs.edgeRecover * SUBSTEP);
    for (let e = 0; e < L.length; e++) {
      const a = E[e * 2] * 3, b = E[e * 2 + 1] * 3;
      const d = Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
      let l = L[e];
      l += (d - l) * flow;
      l += (L0[e] - l) * back;
      L[e] = Math.min(L0[e] * 4, Math.max(L0[e] * 0.4, l));
    }
  }

  private solveEdges(alpha: number) {
    const p = this.positions, E = this.edges, L = this.edgeRest, lam = this.edgeLambda;
    for (let e = 0; e < L.length; e++) {
      const a = E[e * 2] * 3, b = E[e * 2 + 1] * 3;
      const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-9) continue;
      const C = d - L[e];
      const dl = (-C - alpha * lam[e]) / (2 + alpha);
      lam[e] += dl;
      const s = dl / d;
      p[a] -= dx * s; p[a + 1] -= dy * s; p[a + 2] -= dz * s;
      p[b] += dx * s; p[b + 1] += dy * s; p[b + 2] += dz * s;
    }
  }

  private solveVolume(alpha: number) {
    const p = this.positions, T = this.triangles, g = this.volGrad;
    g.fill(0);
    let vol = 0;
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * 3, b = T[t + 1] * 3, cc = T[t + 2] * 3;
      const ax = p[a], ay = p[a + 1], az = p[a + 2];
      const bx = p[b], by = p[b + 1], bz = p[b + 2];
      const cx = p[cc], cy = p[cc + 1], cz = p[cc + 2];
      vol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
      // dV/da = (b × c)/6, etc. (factor applied below)
      g[a] += by * cz - bz * cy; g[a + 1] += bz * cx - bx * cz; g[a + 2] += bx * cy - by * cx;
      g[b] += cy * az - cz * ay; g[b + 1] += cz * ax - cx * az; g[b + 2] += cx * ay - cy * ax;
      g[cc] += ay * bz - az * by; g[cc + 1] += az * bx - ax * bz; g[cc + 2] += ax * by - ay * bx;
    }
    vol /= 6;
    let sum = 0;
    for (let i = 0; i < g.length; i++) {
      g[i] /= 6;
      sum += g[i] * g[i];
    }
    const C = vol - this.volumeTarget;
    const lambda = -C / (sum + alpha);
    for (let i = 0; i < g.length; i++) p[i] += lambda * g[i];
  }

  /**
   * Soft-selection attachment: each particle in the region is carried by
   * its falloff weight of the pointer's displacement, so a pull draws out
   * a rounded tendril and a press sinks a smooth dent (not a rigid plug).
   */
  private applyGrab() {
    const g = this.grab;
    if (!g) return;
    const p = this.positions;
    const mx = g.target.x - g.anchor.x, my = g.target.y - g.anchor.y, mz = g.target.z - g.anchor.z;
    for (let k = 0; k < g.indices.length; k++) {
      const i = g.indices[k] * 3;
      const w = g.weights[k];
      const pull = GRAB_PULL * (0.25 + 0.75 * w);
      p[i] += (g.anchor.x + g.offsets[k * 3] + mx * w - p[i]) * pull;
      p[i + 1] += (g.anchor.y + g.offsets[k * 3 + 1] + my * w - p[i + 1]) * pull;
      p[i + 2] += (g.anchor.z + g.offsets[k * 3 + 2] + mz * w - p[i + 2]) * pull;
    }
  }

  /** Umbrella-operator smoothing: the skin of the slime wants to be minimal. */
  private applySurfaceTension(k: number) {
    const p = this.positions, S = this.nbrStart, N = this.nbrIdx;
    for (let i = 0; i < this.count; i++) {
      const s0 = S[i], s1 = S[i + 1];
      let ax = 0, ay = 0, az = 0;
      for (let j = s0; j < s1; j++) {
        const o = N[j] * 3;
        ax += p[o]; ay += p[o + 1]; az += p[o + 2];
      }
      const inv = 1 / (s1 - s0);
      const o = i * 3;
      p[o] += (ax * inv - p[o]) * k;
      p[o + 1] += (ay * inv - p[o + 1]) * k;
      p[o + 2] += (az * inv - p[o + 2]) * k;
    }
  }

  private applyShapeMatching() {
    const p = this.positions, prev = this.prev, r = this.rest, n = this.count;
    const c = this.coeffs;

    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n * 3; i += 3) { cx += p[i]; cy += p[i + 1]; cz += p[i + 2]; }
    cx /= n; cy /= n; cz /= n;

    const A = this.A;
    A.fill(0);
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const px = p[o] - cx, py = p[o + 1] - cy, pz = p[o + 2] - cz;
      const rx = r[o], ry = r[o + 1], rz = r[o + 2];
      A[0] += px * rx; A[1] += py * rx; A[2] += pz * rx;
      A[3] += px * ry; A[4] += py * ry; A[5] += pz * ry;
      A[6] += px * rz; A[7] += py * rz; A[8] += pz * rz;
    }
    this.q = extractRotation(A, this.q, 4, this.scratch);
    // the resting frame follows only part of the body's rotation and
    // stays mostly anchored at the origin: pulls stretch, not translate
    const R = quatToMat3(quatScaleAngle(this.q, ROTATION_FREEDOM), this.R);
    const tx = cx * (1 - ANCHOR), ty = cy * (1 - ANCHOR), tz = cz * (1 - ANCHOR);

    const s = 1 - Math.pow(1 - c.shapeMatch60, SUBSTEP * 60);
    const se = s * c.elasticFraction;
    const sv = s * (1 - c.elasticFraction);
    const sc = this.idleScale;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const rx = r[o] * sc[i], ry = r[o + 1] * sc[i], rz = r[o + 2] * sc[i];
      const gx = R[0] * rx + R[3] * ry + R[6] * rz + tx;
      const gy = R[1] * rx + R[4] * ry + R[7] * rz + ty;
      const gz = R[2] * rx + R[5] * ry + R[8] * rz + tz;
      const dx = gx - p[o], dy = gy - p[o + 1], dz = gz - p[o + 2];
      // elastic pull yields beyond a small distance: big stretches sag home
      // at a gooey pace, small ones still spring back with a wobble
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const ke = dist > YIELD ? (se * YIELD) / dist : se;
      p[o] += dx * (ke + sv); p[o + 1] += dy * (ke + sv); p[o + 2] += dz * (ke + sv);
      // viscous share also moves the history: position changes, velocity doesn't
      prev[o] += dx * sv; prev[o + 1] += dy * sv; prev[o + 2] += dz * sv;
    }
  }

  /** Slow breathing plus a faint travelling undulation of the resting form. */
  private updateIdle() {
    const a = this.idle;
    const t = this.time;
    const breath = a * BREATH_AMOUNT * Math.sin((t * Math.PI * 2) / BREATH_PERIOD);
    const r = this.rest, sc = this.idleScale;
    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      const wave = a * 0.006 * (
        Math.sin(r[o] * 2.1 + t * 0.53) * Math.sin(r[o + 1] * 2.7 - t * 0.41) +
        Math.sin(r[o + 2] * 2.4 + t * 0.37)
      );
      sc[i] = 1 + breath + wave;
    }
    this.volumeTarget = this.restVolume * Math.pow(1 + breath, 3);
  }

  private checkHealth(): boolean {
    const p = this.positions;
    for (let i = 0; i < p.length; i += 7) {
      const v = p[i];
      if (!Number.isFinite(v) || Math.abs(v) > 12) return false;
    }
    return true;
  }

  // ─── measurement ────────────────────────────────────────────────────

  volume() {
    return signedVolume(this.positions, this.triangles);
  }

  metrics(): SoftBodyMetrics {
    const p = this.positions, r = this.rest, n = this.count;
    let cx = 0, cy = 0, cz = 0, maxDev = 0, healthy = true;
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const x = p[o], y = p[o + 1], z = p[o + 2];
      if (!Number.isFinite(x + y + z)) healthy = false;
      cx += x; cy += y; cz += z;
      min.x = Math.min(min.x, x); min.y = Math.min(min.y, y); min.z = Math.min(min.z, z);
      max.x = Math.max(max.x, x); max.y = Math.max(max.y, y); max.z = Math.max(max.z, z);
      maxDev = Math.max(maxDev, Math.hypot(x - r[o], y - r[o + 1], z - r[o + 2]));
    }
    return {
      volume: this.volume(),
      restVolume: this.restVolume,
      centroid: { x: cx / n, y: cy / n, z: cz / n },
      maxDeviation: maxDev,
      min,
      max,
      healthy,
    };
  }

  /** Index of the particle nearest to a point (for scripted interactions). */
  nearestParticle(point: Vec3): number {
    const p = this.positions;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < this.count; i++) {
      const d = (p[i * 3] - point.x) ** 2 + (p[i * 3 + 1] - point.y) ** 2 + (p[i * 3 + 2] - point.z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  particle(i: number): Vec3 {
    const p = this.positions;
    return { x: p[i * 3], y: p[i * 3 + 1], z: p[i * 3 + 2] };
  }
}

export function signedVolume(p: Float32Array, T: Uint32Array) {
  let v = 0;
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
       + p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2])
       + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

function centerInPlace(p: Float32Array) {
  const n = p.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < p.length; i += 3) { cx += p[i]; cy += p[i + 1]; cz += p[i + 2]; }
  cx /= n; cy /= n; cz /= n;
  for (let i = 0; i < p.length; i += 3) { p[i] -= cx; p[i + 1] -= cy; p[i + 2] -= cz; }
}
