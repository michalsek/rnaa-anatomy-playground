// GPU side of the markup-driven live slots (a SlotPainter): one grow-only buffer per slot ([Seg records | FillVertex
// records], one write per changed slot), its bind group, the slot's draws at its painter position, and group-opacity
// layers.
//
// Group opacity: every layered group of the frame gets a cell in one atlas (shelf-packed), all cells are drawn in one
// 4× MSAA pass with the regular pipelines (a Frame uniform per cell maps the group's device box onto its cell; the
// cell is scissored) and resolved once; each group is then composited in the main pass at its painter position: a quad
// over its device box at the depth of its frontmost primitive, atlas texel × alpha, source-over. Later opaque fills
// still cover it per sample through the depth test.
import type { StorageFlag, TgpuBindGroup, TgpuBuffer, TgpuCommandEncoder, TgpuRenderPass, TgpuRoot, VertexFlag } from 'typegpu';
import * as d from 'typegpu/data';
import type { FrameBuffer, FrameValues, LayoutGroup, SharedBindings } from '../core/bindings.ts';
import { createMsaaColor, createMsaaDepth, createResolveColor, type MsaaColor, type MsaaDepth, type ResolveColor } from '../core/gpu-types.ts';
import { fillPipelineOf, strokePipelineOf } from '../core/pipelines.ts';
import { depthOfSlot, Frame, GROUP_PARAMS_RECORD, GroupParams, Seg, SEG_RECORD } from '../core/schemas.ts';
import * as S from '../core/shaders.ts';
import type { FrameContext, SlotExtent, SlotPainter } from '../core/slots.ts';
import type { LayerGroup, SlotDraw, SlotGeometry } from './geometry.ts';

type SlotBuffer = TgpuBuffer<d.WgslArray<typeof Seg>> & StorageFlag & VertexFlag;
type CompositeGroup = TgpuBindGroup<(typeof S.compositeLayout)['entries']>;

/** Smallest slot buffer (bytes); buffers grow to the next power of two. */
const MIN_SLOT_BUFFER_BYTES = 4096;
/** Device px around a group's box: anti-aliasing ramps and MSAA sample offsets (strokes add their half-width). */
const LAYER_MARGIN_PX = 2;
/** Atlas sizes are multiples of this (device px), so moving groups rarely reallocate it. */
const ATLAS_STEP = 64;
/** Preferred atlas row width (device px; wider groups widen it). */
const ATLAS_ROW_WIDTH = 1024;
/** Frames without any layered group after which the atlas is released. */
const ATLAS_IDLE_FRAMES = 120;
/** Frames in a row needing less than half the atlas area after which it is reallocated at the size needed. */
const ATLAS_SHRINK_FRAMES = 120;

/** Atlas sizes are rounded up to whole ATLAS_STEPs. */
const atlasStep = (n: number) => Math.ceil(n / ATLAS_STEP) * ATLAS_STEP;

interface SlotState {
  geometry: SlotGeometry | null;
  buffer: SlotBuffer | null;
  /** Buffer capacity in bytes. */
  capacity: number;
  group: LayoutGroup | null;
  groupVersion: number;
}

/** A layered group of this frame: its device box on the canvas and its cell in the atlas. */
interface ActiveGroup {
  slot: number;
  group: number;
  x0: number;
  y0: number;
  width: number;
  height: number;
  ax: number;
  ay: number;
}

interface Atlas {
  width: number;
  height: number;
  canvasWidth: number;
  msaa: MsaaColor;
  depth: MsaaDepth;
  resolve: ResolveColor;
}

interface CellBinding {
  frame: FrameBuffer;
  group: LayoutGroup | null;
  buffer: SlotBuffer | null;
  version: number;
}

