/**
 * Test rigs: the centrifuge between real neighbours. Checkpoint A's rig is M4's page with the
 * stubs replaced: a source drops packets onto a short belt B (hold) that feeds the funnel, and the
 * releases fall onto a top belt (M4's stub belt geometry, 0.42 s quanta from a fixed clock) that
 * tips them into a sink.
 */
import { type Factory, createFactory } from '../src/sim/clock.ts';
import { createConveyor } from '../src/sim/conveyor.ts';
import { CF, createCentrifuge } from '../src/sim/centrifuge/index.ts';
import { link } from '../src/sim/ports.ts';
import { createSink } from '../src/sim/sink.ts';
import { createSource } from '../src/sim/source.ts';

const mod = (a: number, n: number) => ((a % n) + n) % n;

export function topRig(o: { seed?: number } = {}) {
  const f: Factory = createFactory();
  const beltBOrigin: [number, number, number] = [0, -109, 0];
  const source = f.add(createSource(f.clock, f.ledger, { id: 'source', origin: beltBOrigin, from: [0, 8, 216], seed: o.seed ?? 0 }));
  const beltB = f.add(
    createConveyor(f.clock, { id: 'beltB', origin: beltBOrigin, axis: 'y', dir: 1, length: 60, top: 192, width: 18, inAt: 8, tip: false, hold: true }),
  );
  // M4's stub belt: x −78..10 at y = the hand-on y, top 92, 12 per 0.42 s.
  const hand = CF.spout.hand;
  const period = 0.42;
  const audio = createConveyor(f.clock, {
    id: 'audio',
    origin: [-78, hand[1], 0],
    axis: 'x',
    dir: -1,
    length: 88,
    top: 92,
    speed: 12 / period,
    pitch: 12,
    inAt: hand[0] + 78,
  });
  const centrifuge = f.add(
    createCentrifuge(f.clock, {
      id: 'centrifuge',
      origin: [0, 0, 0],
      sync: () => ({ phase: mod(f.clock.t / period, 1), period }),
    }),
  );
  f.add(audio);
  const sink = f.add(createSink(f.clock, f.ledger, { id: 'sink', origin: [0, 0, 0], floorZ: 0 }));
  link(source, 'out', beltB);
  link(beltB, 'out', centrifuge);
  link(centrifuge, 'out', audio);
  link(audio, 'out', sink);
  return { f, source, beltB, centrifuge, audio, sink };
}

/** Plain-data snapshot of every machine (determinism checks). */
export function snapshot(f: Factory, parts: Record<string, unknown>) {
  return structuredClone({ t: f.clock.t, acc: f.clock.acc, created: f.ledger.created, consumed: f.ledger.consumed, ...parts });
}
