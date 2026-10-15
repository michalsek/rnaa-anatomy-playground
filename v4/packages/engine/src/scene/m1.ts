/**
 * M1 line-spike profiles: the rotor and the tach. The M1 composition itself (box + tach,
 * spinning rotor, tube) is gallery row `m1`.
 */
import type { ProfilePoint } from '../geo/lathe.ts';
import type { LineSetSpec } from '../geo/spec.ts';

/** Drum on a flanged foot, a raised rib band, a domed shoulder, and a hub with a dial ring. */
export const ROTOR_PROFILE: readonly ProfilePoint[] = [
  [0, 0],
  [10.6, 0],
  [10.6, 1.4],
  [8.2, 1.4],
  [8.2, 3],
  [8.5, 3],
  [8.5, 9.5], // segment 5: rib band
  [8.2, 9.5],
  [8.2, 11],
  [8.0, 12.2, true],
  [7.3, 13.3, true],
  [6.0, 14.2, true],
  [4.2, 14.7],
  [3.0, 14.7],
  [3.0, 17],
  [2.2, 17], // segment 14: hub dial annulus, ending on a forced ring
  [0, 17],
];

/** The v2 tach at 0.8 scale: bezel, recessed face, ticks between the step and a forced ring. */
export const TACH_PROFILE: readonly ProfilePoint[] = [
  [4.32, 0],
  [4.32, 1.92],
  [3.68, 1.92],
  [3.68, 1.52],
  [2.56, 1.52], // segment 3: tick annulus
  [0, 1.52],
];

const tick = { width: 0.6, majorWidth: 0.6, fade: [0, 0] as const };

/** Rotor ribs on segment 5, faded toward the limbs so they end before the outline. */
export const ROTOR_RIBS: LineSetSpec = {
  count: 36, phase: 0, first: 0, last: 35, majorEvery: 0, minor: 'lo', major: 'lo', ...tick, fade: [0.1, 0.55],
};
/** Hub dial on segment 14, a major every 6th. */
export const ROTOR_DIAL: LineSetSpec = {
  count: 24, phase: 0, first: 0, last: 23, majorEvery: 6, minor: 'mid', major: 'hi', ...tick,
};
/** Tach ticks on segment 3: 18 intervals over 270° with the gap at the bottom, a major every 3rd. */
export const TACH_TICKS: LineSetSpec = {
  count: 24, phase: 9, first: 0, last: 18, majorEvery: 3, minor: 'mid', major: 'hi', ...tick,
};
