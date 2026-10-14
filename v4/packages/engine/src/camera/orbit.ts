/**
 * Free camera moves (M11, the user's orbit/pan/zoom; M10 plan §5): pure functions on a camera
 * state, in CSS px of drag. Orbit turns about the target (the viewport's centre) with the
 * elevation clamped; pan slides the target along the screen axes; zoom scales about a screen
 * point, which stays over the same world point. The light is fixed to the camera and lines scale
 * with zoom (the renderer's reference zoom stays the view's), so nothing else changes.
 */
import { type CameraState, DEG, basisOf } from './camera.ts';

export const ORBIT = {
  /** Elevation limits (rad). */
  minElevation: 10 * DEG,
  maxElevation: 80 * DEG,
  /** Radians per CSS px of drag. */
  perPx: 0.4 * DEG,
  /** Zoom limits, times the reference (fit) zoom. */
  minZoom: 0.5,
  maxZoom: 12,
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Turn by a drag of (dx, dy) CSS px: right turns the scene with the finger, down tilts it toward the viewer. */
export function orbitBy(s: CameraState, dx: number, dy: number, out: CameraState = s): CameraState {
  out.target[0] = s.target[0];
  out.target[1] = s.target[1];
  out.target[2] = s.target[2];
  out.zoom = s.zoom;
  out.yaw = s.yaw - dx * ORBIT.perPx;
  out.elevation = clamp(s.elevation + dy * ORBIT.perPx, ORBIT.minElevation, ORBIT.maxElevation);
  return out;
}

/** Slide by a drag of (dx, dy) CSS px: the world moves with the finger. */
export function panBy(s: CameraState, dx: number, dy: number, out: CameraState = s): CameraState {
  const b = basisOf(s.yaw, s.elevation);
  const u = dx / s.zoom;
  const v = dy / s.zoom;
  for (let i = 0; i < 3; i++) out.target[i] = s.target[i]! - u * b.right[i]! + v * b.up[i]!;
  out.yaw = s.yaw;
  out.elevation = s.elevation;
  out.zoom = s.zoom;
  return out;
}

/**
 * Zoom by `factor` about a point (ax, ay) in CSS px from the viewport's centre (y down), within
 * [minZoom, maxZoom] × `ref`.
 */
export function zoomAbout(s: CameraState, factor: number, ax: number, ay: number, ref: number, out: CameraState = s): CameraState {
  const z0 = s.zoom;
  const z1 = clamp(z0 * factor, ORBIT.minZoom * ref, ORBIT.maxZoom * ref);
  // The world point under (ax, ay) stays there: the target moves by a·(1/z0 − 1/z1) on screen.
  const k = 1 / z0 - 1 / z1;
  const b = basisOf(s.yaw, s.elevation);
  for (let i = 0; i < 3; i++) out.target[i] = s.target[i]! + ax * k * b.right[i]! - ay * k * b.up[i]!;
  out.yaw = s.yaw;
  out.elevation = s.elevation;
  out.zoom = z1;
  return out;
}
