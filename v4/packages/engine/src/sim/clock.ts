/**
 * The factory clock: one fixed step for every machine, in a fixed order (upstream first, so a
 * belt that reads its receiver's state, e.g. belt B's hold on the centrifuge's intake, steps
 * before it). Plain TS: no React, no randomness, no wall clock; the state is a pure function of
 * the dt sequence (and each machine's seed).
 */
import { type Ledger, createLedger } from './items.ts';
import { type Located, type OutPort, type Receiver, link } from './ports.ts';

export interface Clock {
  /** The fixed step, seconds. */
  readonly H: number;
  /** Sim time, seconds (a whole number of steps). */
  t: number;
  /** Unstepped time below one step: renderers extrapolate poses by it. */
  acc: number;
}

export interface Machine {
  readonly id: string;
  step(h: number): void;
  /** Items alive inside the machine (the conservation count). */
  alive(): number;
  /** A plain summary for the dev hook (`__v4.sim.status(id)`). */
  status(): object;
}

export interface Factory {
  readonly clock: Readonly<Clock>;
  readonly ledger: Ledger;
  readonly machines: readonly Machine[];
  /** Add a machine; the step order is the order of `add`. */
  add<M extends Machine>(m: M): M;
  get(id: string): Machine;
  /**
   * Link `a.outs[port]` to `b` (both added already). The sender must step before the receiver:
   * a receiver skips the step it takes an item in (the sender already moved it that step), and a
   * sender that reads its receiver (a belt's hold) must see this step's state.
   */
  link<A extends Machine & Located & { outs: Record<string, OutPort> }>(a: A, port: keyof A['outs'] & string, b: Machine & Located & Receiver): void;
  /**
   * One frame: dt clamped to 1/30 s, times speed, at most `maxSteps` steps; the rest is dropped
   * (no catch-up burst). Returns the steps run.
   */
  advance(dt: number, speed?: number): number;
  /** Uncapped (seek, tests). */
  run(seconds: number): void;
  /** Items alive in all machines. */
  alive(): number;
}

export function createFactory(o: { H?: number; maxSteps?: number } = {}): Factory {
  const H = o.H ?? 1 / 120;
  const maxSteps = o.maxSteps ?? 8;
  const clock: Clock = { H, t: 0, acc: 0 };
  const ledger = createLedger();
  const machines: Machine[] = [];
  const step = () => {
    clock.t += H;
    for (const m of machines) m.step(H);
  };
  return {
    clock,
    ledger,
    machines,
    add(m) {
      if (machines.some((x) => x.id === m.id)) throw new Error(`factory: duplicate machine "${m.id}"`);
      machines.push(m);
      return m;
    },
    get(id) {
      const m = machines.find((x) => x.id === id);
      if (!m) throw new Error(`factory: unknown machine "${id}"; known: ${machines.map((x) => x.id).join(', ')}`);
      return m;
    },
    link(a, port, b) {
      const ia = machines.indexOf(a);
      const ib = machines.indexOf(b);
      if (ia < 0 || ib < 0) throw new Error(`factory.link: add ${ia < 0 ? a.id : b.id} first`);
      if (ia >= ib) throw new Error(`factory.link: ${a.id} must step before ${b.id} (add it first)`);
      link(a, port, b);
    },
    advance(dt, speed = 1) {
      const d = Math.min(Math.max(0, dt), 1 / 30) * Math.max(0, speed);
      clock.acc += d;
      let n = Math.floor(clock.acc / H + 1e-9);
      if (n > maxSteps) {
        n = maxSteps;
        clock.acc = 0;
      } else {
        clock.acc = Math.max(0, clock.acc - n * H);
      }
      for (let i = 0; i < n; i++) step();
      return n;
    },
    run(seconds) {
      const n = Math.round(seconds / H);
      for (let i = 0; i < n; i++) step();
    },
    alive() {
      let n = 0;
      for (const m of machines) n += m.alive();
      return n;
    },
  };
}
