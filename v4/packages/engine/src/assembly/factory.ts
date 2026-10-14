/**
 * The final factory (notes/M10-plan.md §2, M5-M11 plan §2.1): every machine inside the phone's
 * low tray, at the line's layout, fed by the phone's dispenser instead of the bead source. Plain
 * TS, shared by the app (`factory` scene) and the tests.
 *
 * - `FACTORY_LAYOUT`: world positions (the case floor's centre is the origin), every field
 *   required; `stands` is render-only (which machines keep their stands, M10 step 6).
 * - `createFactoryGraph`: the full graph in `FACTORY_ORDER` (no nulls), built from the same path
 *   builders as `createLine`, which stays the test bed with `beads` in place of `dispenser`.
 */
import { type Factory, createFactory } from '../sim/clock.ts';
import type { Centrifuge, SpinController } from '../sim/centrifuge/index.ts';
import type { Conveyor } from '../sim/conveyor.ts';
import type { Crusher } from '../sim/crusher.ts';
import { type Dispenser, dispenserGeometry } from '../sim/dispenser.ts';
import type { Elevator } from '../sim/elevator.ts';
import {
  type BeltDLayout,
  type GarbageLayout,
  type InputLayout,
  LINE_LAYOUT,
  type LoopRun,
  type OutputLayout,
  type TopRun,
  corePath,
  garbagePath,
  inputPath,
  outputPath,
  readPath,
} from '../sim/graphs.ts';
import type { Loop } from '../sim/loop.ts';
import type { Packer } from '../sim/packer.ts';
import type { V3 } from '../sim/ports.ts';
import type { Scanner } from '../sim/scanner.ts';
import type { Speaker } from '../sim/speaker.ts';

/** The phone's case (v2 A: the low tray): plan w × d, corner radius, depth, the lip's height, wall and back thickness. */
export interface CaseDims {
  w: number;
  d: number;
  r: number;
  depth: number;
  cut: number;
  t: number;
  back: number;
}

export interface PhoneLayout {
  case: CaseDims;
  /** The display's underside and its plan shift from the case (it floats above, face up). */
  displayZ: number;
  shift: [number, number];
  /** The dispenser's drop pipe, and its axis (plan): over belt A's in point. */
  neck: number;
  dispenser: [number, number];
}

/** Machines that may stand on a stand or legs (`FactoryLayout.stands`). */
export const STAND_IDS = ['beltA', 'beltB', 'beltC', 'beltD', 'audio', 'packer', 'centrifuge', 'scanner', 'elevator', 'speaker', 'crusher'] as const;
export type StandId = (typeof STAND_IDS)[number];

export interface FactoryLayout {
  phone: PhoneLayout;
  input: InputLayout;
  beltB: TopRun;
  centrifuge: V3;
  audio: LoopRun;
  garbage: GarbageLayout;
  read: { scanner: V3; beltD: BeltDLayout };
  output: OutputLayout;
  /** Render-only: which machines keep their stands or legs (the user: unless they cover other parts). */
  stands: Record<StandId, boolean>;
}

const need = <T>(v: T | undefined, what: string): T => {
  if (v === undefined) throw new Error(`FACTORY_LAYOUT: LINE_LAYOUT has no ${what}`);
  return v;
};

/** v2 A's phone (`assembly/build.mjs` CASE): the low tray, the display at 560 shifted back, the neck 72. */
export const PHONE: PhoneLayout = (() => {
  const input = need(LINE_LAYOUT.input, 'input');
  const a = input.beltA;
  return {
    case: { w: 360, d: 760, r: 44, depth: 280, cut: 36, t: 6, back: 8 },
    displayZ: 560,
    shift: [-80, -24],
    neck: 72,
    // Over belt A's in point (v2 A: DISPENSER_X 20 on the packer's gutter line).
    dispenser: [a.origin[0] + a.inAt, a.origin[1]],
  };
})();

/**
 * Stands per machine (M10 step 6, by eye in `fit` and the views; shots and the table in
 * notes/M10.md). Every machine keeps its stand unless it covers another machine, a belt, a
 * hand-off or an item path.
 */
