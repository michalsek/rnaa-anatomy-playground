// `?native=cpu` (evaluation, PORT-PLAN P3 design input): the native rotor's parts expanded on the CPU into the very
// records the compute pass writes — Seg records through the shared SegWriter (so stroke semantics are single-sourced)
// and FillVertex words — compacted to what is drawn (no undrawn slots, no zero-area triangles). The painter uploads them
// instead of dispatching; drawing is unchanged. Same block order, runs and layers as rotor-shaders.ts.
import { FILL_ALPHA_SCALE } from '../core/schemas.ts';
import { SegWriter, type SegCommon } from '../core/strokes.ts';
import { bitOf, cameraOf, seamWordOf, shadeOf, shadeWordOf, type Projection } from './kit-mirror.ts';
import type { RotorModel } from './rotor-model.ts';
import { PART_FLAG, PART_LAYER, PART_RECORD, STYLE_RECORD } from './rotor-schemas.ts';
import type { RotorStyles } from './rotor-styles.ts';

/** Record ranges of one slot in the emitted buffers. */
export interface EmittedSlot {
  segFirst: number;
  segCount: number;
  vertexFirst: number;
  vertexCount: number;
}

const CREASE = 0, BEVEL = 1, BACK = 2, FRONT = 3, VERTICAL = 4, BAND = 5;
const RUN_BLOCKS = [CREASE, BEVEL, BACK, FRONT, VERTICAL, BAND] as const;

export class RotorCpuEmitter {
  readonly segs = new SegWriter(2048);
  /** FillVertex words (pos.x, pos.y as f32 bits, item | paint << 16, layer | alpha16 << 16). */
  fills = new Uint32Array(4 * 4096);
  vertexCount = 0;
  readonly slots: EmittedSlot[] = [0, 1, 2, 3].map(() => ({ segFirst: 0, segCount: 0, vertexFirst: 0, vertexCount: 0 }));
  private fillsF32 = new Float32Array(this.fills.buffer);
  private readonly ring: Float64Array;
  private readonly triangles: Uint32Array;
  // per part scratch: projected top / bottom points, edge normals, the polyline being built
  private top = new Float64Array(0);
  private bottom = new Float64Array(0);
  private world = new Float64Array(0);
  private line = new Float64Array(0);
  /** Ring size of the part being emitted. */
  private ringCount = 0;
  private readonly common: SegCommon = { width: 0, item: 0, paint: 0, layer: 0, alpha: 1 };
  private readonly o: [number, number];
  private readonly xAxis: [number, number];
  private readonly yAxis: [number, number];
  private readonly zAxis: number;

  constructor(private readonly model: RotorModel, private readonly styles: RotorStyles, projection: Projection) {
    this.ring = model.templates.ring64();
    this.triangles = model.templates.triangles();
    const c = cameraOf(projection);
    this.o = [projection.origin[0], projection.origin[1]];
    this.xAxis = [c.sinA * c.k, c.cosA * c.sinE * c.k];
    this.yAxis = [-c.cosA * c.k, c.sinA * c.sinE * c.k];
    this.zAxis = -c.cosE * c.k;
  }

  /** Expands the model's current frame. */
  emit() {
    const model = this.model;
    const u32 = model.records;
    const f32 = new Float32Array(u32.buffer, u32.byteOffset, u32.length);
    const R = PART_RECORD;
    this.segs.reset();
    this.vertexCount = 0;
    model.slots.forEach((s, slot) => {
      const out = this.slots[slot];
      out.segFirst = this.segs.count;
      out.vertexFirst = this.vertexCount;
      for (let part = s.first; part < s.first + s.count; part++) this.emitPart(u32, f32, part * R.words);
      out.segCount = this.segs.count - out.segFirst;
      out.vertexCount = this.vertexCount - out.vertexFirst;
    });
  }

