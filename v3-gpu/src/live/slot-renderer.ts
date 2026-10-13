// GPU side of the live slots: one grow-only buffer per slot ([segments | fill vertices], one writeBuffer per changed
// slot), its bind group, the per-slot draws at the slot's painter position, and group-opacity layers.
//
// Group opacity: each layered group is drawn with the regular pipelines into a bbox-sized offscreen 4× MSAA target
// (own Frame uniform shifted to the bbox, own cleared depth), resolved, and composited in the main pass at the
// group's painter position: a bbox triangle at the depth of the group's frontmost primitive, layer × alpha, source
// over. Later opaque fills still cover it per sample through the depth test.
import type { RenderFlag, SampledFlag, StorageFlag, TgpuBindGroup, TgpuBuffer, TgpuRenderPass, TgpuRenderPipeline, TgpuRoot, TgpuTexture, UniformFlag, VertexFlag } from 'typegpu';
import * as d from 'typegpu/data';
import { OVER, type Renderer } from '../renderer.ts';
import * as S from '../shaders.ts';
import { SEG_BYTES, type SlotDraw, type SlotGeometry } from './geometry.ts';

/** Where a slot sits in the painter's order (the DL `slots` entry: v2 kit.mjs page() placement). */
export interface SlotPlacement {
  name: string;
  /** Item index the slot is anchored to. */
  anchor: number;
  side: 'after' | 'before';
  /** Document position; orders several slots at one anchor. */
  seq: number;
}

type SlotBuffer = TgpuBuffer<d.WgslArray<typeof S.Seg>> & StorageFlag & VertexFlag;
type LayoutGroup = TgpuBindGroup<(typeof S.layout)['entries']>;
type CompositeGroup = TgpuBindGroup<(typeof S.compositeLayout)['entries']>;
type FrameBuffer = TgpuBuffer<typeof S.Frame> & UniformFlag;
type ColorTarget = TgpuTexture<{ size: [number, number]; format: GPUTextureFormat }> & RenderFlag & SampledFlag;
type MsaaTarget = TgpuTexture<{ size: [number, number]; format: GPUTextureFormat; sampleCount: 4 }> & RenderFlag;
type DepthTarget = TgpuTexture<{ size: [number, number]; format: 'depth32float'; sampleCount: 4 }> & RenderFlag;

const GROUP_PARAMS_BYTES = 16;
const FRAME_BYTES = 32;
/** Device px added around a group's bounds: AA ramp of fills plus the half-width of its widest stroke. */
const LAYER_MARGIN_PX = 2;
/** Layer targets grow in steps of this many device px, so a moving packet does not reallocate every frame. */
const LAYER_SIZE_STEP = 64;
const DEPTH_FORMAT = 'depth32float';
const SAMPLES = 4;

interface SlotState {
  geometry: SlotGeometry | null;
  buffer: SlotBuffer | null;
  /** Buffer capacity in bytes. */
  capacity: number;
  bindGroup: LayoutGroup | null;
  bindKey: string;
}

interface ActiveGroup {
  slot: number;
  group: number;
  x0: number;
  y0: number;
  width: number;
  height: number;
}

interface LayerTarget {
  resolve: ColorTarget;
  frame: FrameBuffer;
  layerBind: LayoutGroup | null;
  layerBindKey: string;
  composite: CompositeGroup;
}

export class LiveSlots {
  readonly stats = { uploads: 0, bytesUploaded: 0, groups: 0, layerPixels: 0 };
  private readonly root: TgpuRoot;
  private readonly states: SlotState[];
  private identity: TgpuBuffer<d.WgslArray<d.U32>> & StorageFlag;
  private identityLength = 1;
  private identityVersion = 0;
  private readonly composite: TgpuRenderPipeline;
  private groupParams: TgpuBuffer<d.WgslArray<typeof S.GroupParams>> & StorageFlag;
  private groupCapacity = 4;
  private groupBytes = new ArrayBuffer(4 * GROUP_PARAMS_BYTES);
  private readonly frameWords = new Float32Array(FRAME_BYTES / 4);
  private layerSize: [number, number] = [0, 0];
  private layerMsaa: MsaaTarget | null = null;
  private layerDepth: DepthTarget | null = null;
  private layers: LayerTarget[] = [];
  /** Groups composited this frame, in encode order; `groupIndex[slot][group]` is their position. */
  private active: ActiveGroup[] = [];
  private groupIndex: number[][] = [];

