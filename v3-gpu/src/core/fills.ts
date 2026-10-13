// FillVertex records (schemas.ts), shared by the static scene and the live slots.
import { FILL_ALPHA_SCALE, FILL_VERTEX_RECORD, MAX_U16 } from './schemas.ts';

const assertU16 = (what: string, value: number) => {
  if (!(value >= 0 && value <= MAX_U16)) throw new Error(`fill vertex: ${what} ${value} does not fit 16 bits`);
};

/** Growable FillVertex record array (f32 / u32 views over one buffer), reused across builds. */
export class FillWriter {
  f32: Float32Array<ArrayBuffer>;
  u32: Uint32Array<ArrayBuffer>;
  /** Vertices written. */
  count = 0;

  constructor(initialVertices = 1024) {
    this.f32 = new Float32Array(initialVertices * FILL_VERTEX_RECORD.words);
    this.u32 = new Uint32Array(this.f32.buffer);
  }

  reset() {
    this.count = 0;
  }

  get byteLength() {
    return this.count * FILL_VERTEX_RECORD.bytes;
  }

  /** Words of the written records (a view, valid until the next write). */
  get words() {
    return this.u32.subarray(0, this.count * FILL_VERTEX_RECORD.words);
  }

  private reserve(vertices: number) {
    const needed = (this.count + vertices) * FILL_VERTEX_RECORD.words;
    if (needed <= this.f32.length) return;
    let size = this.f32.length;
    while (size < needed) size *= 2;
    const next = new Float32Array(size);
    next.set(this.f32.subarray(0, this.count * FILL_VERTEX_RECORD.words));
    this.f32 = next;
    this.u32 = new Uint32Array(next.buffer);
  }

  /** Appends `count` records of `source` from vertex `first` unchanged. */
  copyFrom(source: FillWriter, first: number, count: number) {
    this.reserve(count);
    const W = FILL_VERTEX_RECORD.words;
    const from = source.u32;
    const to = this.u32;
    for (let i = first * W, o = this.count * W, end = (first + count) * W; i < end; i++, o++) to[o] = from[i];
    this.count += count;
  }

  /**
   * Triangle-list vertices `xy[first … first + count)` (x, y pairs) of one fill, with `dx, dy` added (translation-
   * invariant cached meshes). Returns the index of the first vertex written.
   */
  triangles(xy: ArrayLike<number>, first: number, count: number, item: number, paint: number, layer: number, alpha: number, dx = 0, dy = 0): number {
    assertU16('item', item);
    assertU16('paint', paint);
    assertU16('layer', layer);
    this.reserve(count);
    const { f32, u32 } = this;
    const ids0 = (item | (paint << 16)) >>> 0;
    const ids1 = (layer | (Math.round(Math.min(1, Math.max(0, alpha)) * FILL_ALPHA_SCALE) << 16)) >>> 0;
    const start = this.count;
    let o = start * FILL_VERTEX_RECORD.words;
    for (let v = first; v < first + count; v++, o += FILL_VERTEX_RECORD.words) {
      f32[o + FILL_VERTEX_RECORD.pos] = xy[v * 2] + dx;
      f32[o + FILL_VERTEX_RECORD.pos + 1] = xy[v * 2 + 1] + dy;
      u32[o + FILL_VERTEX_RECORD.ids] = ids0;
      u32[o + FILL_VERTEX_RECORD.ids + 1] = ids1;
    }
    this.count += count;
    return start;
  }
}
