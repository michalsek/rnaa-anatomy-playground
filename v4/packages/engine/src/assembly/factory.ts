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
  type LoopRun,
  type OutputLayout,
  type TopRun,
  beltDUnder,
  corePath,
  garbagePath,
  inputAt,
  inputPath,
  outputAt,
  outputPath,
  readPath,
} from '../sim/graphs.ts';
import { CF } from '../sim/centrifuge/index.ts';
import { CR } from '../sim/crusher.ts';
import { PK } from '../sim/packer.ts';
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

/**
 * The factory's layout knobs (M11 re-layout, notes/M11.md): everything else is derived as the
 * line's layout (`LINE_LAYOUT`, v2 A's derivations), which stays the test bed.
 */
export interface FactoryKnobs {
  /** The input chain's line (y): the bead drop, belt A, the packer; belt B runs from it to the centrifuge. */
  inputY: number;
  /** Belt A's tail and the bead drop (x, on belt A; the dispenser's axis). */
  beltATail: number;
  dropX: number;
  /** Belt D's head (y): the elevator's chute 51 behind it; the speaker under its spout. */
  beltDHead: number;
  /** The speaker's turn (a multiple of 90; 0: v2, on the spout's −x side) and its driver's scale. */
  speaker: { yaw: number; scale: number };
  /** The loop's head drum (x): garbage drops off it onto belt C. */
  audioHead: number;
  /** Belt C and the crusher from under the loop's head: toward the front (+y, v2) or turned to the back. */
  disposal: 'front' | 'back';
}

/** M10's layout (v2 A's): the knobs that reproduce `LINE_LAYOUT`. */
export const V2_KNOBS: FactoryKnobs = { inputY: -190, beltATail: -4, dropX: 20, beltDHead: -175, speaker: { yaw: 0, scale: 1 }, audioHead: -90, disposal: 'front' };

/**
 * M11's layout (by eye, before/after shots; the reasons in notes/M11.md): the input chain moved
 * forward, the elevator a little forward, the speaker turned to the back-right corner the input
 * chain left, and twice v2's size.
 */
export const M11_KNOBS: FactoryKnobs = { inputY: -100, beltATail: -4, dropX: 20, beltDHead: -175, speaker: { yaw: 180, scale: 2 }, audioHead: -90, disposal: 'front' };

/** The layout for a set of knobs (world; the case floor's centre is the origin). */
export function factoryLayout(k: FactoryKnobs): Omit<FactoryLayout, 'phone' | 'stands'> {
  const packer: V3 = [100, k.inputY, 0];
  const centri: V3 = [100, 120 - 51.2, 0];
  const beltBOrigin: V3 = [packer[0], packer[1] + PK.beltB, 0];
  const out: V3 = [centri[0] + CF.spout.hand[0], centri[1] + CF.spout.hand[1], 0];
  const audioHead = k.audioHead;
  const lengthC = 110;
  // Belt C: garbage lands 22 along it from its tail under the loop's head drum; it ends at the
  // crusher's feed point (CR.drop, local −y: the crusher turned 180° takes it from +y).
  const back = k.disposal === 'back';
  const beltCOrigin: V3 = back ? [audioHead, out[1] + 22 - lengthC, 0] : [audioHead, out[1] - 22, 0];
  const crusherY = back ? beltCOrigin[1] + CR.drop[1] : beltCOrigin[1] + lengthC - CR.drop[1];
  const scanner: V3 = [30, out[1] - 38, 0];
  const beltD = beltDUnder(scanner, k.beltDHead);
  return {
    centrifuge: centri,
    input: inputAt(packer, k.beltATail, k.dropX),
    beltB: { origin: beltBOrigin, length: centri[1] - 49 - beltBOrigin[1], inAt: 2 },
    audio: { origin: [audioHead, out[1], 0], length: out[0] + 12 - audioHead, inAt: out[0] - audioHead, readAt: 30 - audioHead },
    garbage: back
      ? { beltC: { origin: beltCOrigin, length: lengthC, inAt: lengthC - 22, dir: -1 }, crusher: [audioHead, crusherY, 0], yaw: 180 }
      : { beltC: { origin: beltCOrigin, length: lengthC, inAt: 22 }, crusher: [audioHead, crusherY, 0] },
    read: { scanner, beltD },
    output: outputAt(beltD.origin, { yaw: k.speaker.yaw, scale: k.speaker.scale }),
  };
}

/** The phone's case (v2 A: the low tray), the display at 560 shifted back, the neck 72. */
export const PHONE_CASE: CaseDims = { w: 360, d: 760, r: 44, depth: 280, cut: 36, t: 6, back: 8 };

/** v2 A's phone (`assembly/build.mjs` CASE) over a layout's input path: the dispenser over belt A's in point. */
export function phoneOver(input: InputLayout): PhoneLayout {
  const a = input.beltA;
  return { case: PHONE_CASE, displayZ: 560, shift: [-80, -24], neck: 72, dispenser: [a.origin[0] + a.inAt, a.origin[1]] };
}

const M11 = factoryLayout(M11_KNOBS);

/** The phone over the factory's input path (the dispenser hangs over belt A's in point). */
export const PHONE: PhoneLayout = phoneOver(M11.input);

/**
 * Stands per machine (M10 step 6, re-checked for M11's layout; by eye in `fit` and the views;
 * shots and the tables in notes/M10.md, notes/M11.md). Every machine keeps its stand unless it
 * covers another machine, a belt, a hand-off or an item path.
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
  /** On: under the deck; behind it only the speaker's stand posts (M11), no machine, belt or hand-off. */
  packer: true,
  /** On: behind the loop and the release path. */
  centrifuge: true,
  /** On: the preamp's legs, under the preamp. */
  scanner: true,
  /** On: base plates under the tower. */
  elevator: true,
  /** On: its posts stand in the back-right corner behind the packer and beside the elevator (M11), covering nothing. */
  speaker: true,
  /** On: skids and feet under the housing. */
  crusher: true,
};

export const FACTORY_LAYOUT: FactoryLayout = { ...M11, phone: PHONE, stands: FACTORY_STANDS };

/** A whole factory layout for a set of knobs (the phone over its input path; M10's stands). */
export function layoutFor(k: FactoryKnobs): FactoryLayout {
  const l = factoryLayout(k);
  return { ...l, phone: phoneOver(l.input), stands: FACTORY_STANDS };
}

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
