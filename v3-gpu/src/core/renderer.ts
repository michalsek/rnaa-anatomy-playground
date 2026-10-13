// Frame encoding: one 4× MSAA pass per frame — opaque fills with depth writes, then the blended stream (strokes, dots,
// translucent fills, halos, live slots) in painter's order, depth-tested against the fills. Depth is a primitive's rank
// in the painter's order (item base + layer), never a raw key; every live slot reserves a fixed depth range so static
// depth values stay put while slot content changes. With the static cache on (static-cache.ts) the static frame is
// rendered once into a resolved texture; a frame then copies it outside the slots' redraw region (stencil) and redraws
// inside the region only what reaches it.
import type { StorageFlag, TgpuBindGroup, TgpuBuffer, TgpuQuerySet, TgpuRenderPass, TgpuRoot } from 'typegpu';
import * as d from 'typegpu/data';
import { SharedBindings, type LayoutGroup, type SegStorage, type StorageArray } from './bindings.ts';
import { buildDraws, depthBasesOf, frameOrderOf, painterSequenceOf, slotsByAnchorOf, type Draw, type PainterStep, type SlotsByAnchor } from './draw-list.ts';
import { createFillBuffer, createMsaaColor, createMsaaDepth, createResolveColor, type FillBuffer, type MsaaColor, type MsaaDepth, type ResolveColor } from './gpu-types.ts';
import { HaloEffect } from './halo.ts';
import type { PaintTable, Rgba } from './paint.ts';
import { compilePipelines, createPipelines, fillPipelineOf, strokePipelineOf, type Pipelines } from './pipelines.ts';
import { NO_PROFILER, TIMING, type Clock, type Profiler } from './profiler.ts';
import { orderOf, type GpuScene } from './scene.ts';
import { DEBUG_RECT_RECORD, DebugRect, depthOfSlot, FILL_VERTEX_RECORD, Seg } from './schemas.ts';
import * as S from './shaders.ts';
import type { FrameContext, SlotPainter, SlotPlacement } from './slots.ts';
import { CachePartition, clippedRectOf, offsetOf, slotRectOf, SlotEnvelopes, type DeviceRect, type PartitionView } from './static-cache.ts';
import type { FillWriter } from './fills.ts';
import { buildStaticGeometry, type StaticGeometry } from './static-geometry.ts';

/** Where frames go: a configured canvas context and its format, plus a hook after each submit. */
export interface RenderSurface {
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
  /** Called after every submitted frame (react-native-webgpu needs `context.present()`). */
  present?(): void;
}

/** `on`: static cache; `off`: full redraw every frame; `overlay`: cache plus a debug overlay of the partition. */
export type CacheMode = 'on' | 'off' | 'overlay';

export interface RendererOptions {
  surface: RenderSurface;
  scene: GpuScene;
  slots: SlotPlacement[];
  paints: PaintTable;
  cache: CacheMode;
  clock: Clock;
  profiler?: Profiler;
  /** GPU time of a frame (timestamp queries, ms), reported when it becomes available; `rebuiltCache` marks frames that also rendered the static cache. */
  onGpuTime?: (ms: number, rebuiltCache: boolean) => void;
  /**
   * Measurement aid: encode the main pass this many times per frame and report the GPU time per pass. A busier GPU
   * runs at higher clocks, so this shows the cost at a steady clock rather than the idle one (default 1).
   */
  measureRepeat?: number;
}

/**
 * Smallest depth range a slot reserves; ranges grow to the next power of two. Generous, because growing one re-lays
 * the depth of everything drawn after the slot (a new cache render), and depth slots are plentiful.
 */
const MIN_SLOT_CAPACITY = 256;
/** Frames the explode share must stay unchanged before the cache is (re)built; until then frames are full redraws. */
const STABLE_SHARE_FRAMES = 2;
const ENVELOPE_COLOR: Rgba = [0.15, 0.45, 1, 0.9];
const PER_FRAME_COLOR: Rgba = [1, 0.1, 0.6, 0.9];
/** Stencil value inside the redraw region of a cached frame (the scene pipelines draw where it equals the reference). */
const REGION_INSIDE = 1;
/** Region rectangles only write the stencil; their colour is unused. */
const REGION_COLOR: Rgba = [0, 0, 0, 0];

