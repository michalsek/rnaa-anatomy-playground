// Painter's order → draw lists. The order is the sorted static items with each live slot spliced in next to its
// anchor; every item contributes its blended entries (static-geometry.ts) and every slot a slot draw. Runs of
// consecutive stroke entries merge into one instanced draw through the stroke order buffer.
import type { BlendMode } from './paint.ts';
import type { SlotPlacement } from './slots.ts';
import type { StaticEntry } from './static-geometry.ts';

export type Draw =
  | { kind: 'segs'; first: number; count: number; blend: BlendMode }
  | { kind: 'fill'; first: number; count: number; blend: BlendMode }
  | { kind: 'halo'; halo: number }
  | { kind: 'slot'; slot: number };

/** One step of the painter sequence: a static entry (`item` ≥ 0) or a slot (`item` = −1). */
export interface PainterStep {
  item: number;
  /** Entry index inside the item, or the slot index for a slot step. */
  index: number;
}

/** Slots of each anchor item, before / after it, in document order. */
export type SlotsByAnchor = Map<number, { before: number[]; after: number[] }>;

export function slotsByAnchorOf(slots: SlotPlacement[]): SlotsByAnchor {
  const map: SlotsByAnchor = new Map();
  slots.forEach((slot, index) => {
    let entry = map.get(slot.anchor);
    if (!entry) map.set(slot.anchor, (entry = { before: [], after: [] }));
    entry[slot.side].push(index);
  });
  for (const entry of map.values()) for (const side of [entry.before, entry.after]) side.sort((a, b) => slots[a].seq - slots[b].seq);
  return map;
}

/** Item / slot pseudo-item indices in painter order (slot s is item `itemCount + s`). */
export function frameOrderOf(order: ArrayLike<number>, slotsByAnchor: SlotsByAnchor, itemCount: number, out: number[] = []): number[] {
  out.length = 0;
  for (let i = 0; i < order.length; i++) {
    const item = order[i];
    const slots = slotsByAnchor.get(item);
    if (slots) for (const s of slots.before) out.push(itemCount + s);
    out.push(item);
    if (slots) for (const s of slots.after) out.push(itemCount + s);
  }
  return out;
}

export function painterSequenceOf(frameOrder: number[], entries: StaticEntry[][], itemCount: number): PainterStep[] {
  const steps: PainterStep[] = [];
  for (const item of frameOrder) {
    if (item >= itemCount) steps.push({ item: -1, index: item - itemCount });
    else for (let e = 0; e < entries[item].length; e++) steps.push({ item, index: e });
  }
  return steps;
}

/**
 * Draws for the steps `include` accepts, in sequence order. Stroke entries append their segment indices (only those
 * `segmentMask` marks, when given) to `indices` from `indexOffset` on; returns the draws and the index count used.
 */
export function buildDraws(steps: PainterStep[], entries: StaticEntry[][], include: (step: number) => boolean, indices: Uint32Array, indexOffset: number, segmentMask: Uint8Array | null = null) {
  const draws: Draw[] = [];
  let n = indexOffset;
  steps.forEach((step, s) => {
    if (!include(s)) return;
    if (step.item < 0) {
      draws.push({ kind: 'slot', slot: step.index });
      return;
    }
    const entry = entries[step.item][step.index];
    if (entry.kind === 'segs') {
      const start = n;
      for (let i = entry.first; i < entry.first + entry.count; i++) if (!segmentMask || segmentMask[i]) indices[n++] = i;
      const count = n - start;
      if (!count) return;
      const last = draws[draws.length - 1];
      if (last?.kind === 'segs' && last.blend === entry.blend) last.count += count;
      else draws.push({ kind: 'segs', first: start, count, blend: entry.blend });
    } else if (entry.kind === 'fill') {
      draws.push({ kind: 'fill', first: entry.first, count: entry.count, blend: entry.blend });
    } else {
      draws.push({ kind: 'halo', halo: entry.halo });
    }
  });
  return { draws, indexCount: n - indexOffset };
}

/**
 * Depth bases in painter order: static items use their layer count, slot pseudo-items their reserved capacity (so
 * static depth values do not move when a slot's content changes). Writes `bases` (indexed by item / pseudo-item) and
 * returns the total depth-slot count.
 */
export function depthBasesOf(frameOrder: number[], itemLayers: (item: number) => number, bases: Uint32Array): number {
  let base = 0;
  for (const item of frameOrder) {
    bases[item] = base;
    base += itemLayers(item);
  }
  return base;
}