export const FACTORY_STANDS: Record<StandId, boolean> = {
  /** Off: its 232-tall legs stand in front of the picker's pedestal (A-packer). */
  beltA: false,
  /** Off: its 192-tall legs cross belt D and the elevator's boot (B-centrifuge, D-elevator). */
  beltB: false,
  /** On: 40 tall, under its own belt. */
  beltC: true,
  /** On: 24 tall, behind the loop. */
  beltD: true,
  /** Off: the head's legs stand over belt C's tail and beside the preamp (audio-C, scanner-D). */
  audio: false,
  /** On: under the deck at the tray's back; nothing behind it. */
  packer: true,
  /** On: behind the loop and the release path. */
  centrifuge: true,
  /** On: the preamp's legs, under the preamp. */
  scanner: true,
  /** On: base plates under the tower. */
  elevator: true,
  /** On: its posts stand behind the elevator and belt A (further back), covering nothing. */
  speaker: true,
  /** On: skids and feet under the housing. */
  crusher: true,
};

export const FACTORY_LAYOUT: FactoryLayout = {
  phone: PHONE,
  input: need(LINE_LAYOUT.input, 'input'),
  beltB: LINE_LAYOUT.beltB,
  centrifuge: LINE_LAYOUT.centrifuge,
  audio: LINE_LAYOUT.audio,
  garbage: need(LINE_LAYOUT.garbage, 'garbage'),
  read: need(LINE_LAYOUT.read, 'read'),
  output: need(LINE_LAYOUT.output, 'output'),
  stands: FACTORY_STANDS,
};

export interface FactoryGraph {
  factory: Factory;
  dispenser: Dispenser;
  beltA: Conveyor;
  packer: Packer;
  beltB: Conveyor;
  centrifuge: Centrifuge;
  scanner: Scanner;
  audio: Loop;
  beltC: Conveyor;
  crusher: Crusher;
  beltD: Conveyor;
  elevator: Elevator;
  speaker: Speaker;
}

/** The step order (each reader steps before the belt it reads; senders before receivers). */
export const FACTORY_ORDER = ['dispenser', 'beltA', 'packer', 'beltB', 'centrifuge', 'scanner', 'audio', 'beltC', 'crusher', 'beltD', 'elevator', 'speaker'] as const;
export type MachineId = (typeof FACTORY_ORDER)[number];

/** The dispenser's geometry for a phone layout (its tip is the `dispenser-A` hand-on). */
export const phoneDispenser = (p: PhoneLayout = PHONE) => dispenserGeometry(p);

/** The whole factory: dispenser → belt A → packer → belt B → centrifuge → loop → (C → crusher) / (scanner → D → elevator → speaker). */
export function createFactoryGraph(l: FactoryLayout = FACTORY_LAYOUT, o: { seed?: number; controller?: SpinController } = {}): FactoryGraph {
  const factory = createFactory();
  const p = l.phone;
  const input = inputPath(factory, l.input, o.seed ?? 0, { at: p.dispenser, displayZ: p.displayZ, neck: p.neck });
  const core = corePath(factory, { centrifuge: l.centrifuge, beltB: l.beltB, audio: l.audio, read: l.read }, o);
  factory.link(input.packer, 'out', core.beltB);
  const { beltC, crusher } = garbagePath(factory, core.audio, l.garbage);
  const beltD = readPath(factory, core.scanner!, l.read.beltD);
  const { elevator, speaker } = outputPath(factory, beltD, l.output, { prefill: true });
  const ids = factory.machines.map((m) => m.id);
  if (ids.join() !== FACTORY_ORDER.join()) throw new Error(`createFactoryGraph: step order ${ids.join(', ')} ≠ ${FACTORY_ORDER.join(', ')}`);
  return {
    factory,
    dispenser: input.beads as Dispenser,
    beltA: input.beltA,
    packer: input.packer,
    beltB: core.beltB,
    centrifuge: core.centrifuge,
    scanner: core.scanner!,
    audio: core.audio,
    beltC,
    crusher,
    beltD,
    elevator,
    speaker,
  };
}