const createQuerySet = (root: TgpuRoot) => root.createQuerySet('timestamp', 2);
type TimestampQuery = ReturnType<typeof createQuerySet>;
/** 1 × 1 target of the empty pass that carries the frame's begin timestamp. */
const createMarker = (root: TgpuRoot, format: GPUTextureFormat) => root.createTexture({ size: [1, 1], format }).$usage('render');
const createDebugGroup = (root: TgpuRoot, bindings: SharedBindings, rects: StorageArray<typeof DebugRect>) => root.createBindGroup(S.debugLayout, { frame: bindings.frame, rects });
type CommandEncoder = ReturnType<TgpuRoot['~unstable']['createCommandEncoder']>;
interface RectSet {
  buffer: StorageArray<typeof DebugRect>;
  group: ReturnType<typeof createDebugGroup>;
  count: number;
}

export interface RendererStats {
  frames: number;
  /** Frames drawn from the static cache / as full redraws, renders of the cache texture and why the last one was due. */
  cachedFrames: number;
  fullFrames: number;
  cacheRebuilds: number;
  lastRebuildReason: string;
  /** Partitions of the static scene against the slot envelopes (each envelope growth) and the last one's CPU time. */
  partitions: number;
  lastPartitionMs: number;
  lastEncodeMs: number;
  avgEncodeMs: number;
  /** GPU time of the last measured frame: first pass begin → main pass end (timestamp queries), ms. */
  lastGpuMs: number | null;
  lastGpuFrameRebuiltCache: boolean;
  draws: number;
  segments: number;
  opaqueVertices: number;
  blendedVertices: number;
  reorders: number;
  perFrameEntries: number;
  cachedEntries: number;
  perFrameSegments: number;
}

interface Targets {
  width: number;
  height: number;
  color: MsaaColor;
  depth: MsaaDepth;
  /** The resolved static frame (static cache), created on the first cached frame. */
  cache: ResolveColor | null;
}

export class Renderer {
  readonly stats: RendererStats = {
    frames: 0, cachedFrames: 0, fullFrames: 0, cacheRebuilds: 0, lastRebuildReason: '', partitions: 0, lastPartitionMs: 0, lastEncodeMs: 0, avgEncodeMs: 0, lastGpuMs: null, lastGpuFrameRebuiltCache: false,
    draws: 0, segments: 0, opaqueVertices: 0, blendedVertices: 0, reorders: 0, perFrameEntries: 0, cachedEntries: 0, perFrameSegments: 0,
  };
  private readonly root: TgpuRoot;
  private readonly surface: RenderSurface;
  private readonly scene: GpuScene;
  private readonly slots: SlotPlacement[];
  private readonly paints: PaintTable;
  private readonly clock: Clock;
  private readonly profiler: Profiler;
  private readonly cacheMode: CacheMode;
  private readonly onGpuTime: (ms: number, rebuiltCache: boolean) => void;
  private readonly measureRepeat: number;
  private readonly pipelines: Pipelines;
  /** Buffers every draw binds; slot painters build their bind groups on them. */
  readonly bindings: SharedBindings;
  private readonly halo: HaloEffect;
  private readonly itemCount: number;
  private readonly slotsByAnchor: SlotsByAnchor;

  // static geometry (rebuilt when a paint's class changes)
  private geometry: StaticGeometry | null = null;
  private geometryClassVersion = -1;
  private segBuffer: SegStorage | null = null;
  private orderBuffer: (TgpuBuffer<d.WgslArray<d.U32>> & StorageFlag) | null = null;
  /** View over the order buffer's host mirror. */
  private orderIndices: Uint32Array<ArrayBuffer> = new Uint32Array(0);
  private opaqueVB: FillBuffer | null = null;
  private blendedVB: FillBuffer | null = null;
  private haloVB: FillBuffer | null = null;
  /** Opaque static triangles reaching the slot envelopes (redrawn in a cached frame). */
  private regionOpaqueVB: FillBuffer | null = null;
  private staticGroup: LayoutGroup | null = null;
  private staticGroupVersion = -1;

  // painter's order and depth layout
  private readonly painters: SlotPainter[] = [];
  private readonly painterOfSlot: (SlotPainter | null)[];
  private readonly capacities: Uint32Array;
  private readonly slotEnvelopes: SlotEnvelopes;
  private readonly order: Uint32Array<ArrayBuffer>;
  private frameOrder: number[] = [];
  private steps: PainterStep[] = [];
  private readonly bases: Uint32Array;
  private readonly offsets: Float32Array;
  private depthTotal = 0;
  private orderShare = Number.NaN;
  private layoutDirty = true;
  /** Draw lists: everything (full frames), the static scene (the cache), what a cached frame redraws. */
  private fullDraws: Draw[] = [];
  private staticDraws: Draw[] = [];
  private frameDraws: Draw[] = [];

