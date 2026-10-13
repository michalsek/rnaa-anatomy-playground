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
import type { FrameBuffer, LayoutGroup, SharedBindings } from '../core/bindings.ts';
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
  private atlas: Atlas | null = null;
  private idleFrames = 0;
  private active: ActiveGroup[] = [];
  /** Position in `active` of [state][group], −1 when not composited this frame. */
  private readonly activeOf: number[][];
  private params: TgpuBuffer<d.WgslArray<typeof GroupParams>> & StorageFlag;
  private paramsHost: ArrayBuffer;
  private cells: CellBinding[] = [];
  private composite: CompositeGroup | null = null;

  constructor(
    private readonly root: TgpuRoot,
    private readonly bindings: SharedBindings,
    readonly slots: readonly number[],
  ) {
    slots.forEach((slot, i) => this.index.set(slot, i));
    this.states = slots.map(() => ({ geometry: null, buffer: null, capacity: 0, group: null, groupVersion: -1 }));
    this.activeOf = slots.map(() => []);
    this.params = root.createBuffer(d.arrayOf(GroupParams, 4)).$usage('storage');
    this.paramsHost = this.params.arrayBuffer;
  }

  /** Uploads a slot's new geometry (one buffer write); returns the bytes written. */
  update(slot: number, geometry: SlotGeometry): number {
    const state = this.stateOf(slot);
    if (geometry.byteLength > state.capacity) {
      state.buffer?.destroy();
      state.capacity = 2 ** Math.ceil(Math.log2(Math.max(MIN_SLOT_BUFFER_BYTES, geometry.byteLength)));
      state.buffer = this.root.createBuffer(d.arrayOf(Seg, Math.ceil(state.capacity / SEG_RECORD.bytes))).$usage('storage', 'vertex');
      state.group = null;
    }
    this.bindings.identityOf(geometry.segCount);
    if (geometry.byteLength) {
      const buffer = state.buffer!;
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
    return this.active.length;
  }

  prepare(frame: FrameContext, encoder: TgpuCommandEncoder) {
    this.collectGroups(frame);
    if (!this.active.length) {
      if (this.atlas && ++this.idleFrames > ATLAS_IDLE_FRAMES) this.releaseAtlas();
      return;
    }
    this.idleFrames = 0;
    const atlas = this.ensureAtlas(frame);
    this.ensureParams();
    const host = this.paramsHost;
    const i32 = new Int32Array(host);
    const f32 = new Float32Array(host);
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: atlas.msaa, resolveTarget: atlas.resolve, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'discard' }],
      depthStencilAttachment: { view: atlas.depth, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard', stencilClearValue: 0, stencilLoadOp: 'clear', stencilStoreOp: 'discard' },
    });
    this.active.forEach((g, k) => {
      const state = this.states[g.slot];
      const geometry = state.geometry!;
      const group = geometry.groups[g.group];
      const cell = this.cellOf(k);
      this.bindings.writeFrame({ scale: frame.scale, translate: frame.translate, width: atlas.width, height: atlas.height, dpr: frame.dpr, depthTotal: frame.depthTotal }, cell.frame, [g.x0 - g.ax, g.y0 - g.ay]);
      const o = k * GROUP_PARAMS_RECORD.words;
      i32.set([g.ax, g.ay], o + GROUP_PARAMS_RECORD.atlasOrigin);
      i32.set([g.x0, g.y0], o + GROUP_PARAMS_RECORD.canvasOrigin);
      i32.set([g.width, g.height], o + GROUP_PARAMS_RECORD.size);
      f32[o + GROUP_PARAMS_RECORD.depth] = depthOfSlot(frame.depthBase(this.slots[g.slot]) + group.frontLayer, frame.depthTotal);
      f32[o + GROUP_PARAMS_RECORD.alpha] = group.alpha;
      pass.setScissorRect(g.ax, g.ay, g.width, g.height);
      pass.setBindGroup(S.layout, this.cellGroup(cell, state.buffer!, geometry.segCount));
      pass.setVertexBuffer(S.fillLayout, state.buffer!.buffer, geometry.segCount * SEG_RECORD.bytes);
      if (group.opaque.count) {
        pass.setPipeline(frame.pipelines.fillOpaque);
        pass.draw(group.opaque.count, 1, group.opaque.first);
      }
      for (const draw of group.draws) if (draw.kind !== 'group') this.drawBlended(frame, pass, draw);
      this.stats.layerPixels += g.width * g.height;
    });
    pass.end();
    this.params.write(host, { endOffset: this.active.length * GROUP_PARAMS_RECORD.bytes });
    this.stats.groups += this.active.length;
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
      pass.setBindGroup(S.layout, this.groupOf(state));
      pass.setVertexBuffer(S.fillLayout, state.buffer.buffer, geometry.segCount * SEG_RECORD.bytes);
      pass.draw(geometry.opaque.count, 1, geometry.opaque.first);
    }
  }

  drawSlot(frame: FrameContext, pass: TgpuRenderPass, slot: number) {
    const i = this.index.get(slot)!;
    const state = this.states[i];
    const geometry = state.geometry;
    if (!geometry?.draws.length || !state.buffer) return;
    pass.setBindGroup(S.layout, this.groupOf(state));
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

  private groupOf(state: SlotState): LayoutGroup {
    if (!state.group || state.groupVersion !== this.bindings.version) {
      state.group = this.bindings.layoutGroup(state.buffer!, this.bindings.identityOf(state.geometry?.segCount ?? 1));
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
    this.active.length = 0;
    this.states.forEach((state, i) => {
      const index = this.activeOf[i];
      index.length = 0;
      const geometry = state.geometry;
      if (!geometry?.groups.length) return;
      const [ox, oy] = frame.offsetOf(this.slots[i]);
      geometry.groups.forEach((group: LayerGroup, g) => {
        const margin = group.halfWidth * frame.dpr + LAYER_MARGIN_PX;
        const x0 = Math.max(0, Math.floor((group.bounds.x0 + ox) * frame.scale + frame.translate[0] - margin));
        const y0 = Math.max(0, Math.floor((group.bounds.y0 + oy) * frame.scale + frame.translate[1] - margin));
        const x1 = Math.min(frame.width, Math.ceil((group.bounds.x1 + ox) * frame.scale + frame.translate[0] + margin));
        const y1 = Math.min(frame.height, Math.ceil((group.bounds.y1 + oy) * frame.scale + frame.translate[1] + margin));
        if (!(x1 > x0 && y1 > y0)) {
          index[g] = -1;
          return;
        }
        index[g] = this.active.length;
        this.active.push({ slot: i, group: g, x0, y0, width: x1 - x0, height: y1 - y0, ax: 0, ay: 0 });
      });
    });
  }

  /** Shelf-packs the active groups into the atlas (tallest first), growing it when they do not fit. */
  private ensureAtlas(frame: FrameContext): Atlas {
    const widest = Math.max(...this.active.map((g) => g.width));
    const rowWidth = Math.max(widest, Math.min(frame.width, ATLAS_ROW_WIDTH));
    const order = this.active.map((_, k) => k).sort((a, b) => this.active[b].height - this.active[a].height);
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
    const step = (n: number) => Math.ceil(n / ATLAS_STEP) * ATLAS_STEP;
    const width = step(used);
    const height = step(y + shelf);
    let atlas = this.atlas;
    if (!atlas || atlas.width < width || atlas.height < height || atlas.canvasWidth !== frame.width) {
      this.releaseAtlas();
      const keep = atlas?.canvasWidth === frame.width ? atlas : null;
      const size: [number, number] = [Math.max(width, keep?.width ?? 0), Math.max(height, keep?.height ?? 0)];
      atlas = { width: size[0], height: size[1], canvasWidth: frame.width, msaa: createMsaaColor(this.root, size, frame.format), depth: createMsaaDepth(this.root, size), resolve: createResolveColor(this.root, size, frame.format) };
      this.atlas = atlas;
      this.composite = null;
      this.stats.atlasAllocations++;
    }
    return atlas;
  }

  private ensureParams() {
    if (!this.composite || this.params.dataType.elementCount < this.active.length) {
      if (this.params.dataType.elementCount < this.active.length) {
        this.params.destroy();
        this.params = this.root.createBuffer(d.arrayOf(GroupParams, 2 ** Math.ceil(Math.log2(this.active.length)))).$usage('storage');
        this.paramsHost = this.params.arrayBuffer;
      }
      this.composite = this.root.createBindGroup(S.compositeLayout, { atlas: this.atlas!.resolve, groups: this.params });
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
