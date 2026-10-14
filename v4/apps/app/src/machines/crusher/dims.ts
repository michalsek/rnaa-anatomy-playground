/**
 * Crusher dimensions and placement helpers, from v2 `parts/crusher/crusher.mjs` (build L19–372).
 * The numbers are the sim's (`CR` in the engine); coordinates are v2's local frame (origin = the
 * machine centre on the floor; roller axes along x, the feed from −y, the bin in front at +y).
 *
 * v2 frames become placements: FX (axis +x, u = +y), FY (axis +y, u = +z), FZ (axis +z, u = +x);
 * turned profiles run along the axis (model z). Plain module (no components).
 */
import { CR, type DotSpec, type LineSetSpec, type ProfilePoint, type SegmentSpec } from '@anatomy/engine';
import { type Placed, type V3, closed, placeFrame, ring } from '../kit.ts';
import { turned } from '../conveyor/dims.ts';

export { CR };

export const FX = (x: number, y: number, z: number): Placed => placeFrame([x, y, z], [1, 0, 0], [0, 1, 0]);
export const FY = (x: number, y: number, z: number): Placed => placeFrame([x, y, z], [0, 1, 0], [0, 0, 1]);
export const FZ = (x: number, y: number, z: number): Placed => placeFrame([x, y, z], [0, 0, 1], [1, 0, 0]);

/**
 * v2 `plateX`: a plate along x (x0..x1) with a convex cross-section `poly` in the (y, z) plane.
 * An extrude placed by FX: model x = world y, model y = world z, model z = world x.
 */
export const plateX = (x0: number, x1: number, poly: readonly (readonly [number, number])[]) => ({
  plan: { polygon: poly.map(([y, z]) => [y, z] as const) },
  height: x1 - x0,
  ...FX(x0, 0, 0),
});

/** Ribs / teeth (v2 `ribsOf` with fade [.1, .55]). */
export const ribs = (count: number, tone: 'lo' | 'mid' | 'faint'): LineSetSpec => ({
  count, phase: 0, first: 0, last: count - 1, majorEvery: 0, minor: tone, major: tone,
  width: 0.5, majorWidth: 0.5, fade: [0.1, 0.55],
});

// ---- rollers -----------------------------------------------------------------------------------

const RL = CR.ROLLER;
/** The roller profile (s along x from the roller's −x end) and the ring segments (teeth). */
export const ROLLER_PROFILE = (() => {
  const knots: [number, number][] = [[0, RL.endR], [0.9, RL.endR]];
  const rings: [number, number][] = [];
  for (let i = 0; i < RL.rings; i++) {
    const s0 = 0.9 + i * (RL.ringW + RL.gapW);
    const s1 = s0 + RL.ringW;
    rings.push([s0, s1]);
    knots.push([s0, RL.r], [s1, RL.r]);
    if (i < RL.rings - 1) knots.push([s1, RL.rootR], [s1 + RL.gapW, RL.rootR]);
  }
  const len = RL.x1 - RL.x0;
  knots.push([rings[rings.length - 1]![1], RL.endR], [len, RL.endR]);
  const profile = turned(knots);
  // A ring's outer face: the profile segment between two knots at the full radius.
  const teeth: number[] = [];
  for (let k = 0; k + 1 < profile.length; k++) {
    const a = profile[k]!;
    const b = profile[k + 1]!;
    if (a[0] === RL.r && b[0] === RL.r && b[1] > a[1]) teeth.push(k);
  }
  return { profile, teeth };
})();

// ---- flywheel, pulley, motor -------------------------------------------------------------------

const FL = CR.FLY;
/** v2 flywheel profile, plus two face knots (marked: the face rings at r − 1.4 and 3.4). */
export const FLYWHEEL: { profile: ProfilePoint[]; marks: number[] } = (() => {
  const profile: ProfilePoint[] = [
    [0, -0.6],
    [FL.hub, -0.6],
    [FL.hub, 0],
    [FL.r, 0],
    [FL.r, FL.w],
    [FL.r - 1.4, FL.w],
    [3.4, FL.w],
    [FL.hub, FL.w],
    [FL.hub, FL.w + 0.6],
    [0, FL.w + 0.6],
  ];
  return { profile, marks: [5, 6] };
})();

