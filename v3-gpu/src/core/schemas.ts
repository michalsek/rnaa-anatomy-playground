// GPU record layouts. Every record is one TypeGPU schema; the WGSL side reads it through the bind group layouts in
// shaders.ts, and the CPU packers address fields through the word offsets derived below with d.memoryLayoutOf, so a
// field added to or moved inside a schema moves the packers with it. Imports only `typegpu/data` (no root, no shader
// code), so the CPU geometry modules and the Node tests can use it.
import * as d from 'typegpu/data';

export const Frame = d.struct({
  /** device px = (viewBox point + item offset) · toDev.xy + toDev.zw */
  toDev: d.vec4f,
  /** Render target size in device px. */
  viewport: d.vec2f,
  /** Device px per CSS px (stroke widths are CSS px: non-scaling strokes). */
  dpr: d.f32,
  /** Depth of painter slot `seq` is 1 − (seq + 1) / depthDenominator; the denominator is the slot total + 2. */
  depthDenominator: d.f32,
});

/** Per item (static items, then one pseudo-item per live slot): explode offset and first depth slot. */
export const Item = d.struct({ offset: d.vec2f, base: d.u32 });

/** kind: PAINT_KIND; grad: index into the gradient array when kind is linear. */
export const Paint = d.struct({ color: d.vec4f, width: d.f32, kind: d.u32, grad: d.u32 });
export const Gradient = d.struct({ p0: d.vec2f, p1: d.vec2f, first: d.u32, count: d.u32 });
export const Stop = d.struct({ color: d.vec4f, offset: d.f32 });

/**
 * One stroke segment (or one dot: p0 = p1 = centre, width = radius in viewBox units).
 * - joinStart / joinEnd: un-normalized join bisector normals (sum of the unit directions of the two segments of the
 *   join); a pixel belongs to this segment when it lies on this segment's side of both join lines. Zero = no join.
 * - crowd: smallest distance (viewBox units) to a polyline neighbour that can claim the same pixels in a way the join
 *   lines do not capture (non-adjacent ±2/±3 segments, the far ends of the adjacent segments, hairpin joins = 0).
 *   When it is within reach at the current scale, the shader falls back to exact nearest-segment ownership.
 * - polyStart / polyEnd: segment index range of the polyline (for that fallback).
 */
export const Seg = d.struct({
  p0: d.vec2f,
  p1: d.vec2f,
  joinStart: d.vec2f,
  joinEnd: d.vec2f,
  /** CSS px; 0 → the paint's computed stroke-width. Dots: radius in viewBox units. */
  width: d.f32,
  item: d.u32,
  paint: d.u32,
  layer: d.u32,
  alpha: d.f32,
  flags: d.u32,
  polyStart: d.u32,
  polyEnd: d.u32,
  crowd: d.f32,
});

/**
 * Fill vertex: ids = (item, paint, layer, alpha · 65535) as four u16 (WGSL vec4u). Fill alpha travels per vertex, so
 * one paint serves every opacity of the same CSS chain.
 */
export const FillVertex = d.unstruct({ pos: d.float32x2, ids: d.uint16x4 });

export const Blur = d.struct({ dir: d.vec2i, sigma: d.f32, radius: d.i32 });
export const HaloParams = d.struct({ color: d.vec4f, shift: d.vec2f, depth: d.f32 });

/** A group-opacity layer: its box in the atlas and on the canvas (device px), composite depth and alpha. */
export const GroupParams = d.struct({ atlasOrigin: d.vec2i, canvasOrigin: d.vec2i, size: d.vec2i, depth: d.f32, alpha: d.f32 });

/** Debug overlay rectangle (device px), drawn translucent with an outline. */
export const DebugRect = d.struct({ min: d.vec2f, max: d.vec2f, color: d.vec4f });

export const PAINT_KIND = { solid: 0, linear: 1 } as const;

/** Seg.flags (GPU side; the DL's own segment flags are export/dl-format.mjs SEG_FLAG). */
export const SEG = {
  dot: 1,
  closed: 2,
  buttStart: 4,
  buttEnd: 8,
  roundStart: 16,
  roundEnd: 32,
  /** All four cap bits: the segment ends an open polyline on at least one side. */
  capMask: 4 | 8 | 16 | 32,
  joinStart: 64,
  joinEnd: 128,
} as const;

/** Largest id that fits a u16 field of FillVertex.ids (item, paint, layer). */
export const MAX_U16 = 0xffff;

