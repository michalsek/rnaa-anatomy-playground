/**
 * A timed item source (a stand-in for an upstream machine): one item per tick in a burst
 * pattern, handed straight to its output. The timer holds while the output can't take an item
 * (deterministic, bounded backpressure; M4's FEED_MAX). Plain TS.
 */
import type { Clock, Machine } from './clock.ts';
import type { ItemKind, Ledger } from './items.ts';
import { type OutPort, type Located, type V3, createOut } from './ports.ts';
import { hash01 } from './math.ts';
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
    status: () => ({ made }),
  };
  return source;
}

export interface BeadSourceOptions {
  id: string;
  origin: V3;
  /** Where beads appear (local; inside the hopper the blocks draw there). */
  from: V3;
  /** Offsets the hash streams (the timing changes with the seed; the defaults are seed 0). */
  seed?: number;
  /** Beads the tube holds (a burst only fills the room left). */
  tube?: number;
}

export interface BeadSource extends Machine, Located {
  readonly outs: { out: OutPort };
  readonly from: V3;
  /** Beads released so far, and waiting in the tube. */
  readonly made: number;
  readonly queued: number;
}

/**
 * A temporary bead source standing in for the phone's dispenser (v2 `parts/screen/phone.mjs`
 * LIVE L333–447; the real one is M10): a "tap" sends a burst of 2–3 fluff beads into the tube
 * every 2.6–3.6 s, and the valve releases the bottom one every 0.9–1.25 s (`RATES.beads`). v2's
 * `Math.random` is a hash of the burst / release count. The release holds while the output can't
 * take a bead (asks first).
 */
export function createBeadSource(clock: Readonly<Clock>, ledger: Ledger, o: BeadSourceOptions): BeadSource {
  const B = RATES.beads;
  const tube = o.tube ?? 8;
  const seed = o.seed ?? 0;
  const pick = (range: readonly [number, number], k: number) => range[0] + (range[1] - range[0]) * hash01(k);
  let nextBurst = B.firstBurst;
  let nextRelease = B.firstRelease;
  let bursts = 0;
  let releases = 0;
  let queued = 0;
  let made = 0;
  const zero: V3 = [0, 0, 0];
  const src: BeadSource = {
    id: o.id,
    origin: o.origin,
    outs: { out: createOut(o, 'out', { asks: true }) },
    from: o.from,
    get made() {
      return made;
    },
    get queued() {
      return queued;
    },
    step() {
      const t = clock.t;
      if (t >= nextBurst) {
        const k = 1000 * seed + 2 * bursts++;
        nextBurst = t + pick(B.burstEvery, k);
        const n = B.burst[0] + Math.floor(hash01(k + 1) * (B.burst[1] - B.burst[0] + 1));
        queued += Math.max(0, Math.min(tube - queued, n));
      }
      if (queued > 0 && t >= nextRelease && src.outs.out.ready()) {
        nextRelease = t + pick(B.release, 1000 * seed + 500 + releases++);
        queued--;
        made++;
        src.outs.out.send(ledger.make('fluff'), o.from, zero);
      }
    },
    alive: () => 0,
    status: () => ({ made, queued }),
  };
  return src;
}
