/**
 * Scene graphs: which machines a scene runs, where they stand and how they are linked. Plain TS,
 * shared by the app (one graph per scene, rebuilt on seek) and the tests.
 *
 * - `centrifuge`: the centrifuge on its own, between a short belt B (fed by a source) and a short
 *   audio loop (drained by a sink); the centrifuge's frame is the world.
 * - `line`: source → belt B → centrifuge → audio loop → sink, at the final layout's positions
 *   (notes/M5-M11-plan.md §2.1, from v2 `assembly/build.mjs`).
 */
import { type Factory, createFactory } from './clock.ts';
import { type Conveyor, createConveyor } from './conveyor.ts';
import { CF, type Centrifuge, createCentrifuge } from './centrifuge/index.ts';
import { fallTime } from './fall.ts';
import { type Loop, createLoop } from './loop.ts';
import { type V3, link } from './ports.ts';
import { type Sink, createSink } from './sink.ts';
import { type Source, createSource } from './source.ts';

export interface LineGraph {
  factory: Factory;
  source: Source;
  beltB: Conveyor;
  centrifuge: Centrifuge;
  audio: Loop;
  sink: Sink;
}

export interface LineLayout {
  centrifuge: V3;
  beltB: { origin: V3; length: number; inAt: number };
  audio: { origin: V3; length: number; inAt: number; readAt: number };
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const HAND = CF.spout.hand;
/** Belt B's surface (v2 A: the funnel takes packets 6 above it) and the loop's. */
const TOP_B = 192;
const TOP_AUDIO = 92;

/** The final layout (§2.1): world positions, from v2 A's own derivations. */
export const LINE_LAYOUT: LineLayout = (() => {
  const centri: V3 = [100, 120 - 51.2, 0];
  const beltBOrigin: V3 = [100, -190 + 32, 0];
  const out = add(centri, HAND);
  const audioHead = -90;
  return {
    centrifuge: centri,
    // Head drum and rails stop before the funnel lip (v2 A: CENTRI.y − 49).
    beltB: { origin: beltBOrigin, length: centri[1] - 49 - beltBOrigin[1], inAt: 2 },
    // Tail drum 12 past the spout's hand-on point; parcels land under it; read point at the scanner.
    audio: { origin: [audioHead, out[1], 0], length: out[0] + 12 - audioHead, inAt: out[0] - audioHead, readAt: 30 - audioHead },
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
  // Packets appear 24 above belt B's in point (inside the hopper the blocks draw there).
  const source = factory.add(createSource(clock, ledger, { id: 'source', origin: b.origin, from: [0, b.inAt, TOP_B + 24], seed: o.seed ?? 0 }));
  const beltB = factory.add(
    createConveyor(clock, { id: 'beltB', origin: b.origin, axis: 'y', dir: 1, length: b.length, top: TOP_B, width: 18, inAt: b.inAt, tip: false, hold: true }),
  );
  const audioOpts = { id: 'audio', origin: a.origin, axis: 'x', dir: -1, length: a.length, top: TOP_AUDIO, drum: 15, inAt: a.inAt, readAt: a.readAt } as const;
  // The centrifuge locks onto the cleats at the in point, a fall after the hand-on: a released
  // packet then lands on a cleat (the fall bends to it either way, but barely has to).
  const fall = fallTime(CF.spout.v[2], HAND[2] - (TOP_AUDIO + 1.2));
  let audio: Loop | null = null;
  const centrifuge = factory.add(
    createCentrifuge(clock, {
      id: 'centrifuge',
      origin: layout.centrifuge,
      sync: () => ({ phase: audio!.phaseAt(audio!.geometry.uIn, fall), period: audio!.geometry.cleatGap / audio!.geometry.speed }),
    }),
  );
  audio = factory.add(createLoop(clock, audioOpts));
  const sink = factory.add(createSink(clock, ledger, { id: 'sink', origin: a.origin, floorZ: 0 }));
  link(source, 'out', beltB);
  link(beltB, 'out', centrifuge);
  link(centrifuge, 'out', audio);
  link(audio, 'drop', sink);
  return { factory, source, beltB, centrifuge, audio, sink };
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
  link(source, 'out', beltB);
  link(beltB, 'out', audio);
  link(audio, 'drop', beltC);
  link(beltC, 'out', sink);
  return { factory, source, beltB, audio, beltC, sink };
}
