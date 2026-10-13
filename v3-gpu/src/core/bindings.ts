// GPU buffers every draw binds (frame uniform, items, paints, gradients, stops) and the `layout` bind groups built on
// them. Records are packed straight into each buffer's host mirror (`buffer.arrayBuffer`) through the schema-derived
// word offsets and uploaded with `buffer.write(buffer.arrayBuffer, { endOffset })`, which skips TypeGPU's copy.
import type { StorageFlag, TgpuBindGroup, TgpuBuffer, TgpuRoot, UniformFlag, VertexFlag } from 'typegpu';
import * as d from 'typegpu/data';
import type { PaintTable } from './paint.ts';
import { Frame, Gradient, GRADIENT_RECORD, Item, ITEM_RECORD, PAINT_KIND, PAINT_RECORD, Paint, Seg, Stop, STOP_RECORD } from './schemas.ts';
import * as S from './shaders.ts';

export type FrameBuffer = TgpuBuffer<typeof Frame> & UniformFlag;
export type StorageArray<T extends d.AnyWgslData> = TgpuBuffer<d.WgslArray<T>> & StorageFlag;
/** Segment records (a live slot's buffer is also its fill vertex stream: segments first, then fill vertices). */
export type SegStorage = StorageArray<typeof Seg>;
export type SlotBuffer = SegStorage & VertexFlag;
export type LayoutGroup = TgpuBindGroup<(typeof S.layout)['entries']>;

/** Growth factor of grow-only buffers (live paints are discovered a few at a time). */
const GROWTH = 1.5;

export interface FrameValues {
  scale: number;
  translate: [number, number];
  width: number;
  height: number;
  dpr: number;
  depthTotal: number;
}

export class SharedBindings {
  readonly frame: FrameBuffer;
  readonly items: StorageArray<typeof Item>;
  private paints: StorageArray<typeof Paint>;
  private grads: StorageArray<typeof Gradient>;
  private stops: StorageArray<typeof Stop>;
  private identity: StorageArray<d.U32>;
  private identityLength = 0;
  /** Bumped whenever a bound buffer is replaced: bind groups built on the old one are stale. */
  version = 0;
  private paintVersion = -1;
  private readonly frameValues = new Float32Array(8);

  constructor(private readonly root: TgpuRoot, itemCount: number) {
    this.frame = root.createBuffer(Frame).$usage('uniform');
    this.items = root.createBuffer(d.arrayOf(Item, Math.max(1, itemCount))).$usage('storage');
    this.paints = root.createBuffer(d.arrayOf(Paint, 1)).$usage('storage');
    this.grads = root.createBuffer(d.arrayOf(Gradient, 1)).$usage('storage');
    this.stops = root.createBuffer(d.arrayOf(Stop, 1)).$usage('storage');
    this.identity = root.createBuffer(d.arrayOf(d.u32, 1)).$usage('storage');
    this.ensureIdentity(1);
  }

  /** Writes the frame uniform when any value changed; returns whether it did. */
  writeFrame(values: FrameValues, target: FrameBuffer = this.frame, origin: [number, number] = [0, 0]): boolean {
    const next = [values.scale, values.scale, values.translate[0] - origin[0], values.translate[1] - origin[1], values.width, values.height, values.dpr, values.depthTotal + 2];
    const current = target === this.frame ? this.frameValues : null;
    if (current && next.every((v, i) => Math.fround(v) === current[i])) return false;
    if (current) current.set(next);
    target.write({ toDev: d.vec4f(next[0], next[1], next[2], next[3]), viewport: d.vec2f(next[4], next[5]), dpr: next[6], depthDenominator: next[7] });
    return true;
  }

  /** Item records: explode offset and depth base per item / slot pseudo-item. */
  writeItems(offsets: Float32Array, bases: Uint32Array, count: number) {
    const host = this.items.arrayBuffer;
    const f32 = new Float32Array(host);
    const u32 = new Uint32Array(host);
    for (let i = 0; i < count; i++) {
      const o = i * ITEM_RECORD.words;
      f32[o + ITEM_RECORD.offset] = offsets[i * 2];
      f32[o + ITEM_RECORD.offset + 1] = offsets[i * 2 + 1];
      u32[o + ITEM_RECORD.base] = bases[i];
    }
    this.items.write(host, { endOffset: count * ITEM_RECORD.bytes });
  }