const wordOf = <T extends d.BaseData>(schema: T, accessor: (proxy: d.Infer<T>) => unknown) => {
  const { offset } = d.memoryLayoutOf(schema, accessor);
  if (offset % 4) throw new Error(`schemas: field at byte ${offset} is not word-aligned`);
  return offset / 4;
};

const words = (schema: d.AnyData) => {
  const bytes = d.sizeOf(schema);
  if (bytes % 4) throw new Error(`schemas: record size ${bytes} is not a whole number of words`);
  return bytes / 4;
};

/** Seg record: size and word index of every field (f32 / u32 views over the same words). */
export const SEG_RECORD = {
  bytes: d.sizeOf(Seg),
  words: words(Seg),
  p0: wordOf(Seg, (s) => s.p0),
  p1: wordOf(Seg, (s) => s.p1),
  joinStart: wordOf(Seg, (s) => s.joinStart),
  joinEnd: wordOf(Seg, (s) => s.joinEnd),
  width: wordOf(Seg, (s) => s.width),
  item: wordOf(Seg, (s) => s.item),
  paint: wordOf(Seg, (s) => s.paint),
  layer: wordOf(Seg, (s) => s.layer),
  alpha: wordOf(Seg, (s) => s.alpha),
  flags: wordOf(Seg, (s) => s.flags),
  polyStart: wordOf(Seg, (s) => s.polyStart),
  polyEnd: wordOf(Seg, (s) => s.polyEnd),
  crowd: wordOf(Seg, (s) => s.crowd),
};

/** FillVertex field order (an unstruct packs its fields back to back, without alignment padding). */
const FILL_VERTEX_FIELDS = ['pos', 'ids'] as const;

/** FillVertex record: pos (2 × f32), then ids as two u32 words: item | paint << 16 and layer | alpha16 << 16. */
export const FILL_VERTEX_RECORD = (() => {
  if (Object.keys(FillVertex.propTypes).join() !== FILL_VERTEX_FIELDS.join()) throw new Error('schemas: FILL_VERTEX_FIELDS out of date');
  const pos = 0;
  const ids = pos + d.sizeOf(FillVertex.propTypes.pos);
  if (ids % 4 || ids + d.sizeOf(FillVertex.propTypes.ids) !== d.sizeOf(FillVertex)) throw new Error('schemas: FillVertex layout');
  return { bytes: d.sizeOf(FillVertex), words: words(FillVertex), pos: pos / 4, ids: ids / 4 };
})();

export const ITEM_RECORD = {
  bytes: d.sizeOf(Item),
  words: words(Item),
  offset: wordOf(Item, (i) => i.offset),
  base: wordOf(Item, (i) => i.base),
};

export const PAINT_RECORD = {
  words: words(Paint),
  color: wordOf(Paint, (p) => p.color),
  width: wordOf(Paint, (p) => p.width),
  kind: wordOf(Paint, (p) => p.kind),
  grad: wordOf(Paint, (p) => p.grad),
};

export const GRADIENT_RECORD = {
  words: words(Gradient),
  p0: wordOf(Gradient, (g) => g.p0),
  p1: wordOf(Gradient, (g) => g.p1),
  first: wordOf(Gradient, (g) => g.first),
  count: wordOf(Gradient, (g) => g.count),
};

export const STOP_RECORD = {
  words: words(Stop),
  color: wordOf(Stop, (s) => s.color),
  offset: wordOf(Stop, (s) => s.offset),
};

export const GROUP_PARAMS_RECORD = {
  bytes: d.sizeOf(GroupParams),
  words: words(GroupParams),
  atlasOrigin: wordOf(GroupParams, (g) => g.atlasOrigin),
  canvasOrigin: wordOf(GroupParams, (g) => g.canvasOrigin),
  size: wordOf(GroupParams, (g) => g.size),
  depth: wordOf(GroupParams, (g) => g.depth),
  alpha: wordOf(GroupParams, (g) => g.alpha),
};

export const DEBUG_RECT_RECORD = {
  bytes: d.sizeOf(DebugRect),
  words: words(DebugRect),
  min: wordOf(DebugRect, (r) => r.min),
  max: wordOf(DebugRect, (r) => r.max),
  color: wordOf(DebugRect, (r) => r.color),
};

/** Fill alpha is stored as a u16 fraction of this. */
export const FILL_ALPHA_SCALE = 0xffff;

/** Depth of painter slot `seq` among `total` slots: 1 − (seq + 1) / (total + 2), as `depthOf` in the shaders. */
export const depthOfSlot = (seq: number, total: number) => 1 - (seq + 1) / (total + 2);
