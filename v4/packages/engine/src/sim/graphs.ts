/**
 * Scene graphs: which machines a scene runs, where they stand and how they are linked. Plain TS,
 * shared by the app (one graph per scene, rebuilt on seek) and the tests.
 *
 * - `centrifuge`: the centrifuge on its own, between a short belt B (fed by a source) and a short
 *   audio loop (drained by a sink); the centrifuge's frame is the world.
 * - `line`: source → belt B → centrifuge → audio loop → belt C → crusher, at the final layout's
 *   positions (notes/M5-M11-plan.md §2.1, from v2 `assembly/build.mjs`);
 * - `crusher`: v2's crusher page: a source drops garbage onto a short belt C that feeds the crusher.
 * - `line` also runs the read path (M7) and the output path (M8): the scanner reads the loop, belt
 *   D carries its packets to the elevator, which lifts them to the speaker; `scanner`: v2's scanner
 *   page (a source over the loop); `output`: a source over a short belt D, the elevator, the speaker.
 */
import { type Factory, createFactory } from './clock.ts';
import { type Conveyor, createConveyor } from './conveyor.ts';
import { CF, type Centrifuge, createCentrifuge } from './centrifuge/index.ts';
import { CR, type Crusher, createCrusher } from './crusher.ts';
import { type Elevator, createElevator, elevatorGeometry } from './elevator.ts';
import { type Speaker, createSpeaker } from './speaker.ts';
import { fallTime } from './fall.ts';
import { type Loop, createLoop, loopGeometry, syncToLoop } from './loop.ts';
import { SCANNER_OUT, type Scanner, createScanner, scannerReadAt } from './scanner.ts';
import type { V3 } from './ports.ts';
import { type Sink, createSink } from './sink.ts';
import { RATES } from './rates.ts';
import { type Source, createSource } from './source.ts';

export interface LineGraph {
  factory: Factory;
  source: Source;
  beltB: Conveyor;
  centrifuge: Centrifuge;
  audio: Loop;
  /** The garbage path (the line's layout), or a sink under the loop's drop (the centrifuge's). */
  beltC: Conveyor | null;
  crusher: Crusher | null;
  sink: Sink | null;
  /** The read path (the line's layout): the scanner, belt D; the output path: the elevator and the speaker. */
  scanner: Scanner | null;
  beltD: Conveyor | null;
  elevator: Elevator | null;
  speaker: Speaker | null;
}

/** Belt D's run: from under the scanner's hand-on point (local) along −y to `headY` (world). */
export interface BeltDLayout {
  origin: V3;
  length: number;
  inAt: number;
}

export interface LineLayout {
  centrifuge: V3;
  beltB: { origin: V3; length: number; inAt: number };
  audio: { origin: V3; length: number; inAt: number; readAt: number };
  /** Belt C and the crusher; without them a sink takes the garbage. */
  garbage?: { beltC: { origin: V3; length: number; inAt: number }; crusher: V3 };
  /**
   * The scanner, belt D, the elevator at belt D's head and the speaker under its spout; with them
   * the loop's read point snaps to the scanner (`scannerReadAt`) and `audio.readAt` is unused.
   */
  read?: { scanner: V3; beltD: BeltDLayout; elevator: V3; speaker: V3 };
}

/** Belt D's surface: the preamp's lip (v2 A: top 24). */
const TOP_D = SCANNER_OUT.at[2];

/**
 * Belt D under a scanner at `scanner` (world), running −y to its head drum at `headY` (where it
 * hands on, over the elevator's chute): the packet leaves the lip moving at the push's speed and
 * lands where that motion takes it in the belt's shortest fall (the in point, 1 inside the tail),
 * so it barely bends.
 */
