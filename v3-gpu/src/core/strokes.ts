// Polyline → Seg records, shared by the static scene and the live slots, so both paths emit the same caps, joins and
// ownership data. Pure CPU code (typed arrays only).
//
// Ownership (no double blend inside a stroke): every pixel of a polyline is drawn by exactly one segment. Between
// adjacent segments that is decided by the join line: the line through the shared point whose normal is the sum of
// the two unit directions (the bisector of the angle the segments make). Near a polyline the nearest segment is the one
// whose region between its two join lines contains the point, as long as those regions do not pinch off and no far end
// of a neighbour comes close — so each segment carries the distance at which that stops holding (`crowd`): where its
// join lines meet, and, at turns sharper than a right angle, how near the adjacent segments' far ends come; a hairpin
// join (directions cancel) has no join line and gets 0. The shader falls back to the exact nearest-segment loop (±3
// neighbours, the old ownership rule) when `crowd` is within reach at the current scale.
import { SEG, SEG_RECORD } from './schemas.ts';

/** Stand-in for "no neighbour within any reach" (finite, so it survives every f32 path). */
export const CROWD_NONE = 3e38;
/** Neighbours the exact ownership loop examines on each side (the shader's loop bounds; the old ownership rule). */
export const OWNERSHIP_WINDOW = 3;
const DIRECTION_EPSILON = 1e-12;
const HAIRPIN_EPSILON = 1e-6;
/** Join lines whose normals are this close to parallel (sine of the angle) never meet. */
const PARALLEL_EPSILON = 1e-9;

export interface SegCommon {
  /** CSS px; 0 → the paint's computed stroke-width. */
  width: number;
  item: number;
  paint: number;
  layer: number;
  alpha: number;
}

export type CapStyle = 'round' | 'butt';

/** Growable Seg record array (f32 / u32 views over one buffer), reused across builds. */
export class SegWriter {
  f32: Float32Array<ArrayBuffer>;
  u32: Uint32Array<ArrayBuffer>;
  /** Records written. */
  count = 0;

  constructor(initialRecords = 256) {
    this.f32 = new Float32Array(initialRecords * SEG_RECORD.words);
    this.u32 = new Uint32Array(this.f32.buffer);
  }

  reset() {
    this.count = 0;
  }

  /** Bytes of the written records. */
  get byteLength() {
    return this.count * SEG_RECORD.bytes;
  }

  private reserve(records: number) {
    const needed = (this.count + records) * SEG_RECORD.words;
    if (needed <= this.f32.length) return;
    let size = this.f32.length;
    while (size < needed) size *= 2;
    const next = new Float32Array(size);
    next.set(this.f32.subarray(0, this.count * SEG_RECORD.words));
    this.f32 = next;
    this.u32 = new Uint32Array(next.buffer);
  }

  /** A filled circle (dot): radius in viewBox units. */
  dot(x: number, y: number, radius: number, common: Omit<SegCommon, 'width'>) {
    this.reserve(1);
    const at = this.count++;
    this.write(at, x, y, x, y, { ...common, width: radius }, SEG.dot, at, at + 1);
  }

  /**
   * One polyline: `xy` holds points [x0, y0, x1, y1, …] from point `first`, `count` points, no repeated consecutive
   * points (SVG's polylinesOf). A closed polyline also strokes the segment back to its first point. A single point is a
   * zero-length segment: a round dot, or nothing with butt caps. Returns the number of segments written.
   */
  polyline(xy: ArrayLike<number>, first: number, count: number, closed: boolean, cap: CapStyle, common: SegCommon): number {
    const isClosed = closed && count >= 2;
    const segments = count < 2 ? 1 : isClosed ? count : count - 1;
    if (count < 2 && cap === 'butt') return 0;
    this.reserve(segments);
    const start = this.count;
    const end = start + segments;
    const px = (i: number) => xy[(first + (i % count)) * 2];
    const py = (i: number) => xy[(first + (i % count)) * 2 + 1];
    for (let i = 0; i < segments; i++) {
      let flags = isClosed ? SEG.closed : 0;
      if (!isClosed && i === 0) flags |= cap === 'butt' ? SEG.buttStart : SEG.roundStart;
      if (!isClosed && i === segments - 1) flags |= cap === 'butt' ? SEG.buttEnd : SEG.roundEnd;
      const j = count < 2 ? 0 : i + 1;
      this.write(start + i, px(i), py(i), px(j), py(j), common, flags, start, end);
    }
    if (segments > 1) this.joinPolyline(start, segments, isClosed);
    this.count = end;
    return segments;
  }

  /**
   * Appends `count` records written earlier by another writer from item 0 / layer 0 (a cached element), placing them
   * in `item` and `layer` with record alpha `alpha`; their polyline ranges move to the new position.
   */
  appendRecords(words: Uint32Array, count: number, item: number, layer: number, alpha: number) {
    this.reserve(count);
    const base = this.count;
    const W = SEG_RECORD.words;
    this.u32.set(words.subarray(0, count * W), base * W);
    const { f32, u32 } = this;
    for (let i = 0, o = base * W; i < count; i++, o += W) {
      u32[o + SEG_RECORD.item] = item;
      u32[o + SEG_RECORD.layer] = layer;
      f32[o + SEG_RECORD.alpha] = alpha;
      u32[o + SEG_RECORD.polyStart] += base;
      u32[o + SEG_RECORD.polyEnd] += base;
    }
    this.count += count;
  }

