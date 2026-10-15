/**
 * Contact lines: where one solid pierces another, the kit draws the intersection curve. Flush
 * contacts need nothing (the touching faces already end in outlines), so only proper crossings
 * count: each triangle must have vertices strictly on both sides of the other's plane, which
 * rejects coplanar and merely touching pairs.
 */
import { vec3 } from 'wgpu-matrix';
import { type Mesh, triangleCount } from './mesh.ts';

export interface Placed {
  mesh: Mesh;
  /** Model → world (column-major mat4). */
  model: Float32Array;
}

const isIdentity = (m: Float32Array) =>
  m.every((v, i) => v === (i % 5 === 0 ? 1 : 0));

function worldPositions({ mesh, model }: Placed): Float32Array {
  if (isIdentity(model)) return mesh.positions;
  const out = new Float32Array(mesh.positions.length);
  const p = vec3.create();
  for (let i = 0; i < mesh.positions.length; i += 3) {
    vec3.transformMat4(mesh.positions.subarray(i, i + 3), model, p);
    out.set(p, i);
  }
  return out;
}

type V = [number, number, number];

/** Grid cells are packed into one exact number: 17 bits per axis, cells within ±2^16. */
const CELL_BIAS = 65536;
const CELL_SPAN = 131072;
const cellKey = (x: number, y: number, z: number) => {
  if (x < -CELL_BIAS || x >= CELL_BIAS || y < -CELL_BIAS || y >= CELL_BIAS || z < -CELL_BIAS || z >= CELL_BIAS) {
    throw new Error(`contacts: grid cell (${x}, ${y}, ${z}) out of range`);
  }
  return ((x + CELL_BIAS) * CELL_SPAN + (y + CELL_BIAS)) * CELL_SPAN + (z + CELL_BIAS);
};

/** A triangle's plane: corners (9 floats), unit normal, offset. */
interface Plane {
  p: Float64Array;
  n: [number, number, number];
  d: number;
}

function planeOf(P: Float32Array, I: Uint32Array, t: number): Plane {
  const p = new Float64Array(9);
  for (let k = 0; k < 3; k++) {
    const i = I[t * 3 + k]! * 3;
    p[k * 3] = P[i]!;
    p[k * 3 + 1] = P[i + 1]!;
    p[k * 3 + 2] = P[i + 2]!;
  }
  const n = vec3.normalize(vec3.cross([p[3]! - p[0]!, p[4]! - p[1]!, p[5]! - p[2]!], [p[6]! - p[0]!, p[7]! - p[1]!, p[8]! - p[2]!]));
  const nn: [number, number, number] = [n[0]!, n[1]!, n[2]!];
  return { p, n: nn, d: nn[0] * p[0]! + nn[1] * p[1]! + nn[2] * p[2]! };
}

/**
 * Intersection segments of two placed meshes, in world space: 6 floats (a, b) per segment.
 * Segments chain end to end along each intersection curve. With `normals`, B's face normal at
 * each segment is pushed there (3 floats per segment): the surface the line is drawn on.
 */
