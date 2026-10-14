/**
 * A timed item source (a stand-in for an upstream machine): one item per tick in a burst
 * pattern, handed straight to its output. The timer holds while the output can't take an item
 * (deterministic, bounded backpressure; M4's FEED_MAX). Plain TS.
 */
import type { Clock, Machine } from './clock.ts';
import type { ItemKind, Ledger } from './items.ts';
import { type OutPort, type Located, type V3, createOut } from './ports.ts';
import { RATES } from './rates.ts';

/** v2 `build.mjs` kinds: the burst's packets in order (control, graph, data). */
export const SOURCE_KINDS: readonly ItemKind[] = ['control', 'control', 'graph', 'data', 'control', 'graph', 'control', 'data'];

export interface SourceOptions {
  id: string;
  origin: V3;
  /** Where items appear (local). */
  from: V3;
  /** Seconds per tick, the first tick, packets per burst and empty ticks after it. */
  every?: number;
  delay?: number;
  burst?: number;
  rest?: number;
  kinds?: readonly ItemKind[];
  /** Rotates the kinds only (the timing is the same for every seed). */
  seed?: number;
}

export interface Source extends Machine, Located {
  readonly outs: { out: OutPort };
  /** Where items appear (local). */
  readonly from: V3;
  /** Items made so far. */
  readonly made: number;
}

export function createSource(clock: Readonly<Clock>, ledger: Ledger, o: SourceOptions): Source {
  const every = o.every ?? RATES.source.every;
  const burst = o.burst ?? RATES.source.burst;
  const ticks = burst + (o.rest ?? RATES.source.rest);
  const kinds = o.kinds ?? SOURCE_KINDS;
  const seed = o.seed ?? 0;
  let next = o.delay ?? RATES.source.delay;
  let n = 0;
  let made = 0;
  const zero: V3 = [0, 0, 0];
  const source: Source = {
    id: o.id,
    origin: o.origin,
    // Asks first: the timer holds while the receiver can't take an item.
    outs: { out: createOut(o, 'out', { asks: true }) },
    from: o.from,
    get made() {
      return made;
    },
    step() {
      if (clock.t < next) return;
      if (!source.outs.out.ready()) return;
      next = clock.t + every;
      const tick = n++ % ticks;
      if (tick >= burst) return;
      const item = ledger.make(kinds[(seed + made) % kinds.length]!);
      made++;
      source.outs.out.send(item, o.from, zero);
    },
    alive: () => 0,
  };
  return source;
}
