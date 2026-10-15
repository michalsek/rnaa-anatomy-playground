/**
 * E7: a helix path for the Tube (coil springs). Points from `from` to `to` round the axis between
 * them, `r` out from it, `turns` full turns. The angle starts at `across` (a direction across the
 * axis; default: up projected off the axis, or +x for a vertical axis) and turns right-handed
 * about the axis.
 */
import type { Vec3 } from './mesh.ts';

export interface HelixSpec {
  from: Vec3;
  to: Vec3;
  r: number;
  turns: number;
  /** Points per turn (default 16). */
  steps?: number;
  /** Start angle, radians (default 0). */
  phase?: number;
  across?: Vec3;
}

const sub = (a: Vec3, b: Vec3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): [number, number, number] => {
  const l = Math.hypot(a[0], a[1], a[2]);
  if (!(l > 0)) throw new Error('helix: zero vector');
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function helix(o: HelixSpec): [number, number, number][] {
  if (!(o.r > 0 && o.turns > 0)) throw new Error('helix: r and turns must be positive');
  const axis = sub(o.to, o.from);
  const a = unit(axis);
  const hint: Vec3 = o.across ?? (Math.abs(a[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]);
  const u = unit(sub(hint, [a[0] * dot(hint, a), a[1] * dot(hint, a), a[2] * dot(hint, a)]));
  const v = cross(a, u);
  const n = Math.max(2, Math.ceil(o.turns * (o.steps ?? 16)));
  const phase = o.phase ?? 0;
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = k / n;
    const ang = phase + 2 * Math.PI * o.turns * t;
    const c = Math.cos(ang) * o.r;
    const s = Math.sin(ang) * o.r;
    return [
      o.from[0] + axis[0] * t + u[0] * c + v[0] * s,
      o.from[1] + axis[1] * t + u[1] * c + v[1] * s,
      o.from[2] + axis[2] * t + u[2] * c + v[2] * s,
    ];
  });
}