export function contactSegments(a: Placed, b: Placed, eps = 1e-4, normals?: number[]): Float32Array {
  const PA = worldPositions(a);
  const PB = worldPositions(b);
  const IA = a.mesh.indices;
  const IB = b.mesh.indices;
  const nA = triangleCount(a.mesh);
  const nB = triangleCount(b.mesh);
  if (!nA || !nB) return new Float32Array(0);

  // ---- a uniform grid over B's triangles near A ---------------------------------------------
  // Only B triangles that overlap A's bounding box can cross A (a rib touches a small patch of
  // a big bowl), so the rest are never gridded.
  const aLo = [Infinity, Infinity, Infinity];
  const aHi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < PA.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      if (PA[i + c]! < aLo[c]!) aLo[c] = PA[i + c]!;
      if (PA[i + c]! > aHi[c]!) aHi[c] = PA[i + c]!;
    }
  }
  const near: number[] = [];
  for (let t = 0; t < nB; t++) {
    let inside = true;
    for (let c = 0; c < 3 && inside; c++) {
      const v0 = PB[IB[t * 3]! * 3 + c]!;
      const v1 = PB[IB[t * 3 + 1]! * 3 + c]!;
      const v2 = PB[IB[t * 3 + 2]! * 3 + c]!;
      if (Math.max(v0, v1, v2) < aLo[c]! - eps || Math.min(v0, v1, v2) > aHi[c]! + eps) inside = false;
    }
    if (inside) near.push(t);
  }
  if (!near.length) return new Float32Array(0);
  let edgeSum = 0;
  for (const t of near) {
    for (let k = 0; k < 3; k++) {
      const i = IB[t * 3 + k]! * 3;
      const j = IB[t * 3 + ((k + 1) % 3)]! * 3;
      edgeSum += Math.hypot(PB[j]! - PB[i]!, PB[j + 1]! - PB[i + 1]!, PB[j + 2]! - PB[i + 2]!);
    }
  }
  const cell = Math.max(1e-6, (2 * edgeSum) / (near.length * 3));
  const grid = new Map<number, number[]>();
  const lo = new Int32Array(3);
  const hi = new Int32Array(3);
  const boxOf = (P: Float32Array, I: Uint32Array, t: number) => {
    for (let c = 0; c < 3; c++) {
      const v0 = P[I[t * 3]! * 3 + c]!;
      const v1 = P[I[t * 3 + 1]! * 3 + c]!;
      const v2 = P[I[t * 3 + 2]! * 3 + c]!;
      lo[c] = Math.floor((Math.min(v0, v1, v2) - eps) / cell);
      hi[c] = Math.floor((Math.max(v0, v1, v2) + eps) / cell);
    }
  };
  for (const t of near) {
    boxOf(PB, IB, t);
    for (let x = lo[0]!; x <= hi[0]!; x++)
      for (let y = lo[1]!; y <= hi[1]!; y++)
        for (let z = lo[2]!; z <= hi[2]!; z++) {
          const key = cellKey(x, y, z);
          const list = grid.get(key);
          if (list) list.push(t);
          else grid.set(key, [t]);
        }
  }

  // ---- triangle pairs ----------------------------------------------------------------------
  /** Signed distances of a triangle's corners to a plane. */
  const dist = (p: Float64Array, q: Plane, out: Float64Array) => {
    for (let k = 0; k < 3; k++) out[k] = q.n[0] * p[k * 3]! + q.n[1] * p[k * 3 + 1]! + q.n[2] * p[k * 3 + 2]! - q.d;
  };
  const straddles = (dd: Float64Array) =>
    Math.max(dd[0]!, dd[1]!, dd[2]!) > eps && Math.min(dd[0]!, dd[1]!, dd[2]!) < -eps;

  /** The points where a triangle meets a plane (edge crossings, or vertices on it). */
  const crossing = (p: Float64Array, dd: Float64Array) => {
    const pts: V[] = [];
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const di = dd[i]!;
      const dj = dd[j]!;
      if (Math.abs(di) <= eps) pts.push([p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!]);
      else if ((di > eps && dj < -eps) || (di < -eps && dj > eps)) {
        const s = di / (di - dj);
        pts.push([
          p[i * 3]! + (p[j * 3]! - p[i * 3]!) * s,
          p[i * 3 + 1]! + (p[j * 3 + 1]! - p[i * 3 + 1]!) * s,
          p[i * 3 + 2]! + (p[j * 3 + 2]! - p[i * 3 + 2]!) * s,
        ]);
      }
    }
    return pts;
  };

  const out: number[] = [];
  const seen = new Int32Array(nB).fill(-1);
  const planesB: (Plane | undefined)[] = new Array(nB);
  const dA = new Float64Array(3);
  const dB = new Float64Array(3);
  for (let ta = 0; ta < nA; ta++) {
    boxOf(PA, IA, ta);
    const [x0, y0, z0] = [lo[0]!, lo[1]!, lo[2]!];
    const [x1, y1, z1] = [hi[0]!, hi[1]!, hi[2]!];
    let A: Plane | null = null;
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const list = grid.get(cellKey(x, y, z));
          if (!list) continue;
          for (const tb of list) {
            if (seen[tb] === ta) continue;
            seen[tb] = ta;
            A ??= planeOf(PA, IA, ta);
            const B = (planesB[tb] ??= planeOf(PB, IB, tb));
            dist(A.p, B, dA);
            if (!straddles(dA)) continue;
            dist(B.p, A, dB);
            if (!straddles(dB)) continue;
            const L = vec3.cross(A.n, B.n);
            const lenL = vec3.length(L);
            if (lenL < 1e-9) continue;
            const along = (q: V) => L[0]! * q[0] + L[1]! * q[1] + L[2]! * q[2];
            const range = (pts: V[]) => {
              let min = pts[0]!;
              let max = pts[0]!;
              for (const q of pts) {
                if (along(q) < along(min)) min = q;
                if (along(q) > along(max)) max = q;
              }
              return [min, max] as const;
            };
            const pa = crossing(A.p, dA);
            const pb = crossing(B.p, dB);
            if (pa.length < 2 || pb.length < 2) continue;
            const [a0, a1] = range(pa);
            const [b0, b1] = range(pb);
            const start = along(a0) > along(b0) ? a0 : b0;
            const end = along(a1) < along(b1) ? a1 : b1;
            if (along(end) - along(start) <= eps * lenL) continue;
            out.push(...start, ...end);
            normals?.push(...B.n);
          }
        }
  }
  return new Float32Array(out);
}
