// GPU side of the native rotor (a SlotPainter for rotorBack, rotorFront, spout, fall). Per changed frame: one write of
// the RotorPart records and one compute dispatch that expands them into Seg + FillVertex records (rotor-shaders.ts);
// the existing pipelines draw those: all four slots' opaque faces in one `fillOpaque` draw, each slot's lines in one
// instanced `stroke` draw at the slot's painter position.
import { warn, type StorageFlag, type TgpuComputePipeline, type TgpuBindGroup, type TgpuBuffer, type TgpuCommandEncoder, type TgpuRenderPass, type TgpuRoot, type UniformFlag, type VertexFlag } from 'typegpu';
import * as d from 'typegpu/data';
import type { LayoutGroup, SharedBindings } from '../core/bindings.ts';
import { Seg, SEG_RECORD } from '../core/schemas.ts';
import * as S from '../core/shaders.ts';
import type { FrameContext, SlotExtent, SlotPainter } from '../core/slots.ts';
import { cameraOf, type Projection } from './kit-mirror.ts';
import { PART_LAYER, PART_RECORD, RotorPart, RotorProjection, RotorStyle, segSlotsOf, STYLE_RECORD, vertexSlotsOf } from './rotor-schemas.ts';
import { expandParts, rotorLayout } from './rotor-shaders.ts';
import type { RotorModel } from './rotor-model.ts';
import type { RotorStyles } from './rotor-styles.ts';

/** Grow-only buffers start at this many parts (10 vanes + 10 pocketed + a few released packets fit). */
const MIN_PARTS = 32;
/** Buffers are sized for the largest part (a packet: 12-point ring). */
const LARGEST_RING = 12;
const SEGS_PER_PART = segSlotsOf(LARGEST_RING);
const VERTICES_PER_PART = vertexSlotsOf(LARGEST_RING);

type Storage<T extends d.AnyWgslData> = TgpuBuffer<d.WgslArray<T>> & StorageFlag;
type FillWords = TgpuBuffer<d.WgslArray<d.U32>> & StorageFlag & VertexFlag;

interface Buffers {
  parts: number;
  partBuffer: Storage<typeof RotorPart>;
  segs: Storage<typeof Seg>;
  fills: FillWords;
  expand: TgpuBindGroup<(typeof rotorLayout)['entries']>;
}

export class RotorPainter implements SlotPainter {
  readonly stats = { uploads: 0, bytesUploaded: 0, dispatches: 0 };
  version = 0;
  private readonly pipeline: TgpuComputePipeline;
  private readonly projection: TgpuBuffer<typeof RotorProjection> & UniformFlag;
  private readonly ring: Storage<d.Vec2f>;
  private styles: Storage<typeof RotorStyle>;
  private stylesVersion = -1;
  private buffers: Buffers | null = null;
  private group: LayoutGroup | null = null;
  private groupVersion = -1;
  /** Model version the GPU records were expanded from. */
  private expanded = -1;
  /** Whether the renderer still lets this painter draw (it may hand the slots back). */
  private owned: boolean[];

  constructor(
    private readonly root: TgpuRoot,
    private readonly bindings: SharedBindings,
    /** Renderer slot index of rotorBack, rotorFront, spout, fall. */
    readonly slots: readonly number[],
    private readonly model: RotorModel,
    private readonly rotorStyles: RotorStyles,
    projection: Projection,
  ) {
    this.owned = slots.map(() => true);
    // WGSL-string entry points that read their builtin struct (`in.lid`) make TypeGPU warn `external-omitted' while
    // resolving; the code it emits is correct (as compilePipelines in src/core/pipelines.ts)
    warn.disable('external-omitted');
    try {
      this.pipeline = root.createComputePipeline({ compute: expandParts });
      this.pipeline.initSync();
    } finally {
      warn.reset();
    }
    const c = cameraOf(projection);
    this.projection = root.createBuffer(RotorProjection, {
      origin: d.vec2f(projection.origin[0], projection.origin[1]),
      xAxis: d.vec2f(c.sinA * c.k, c.cosA * c.sinE * c.k),
      yAxis: d.vec2f(-c.cosA * c.k, c.sinA * c.sinE * c.k),
      zAxis: -c.cosE * c.k,
    }).$usage('uniform');
    const templates = model.templates;
    this.ring = root.createBuffer(d.arrayOf(d.vec2f, templates.length / 2)).$usage('storage');
    this.ring.write(templates.buffer);
    this.styles = root.createBuffer(d.arrayOf(RotorStyle, 8)).$usage('storage');
  }

  layersOf(slot: number) {
    return this.model.slots[this.slots.indexOf(slot)].count * PART_LAYER.count;
  }

  extentOf(slot: number): SlotExtent | null {
    const s = this.model.slots[this.slots.indexOf(slot)];
    return s.empty ? null : s.extent;
  }

  pipelines() {
    return [];
  }

  release(slots: readonly number[]) {
    for (const slot of slots) {
      const i = this.slots.indexOf(slot);
      if (i >= 0) this.owned[i] = false;
    }
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
    const buffers = this.ensureBuffers(model.partCount);
    if (model.partCount) {
      const bytes = model.partCount * PART_RECORD.bytes;
      const host = buffers.partBuffer.arrayBuffer;
      new Uint32Array(host).set(model.records.subarray(0, bytes / 4));
      buffers.partBuffer.write(host, { endOffset: bytes });
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(rotorLayout, buffers.expand);
      pass.dispatchWorkgroups(model.partCount);
      pass.end();
      this.stats.uploads++;
      this.stats.bytesUploaded += bytes;
      this.stats.dispatches++;
    }
    this.expanded = model.version;
  }