  constructor(
    private readonly renderer: Renderer,
    private readonly placements: SlotPlacement[],
  ) {
    const slotCount = placements.length;
    this.root = renderer.root;
    this.states = Array.from({ length: slotCount }, () => ({ geometry: null, buffer: null, capacity: 0, bindGroup: null, bindKey: '' }));
    this.groupIndex = Array.from({ length: slotCount }, () => []);
    this.identity = this.root.createBuffer(d.arrayOf(d.u32, 1)).$usage('storage');
    this.groupParams = this.root.createBuffer(d.arrayOf(S.GroupParams, this.groupCapacity)).$usage('storage');
    this.composite = this.root.createRenderPipeline({
      vertex: S.compositeVert,
      fragment: S.compositeFrag,
      targets: { format: renderer.format, blend: OVER },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'less' },
      multisample: { count: SAMPLES },
    });
  }

  /** Layered groups composited in the last frame. */
  get activeGroups() {
    return this.active.length;
  }

  pipelines(): TgpuRenderPipeline[] {
    return [this.composite];
  }

  /** Uploads a slot's new geometry (one writeBuffer) and publishes its depth-slot count; returns bytes written. */
  update(index: number, geometry: SlotGeometry): number {
    const state = this.states[index];
    if (geometry.byteLength > state.capacity) {
      state.buffer?.destroy();
      state.capacity = Math.max(4096, 2 ** Math.ceil(Math.log2(geometry.byteLength)));
      state.buffer = this.root.createBuffer(d.arrayOf(S.Seg, Math.ceil(state.capacity / SEG_BYTES))).$usage('storage', 'vertex');
      state.bindGroup = null;
    }
    if (geometry.segCount > this.identityLength) this.growIdentity(geometry.segCount);
    if (geometry.byteLength && state.buffer) this.root.device.queue.writeBuffer(state.buffer.buffer, 0, geometry.bytes, 0, geometry.byteLength);
    state.geometry = geometry;
    this.renderer.slotLayers[index] = geometry.layers;
    this.stats.uploads++;
    this.stats.bytesUploaded += geometry.byteLength;
    return geometry.byteLength;
  }

  /** Phase A: every slot's opaque fills (depth write; their depth is their painter rank). */
  drawOpaque(pass: TgpuRenderPass) {
    const pipes = this.renderer.pipes;
    pass.setPipeline(pipes.fillOpaque);
    for (let i = 0; i < this.states.length; i++) {
      const state = this.states[i];
      const geometry = state.geometry;
      if (!geometry?.opaque.count || !state.buffer) continue;
      pass.setBindGroup(S.layout, this.bindGroupOf(state));
      pass.setVertexBuffer(S.fillLayout, state.buffer.buffer);
      pass.draw(geometry.opaque.count, 1, geometry.segCount * (SEG_BYTES / 16) + geometry.opaque.first);
    }
  }

  /** Phase B at the slot's painter position: strokes, dots, translucent fills and group composites. */
  drawSlot(pass: TgpuRenderPass, index: number) {
    const state = this.states[index];
    const geometry = state.geometry;
    if (!geometry?.draws.length || !state.buffer) return;
    pass.setBindGroup(S.layout, this.bindGroupOf(state));
    pass.setVertexBuffer(S.fillLayout, state.buffer.buffer);
    for (const draw of geometry.draws) {
      if (draw.kind === 'group') this.drawComposite(pass, index, draw.group);
      else this.drawBlended(pass, geometry, draw);
    }
  }

  /** Renders every group of this frame into its layer; call before the main pass is begun. */
  encodeLayers(encoder: ReturnType<TgpuRoot['~unstable']['createCommandEncoder']>) {
    this.collectGroups();
    if (!this.active.length) return;
    this.ensureLayerTargets();
    const r = this.renderer;
    const [sx, sy, tx, ty] = r.viewTransform();
    const params = new DataView(this.groupBytes);
    const itemCount = r.scene.items.length;
    this.active.forEach((g, k) => {
      const state = this.states[g.slot];
      const geometry = state.geometry!;
      const group = geometry.groups[g.group];
      const target = this.layers[k];
      const words = this.frameWords;
      words.set([sx, sy, tx - g.x0, ty - g.y0, this.layerSize[0], this.layerSize[1], r.dpr, r.total + 2]);
      this.root.device.queue.writeBuffer(target.frame.buffer, 0, words);
      const seq = r.itemBases[itemCount + g.slot] + group.frontLayer;
      params.setInt32(k * GROUP_PARAMS_BYTES, g.x0, true);
      params.setInt32(k * GROUP_PARAMS_BYTES + 4, g.y0, true);
      params.setFloat32(k * GROUP_PARAMS_BYTES + 8, 1 - (seq + 1) / (r.total + 2), true);
      params.setFloat32(k * GROUP_PARAMS_BYTES + 12, group.alpha, true);
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: this.layerMsaa!, resolveTarget: target.resolve, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'discard' }],
        depthStencilAttachment: { view: this.layerDepth!, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      });
      pass.setScissorRect(0, 0, g.width, g.height);
      pass.setBindGroup(S.layout, this.layerBindGroupOf(target, state));
      pass.setVertexBuffer(S.fillLayout, state.buffer!.buffer);
      if (group.opaque.count) {
        pass.setPipeline(r.pipes.fillOpaque);
        pass.draw(group.opaque.count, 1, geometry.segCount * (SEG_BYTES / 16) + group.opaque.first);
      }
      for (const draw of group.draws) if (draw.kind !== 'group') this.drawBlended(pass, geometry, draw);
      pass.end();
      this.stats.layerPixels += g.width * g.height;
    });
    this.root.device.queue.writeBuffer(this.groupParams.buffer, 0, this.groupBytes, 0, this.active.length * GROUP_PARAMS_BYTES);
    this.stats.groups += this.active.length;
  }

  destroy() {
    for (const state of this.states) state.buffer?.destroy();
    this.identity.destroy();
    this.groupParams.destroy();
    this.destroyLayerTargets();
  }

  private drawBlended(pass: TgpuRenderPass, geometry: SlotGeometry, draw: Exclude<SlotDraw, { kind: 'group' }>) {
    const pipes = this.renderer.pipes;
    if (draw.kind === 'segs') {
      pass.setPipeline(draw.blend === 'multiply' ? pipes.strokeMultiply : draw.blend === 'screen' ? pipes.strokeScreen : pipes.stroke);
      pass.draw(6, draw.count, 0, draw.first);
    } else {
      pass.setPipeline(draw.blend === 'multiply' ? pipes.fillMultiply : draw.blend === 'screen' ? pipes.fillScreen : pipes.fillOver);
      pass.draw(draw.count, 1, geometry.segCount * (SEG_BYTES / 16) + draw.first);
    }
  }

  private drawComposite(pass: TgpuRenderPass, slot: number, group: number) {
    const k = this.groupIndex[slot][group];
    if (k === undefined || k < 0) return;
    const g = this.active[k];
    pass.setPipeline(this.composite);
    pass.setBindGroup(S.compositeLayout, this.layers[k].composite);
    pass.setScissorRect(g.x0, g.y0, g.width, g.height);
    pass.draw(3, 1, 0, k);
    pass.setScissorRect(0, 0, this.renderer.width, this.renderer.height);
  }

  /** Device-pixel boxes of this frame's layered groups (empty or off-canvas groups are dropped). */
  private collectGroups() {
    const r = this.renderer;
    const [sx, sy, tx, ty] = r.viewTransform();
    this.active.length = 0;
    this.states.forEach((state, slot) => {
      const index = this.groupIndex[slot];
      index.length = 0;
      const geometry = state.geometry;
      if (!geometry) return;
      for (const draw of geometry.draws) {
        if (draw.kind !== 'group') continue;
        const group = geometry.groups[draw.group];
        const anchor = r.scene.items[this.placements[slot].anchor];
        const [bx0, by0, bx1, by1] = group.bounds;
        const dx = anchor.move[0] * r.share * sx;
        const dy = anchor.move[1] * r.share * sy;
        const margin = (group.maxWidth * r.dpr) / 2 + LAYER_MARGIN_PX;
        const x0 = Math.max(0, Math.floor(bx0 * sx + tx + dx - margin));
        const y0 = Math.max(0, Math.floor(by0 * sy + ty + dy - margin));
        const x1 = Math.min(r.width, Math.ceil(bx1 * sx + tx + dx + margin));
        const y1 = Math.min(r.height, Math.ceil(by1 * sy + ty + dy + margin));
        if (!(x1 > x0 && y1 > y0)) {
          index[draw.group] = -1;
          continue;
        }
        index[draw.group] = this.active.length;
        this.active.push({ slot, group: draw.group, x0, y0, width: x1 - x0, height: y1 - y0 });
      }
    });
  }

  private ensureLayerTargets() {
    const step = (n: number) => Math.ceil(n / LAYER_SIZE_STEP) * LAYER_SIZE_STEP;
    const width = step(Math.max(...this.active.map((g) => g.width)));
    const height = step(Math.max(...this.active.map((g) => g.height)));
    if (width > this.layerSize[0] || height > this.layerSize[1]) {
      this.destroyLayerTargets();
      this.layerSize = [Math.max(width, this.layerSize[0]), Math.max(height, this.layerSize[1])];
      const size = this.layerSize;
      this.layerMsaa = this.root.createTexture({ size, format: this.renderer.format, sampleCount: SAMPLES }).$usage('render') as MsaaTarget;
      this.layerDepth = this.root.createTexture({ size, format: DEPTH_FORMAT, sampleCount: SAMPLES }).$usage('render') as DepthTarget;
    }
    if (this.active.length > this.groupCapacity) {
      this.groupParams.destroy();
      this.groupCapacity = 2 ** Math.ceil(Math.log2(this.active.length));
      this.groupParams = this.root.createBuffer(d.arrayOf(S.GroupParams, this.groupCapacity)).$usage('storage');
      this.groupBytes = new ArrayBuffer(this.groupCapacity * GROUP_PARAMS_BYTES);
      // composite bind groups reference the replaced params buffer
      this.destroyLayers();
    }
    while (this.layers.length < this.active.length) {
      const resolve = this.root.createTexture({ size: this.layerSize, format: this.renderer.format }).$usage('render', 'sampled') as ColorTarget;
      const frame = this.root.createBuffer(S.Frame).$usage('uniform');
      const composite = this.root.createBindGroup(S.compositeLayout, { layer: resolve, groups: this.groupParams });
      this.layers.push({ resolve, frame, layerBind: null, layerBindKey: '', composite });
    }
  }

  private destroyLayers() {
    for (const target of this.layers) {
      target.resolve.destroy();
      target.frame.destroy();
    }
    this.layers = [];
  }

  private destroyLayerTargets() {
    this.layerMsaa?.destroy();
    this.layerDepth?.destroy();
    this.layerMsaa = null;
    this.layerDepth = null;
    this.destroyLayers();
  }

  private growIdentity(length: number) {
    this.identity.destroy();
    this.identityLength = 2 ** Math.ceil(Math.log2(length));
    this.identity = this.root.createBuffer(d.arrayOf(d.u32, this.identityLength)).$usage('storage');
    const indices = new Uint32Array(this.identityLength);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
    this.root.device.queue.writeBuffer(this.identity.buffer, 0, indices);
    this.identityVersion++;
  }

  private bindGroupOf(state: SlotState): LayoutGroup {
    const key = `${this.renderer.resourceVersion}:${this.identityVersion}`;
    if (!state.bindGroup || state.bindKey !== key) {
      state.bindGroup = this.layoutGroup(this.renderer.frameBuffer, state.buffer!);
      state.bindKey = key;
    }
    return state.bindGroup;
  }

  private layerBindGroupOf(target: LayerTarget, state: SlotState): LayoutGroup {
    const key = `${this.renderer.resourceVersion}:${this.identityVersion}:${this.states.indexOf(state)}:${state.capacity}`;
    if (!target.layerBind || target.layerBindKey !== key) {
      target.layerBind = this.layoutGroup(target.frame, state.buffer!);
      target.layerBindKey = key;
    }
    return target.layerBind;
  }

  private layoutGroup(frame: FrameBuffer, segs: SlotBuffer): LayoutGroup {
    const r = this.renderer;
    return this.root.createBindGroup(S.layout, { frame, items: r.itemBuffer, paints: r.paintBuffer, grads: r.gradBuffer, stops: r.stopBuffer, segs, order: this.identity });
  }
}
