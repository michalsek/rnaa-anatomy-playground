/**
 * Test rigs: the centrifuge between real neighbours. Checkpoint A's rig is M4's page with the
 * stubs replaced: a source drops packets onto a short belt B (hold) that feeds the funnel, and the
 * releases fall onto a top belt (M4's stub belt geometry, 0.42 s quanta from a fixed clock) that
 * tips them into a sink.
 */
import { type Factory, createFactory } from '../src/sim/clock.ts';
import { createConveyor } from '../src/sim/conveyor.ts';
import { CF, type SpinController, createCentrifuge, createRampController, createSpinController } from '../src/sim/centrifuge/index.ts';
import { mod } from '../src/sim/math.ts';
import { createSink } from '../src/sim/sink.ts';
import { createSource } from '../src/sim/source.ts';

/** The spin models the contract tests run over (name, factory). */
export const CONTROLLERS: [string, () => SpinController][] = [
  ['default', () => createSpinController()],
  ['ramp', () => createRampController()],
];

export function topRig(o: { seed?: number; controller?: SpinController } = {}) {
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
      ...(o.controller && { controller: o.controller }),
    }),
  );
  f.add(audio);
  const sink = f.add(createSink(f.clock, f.ledger, { id: 'sink', origin: [0, 0, 0], floorZ: 0 }));
  f.link(source, 'out', beltB);
  f.link(beltB, 'out', centrifuge);
  f.link(centrifuge, 'out', audio);
  f.link(audio, 'out', sink);
  return { f, source, beltB, centrifuge, audio, sink };
}

/** Plain-data snapshot of every machine's `status()` plus `parts` (determinism checks). */
export function snapshot(f: Factory, parts: Record<string, unknown>) {
  const status = Object.fromEntries(f.machines.map((m) => [m.id, m.status()]));
  return structuredClone({ t: f.clock.t, acc: f.clock.acc, created: f.ledger.created, consumed: f.ledger.consumed, status, ...parts });
}

/** Print a timeline for the notes (only with V4_TIMELINE=1: the test output stays quiet). */
export function report(text: string) {
  if (process.env.V4_TIMELINE) process.stdout.write(text);
}
