/** Helpers that author free marks (bolt circles, rules, wires) as plain specs. */
import type { LineTone } from '../palette/tokens.ts';
import type { DotSpec, DotTone, SegmentSpec } from '../scene/store.ts';
import type { Vec3 } from './mesh.ts';

type V = [number, number, number];
const cross = (a: Vec3, b: Vec3): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): V => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * `count` dots on a circle of radius `r` about `center`, in the plane normal to `axis` (the dots
 * face along it: they hide when it faces away and fade toward the limb). `phase` in degrees,
 * measured from the plane's first axis (x for a z axis).
 */
export function boltCircle(o: {
  center: Vec3;
  axis?: Vec3;
  r: number;
  count: number;
  phase?: number;
  size?: number;
  tone?: DotTone;
  /** Use the radial direction as the dots' normal (bolts on a cylinder's side). */
  radial?: boolean;
}): DotSpec[] {
  const axis = unit(o.axis ?? [0, 0, 1]);
  const helper: Vec3 = Math.abs(axis[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const u = unit(cross(cross(axis, helper), axis));
  const v = cross(axis, u);
  return Array.from({ length: o.count }, (_, k) => {
    const a = (((o.phase ?? 0) + (360 * k) / o.count) * Math.PI) / 180;
    const dir: V = [0, 1, 2].map((i) => Math.cos(a) * u[i]! + Math.sin(a) * v[i]!) as V;
    const at: V = [0, 1, 2].map((i) => o.center[i]! + o.r * dir[i]!) as V;
    return {
      at,
      normal: o.radial ? dir : axis,
      ...(o.size !== undefined && { size: o.size }),
      ...(o.tone !== undefined && { tone: o.tone }),
    };
  });
}

/** Consecutive segments through `points` (closed: back to the first). */
export function polyline(
  points: readonly Vec3[],
  o: { normal?: Vec3; width?: number; tone?: LineTone; closed?: boolean } = {},
): SegmentSpec[] {
  const out: SegmentSpec[] = [];
  const n = o.closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    out.push({
      a: points[i]!,
      b: points[(i + 1) % points.length]!,
      ...(o.normal !== undefined && { normal: o.normal }),
      ...(o.width !== undefined && { width: o.width }),
      ...(o.tone !== undefined && { tone: o.tone }),
    });
  }
  return out;
}