export function beltDUnder(scanner: V3, headY: number): BeltDLayout {
  const { at, v } = SCANNER_OUT;
  const inY = scanner[1] + at[1] + v[1] * fallTime(0, 0);
  const tail = inY + 1;
  return { origin: [scanner[0] + at[0], headY, 0], length: tail - headY, inAt: tail - headY - 1 };
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const HAND = CF.spout.hand;
/** Belt B's surface (v2 A: the funnel takes packets 6 above it) and the audio loop's. */
const TOP_B = 192;
const TOP_AUDIO = 92;
/** Belt C's surface and end: the crusher's feed point (v2 crusher `local.drop`). */
const TOP_C = CR.drop[2];
const C_END = CR.drop[1];

/** The elevator's in-feed chute starts this far past belt D's head drum (v2 A: ELEV_Y + 51 = belt D's head). */
const ELEV_BACK = 51;
/** The elevator's lift and spout reach on the line (v2 A), and the speaker's baffle height. */
const ELEV_LIFT = 210;
const ELEV_REACH = 40;
const SPEAKER_HEIGHT = 220;
/** The speaker sits so its ledge's end is 2 past the spout's centre (v2 A: speaker = spout − [62, 0]). */
const SPEAKER_BACK = 62;

/** The elevator under belt D's head and the speaker under the elevator's spout (world). */
function outputAt(beltDHead: V3): { elevator: V3; speaker: V3 } {
  const elevator: V3 = [beltDHead[0], beltDHead[1] - ELEV_BACK, 0];
  const spout = elevatorGeometry({ lift: ELEV_LIFT, reach: ELEV_REACH }).spout;
  return { elevator, speaker: [elevator[0] + spout[0] - SPEAKER_BACK, elevator[1] + spout[1], 0] };
}

/** The final layout (§2.1): world positions, from v2 A's own derivations. */
export const LINE_LAYOUT: LineLayout = (() => {
  const centri: V3 = [100, 120 - 51.2, 0];
  const beltBOrigin: V3 = [100, -190 + 32, 0];
  const out = add(centri, HAND);
  const audioHead = -90;
  const beltC: V3 = [audioHead, out[1] - 22, 0];
  const lengthC = 110;
  const scanner: V3 = [30, out[1] - 38, 0];
  const beltD = beltDUnder(scanner, -175);
  return {
    centrifuge: centri,
    // Head drum and rails stop before the funnel lip (v2 A: CENTRI.y − 49).
    beltB: { origin: beltBOrigin, length: centri[1] - 49 - beltBOrigin[1], inAt: 2 },
    // Tail drum 12 past the spout's hand-on point; parcels land under it. readAt is v2's; with the
    // scanner (`read`) the read point snaps to it instead.
    audio: { origin: [audioHead, out[1], 0], length: out[0] + 12 - audioHead, inAt: out[0] - audioHead, readAt: 30 - audioHead },
    // Belt C runs under the loop's head drum (garbage lands 22 along it) and ends at the crusher's
    // feed point (v2 A put the crusher 30 past its end, 4 more than the crusher's own drop).
    garbage: { beltC: { origin: beltC, length: lengthC, inAt: 22 }, crusher: [audioHead, beltC[1] + lengthC - C_END, 0] },
    // The scanner 38 behind the loop's centreline (v2 A: its head over the near margin); belt D
    // from under its lip to the elevator's chute (v2 A: ELEV_Y + 51 = −175); the speaker under the
    // elevator's spout.
    read: { scanner, beltD, ...outputAt(beltD.origin) },
  };
})();

/** The centrifuge scene: the same neighbours, shortened (belt B 60, loop 120), centrifuge at 0. */
export const CENTRIFUGE_LAYOUT: LineLayout = {
  centrifuge: [0, 0, 0],
  beltB: { origin: [0, -49 - 60, 0], length: 60, inAt: 8 },
  audio: { origin: [HAND[0] + 12 - 120, HAND[1], 0], length: 120, inAt: 108, readAt: 60 },
};

export function createLine(layout: LineLayout = LINE_LAYOUT, o: { seed?: number } = {}): LineGraph {
  const factory = createFactory();
  const { clock, ledger } = factory;
  const b = layout.beltB;
  const a = layout.audio;
  const rd = layout.read;
  // The loop first (the centrifuge syncs to it), then every machine in step order. With a
  // scanner, its read point is the scanner's (one source of reads).
  const loopOpts = { id: 'audio', origin: a.origin, axis: 'x', dir: -1, length: a.length, top: TOP_AUDIO, drum: 15, inAt: a.inAt, readAt: a.readAt } as const;
  const readAt = rd ? scannerReadAt(loopGeometry(loopOpts), a.origin, rd.scanner) : a.readAt;
  const audio = createLoop(clock, { ...loopOpts, readAt });
  // Packets appear 24 above belt B's in point (inside the hopper the blocks draw there).
  const source = factory.add(createSource(clock, ledger, { id: 'source', origin: b.origin, from: [0, b.inAt, TOP_B + 24], seed: o.seed ?? 0 }));
  const beltB = factory.add(
    createConveyor(clock, { id: 'beltB', origin: b.origin, axis: 'y', dir: 1, length: b.length, top: TOP_B, width: 18, inAt: b.inAt, tip: false, hold: true }),
  );
  // The centrifuge locks onto the cleats at the in point, a fall after the hand-on: a released
  // packet then lands on a cleat (the fall bends to it either way, but barely has to).
  const centrifuge = factory.add(
    createCentrifuge(clock, { id: 'centrifuge', origin: layout.centrifuge, sync: syncToLoop(audio, add(layout.centrifuge, HAND), CF.spout.v) }),
  );
  // The scanner reads the loop as the loop stood after the last step (it steps first).
  const scanner = rd ? factory.add(createScanner(clock, ledger, { id: 'scanner', origin: rd.scanner, loop: audio })) : null;
  factory.add(audio);
  factory.link(source, 'out', beltB);
  factory.link(beltB, 'out', centrifuge);
  factory.link(centrifuge, 'out', audio);
  const gb = layout.garbage;
  let beltC: Conveyor | null = null;
  let crusher: Crusher | null = null;
  let sink: Sink | null = null;
  if (gb) {
    const c = gb.beltC;
    // Belt C holds so the crusher takes one packet at a time (its hopper's `canAccept`).
    beltC = factory.add(createConveyor(clock, { id: 'beltC', origin: c.origin, axis: 'y', dir: 1, length: c.length, top: TOP_C, inAt: c.inAt, tip: false, hold: true }));
    crusher = factory.add(createCrusher(clock, ledger, { id: 'crusher', origin: gb.crusher }));
    factory.link(audio, 'drop', beltC);
    factory.link(beltC, 'out', crusher);
  } else {
    sink = factory.add(createSink(clock, ledger, { id: 'sink', origin: a.origin, floorZ: 0 }));
    factory.link(audio, 'drop', sink);
  }
  let beltD: Conveyor | null = null;
  let elevator: Elevator | null = null;
  let speaker: Speaker | null = null;
  if (scanner && rd) {
    beltD = factory.add(createBeltD(factory, rd.beltD, 'hand'));
    factory.link(scanner, 'out', beltD);
    ({ elevator, speaker } = outputPath(factory, beltD, rd, { prefill: true }));
  }
  return { factory, source, beltB, centrifuge, audio, beltC, crusher, sink, scanner, beltD, elevator, speaker };
}

/**
 * Belt D (−y, v2 A: speed 28, top 24): `tip` ends off its head drum (into a crate), `hand` hands
 * on at the head drum's axis at belt height (over the elevator's chute, v2 A: `tip: false`).
 */
function createBeltD(factory: Factory, d: BeltDLayout, end: 'tip' | 'hand') {
  return createConveyor(factory.clock, {
    id: 'beltD',
    origin: d.origin,
    axis: 'y',
    dir: -1,
    length: d.length,
    top: TOP_D,
    width: 18,
    speed: RATES.beltDSpeed,
    inAt: d.inAt,
    outAt: 0,
    tip: end === 'tip',
  });
}

/** The output path after belt D (added after it, in step order): belt D → elevator → speaker. */
function outputPath(factory: Factory, beltD: Conveyor, at: { elevator: V3; speaker: V3 }, o: { prefill: boolean }) {
  const { clock, ledger } = factory;
  if (beltD.geometry.tip) throw new Error('outputPath: belt D must hand on at its head (tip: false)');
  const elevator = factory.add(createElevator(clock, ledger, { id: 'elevator', origin: at.elevator, lift: ELEV_LIFT, reach: ELEV_REACH, prefill: o.prefill }));
  const speaker = factory.add(createSpeaker(clock, ledger, { id: 'speaker', origin: at.speaker, height: SPEAKER_HEIGHT }));
  factory.link(beltD, 'out', elevator);
  factory.link(elevator, 'out', speaker);
  return { elevator, speaker };
}

export interface ScannerPageGraph {
  factory: Factory;
  source: Source;
  audio: Loop;
  scanner: Scanner;
  beltD: Conveyor;
  /** Under the loop's drop, and at belt D's end. */
  sink: Sink;
  sinkD: Sink;
}

/**
 * v2's scanner page (`parts/scanner/build.mjs`): the audio loop (L 170) fed a packet every
 * RATES.scannerFeed s from a hopper over its in point, the scanner behind it (loop origin +
 * [90, −38]), belt D from the scanner's lip (shortened, tipping into a crate: the elevator and
 * the speaker have their own page, `output`).
 */
export function createScannerPage(o: { seed?: number } = {}): ScannerPageGraph {
  const factory = createFactory();
  const { clock, ledger } = factory;
  const aOrigin: V3 = [-120, 70, 0];
  const at: V3 = [aOrigin[0] + 90, aOrigin[1] - 38, 0];
  const loopOpts = { id: 'audio', origin: aOrigin, axis: 'x', dir: -1, length: 170, top: TOP_AUDIO, drum: 15 } as const;
  const g0 = loopGeometry(loopOpts);
  const audio = createLoop(clock, { ...loopOpts, readAt: scannerReadAt(g0, aOrigin, at) });
  const g = audio.geometry;
  // The hopper's mouth 14 over the cleats at the in point (a short fall).
  const source = factory.add(
    createSource(clock, ledger, {
      id: 'source',
      origin: aOrigin,
      from: [g.inS, 0, g.T + g.CH + 14],
      every: RATES.scannerFeed,
      delay: 0.3,
      burst: 1,
      rest: 0,
      kinds: ['control', 'graph', 'data'],
      seed: o.seed ?? 0,
    }),
  );
  const scanner = factory.add(createScanner(clock, ledger, { id: 'scanner', origin: at, loop: audio }));
  factory.add(audio);
  const sink = factory.add(createSink(clock, ledger, { id: 'sink', origin: aOrigin, floorZ: 0 }));
  factory.link(source, 'out', audio);
  factory.link(audio, 'drop', sink);
  const beltD = factory.add(createBeltD(factory, beltDUnder(at, at[1] - 60), 'tip'));
  const sinkD = factory.add(createSink(clock, ledger, { id: 'sinkD', origin: beltD.origin, floorZ: 0 }));
  factory.link(scanner, 'out', beltD);
  factory.link(beltD, 'out', sinkD);
  return { factory, source, audio, scanner, beltD, sinkD, sink };
}

export interface ConveyorPageGraph {
  factory: Factory;
  source: Source;
  beltB: Conveyor;
  audio: Loop;
  beltC: Conveyor;
  sink: Sink;
}

/**
 * v2's conveyor page (`parts/conveyor/build.mjs`): a top belt like belt B tips parcels onto the
 * audio loop; spent parcels drop off its head drum onto a second top belt like belt C, which
 * tips them into a bin. The page's own layout and feed (one item per 1.7 s, some garbage).
 */
export function createConveyorPage(o: { seed?: number } = {}): ConveyorPageGraph {
  const factory = createFactory();
  const { clock, ledger } = factory;
  const bOrigin: V3 = [74, -50, 0];
  const source = factory.add(
    createSource(clock, ledger, {
      id: 'source',
      origin: bOrigin,
      from: [0, 8, 140],
      every: 1.7,
      delay: 0.3,
      burst: 9,
      rest: 0,
      kinds: ['control', 'graph', 'control', 'data', 'control', 'graph', 'garbage', 'control', 'data'],
      seed: o.seed ?? 0,
    }),
  );
  const beltB = factory.add(createConveyor(clock, { id: 'beltB', origin: bOrigin, axis: 'y', dir: 1, length: 110, top: 124, inAt: 8, outAt: 110, hold: true }));
  const audio = factory.add(createLoop(clock, { id: 'audio', origin: [-130, 74, 0], axis: 'x', dir: -1, length: 216, top: 92, drum: 15, inAt: 204, readAt: 100 }));
  const beltC = factory.add(createConveyor(clock, { id: 'beltC', origin: [-130, 52, 0], axis: 'y', dir: 1, length: 90, top: 30, inAt: 22, outAt: 90 }));
  const sink = factory.add(createSink(clock, ledger, { id: 'sink', origin: [-130, 52, 0], floorZ: 0 }));
  factory.link(source, 'out', beltB);
  factory.link(beltB, 'out', audio);
  factory.link(audio, 'drop', beltC);
  factory.link(beltC, 'out', sink);
  return { factory, source, beltB, audio, beltC, sink };
}

export interface CrusherPageGraph {
  factory: Factory;
  source: Source;
  beltC: Conveyor;
  crusher: Crusher;
}

/**
 * v2's crusher page (`parts/crusher/build.mjs`): a spent packet every RATES.crusherFeed s drops
 * onto a short belt C, which hands it over the hopper's back lip; the crusher at the origin.
 */
export function createCrusherPage(o: { seed?: number } = {}): CrusherPageGraph {
  const factory = createFactory();
  const { clock, ledger } = factory;
  const length = 50;
  // Belt C ends at the crusher's feed point, as on the line.
  const cOrigin: V3 = [0, C_END - length, 0];
  const source = factory.add(
    createSource(clock, ledger, { id: 'source', origin: cOrigin, from: [0, 8, TOP_C + 24], every: RATES.crusherFeed, delay: 0.6, burst: 1, rest: 0, kinds: ['garbage'], seed: o.seed ?? 0 }),
  );
  const beltC = factory.add(createConveyor(clock, { id: 'beltC', origin: cOrigin, axis: 'y', dir: 1, length, top: TOP_C, inAt: 8, tip: false, hold: true }));
  const crusher = factory.add(createCrusher(clock, ledger, { id: 'crusher', origin: [0, 0, 0] }));
  factory.link(source, 'out', beltC);
  factory.link(beltC, 'out', crusher);
  return { factory, source, beltC, crusher };
}

export interface OutputPageGraph {
  factory: Factory;
  source: Source;
  beltD: Conveyor;
  elevator: Elevator;
  speaker: Speaker;
}

/**
 * The output path on its own (no v2 page; v2 A's layout): a source drops an audio packet every
 * RATES.outputFeed s (the line's rate: one per 4 quanta) from a hopper onto a 60-long belt D,
 * which hands on over the elevator's chute; the elevator lifts it to the speaker. The elevator's
 * column at the origin.
 */
export function createOutputPage(o: { seed?: number } = {}): OutputPageGraph {
  const factory = createFactory();
  const { clock, ledger } = factory;
  const head: V3 = [0, ELEV_BACK, 0];
  const length = 60;
  const d: BeltDLayout = { origin: head, length, inAt: length - 8 };
  const at = outputAt(head);
  const source = factory.add(
    createSource(clock, ledger, {
      id: 'source',
      origin: head,
      from: [0, d.inAt, TOP_D + 24],
      every: RATES.outputFeed,
      delay: 0.4,
      burst: 1,
      rest: 0,
      kinds: ['audio'],
      seed: o.seed ?? 0,
    }),
  );
  const beltD = factory.add(createBeltD(factory, d, 'hand'));
  factory.link(source, 'out', beltD);
  const { elevator, speaker } = outputPath(factory, beltD, at, { prefill: true });
  return { factory, source, beltD, elevator, speaker };
}