/** The motor (v2 `motor` turned along +x from MOTOR.x): ribbed body, cowl. */
export const MOTOR_PROFILE = turned([[0, 3.2], [0.5, 4.2], [1.6, 4.2], [1.6, 5], [10.4, 5], [10.4, 4.5], [12.4, 4.5], [12.4, 3.4], [12.9, 3.4]]);
/** Segment indices of the ribbed body and the cowl in MOTOR_PROFILE. */
export const MOTOR_RIBS = { body: 4, cowl: 6 } as const;

/** The belt plane (x) and the V-belt's wheel centres in it (y, z) with the belt radii. */
export const VBELT = (() => {
  const x = FL.x + FL.w / 2;
  return {
    x,
    a: [CR.ROLLER.ys[0], CR.ROLLER.axisZ] as const,
    ra: FL.r + CR.BELT_R,
    b: [CR.MOTOR.y, CR.MOTOR.z] as const,
    rb: CR.MOTOR.pulleyR,
    /** Lacing marks: spacing along the belt, units. */
    spacing: 9,
  };
})();

/** The lamp's dome (v2 `lamp.lens`), smooth, on the base at LAMP.z (model z up). */
export const LENS: ProfilePoint[] = (() => {
  const out: ProfilePoint[] = [[0, 1.8], [1.6, 1.8]];
  for (let i = 1; i <= 12; i++) {
    const a = (i / 12) * (Math.PI / 2);
    out.push([i === 12 ? 0 : 1.6 * Math.cos(a), 1.8 + 3.1 * Math.sin(a), i < 12]);
  }
  return out;
})();

/** The chute's floor top at y (v2 `chuteTop`). */
export const chuteTop = (y: number) => CR.CHUTE.z0 + ((y - CR.CHUTE.y0) / (CR.CHUTE.y1 - CR.CHUTE.y0)) * (CR.CHUTE.z1 - CR.CHUTE.z0);

/** The flake and chip sizes (v2 pitchedBox 1.5 × 1.1 × 0.7 · s; chips flat). */
export const FLAKE: V3 = [1.5, 1.1, 0.7];
export const CHIP: V3 = [1.4, 1.0, 0.2];

// ---- marks helpers -------------------------------------------------------------------------------

const AXIS: Record<'x' | 'y' | 'z', V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** v2 `faceScrews` / `ctx.screws`: a lo ring and a dot per point, on a face whose normal is +axis. */
export function faceScrews(axis: 'x' | 'y' | 'z', points: readonly V3[], ringR = 0.8, size = 0.45): { segments: SegmentSpec[]; dots: DotSpec[] } {
  const n = AXIS[axis];
  return {
    segments: points.flatMap((p) => closed(ring(p, ringR, 14, n), n, 'lo')),
    dots: points.map((p) => ({ at: p, size, normal: n })),
  };
}

/** Dots only (countersunk screws, rivets) on a face with normal `n`. */
export const dots = (points: readonly V3[], n: V3, size = 0.42, tone?: DotSpec['tone']): DotSpec[] =>
  points.map((p) => ({ at: p, size, normal: n, ...(tone && { tone }) }));

/**
 * A slot outline (a stadium: straight sides, round ends) centred at `c`, `half` long along `u`,
 * `w` half wide along `v`, on a face with normal `n`.
 */
export function slot(c: V3, u: V3, v: V3, half: number, w: number, n: V3, tone: SegmentSpec['tone'] = 'lo'): SegmentSpec[] {
  const pts: V3[] = [];
  const at = (s: number, t: number): V3 => [c[0] + u[0] * s + v[0] * t, c[1] + u[1] * s + v[1] * t, c[2] + u[2] * s + v[2] * t];
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * Math.PI;
    pts.push(at(half - w + Math.cos(a) * w, Math.sin(a) * w));
  }
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI / 2 + (i / 8) * Math.PI;
    pts.push(at(-half + w + Math.cos(a) * w, Math.sin(a) * w));
  }
  return closed(pts, n, tone);
}

/** A circle outline at `c` on a face with normal `n`. */
export const circle = (c: V3, r: number, n: V3, tone: SegmentSpec['tone'] = 'lo', steps = 16): SegmentSpec[] => closed(ring(c, r, steps, n), n, tone);
