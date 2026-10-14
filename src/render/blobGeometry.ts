import * as THREE from 'three';
import type { SoftBody } from '../sim/softBody.ts';

/**
 * Smooth render surface for the soft body. Each simulated triangle is split
 * into four, with the new edge vertices placed on the curved PN-triangle
 * patch (Vlachos et al. 2001) implied by the simulated normals — so the
 * silhouette stays round at 4x the triangle count without simulating more
 * particles. Also carries a per-vertex `aStrain` attribute (how stretched
 * the skin is locally) that the material uses to thin the film colour.
 */
export class BlobGeometry {
  readonly geometry = new THREE.BufferGeometry();
  private simNormals: Float32Array;
  private simStrain: Float32Array;
  private strainCount: Float32Array;
  private triEdges: Uint32Array;
  private edges: Uint32Array;
  private edgeRest: Float32Array;
  private positions: Float32Array;
  private strain: Float32Array;
  private posAttr: THREE.BufferAttribute;
  private strainAttr: THREE.BufferAttribute;
  private labelAttr: THREE.BufferAttribute;
  private labelVersion = -1;

  constructor(private body: SoftBody) {
    const n = body.count;
    const T = body.triangles;
    const edgeIndex = new Map<number, number>();
    const edges: number[] = [];
    const triEdges = new Uint32Array(T.length);
    for (let t = 0; t < T.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = T[t + k], b = T[t + ((k + 1) % 3)];
        const key = a < b ? a * 1_000_003 + b : b * 1_000_003 + a;
        let e = edgeIndex.get(key);
        if (e === undefined) {
          e = edges.length / 2;
          edges.push(a, b);
          edgeIndex.set(key, e);
        }
        triEdges[t + k] = e;
      }
    }
    this.edges = new Uint32Array(edges);
    this.triEdges = triEdges;
    const ne = this.edges.length / 2;
    this.edgeRest = new Float32Array(ne);
    const r = body.rest;
    for (let e = 0; e < ne; e++) {
      const a = this.edges[e * 2] * 3, b = this.edges[e * 2 + 1] * 3;
      this.edgeRest[e] = Math.hypot(r[b] - r[a], r[b + 1] - r[a + 1], r[b + 2] - r[a + 2]);
    }

    // refined triangles: corners keep their indices, edge midpoints follow
    const index = new Uint32Array(T.length * 4);
    for (let t = 0, o = 0; t < T.length; t += 3) {
      const a = T[t], b = T[t + 1], c = T[t + 2];
      const ab = n + triEdges[t], bc = n + triEdges[t + 1], ca = n + triEdges[t + 2];
      index.set([a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca], o);
      o += 12;
    }

    const total = n + ne;
    this.positions = new Float32Array(total * 3);
    this.strain = new Float32Array(total);
    this.simNormals = new Float32Array(n * 3);
    this.simStrain = new Float32Array(n);
    this.strainCount = new Float32Array(n);
    this.posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.strainAttr = new THREE.BufferAttribute(this.strain, 1).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('aStrain', this.strainAttr);
    // printed label coordinates ride on the material: they only change when
    // the body's shape (and so its label) changes
    this.labelAttr = new THREE.BufferAttribute(new Float32Array(total * 3), 3);
    this.geometry.setAttribute('aLabel', this.labelAttr);
    this.update();
  }

  /** Copy the body's per-particle label to the refined mesh (midpoints average). */
  private syncLabel() {
    const body = this.body;
    if (this.labelVersion === body.labelVersion) return;
    this.labelVersion = body.labelVersion;
    const L = body.label, n = body.count, E = this.edges;
    const out = this.labelAttr.array as Float32Array;
    out.set(L);
    for (let e = 0; e < E.length / 2; e++) {
      const a = E[e * 2] * 3, b = E[e * 2 + 1] * 3, o = (n + e) * 3;
      out[o] = (L[a] + L[b]) * 0.5;
      out[o + 1] = (L[a + 1] + L[b + 1]) * 0.5;
      out[o + 2] = (L[a + 2] + L[b + 2]) * 0.5;
    }
    this.labelAttr.needsUpdate = true;
  }

  update() {
    this.syncLabel();
    const body = this.body;
    const p = body.positions, n = body.count;
    this.computeSimNormals();
    this.computeSimStrain();

    const out = this.positions, N = this.simNormals, E = this.edges, S = this.simStrain;
    out.set(p);
    this.strain.set(S);
    for (let e = 0; e < E.length / 2; e++) {
      const ia = E[e * 2], ib = E[e * 2 + 1];
      const a = ia * 3, b = ib * 3;
      const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
      // PN edge midpoint: (Pa + Pb)/2 - (w_ab Na + w_ba Nb)/8
      const wab = dx * N[a] + dy * N[a + 1] + dz * N[a + 2];
      const wba = -(dx * N[b] + dy * N[b + 1] + dz * N[b + 2]);
      const o = (n + e) * 3;
      out[o] = (p[a] + p[b]) * 0.5 - (wab * N[a] + wba * N[b]) * 0.125;
      out[o + 1] = (p[a + 1] + p[b + 1]) * 0.5 - (wab * N[a + 1] + wba * N[b + 1]) * 0.125;
      out[o + 2] = (p[a + 2] + p[b + 2]) * 0.5 - (wab * N[a + 2] + wba * N[b + 2]) * 0.125;
      this.strain[n + e] = (S[ia] + S[ib]) * 0.5;
    }
    this.posAttr.needsUpdate = true;
    this.strainAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }

  private computeSimNormals() {
    const p = this.body.positions, T = this.body.triangles, N = this.simNormals;
    N.fill(0);
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      N[a] += nx; N[a + 1] += ny; N[a + 2] += nz;
      N[b] += nx; N[b + 1] += ny; N[b + 2] += nz;
      N[c] += nx; N[c + 1] += ny; N[c + 2] += nz;
    }
    for (let i = 0; i < N.length; i += 3) {
      const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
      N[i] /= l; N[i + 1] /= l; N[i + 2] /= l;
    }
  }

  /** Average edge elongation around each particle: 0 at rest, ~1 when doubled. */
  private computeSimStrain() {
    const p = this.body.positions, E = this.edges, L = this.edgeRest, S = this.simStrain;
    const counts = this.strainCount;
    S.fill(0);
    counts.fill(0);
    for (let e = 0; e < L.length; e++) {
      const ia = E[e * 2], ib = E[e * 2 + 1];
      const a = ia * 3, b = ib * 3;
      const d = Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
      const s = Math.max(0, d / L[e] - 1);
      S[ia] += s; S[ib] += s;
      counts[ia]++; counts[ib]++;
    }
    for (let i = 0; i < S.length; i++) S[i] = Math.min(2, S[i] / Math.max(1, counts[i]));
  }

  dispose() {
    this.geometry.dispose();
  }
}
