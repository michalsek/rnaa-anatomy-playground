/**
 * Scene graphs: which machines a scene runs, where they stand and how they are linked. Plain TS,
 * shared by the app (one graph per scene, rebuilt on seek) and the tests.
 *
 * - `centrifuge`: the centrifuge on its own, between a short belt B (fed by a source) and a short
 *   audio loop (drained by a sink); the centrifuge's frame is the world.
 * - `line`: source → belt B → centrifuge → audio loop → belt C → crusher, at the final layout's
 *   positions (notes/M5-M11-plan.md §2.1, from v2 `assembly/build.mjs`);
 * - `crusher`: v2's crusher page: a source drops garbage onto a short belt C that feeds the crusher.
 */
import { type Factory, createFactory } from './clock.ts';
import { type Conveyor, createConveyor } from './conveyor.ts';
import { CF, type Centrifuge, createCentrifuge } from './centrifuge/index.ts';
import { type Crusher, createCrusher } from './crusher.ts';
import { type Loop, createLoop, syncToLoop } from './loop.ts';
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
}

export interface LineLayout {
  centrifuge: V3;
  beltB: { origin: V3; length: number; inAt: number };
  audio: { origin: V3; length: number; inAt: number; readAt: number };
  /** Belt C and the crusher; without them a sink takes the garbage. */
  garbage?: { beltC: { origin: V3; length: number; inAt: number }; crusher: V3 };
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const HAND = CF.spout.hand;
/** Belt B's surface (v2 A: the funnel takes packets 6 above it) and the audio loop's. */
const TOP_B = 192;
const TOP_AUDIO = 92;
/** Belt C's surface: the crusher's feed height (v2 crusher `local.drop` z 40). */
const TOP_C = 40;

/** The final layout (§2.1): world positions, from v2 A's own derivations. */
export const LINE_LAYOUT: LineLayout = (() => {
  const centri: V3 = [100, 120 - 51.2, 0];
  const beltBOrigin: V3 = [100, -190 + 32, 0];
  const out = add(centri, HAND);
  const audioHead = -90;
  const beltC: V3 = [audioHead, out[1] - 22, 0];
  const lengthC = 110;
  return {
    centrifuge: centri,
    // Head drum and rails stop before the funnel lip (v2 A: CENTRI.y − 49).
    beltB: { origin: beltBOrigin, length: centri[1] - 49 - beltBOrigin[1], inAt: 2 },
    // Tail drum 12 past the spout's hand-on point; parcels land under it; read point at the scanner.
    audio: { origin: [audioHead, out[1], 0], length: out[0] + 12 - audioHead, inAt: out[0] - audioHead, readAt: 30 - audioHead },
    // Belt C runs under the loop's head drum (garbage lands 22 along it); it and its rails end
    // before the hopper's back lip (v2 A: the crusher 30 past belt C's end).
    garbage: { beltC: { origin: beltC, length: lengthC, inAt: 22 }, crusher: [audioHead, beltC[1] + lengthC + 30, 0] },
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
  // The loop first (the centrifuge syncs to it), then every machine in step order.
  const audio = createLoop(clock, { id: 'audio', origin: a.origin, axis: 'x', dir: -1, length: a.length, top: TOP_AUDIO, drum: 15, inAt: a.inAt, readAt: a.readAt });
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
  factory.add(audio);
  factory.link(source, 'out', beltB);
  factory.link(beltB, 'out', centrifuge);
  factory.link(centrifuge, 'out', audio);
  const gb = layout.garbage;
  if (!gb) {
    const sink = factory.add(createSink(clock, ledger, { id: 'sink', origin: a.origin, floorZ: 0 }));
    factory.link(audio, 'drop', sink);
    return { factory, source, beltB, centrifuge, audio, beltC: null, crusher: null, sink };
  }
  const c = gb.beltC;
  const beltC = factory.add(createConveyor(clock, { id: 'beltC', origin: c.origin, axis: 'y', dir: 1, length: c.length, top: TOP_C, inAt: c.inAt, tip: false }));
  const crusher = factory.add(createCrusher(clock, ledger, { id: 'crusher', origin: gb.crusher }));
  factory.link(audio, 'drop', beltC);
  factory.link(beltC, 'out', crusher);
  return { factory, source, beltB, centrifuge, audio, beltC, crusher, sink: null };
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
  // Belt C ends where the line's does: 30 before the crusher's centre.
  const cOrigin: V3 = [0, -30 - length, 0];
  const source = factory.add(
    createSource(clock, ledger, { id: 'source', origin: cOrigin, from: [0, 8, TOP_C + 24], every: RATES.crusherFeed, delay: 0.6, burst: 1, rest: 0, kinds: ['garbage'], seed: o.seed ?? 0 }),
  );
  const beltC = factory.add(createConveyor(clock, { id: 'beltC', origin: cOrigin, axis: 'y', dir: 1, length, top: TOP_C, inAt: 8, tip: false }));
  const crusher = factory.add(createCrusher(clock, ledger, { id: 'crusher', origin: [0, 0, 0] }));
  factory.link(source, 'out', beltC);
  factory.link(beltC, 'out', crusher);
  return { factory, source, beltC, crusher };
}
