/**
 * A two-link planar arm on a yawing turret (v2 `parts/packer/rig.mjs` `solve`): the shoulder S
 * sits on the turret's axis; the turret yaws so the arm's plane passes `off` beside the target
 * (the tool hangs off the wrist along the plane's normal n); in that plane links L1 and L2 reach
 * the wrist point Wp with the elbow up; the wrist keeps the tool vertical and turns it so its bar
 * stays along world x. Pure, allocation-free (writes `out`), shared by the packer's sim (targets,
 * clearance tests) and its blocks (the nested `moves` groups: turret yaw, link 1, link 2, wrist).
 */
import type { V3 } from './ports.ts';

export interface ArmSpec {
  /** Shoulder point (turret axis, the shoulder's height). */
  readonly S: V3;
  /** Top of the turret (the yoke plate's underside), its radius. */
  readonly yokeZ: number;
  readonly yokeR: number;
  readonly L1: number;
  readonly L2: number;
  /** The tool's offset from the arm's plane, along n. */
  readonly off: number;
  /** n = side · (the turret's local +y): which side of the plane the tool (and link 2) hangs. */
  readonly side: 1 | -1;
  /** Link half widths (stadium radii). */
  readonly r1: number;
  readonly r2: number;
}

export interface ArmPose {
  /** Turret yaw (radians, about z, from +x). */
  yaw: number;
  /** Link 1's elevation, link 2's elevation (radians, in the arm's plane, from the horizontal). */
  a1: number;
  a2: number;
  /** Shoulder → wrist distance in the plane, and whether the target was out of reach (clamped). */
  reach: number;
  clamped: boolean;
  /** The plane's horizontal direction and its normal n (unit). */
  dir: V3;
  n: V3;
  /** Elbow, wrist (in the plane), tool point W = Wp + n·off. */
  E: V3;
  Wp: V3;
  W: V3;
}

export function armPose(): ArmPose {
  return { yaw: 0, a1: 0, a2: 0, reach: 0, clamped: false, dir: [1, 0, 0], n: [0, 1, 0], E: [0, 0, 0], Wp: [0, 0, 0], W: [0, 0, 0] };
}

/** Reach margin below L1 + L2 and above |L1 − L2| (v2: 0.05). */
const MARGIN = 0.05;

/** Solve for the tool point W (writes and returns `out`). */
export function solveArm(spec: ArmSpec, wx: number, wy: number, wz: number, out: ArmPose = armPose()): ArmPose {
  const S = spec.S;
  const dx = wx - S[0];
  const dy = wy - S[1];
  const flat = Math.hypot(dx, dy);
  // Inside the offset circle the plane can't pass `off` beside the target: r is floored (clamped).
  const inside = flat * flat - spec.off * spec.off < 1e-6;
  const r = Math.sqrt(Math.max(1e-6, flat * flat - spec.off * spec.off));
  const side = spec.side;
  const yaw = Math.atan2(dy, dx) - side * Math.atan2(spec.off, r);
  const h = wz - S[2];
  const full = Math.hypot(r, h);
  // Reach between the folded and the stretched arm (with a margin either side).
  const D = Math.max(Math.abs(spec.L1 - spec.L2) + MARGIN, Math.min(spec.L1 + spec.L2 - MARGIN, full));
  const phi = Math.atan2(h, r);
  const cb = (spec.L1 * spec.L1 + D * D - spec.L2 * spec.L2) / (2 * spec.L1 * D);
  const beta = Math.acos(Math.max(-1, Math.min(1, cb)));
  const a1 = phi + beta;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  out.yaw = yaw;
  out.a1 = a1;
  out.reach = full;
  out.clamped = inside || Math.abs(full - D) > 1e-9;
  out.dir[0] = c;
  out.dir[1] = s;
  out.dir[2] = 0;
  out.n[0] = -side * s;
  out.n[1] = side * c;
  out.n[2] = 0;
  const ca = Math.cos(a1);
  const sa = Math.sin(a1);
  out.E[0] = S[0] + c * ca * spec.L1;
  out.E[1] = S[1] + s * ca * spec.L1;
  out.E[2] = S[2] + sa * spec.L1;
  // The wrist on the plane (clamped to the reach along the shoulder → target line).
  const k = D / Math.max(1e-9, full);
  out.Wp[0] = S[0] + c * r * k;
  out.Wp[1] = S[1] + s * r * k;
  out.Wp[2] = S[2] + h * k;
  const ex = out.Wp[0] - out.E[0];
  const ey = out.Wp[1] - out.E[1];
  const ez = out.Wp[2] - out.E[2];
  out.a2 = Math.atan2(ez, ex * c + ey * s);
  out.W[0] = out.Wp[0] + out.n[0] * spec.off;
  out.W[1] = out.Wp[1] + out.n[1] * spec.off;
  out.W[2] = out.Wp[2];
  return out;
}
