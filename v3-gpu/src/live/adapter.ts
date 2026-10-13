// Live adapter (platform-neutral): changed slot markup (SlotSource) → slot geometry → GPU upload. A flush collects every
// changed slot first, resolves the paints they introduced in one batch, then packs and uploads them.
import type { PaintResolver, PaintTable } from '../core/paint.ts';
import { RollingTimings, TIMING, type Clock, type Profiler } from '../core/profiler.ts';
import { CollectedSlot, type SlotGeometry, type SlotGeometryBuilder } from './geometry.ts';
import type { SlotSource } from './slot-source.ts';
import type { LiveSlots } from './slot-renderer.ts';

/** How a slot reacts to markup the GPU path cannot draw: dev builds report it as an error, prod draws the slot empty. */
export type MarkupErrorPolicy = 'report' | 'skip';

export interface LiveAdapterOptions {
  source: SlotSource;
  builder: SlotGeometryBuilder;
  paints: PaintTable;
  resolver: PaintResolver;
  policy: MarkupErrorPolicy;
  /** Item index of slot 0's pseudo-item (the scene's item count). */
  itemBase: number;
  clock: Clock;
  profiler: Profiler;
  /** Unsupported markup: `report` → onError (dev), `skip` → onWarning once per slot and kind of problem (prod). */
  onError(error: Error): void;
  onWarning(message: string): void;
}

export class LiveAdapter {
  readonly counters = { frames: 0, slotsChanged: 0, bytesUploaded: 0, paints: 0, errors: 0 };
  readonly timings = { parse: new RollingTimings(), upload: new RollingTimings() };
  private readonly collected: CollectedSlot[];
  private readonly geometry: (SlotGeometry | undefined)[];
  private readonly changed: number[] = [];
  /** The markup each slot was last collected for (a slot written outside a tick is collected at once). */
  private readonly collectedMarkup: (string | null)[];
  private readonly warned = new Set<string>();
  private painter: LiveSlots | null = null;

  constructor(private readonly options: LiveAdapterOptions) {
    this.collected = options.source.names.map(() => new CollectedSlot());
    this.geometry = options.source.names.map(() => undefined);
    this.collectedMarkup = options.source.names.map(() => null);
  }

  /**
   * A slot changed outside the runtime's tick: collect it now, so unsupported markup is reported at the write (it may
   * be replaced before the next frame); the next flush reuses the result.
   */
  collectNow(slot: number) {
    this.collect(slot);
  }

  get meshStats() {
    return this.options.builder.stats;
  }

  /** A new slot painter (first start or a re-init after device loss): every slot is re-uploaded. */
  attach(painter: LiveSlots) {
    this.painter = painter;
    this.collectedMarkup.fill(null);
    this.options.source.markAllDirty();
  }

  detach() {
    this.painter = null;
  }

  /** Parses and uploads every changed slot; returns the number of slots uploaded (0 without a painter). */
  flush(): number {
    const painter = this.painter;
    const { source, builder, paints, resolver, clock, profiler } = this.options;
    if (!painter || !source.hasDirty) return 0;
    const changed = source.takeDirty(this.changed);
    const t0 = clock.now();
    profiler.begin(TIMING.parse);
    for (const slot of changed) if (this.collectedMarkup[slot] !== source.markupOf(slot)) this.collect(slot);
    this.counters.paints += paints.resolvePending(resolver);
    for (const slot of changed) this.geometry[slot] = builder.pack(this.collected[slot], this.options.itemBase + slot, this.geometry[slot]);
    profiler.end(TIMING.parse);
    const t1 = clock.now();
    profiler.begin(TIMING.upload);
    for (const slot of changed) this.counters.bytesUploaded += painter.update(slot, this.geometry[slot]!);
    profiler.end(TIMING.upload);
    this.timings.parse.push(t1 - t0);
    this.timings.upload.push(clock.now() - t1);
    this.counters.frames++;
    this.counters.slotsChanged += changed.length;
    return changed.length;
  }

  private collect(slot: number) {
    const { source, builder, policy } = this.options;
    const markup = source.markupOf(slot);
    this.collectedMarkup[slot] = markup;
    try {
      builder.collect(markup, this.collected[slot]);
    } catch (error) {
      this.collected[slot].reset();
      this.counters.errors++;
      const message = `live slot ${source.names[slot]}: ${(error as Error).message}`;
      if (policy === 'report') {
        this.options.onError(new Error(message));
        return;
      }
      // one warning per slot and kind of problem (messages carry values: drop the numbers)
      const kind = `${slot}:${(error as Error).message.replace(/[-\d.]+/g, '#')}`;
      if (this.warned.has(kind)) return;
      this.warned.add(kind);
      this.options.onWarning(`${message} — slot skipped`);
    }
  }
}