  // frame state
  private share = 0;
  private stableShareFrames = 0;
  /** The cache texture holds the current static frame. */
  private cacheValid = false;
  private cacheInvalidReason = 'first frame';
  /** The per-frame lists for the current layout (null: start a new one); envelope growth extends it. */
  private partition: CachePartition | null = null;
  private uploadedRegionVertices = 0;
  private targets: Targets | null = null;
  private dpr = 1;
  private background: Rgba = [1, 1, 1, 1];
  private query: { set: TimestampQuery; busy: boolean } | null = null;
  private marker: ReturnType<typeof createMarker> | null = null;
  /** Redraw-region rectangles (stencil mark) and the debug overlay's rectangles. */
  private region: RectSet | null = null;
  /** The region rects were written for this slot content version and the current layout. */
  private regionVersion = -1;
  private regionLayoutValid = false;
  private overlay: RectSet | null = null;
  private cacheGroup: TgpuBindGroup<(typeof S.cacheLayout)['entries']> | null = null;
  private readonly frameContext: FrameContext;

  constructor(root: TgpuRoot, options: RendererOptions) {
    this.root = root;
    this.surface = options.surface;
    this.scene = options.scene;
    this.slots = options.slots;
    this.paints = options.paints;
    this.clock = options.clock;
    this.profiler = options.profiler ?? NO_PROFILER;
    this.cacheMode = options.cache;
    this.onGpuTime = options.onGpuTime ?? (() => {});
    this.measureRepeat = Math.max(1, Math.floor(options.measureRepeat ?? 1));
    this.itemCount = this.scene.items.length;
    this.pipelines = createPipelines(root, this.surface.format);
    this.bindings = new SharedBindings(root, this.itemCount + this.slots.length);
    this.halo = new HaloEffect(root, this.pipelines);
    this.slotsByAnchor = slotsByAnchorOf(this.slots);
    this.painterOfSlot = this.slots.map(() => null);
    this.capacities = new Uint32Array(this.slots.length).fill(MIN_SLOT_CAPACITY);
    this.slotEnvelopes = new SlotEnvelopes(this.slots.length, this.scene.viewBox);
    this.order = new Uint32Array(this.itemCount);
    this.bases = new Uint32Array(this.itemCount + this.slots.length);
    this.offsets = new Float32Array((this.itemCount + this.slots.length) * 2);
    if (root.enabledFeatures.has('timestamp-query')) this.query = { set: createQuerySet(root), busy: false };
    const renderer = this;
    this.frameContext = {
      root,
      pipelines: this.pipelines,
      bindings: this.bindings,
      format: this.surface.format,
      get scale() { return renderer.viewScale(); },
      get translate() { return renderer.viewTranslate(); },
      get width() { return renderer.targets?.width ?? 0; },
      get height() { return renderer.targets?.height ?? 0; },
      get dpr() { return renderer.dpr; },
      get share() { return renderer.share; },
      slotItem: (slot) => this.itemCount + slot,
      depthBase: (slot) => this.bases[this.itemCount + slot],
      get depthTotal() { return renderer.depthTotal; },
      offsetOf: (slot) => [this.offsets[(this.itemCount + slot) * 2], this.offsets[(this.itemCount + slot) * 2 + 1]],
    };
  }

  /** Registers the painter of its slots (a later painter replaces an earlier one for the slots it names). */
  setSlotPainter(painter: SlotPainter) {
    this.painters.push(painter);
    for (const slot of painter.slots) this.painterOfSlot[slot] = painter;
    this.invalidateCache('slot painter');
  }

  /** Compiles every pipeline (the renderer's and the slot painters') ahead of the first frame. */
  async compile() {
    await compilePipelines(this.pipelines);
    await Promise.all(this.painters.flatMap((p) => p.pipelines()).map((pipeline) => pipeline.initAsync()));
  }

  get width() {
    return this.targets?.width ?? 0;
  }

  get height() {
    return this.targets?.height ?? 0;
  }

