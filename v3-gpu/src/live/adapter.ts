// Platform-neutral live adapter: slot markup (from a SlotSource) → slot geometry → GPU upload, plus the live palette
// (probe recipes discovered at runtime, resolved by a PaintResolver and appended to the renderer's paint table).
import type { ResolvedPaint } from '../palette.ts';
import type { Renderer } from '../renderer.ts';
import type { ChainNode, GpuScene, PaintDesc } from '../scene.ts';
import { SlotGeometryBuilder, type PaintClass, type PaintLookup, type SlotGeometry } from './geometry.ts';
import type { LiveSlots } from './slot-renderer.ts';

/** Where slot markup comes from (DOM: intercepted `innerHTML` setters; a native host could push strings directly). */
export interface SlotSource {
  readonly names: string[];
  readonly markup: string[];
  /** Indices of slots whose markup changed since the last call; clears the dirty set. */
  takeDirty(): number[];
  markAllDirty(): void;
}

/** Resolves probe recipes to colours (DOM: getComputedStyle on probe elements). */
export interface PaintResolver {
  resolve(paints: PaintDesc[]): ResolvedPaint[];
}

/** How a slot reacts to markup the GPU path cannot draw. */
export type MarkupErrorPolicy = 'throw' | 'skip';

const OPAQUE_ALPHA = 0.999;

/** Rolling window of the last `size` samples (ms). */
export class Samples {
  private readonly values: Float64Array;
  private count = 0;
  private sorted: Float64Array;
  constructor(size = 600) {
    this.values = new Float64Array(size);
    this.sorted = new Float64Array(size);
  }
  push(value: number) {
    this.values[this.count % this.values.length] = value;
    this.count++;
  }
  summary() {
    const n = Math.min(this.count, this.values.length);
    if (!n) return { n: 0, last: 0, median: 0, p95: 0, mean: 0 };
    const sorted = this.sorted.subarray(0, n);
    sorted.set(this.values.subarray(0, n));
    sorted.sort();
    let sum = 0;
    for (let i = 0; i < n; i++) sum += sorted[i];
    const at = (q: number) => sorted[Math.min(n - 1, Math.floor(q * n))];
    return { n, last: this.values[(this.count - 1) % this.values.length], median: at(0.5), p95: at(0.95), mean: sum / n };
  }
}

/** Duration since `start` on the real clock (User Timing; survives a virtualized performance.now). */
export const measureSince = (name: string, start: string) => performance.measure(name, start).duration;

export class LiveAdapter implements PaintLookup {
  readonly samples = { liveJs: new Samples(), parse: new Samples(), upload: new Samples(), encode: new Samples(), encodeWithGroups: new Samples(), gpu: new Samples() };
  readonly counters = { frames: 0, slotsChanged: 0, bytesUploaded: 0, paints: 0, errors: 0 };
  private readonly builder: SlotGeometryBuilder;
  private readonly geometry: (SlotGeometry | undefined)[];
  private readonly classes = new Map<string, PaintClass>();
  private readonly warned = new Set<string>();
  private renderer: Renderer | null = null;
  private live: LiveSlots | null = null;

  constructor(
    private readonly source: SlotSource,
    private readonly scene: GpuScene,
    private readonly resolver: PaintResolver,
    private readonly policy: MarkupErrorPolicy,
    chainPrefix: ChainNode[],
  ) {
    this.builder = new SlotGeometryBuilder(this, chainPrefix);
    this.geometry = source.names.map(() => undefined);
  }

  get meshStats() {
    return this.builder.stats;
  }

  validate(markup: string) {
    this.builder.validate(markup);
  }

  /** A new renderer (first start or device-lost reinit): every slot is re-uploaded. */
  attach(renderer: Renderer, live: LiveSlots) {
    this.renderer = renderer;
    this.live = live;
    this.source.markAllDirty();
  }

  detach() {
    this.renderer = null;
    this.live = null;
  }

  /** The palette was re-resolved (theme change): re-classify live paints and rebuild every slot. */
  reclassify() {
    if (!this.renderer) return;
    for (const [key, paint] of this.classes) this.classes.set(key, { ...this.classify(this.renderer.paints[paint.id]), id: paint.id });
    this.source.markAllDirty();
  }

  /** Parses and uploads every changed slot; returns false when there is no renderer yet (slots stay dirty). */
  flush(): boolean {
    const live = this.live;
    if (!live || !this.renderer) return false;
    const changed = this.source.takeDirty();
    if (!changed.length) return true;
    performance.mark('adapter-parse-start');
    const itemBase = this.scene.items.length;
    for (const index of changed) this.geometry[index] = this.build(index, itemBase + index);
    this.samples.parse.push(measureSince('adapter-parse', 'adapter-parse-start'));
    performance.mark('adapter-upload-start');
    for (const index of changed) this.counters.bytesUploaded += live.update(index, this.geometry[index]!);
    this.samples.upload.push(measureSince('adapter-upload', 'adapter-upload-start'));
    this.counters.frames++;
    this.counters.slotsChanged += changed.length;
    return true;
  }

  paintOf(prop: 'fill' | 'stroke', key: string, chain: () => ChainNode[], alpha: number): PaintClass {
    const known = this.classes.get(key);
    if (known) return known;
    const renderer = this.renderer!;
    const desc: PaintDesc = { kind: 'probe', prop, chain: chain(), ...(alpha !== 1 ? { alpha } : {}) };
    const [resolved] = this.resolver.resolve([desc]);
    const id = this.scene.paints.length;
    this.scene.paints.push(desc);
    renderer.appendPaints([resolved]);
    const paint = { ...this.classify(resolved), id };
    this.classes.set(key, paint);
    this.counters.paints++;
    return paint;
  }

  private build(index: number, item: number): SlotGeometry {
    const markup = this.source.markup[index];
    try {
      return this.builder.build(markup, item, this.geometry[index]);
    } catch (error) {
      if (this.policy === 'throw') throw error;
      this.counters.errors++;
      const message = `${this.source.names[index]}: ${(error as Error).message}`;
      if (!this.warned.has(message)) {
        this.warned.add(message);
        console.warn(`live slot skipped (${message})`);
      }
      return this.builder.build('', item, this.geometry[index]);
    }
  }

  private classify(paint: ResolvedPaint): Omit<PaintClass, 'id'> {
    return { visible: paint.visible, opaque: paint.blend === 'normal' && paint.rgba[3] >= OPAQUE_ALPHA, blend: paint.blend };
  }
}
