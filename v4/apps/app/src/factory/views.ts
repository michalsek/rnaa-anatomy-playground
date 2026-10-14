/**
 * Views and card text of the line scene and v2's conveyor page scene (world boxes to frame, named
 * like v2's `assembly/shots/z-*` and the conveyor QA crops). Plain module (no components).
 */
import type { ViewPreset } from '@anatomy/engine';

const at = (name: string, frame: ViewPreset['frame'], yaw = 45): ViewPreset => ({ name, yaw, elevation: 30, zoom: 1, ...(frame && { frame }) });

export const LINE_VIEWS: ViewPreset[] = [
  at('fit', undefined),
  /** v2 `z-dispenser-A`: the bead source's hopper over belt A. */
  at('dispenser-A', [[-8, -205, 220], [60, -175, 275]]),
  /** v2 `z-A-packer`: belt A's head, the transfer plate, the gutter and the picker. */
  at('A-packer', [[35, -215, 195], [105, -168, 258]]),
  /** The packer: deck, lane, both arms, magazine and cabinet. */
  at('packer', [[68, -224, 176], [132, -162, 258]]),
  /** v2 `z-packer-B`: the lane's nose over belt B's tail. */
  at('packer-B', [[85, -185, 185], [118, -140, 225]]),
  /** v2 `z-centrifuge-audio`: the centrifuge over the audio belt. */
  at('centrifuge-audio', [[40, 20, 40], [140, 150, 205]]),
  at('funnel', [[85, 5, 168], [115, 60, 208]]),
  at('release', [[76, 100, 88], [118, 138, 128]]),
  at('read', [[12, 108, 42], [48, 132, 82]]),
  at('head', [[-118, 98, 25], [-62, 142, 112]]),
  /** v2 `z-audio-C`: the loop's head drum over belt C, where garbage drops. */
  at('audio-C', [[-125, 92, 0], [-55, 160, 112]]),
  /** v2 `z-C-crusher`: belt C's end and the crusher. */
  at('C-crusher', [[-122, 196, 0], [-58, 290, 40]]),
  /** The crusher alone (with its drawer's travel). */
  at('crusher', [[-128, 202, 0], [-50, 298, 38]]),
  /** v2 `z-scanner-read`: the arm over the loop, the preamp and the cable. */
  at('scanner-read', [[-56, 88, 10], [40, 124, 100]]),
  /** v2 `z-scanner-D`: the preamp's lip and the start of belt D. */
  at('scanner-D', [[-66, 60, 8], [-22, 104, 44]]),
  /** The read head: the arm, ribbon and lamp. */
  at('arm', [[10, 72, 84], [52, 116, 106]]),
  /** The preamp's cells and lip. */
  at('preamp', [[-58, 82, 0], [-30, 106, 34]]),
  /** v2 `z-D-elevator`: belt D's head over the elevator's chute, the boot. */
  at('D-elevator', [[-75, -215, 0], [-20, -160, 45]]),
  /** The whole elevator. */
  at('elevator', [[-75, -310, 0], [-20, -185, 280]]),
  /** The elevator's head: the wheel, cradles rounding it, the hopper. */
  at('elevator-head', [[-62, -270, 222], [-25, -205, 278]]),
  /** v2 `z-elevator-speaker`: the head, duct and spout over the speaker's throat. */
  at('elevator-speaker', [[-100, -310, 195], [-30, -245, 275]]),
  /** The speaker: cone, throat and meter (turned: from the standard camera the elevator's head hides it). */
  at('speaker', [[-155, -345, 170], [-40, -255, 230]], -45),
];

export const LINE_CARD = {
  fig: 'Line',
  title: 'Packer → centrifuge → render loop → speaker',
  hint: 'beads → packets → rings → quantum → read → speaker',
  label: 'Beads ride belt A into the packer, which boxes three into each packet onto belt B; the centrifuge drains them one per render quantum onto the audio belt; the read arm reads each quantum and sends one audio packet per four down belt D to the elevator, which lifts it to the speaker; spent packets ride belt C to the crusher.',
} as const;

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
