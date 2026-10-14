/**
 * Centrifuge dimensions and placement helpers, from the final v2 part
 * (`v2-factory/parts/centrifuge/centrifuge.mjs`, stubs from `build.mjs`).
 *
 * Coordinates are v2's `L(x, y, z)` (relative to v2's origin [100, 66, 0]): machine-local world
 * units, 1:1, z up, angles in degrees counter-clockwise from +x. The v4 camera uses the kit's
 * projection, so v2 numbers carry over unchanged.
 *
 * Frames: a v2 frame {o, a, u, v} becomes a placement whose model z is `a` and model x is `u`
 * (model y = a × u). Turned profiles run along model z (s), and v2 angles in a frame (measured
 * from u toward v) are model angles unchanged, as long as v = a × u (`placeFrame` reports a
 * mirrored frame). Plain module: no components here (Fast Refresh boundary rule).
 */
import { CF, type DotSpec, type LineSetSpec, type ProfilePoint, type SegmentSpec, type Vec3 } from '@anatomy/engine';

export type V3 = [number, number, number];

export const DEG = Math.PI / 180;
export const dir = (deg: number): V3 => [Math.cos(deg * DEG), Math.sin(deg * DEG), 0];
export const polar = (deg: number, r: number, z: number): V3 => [
  r * Math.cos(deg * DEG),
  r * Math.sin(deg * DEG),
  z,
];
const cross = (a: Vec3, b: Vec3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const add = (a: Vec3, b: Vec3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];

// ---- v2 constants ------------------------------------------------------------------------------

export const Z = {
  flange: [100, 103],
  bowl: [103, 120],
  top: [120, 122.5],
  carousel: [122.5, 125],
  pocket: 125,
  vane: 5,
  rimTop: 129.6,
  knuckle: 109,
  packet: 7,
  hub: 137,
  strobe: 139,
  spider: [159.6, 164.4],
  ring: 162,
  arm: [160.8, 163.2],
  plate: [163.8, 165.6],
  bearing: [164.4, 176.2],
  pulley: [178, 182],
  belt: 180,
  funnelFoot: 165.8,
  mouth: 186,
} as const;

export const R = {
  flange: 37,
  bowl: 34,
  top: 36,
  carousel: 29,
  hubCollar: 12,
  hubColumn: 7.5,
  strobe: 10.5,
  vaneIn: 12,
  vaneOut: 28.8,
  pocket: 23,
  rimIn: 29.6,
  rimOut: 31.4,
  post: 1.4,
  postAt: 33.5,
  ring: 1.8,
  shaft: 2.2,
} as const;

export const POCKETS = 10;
export const ALPHA = 360 / POCKETS;
export const SPOUT_DEG = -90;
export const GATE_DEG = 95;
export const GATE_HALF = 9;
export const SPOUT_SLOPE = 15;
export const SPOUT_LEN = 15;
export const LEG = 24.5;
export const MOTOR: V3 = [46, 0, 0];
export const FUNNEL: V3 = [0, -R.pocket, 0];
export const TACH_DEG = 50;
export const LAMP_DEG = 74;
export const CRANK_DEG = 118;
export const DRAIN_DEG = 20;
export const COOL_DEGS = [-24, 4] as const;
export const SHELF_TOP = 74.1;
/** v2's camera azimuth (atan2 of `toward`): the rim splits into back and front halves here. */
export const AZ = 45;
/** Rotor rest angle (the shot's "in sync" frame): vane i at A0 + 36i, pocket k centre at −90 + 36k. */
export const A0 = SPOUT_DEG - ALPHA / 2;

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

/** v2 `faceFrame(deg, z)`: on the bowl's axis at height z, a = dir(deg), u = up, v = a × up. */
export const faceFrame = (deg: number, z: number) => placeFrame([0, 0, z], dir(deg), [0, 0, 1]);

/** A frame along `axis` at `o` (v2 `frameAlong`; the roll about the axis doesn't matter). */
export const frameAlong = (o: Vec3, axis: Vec3) => {
  const a = unit(axis);
  const helper: Vec3 = Math.abs(a[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  return placeFrame(o, a, cross(helper, a));
};

// ---- profiles and plans ------------------------------------------------------------------------

/** A solid disc along model z: v2 `turned(F, [[s0, r], [s1, r]])`. */
export const disc = (r: number, s0: number, s1: number): ProfilePoint[] => [
  [0, s0],
  [r, s0],
  [r, s1],
  [0, s1],
];

/** v2 `pulleyProfile(r)` with two knots on the top face for the groove ring and the hub ring. */
export const pulley = (r: number, ring: number, hub: number): ProfilePoint[] => [
  [0, Z.pulley[0]],
  [r - 0.4, Z.pulley[0]],
  [r, Z.pulley[0] + 0.4],
  [r, Z.pulley[1] - 0.4],
  [r - 0.4, Z.pulley[1]],
  [ring, Z.pulley[1]],
  [hub, Z.pulley[1]],
  [0, Z.pulley[1]],
];

/** Four pulley spokes (a line set on the pulley's top annulus), the first at angle `deg`. */
export const spokes = (deg: number): LineSetSpec => ({
  count: 4, phase: ((((deg / 360) * 4) % 1) + 1) % 1, first: 0, last: 3, majorEvery: 0, minor: 'lo', major: 'lo',
  width: 0.6, majorWidth: 0.6, fade: [0, 0],
});

/** A radial rectangle from r0 to r1, `half` wide, along +x (rotate the part by its angle). */
export const radial = (r0: number, r1: number, half: number) => ({
  polygon: [
    [r0, -half],
    [r1, -half],
    [r1, half],
    [r0, half],
  ] as [number, number][],
});

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

// ---- the spout and the hand-over (for the audio belt stub) -------------------------------------

/**
 * v2 spout frame: from the rim at the gate, sloping out and down. The lip and the hand-over point
 * (where a falling packet reaches z 100) come from the engine sim, the one source of the spout
 * kinematics.
 */
export const SPOUT = (() => {
  const sl = SPOUT_SLOPE * DEG;
  const g = GATE_DEG * DEG;
  const o = polar(GATE_DEG, R.rimOut, Z.pocket);
  const a: V3 = [Math.cos(g) * Math.cos(sl), Math.sin(g) * Math.cos(sl), -Math.sin(sl)];
  const u = dir(GATE_DEG + 90);
  const lip: V3 = [...CF.spout.lip];
  const hand: V3 = [...CF.spout.hand];
  return { frame: placeFrame(o, a, u, cross(a, u)), lip, hand };
})();
