// Static-frame renderer: one 4× MSAA render pass — opaque fills with depth write, then the blended stream (strokes,
// dots, translucent fills, halo) in painter's order, depth-tested against the fills. Depth is the primitive's rank in
// the painter's order (item rank prefix-sum + layer), never a raw key.
import type { TgpuRoot } from 'typegpu';
import * as d from 'typegpu/data';
import type { BlendMode, ResolvedPaint } from './palette.ts';
import { orderOf, type GpuScene } from './scene.ts';
import * as S from './shaders.ts';
import type { LiveSlots, SlotPlacement } from './live/slot-renderer.ts';

const SAMPLES = 4;
const DEPTH_FORMAT = 'depth32float';

export const OVER: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};
export const MULTIPLY: GPUBlendState = {
  color: { srcFactor: 'dst', dstFactor: 'zero', operation: 'add' },
  alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
};
export const SCREEN: GPUBlendState = {
  color: { srcFactor: 'one-minus-dst', dstFactor: 'one', operation: 'add' },
  alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
};

type Entry =
  | { layer: number; kind: 'segs'; first: number; count: number }
  | { layer: number; kind: 'fill'; blend: BlendMode; first: number; count: number }
  | { layer: number; kind: 'halo'; halo: number };

type Draw =
  | { kind: 'segs'; first: number; count: number }
  | { kind: 'slot'; slot: number }
  | { kind: 'fill'; blend: BlendMode; first: number; count: number }
  | { kind: 'halo'; halo: number };

interface Halo {
  item: number;
  layer: number;
  paint: number;
  first: number; // vertex range in the halo vertex buffer
  count: number;
}

export interface FrameStats {
  frames: number;
  lastEncodeMs: number;
  avgEncodeMs: number;
  lastGpuMs: number | null;
  draws: number;
  segments: number;
  opaqueVertices: number;
  blendedVertices: number;
  reorders: number;
}

function assertSize(name: string, schema: d.AnyWgslData, bytes: number) {
  const size = d.sizeOf(schema);
  if (size !== bytes) throw new Error(`${name}: TypeGPU size ${size} ≠ packed ${bytes}`);
}

export class Renderer {
  private readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
  private readonly context: GPUCanvasContext;
  paints: ResolvedPaint[] = [];
  private background: [number, number, number, number] = [1, 1, 1, 1];

  // geometry (built once per palette classification)
  private segCount = 0;
  private opaqueCount = 0;
  private entries: Entry[][] = [];
  private halos: Halo[] = [];
  private fillVB: any;
  private blendVB: any;
  private haloVB: any;
  private segBuffer: any;
  private orderBuffer: any;
  itemBuffer: any;
  paintBuffer: any;
  gradBuffer: any;
  stopBuffer: any;
  frameBuffer: any;
  private bindGroup: any;
  private gradIndexOf: number[] = [];

  // pipelines
  pipes: Record<string, any> = {};

  // size-dependent
  width = 0;
  height = 0;
  dpr = 1;
  private msaa: any;
  private depth: any;
  private haloTex: { a: any; b: any; bgH: any; bgV: any; bgComposite: any; params: any; blurH: any; blurV: any }[] = [];
  private haloDirty = true;
  private sampler: any;

  // frame state
  share = 0;
  private lastOrder: Uint32Array | null = null;
  private orderShare = 0;
  /** Static items and slot pseudo-items in painter order. */
  private frameOrder = new Uint32Array(0);
  private itemWords = { f32: new Float32Array(0), u32: new Uint32Array(0) };
  private draws: Draw[] = [];
  itemBases = new Uint32Array(0);
  total = 0;
  stats: FrameStats = { frames: 0, lastEncodeMs: 0, avgEncodeMs: 0, lastGpuMs: null, draws: 0, segments: 0, opaqueVertices: 0, blendedVertices: 0, reorders: 0 };

  private query: { set: any; busy: boolean } | null = null;

  /** Live slots (M3): pseudo-items `scene.items.length + i`, spliced into the frame order next to their anchor. */
  live: LiveSlots | null = null;
  private readonly slots: SlotPlacement[];
  /** Depth slots of each live slot this frame (its current primitive count). */
  readonly slotLayers: Uint32Array;
  /** Bumped whenever a buffer shared with the live slots' bind groups is replaced. */
  resourceVersion = 0;

