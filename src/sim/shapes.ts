/**
 * Resting forms for the one body. Every shape is built from the same unit
 * icosphere (same particles, same topology), so the body can morph between
 * them. Shapes may also carry a printed label: per-particle (u, v, mask),
 * fixed to the material, so the print squishes along with the surface.
 */
export type ShapeId = 'drop' | 'stick';

export interface RestShape {
  positions: Float32Array;
  /** per particle: label u, label v, label coverage 0..1 */
  label: Float32Array;
}

/** Half-extents of the butter stick (length, height, depth), body radii. */
export const STICK_HALF = { x: 1.45, y: 0.47, z: 0.5 };
/** Superellipsoid exponent: higher = squarer edges. ~5 reads as a soft-cornered stick. */
const STICK_EXPONENT = 6;
/** Turn the stick a little so one end shows, like a product shot... */
export const STICK_YAW = -0.38;
/** ...and tip its top toward the camera so the top face shows too. */
export const STICK_PITCH = 0.28;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Vertex adjacency (CSR), used to even out particle spacing on box-like shapes. */
export interface Adjacency {
  nbrStart: Uint32Array;
  nbrIdx: Uint32Array;
}

export function buildRestShape(id: ShapeId, unit: Float32Array, adj?: Adjacency): RestShape {
  return id === 'stick' ? buildStick(unit, adj) : buildDrop(unit);
}

/** A drop that has settled a little — wider than tall, fuller at the base. */
function buildDrop(unit: Float32Array): RestShape {
  const n = unit.length / 3;
  const positions = new Float32Array(unit.length);
  const squash = 0.9;
  const hScale = 1 / Math.sqrt(squash);
  for (let i = 0; i < n; i++) {
    const x = unit[i * 3], y = unit[i * 3 + 1], z = unit[i * 3 + 2];
    const base = 1 + 0.06 * Math.max(0, -y) * (1 - y * y * 0.5);
    positions[i * 3] = x * hScale * base;
    positions[i * 3 + 1] = y * squash;
    positions[i * 3 + 2] = z * hScale * base;
  }
  centerInPlace(positions);
  return { positions, label: new Float32Array(n * 3) };
}

/**
 * A stick of butter: a soft-cornered box (superellipsoid). Particles keep
 * the ellipsoid parametrisation of the sphere, then are pushed out radially
 * onto the box, so they stay evenly spread along the long sides instead of
 * bunching at the ends. The front face (+z) carries the printed wrapper.
 */
function buildStick(unit: Float32Array, adj?: Adjacency): RestShape {
  const n = unit.length / 3;
  const positions = new Float32Array(unit.length);
  const label = new Float32Array(n * 3);
  const { x: a, y: b, z: c } = STICK_HALF;
  const e = STICK_EXPONENT;
  const cy = Math.cos(STICK_YAW), sy = Math.sin(STICK_YAW);
  const cp = Math.cos(STICK_PITCH), sp = Math.sin(STICK_PITCH);
  const local = new Float32Array(unit.length);
  for (let i = 0; i < n; i++) {
    const x = unit[i * 3], y = unit[i * 3 + 1], z = unit[i * 3 + 2];
    local[i * 3] = a * x;
    local[i * 3 + 1] = b * y;
    local[i * 3 + 2] = c * z;
    projectToStick(local, i);
  }
  if (adj) relaxOnStick(local, adj);
  for (let i = 0; i < n; i++) {
    const lx = local[i * 3], ly = local[i * 3 + 1], lz = local[i * 3 + 2];
    label[i * 3] = (lx + a) / (2 * a);
    label[i * 3 + 1] = (ly + b) / (2 * b);
    label[i * 3 + 2] = smoothstep(0.8, 0.95, lz / c);
    const wx = lx * cy + lz * sy;
    const wz = -lx * sy + lz * cy;
    positions[i * 3] = wx;
    positions[i * 3 + 1] = ly * cp - wz * sp;
    positions[i * 3 + 2] = ly * sp + wz * cp;
  }
  centerInPlace(positions);
  return { positions, label };
}

/** Push a point radially onto the soft-cornered box surface. */
function projectToStick(p: Float32Array, i: number) {
  const { x: a, y: b, z: c } = STICK_HALF;
  const e = STICK_EXPONENT;
  const o = i * 3;
  const f = Math.abs(p[o] / a) ** e + Math.abs(p[o + 1] / b) ** e + Math.abs(p[o + 2] / c) ** e;
  const s = Math.pow(f, -1 / e);
  p[o] *= s;
  p[o + 1] *= s;
  p[o + 2] *= s;
}

/**
 * Even out the particles over the stick's surface: Laplacian relaxation,
 * re-projected onto the surface every pass. Stretching a sphere's mesh into a
 * 3:1 box leaves long thin triangles on the sides and crowded ones at the
 * rims, which shows up as ripples and lumpy ends; after relaxing, triangles
 * are near-uniform everywhere. Topology is untouched.
 */
const RELAX_PASSES = 60;
const RELAX_STEP = 0.5;

function relaxOnStick(p: Float32Array, { nbrStart, nbrIdx }: Adjacency) {
  const n = p.length / 3;
  const next = new Float32Array(p.length);
  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    for (let i = 0; i < n; i++) {
      const s0 = nbrStart[i], s1 = nbrStart[i + 1];
      let ax = 0, ay = 0, az = 0;
      for (let j = s0; j < s1; j++) {
        const o = nbrIdx[j] * 3;
        ax += p[o]; ay += p[o + 1]; az += p[o + 2];
      }
      const inv = 1 / (s1 - s0), o = i * 3;
      next[o] = p[o] + (ax * inv - p[o]) * RELAX_STEP;
      next[o + 1] = p[o + 1] + (ay * inv - p[o + 1]) * RELAX_STEP;
      next[o + 2] = p[o + 2] + (az * inv - p[o + 2]) * RELAX_STEP;
    }
    p.set(next);
    for (let i = 0; i < n; i++) projectToStick(p, i);
  }
}

export function centerInPlace(p: Float32Array) {
  const n = p.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < p.length; i += 3) { cx += p[i]; cy += p[i + 1]; cz += p[i + 2]; }
  cx /= n; cy /= n; cz /= n;
  for (let i = 0; i < p.length; i += 3) { p[i] -= cx; p[i + 1] -= cy; p[i + 2] -= cz; }
}
