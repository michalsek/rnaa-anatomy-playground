// GPU side of the native rotor (a SlotPainter for rotorBack, rotorFront, spout, fall). Per changed frame: one write of
// the RotorPart records and their class records, and one compute dispatch that expands them into Seg + FillVertex
// records (rotor-shaders.ts); the existing pipelines draw those: the owned slots' opaque faces in one `fillOpaque`
// draw, each slot's lines in one instanced `stroke` draw at the slot's painter position.
//
// The compute pipeline is created here and compiled with the renderer (`pipelines()`), never inside v2's tick. Every
// buffer is sized from the model's exact counts (grow-only).
import type { StorageFlag, TgpuBindGroup, TgpuBuffer, TgpuCommandEncoder, TgpuComputePipeline, TgpuRenderPass, TgpuRoot, UniformFlag, VertexFlag } from 'typegpu';
import * as d from 'typegpu/data';
import type { LayoutGroup, SharedBindings } from '../core/bindings.ts';
import { Seg, SEG_RECORD } from '../core/schemas.ts';
import * as S from '../core/shaders.ts';
import type { FrameContext, SlotExtent, SlotPainter } from '../core/slots.ts';
import { cameraOf, type Projection } from './kit-mirror.ts';
import { PART_LAYER, PART_RECORD, RotorPart, RotorProjection, RotorStyle, STYLE_RECORD } from './rotor-schemas.ts';
import { RotorCpuEmitter } from './rotor-cpu-emitter.ts';
import { expandParts, rotorLayout } from './rotor-shaders.ts';
import type { RotorModel } from './rotor-model.ts';
import { INITIAL_STYLE_CAPACITY, type RotorStyles } from './rotor-styles.ts';

/** Grow-only buffers start with room for this many parts of the largest template (a typical frame fits). */
const MIN_PARTS = 32;

type Storage<T extends d.AnyWgslData> = TgpuBuffer<d.WgslArray<T>> & StorageFlag;
type FillWords = TgpuBuffer<d.WgslArray<d.U32>> & StorageFlag & VertexFlag;

/** Capacities in records (parts, segs, fill vertices) and words (classes). */
interface Capacity {
  parts: number;
  segs: number;
  vertices: number;
  classWords: number;
}

interface Buffers {
  capacity: Capacity;
  partBuffer: Storage<typeof RotorPart>;
  classBuffer: Storage<d.U32>;
  segBuffer: Storage<typeof Seg>;
  fillBuffer: FillWords;
  /** The raw buffers the per-frame writes go to (no TypeGPU host copy). */
  gpuParts: GPUBuffer;
  gpuClasses: GPUBuffer;
  expand: TgpuBindGroup<(typeof rotorLayout)['entries']>;
}

const nextPowerOfTwo = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/**
 * Where the parts become Seg / FillVertex records: `gpu` = the compute pass (default); `cpu` = RotorCpuEmitter on the
 * main thread, uploaded (`?native=cpu`, an evaluation of the alternative for PORT-PLAN P3).
 */
export type RotorExpansion = 'gpu' | 'cpu';

/** Record ranges of one slot in the expanded buffers. */
interface SlotRange {
  segFirst: number;
  segCount: number;
  vertexFirst: number;
  vertexCount: number;
}

export class RotorPainter implements SlotPainter {
  readonly stats = { uploads: 0, bytesUploaded: 0, dispatches: 0, emitMs: 0 };
  version = 0;
  private readonly pipeline: TgpuComputePipeline;
  private readonly projection: TgpuBuffer<typeof RotorProjection> & UniformFlag;
  private readonly ring: Storage<d.Vec2f>;
  private readonly triangles: Storage<d.U32>;
  private styles: Storage<typeof RotorStyle>;
  private stylesVersion = -1;
  private buffers: Buffers | null = null;
  private group: LayoutGroup | null = null;
  private groupVersion = -1;
  /** Model version the GPU records were expanded from. */
  private expanded = -1;
  private readonly minimum: Capacity;
  private readonly ranges: SlotRange[];
  private readonly emitter: RotorCpuEmitter | null;