  private emitPart(u32: Uint32Array, f32: Float32Array, o: number) {
    const R = PART_RECORD;
    const n = u32[o + R.ringCount];
    const ringFirst = u32[o + R.ringFirst];
    this.ringCount = n;
    if (this.top.length < 2 * (n + 1)) {
      this.top = new Float64Array(2 * (n + 1));
      this.bottom = new Float64Array(2 * (n + 1));
      this.world = new Float64Array(2 * (n + 1));
      this.line = new Float64Array(2 * (n + 2));
    }
    const cx = f32[o + R.centre], cy = f32[o + R.centre + 1], ca = f32[o + R.rotation], sa = f32[o + R.rotation + 1];
    const z0 = f32[o + R.z0], height = f32[o + R.height];
    for (let i = 0; i < n; i++) {
      const u = this.ring[(ringFirst + i) * 2], v = this.ring[(ringFirst + i) * 2 + 1];
      const wx = cx + u * ca - v * sa, wy = cy + u * sa + v * ca;
      this.world[i * 2] = wx;
      this.world[i * 2 + 1] = wy;
      this.project(wx, wy, z0 + height, this.top, i);
      this.project(wx, wy, z0, this.bottom, i);
    }
    const classes = this.model.classes;
    const at = u32[o + R.classFirst];
    const facing = (i: number) => bitOf(classes, at, i % n) === 1;
    const style = u32[o + R.style] * STYLE_RECORD.words;
    const sU32 = this.styles.records;
    const sF32 = new Float32Array(sU32.buffer, sU32.byteOffset, sU32.length);
    const item = u32[o + R.item], layer = u32[o + R.layer];
    // fills: top triangles, then two triangles per facing side face
    const triangleFirst = u32[o + R.triangleFirst], triangleCount = u32[o + R.triangleCount];
    const topPaint = sU32[style + STYLE_RECORD.top];
    for (let t = 0; t < triangleCount; t++) {
      for (let c = 0; c < 3; c++) {
        const i = this.triangles[triangleFirst + t * 3 + c];
        this.vertex(this.top[i * 2], this.top[i * 2 + 1], item, topPaint, layer + PART_LAYER.top);
      }
    }
    for (let face = 0; face < n; face++) {
      if (!facing(face)) continue;
      const shade = shadeOf(classes, at + shadeWordOf(n), face);
      const paint = sU32[style + STYLE_RECORD.shade + shade];
      const l = layer + PART_LAYER.shade + shade;
      const next = (face + 1) % n;
      this.vertex(this.top[face * 2], this.top[face * 2 + 1], item, paint, l);
      this.vertex(this.top[next * 2], this.top[next * 2 + 1], item, paint, l);
      this.vertex(this.bottom[next * 2], this.bottom[next * 2 + 1], item, paint, l);
      this.vertex(this.top[face * 2], this.top[face * 2 + 1], item, paint, l);
      this.vertex(this.bottom[next * 2], this.bottom[next * 2 + 1], item, paint, l);
      this.vertex(this.bottom[face * 2], this.bottom[face * 2 + 1], item, paint, l);
    }
    // strokes, in rotor-shaders.ts block order
    const flags = u32[o + R.flags];
    const bevel = f32[o + R.bevel], strap = f32[o + R.strap], bandZ = f32[o + R.bandZ];
    const facingRun = u32[o + R.facingRun], seamRun = u32[o + R.seamRun];
    const seam = (i: number) => bitOf(classes, at + seamWordOf(n), i % n) === 1;
    for (const block of RUN_BLOCKS) {
      const paint = block === CREASE ? STYLE_RECORD.crease : block === BEVEL ? STYLE_RECORD.bevel : block === BAND ? STYLE_RECORD.line : STYLE_RECORD.edge;
      const width = block === CREASE ? STYLE_RECORD.creaseWidth : block === BEVEL ? STYLE_RECORD.bevelWidth : block === BAND ? STYLE_RECORD.lineWidth : STYLE_RECORD.edgeWidth;
      const blockLayer = block === CREASE ? PART_LAYER.crease : block === BEVEL ? PART_LAYER.bevel : block === BAND ? PART_LAYER.line : PART_LAYER.edge;
      this.common.item = item;
      this.common.paint = sU32[style + paint];
      this.common.width = sF32[style + width];
      this.common.layer = layer + blockLayer;
      if (block === VERTICAL) {
        if (!(height > 0)) continue;
        for (let k = 0; k < n; k++) {
          if (facing(k + n - 1) === facing(k)) continue;
          this.line[0] = this.top[k * 2];
          this.line[1] = this.top[k * 2 + 1];
          this.line[2] = this.bottom[k * 2];
          this.line[3] = this.bottom[k * 2 + 1];
          this.segs.polyline(this.line, 0, 2, false, 'round', this.common);
        }
        continue;
      }
      if (block === BAND && !(flags & PART_FLAG.band)) continue;
      if (block === BEVEL && !(bevel > 0)) continue;
      if (block === FRONT && !(height > 0)) continue;
      const start = block === BAND ? seamRun : facingRun;
      const drawn = (k: number) => {
        const e = start + k;
        if (block === BAND) return seam(e);
        return block === BACK ? !facing(e) : facing(e);
      };
      let k = 0;
      while (k < n) {
        if (!drawn(k)) {
          k++;
          continue;
        }
        let points = 0;
        const first = k;
        for (; k < n && drawn(k); k++) {
          const e = (start + k) % n;
          if (k === first) points = this.point(block, e, z0 + height, bandZ, bevel, flags, facing, points);
          points = this.point(block, (e + 1) % n, z0 + height, bandZ, bevel, flags, facing, points);
        }
        this.segs.polyline(this.line, 0, points, false, 'round', this.common);
      }
    }
    if (strap > 0) {
      const z = z0 + height;
      this.common.paint = sU32[style + STYLE_RECORD.line];
      this.common.width = sF32[style + STYLE_RECORD.lineWidth];
      this.common.layer = layer + PART_LAYER.line;
      this.project(cx - ca * strap, cy - sa * strap, z, this.line, 0);
      this.project(cx + ca * strap, cy + sa * strap, z, this.line, 1);
      this.segs.polyline(this.line, 0, 2, false, 'round', this.common);
    }
  }