  drawOpaque(frame: FrameContext, pass: TgpuRenderPass) {
    const buffers = this.buffers;
    const count = this.model.vertexCount;
    if (!buffers || !count) return;
    // one draw for the four slots; a released slot's parts are skipped by drawing the owned ranges only
    pass.setPipeline(frame.pipelines.fillOpaque);
    pass.setBindGroup(S.layout, this.groupOf(buffers));
    pass.setVertexBuffer(S.fillLayout, this.root.unwrap(buffers.fills));
    if (this.owned.every(Boolean)) {
      pass.draw(count);
      return;
    }
    this.model.slots.forEach((s, i) => {
      if (!this.owned[i] || s.empty) return;
      const first = this.vertexFirstOf(s.first);
      const end = s.first + s.count < this.model.partCount ? this.vertexFirstOf(s.first + s.count) : count;
      pass.draw(end - first, 1, first);
    });
  }

  drawSlot(frame: FrameContext, pass: TgpuRenderPass, slot: number) {
    const i = this.slots.indexOf(slot);
    const s = this.model.slots[i];
    const buffers = this.buffers;
    if (!buffers || !this.owned[i] || !s.segCount) return;
    pass.setBindGroup(S.layout, this.groupOf(buffers));
    pass.setPipeline(frame.pipelines.stroke);
    pass.draw(6, s.segCount, 0, s.segFirst);
  }

  /** Debug / tooling: the expanded records of the current frame (raw words), read back from the GPU. */
  async readback(): Promise<{ segs: Uint32Array; fills: Uint32Array } | null> {
    const b = this.buffers;
    if (!b || this.expanded !== this.model.version) return null;
    const segCount = this.model.segCount;
    const vertexCount = this.model.vertexCount;
    const [segs, fills] = await Promise.all([b.segs.read(), b.fills.read()]);
    const segWords = new Uint32Array(segCount * (d.sizeOf(Seg) / 4));
    const view = new DataView(segWords.buffer);
    // re-pack the read structs field by field through the schema layout (src/core/schemas.ts SEG_RECORD)
    segs.slice(0, segCount).forEach((seg, i) => {
      const o = i * d.sizeOf(Seg);
      const f = (word: number, value: number) => view.setFloat32(o + word * 4, value, true);
      const u = (word: number, value: number) => view.setUint32(o + word * 4, value, true);
      f(SEG_RECORD.p0, seg.p0.x); f(SEG_RECORD.p0 + 1, seg.p0.y);
      f(SEG_RECORD.p1, seg.p1.x); f(SEG_RECORD.p1 + 1, seg.p1.y);
      f(SEG_RECORD.joinStart, seg.joinStart.x); f(SEG_RECORD.joinStart + 1, seg.joinStart.y);
      f(SEG_RECORD.joinEnd, seg.joinEnd.x); f(SEG_RECORD.joinEnd + 1, seg.joinEnd.y);
      f(SEG_RECORD.width, seg.width); u(SEG_RECORD.item, seg.item); u(SEG_RECORD.paint, seg.paint); u(SEG_RECORD.layer, seg.layer);
      f(SEG_RECORD.alpha, seg.alpha); u(SEG_RECORD.flags, seg.flags); u(SEG_RECORD.polyStart, seg.polyStart); u(SEG_RECORD.polyEnd, seg.polyEnd);
      f(SEG_RECORD.crowd, seg.crowd);
    });
    return { segs: segWords, fills: Uint32Array.from(fills.slice(0, vertexCount * 4)) };
  }

  dispose() {
    this.destroyBuffers();
    this.projection.destroy();
    this.ring.destroy();
    this.styles.destroy();
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
    const host = this.styles.arrayBuffer;
    new Uint32Array(host).set(styles.records.subarray(0, styles.count * STYLE_RECORD.words));
    this.styles.write(host, { endOffset: styles.count * STYLE_RECORD.bytes });
    this.stylesVersion = styles.version;
    this.expanded = -1;
  }

  private ensureBuffers(parts: number): Buffers {
    if (this.buffers && this.buffers.parts >= parts) return this.buffers;
    this.destroyBuffers();
    const capacity = Math.max(MIN_PARTS, 2 ** Math.ceil(Math.log2(Math.max(1, parts))));
    const partBuffer = this.root.createBuffer(d.arrayOf(RotorPart, capacity)).$usage('storage');
    const segs = this.root.createBuffer(d.arrayOf(Seg, capacity * SEGS_PER_PART)).$usage('storage');
    const fills = this.root.createBuffer(d.arrayOf(d.u32, capacity * VERTICES_PER_PART * 4)).$usage('storage', 'vertex');
    const expand = this.root.createBindGroup(rotorLayout, { projection: this.projection, parts: partBuffer, ring: this.ring, styles: this.styles, segs, fills });
    this.buffers = { parts: capacity, partBuffer, segs, fills, expand };
    this.bindings.identityOf(capacity * SEGS_PER_PART);
    this.group = null;
    this.expanded = -1;
    return this.buffers;
  }

  private groupOf(buffers: Buffers): LayoutGroup {
    if (!this.group || this.groupVersion !== this.bindings.version) {
      this.group = this.bindings.layoutGroup(buffers.segs, this.bindings.identityOf(buffers.parts * SEGS_PER_PART));
      this.groupVersion = this.bindings.version;
    }
    return this.group;
  }

  private destroyBuffers() {
    const b = this.buffers;
    if (!b) return;
    b.partBuffer.destroy();
    b.segs.destroy();
    b.fills.destroy();
    this.buffers = null;
    this.group = null;
  }
}
