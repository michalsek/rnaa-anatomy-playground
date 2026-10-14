/**
 * Eased camera moves (M10): a critically damped settle toward a goal camera, on the target (world),
 * the zoom (in log space, so a zoom-in and a zoom-out feel the same), the yaw and the elevation (by
 * the shortest angle), and the line-width reference zoom (log space too, so lines scale smoothly
 * between views). Plain TS, allocation-free per step.
 */
import type { CameraState } from './camera.ts';

/** Settle time constant (s): ω = 1/τ; 95% of the way in ≈ 4.7 τ. */
export const CAMERA_TAU = 0.35;

export interface CameraEase {
  /** Start a move from `from` (and its ref zoom) toward `to`. */
  to(from: CameraState, fromRef: number, to: CameraState, toRef: number): void;
  /** Advance by dt seconds; writes the camera into `out` and returns the ref zoom. */
  step(dt: number, out: CameraState): number;
  /** True once settled (then `step` writes the goal exactly). */
  done(): boolean;
  /** Stop easing (the next `to` starts again). */
  cancel(): void;
}

const TAU2 = Math.PI * 2;
/** a − b wrapped into (−π, π]. */
const wrapDiff = (a: number, b: number) => {
  let d = (a - b) % TAU2;
  if (d > Math.PI) d -= TAU2;
  if (d <= -Math.PI) d += TAU2;
  return d;
};

/** Channels: target xyz, log zoom, yaw, elevation, log ref zoom. */
const N = 7;

export function createCameraEase(tau = CAMERA_TAU): CameraEase {
  const x = new Float64Array(N);
  const v = new Float64Array(N);
  const g = new Float64Array(N);
  let active = false;
  const w = 1 / tau;
  return {
    to(from, fromRef, to, toRef) {
      // Keep the velocity when a move interrupts another (no jolt), else start at rest.
      if (!active) v.fill(0);
      x[0] = from.target[0];
      x[1] = from.target[1];
      x[2] = from.target[2];
      x[3] = Math.log(from.zoom);
      x[4] = from.yaw;
      x[5] = from.elevation;
      x[6] = Math.log(fromRef);
      g[0] = to.target[0];
      g[1] = to.target[1];
      g[2] = to.target[2];
      g[3] = Math.log(to.zoom);
      // Angles by the shortest way: the goal is unwrapped next to the start.
      g[4] = x[4] + wrapDiff(to.yaw, x[4]);
      g[5] = x[5] + wrapDiff(to.elevation, x[5]);
      g[6] = Math.log(toRef);
      active = true;
    },
    step(dt, out) {
      if (active) {
        // Exact critically damped step for a constant goal (stable for any dt).
        const e = Math.exp(-w * dt);
        let settled = true;
        for (let i = 0; i < N; i++) {
          const d0 = x[i]! - g[i]!;
          const c = v[i]! + w * d0;
          const d = (d0 + c * dt) * e;
          v[i] = (c - w * (d0 + c * dt)) * e;
          x[i] = g[i]! + d;
          const scale = i === 3 || i === 6 ? 1e-3 : i >= 4 ? 1e-4 : 1e-2;
          if (Math.abs(d) > scale || Math.abs(v[i]!) > scale * 10) settled = false;
        }
        if (settled) {
          for (let i = 0; i < N; i++) {
            x[i] = g[i]!;
            v[i] = 0;
          }
          active = false;
        }
      }
      out.target[0] = x[0]!;
      out.target[1] = x[1]!;
      out.target[2] = x[2]!;
      out.zoom = Math.exp(x[3]!);
      out.yaw = x[4]!;
      out.elevation = x[5]!;
      return Math.exp(x[6]!);
    },
    done: () => !active,
    cancel() {
      active = false;
    },
  };
}