  constructor(
    private readonly root: TgpuRoot,
    private readonly bindings: SharedBindings,
    /** Renderer slot index of rotorBack, rotorFront, spout, fall. */
    readonly slots: readonly number[],
    private readonly model: RotorModel,
    private readonly rotorStyles: RotorStyles,
    projection: Projection,
    private readonly expansion: RotorExpansion = 'gpu',
    private readonly clock: { now(): number } = performance,
  ) {
    this.pipeline = root.createComputePipeline({ compute: expandParts });
    this.ranges = slots.map(() => ({ segFirst: 0, segCount: 0, vertexFirst: 0, vertexCount: 0 }));
    this.emitter = expansion === 'cpu' ? new RotorCpuEmitter(model, rotorStyles, projection) : null;
    const c = cameraOf(projection);
    this.projection = root.createBuffer(RotorProjection, {
      origin: d.vec2f(projection.origin[0], projection.origin[1]),
      xAxis: d.vec2f(c.sinA * c.k, c.cosA * c.sinE * c.k),
      yAxis: d.vec2f(-c.cosA * c.k, c.sinA * c.sinE * c.k),
      zAxis: -c.cosE * c.k,
    }).$usage('uniform');
    const templates = model.templates;
    const ring = templates.ring32();
    this.ring = root.createBuffer(d.arrayOf(d.vec2f, ring.length / 2)).$usage('storage');
    this.ring.write(ring.buffer);
    const triangles = templates.triangles();
    this.triangles = root.createBuffer(d.arrayOf(d.u32, triangles.length)).$usage('storage');
    this.triangles.write(triangles.buffer);
    this.styles = root.createBuffer(d.arrayOf(RotorStyle, Math.max(INITIAL_STYLE_CAPACITY, rotorStyles.count))).$usage('storage');
    const largest = templates.templates.reduce((a, b) => (a.segSlots + a.vertexSlots >= b.segSlots + b.vertexSlots ? a : b));
    this.minimum = { parts: MIN_PARTS, segs: MIN_PARTS * largest.segSlots, vertices: MIN_PARTS * largest.vertexSlots, classWords: MIN_PARTS * largest.classWords };
  }

  layersOf(slot: number) {
    return this.model.slots[this.slots.indexOf(slot)].count * PART_LAYER.count;
  }

  extentOf(slot: number): SlotExtent | null {
    const s = this.model.slots[this.slots.indexOf(slot)];
    return s.empty ? null : s.extent;
  }

  /** The expansion pipeline: compiled with the renderer (Renderer.compile), before the painter draws. */
  pipelines() {
    return this.expansion === 'gpu' ? [this.pipeline] : [];
  }

  /** Slots given to another painter are skipped by asking the renderer (FrameContext.ownerOf) each frame. */
  release() {
    this.version++;
  }

  acquire() {
    this.version++;
  }

  /** The last frame's upload / expansion may not have run (failed frame): the next prepare redoes both. */
  invalidate() {
    this.expanded = -1;
    this.stylesVersion = -1;
    this.version++;
  }

  /** The model changed: the next prepare uploads and expands it. */
  modelChanged() {
    this.version++;
  }