  /** (Re)allocates the targets for a canvas of `width × height` device px; the host sizes the canvas itself. */
  resize(width: number, height: number, dpr: number) {
    if (this.targets && this.targets.width === width && this.targets.height === height && this.dpr === dpr) return;
    this.destroyTargets();
    const size: [number, number] = [width, height];
    this.targets = { width, height, color: createMsaaColor(this.root, size, this.surface.format), depth: createMsaaDepth(this.root, size), cache: null };
    this.dpr = dpr;
    this.halo.invalidate();
    this.invalidateCache('resize');
  }

  setBackground(rgba: Rgba) {
    if (rgba.every((v, i) => v === this.background[i])) return;
    this.background = rgba;
    this.invalidateCache('background');
  }

  /** The paint table changed (theme, new live paints): colours are re-uploaded, geometry rebuilt when a class changed. */
  paintsChanged() {
    this.halo.invalidate();
    this.invalidateCache('paints');
  }

  render(share: number) {
    const targets = this.targets;
    if (!targets || !this.paints.size) return;
    const t0 = this.clock.now();
    this.profiler.begin(TIMING.encode);
    this.syncGeometry();
    this.bindings.writePaints(this.paints);
    this.updateShare(share);
    this.updateSlots();
    if (this.layoutDirty) this.relayout();
    const [tx, ty] = this.viewTranslate();
    const frameChanged = this.bindings.writeFrame({ scale: this.viewScale(), translate: [tx, ty], width: targets.width, height: targets.height, dpr: this.dpr, depthTotal: this.depthTotal });
    if (frameChanged) this.invalidateCache('frame uniform');
    const geometry = this.geometry!;
    const group = this.staticGroupOf();
    const encoder = this.root['~unstable'].createCommandEncoder();
    const query = this.query && !this.query.busy ? this.query : null;
    if (query) this.beginTimestamp(encoder, query.set);
    this.halo.prepare(encoder, geometry.halos, this.haloVB!, group, { scale: this.viewScale(), translate: [tx, ty], width: targets.width, height: targets.height }, this.paints,
      (item) => [this.offsets[item * 2], this.offsets[item * 2 + 1]], (item, layer) => depthOfSlot(this.bases[item] + layer, this.depthTotal));
    for (const painter of this.painters) painter.prepare(this.frameContext, encoder);
    const cached = this.cacheMode !== 'off' && this.stableShareFrames >= STABLE_SHARE_FRAMES;
    let rebuilt = false;
    if (cached) {
      this.updatePartition(targets);
      if (!this.cacheValid) {
        this.renderCache(encoder, targets, group);
        rebuilt = true;
      }
      this.writeRegion(targets);
    }
    for (let pass = 1; pass <= this.measureRepeat; pass++) {
      const last = pass === this.measureRepeat;
      this.encodeMainPass(encoder, targets, group, cached, last && query ? query.set : null);
    }
    if (cached) {
      this.stats.cachedFrames++;
      this.stats.draws = this.frameDraws.length + 3;
    } else {
      this.stats.fullFrames++;
      this.stats.draws = this.fullDraws.length + 1;
    }
    encoder.submit();
    this.surface.present?.();
    if (query) this.readTimestamps(query, rebuilt, this.measureRepeat);
    this.profiler.end(TIMING.encode);
    const ms = this.clock.now() - t0;
    const s = this.stats;
    s.frames++;
    s.lastEncodeMs = ms;
    s.avgEncodeMs += (ms - s.avgEncodeMs) / s.frames;
  }