  /** Appends block point i (ring index) to `line`; returns the point count. */
  private point(block: number, i: number, topZ: number, bandZ: number, bevel: number, flags: number, facing: (i: number) => boolean, count: number) {
    if (block === FRONT) {
      this.line[count * 2] = this.bottom[i * 2];
      this.line[count * 2 + 1] = this.bottom[i * 2 + 1];
    } else if (block === BAND) {
      this.project(this.world[i * 2], this.world[i * 2 + 1], bandZ, this.line, count);
    } else if (block === BEVEL) {
      this.bevelPoint(i, topZ, bevel, flags, facing, count);
    } else {
      this.line[count * 2] = this.top[i * 2];
      this.line[count * 2 + 1] = this.top[i * 2 + 1];
    }
    return count + 1;
  }

  /** kit extrude bevel: run ends stay on the top ring, interior points move inward along the corner bisector. */
  private bevelPoint(i: number, topZ: number, bevel: number, flags: number, facing: (i: number) => boolean, count: number) {
    const ringCount = this.ringCount;
    const previous = (i + ringCount - 1) % ringCount;
    if (!(facing(previous) && facing(i))) {
      this.line[count * 2] = this.top[i * 2];
      this.line[count * 2 + 1] = this.top[i * 2 + 1];
      return;
    }
    const counter = (flags & PART_FLAG.counter) !== 0;
    const normal = (a: number, out: number) => {
      const b = (a + 1) % ringCount;
      const ex = this.world[b * 2] - this.world[a * 2], ey = this.world[b * 2 + 1] - this.world[a * 2 + 1];
      const l = Math.hypot(ex, ey) || 1;
      return out === 0 ? (counter ? ey : -ey) / l : (counter ? -ex : ex) / l;
    };
    const mx = normal(previous, 0) + normal(i, 0), my = normal(previous, 1) + normal(i, 1);
    const l = Math.hypot(mx, my) || 1;
    this.project(this.world[i * 2] - (mx / l) * bevel, this.world[i * 2 + 1] - (my / l) * bevel, topZ, this.line, count);
  }

  private project(x: number, y: number, z: number, out: Float64Array, at: number) {
    out[at * 2] = this.o[0] + x * this.xAxis[0] + y * this.yAxis[0];
    out[at * 2 + 1] = this.o[1] + x * this.xAxis[1] + y * this.yAxis[1] + z * this.zAxis;
  }

  private vertex(x: number, y: number, item: number, paint: number, layer: number) {
    if ((this.vertexCount + 1) * 4 > this.fills.length) {
      const grown = new Uint32Array(this.fills.length * 2);
      grown.set(this.fills);
      this.fills = grown;
      this.fillsF32 = new Float32Array(grown.buffer);
    }
    const w = this.vertexCount++ * 4;
    this.fillsF32[w] = x;
    this.fillsF32[w + 1] = y;
    this.fills[w + 2] = item | (paint << 16);
    this.fills[w + 3] = layer | (FILL_ALPHA_SCALE << 16);
  }
}
