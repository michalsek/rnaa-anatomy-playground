/**
 * Small math shared by the machine sims (plain TS, no allocation): wraps, eases, the critically
 * damped `settle`, option clamps and the yaw relax items do on a belt.
 */
import { log } from '#platform/env.ts';
import type { Item } from './items.ts';

export const TAU = Math.PI * 2;

/** a mod n into [0, n). */
export const mod = (a: number, n: number) => ((a % n) + n) % n;
/** Wrap into [−½, ½) (a fraction of a period). */
export const wrapHalf = (x: number) => x - Math.round(x);
/** Wrap an angle into [−π, π). */
export const wrapPi = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);
/** Wrap a length into [−total/2, total/2) (a signed distance round a loop). */
export const wrapSym = (x: number, total: number) => x - total * Math.floor(x / total + 0.5);

/** A deterministic stand-in for `Math.random()`: a hash of the integer n into [0, 1). */
export const hash01 = (n: number) => (Math.imul(n + 1, 2654435761) >>> 0) / 4294967296;

/** Smoothstep on 0..1 (clamped). */
export const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** Smoothstep from a to b (clamped). */
export const smooth = (a: number, b: number, x: number) => ease((x - a) / (b - a));
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** v2's `smoother` (quintic smootherstep on 0..1, clamped). */
export const smoother = (x: number) => {
  const t = clamp01(x);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** A spring state (position, velocity). */
export interface Spring {
  x: number;
  v: number;
}

/** Critically damped spring toward `target` with time constant `tau` (v2 `settle`, 4 substeps). */
export function settle(s: Spring, target: number, dt: number, tau: number) {
  const w = 1 / tau;
  const h = dt / 4;
  for (let i = 0; i < 4; i++) {
    s.v += (w * w * (target - s.x) - 2 * w * s.v) * h;
    s.x += s.v * h;
  }
}

/** A spring with stiffness k and damping c (v2 `springStep`, 4 substeps; underdamped kicks). */
export function springStep(s: Spring, target: number, dt: number, k: number, c: number) {
  const h = dt / 4;
  for (let i = 0; i < 4; i++) {
    s.v += (k * (target - s.x) - c * s.v) * h;
    s.x += s.v * h;
  }
}

/** A machine option below its least value is raised to it, with a log line. */
export function clampOpt(id: string, name: string, value: number, least: number) {
  if (value >= least) return value;
  log(`[sim] ${id}: ${name} ${value} raised to ${least}`);
  return least;
}

/** Turn an item to lie along its belt (the box is symmetric: the nearer of 0 and π), at 8/s. */
export function relaxYaw(item: Item, h: number) {
  const square = Math.round(item.yaw / Math.PI) * Math.PI;
  item.yaw += (square - item.yaw) * Math.min(1, h * 8);
}