  prepare(_frame: FrameContext, encoder: TgpuCommandEncoder) {
    const model = this.model;
    if (this.expanded === model.version && this.stylesVersion === this.rotorStyles.version) return;
    this.syncStyles();
    const buffers = this.ensureBuffers();
    if (this.emitter) {
      this.uploadEmitted(buffers, this.emitter);
      this.expanded = model.version;
      return;
    }
    for (let i = 0; i < model.slots.length; i++) {
      const s = model.slots[i];
      const range = this.ranges[i];
      range.segFirst = s.segFirst;
      range.segCount = s.segCount;
      range.vertexFirst = s.count ? this.vertexFirstOf(s.first) : 0;
      range.vertexCount = s.count ? (s.first + s.count < model.partCount ? this.vertexFirstOf(s.first + s.count) : model.vertexCount) - range.vertexFirst : 0;
    }
    if (model.partCount) {
      const queue = this.root.device.queue;
      const partWords = model.partCount * PART_RECORD.words;
      queue.writeBuffer(buffers.gpuParts, 0, model.records, 0, partWords);
      queue.writeBuffer(buffers.gpuClasses, 0, model.classes, 0, model.classWordCount);
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(rotorLayout, buffers.expand);
      pass.dispatchWorkgroups(model.partCount);
      pass.end();
      this.stats.uploads++;
      this.stats.bytesUploaded += (partWords + model.classWordCount) * 4;
      this.stats.dispatches++;
    }
    this.expanded = model.version;
  }

  drawOpaque(frame: FrameContext, pass: TgpuRenderPass) {
    const buffers = this.buffers;
    const ranges = this.ranges;
    // the slots' vertex ranges are contiguous from 0, in slot order (empty slots have none)
    let count = 0;
    for (const range of ranges) count += range.vertexCount;
    if (!buffers || !count) return;
    pass.setPipeline(frame.pipelines.fillOpaque);
    pass.setBindGroup(S.layout, this.groupOf(buffers));
    pass.setVertexBuffer(S.fillLayout, this.root.unwrap(buffers.fillBuffer));
    // one draw for the four slots; a slot the renderer gave to another painter is skipped by drawing the owned ranges
    let ownsAll = true;
    for (const slot of this.slots) ownsAll &&= frame.ownerOf(slot) === this;
    if (ownsAll) {
      pass.draw(count);
      return;
    }
    ranges.forEach((range, i) => {
      if (frame.ownerOf(this.slots[i]) === this && range.vertexCount) pass.draw(range.vertexCount, 1, range.vertexFirst);
    });
  }

  drawSlot(frame: FrameContext, pass: TgpuRenderPass, slot: number) {
    const s = this.ranges[this.slots.indexOf(slot)];
    const buffers = this.buffers;
    if (!buffers || !s.segCount) return;
    pass.setBindGroup(S.layout, this.groupOf(buffers));
    pass.setPipeline(frame.pipelines.stroke);
    pass.draw(6, s.segCount, 0, s.segFirst);
  }

  /** Debug / tooling: the expanded records of the current frame, read back from the GPU as raw words. */
  async readback(): Promise<{ segs: Uint32Array; fills: Uint32Array } | null> {
    const b = this.buffers;
    if (!b || this.expanded !== this.model.version) return null;
    const [segs, fills] = await Promise.all([
      this.readWords(this.root.unwrap(b.segBuffer), this.model.segCount * SEG_RECORD.words),
      this.readWords(this.root.unwrap(b.fillBuffer), this.model.vertexCount * 4),
    ]);
    return { segs, fills };
  }

  dispose() {
    this.destroyBuffers();
    this.projection.destroy();
    this.ring.destroy();
    this.triangles.destroy();
    this.styles.destroy();
  }

  /** `?native=cpu`: the parts expanded on the CPU, the drawn records uploaded. */
  private uploadEmitted(buffers: Buffers, emitter: RotorCpuEmitter) {
    const t0 = this.clock.now();
    emitter.emit();
    this.stats.emitMs += this.clock.now() - t0;
    const queue = this.root.device.queue;
    const segWords = emitter.segs.count * SEG_RECORD.words;
    queue.writeBuffer(this.root.unwrap(buffers.segBuffer), 0, emitter.segs.u32, 0, segWords);
    queue.writeBuffer(this.root.unwrap(buffers.fillBuffer), 0, emitter.fills, 0, emitter.vertexCount * 4);
    emitter.slots.forEach((emitted, i) => Object.assign(this.ranges[i], emitted));
    this.stats.uploads++;
    this.stats.bytesUploaded += (segWords + emitter.vertexCount * 4) * 4;
  }

