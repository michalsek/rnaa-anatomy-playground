/**
 * Conveyor authoring helpers (v2 `parts/conveyor/conveyor.mjs` frameOf): parts are placed in belt
 * coordinates (s along the belt, c across, +c toward the viewer, z up from the floor) and mapped
 * into the machine's local frame by the sim's belt frame. A `y` belt's frame is a reflection of an
 * `x` belt's, so boxes go by corners and turned parts by direction vectors (never by one
 * rotation). Plain module.
 */
import type { BeltFrame, LineSetSpec, Vec3 } from '@anatomy/engine';
import { type Placed, type V3, corners, placeFrame } from '../kit.ts';

export interface BeltKit {
  readonly sV: V3;
  readonly cV: V3;
  w(s: number, c: number, z: number): V3;
  /** A box from belt-coordinate extents (any order). */
  box(s: readonly [number, number], c: readonly [number, number], z: readonly [number, number]): { size: V3; center: V3 };
  /** A turned part whose axis (model z) points along +c. */
  alongC(s: number, c: number, z: number): Placed;
  /** A turned part whose axis points along `sign`·s. */
  alongS(s: number, c: number, z: number, sign?: number): Placed;
  /** A turned part standing up (model z up). */
  up(s: number, c: number, z: number): Placed;
}

const UP: Vec3 = [0, 0, 1];

/** Placement helpers over the sim's belt frame (`Conveyor.frame`, `Loop.frame`). */
export function beltKit(frame: BeltFrame): BeltKit {
  const sV: V3 = [...frame.sV];
  const cV: V3 = [...frame.cV];
  const w = (s: number, c: number, z: number): V3 => frame.w(s, c, z, [0, 0, 0]);
  return {
    sV,
    cV,
    w,
    box(s, c, z) {
      const a = w(Math.min(s[0], s[1]), Math.min(c[0], c[1]), Math.min(z[0], z[1]));
      const b = w(Math.max(s[0], s[1]), Math.max(c[0], c[1]), Math.max(z[0], z[1]));
      return corners([Math.min(a[0], b[0]), Math.min(a[1], b[1]), a[2]], [Math.max(a[0], b[0]), Math.max(a[1], b[1]), b[2]]);
    },
    alongC: (s, c, z) => placeFrame(w(s, c, z), cV, sV),
    alongS: (s, c, z, sign = 1) => placeFrame(w(s, c, z), [sV[0] * sign, sV[1] * sign, 0], UP),
    up: (s, c, z) => placeFrame(w(s, c, z), UP, sV),
  };
}

/** Slats as a UV line set on a band of loop length `total`: one line per `pitch`. */
export function slats(total: number, pitch: number, tone: 'lo' | 'faint'): LineSetSpec {
  const count = Math.max(1, Math.round(total / pitch));
  return {
    count,
    phase: 0,
    first: 0,
    last: count - 1,
    majorEvery: 0,
    minor: tone,
    major: tone,
    width: 0.5,
    majorWidth: 0.5,
    // Hidden where the wrap turns away (v2 drops slats facing < 0.06).
    fade: [0.02, 0.12],
  };
}
