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

function worldPositions({ mesh, model }: Placed): Float32Array {
  const out = new Float32Array(mesh.positions.length);
  const p = vec3.create();
  for (let i = 0; i < mesh.positions.length; i += 3) {
    vec3.transformMat4(mesh.positions.subarray(i, i + 3), model, p);
    out.set(p, i);
  }
  return out;
}

type V = [number, number, number];

/**
 * Intersection segments of two placed meshes, in world space: 6 floats (a, b) per segment.
 * Segments chain end to end along each intersection curve.
 */
export function contactSegments(a: Placed, b: Placed, eps = 1e-4): Float32Array {
  const PA = worldPositions(a);
  const PB = worldPositions(b);
  const IA = a.mesh.indices;
  const IB = b.mesh.indices;
  const nA = triangleCount(a.mesh);
  const nB = triangleCount(b.mesh);
  if (!nA || !nB) return new Float32Array(0);

  // ---- a uniform grid over B's triangles ---------------------------------------------------
  let edgeSum = 0;
  for (let t = 0; t < nB; t++) {
    for (let k = 0; k < 3; k++) {
      const i = IB[t * 3 + k]! * 3;
      const j = IB[t * 3 + ((k + 1) % 3)]! * 3;
      edgeSum += Math.hypot(PB[j]! - PB[i]!, PB[j + 1]! - PB[i + 1]!, PB[j + 2]! - PB[i + 2]!);
    }
  }
  const cell = Math.max(1e-6, (2 * edgeSum) / (nB * 3));
  const grid = new Map<string, number[]>();
  const boxOf = (P: Float32Array, I: Uint32Array, t: number) => {
    const lo: V = [Infinity, Infinity, Infinity];
    const hi: V = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 3; k++) {
      const i = I[t * 3 + k]! * 3;
      for (let c = 0; c < 3; c++) {
        lo[c] = Math.min(lo[c]!, P[i + c]!);
        hi[c] = Math.max(hi[c]!, P[i + c]!);
      }
    }
    return [lo.map((x) => Math.floor((x - eps) / cell)), hi.map((x) => Math.floor((x + eps) / cell))];
  };
  for (let t = 0; t < nB; t++) {
    const [lo, hi] = boxOf(PB, IB, t);
    for (let x = lo[0]!; x <= hi[0]!; x++)
      for (let y = lo[1]!; y <= hi[1]!; y++)
        for (let z = lo[2]!; z <= hi[2]!; z++) {
          const key = `${x},${y},${z}`;
          const list = grid.get(key);
          if (list) list.push(t);
          else grid.set(key, [t]);
        }
  }

  // ---- per-triangle planes -----------------------------------------------------------------
  const corner = (P: Float32Array, I: Uint32Array, t: number, k: number): V => {
    const i = I[t * 3 + k]! * 3;
    return [P[i]!, P[i + 1]!, P[i + 2]!];
  };
  const plane = (P: Float32Array, I: Uint32Array, t: number) => {
    const [p0, p1, p2] = [0, 1, 2].map((k) => corner(P, I, t, k)) as [V, V, V];
    const n = vec3.normalize(vec3.cross(vec3.sub(p1, p0), vec3.sub(p2, p0)));
    return { p: [p0, p1, p2] as const, n, d: vec3.dot(n, p0) };
  };

  /** The points where a triangle meets a plane (edge crossings, or vertices on it). */
  const crossing = (p: readonly [V, V, V], dist: readonly number[]) => {
    const pts: V[] = [];
    for (let k = 0; k < 3; k++) {
      const i = k;
      const j = (k + 1) % 3;
      const di = dist[i]!;
      const dj = dist[j]!;
      if (Math.abs(di) <= eps) pts.push(p[i]!);
      else if ((di > eps && dj < -eps) || (di < -eps && dj > eps)) {
        const s = di / (di - dj);
        pts.push([
          p[i]![0] + (p[j]![0] - p[i]![0]) * s,
          p[i]![1] + (p[j]![1] - p[i]![1]) * s,
          p[i]![2] + (p[j]![2] - p[i]![2]) * s,
        ]);
      }
    }
    return pts;
  };

  const out: number[] = [];
  const seen = new Int32Array(nB).fill(-1);
  const planesB = new Map<number, ReturnType<typeof plane>>();
  for (let ta = 0; ta < nA; ta++) {
    const [lo, hi] = boxOf(PA, IA, ta);
    let A: ReturnType<typeof plane> | null = null;
    for (let x = lo[0]!; x <= hi[0]!; x++)
      for (let y = lo[1]!; y <= hi[1]!; y++)
        for (let z = lo[2]!; z <= hi[2]!; z++) {
          const list = grid.get(`${x},${y},${z}`);
          if (!list) continue;
          for (const tb of list) {
            if (seen[tb] === ta) continue;
            seen[tb] = ta;
            A ??= plane(PA, IA, ta);
            let B = planesB.get(tb);
            if (!B) {
              B = plane(PB, IB, tb);
              planesB.set(tb, B);
            }
            const dA = A.p.map((q) => vec3.dot(B!.n, q) - B!.d);
            if (!(Math.max(...dA) > eps && Math.min(...dA) < -eps)) continue;
            const dB = B.p.map((q) => vec3.dot(A!.n, q) - A!.d);
            if (!(Math.max(...dB) > eps && Math.min(...dB) < -eps)) continue;
            const L = vec3.cross(A.n, B.n);
            if (vec3.length(L) < 1e-9) continue;
            const along = (q: V) => vec3.dot(L, q);
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
            if (along(end) - along(start) <= eps * vec3.length(L)) continue;
            out.push(...start, ...end);
          }
        }
  }
  return new Float32Array(out);
}
