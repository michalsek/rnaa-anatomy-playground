/**
 * Falls between machines (v2 `conveyor.mjs` L615–638): a parcel handed on mid-fall keeps its
 * velocity, then bends (in a quadratic) to land on its target, which may be moving. Continuous
 * in position at both ends, so a hand-off never pops.
 */
import type { V3 } from './ports.ts';

/** World units / s², the fall (v2 CONVEYOR_G). */
export const FALL_G = 420;

export interface Fall {
  from: V3;
  v: V3;
  /** Duration, s. */
  dur: number;
  /** Progress 0..1. */
  tau: number;
}

/** Time to fall `dz` (≥ 0.5) starting with vertical speed `vz` (≥ 0.18 s, as v2). */
export function fallTime(vz: number, dz: number): number {
  const d = Math.max(0.5, dz);
  return Math.max(0.18, (vz + Math.sqrt(vz * vz + 2 * FALL_G * d)) / FALL_G);
}

export function createFall(from: V3, v: V3, toZ: number): Fall {
  return { from: [from[0], from[1], from[2]], v: [v[0], v[1], v[2]], dur: fallTime(v[2], from[2] - toZ), tau: 0 };
}

/** Where the fall is at its progress, landing on `to` at tau = 1 (writes `out`). */
export function fallAt(f: Fall, to: V3, out: V3, tau = f.tau): V3 {
  const tt = Math.min(1, Math.max(0, tau));
  const t = tt * f.dur;
  const T = f.dur;
  for (let d = 0; d < 3; d++) {
    const g = d === 2 ? FALL_G : 0;
    const free = f.from[d]! + f.v[d]! * t - 0.5 * g * t * t;
    const freeEnd = f.from[d]! + f.v[d]! * T - 0.5 * g * T * T;
    out[d] = free + (to[d]! - freeEnd) * tt * tt;
  }
  return out;
}
