/**
 * Indexed icosphere with the topology tables the soft body needs:
 * unique edges and a CSR vertex-neighbour list. Pure data — no Three.js —
 * so the simulation runs (and is unit-tested) outside the browser.
 */
export interface SphereTopology {
  positions: Float32Array;
  triangles: Uint32Array;
  edges: Uint32Array; // [a0, b0, a1, b1, ...]
  /** CSR: neighbours of vertex i are nbrIdx[nbrStart[i] .. nbrStart[i + 1]) */
  nbrStart: Uint32Array;
  nbrIdx: Uint32Array;
}

const T = (1 + Math.sqrt(5)) / 2;

const BASE_VERTS = [
  [-1, T, 0], [1, T, 0], [-1, -T, 0], [1, -T, 0],
  [0, -1, T], [0, 1, T], [0, -1, -T], [0, 1, -T],
  [T, 0, -1], [T, 0, 1], [-T, 0, -1], [-T, 0, 1],
];

const BASE_TRIS = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

const edgeKey = (a: number, b: number) => (a < b ? a * 1_000_003 + b : b * 1_000_003 + a);

export function buildIcosphere(subdivisions: number): SphereTopology {
  const verts: number[][] = BASE_VERTS.map(normalize);
  let tris = BASE_TRIS.map((t) => [...t]);

  for (let s = 0; s < subdivisions; s++) {
    const midCache = new Map<number, number>();
    const mid = (a: number, b: number) => {
      const key = edgeKey(a, b);
      const hit = midCache.get(key);
      if (hit !== undefined) return hit;
      const va = verts[a], vb = verts[b];
      verts.push(normalize([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2]));
      midCache.set(key, verts.length - 1);
      return verts.length - 1;
    };
    const next: number[][] = [];
    for (const [a, b, c] of tris) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    tris = next;
  }

  const positions = new Float32Array(verts.flat());
  const triangles = new Uint32Array(tris.flat());
  return { positions, triangles, ...buildAdjacency(verts.length, triangles) };
}

export function buildAdjacency(vertexCount: number, triangles: Uint32Array) {
  const seen = new Set<number>();
  const edgeList: number[] = [];
  const nbrSets: number[][] = Array.from({ length: vertexCount }, () => []);
  for (let t = 0; t < triangles.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = triangles[t + k], b = triangles[t + ((k + 1) % 3)];
      const key = edgeKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      edgeList.push(a, b);
      nbrSets[a].push(b);
      nbrSets[b].push(a);
    }
  }
  const nbrStart = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < vertexCount; i++) nbrStart[i + 1] = nbrStart[i] + nbrSets[i].length;
  const nbrIdx = new Uint32Array(nbrStart[vertexCount]);
  nbrSets.forEach((list, i) => nbrIdx.set(list, nbrStart[i]));
  return { edges: new Uint32Array(edgeList), nbrStart, nbrIdx };
}

function normalize(v: number[]) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
