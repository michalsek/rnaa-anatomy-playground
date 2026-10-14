/**
 * Shared authoring helpers for every machine (lifted from the centrifuge's `dims.ts`): vectors,
 * v2 frames → placements, turned discs, boxes from corners, rings, screws. Plain module (no
 * components: the Fast Refresh boundary rule).
 */
import type { DotSpec, ProfilePoint, SegmentSpec, Vec3 } from '@anatomy/engine';

export type V3 = [number, number, number];

export const DEG = Math.PI / 180;
export const dir = (deg: number): V3 => [Math.cos(deg * DEG), Math.sin(deg * DEG), 0];
export const polar = (deg: number, r: number, z: number): V3 => [
  r * Math.cos(deg * DEG),
  r * Math.sin(deg * DEG),
  z,
];
export const cross = (a: Vec3, b: Vec3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const unit = (a: Vec3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const add = (a: Vec3, b: Vec3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];

// ---- frames ------------------------------------------------------------------------------------

export interface Placed {
  position: V3;
  /** Euler degrees, applied X then Y then Z (the blocks' convention). */
  rotation: V3;
}

/**
 * The placement for a v2 frame: model z = a, model x = u, model y = a × u. Throws on a mirrored
 * frame (v = −a × u): mirror the polygon instead (see notes/M3-plan.md §0).
 */
export function placeFrame(o: Vec3, a: Vec3, u: Vec3, v?: Vec3): Placed {
  const z = unit(a);
  const x = unit(u);
  const y = cross(z, x);
  if (v && dot(cross(x, unit(v)), z) < 0) throw new Error('placeFrame: mirrored frame');
  // R = Rz(c) · Ry(b) · Rx(a) with columns x, y, z.
  const b = Math.asin(Math.max(-1, Math.min(1, -x[2])));
  let ra: number;
  let rc: number;
  if (Math.abs(Math.cos(b)) > 1e-6) {
    ra = Math.atan2(y[2], z[2]);
    rc = Math.atan2(x[1], x[0]);
  } else {
    ra = 0;
    rc = Math.atan2(-y[0], y[1]);
  }
  return { position: [o[0], o[1], o[2]], rotation: [ra / DEG, b / DEG, rc / DEG] };
}

/** A frame along `axis` at `o` (v2 `frameAlong`; the roll about the axis doesn't matter). */
export const frameAlong = (o: Vec3, axis: Vec3) => {
  const a = unit(axis);
  const helper: Vec3 = Math.abs(a[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  return placeFrame(o, a, cross(helper, a));
};

// ---- profiles, boxes, marks ------------------------------------------------------------------

/** A solid disc along model z: v2 `turned(F, [[s0, r], [s1, r]])`. */
export const disc = (r: number, s0: number, s1: number): ProfilePoint[] => [
  [0, s0],
  [r, s0],
  [r, s1],
  [0, s1],
];

/** Box from two corners (v2 `ctx.box`). */
export const corners = (lo: Vec3, hi: Vec3) => ({
  size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] as V3,
  center: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2] as V3,
});

// ---- marks -------------------------------------------------------------------------------------

/** A circle as a closed polyline (12+ points), on a face with normal `normal`. */
export function ring(center: Vec3, r: number, n = 12, normal: Vec3 = [0, 0, 1]): V3[] {
  const a = unit(normal);
  const helper: Vec3 = Math.abs(a[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const u = unit(cross(cross(a, helper), a));
  const v = cross(a, u);
  return Array.from({ length: n }, (_, k) => {
    const t = (2 * Math.PI * k) / n;
    return add(center, add(scale(u, r * Math.cos(t)), scale(v, r * Math.sin(t))));
  });
}

/** v2 `ctx.screws`: a lo ring (12 segments) and a dot per point, on a horizontal face at z. */
export function screws(points: readonly (readonly [number, number])[], z: number, ringR: number, size: number) {
  const dots: DotSpec[] = points.map(([x, y]) => ({ at: [x, y, z], size, normal: [0, 0, 1] }));
  const segments: SegmentSpec[] = points.flatMap(([x, y]) => closed(ring([x, y, z], ringR), [0, 0, 1], 'lo'));
  return { dots, segments };
}

/** Segments of a closed polyline. */
export function closed(points: readonly Vec3[], normal: Vec3, tone: SegmentSpec['tone'] = 'lo'): SegmentSpec[] {
  return points.map((a, i) => ({ a, b: points[(i + 1) % points.length]!, normal, ...(tone && { tone }) }));
}

