/**
 * A sink (a stand-in for a downstream machine): it takes every item, lets it fall from where it
 * was handed on (with its velocity) down to `floorZ`, then consumes it. Plain TS.
 */
import type { Clock, Machine } from './clock.ts';
import { FALL_G } from './fall.ts';
import type { Item, Ledger, PoseSource } from './items.ts';
import type { Located, Receiver, V3 } from './ports.ts';

export interface SinkOptions {
  id: string;
  origin: V3;
  /** Local z where falling items are consumed (default: consumed at once). */
  floorZ?: number;
}

export interface SinkItem {
  item: Item;
  p: V3;
  v: V3;
  /** Sim time it was handed on (it does not move in that step). */
  born: number;
}

export interface Sink extends Machine, Located, Receiver, PoseSource {
  readonly falling: readonly SinkItem[];
  /** Items taken so far. */
  readonly taken: number;
}

export function createSink(clock: Readonly<Clock>, ledger: Ledger, o: SinkOptions): Sink {
  const falling: SinkItem[] = [];
  let taken = 0;
  const floor = o.floorZ;
  return {
    id: o.id,
    origin: o.origin,
    falling,
    get taken() {
      return taken;
    },
    canAccept: () => true,
    accept(item, from, v) {
      taken++;
      if (floor === undefined || from[2] <= floor) {
        ledger.consume(item);
        return;
      }
      falling.push({ item, p: [from[0], from[1], from[2]], v: [v[0], v[1], v[2]], born: clock.t });
    },
    step(h) {
      for (let i = falling.length - 1; i >= 0; i--) {
        const f = falling[i]!;
        if (f.born === clock.t) continue;
        f.v[2] -= FALL_G * h;
        f.p[0] += f.v[0] * h;
        f.p[1] += f.v[1] * h;
        f.p[2] += f.v[2] * h;
        if (f.p[2] <= floor!) {
          falling.splice(i, 1);
          ledger.consume(f.item);
        }
      }
    },
    alive: () => falling.length,
    poses(cb) {
      const a = clock.acc;
      for (let i = 0; i < falling.length; i++) {
        const f = falling[i]!;
        cb(i, f.item, f.p[0] + f.v[0] * a, f.p[1] + f.v[1] * a, f.p[2] + f.v[2] * a - 0.5 * FALL_G * a * a, f.item.yaw, 0, 0, 0);
      }
      return falling.length;
    },
  };
}
