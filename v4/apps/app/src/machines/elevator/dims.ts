/**
 * Elevator dimensions, from v2 `parts/scanner/elevator.mjs` (build L21–295), in the elevator's
 * local frame: v2's design frame minus its column centre (REF [−107, −123, 0]), so the origin is
 * the centre of the tower's column on the floor. The lift-dependent numbers come from the sim's
 * `elevatorGeometry` (`EL` holds the fixed ones). Plain module (no components).
 */
import { EL, type ElevatorGeometry, type LineSetSpec } from '@anatomy/engine';

export { EL };

/** v2 design frame → local. */
export const R = (x: number, y: number, z: number): [number, number, number] => [x + 107, y + 123, z];

export const PX = EL.posts.x;
export const PY = EL.posts.y;
export const PH = EL.posts.half;

/** Boot housing, its top flange (with the two run slots), the feed opening on its +y face. */
export const BOOT = { ...EL.boot, r: 0.6 };
export const FLANGE = { x0: -8, x1: 8, y0: -26.5, y1: 26.5, z0: 40, z1: EL.zBootTop, r: 0.8 };
export const SLOTS = { x: 6, front: [12.4, 25.2] as const, back: [-24.6, -12.4] as const };
export const FEED_HOLE = { x: 6, z0: 24.2, z1: 33 };
/** The in-feed chute (floor, walls) from the boot's face to the mouth. */
export const CHUTE = { y0: BOOT.y1, y1: EL.feed.mouth, floor: [22.8, EL.feed.z] as const, wallTop: 27.5, half: 6.5, wall: 1 };

/** The cradle's five plates in its chain frame (v2 `wrapCradle`). */
export const CRADLE = EL.plates;

/** The chain: pitch radius ± half its depth; its width across. */
export const CHAIN = EL.chain;

/** Girt levels (every 36 from 44) and splice heights (v2: the middle of every third bay from the second). */
export function tower(g: ElevatorGeometry) {
  const levels: number[] = [];
  for (let L = 44; L <= g.zh - 32; L += 36) levels.push(L);
  const splices: number[] = [];
  for (let i = 0; i < levels.length - 1; i++) if (i % 3 === 1) splices.push(levels[i]! + 18);
  return {
    levels,
    splices,
    /** Posts' top, the head ring's bottom and top, the head's top beams. */
    top: g.zh + 22,
    ringZ: [g.zh - 28, g.zh - 24] as const,
  };
}

/** Pins on a chain band: one line per pitch round its outer face. */
export function pins(total: number): LineSetSpec {
  const count = Math.max(1, Math.round(total / EL.pitch));
  return { count, phase: 0, first: 0, last: count - 1, majorEvery: 0, minor: 'hi', major: 'hi', width: 0.55, majorWidth: 0.55, fade: [0.02, 0.12] };
}

/** The outer loop length of a chain band (its line set's period). */
export const chainTotal = (g: ElevatorGeometry) => 2 * g.Lf + 2 * Math.PI * CHAIN.R;