  /** Uploads the paint table (colours, gradients, stops) when it changed since the last upload. */
  writePaints(table: PaintTable) {
    if (table.version === this.paintVersion) return;
    this.paintVersion = table.version;
    const gradientOf = new Map<number, number>();
    let stopCount = 0;
    table.descs.forEach((desc, id) => {
      if (desc.kind !== 'linear') return;
      gradientOf.set(id, gradientOf.size);
      stopCount += desc.stops.length;
    });
    this.paints = this.grow(this.paints, table.size, (n) => this.root.createBuffer(d.arrayOf(Paint, n)).$usage('storage'));
    this.grads = this.grow(this.grads, gradientOf.size, (n) => this.root.createBuffer(d.arrayOf(Gradient, n)).$usage('storage'));
    this.stops = this.grow(this.stops, stopCount, (n) => this.root.createBuffer(d.arrayOf(Stop, n)).$usage('storage'));
    const paintWords = new Float32Array(this.paints.arrayBuffer);
    const paintU32 = new Uint32Array(this.paints.arrayBuffer);
    const gradWords = new Float32Array(this.grads.arrayBuffer);
    const gradU32 = new Uint32Array(this.grads.arrayBuffer);
    const stopWords = new Float32Array(this.stops.arrayBuffer);
    let stop = 0;
    table.resolved.forEach((paint, id) => {
      const o = id * PAINT_RECORD.words;
      paintWords.set(paint.rgba, o + PAINT_RECORD.color);
      paintWords[o + PAINT_RECORD.width] = paint.width;
      const gradient = gradientOf.get(id);
      paintU32[o + PAINT_RECORD.kind] = gradient === undefined ? PAINT_KIND.solid : PAINT_KIND.linear;
      paintU32[o + PAINT_RECORD.grad] = gradient ?? 0;
      const desc = table.descs[id];
      if (gradient === undefined || desc.kind !== 'linear') return;
      const g = gradient * GRADIENT_RECORD.words;
      gradWords[g + GRADIENT_RECORD.p0] = desc.x1;
      gradWords[g + GRADIENT_RECORD.p0 + 1] = desc.y1;
      gradWords[g + GRADIENT_RECORD.p1] = desc.x2;
      gradWords[g + GRADIENT_RECORD.p1 + 1] = desc.y2;
      gradU32[g + GRADIENT_RECORD.first] = stop;
      gradU32[g + GRADIENT_RECORD.count] = paint.stops?.length ?? 0;
      for (const s of paint.stops ?? []) {
        const at = stop++ * STOP_RECORD.words;
        stopWords.set(s.rgba, at + STOP_RECORD.color);
        stopWords[at + STOP_RECORD.offset] = s.offset;
      }
    });
    this.paints.write(this.paints.arrayBuffer, { endOffset: Math.max(1, table.size) * d.sizeOf(Paint) });
    this.grads.write(this.grads.arrayBuffer, { endOffset: Math.max(1, gradientOf.size) * d.sizeOf(Gradient) });
    this.stops.write(this.stops.arrayBuffer, { endOffset: Math.max(1, stopCount) * d.sizeOf(Stop) });
  }

  /** An identity order buffer (instance i → segment i) of at least `count` entries, for painters that draw in order. */
  identityOf(count: number): StorageArray<d.U32> {
    this.ensureIdentity(count);
    return this.identity;
  }

  layoutGroup(segs: SegStorage, order: StorageArray<d.U32>, frame: FrameBuffer = this.frame): LayoutGroup {
    return this.root.createBindGroup(S.layout, { frame, items: this.items, paints: this.paints, grads: this.grads, stops: this.stops, segs, order });
  }

  dispose() {
    for (const buffer of [this.frame, this.items, this.paints, this.grads, this.stops, this.identity]) buffer.destroy();
  }

  private ensureIdentity(count: number) {
    if (count <= this.identityLength) return;
    const length = 2 ** Math.ceil(Math.log2(Math.max(1, count)));
    this.identity.destroy();
    this.identity = this.root.createBuffer(d.arrayOf(d.u32, length)).$usage('storage');
    const indices = new Uint32Array(this.identity.arrayBuffer);
    for (let i = 0; i < length; i++) indices[i] = i;
    this.identity.write(this.identity.arrayBuffer);
    this.identityLength = length;
    this.version++;
  }

  /** The buffer when it holds `count` records, else a larger replacement (grow-only; bind groups go stale). */
  private grow<T extends d.AnyWgslData>(buffer: StorageArray<T>, count: number, create: (records: number) => StorageArray<T>): StorageArray<T> {
    if (buffer.dataType.elementCount >= Math.max(1, count)) return buffer;
    buffer.destroy();
    this.version++;
    return create(Math.ceil(Math.max(1, count) * GROWTH));
  }
}
