/**
 * Views and card text of the single-machine scenes and v2's conveyor page scene (world boxes to frame, named
 * like v2's `assembly/shots/z-*` and the conveyor QA crops). Plain module (no components).
 */
import type { ViewPreset } from '@anatomy/engine';

const at = (name: string, frame: ViewPreset['frame'], yaw = 45): ViewPreset => ({ name, yaw, elevation: 30, zoom: 1, ...(frame && { frame }) });

/** The packer scene (packer at the origin, belt A along +x into its gutter, belt B along +y). */
export const PACKER_VIEWS: ViewPreset[] = [
  at('fit', undefined),
  /** Belt A's head, the transfer plate, the gutter, the picker (v2 `z-A-packer`). */
  at('gutter', [[-65, -25, 195], [5, 22, 258]]),
  /** The lane: S0 erecting, S1 filling, S2 folding and taping. */
  at('lane', [[-14, -26, 194], [26, 32, 232]]),
  /** The magazine, pusher and erector over S0. */
  at('magazine', [[-12, -30, 194], [14, -2, 224]]),
  /** The folder at S2. */
  at('folder', [[-8, 6, 196], [30, 30, 236]]),
  /** The lane nose over belt B (v2 `z-packer-B`). */
  at('nose', [[-15, 5, 185], [18, 50, 225]]),
];

export const PACKER_CARD = {
  fig: 'Part',
  title: 'Packer',
  hint: 'fluff in from belt A · packets out onto belt B',
  label: 'Beads roll off belt A into a three-pocket gutter; the picker lifts all three into an open carton, the folder closes and tapes it, and the walking beam pushes the packet onto belt B.',
} as const;

export const CONVEYOR_VIEWS: ViewPreset[] = [
  at('fit', undefined),
  at('beltB', [[50, -60, 80], [100, 75, 160]]),
  at('tail', [[60, 50, 30], [112, 100, 112]]),
  at('hanging', [[-60, 50, 30], [20, 100, 100]]),
  at('head', [[-158, 50, 25], [-100, 100, 112]]),
  at('beltC', [[-150, 40, 0], [-110, 170, 50]]),
];

export const CONVEYOR_CARD = {
  fig: 'Part',
  title: 'Conveyors',
  hint: 'belt → audio belt → belt',
  label: 'Two conveyor variants: a single-sided belt and the audio belt, the render loop.',
} as const;

/** The output scene (elevator column at the origin, belt D along +y, the speaker at [−62, −74]). */
export const OUTPUT_VIEWS: ViewPreset[] = [
  at('fit', undefined),
  /** Belt D's head over the chute, the boot. */
  at('boot', [[-28, -30, 0], [28, 70, 45]]),
  /** The head: wheel, cradles rounding it, the hopper. */
  at('head', [[-16, -44, 222], [22, 20, 278]]),
  /** v2 `z-elevator-speaker`: the duct and spout over the speaker's throat. */
  at('spout', [[-53, -84, 195], [17, -19, 275]]),
  /** The speaker (turned: from the standard camera the elevator's head hides it). */
  at('speaker', [[-110, -120, 170], [5, -30, 230]], -45),
  /** The meter and the ledge (turned, as the speaker). */
  at('meter', [[-30, -84, 200], [5, -64, 222]], -45),
];

export const OUTPUT_CARD = {
  fig: 'Part',
  title: 'Elevator → speaker',
  hint: 'buffer → cradle → fling → spout → cone',
  label: 'Each 512-frame device buffer rides a cradle up the elevator, is flung into the hopper and drops out of the spout into the speaker, whose cone pumps once per buffer.',
} as const;

