// The contract between v2's centrifuge LIVE (parts/centrifuge/centrifuge.mjs, centrifugeLive) and the native rotor.
// tools/build.mjs injects one line at the top of `function drawRotor(now) {` in the GPU live pages:
//
//   if (api.gpu?.rotor?.(Ad, pockets, releasing, now, releasePose, drawRotor)) return;
//
// `api.gpu` exists only on a GPU page with the native rotor enabled (src/web/main.ts wraps FACTORY.define). The hook
// returns true when the native painter draws this frame's rotorBack / rotorFront / spout / fall; otherwise drawRotor
// runs as in v2 and writes its strings.
//
// What drawRotor reads, and where the native side gets it:
// - per call (arguments): the drawn angle `Ad`, `pockets` (item or null; `.kind`), `releasing` (`item.kind`, `t0`,
//   `a0`), `now`, and v2's own release kinematics `releasePose(r, age)` (stage, pos, a, z), called as drawRotor does;
// - per machine (the api object FACTORY.define hands the centrifuge): `api.data` (RotorData below) and `api.P`;
// - v2 literals of vane() / packet() / drawRotor(), restated in rotor-model.ts.
// `drawRotor` itself is passed so the slots' v2 markup can be produced on demand (a reader of `innerHTML`, the SVG
// fallback): the hook is bypassed and drawRotor re-runs for the same, unchanged state.

export interface RotorItem {
  kind: string;
}

export interface RotorRelease {
  item: RotorItem;
  t0: number;
  a0: number;
}

/** v2 releasePose(): where a released packet is; `pos` is a world point (x, y used), `z` the packet's bottom. */
export interface RotorPose {
  stage: 'rotor' | 'spout' | 'fall' | string;
  pos: ArrayLike<number>;
  a: number;
  z: number;
}

export type RotorPoseOf = (release: RotorRelease, age: number) => RotorPose;

/** The centrifuge's build data fields drawRotor uses (`api.data`). */
export interface RotorData {
  pockets: number;
  centre: number[];
  toward: number[];
  r: { vaneIn: number; vaneOut: number; pocket: number };
  z: { pocket: number; vane: number; packet: number };
}

/** The hook's signature (the injected call's arguments, in order). */
export type RotorHook = (drawnAngle: number, pockets: readonly (RotorItem | null)[], releasing: readonly RotorRelease[], now: number, poseOf: RotorPoseOf, redraw: (now: number) => void) => boolean;

/** What the define wrapper adds to a machine's api as `api.gpu`. */
export interface MachineGpu {
  rotor: RotorHook;
}

/** The text tools/build.mjs inserts after `function drawRotor(now) {` (keep the two in sync: build.mjs imports it). */
export const ROTOR_HOOK_LINE = 'if (api.gpu?.rotor?.(Ad, pockets, releasing, now, releasePose, drawRotor)) return;';
