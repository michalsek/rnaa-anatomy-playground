/**
 * Items that travel through the factory, and the ledger that counts them. Plain TS.
 *
 * Every item is made by the ledger (a source, later the packer and the scanner) and either
 * consumed (a sink) or alive inside exactly one machine, so `created = alive + consumed` holds
 * after every step (the conservation tests check it).
 */

/** Item kinds, in v2's order (`shared/kit.mjs` KINDS). */
export const ITEM_KINDS = ['fluff', 'control', 'graph', 'data', 'audio', 'garbage'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** The packet kinds a packet pool draws (style index = position here; see `packetStyle`). */
export const PACKET_KINDS = ['control', 'graph', 'data', 'audio', 'garbage'] as const;
export type PacketKind = (typeof PACKET_KINDS)[number];

/** An item's box: length (model x), depth (y), height (z). */
export interface ItemSize {
  readonly w: number;
  readonly d: number;
  readonly h: number;
}

/** A taped packet (v2 runtime `packetSvg` default). */
export const PACKET_SIZE: ItemSize = { w: 10, d: 8, h: 7 };
/** A fluff bead (v2 dispenser beads, 4.8 across). */
const BEAD_SIZE: ItemSize = { w: 4.8, d: 4.8, h: 4.8 };

/** The size of an item of this kind (beads are fluff; every other kind is a packet). */
export function sizeOf(kind: ItemKind): ItemSize {
  return kind === 'fluff' ? BEAD_SIZE : PACKET_SIZE;
}

export interface Item {
  id: number;
  kind: ItemKind;
  /** What a garbage item was before it was read. */
  was?: ItemKind;
  /**
   * Yaw (radians about z) the item carries across hand-offs, so a receiver starts from the
   * sender's pose (a packet leaving the centrifuge's gate at 95° turns to lie along the belt).
   */
  yaw: number;
}

/**
 * An item's pose in its machine's frame, as the packet pools take it: the bottom centre (a
 * hanging parcel is upside down, so its top), yaw, then pitch and roll (the `PoolHandle.pose`
 * order), and its grey blend 0..1 (garbage, E2). Every machine's `poses(cb)` calls this.
 */
export type PoseFn = (i: number, item: Item, x: number, y: number, z: number, yaw: number, pitch: number, roll: number, spend: number) => void;

/** A machine whose items the packet pools draw. */
export interface PoseSource {
  /** Item poses at t + acc (extrapolated); returns the count. */
  poses(cb: PoseFn): number;
}

/** A packet pool's style index for a kind (pools list PACKET_KINDS' materials in order). */
export function packetStyle(kind: ItemKind): number {
  const k = PACKET_KINDS.indexOf(kind as PacketKind);
  if (k < 0) throw new Error(`no packet style for kind "${kind}"`);
  return k;
}

export interface Ledger {
  created: number;
  consumed: number;
  make(kind: ItemKind, yaw?: number): Item;
  consume(item: Item): void;
}

export function createLedger(): Ledger {
  let nextId = 1;
  const ledger: Ledger = {
    created: 0,
    consumed: 0,
    make(kind, yaw = 0) {
      ledger.created++;
      return { id: nextId++, kind, yaw };
    },
    consume() {
      ledger.consumed++;
    },
  };
  return ledger;
}
