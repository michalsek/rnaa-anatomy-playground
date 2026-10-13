// Live slots as the renderer sees them: where each slot sits in the painter's order, and the contract of whatever
// draws a slot's content (the markup path in src/live, or a native painter such as an instanced rotor).
import type { TgpuCommandEncoder, TgpuRenderPass, TgpuRoot } from 'typegpu';
import type { SharedBindings } from './bindings.ts';
import type { Pipelines } from './pipelines.ts';
import type { Box } from './static-geometry.ts';

/** Where a slot sits in the painter's order (the DL `slots` entry: v2 kit.mjs page() placement). */
export interface SlotPlacement {
  name: string;
  /** Item index the slot is anchored to (it moves with that item under explode). */
  anchor: number;
  side: 'after' | 'before';
  /** Document position; orders several slots at one anchor. */
  seq: number;
}

/** Content extent of a slot: geometry box (viewBox units, before the anchor's explode offset) + widest stroke. */
export interface SlotExtent {
  box: Box;
  /** Largest stroke half-width (CSS px) in the slot. */
  halfWidth: number;
}

/** Per-frame state a slot painter draws with. */
export interface FrameContext {
  readonly root: TgpuRoot;
  readonly pipelines: Pipelines;
  readonly bindings: SharedBindings;
  /** Colour format of the render targets. */
  readonly format: GPUTextureFormat;
  /** device px = (viewBox + offset) · scale + translate. */
  readonly scale: number;
  readonly translate: [number, number];
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly share: number;
  /** Item index of the slot's pseudo-item (scene items first): its depth base and explode offset live there. */
  slotItem(slot: number): number;
  /** First depth slot of the slot and the total depth-slot count of the frame. */
  depthBase(slot: number): number;
  readonly depthTotal: number;
  /** Explode offset of the slot (its anchor's), viewBox units. */
  offsetOf(slot: number): [number, number];
  /** The painter that draws `slot` now (the renderer's ownership record, the only one). */
  ownerOf(slot: number): SlotPainter | null;
}

/**
 * Draws the content of one or more live slots. Slot ownership lives in the renderer (`setSlotPainter`, the only
 * record: painters ask `FrameContext.ownerOf`); a painter only ever draws the slots it owns. Ownership moves both ways:
 * a slot released to another painter may be acquired back later (a native machine falling back to the markup path). The renderer calls, per frame: `prepare` (offscreen passes, before the
 * main pass), `drawOpaque` (depth-writing content, in the opaque phase), then `drawSlot` at each slot's painter
 * position. Content must stay inside the depth slots [depthBase, depthBase + capacity) the renderer reserved
 * (`layersOf` reports the need; growing it re-lays the depth range) and inside `extentOf` (the static cache treats
 * pixels outside every slot's extent as unaffected by slots).
 */
export interface SlotPainter {
  readonly slots: readonly number[];
  /** Bumped whenever anything this painter draws changed (the renderer redraws on a change). */
  readonly version: number;
  layersOf(slot: number): number;
  extentOf(slot: number): SlotExtent | null;
  /**
   * The renderer gave `slots` to another painter: stop drawing them (prepare / drawOpaque included) and drop what they
   * hold. A painter that owns no slot any more is no longer called at all.
   */
  release(slots: readonly number[]): void;
  /**
   * The renderer gave `slots` to this painter (again): draw them from the next frame on. Optional: a painter that only
   * ever owns the slots it was created for needs nothing here.
   */
  acquire?(slots: readonly number[]): void;
  /**
   * Work this painter encoded into the last frame may not have run (the frame threw before or at submit, or a WebGPU
   * validation error made its results unknown): redo it in the next `prepare`. Optional: painters that encode nothing
   * of their own need nothing here.
   */
  invalidate?(): void;
  prepare(frame: FrameContext, encoder: TgpuCommandEncoder): void;
  drawOpaque(frame: FrameContext, pass: TgpuRenderPass): void;
  drawSlot(frame: FrameContext, pass: TgpuRenderPass, slot: number): void;
  /** Pipelines to compile ahead of the first frame. */
  pipelines(): { initAsync(): Promise<void> }[];
  dispose(): void;
}

/**
 * Who draws each live slot: the renderer's single ownership record. Moving slots tells each previous owner what it
 * lost (`release`) and the new owner what it gained (`acquire`), so ownership can move back and forth (a native machine
 * taking the rotor slots from the markup path, and giving them back when it fails). DOM- and GPU-free (unit-tested).
 */
export class SlotOwners {
  /** Every painter known (compiled and disposed with the renderer), whether or not it owns a slot now. */
  readonly painters: SlotPainter[] = [];
  /** Painters that own at least one slot: the only ones prepared and drawn. */
  active: SlotPainter[] = [];
  private readonly owners: (SlotPainter | null)[];

  constructor(slotCount: number) {
    this.owners = Array.from({ length: slotCount }, () => null);
  }

  /** Makes a painter known without giving it slots. */
  add(painter: SlotPainter) {
    if (!this.painters.includes(painter)) this.painters.push(painter);
  }

  ownerOf(slot: number): SlotPainter | null {
    return this.owners[slot] ?? null;
  }

  /** Gives `slots` to `painter`; returns whether any slot changed hands. */
  assign(painter: SlotPainter, slots: readonly number[]): boolean {
    this.add(painter);
    const released = new Map<SlotPainter, number[]>();
    const gained: number[] = [];
    for (const slot of slots) {
      const previous = this.owners[slot];
      if (previous === painter) continue;
      if (previous) {
        const lost = released.get(previous);
        if (lost) lost.push(slot);
        else released.set(previous, [slot]);
      }
      this.owners[slot] = painter;
      gained.push(slot);
    }
    if (!gained.length) return false;
    for (const [previous, lost] of released) previous.release(lost);
    painter.acquire?.(gained);
    this.active = this.painters.filter((p) => this.owners.includes(p));
    return true;
  }
}
