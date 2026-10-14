/**
 * The factory's views (M10 step 5), authored per machine in its local frame and placed once from
 * the layout's origins (`placeViews`), so a moved machine keeps its views. Named after v2's
 * `assembly/shots/z-*` crops (the cross views: both ends of a hand-off) plus one view per machine.
 * Each view names the card it shows (`card`: the text follows the view, the stage never changes).
 * Plain module (no components).
 */
import { type Box3, FACTORY_LAYOUT, type FactoryLayout, type PlaceId, type ViewPreset, machineOrigins, shiftBox } from '@anatomy/engine';

/** The cards a view can show (`cards.ts`). */
export type CardKey = 'factory' | 'dispenser' | 'packer' | 'centrifuge' | 'loop' | 'crusher' | 'scanner' | 'output';

/** A view in a machine's local frame (`frame` local; `yaw` in degrees, default 45). */
export interface LocalView {
  name: string;
  of: PlaceId;
  frame: Box3;
  yaw?: number;
  card: CardKey;
}

export interface FactoryView extends ViewPreset {
  card: CardKey;
}

/**
 * The views. `fit` frames the tray and the machines (16:9: the floating display may be cut at
 * the top, the user's §10 answer); `phone` the display with the dispenser under it.
 */
export const FACTORY_LOCAL_VIEWS: readonly LocalView[] = [
  { name: 'fit', of: 'phone', frame: [[-180, -380, -8], [180, 380, 282]], card: 'factory' },
  { name: 'phone', of: 'phone', frame: [[-260, -404, 437], [100, 356, 566]], card: 'factory' },
  { name: 'case', of: 'phone', frame: [[-180, -380, -8], [180, 380, 36]], card: 'factory' },
  // ---- the hand-offs, in flow order (v2 z-*) ----
  /** v2 `z-dispenser-A`: the dispenser's valve and nozzle, the bead's fall, belt A's in point. */
  { name: 'dispenser-A', of: 'phone', frame: [[-2, -208, 222], [44, -172, 452]], card: 'dispenser' },
  /** v2 `z-A-packer`: belt A's head, the transfer plate, the gutter and the picker. */
  { name: 'A-packer', of: 'packer', frame: [[-65, -25, 195], [5, 22, 258]], card: 'packer' },
  /** v2 `z-packer-B`: the lane's nose over belt B's tail. */
  { name: 'packer-B', of: 'packer', frame: [[-15, 5, 185], [18, 50, 225]], card: 'packer' },
  /** v2 `z-B-centrifuge`: belt B's head over the funnel. */
  { name: 'B-centrifuge', of: 'centrifuge', frame: [[-20, -78.8, 160], [25, -18.8, 215]], card: 'centrifuge' },
  /** v2 `z-centrifuge-audio`: the centrifuge over the audio belt. */
  { name: 'centrifuge-audio', of: 'centrifuge', frame: [[-60, -48.8, 40], [40, 81.2, 205]], card: 'centrifuge' },
  /** The gate, the spout and the release onto a cleat. */
  { name: 'release', of: 'centrifuge', frame: [[-24, 31.2, 88], [18, 69.2, 128]], card: 'centrifuge' },
  /** v2 `z-scanner-read`: the arm over the loop, the preamp and the cable. */
  { name: 'scanner-read', of: 'scanner', frame: [[-86, 6.06, 10], [10, 42.06, 100]], card: 'scanner' },
  /** v2 `z-audio-C`: the loop's head drum over belt C, where garbage drops. */
  { name: 'audio-C', of: 'audio', frame: [[-35, -27.94, 0], [35, 40.06, 112]], card: 'loop' },
  /** v2 `z-C-crusher`: belt C's end and the crusher. */
  { name: 'C-crusher', of: 'crusher', frame: [[-32, -37.94, 0], [32, 56.06, 40]], card: 'crusher' },
  /** v2 `z-scanner-D`: the preamp's lip and the start of belt D. */
  { name: 'scanner-D', of: 'scanner', frame: [[-96, -21.94, 8], [-52, 22.06, 44]], card: 'scanner' },
  /** v2 `z-D-elevator`: belt D's head over the elevator's chute, the boot. */
  { name: 'D-elevator', of: 'elevator', frame: [[-28, 11, 0], [27, 66, 45]], card: 'output' },
  /** v2 `z-elevator-speaker`: the head, duct and spout over the speaker's throat. */
  { name: 'elevator-speaker', of: 'elevator', frame: [[-53, -84, 195], [17, -19, 275]], card: 'output' },
  // ---- one per machine ----
  { name: 'dispenser', of: 'phone', frame: [[6, -204, 432], [36, -176, 562]], card: 'dispenser' },
  { name: 'packer', of: 'packer', frame: [[-32, -34, 176], [32, 28, 258]], card: 'packer' },
  { name: 'centrifuge', of: 'centrifuge', frame: [[-50, -55, 0], [55, 60, 215]], card: 'centrifuge' },
  { name: 'loop', of: 'audio', frame: [[-20, -16, 0], [215, 16, 112]], card: 'loop' },
  { name: 'crusher', of: 'crusher', frame: [[-38, -31.94, 0], [40, 64.06, 38]], card: 'crusher' },
  { name: 'scanner', of: 'scanner', frame: [[-100, -20, 0], [25, 45, 106]], card: 'scanner' },
  { name: 'elevator', of: 'elevator', frame: [[-28, -84, 0], [27, 41, 280]], card: 'output' },
  /** Turned (yaw −45): from the standard camera the elevator's head hides it. */
  { name: 'speaker', of: 'speaker', frame: [[-46, -45, 170], [69, 45, 230]], yaw: -45, card: 'output' },
];

/** Views placed in the world (each machine's origin added once). */
export function placeViews(layout: FactoryLayout, list: readonly LocalView[]): FactoryView[] {
  const o = machineOrigins(layout);
  return list.map((v) => ({ name: v.name, yaw: v.yaw ?? 45, elevation: 30, zoom: 1, frame: shiftBox(v.frame, o[v.of]), card: v.card }));
}

export const FACTORY_VIEWS: FactoryView[] = placeViews(FACTORY_LAYOUT, FACTORY_LOCAL_VIEWS);
