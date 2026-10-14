/**
 * Ports: how machines hand items on. Every machine works in its own local frame and is placed by
 * translation (`origin`, world) and an optional quarter turn about z (`yaw`, M11), so a hand-off
 * converts the sender's local point (and the item's velocity) to world and on into the receiver's
 * local frame (v2 `shared/runtime.js` route). Plain TS.
 */
import { DEV } from '#platform/env.ts';
import type { Item } from './items.ts';

export type V3 = [number, number, number];

/** A receiver's quanta, for a sender that locks to them: `phase` wraps 0 → 1 once per `period` s. */
export interface SyncInfo {
  phase: number;
  period: number;
}

/**
 * Something that takes items in (a machine's input port).
 *
 * Most receivers take whatever arrives (a top belt, the loop, a sink, the crusher's hopper);
 * `canAccept` is then advice (a belt with `hold` waits on it). A **strict** receiver (`strict:
 * true`; the centrifuge's intake, closed from spin-up to spin-down) throws in `accept` when it
 * would have answered no, so whatever feeds it must ask first: a conveyor with `hold: true`, a
 * source (its timer holds), or another machine whose out port `asks`. `link` refuses to wire a
 * strict receiver to a sender that doesn't ask, and in DEV `send` checks before handing on.
 *
 * The contract:
 * - **Asking:** a sender that asks calls `canAccept(lead)` with the true lead (the seconds until
 *   the item will arrive) and then sends at that time. One sender per receiver: `canAccept` doesn't
 *   reserve, so two senders asking the same receiver could both be told yes.
 * - **No double step:** a receiver never moves an item on the step it accepts it (the sender
 *   already moved it that step; receivers record `born = clock.t` and skip it).
 */
export interface Receiver {
  /** Throws in `accept` when `canAccept()` is false (see above). */
  readonly strict?: boolean;
  /**
   * Whether an item handed on now (or arriving `lead` seconds from now) will be taken. A sender
   * that asks first is never refused.
   */
  canAccept(lead?: number): boolean;
  /** `from` and the item's velocity `v` in the receiver's local frame. */
  accept(item: Item, from: V3, v: V3): void;
}

export interface Located {
  readonly id: string;
  /** World translation of the machine's local frame. */
  readonly origin: V3;
  /** Its turn about z (degrees, a multiple of 90; default 0): world = origin + Rz(yaw)·local. */
  readonly yaw?: number;
}

/** A quarter turn's cos and sin, exact (yaw in degrees, a multiple of 90). */
export function quarterTurn(yaw = 0): readonly [number, number] {
  const q = Math.round(yaw / 90);
  if (Math.abs(q * 90 - yaw) > 1e-9) throw new Error(`yaw ${yaw}: use a multiple of 90`);
  const k = ((q % 4) + 4) % 4;
  return k === 0 ? [1, 0] : k === 1 ? [0, 1] : k === 2 ? [-1, 0] : [0, -1];
}

/** A local point of a machine in world (writes out). */
export function toWorld(m: Located, p: readonly number[], out: V3 = [0, 0, 0]): V3 {
  const [c, s] = quarterTurn(m.yaw);
  const x = p[0]!;
  const y = p[1]!;
  out[0] = m.origin[0] + c * x - s * y;
  out[1] = m.origin[1] + s * x + c * y;
  out[2] = m.origin[2] + p[2]!;
  return out;
}

/** An output port. Unlinked, `ready` is false and `send` throws. */
export interface Out {
  readonly linked: boolean;
  /** The sender asks `ready()` before every `send` (required to feed a strict receiver). */
  readonly asks: boolean;
  ready(lead?: number): boolean;
  /** `from` in the sender's local frame. */
  send(item: Item, from: V3, v: V3): void;
}

export interface OutPort extends Out {
  connect(to: Located & Receiver): void;
}

export function createOut(owner: Located, name: string, o: { asks: boolean }): OutPort {
  let to: (Located & Receiver) | null = null;
  return {
    asks: o.asks,
    get linked() {
      return to !== null;
    },
    connect(next) {
      to = next;
    },
    ready(lead) {
      return to !== null && to.canAccept(lead);
    },
    send(item, from, v) {
      if (!to) throw new Error(`${owner.id}.${name}: not linked`);
      if (DEV && to.strict && !to.canAccept()) throw new Error(`${owner.id}.${name}: ${to.id} refuses item ${item.id} (strict receiver; the sender must ask first)`);
      // world = o + Ro·from; the receiver's local = Rrᵀ·(world − r); a velocity turns alike.
      const o = owner.origin;
      const r = to.origin;
      const [co, so] = quarterTurn(owner.yaw);
      const [cr, sr] = quarterTurn(to.yaw);
      const wx = o[0] + co * from[0] - so * from[1] - r[0];
      const wy = o[1] + so * from[0] + co * from[1] - r[1];
      const vx = co * v[0] - so * v[1];
      const vy = so * v[0] + co * v[1];
      to.accept(item, [cr * wx + sr * wy, -sr * wx + cr * wy, from[2] + o[2] - r[2]], [cr * vx + sr * vy, -sr * vx + cr * vy, v[2]]);
    },
  };
}

/** Receivers that already have a sender that asks (`canAccept` doesn't reserve: one per receiver). */
const asked = new WeakSet<Receiver>();

/**
 * Link `a.outs[port]` to `b`'s input (a strict receiver needs a sender that asks; a receiver
 * takes at most one sender that asks).
 */
export function link<A extends Located & { outs: Record<string, OutPort> }>(a: A, port: keyof A['outs'] & string, b: Located & Receiver) {
  const out = a.outs[port];
  if (!out) throw new Error(`${a.id}: no output "${port}"`);
  if (b.strict && !out.asks) throw new Error(`${a.id}.${port} → ${b.id}: a strict receiver needs a sender that asks first (a belt with hold: true)`);
  if (out.asks) {
    if (asked.has(b)) throw new Error(`${a.id}.${port} → ${b.id}: ${b.id} already has a sender that asks (canAccept doesn't reserve: one per receiver)`);
    asked.add(b);
  }
  out.connect(b);
}
