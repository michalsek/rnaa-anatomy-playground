/**
 * Ports: how machines hand items on. Every machine works in its own local frame and is placed by
 * translation (`origin`, world), so a hand-off converts the sender's local point to world and on
 * into the receiver's local frame (v2 `shared/runtime.js` route). Plain TS.
 */
import type { Item } from './items.ts';

export type V3 = [number, number, number];

/** Something that takes items in (a machine's input port). */
export interface Receiver {
  /**
   * Whether an item handed on now (or arriving `lead` seconds from now) will be taken. A sender
   * that asks first is never refused.
   */
  canAccept(lead?: number): boolean;
  /** `from` in the receiver's local frame; `v` the item's velocity (world = local axes). */
  accept(item: Item, from: V3, v: V3): void;
}

export interface Located {
  readonly id: string;
  /** World translation of the machine's local frame. */
  readonly origin: V3;
}

/** An output port. Unlinked, `ready` is false and `send` throws. */
export interface Out {
  readonly linked: boolean;
  ready(lead?: number): boolean;
  /** `from` in the sender's local frame. */
  send(item: Item, from: V3, v: V3): void;
}

export interface OutPort extends Out {
  connect(to: Located & Receiver): void;
}

export function createOut(owner: Located, name: string): OutPort {
  let to: (Located & Receiver) | null = null;
  return {
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
      const o = owner.origin;
      const r = to.origin;
      to.accept(item, [from[0] + o[0] - r[0], from[1] + o[1] - r[1], from[2] + o[2] - r[2]], [v[0], v[1], v[2]]);
    },
  };
}

/** Link `a.outs[port]` to `b`'s input. */
export function link<A extends Located & { outs: Record<string, OutPort> }>(a: A, port: keyof A['outs'] & string, b: Located & Receiver) {
  const out = a.outs[port];
  if (!out) throw new Error(`${a.id}: no output "${port}"`);
  out.connect(b);
}