export class LiveSlots implements SlotPainter {
  readonly stats = { uploads: 0, bytesUploaded: 0, groups: 0, layerPixels: 0, atlasAllocations: 0 };
  version = 0;
  private readonly states: SlotState[];
  private readonly index = new Map<number, number>();
  /** Per state: the renderer gave the slot to another painter (native); nothing is uploaded or drawn for it. */
  private readonly released: Uint8Array;
  private atlas: Atlas | null = null;
  private idleFrames = 0;
  /** Frames in a row the active groups needed less than half the atlas. */
  private smallFrames = 0;
  /** This frame's layered groups: the first `activeCount` entries (objects reused across frames). */
  private readonly active: ActiveGroup[] = [];
  private activeCount = 0;
  /** Indices of the active groups, tallest first (shelf packing order). */
  private readonly packOrder: number[] = [];
  private readonly cellFrame: FrameValues = { scale: 0, translate: [0, 0], width: 0, height: 0, dpr: 1, depthTotal: 0 };
  /** Position in `active` of [state][group], −1 when not composited this frame. */
  private readonly activeOf: number[][];
  private params: TgpuBuffer<d.WgslArray<typeof GroupParams>> & StorageFlag;
  private paramsI32: Int32Array;
  private paramsF32: Float32Array;
  private cells: CellBinding[] = [];
  private composite: CompositeGroup | null = null;

  constructor(
    private readonly root: TgpuRoot,
    private readonly bindings: SharedBindings,
    readonly slots: readonly number[],
  ) {
    slots.forEach((slot, i) => this.index.set(slot, i));
    this.states = slots.map(() => ({ geometry: null, buffer: null, capacity: 0, group: null, groupVersion: -1 }));
    this.released = new Uint8Array(slots.length);
    this.activeOf = slots.map(() => []);
    this.params = root.createBuffer(d.arrayOf(GroupParams, 4)).$usage('storage');
    this.paramsI32 = new Int32Array(this.params.arrayBuffer);
    this.paramsF32 = new Float32Array(this.params.arrayBuffer);
  }

  /** Whether this painter still draws `slot` (the renderer may have given it to another painter). */
  owns(slot: number) {
    const i = this.index.get(slot);
    return i !== undefined && !this.released[i];
  }

  /** The slots now belong to another painter: nothing is uploaded or drawn for them, their buffers are freed. */
  release(slots: readonly number[]) {
    for (const slot of slots) {
      const i = this.index.get(slot);
      if (i === undefined) continue;
      this.released[i] = 1;
      const state = this.states[i];
      state.buffer?.destroy();
      state.buffer = null;
      state.capacity = 0;
      state.group = null;
      state.geometry = null;
      this.activeOf[i].length = 0;
    }
    this.version++;
  }

  /** The renderer gave `slots` back (a native machine fell back): they are uploaded and drawn again. */
  acquire(slots: readonly number[]) {
    for (const slot of slots) {
      const i = this.index.get(slot);
      if (i !== undefined) this.released[i] = 0;
    }
    this.version++;
  }

  /** Uploads a slot's new geometry (one buffer write); returns the bytes written (0 for a released slot). */
  update(slot: number, geometry: SlotGeometry): number {
    if (!this.owns(slot)) return 0;
    const state = this.stateOf(slot);
    if (geometry.byteLength > state.capacity) {
      state.buffer?.destroy();
      state.capacity = 2 ** Math.ceil(Math.log2(Math.max(MIN_SLOT_BUFFER_BYTES, geometry.byteLength)));
      state.buffer = this.root.createBuffer(d.arrayOf(Seg, Math.ceil(state.capacity / SEG_RECORD.bytes))).$usage('storage', 'vertex');
      state.group = null;
    }
    this.bindings.identityOf(geometry.segCount);
    const buffer = state.buffer;
    if (geometry.byteLength && buffer) {
      const host = buffer.arrayBuffer;
      new Uint8Array(host).set(new Uint8Array(geometry.bytes, 0, geometry.byteLength));
      buffer.write(host, { endOffset: geometry.byteLength });
    }
    state.geometry = geometry;
    this.stats.uploads++;
    this.stats.bytesUploaded += geometry.byteLength;
    this.version++;
    return geometry.byteLength;
  }

