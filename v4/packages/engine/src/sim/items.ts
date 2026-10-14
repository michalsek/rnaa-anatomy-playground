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
