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
}

/**
 * Draws the content of one or more live slots. The renderer calls, per frame: `prepare` (offscreen passes, before the
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
  prepare(frame: FrameContext, encoder: TgpuCommandEncoder): void;
  drawOpaque(frame: FrameContext, pass: TgpuRenderPass): void;
  drawSlot(frame: FrameContext, pass: TgpuRenderPass, slot: number): void;
  /** Pipelines to compile ahead of the first frame. */
  pipelines(): { initAsync(): Promise<void> }[];
  dispose(): void;
}