  layersOf(slot: number) {
    return this.stateOf(slot).geometry?.layers ?? 0;
  }

  extentOf(slot: number): SlotExtent | null {
    return this.stateOf(slot).geometry?.extent ?? null;
  }

  pipelines() {
    return [];
  }

  get activeGroups() {
    return this.activeCount;
  }

  prepare(frame: FrameContext, encoder: TgpuCommandEncoder) {
    this.collectGroups(frame);
    const count = this.activeCount;
    if (!count) {
      if (this.atlas && ++this.idleFrames > ATLAS_IDLE_FRAMES) this.releaseAtlas();
      return;
    }
    this.idleFrames = 0;
    const atlas = this.ensureAtlas(frame);
    this.ensureParams(atlas);
    const { paramsI32: i32, paramsF32: f32, cellFrame } = this;
    cellFrame.scale = frame.scale;
    cellFrame.translate = frame.translate;
    cellFrame.width = atlas.width;
    cellFrame.height = atlas.height;
    cellFrame.dpr = frame.dpr;
    cellFrame.depthTotal = frame.depthTotal;
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: atlas.msaa, resolveTarget: atlas.resolve, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'discard' }],
      depthStencilAttachment: { view: atlas.depth, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard', stencilClearValue: 0, stencilLoadOp: 'clear', stencilStoreOp: 'discard' },
    });
    for (let k = 0; k < count; k++) {
      const g = this.active[k];
      const state = this.states[g.slot];
      const geometry = state.geometry;
      const buffer = state.buffer;
      if (!geometry || !buffer) continue;
      const group = geometry.groups[g.group];
      const cell = this.cellOf(k);
      this.bindings.writeFrame(cellFrame, cell.frame, g.x0 - g.ax, g.y0 - g.ay);
      const o = k * GROUP_PARAMS_RECORD.words;
      i32[o + GROUP_PARAMS_RECORD.atlasOrigin] = g.ax;
      i32[o + GROUP_PARAMS_RECORD.atlasOrigin + 1] = g.ay;
      i32[o + GROUP_PARAMS_RECORD.canvasOrigin] = g.x0;
      i32[o + GROUP_PARAMS_RECORD.canvasOrigin + 1] = g.y0;
      i32[o + GROUP_PARAMS_RECORD.size] = g.width;
      i32[o + GROUP_PARAMS_RECORD.size + 1] = g.height;
      f32[o + GROUP_PARAMS_RECORD.depth] = depthOfSlot(frame.depthBase(this.slots[g.slot]) + group.frontLayer, frame.depthTotal);
      f32[o + GROUP_PARAMS_RECORD.alpha] = group.alpha;
      pass.setScissorRect(g.ax, g.ay, g.width, g.height);
      pass.setBindGroup(S.layout, this.cellGroup(cell, buffer, geometry.segCount));
      pass.setVertexBuffer(S.fillLayout, buffer.buffer, geometry.segCount * SEG_RECORD.bytes);
      if (group.opaque.count) {
        pass.setPipeline(frame.pipelines.fillOpaque);
        pass.draw(group.opaque.count, 1, group.opaque.first);
      }
      for (const draw of group.draws) if (draw.kind !== 'group') this.drawBlended(frame, pass, draw);
      this.stats.layerPixels += g.width * g.height;
    }
    pass.end();
    this.params.write(this.params.arrayBuffer, { endOffset: count * GROUP_PARAMS_RECORD.bytes });
    this.stats.groups += count;
  }

  drawOpaque(frame: FrameContext, pass: TgpuRenderPass) {
    let pipelineSet = false;
    for (const state of this.states) {
      const geometry = state.geometry;
      if (!geometry?.opaque.count || !state.buffer) continue;
      if (!pipelineSet) {
        pass.setPipeline(frame.pipelines.fillOpaque);
        pipelineSet = true;
      }
      pass.setBindGroup(S.layout, this.groupOf(state, state.buffer));
      pass.setVertexBuffer(S.fillLayout, state.buffer.buffer, geometry.segCount * SEG_RECORD.bytes);
      pass.draw(geometry.opaque.count, 1, geometry.opaque.first);
    }
  }

  drawSlot(frame: FrameContext, pass: TgpuRenderPass, slot: number) {
    const i = this.index.get(slot);
    if (i === undefined) return;
    const state = this.states[i];
    const geometry = state.geometry;
    if (!geometry?.draws.length || !state.buffer) return;
    pass.setBindGroup(S.layout, this.groupOf(state, state.buffer));
    pass.setVertexBuffer(S.fillLayout, state.buffer.buffer, geometry.segCount * SEG_RECORD.bytes);
    for (const draw of geometry.draws) {
      if (draw.kind !== 'group') {
        this.drawBlended(frame, pass, draw);
        continue;
      }
      const k = this.activeOf[i][draw.group];
      if (k === undefined || k < 0 || !this.composite) continue;
      pass.setPipeline(frame.pipelines.composite);
      pass.setBindGroup(S.compositeLayout, this.composite);
      pass.draw(6, 1, 0, k);
    }
  }

  dispose() {
    for (const state of this.states) state.buffer?.destroy();
    for (const cell of this.cells) cell.frame.destroy();
    this.cells = [];
    this.params.destroy();
    this.releaseAtlas();
  }

  private stateOf(slot: number): SlotState {
    const i = this.index.get(slot);
    if (i === undefined) throw new Error(`live slots: slot ${slot} is not painted here`);
    return this.states[i];
  }

  private drawBlended(frame: FrameContext, pass: TgpuRenderPass, draw: Exclude<SlotDraw, { kind: 'group' }>) {
    if (draw.kind === 'segs') {
      pass.setPipeline(strokePipelineOf(frame.pipelines, draw.blend));
      pass.draw(6, draw.count, 0, draw.first);
    } else {
      pass.setPipeline(fillPipelineOf(frame.pipelines, draw.blend));
      pass.draw(draw.count, 1, draw.first);
    }
  }

  private groupOf(state: SlotState, buffer: SlotBuffer): LayoutGroup {
    if (!state.group || state.groupVersion !== this.bindings.version) {
      state.group = this.bindings.layoutGroup(buffer, this.bindings.identityOf(state.geometry?.segCount ?? 1));
      state.groupVersion = this.bindings.version;
    }
    return state.group;
  }

  private cellOf(k: number): CellBinding {
    while (this.cells.length <= k) this.cells.push({ frame: this.root.createBuffer(Frame).$usage('uniform'), group: null, buffer: null, version: -1 });
    return this.cells[k];
  }

  private cellGroup(cell: CellBinding, buffer: SlotBuffer, segCount: number): LayoutGroup {
    if (!cell.group || cell.buffer !== buffer || cell.version !== this.bindings.version) {
      cell.group = this.bindings.layoutGroup(buffer, this.bindings.identityOf(segCount), cell.frame);
      cell.buffer = buffer;
      cell.version = this.bindings.version;
    }
    return cell.group;
  }

  /** Device-px boxes of this frame's layered groups (empty or off-canvas groups are dropped). */
  private collectGroups(frame: FrameContext) {
    this.activeCount = 0;
    for (let i = 0; i < this.states.length; i++) {
      const index = this.activeOf[i];
      index.length = 0;
      const geometry = this.states[i].geometry;
      if (!geometry?.groups.length) continue;
      const [ox, oy] = frame.offsetOf(this.slots[i]);
      for (let g = 0; g < geometry.groups.length; g++) {
        const group: LayerGroup = geometry.groups[g];
        const margin = group.halfWidth * frame.dpr + LAYER_MARGIN_PX;
        const x0 = Math.max(0, Math.floor((group.bounds.x0 + ox) * frame.scale + frame.translate[0] - margin));
        const y0 = Math.max(0, Math.floor((group.bounds.y0 + oy) * frame.scale + frame.translate[1] - margin));
        const x1 = Math.min(frame.width, Math.ceil((group.bounds.x1 + ox) * frame.scale + frame.translate[0] + margin));
        const y1 = Math.min(frame.height, Math.ceil((group.bounds.y1 + oy) * frame.scale + frame.translate[1] + margin));
        if (!(x1 > x0 && y1 > y0)) {
          index[g] = -1;
          continue;
        }
        index[g] = this.activeCount;
        const active = (this.active[this.activeCount++] ??= { slot: 0, group: 0, x0: 0, y0: 0, width: 0, height: 0, ax: 0, ay: 0 });
        active.slot = i;
        active.group = g;
        active.x0 = x0;
        active.y0 = y0;
        active.width = x1 - x0;
        active.height = y1 - y0;
      }
    }
  }

  /**
   * Shelf-packs the active groups into the atlas (tallest first), growing it when they do not fit and shrinking it
   * when they have needed less than half of it for a while.
   */
  private ensureAtlas(frame: FrameContext): Atlas {
    const count = this.activeCount;
    const order = this.packOrder;
    order.length = 0;
    let widest = 0;
    for (let k = 0; k < count; k++) {
      order.push(k);
      widest = Math.max(widest, this.active[k].width);
    }
    const rowWidth = Math.max(widest, Math.min(frame.width, ATLAS_ROW_WIDTH));
    order.sort(this.tallestFirst);
    let x = 0, y = 0, shelf = 0, used = 0;
    for (const k of order) {
      const g = this.active[k];
      if (x + g.width > rowWidth) {
        y += shelf;
        x = 0;
        shelf = 0;
      }
      g.ax = x;
      g.ay = y;
      x += g.width;
      shelf = Math.max(shelf, g.height);
      used = Math.max(used, x);
    }
    const width = atlasStep(used);
    const height = atlasStep(y + shelf);
    let atlas = this.atlas;
    this.smallFrames = atlas && 2 * width * height < atlas.width * atlas.height ? this.smallFrames + 1 : 0;
    const shrink = this.smallFrames > ATLAS_SHRINK_FRAMES;
    if (!atlas || atlas.width < width || atlas.height < height || atlas.canvasWidth !== frame.width || shrink) {
      this.releaseAtlas();
      this.smallFrames = 0;
      const keep = atlas?.canvasWidth === frame.width && !shrink ? atlas : null;
      const size: [number, number] = [Math.max(width, keep?.width ?? 0), Math.max(height, keep?.height ?? 0)];
      atlas = { width: size[0], height: size[1], canvasWidth: frame.width, msaa: createMsaaColor(this.root, size, frame.format), depth: createMsaaDepth(this.root, size), resolve: createResolveColor(this.root, size, frame.format) };
      this.atlas = atlas;
      this.composite = null;
      this.stats.atlasAllocations++;
    }
    return atlas;
  }

  private readonly tallestFirst = (a: number, b: number) => this.active[b].height - this.active[a].height;

  private ensureParams(atlas: Atlas) {
    if (!this.composite || this.params.dataType.elementCount < this.activeCount) {
      if (this.params.dataType.elementCount < this.activeCount) {
        this.params.destroy();
        this.params = this.root.createBuffer(d.arrayOf(GroupParams, 2 ** Math.ceil(Math.log2(this.activeCount)))).$usage('storage');
        this.paramsI32 = new Int32Array(this.params.arrayBuffer);
        this.paramsF32 = new Float32Array(this.params.arrayBuffer);
      }
      this.composite = this.root.createBindGroup(S.compositeLayout, { atlas: atlas.resolve, groups: this.params });
    }
  }

  private releaseAtlas() {
    if (!this.atlas) return;
    this.atlas.msaa.destroy();
    this.atlas.depth.destroy();
    this.atlas.resolve.destroy();
    this.atlas = null;
    this.composite = null;
  }
}
