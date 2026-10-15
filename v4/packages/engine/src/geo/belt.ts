/**
 * A round belt over two pulleys with parallel z axes: the two outer tangents plus the wrapped
 * arcs, swept as a closed tube.
 */
import type { Mesh, Vec3 } from './mesh.ts';
import { tube } from './tube.ts';

export interface BeltSpec {
  /** Pulley centres (same z) and the radii of the belt's centreline on them. */
  a: Vec3;
  ra: number;
  b: Vec3;
  rb: number;
  /** Radius of the belt's cross-section. */
  radius: number;
  sides?: number;
}

/** Closed centreline, counter-clockwise seen from +z, densely sampled along the arcs. */
export function beltPath({ a, ra, b, rb }: Pick<BeltSpec, 'a' | 'ra' | 'b' | 'rb'>): Vec3[] {
  if (Math.abs(a[2] - b[2]) > 1e-9) throw new Error('belt: pulleys must share a plane (same z)');
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dist = Math.hypot(dx, dy);
  if (dist <= Math.abs(ra - rb)) throw new Error('belt: pulleys overlap');
  const along = Math.atan2(dy, dx);
  // The outer tangents touch both circles where the shared normal n has u·n = (ra − rb)/D.
  const beta = Math.asin((ra - rb) / dist);
  const left = along + Math.PI / 2 - beta;
  const right = along - Math.PI / 2 + beta;
  const out: Vec3[] = [];
  const arcOn = (c: Vec3, r: number, from: number, to: number) => {
    const steps = Math.max(8, Math.ceil(((to - from) / (2 * Math.PI)) * 96));
    for (let k = 0; k <= steps; k++) {
      const t = from + ((to - from) * k) / steps;
      out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t), c[2]]);
    }
  };
  arcOn(a, ra, left, right + 2 * Math.PI); // the far side of A
  arcOn(b, rb, right, left); // the far side of B
  return out;
}

export function belt(spec: BeltSpec): Mesh {
  return tube({
    path: beltPath(spec),
    radius: spec.radius,
    sides: spec.sides ?? 16,
    bend: 0,
    closed: true,
  });
}