  /**
   * The frame's main pass, resolved into the canvas. Cached: clear, mark the redraw region in the stencil, copy the
   * cached static frame outside it, then draw inside it what reaches it. Full: everything.
   */
  private encodeMainPass(encoder: CommandEncoder, targets: Targets, group: LayoutGroup, cached: boolean, timestamps: TgpuQuerySet<'timestamp'> | null) {
    const [r, g, b] = this.background;
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: targets.color, resolveTarget: this.surface.context, clearValue: [r, g, b, 1], loadOp: 'clear', storeOp: 'discard' }],
      depthStencilAttachment: { view: targets.depth, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard', stencilClearValue: 0, stencilLoadOp: 'clear', stencilStoreOp: 'discard' },
      ...(timestamps ? { timestampWrites: { querySet: timestamps, endOfPassWriteIndex: 1 } } : {}),
    });
    if (cached) {
      pass.setStencilReference(REGION_INSIDE);
      const region = this.region!;
      if (region.count) {
        pass.setPipeline(this.pipelines.markRegion);
        pass.setBindGroup(S.debugLayout, region.group);
        pass.draw(6, region.count);
      }
      pass.setPipeline(this.pipelines.cachedFrame);
      pass.setBindGroup(S.cacheLayout, this.cacheGroup!);
      pass.draw(3);
      pass.setBindGroup(S.layout, group);
      const regionOpaque = this.partition?.regionOpaque.count ?? 0;
      if (regionOpaque) {
        pass.setPipeline(this.pipelines.fillOpaque);
        pass.setVertexBuffer(S.fillLayout, this.regionOpaqueVB!);
        pass.draw(regionOpaque);
      }
      for (const painter of this.painters) painter.drawOpaque(this.frameContext, pass);
      this.drawList(pass, this.frameDraws, group);
      if (this.cacheMode === 'overlay') this.drawOverlay(pass);
    } else {
      pass.setBindGroup(S.layout, group);
      this.drawOpaqueStatic(pass);
      for (const painter of this.painters) painter.drawOpaque(this.frameContext, pass);
      this.drawList(pass, this.fullDraws, group);
    }
    pass.end();
  }

  /** Slot envelopes (viewBox units, before explode offsets) by slot name: the static cache's view of the slots. */
  envelopes(): Record<string, { box: [number, number, number, number]; cells: number; growths: number } | null> {
    return Object.fromEntries(this.slots.map((slot, i) => {
      const extent = this.slotEnvelopes.get(i);
      const box: [number, number, number, number] | null = extent ? [extent.box.x0, extent.box.y0, extent.box.x1, extent.box.y1] : null;
      return [slot.name, box && { box, cells: this.slotEnvelopes.rectsOf(i).length, growths: this.slotEnvelopes.growths[i] }];
    }));
  }

  dispose() {
    this.destroyTargets();
    this.destroyGeometry();
    this.halo.dispose();
    for (const painter of this.painters) painter.dispose();
    this.bindings.dispose();
    this.region?.buffer.destroy();
    this.overlay?.buffer.destroy();
    this.marker?.destroy();
    this.query?.set.destroy();
  }

  // ---- order, depth layout, cache validity --------------------------------------------------------------------------

  private viewScale() {
    return (this.targets?.width ?? 0) / this.scene.viewBox[2];
  }

  private viewTranslate(): [number, number] {
    const s = this.viewScale();
    return [-this.scene.viewBox[0] * s, -this.scene.viewBox[1] * s];
  }

  /** The static frame changed: the cache texture and the per-frame lists are redone before the next cached frame. */
  private invalidateCache(reason: string) {
    if (this.cacheValid) this.cacheInvalidReason = reason;
    this.cacheValid = false;
    this.partition = null;
    this.regionLayoutValid = false;
  }

  private syncGeometry() {
    if (this.geometry && this.geometryClassVersion === this.paints.classVersion) return;
    this.destroyGeometry();
    const geometry = buildStaticGeometry(this.scene, this.paints);
    this.geometry = geometry;
    this.geometryClassVersion = this.paints.classVersion;
    const segCount = geometry.segs.count;
    const segBuffer = this.root.createBuffer(d.arrayOf(Seg, Math.max(1, segCount))).$usage('storage');
    if (segCount) segBuffer.write(geometry.segs.f32.buffer.slice(0, geometry.segs.byteLength));
    this.segBuffer = segBuffer;
    // three regions of segment indices: the full painter order, the static-only order (cache), the per-frame order;
    // packed straight into the buffer's host mirror, so a region uploads without a copy
    this.orderBuffer = this.root.createBuffer(d.arrayOf(d.u32, Math.max(1, segCount * 3))).$usage('storage');
    this.orderIndices = new Uint32Array(this.orderBuffer.arrayBuffer);
    const upload = (writer: StaticGeometry['opaque']) => {
      const buffer = createFillBuffer(this.root, writer.count);
      if (writer.count) buffer.write(writer.f32.buffer.slice(0, writer.byteLength));
      return buffer;
    };
    this.opaqueVB = upload(geometry.opaque);
    this.blendedVB = upload(geometry.blended);
    this.haloVB = upload(geometry.haloVertices);
    this.staticGroup = null;
    this.halo.invalidate();
    this.layoutDirty = true;
    this.stats.segments = segCount;
    this.stats.opaqueVertices = geometry.opaque.count;
    this.stats.blendedVertices = geometry.blended.count;
  }

  private destroyGeometry() {
    for (const buffer of [this.segBuffer, this.orderBuffer, this.opaqueVB, this.blendedVB, this.haloVB, this.regionOpaqueVB]) buffer?.destroy();
    this.segBuffer = this.orderBuffer = this.opaqueVB = this.blendedVB = this.haloVB = this.regionOpaqueVB = null;
    this.geometry = null;
  }

  private staticGroupOf(): LayoutGroup {
    if (!this.staticGroup || this.staticGroupVersion !== this.bindings.version) {
      this.staticGroup = this.bindings.layoutGroup(this.segBuffer!, this.orderBuffer!);
      this.staticGroupVersion = this.bindings.version;
    }
    return this.staticGroup;
  }

  private updateShare(share: number) {
    this.stableShareFrames = share === this.share ? this.stableShareFrames + 1 : 0;
    this.share = share;
    if (share !== this.orderShare) this.layoutDirty = true;
  }

  /** Slot depth capacities and envelopes; growth of either re-lays the depth range or re-partitions. */
  private updateSlots() {
    for (let slot = 0; slot < this.slots.length; slot++) {
      const painter = this.painterOfSlot[slot];
      if (!painter) continue;
      const layers = painter.layersOf(slot);
      if (layers > this.capacities[slot]) {
        this.capacities[slot] = 2 ** Math.ceil(Math.log2(Math.max(MIN_SLOT_CAPACITY, layers)));
        this.layoutDirty = true;
      }
      this.slotEnvelopes.include(slot, painter.extentOf(slot));
    }
  }

  /** Painter's order, depth bases, explode offsets and the full draw list. */
  private relayout() {
    this.layoutDirty = false;
    const geometry = this.geometry!;
    const previous = this.frameOrder.join(',');
    orderOf(this.scene.items, this.share, this.order);
    this.orderShare = this.share;
    frameOrderOf(this.order, this.slotsByAnchor, this.itemCount, this.frameOrder);
    if (this.frameOrder.join(',') !== previous) this.stats.reorders++;
    this.steps = painterSequenceOf(this.frameOrder, geometry.entries, this.itemCount);
    this.depthTotal = depthBasesOf(this.frameOrder, (item) => (item < this.itemCount ? this.scene.items[item].layers : this.capacities[item - this.itemCount]), this.bases);
    for (let i = 0; i < this.itemCount + this.slots.length; i++) {
      const move = this.scene.items[i < this.itemCount ? i : this.slots[i - this.itemCount].anchor].move;
      this.offsets[i * 2] = move[0] * this.share;
      this.offsets[i * 2 + 1] = move[1] * this.share;
    }
    this.bindings.writeItems(this.offsets, this.bases, this.itemCount + this.slots.length);
    const segCount = geometry.segs.count;
    this.fullDraws = buildDraws(this.steps, geometry.entries, () => true, this.orderIndices, 0).draws;
    this.staticDraws = buildDraws(this.steps, geometry.entries, (s) => this.steps[s].item >= 0, this.orderIndices, segCount).draws;
    this.orderBuffer!.write(this.orderBuffer!.arrayBuffer, { endOffset: Math.max(1, segCount * 2) * 4 });
    this.invalidateCache('layout');
  }

  private partitionView(targets: Targets): PartitionView {
    const [tx, ty] = this.viewTranslate();
    return {
      scale: this.viewScale(),
      translate: [tx, ty],
      dpr: this.dpr,
      width: targets.width,
      height: targets.height,
      offsets: this.offsets,
      slotItemBase: this.itemCount,
      haloBox: (halo) => this.halo.boxOf(halo),
    };
  }

  /**
   * This frame's redraw region: the slots' current extents (inside their envelopes, which the partition used, so every
   * static segment and triangle that can reach the region is in the per-frame lists).
   */
  private writeRegion(targets: Targets) {
    const contentVersion = this.painters.reduce((sum, painter) => sum + painter.version, 0);
    if (this.region && contentVersion === this.regionVersion && this.regionLayoutValid) return;
    this.regionVersion = contentVersion;
    this.regionLayoutValid = true;
    const view = this.partitionView(targets);
    const rects: [DeviceRect, Rgba][] = [];
    for (let slot = 0; slot < this.slots.length; slot++) {
      const extent = this.painterOfSlot[slot]?.extentOf(slot);
      if (!extent) continue;
      const rect = clippedRectOf(slotRectOf(extent, offsetOf(view, this.itemCount + slot), view), view);
      if (rect) rects.push([rect, REGION_COLOR]);
    }
    this.region = this.writeRects(this.region, rects);
  }

  /**
   * Brings the per-frame lists up to date with the slot envelopes: a new partition after a layout change, else only
   * the cells the envelopes gained since the last frame (the cached frame itself does not change when they grow).
   */
  private updatePartition(targets: Targets) {
    const t0 = this.clock.now();
    const geometry = this.geometry!;
    let fresh = false;
    if (!this.partition) {
      this.partition = new CachePartition(this.steps, geometry.entries, geometry.segs, geometry.opaque, geometry.opaqueFills, this.partitionView(targets));
      this.slotEnvelopes.clearAdded();
      this.uploadedRegionVertices = 0;
      fresh = true;
    }
    const partition = this.partition;
    const cells = fresh ? this.slotEnvelopes.allCells() : this.slotEnvelopes.takeAdded();
    const changed = cells.length > 0 && partition.include(cells, this.slotEnvelopes);
    if (!changed && !fresh) return;
    const segCount = geometry.segs.count;
    const frame = buildDraws(this.steps, geometry.entries, (s) => partition.perFrame[s] === 1, this.orderIndices, segCount * 2, partition.segmentMask);
    this.frameDraws = frame.draws;
    if (segCount) this.orderBuffer!.write(this.orderBuffer!.arrayBuffer, { startOffset: segCount * 2 * 4, endOffset: segCount * 3 * 4 });
    this.uploadRegionOpaque(partition.regionOpaque);
    if (this.cacheMode === 'overlay') this.overlay = this.writeRects(this.overlay, [...partition.regionRects.map((r): [DeviceRect, Rgba] => [r, ENVELOPE_COLOR]), ...partition.entryRects.map((r): [DeviceRect, Rgba] => [r, PER_FRAME_COLOR])]);
    this.stats.perFrameEntries = partition.perFrameEntries;
    this.stats.cachedEntries = partition.cachedEntries;
    this.stats.perFrameSegments = frame.indexCount;
    this.stats.partitions++;
    this.stats.lastPartitionMs = this.clock.now() - t0;
  }

  /** Uploads the region's opaque triangles appended since the last upload (the buffer holds every opaque triangle). */
  private uploadRegionOpaque(region: FillWriter) {
    const geometry = this.geometry!;
    if (!this.regionOpaqueVB) this.regionOpaqueVB = createFillBuffer(this.root, geometry.opaque.count);
    const from = this.uploadedRegionVertices;
    if (region.count <= from) return;
    const W = FILL_VERTEX_RECORD.words;
    const host = this.regionOpaqueVB.arrayBuffer;
    new Uint32Array(host).set(region.u32.subarray(from * W, region.count * W), from * W);
    this.regionOpaqueVB.write(host, { startOffset: from * FILL_VERTEX_RECORD.bytes, endOffset: region.count * FILL_VERTEX_RECORD.bytes });
    this.uploadedRegionVertices = region.count;
  }

  /** Renders the static frame (every static primitive, no slot) into the cache texture. */
  private renderCache(encoder: CommandEncoder, targets: Targets, group: LayoutGroup) {
    this.stats.cacheRebuilds++;
    this.stats.lastRebuildReason = this.cacheInvalidReason;
    if (!targets.cache) {
      targets.cache = createResolveColor(this.root, [targets.width, targets.height], this.surface.format);
      this.cacheGroup = this.root.createBindGroup(S.cacheLayout, { frame: targets.cache });
    }
    const [r, g, b] = this.background;
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: targets.color, resolveTarget: targets.cache, clearValue: [r, g, b, 1], loadOp: 'clear', storeOp: 'discard' }],
      depthStencilAttachment: { view: targets.depth, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard', stencilClearValue: 0, stencilLoadOp: 'clear', stencilStoreOp: 'discard' },
    });
    pass.setBindGroup(S.layout, group);
    this.drawOpaqueStatic(pass);
    this.drawList(pass, this.staticDraws, group);
    pass.end();
    this.cacheValid = true;
  }

  // ---- drawing --------------------------------------------------------------------------------------------------------

  private drawOpaqueStatic(pass: TgpuRenderPass) {
    const count = this.geometry!.opaque.count;
    if (!count) return;
    pass.setPipeline(this.pipelines.fillOpaque);
    pass.setVertexBuffer(S.fillLayout, this.opaqueVB!);
    pass.draw(count);
  }

  /** Draws `draws` in order; slot painters bind their own `layout` group, so the static one is re-bound after them. */
  private drawList(pass: TgpuRenderPass, draws: Draw[], group: LayoutGroup) {
    pass.setBindGroup(S.layout, group);
    let staticBound = true;
    for (const draw of draws) {
      if (draw.kind === 'slot') {
        const painter = this.painterOfSlot[draw.slot];
        if (!painter) continue;
        painter.drawSlot(this.frameContext, pass, draw.slot);
        staticBound = false;
        continue;
      }
      if (draw.kind === 'halo') {
        this.halo.draw(pass, draw.halo, this.width, this.height);
        continue;
      }
      if (!staticBound) {
        pass.setBindGroup(S.layout, group);
        staticBound = true;
      }
      if (draw.kind === 'segs') {
        pass.setPipeline(strokePipelineOf(this.pipelines, draw.blend));
        pass.draw(6, draw.count, 0, draw.first);
      } else {
        pass.setPipeline(fillPipelineOf(this.pipelines, draw.blend));
        pass.setVertexBuffer(S.fillLayout, this.blendedVB!);
        pass.draw(draw.count, 1, draw.first);
      }
    }
  }

  /** Uploads device-px rectangles (grow-only buffer) for the region mark or the debug overlay. */
  private writeRects(current: RectSet | null, rects: [DeviceRect, Rgba][]): RectSet {
    let set = current;
    if (!set || set.buffer.dataType.elementCount < rects.length) {
      set?.buffer.destroy();
      const buffer = this.root.createBuffer(d.arrayOf(DebugRect, Math.max(4, rects.length * 2))).$usage('storage');
      set = { buffer, group: createDebugGroup(this.root, this.bindings, buffer), count: 0 };
    }
    const host = set.buffer.arrayBuffer;
    const f32 = new Float32Array(host);
    rects.forEach(([rect, color], i) => {
      const o = i * DEBUG_RECT_RECORD.words;
      f32.set([rect.x0, rect.y0], o + DEBUG_RECT_RECORD.min);
      f32.set([rect.x1, rect.y1], o + DEBUG_RECT_RECORD.max);
      f32.set(color, o + DEBUG_RECT_RECORD.color);
    });
    if (rects.length) set.buffer.write(host, { endOffset: rects.length * DEBUG_RECT_RECORD.bytes });
    set.count = rects.length;
    return set;
  }

  private drawOverlay(pass: TgpuRenderPass) {
    if (!this.overlay?.count) return;
    pass.setPipeline(this.pipelines.debugRects);
    pass.setBindGroup(S.debugLayout, this.overlay.group);
    pass.draw(6, this.overlay.count);
  }

  // ---- GPU timestamps: first pass begin → main pass end ------------------------------------------------------------

  private beginTimestamp(encoder: CommandEncoder, set: TgpuQuerySet<'timestamp'>) {
    this.marker ??= createMarker(this.root, this.surface.format);
    encoder.beginRenderPass({ colorAttachments: [{ view: this.marker, loadOp: 'clear', storeOp: 'discard' }], timestampWrites: { querySet: set, beginningOfPassWriteIndex: 0 } }).end();
  }

  private readTimestamps(query: { set: TimestampQuery; busy: boolean }, rebuilt: boolean, repeat: number) {
    query.busy = true;
    query.set.resolve();
    query.set.read().then(
      (t) => {
        this.stats.lastGpuMs = Number(t[1] - t[0]) / 1e6 / repeat;
        this.stats.lastGpuFrameRebuiltCache = rebuilt;
        this.onGpuTime(this.stats.lastGpuMs, rebuilt);
        query.busy = false;
      },
      () => {
        query.busy = false;
      },
    );
  }

  private destroyTargets() {
    const t = this.targets;
    if (!t) return;
    t.color.destroy();
    t.depth.destroy();
    t.cache?.destroy();
    this.cacheGroup = null;
    this.targets = null;
  }
}