  constructor(
    readonly root: TgpuRoot,
    private readonly canvas: HTMLCanvasElement,
    readonly scene: GpuScene,
    slots: SlotPlacement[] = [],
  ) {
    this.slots = slots;
    this.slotLayers = new Uint32Array(slots.length);
    this.device = root.device;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context = root.configureContext({ canvas, alphaMode: 'opaque' });
    assertSize('Seg', S.Seg, 48);
    assertSize('Item', S.Item, 16);
    assertSize('Paint', S.Paint, 32);
    assertSize('Gradient', S.Gradient, 32);
    assertSize('Stop', S.Stop, 32);
    assertSize('FillVertex', S.FillVertex, 16);
    this.createPipelines();
    this.sampler = root.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.frameBuffer = root.createBuffer(S.Frame).$usage('uniform');
    this.itemBuffer = root.createBuffer(d.arrayOf(S.Item, Math.max(1, scene.items.length + slots.length))).$usage('storage');
    if (root.enabledFeatures.has('timestamp-query')) {
      this.query = { set: root.createQuerySet('timestamp', 2), busy: false };
    }
  }

  private createPipelines() {
    const root = this.root;
    const depthWrite: GPUDepthStencilState = { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' };
    const depthTest: GPUDepthStencilState = { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'less' };
    const ms = { count: SAMPLES };
    const fillAttribs = { pos: S.fillLayout.attrib.pos, ids: S.fillLayout.attrib.ids };
    this.pipes.fillOpaque = root.createRenderPipeline({
      vertex: S.fillVert, fragment: S.fillFragOpaque, attribs: fillAttribs,
      targets: { format: this.format }, depthStencil: depthWrite, multisample: ms,
    });
    const blended = (fragment: any, blend: GPUBlendState) =>
      root.createRenderPipeline({
        vertex: S.fillVert, fragment, attribs: fillAttribs,
        targets: { format: this.format, blend }, depthStencil: depthTest, multisample: ms,
      });
    this.pipes.fillOver = blended(S.fillFragOver, OVER);
    this.pipes.fillMultiply = blended(S.fillFragMultiply, MULTIPLY);
    this.pipes.fillScreen = blended(S.fillFragScreen, SCREEN);
    const stroke = (fragment: typeof S.strokeFrag, blend: GPUBlendState) =>
      root.createRenderPipeline({
        vertex: S.strokeVert, fragment,
        targets: { format: this.format, blend }, depthStencil: depthTest, multisample: ms,
      });
    this.pipes.stroke = stroke(S.strokeFrag, OVER);
    this.pipes.strokeMultiply = stroke(S.strokeFragMultiply, MULTIPLY);
    this.pipes.strokeScreen = stroke(S.strokeFrag, SCREEN);
    this.pipes.haloMask = root.createRenderPipeline({
      vertex: S.haloMaskVert, fragment: S.haloMaskFrag, attribs: fillAttribs,
      targets: { format: 'r8unorm' },
    });
    this.pipes.blur = root.createRenderPipeline({
      vertex: S.fullscreenVert, fragment: S.blurFrag, targets: { format: 'r8unorm' },
    });
    this.pipes.halo = root.createRenderPipeline({
      vertex: S.haloVert, fragment: S.haloFrag,
      targets: { format: this.format, blend: OVER }, depthStencil: depthTest, multisample: ms,
    });
  }

  /** (Re)build every buffer that depends on the palette's classification (opaque / blended / invisible). */
  setPalette(paints: ResolvedPaint[], background: [number, number, number, number]) {
    const classify = (ps: ResolvedPaint[]) => ps.map((p) => `${p.visible}|${p.rgba[3] >= 0.999}|${p.blend}`).join(',');
    const rebuild = !this.paints.length || classify(paints) !== classify(this.paints);
    this.paints = paints;
    this.background = background;
    if (rebuild) this.buildGeometry();
    this.uploadPaints();
    this.lastOrder = null;
    this.haloDirty = true;
  }

  private uploadPaints() {
    const { root, scene, paints } = this;
    const gradIndexOf: number[] = [];
    const grads: number[] = [];
    const stops: number[] = [];
    scene.paints.forEach((desc, i) => {
      if (desc.kind !== 'linear') return;
      const r = paints[i];
      gradIndexOf[i] = grads.length / 8;
      const first = stops.length / 8;
      for (const s of r.stops ?? []) stops.push(...s.rgba, s.offset, 0, 0, 0);
      grads.push(desc.x1, desc.y1, desc.x2, desc.y2, first, r.stops?.length ?? 0, 0, 0);
    });
    this.gradIndexOf = gradIndexOf;
    const paintBytes = new ArrayBuffer(Math.max(1, paints.length) * 32);
    const pf = new Float32Array(paintBytes);
    const pu = new Uint32Array(paintBytes);
    paints.forEach((p, i) => {
      pf.set(p.rgba, i * 8);
      pf[i * 8 + 4] = p.width;
      const linear = scene.paints[i].kind === 'linear';
      pu[i * 8 + 5] = linear ? 1 : 0;
      pu[i * 8 + 6] = linear ? gradIndexOf[i] : 0;
    });
    const gradBytes = new ArrayBuffer(Math.max(1, grads.length / 8) * 32);
    const gf = new Float32Array(gradBytes);
    const gu = new Uint32Array(gradBytes);
    for (let g = 0; g < grads.length / 8; g++) {
      gf.set(grads.slice(g * 8, g * 8 + 4), g * 8);
      gu[g * 8 + 4] = grads[g * 8 + 4];
      gu[g * 8 + 5] = grads[g * 8 + 5];
    }
    const stopBytes = new Float32Array(Math.max(8, stops.length));
    stopBytes.set(stops);
    // Capacity grows by half again so live paints discovered one by one do not reallocate every time; the shaders
    // index by id, so spare elements are never read.
    const ensure = (current: any, count: number, schema: any): any => {
      if (current && current.dataType.elementCount >= count) return current;
      current?.destroy();
      const capacity = current ? Math.ceil(count * 1.5) : count;
      return (root.createBuffer as any)((d.arrayOf as any)(schema, capacity)).$usage("storage");
    };
    const prev = [this.paintBuffer, this.gradBuffer, this.stopBuffer];
    this.paintBuffer = ensure(this.paintBuffer, Math.max(1, paints.length), S.Paint);
    this.gradBuffer = ensure(this.gradBuffer, Math.max(1, grads.length / 8), S.Gradient);
    this.stopBuffer = ensure(this.stopBuffer, Math.max(1, stops.length / 8), S.Stop);
    this.root.device.queue.writeBuffer(this.paintBuffer.buffer, 0, paintBytes);
    this.root.device.queue.writeBuffer(this.gradBuffer.buffer, 0, gradBytes);
    this.root.device.queue.writeBuffer(this.stopBuffer.buffer, 0, stopBytes.buffer);
    if (prev.some((b, i) => b !== [this.paintBuffer, this.gradBuffer, this.stopBuffer][i])) {
      this.bindGroup = null;
      this.resourceVersion++;
    }
  }

  /** Appends paints discovered at runtime (live slots); `scene.paints` must already hold their descriptors. */
  appendPaints(resolved: ResolvedPaint[]) {
    this.paints.push(...resolved);
    this.uploadPaints();
  }

  /** Compiles every pipeline ahead of the first frame (TypeGPU compiles lazily on first draw otherwise). */
  async compilePipelines() {
    await Promise.all([...Object.values(this.pipes), ...(this.live?.pipelines() ?? [])].map((pipeline) => pipeline.initAsync()));
  }

  private buildGeometry() {
    const { root, scene, paints } = this;
    const opaque: number[] = [];
    const blend: number[] = [];
    const haloV: number[] = [];
    const entries: Entry[][] = scene.items.map(() => []);
    const halos: Halo[] = [];
    const pushFill = (out: number[], item: number, paint: number, layer: number, first: number, count: number) => {
      const u = new Uint32Array(2);
      u[0] = item | (paint << 16);
      u[1] = layer;
      const asF = new Float32Array(u.buffer);
      for (let v = first; v < first + count; v++) out.push(scene.tris[v * 2], scene.tris[v * 2 + 1], asF[0], asF[1]);
    };
    for (const f of scene.fills) {
      const p = paints[f.paint];
      if (!p.visible) continue;
      if (f.special === 'halo') {
        const first = haloV.length / 4;
        pushFill(haloV, f.item, f.paint, f.layer, f.first, f.count);
        halos.push({ item: f.item, layer: f.layer, paint: f.paint, first, count: f.count });
        entries[f.item].push({ layer: f.layer, kind: 'halo', halo: halos.length - 1 });
      } else if (p.blend === 'normal' && p.rgba[3] >= 0.999) {
        pushFill(opaque, f.item, f.paint, f.layer, f.first, f.count);
      } else {
        const first = blend.length / 4;
        pushFill(blend, f.item, f.paint, f.layer, f.first, f.count);
        entries[f.item].push({ layer: f.layer, kind: 'fill', blend: p.blend, first, count: f.count });
      }
    }
    // Segments: one per polyline edge (closed polylines wrap), dots as zero-length capsules. Grouped per item in
    // layer order, so each item's stroke run is contiguous and the per-frame order buffer is a concatenation.
    type Prim = { layer: number; segs: number[] };
    const prims: Prim[][] = scene.items.map(() => []);
    const pts = scene.points;
    for (const s of scene.strokes) {
      const p = paints[s.paint];
      if (!p.visible) continue;
      const segs: number[] = [];
      const butt = (s.cap ?? p.cap) === 'butt';
      for (const [start, count, closed] of s.polys) {
        const isClosed = closed && count >= 3;
        const n = count < 2 ? 1 : isClosed ? count : count - 1;
        // A zero-length butt-capped subpath paints nothing in SVG.
        if (butt && !isClosed && n === 1 && pts[start * 2] === pts[(start + count - 1) * 2] && pts[start * 2 + 1] === pts[(start + count - 1) * 2 + 1]) continue;
        const polyStart = segs.length / 12;
        for (let i = 0; i < n; i++) {
          const a = start + i;
          const b = count < 2 ? start : start + ((i + 1) % count);
          let flags = isClosed ? S.SEG_CLOSED : 0;
          if (!isClosed && i === 0) flags |= butt ? S.SEG_BUTT_START : S.SEG_ROUND_START;
          if (!isClosed && i === n - 1) flags |= butt ? S.SEG_BUTT_END : S.SEG_ROUND_END;
          segs.push(pts[a * 2], pts[a * 2 + 1], pts[b * 2], pts[b * 2 + 1], s.width ?? 0, s.item, s.paint, s.layer, s.alpha ?? 1, flags, polyStart, polyStart + n);
        }
      }
      prims[s.item].push({ layer: s.layer, segs });
    }
    for (const dot of scene.dots) {
      if (!paints[dot.paint].visible) continue;
      prims[dot.item].push({ layer: dot.layer, segs: [dot.x, dot.y, dot.x, dot.y, dot.r, dot.item, dot.paint, dot.layer, dot.alpha, S.SEG_DOT, 0, 1] });
    }
    const segData: number[] = [];
    prims.forEach((list, item) => {
      list.sort((a, b) => a.layer - b.layer);
      for (const prim of list) {
        const base = segData.length / 12;
        const count = prim.segs.length / 12;
        // polyStart/polyEnd are relative to the element; make them absolute.
        for (let i = 0; i < count; i++) {
          const row = prim.segs.slice(i * 12, i * 12 + 12);
          row[10] += base;
          row[11] += base;
          segData.push(...row);
        }
        entries[item].push({ layer: prim.layer, kind: 'segs', first: base, count });
      }
      entries[item].sort((a, b) => a.layer - b.layer);
    });
    const segBytes = new ArrayBuffer(Math.max(1, segData.length / 12) * 48);
    const sf = new Float32Array(segBytes);
    const su = new Uint32Array(segBytes);
    for (let i = 0; i < segData.length / 12; i++) {
      const r = segData.slice(i * 12, i * 12 + 12);
      sf.set(r.slice(0, 5), i * 12);
      su[i * 12 + 5] = r[5];
      su[i * 12 + 6] = r[6];
      su[i * 12 + 7] = r[7];
      sf[i * 12 + 8] = r[8];
      su[i * 12 + 9] = r[9];
      su[i * 12 + 10] = r[10];
      su[i * 12 + 11] = r[11];
    }
    for (const b of [this.fillVB, this.blendVB, this.haloVB, this.segBuffer, this.orderBuffer]) b?.destroy();
    const vb = (data: number[]) => {
      const n = Math.max(1, data.length / 4);
      const buf = root.createBuffer(d.arrayOf(S.FillVertex, n)).$usage('vertex');
      const f = new Float32Array(n * 4);
      f.set(data);
      buf.write(f.buffer);
      return buf;
    };
    this.fillVB = vb(opaque);
    this.blendVB = vb(blend);
    this.haloVB = vb(haloV);
    this.opaqueCount = opaque.length / 4;
    this.segCount = segData.length / 12;
    this.segBuffer = root.createBuffer(d.arrayOf(S.Seg, Math.max(1, this.segCount))).$usage('storage');
    this.segBuffer.write(segBytes);
    this.orderBuffer = root.createBuffer(d.arrayOf(d.u32, Math.max(1, this.segCount))).$usage('storage');
    this.entries = entries;
    this.halos = halos;
    this.bindGroup = null;
    this.haloTex = [];
    this.stats.segments = this.segCount;
    this.stats.opaqueVertices = this.opaqueCount;
    this.stats.blendedVertices = blend.length / 4;
  }

  resize(width: number, height: number, dpr: number) {
    if (width === this.width && height === this.height && dpr === this.dpr && this.msaa) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = width;
    this.canvas.height = height;
    this.msaa?.destroy();
    this.depth?.destroy();
    this.msaa = this.root.createTexture({ size: [width, height], format: this.format, sampleCount: SAMPLES }).$usage('render');
    this.depth = this.root.createTexture({ size: [width, height], format: DEPTH_FORMAT, sampleCount: SAMPLES }).$usage('render');
    for (const h of this.haloTex) { h.a.destroy(); h.b.destroy(); }
    this.haloTex = [];
    this.haloDirty = true;
  }

  private ensureBindGroup() {
    if (this.bindGroup) return;
    this.bindGroup = this.root.createBindGroup(S.layout, {
      frame: this.frameBuffer,
      items: this.itemBuffer,
      paints: this.paintBuffer,
      grads: this.gradBuffer,
      stops: this.stopBuffer,
      segs: this.segBuffer,
      order: this.orderBuffer,
    });
  }

  /**
   * CPU per frame: rank items (re-sorted only when `share` changes), splice the live slots in next to their anchors,
   * prefix-sum depth slots (static layers + each slot's current primitive count) into the item buffer. The stroke
   * order buffer and the draw list are rebuilt only when the static order changes.
   */
  private updateOrder() {
    const { scene } = this;
    const itemCount = scene.items.length;
    const reordered = !this.lastOrder || this.share !== this.orderShare;
    if (reordered) {
      const order = orderOf(scene.items, this.share);
      const same = this.lastOrder && this.lastOrder.length === order.length && this.lastOrder.every((v, i) => v === order[i]);
      this.orderShare = this.share;
      if (!same) {
        this.lastOrder = order;
        this.rebuildDrawList(order);
      }
    }
    const frameOrder = this.frameOrder;
    const bases = this.itemBases;
    let base = 0;
    for (let k = 0; k < frameOrder.length; k++) {
      const i = frameOrder[k];
      bases[i] = base;
      base += i < itemCount ? scene.items[i].layers : this.slotLayers[i - itemCount];
    }
    const f = this.itemWords.f32;
    const u = this.itemWords.u32;
    for (let i = 0; i < bases.length; i++) {
      const it = scene.items[i < itemCount ? i : this.slots[i - itemCount].anchor];
      f[i * 4] = it.move[0] * this.share;
      f[i * 4 + 1] = it.move[1] * this.share;
      u[i * 4 + 2] = bases[i];
    }
    this.root.device.queue.writeBuffer(this.itemBuffer.buffer, 0, f.buffer, 0, bases.length * 16);
    this.total = base;
  }

  private rebuildDrawList(order: Uint32Array) {
    const itemCount = this.scene.items.length;
    this.stats.reorders++;
    const frameOrder: number[] = [];
    const slotsAt = (anchor: number, side: SlotPlacement['side']) =>
      this.slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => slot.anchor === anchor && slot.side === side).sort((a, b) => a.slot.seq - b.slot.seq);
    const indices = new Uint32Array(Math.max(1, this.segCount));
    let n = 0;
    const draws: Draw[] = [];
    const pushSlot = (index: number) => {
      frameOrder.push(itemCount + index);
      draws.push({ kind: 'slot', slot: index });
    };
    for (const item of order) {
      for (const { index } of slotsAt(item, 'before')) pushSlot(index);
      frameOrder.push(item);
      for (const e of this.entries[item]) {
        if (e.kind === 'segs') {
          const last = draws[draws.length - 1];
          if (last?.kind === 'segs') last.count += e.count;
          else draws.push({ kind: 'segs', first: n, count: e.count });
          for (let s = 0; s < e.count; s++) indices[n++] = e.first + s;
        } else if (e.kind === 'fill') {
          draws.push({ kind: 'fill', blend: e.blend, first: e.first, count: e.count });
        } else {
          draws.push({ kind: 'halo', halo: e.halo });
        }
      }
      for (const { index } of slotsAt(item, 'after')) pushSlot(index);
    }
    this.orderBuffer.write(indices.buffer);
    this.draws = draws;
    this.frameOrder = Uint32Array.from(frameOrder);
    if (this.itemBases.length !== frameOrder.length) {
      this.itemBases = new Uint32Array(frameOrder.length);
      const words = new ArrayBuffer(frameOrder.length * 16);
      this.itemWords = { f32: new Float32Array(words), u32: new Uint32Array(words) };
    }
  }