  private write(at: number, x0: number, y0: number, x1: number, y1: number, common: SegCommon, flags: number, polyStart: number, polyEnd: number) {
    const o = at * SEG_RECORD.words;
    const { f32, u32 } = this;
    f32[o + SEG_RECORD.p0] = x0;
    f32[o + SEG_RECORD.p0 + 1] = y0;
    f32[o + SEG_RECORD.p1] = x1;
    f32[o + SEG_RECORD.p1 + 1] = y1;
    f32[o + SEG_RECORD.joinStart] = 0;
    f32[o + SEG_RECORD.joinStart + 1] = 0;
    f32[o + SEG_RECORD.joinEnd] = 0;
    f32[o + SEG_RECORD.joinEnd + 1] = 0;
    f32[o + SEG_RECORD.width] = common.width;
    u32[o + SEG_RECORD.item] = common.item;
    u32[o + SEG_RECORD.paint] = common.paint;
    u32[o + SEG_RECORD.layer] = common.layer;
    f32[o + SEG_RECORD.alpha] = common.alpha;
    u32[o + SEG_RECORD.flags] = flags;
    u32[o + SEG_RECORD.polyStart] = polyStart;
    u32[o + SEG_RECORD.polyEnd] = polyEnd;
    f32[o + SEG_RECORD.crowd] = CROWD_NONE;
  }

  /** Join lines and crowding distances of the segments [start, start + n) of one polyline. */
  private joinPolyline(start: number, n: number, closed: boolean) {
    const { f32, u32 } = this;
    const W = SEG_RECORD.words;
    const ax = (i: number) => f32[(start + i) * W + SEG_RECORD.p0];
    const ay = (i: number) => f32[(start + i) * W + SEG_RECORD.p0 + 1];
    const bx = (i: number) => f32[(start + i) * W + SEG_RECORD.p1];
    const by = (i: number) => f32[(start + i) * W + SEG_RECORD.p1 + 1];
    const lower = (i: number, distance: number) => {
      const at = (start + i) * W + SEG_RECORD.crowd;
      if (distance < f32[at]) f32[at] = distance;
    };
    const joins = closed ? n : n - 1;
    for (let k = 0; k < joins; k++) {
      const i = k;
      const j = (k + 1) % n;
      const ux = bx(i) - ax(i), uy = by(i) - ay(i);
      const vx = bx(j) - ax(j), vy = by(j) - ay(j);
      const ul = Math.hypot(ux, uy), vl = Math.hypot(vx, vy);
      const mx = (ul > DIRECTION_EPSILON ? ux / ul : 0) + (vl > DIRECTION_EPSILON ? vx / vl : 0);
      const my = (ul > DIRECTION_EPSILON ? uy / ul : 0) + (vl > DIRECTION_EPSILON ? vy / vl : 0);
      f32[(start + i) * W + SEG_RECORD.joinEnd] = mx;
      f32[(start + i) * W + SEG_RECORD.joinEnd + 1] = my;
      f32[(start + j) * W + SEG_RECORD.joinStart] = mx;
      f32[(start + j) * W + SEG_RECORD.joinStart + 1] = my;
      u32[(start + i) * W + SEG_RECORD.flags] |= SEG.joinEnd;
      u32[(start + j) * W + SEG_RECORD.flags] |= SEG.joinStart;
      const hairpin = mx * mx + my * my < HAIRPIN_EPSILON;
      // a turn sharper than a right angle folds the adjacent segments' far ends back towards each other
      const sharp = ux * vx + uy * vy < 0;
      const farEnds = sharp ? Math.min(pointSegmentDistance(ax(i), ay(i), ax(j), ay(j), bx(j), by(j)), pointSegmentDistance(bx(j), by(j), ax(i), ay(i), bx(i), by(i))) : CROWD_NONE;
      const distance = hairpin ? 0 : farEnds;
      lower(i, distance);
      lower(j, distance);
    }
    // Where a segment's two join lines meet, its region pinches off: beyond that distance a non-adjacent segment can be
    // nearer than the join lines say. The pinch point lies on both join lines, so it is as far from the two adjacent
    // segments as from this one: all three fall back to the exact loop when it is within reach.
    const jx = (i: number, end: boolean) => f32[(start + i) * W + (end ? SEG_RECORD.joinEnd : SEG_RECORD.joinStart)];
    const jy = (i: number, end: boolean) => f32[(start + i) * W + (end ? SEG_RECORD.joinEnd : SEG_RECORD.joinStart) + 1];
    for (let i = 0; i < n; i++) {
      const hasStart = closed || i > 0;
      const hasEnd = closed || i < n - 1;
      if (!hasStart || !hasEnd) continue;
      const pinch = linesMeet(ax(i), ay(i), jx(i, false), jy(i, false), bx(i), by(i), jx(i, true), jy(i, true));
      if (!pinch) continue;
      const distance = pointSegmentDistance(pinch[0], pinch[1], ax(i), ay(i), bx(i), by(i));
      lower(i, distance);
      lower((i + n - 1) % n, distance);
      lower((i + 1) % n, distance);
    }
  }
}

/** Intersection of the lines {x : (x − p) · m = 0} and {x : (x − q) · k = 0}; null when they are (nearly) parallel. */
function linesMeet(px: number, py: number, mx: number, my: number, qx: number, qy: number, kx: number, ky: number): [number, number] | null {
  const det = mx * ky - my * kx;
  if (Math.abs(det) < PARALLEL_EPSILON * Math.hypot(mx, my) * Math.hypot(kx, ky)) return null;
  const c1 = mx * px + my * py;
  const c2 = kx * qx + ky * qy;
  return [(c1 * ky - my * c2) / det, (mx * c2 - c1 * kx) / det];
}

export function pointSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
