/**
 * Minimal quaternion helpers for shape matching. Quaternions are plain
 * [x, y, z, w] tuples so the solver stays allocation-free.
 */
export type Quat = [number, number, number, number];

/** Column-major 3x3 matrix as 9 numbers. */
export type Mat3 = Float64Array;

export function quatToMat3(q: Quat, out: Mat3): Mat3 {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  out[0] = 1 - 2 * (yy + zz); out[1] = 2 * (xy + wz); out[2] = 2 * (xz - wy);
  out[3] = 2 * (xy - wz); out[4] = 1 - 2 * (xx + zz); out[5] = 2 * (yz + wx);
  out[6] = 2 * (xz + wy); out[7] = 2 * (yz - wx); out[8] = 1 - 2 * (xx + yy);
  return out;
}

function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function quatNormalize(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/**
 * Rotational part of a deformation matrix A, warm-started from q.
 * Müller et al., "A Robust Method to Extract the Rotational Part of
 * Deformations" (MIG 2016). Stable even for degenerate/inverted A.
 */
export function extractRotation(A: Mat3, q: Quat, iterations: number, scratch: Mat3): Quat {
  let cur = q;
  for (let it = 0; it < iterations; it++) {
    const R = quatToMat3(cur, scratch);
    let ox = 0, oy = 0, oz = 0, dot = 0;
    for (let c = 0; c < 3; c++) {
      const rx = R[c * 3], ry = R[c * 3 + 1], rz = R[c * 3 + 2];
      const ax = A[c * 3], ay = A[c * 3 + 1], az = A[c * 3 + 2];
      ox += ry * az - rz * ay;
      oy += rz * ax - rx * az;
      oz += rx * ay - ry * ax;
      dot += rx * ax + ry * ay + rz * az;
    }
    const inv = 1 / (Math.abs(dot) + 1e-9);
    ox *= inv; oy *= inv; oz *= inv;
    const angle = Math.hypot(ox, oy, oz);
    if (angle < 1e-9) break;
    const s = Math.sin(angle / 2) / angle;
    cur = quatNormalize(quatMul([ox * s, oy * s, oz * s, Math.cos(angle / 2)], cur));
  }
  return cur;
}

/** Shortest-arc blend between identity and q by t. */
export function quatScaleAngle(q: Quat, t: number): Quat {
  const w = Math.min(1, Math.max(-1, q[3]));
  const sign = w < 0 ? -1 : 1;
  const angle = 2 * Math.acos(Math.abs(w));
  const sinHalf = Math.sqrt(Math.max(0, 1 - w * w));
  if (sinHalf < 1e-6) return [0, 0, 0, 1];
  const a = angle * t;
  const k = (Math.sin(a / 2) / sinHalf) * sign;
  return [q[0] * k, q[1] * k, q[2] * k, Math.cos(a / 2)];
}
