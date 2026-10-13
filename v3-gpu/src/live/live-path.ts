// The markup-driven live slot path as the frame loop sees it: slot source + adapter + a fresh LiveSlots painter per
// renderer.
import type { TgpuRoot } from 'typegpu';
import type { LiveParts } from '../core/frame-loop.ts';
import type { Renderer } from '../core/renderer.ts';
import type { LiveAdapter } from './adapter.ts';
import { LiveSlots } from './slot-renderer.ts';
import type { SlotSource } from './slot-source.ts';

export class LiveSlotPath implements LiveParts {
  private readonly slots: number[];

  constructor(private readonly source: SlotSource, readonly adapter: LiveAdapter) {
    this.slots = source.names.map((_, slot) => slot);
  }

  get hasDirty() {
    return this.source.hasDirty;
  }

  markAllDirty() {
    this.source.markAllDirty();
  }

  attach(root: TgpuRoot, renderer: Renderer) {
    const painter = new LiveSlots(root, renderer.bindings, this.slots);
    renderer.setSlotPainter(painter);
    this.adapter.attach(painter);
    return painter;
  }

  detach() {
    this.adapter.detach();
  }

  flush() {
    this.adapter.flush();
  }

  slotWrittenOutsideFrame(slot: number) {
    this.adapter.collectNow(slot);
  }
}
