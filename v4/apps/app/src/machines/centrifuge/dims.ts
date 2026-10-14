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
import { CF, type LineSetSpec, type ProfilePoint } from '@anatomy/engine';
import { type V3, cross, dir, placeFrame } from '../kit.ts';

export {
  type Placed,
  type V3,
  DEG,
  add,
  closed,
  corners,
  dir,
  disc,
  frameAlong,
  placeFrame,
  polar,
  ring,
  scale,
  screws,
} from '../kit.ts';

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

/** v2 `faceFrame(deg, z)`: on the bowl's axis at height z, a = dir(deg), u = up, v = a × up. */
export const faceFrame = (deg: number, z: number) => placeFrame([0, 0, z], dir(deg), [0, 0, 1]);

// ---- profiles and plans ------------------------------------------------------------------------

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

// ---- the spout and the hand-over ---------------------------------------------------------------

/**
 * v2 spout frame: from the rim at the gate, sloping out and down. Its start, direction, lip and
 * the hand-on point (where a falling packet reaches z 100) all come from the engine sim, the one
 * source of the spout kinematics.
 */
export const SPOUT = (() => {
  const o: V3 = [...CF.spout.start];
  const a: V3 = [...CF.spout.dir];
  const u = dir(GATE_DEG + 90);
  const lip: V3 = [...CF.spout.lip];
  const hand: V3 = [...CF.spout.hand];
  return { frame: placeFrame(o, a, u, cross(a, u)), lip, hand };
})();