  viewTransform() {
    const [vx, vy, vw] = this.scene.viewBox;
    // SVG maps the viewBox onto the CSS box (width:100%, height from the aspect ratio); the canvas has the same box,
    // so the scale comes from the width in device px; the height only differs by device-pixel snapping.
    const s = this.width / vw;
    return [s, s, -vx * s, -vy * s];
  }

  private ensureHalos(encoder: any) {
    if (!this.haloDirty || !this.halos.length) return;
    this.haloDirty = false;
    const w = Math.max(1, Math.ceil(this.width / 2));
    const h = Math.max(1, Math.ceil(this.height / 2));
    const tex = () => this.root.createTexture({ size: [w, h], format: 'r8unorm' }).$usage('render', 'sampled');
    const [s] = this.viewTransform();
    this.halos.forEach((halo, i) => {
      let t = this.haloTex[i];
      if (!t) {
        const a = tex();
        const b = tex();
        const p = this.paints[halo.paint];
        const sigma = Math.max(0.5, (p.blur * s) / 2); // texture is half resolution
        const blurH = this.root.createBuffer(S.Blur, { dir: d.vec2i(1, 0), sigma, radius: Math.ceil(sigma * 3) }).$usage('uniform');
        const blurV = this.root.createBuffer(S.Blur, { dir: d.vec2i(0, 1), sigma, radius: Math.ceil(sigma * 3) }).$usage('uniform');
        const params = this.root.createBuffer(S.HaloParams).$usage('uniform');
        t = {
          a, b, blurH, blurV, params,
          bgH: this.root.createBindGroup(S.blurLayout, { src: a, params: blurH }),
          bgV: this.root.createBindGroup(S.blurLayout, { src: b, params: blurV }),
          bgComposite: this.root.createBindGroup(S.haloLayout, { tex: a, samp: this.sampler, params }),
        };
        this.haloTex[i] = t;
      }
      const mask = encoder.beginRenderPass({ colorAttachments: [{ view: t.a, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }] });
      mask.setPipeline(this.pipes.haloMask);
      mask.setBindGroup(S.layout, this.bindGroup);
      mask.setVertexBuffer(S.fillLayout, this.haloVB);
      mask.draw(halo.count, 1, halo.first);
      mask.end();
      for (const [dst, bg] of [[t.b, t.bgH], [t.a, t.bgV]] as const) {
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: dst, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }] });
        pass.setPipeline(this.pipes.blur);
        pass.setBindGroup(S.blurLayout, bg);
        pass.draw(3);
        pass.end();
      }
    });
  }

  render() {
    if (!this.width || !this.paints.length) return;
    performance.mark('gpu:encode-start');
    this.updateOrder();
    const [sx, sy, tx, ty] = this.viewTransform();
    this.frameBuffer.write({ toDev: d.vec4f(sx, sy, tx, ty), viewport: d.vec2f(this.width, this.height), dpr: this.dpr, total: this.total + 2 });
    this.ensureBindGroup();
    const encoder = this.root['~unstable'].createCommandEncoder();
    this.ensureHalos(encoder);
    this.live?.encodeLayers(encoder);
    this.halos.forEach((halo, i) => {
      const p = this.paints[halo.paint];
      const it = this.scene.items[halo.item];
      const seq = this.itemBases[halo.item] + halo.layer;
      this.haloTex[i].params.write({
        color: d.vec4f(...p.rgba),
        shift: d.vec2f((it.move[0] * this.share + p.translate[0]) * sx, (it.move[1] * this.share + p.translate[1]) * sy),
        depth: 1 - (seq + 1) / (this.total + 2),
        pad: 0,
      });
    });
    const [r, g, b] = this.background;
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: this.msaa, resolveTarget: this.context, clearValue: [r, g, b, 1], loadOp: 'clear', storeOp: 'discard' }],
      depthStencilAttachment: { view: this.depth, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      ...(this.query && !this.query.busy ? { timestampWrites: { querySet: this.query.set, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {}),
    });
    pass.setPipeline(this.pipes.fillOpaque);
    pass.setBindGroup(S.layout, this.bindGroup);
    pass.setVertexBuffer(S.fillLayout, this.fillVB);
    if (this.opaqueCount) pass.draw(this.opaqueCount);
    this.live?.drawOpaque(pass);
    for (const draw of this.draws) {
      if (draw.kind === 'slot') {
        this.live?.drawSlot(pass, draw.slot);
      } else if (draw.kind === 'segs') {
        pass.setPipeline(this.pipes.stroke);
        pass.setBindGroup(S.layout, this.bindGroup);
        pass.draw(6, draw.count, 0, draw.first);
      } else if (draw.kind === 'fill') {
        pass.setPipeline(draw.blend === 'multiply' ? this.pipes.fillMultiply : draw.blend === 'screen' ? this.pipes.fillScreen : this.pipes.fillOver);
        pass.setBindGroup(S.layout, this.bindGroup);
        pass.setVertexBuffer(S.fillLayout, this.blendVB);
        pass.draw(draw.count, 1, draw.first);
      } else {
        pass.setPipeline(this.pipes.halo);
        pass.setBindGroup(S.layout, this.bindGroup);
        pass.setBindGroup(S.haloLayout, this.haloTex[draw.halo].bgComposite);
        pass.draw(3);
      }
    }
    pass.end();
    const q = this.query && !this.query.busy ? this.query : null;
    encoder.submit();
    if (q) {
      q.busy = true;
      q.set.resolve();
      q.set.read().then((t: bigint[]) => {
        this.stats.lastGpuMs = Number(t[1] - t[0]) / 1e6;
        q.busy = false;
      }, () => { q.busy = false; });
    }
    performance.mark('gpu:encode-end');
    performance.measure('gpu:encode', 'gpu:encode-start', 'gpu:encode-end');
    // Durations come from User Timing marks: they run on the real clock even when tools/lockstep.js virtualizes
    // performance.now().
    const ms = performance.measure('gpu-encode', 'gpu:encode-start', 'gpu:encode-end').duration;
    const s = this.stats;
    s.frames++;
    s.lastEncodeMs = ms;
    s.avgEncodeMs += (ms - s.avgEncodeMs) / s.frames;
    s.draws = this.draws.length + 1;
  }

  destroy() {
    for (const b of [this.fillVB, this.blendVB, this.haloVB, this.segBuffer, this.orderBuffer, this.itemBuffer, this.paintBuffer, this.gradBuffer, this.stopBuffer, this.frameBuffer]) b?.destroy();
    this.msaa?.destroy();
    this.depth?.destroy();
    this.live?.destroy();
  }
}