  private async readWords(source: GPUBuffer, words: number): Promise<Uint32Array> {
    const device = this.root.device;
    const size = Math.max(4, words * 4);
    const staging = device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    try {
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(source, 0, staging, 0, size);
      device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      return new Uint32Array(staging.getMappedRange().slice(0, words * 4));
    } finally {
      staging.destroy();
    }
  }

  private vertexFirstOf(part: number) {
    return this.model.records[part * PART_RECORD.words + PART_RECORD.vertexFirst];
  }

  private syncStyles() {
    const styles = this.rotorStyles;
    if (this.stylesVersion === styles.version) return;
    if (this.styles.dataType.elementCount < styles.count) {
      this.styles.destroy();
      this.styles = this.root.createBuffer(d.arrayOf(RotorStyle, styles.count * 2)).$usage('storage');
      this.destroyBuffers();
    }
    this.root.device.queue.writeBuffer(this.root.unwrap(this.styles), 0, styles.records, 0, styles.count * STYLE_RECORD.words);
    this.stylesVersion = styles.version;
    this.expanded = -1;
  }

  /** Buffers for the current frame's exact counts (grow-only, powers of two, never below `minimum`). */
  private ensureBuffers(): Buffers {
    const model = this.model;
    const b = this.buffers?.capacity;
    if (b && b.parts >= model.partCount && b.segs >= model.segCount && b.vertices >= model.vertexCount && b.classWords >= model.classWordCount) return this.buffers!;
    const capacity: Capacity = {
      parts: nextPowerOfTwo(Math.max(this.minimum.parts, model.partCount, b?.parts ?? 0)),
      segs: nextPowerOfTwo(Math.max(this.minimum.segs, model.segCount, b?.segs ?? 0)),
      vertices: nextPowerOfTwo(Math.max(this.minimum.vertices, model.vertexCount, b?.vertices ?? 0)),
      classWords: nextPowerOfTwo(Math.max(this.minimum.classWords, model.classWordCount, b?.classWords ?? 0)),
    };
    this.destroyBuffers();
    const root = this.root;
    const partBuffer = root.createBuffer(d.arrayOf(RotorPart, capacity.parts)).$usage('storage');
    const classBuffer = root.createBuffer(d.arrayOf(d.u32, capacity.classWords)).$usage('storage');
    const segBuffer = root.createBuffer(d.arrayOf(Seg, capacity.segs)).$usage('storage');
    const fillBuffer = root.createBuffer(d.arrayOf(d.u32, capacity.vertices * 4)).$usage('storage', 'vertex');
    const expand = root.createBindGroup(rotorLayout, { projection: this.projection, parts: partBuffer, ring: this.ring, styles: this.styles, classes: classBuffer, triangles: this.triangles, segs: segBuffer, fills: fillBuffer });
    this.buffers = { capacity, partBuffer, classBuffer, segBuffer, fillBuffer, gpuParts: root.unwrap(partBuffer), gpuClasses: root.unwrap(classBuffer), expand };
    this.bindings.identityOf(capacity.segs);
    this.group = null;
    this.expanded = -1;
    return this.buffers;
  }

  private groupOf(buffers: Buffers): LayoutGroup {
    if (!this.group || this.groupVersion !== this.bindings.version) {
      this.group = this.bindings.layoutGroup(buffers.segBuffer, this.bindings.identityOf(buffers.capacity.segs));
      this.groupVersion = this.bindings.version;
    }
    return this.group;
  }

  private destroyBuffers() {
    const b = this.buffers;
    if (!b) return;
    b.partBuffer.destroy();
    b.classBuffer.destroy();
    b.segBuffer.destroy();
    b.fillBuffer.destroy();
    this.buffers = null;
    this.group = null;
  }
}
