// Bind group layouts and WGSL-string shader functions. No build plugin: every body is WGSL; resources are reached
// through `layout.$.<name>` after `.$uses({ layout })`, and the record flags come from schemas.ts as tgpu.const, so
// the TypeScript packers and the shaders share one definition.
import tgpu from 'typegpu';
import * as d from 'typegpu/data';
import { CROWD_NONE, OWNERSHIP_WINDOW } from './strokes.ts';
import { Blur, DebugRect, FILL_ALPHA_SCALE, FillVertex, Frame, Gradient, GroupParams, HaloParams, Item, PAINT_KIND, Paint, SEG, Seg, Stop } from './schemas.ts';

// ---- layouts -------------------------------------------------------------------------------------------------------
export const fillLayout = tgpu.vertexLayout(d.disarrayOf(FillVertex), 'vertex');

export const layout = tgpu.bindGroupLayout({
  frame: { uniform: Frame },
  items: { storage: d.arrayOf(Item), access: 'readonly' },
  paints: { storage: d.arrayOf(Paint), access: 'readonly' },
  grads: { storage: d.arrayOf(Gradient), access: 'readonly' },
  stops: { storage: d.arrayOf(Stop), access: 'readonly' },
  segs: { storage: d.arrayOf(Seg), access: 'readonly' },
  /** Instance → segment index (strokes draw a painter-ordered subset of `segs`). */
  order: { storage: d.arrayOf(d.u32), access: 'readonly' },
});

export const blurLayout = tgpu.bindGroupLayout({
  src: { texture: d.texture2d(d.f32) },
  params: { uniform: Blur },
});

export const haloLayout = tgpu.bindGroupLayout({
  tex: { texture: d.texture2d(d.f32) },
  samp: { sampler: 'filtering' },
  params: { uniform: HaloParams },
});

export const compositeLayout = tgpu.bindGroupLayout({
  atlas: { texture: d.texture2d(d.f32) },
  groups: { storage: d.arrayOf(GroupParams), access: 'readonly' },
});

/** The static cache: the resolved static frame, copied pixel by pixel outside the redraw region. */
export const cacheLayout = tgpu.bindGroupLayout({
  frame: { texture: d.texture2d(d.f32) },
});

export const debugLayout = tgpu.bindGroupLayout({
  frame: { uniform: Frame },
  rects: { storage: d.arrayOf(DebugRect), access: 'readonly' },
});

// ---- shared constants ----------------------------------------------------------------------------------------------
const u32Const = (value: number) => tgpu.const(d.u32, value);
const f32Const = (value: number) => tgpu.const(d.f32, value);
const FLAGS = {
  SEG_DOT: u32Const(SEG.dot),
  SEG_CLOSED: u32Const(SEG.closed),
  SEG_BUTT_START: u32Const(SEG.buttStart),
  SEG_BUTT_END: u32Const(SEG.buttEnd),
  SEG_ROUND_START: u32Const(SEG.roundStart),
  SEG_ROUND_END: u32Const(SEG.roundEnd),
  SEG_CAP_MASK: u32Const(SEG.capMask),
  SEG_JOIN_START: u32Const(SEG.joinStart),
  SEG_JOIN_END: u32Const(SEG.joinEnd),
};
/** Stroke quads extend this far (device px) beyond the band so every sample a pixel's coverage reaches is rasterized. */
const QUAD_MARGIN_PX = f32Const(1.0);
/** Round caps of strokes thinner than this half-width (device px) use the fitted box-filter cap (calibration sheet). */
const THIN_CAP_HALF_WIDTH = f32Const(0.75);
/** Thin round caps extend past the end point by this fraction of the half-width (fitted on the calibration sheet). */
const THIN_ROUND_CAP_EXTENSION = f32Const(0.6);
/** "No cap on this side": an extent no stroke reaches. */
const NO_CAP_EXTENT = f32Const(1e4);
/**
 * Ownership falls back to the exact neighbour loop when a crowding neighbour is closer (device px) than
 * CROWD_REACH_HW · hw + CROWD_REACH_PX: two segments both cover a pixel only within 2 (hw + ½ px) of each other, plus
 * the thin round cap extension.
 */
const CROWD_REACH_HW = f32Const(2.5);
const CROWD_REACH_PX = f32Const(1.5);
const CROWD_NONE_CONST = f32Const(CROWD_NONE);
const WINDOW = tgpu.const(d.i32, OWNERSHIP_WINDOW);
const ALPHA_SCALE = f32Const(FILL_ALPHA_SCALE);
const PAINT_LINEAR = u32Const(PAINT_KIND.linear);
/** Per-fragment ownership mode, set by the stroke vertex shader. */
const OWN = {
  OWN_LOOP: u32Const(1),
  OWN_CLIP_START: u32Const(2),
  OWN_CLIP_END: u32Const(4),
  OWN_START_TIE: u32Const(8),
  OWN_END_TIE: u32Const(16),
};

// ---- helpers ---------------------------------------------------------------------------------------------------------
const toClip = tgpu.fn([d.vec2f], d.vec2f)/* wgsl */ `(dev: vec2f) -> vec2f {
  let vp = layout.$.frame.viewport;
  return vec2f(dev.x / vp.x * 2.0 - 1.0, 1.0 - dev.y / vp.y * 2.0);
}`.$uses({ layout });

const depthOf = tgpu.fn([d.u32], d.f32)/* wgsl */ `(seq: u32) -> f32 {
  return 1.0 - (f32(seq) + 1.0) / layout.$.frame.depthDenominator;
}`.$uses({ layout });

const devOf = tgpu.fn([d.vec2f, d.u32], d.vec2f)/* wgsl */ `(p: vec2f, item: u32) -> vec2f {
  let f = layout.$.frame;
  return (p + layout.$.items[item].offset) * f.toDev.xy + f.toDev.zw;
}`.$uses({ layout });

const segDist = tgpu.fn([d.vec2f, d.vec2f, d.vec2f], d.f32)/* wgsl */ `(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let l2 = dot(ab, ab);
  let t = select(clamp(dot(p - a, ab) / l2, 0.0, 1.0), 0.0, l2 < 1e-8);
  return length(p - (a + ab * t));
}`;

/**
 * Stroke coverage: box filter of a band of half-width hw at distance `dist` from the pixel centre, in device px.
 * Integrated ink across the line equals the width also below 1 px (Skia "modulate by width" hairlines).
 */
const bandCoverage = tgpu.fn([d.f32, d.f32], d.f32)/* wgsl */ `(dist: f32, hw: f32) -> f32 {
  return max(min(dist + hw, 0.5) - max(dist - hw, -0.5), 0.0);
}`;

/**
 * Disk coverage as a distance ramp at the pixel centre, clamp(r + ½ − d): this is what Chrome's raster does for the
 * kit's tiny bolt dots (r ≈ 0.36–0.5 viewBox units); exact area coverage comes out visibly lighter than the SVG.
 */
const diskCoverage = tgpu.fn([d.vec2f, d.vec2f, d.f32], d.f32)/* wgsl */ `(p: vec2f, c: vec2f, r: f32) -> f32 {
  return clamp(r + 0.5 - length(p - c), 0.0, 1.0);
}`;

const paintColor = tgpu.fn([d.u32, d.vec2f], d.vec4f)/* wgsl */ `(paint: u32, vb: vec2f) -> vec4f {
  let p = layout.$.paints[paint];
  if (p.kind == PAINT_LINEAR) {
    let g = layout.$.grads[p.grad];
    let ab = g.p1 - g.p0;
    let t = clamp(dot(vb - g.p0, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
    var c = layout.$.stops[g.first].color;
    for (var i = 1u; i < g.count; i++) {
      let s0 = layout.$.stops[g.first + i - 1u];
      let s1 = layout.$.stops[g.first + i];
      if (t > s0.offset) {
        let u = clamp((t - s0.offset) / max(s1.offset - s0.offset, 1e-6), 0.0, 1.0);
        c = mix(s0.color, s1.color, u);
      }
    }
    return vec4f(c.rgb, c.a * p.color.a);
  }
  return p.color;
}`.$uses({ layout, PAINT_LINEAR });

// ---- fills -------------------------------------------------------------------------------------------------------------
const fillVaryings = { vb: d.vec2f, paint: d.interpolate('flat', d.u32), alpha: d.interpolate('flat', d.f32) };

export const fillVert = tgpu.vertexFn({
  in: { pos: d.vec2f, ids: d.vec4u },
  out: { position: d.builtin.position, ...fillVaryings },
})/* wgsl */ `{
  let item = in.ids.x;
  var out: Out;
  out.position = vec4f(toClip(devOf(in.pos, item)), depthOf(layout.$.items[item].base + in.ids.z), 1.0);
  out.vb = in.pos;
  out.paint = in.ids.y;
  out.alpha = f32(in.ids.w) / ALPHA_SCALE;
  return out;
}`.$uses({ layout, devOf, toClip, depthOf, ALPHA_SCALE });

/** Opaque fills (paint and markup alpha ≥ OPAQUE_ALPHA): written with depth, alpha forced to 1. */
export const fillFragOpaque = tgpu.fragmentFn({ in: fillVaryings, out: d.vec4f })/* wgsl */ `{
  let c = paintColor(in.paint, in.vb);
  return vec4f(c.rgb, 1.0);
}`.$uses({ paintColor });

/** Source-over (and screen, whose blend factors take the same premultiplied colour). */
export const fillFragOver = tgpu.fragmentFn({ in: fillVaryings, out: d.vec4f })/* wgsl */ `{
  let c = paintColor(in.paint, in.vb);
  let a = c.a * in.alpha;
  return vec4f(c.rgb * a, a);
}`.$uses({ paintColor });

/** mix-blend-mode: multiply → dst · (1 − a + a·src); blend factors (dst, zero). */
export const fillFragMultiply = tgpu.fragmentFn({ in: fillVaryings, out: d.vec4f })/* wgsl */ `{
  let c = paintColor(in.paint, in.vb);
  let a = c.a * in.alpha;
  return vec4f(vec3f(1.0 - a) + c.rgb * a, a);
}`.$uses({ paintColor });

// ---- strokes and dots ---------------------------------------------------------------------------------------------
const strokeVaryings = {
  seg: d.interpolate('flat', d.u32),
  a: d.interpolate('flat', d.vec2f),
  b: d.interpolate('flat', d.vec2f),
  hw: d.interpolate('flat', d.f32),
  own: d.interpolate('flat', d.u32),
};

export const strokeVert = tgpu.vertexFn({
  in: { vid: d.builtin.vertexIndex, iid: d.builtin.instanceIndex },
  out: { position: d.builtin.position, ...strokeVaryings },
})/* wgsl */ `{
  var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let index = layout.$.order[in.iid];
  let s = layout.$.segs[index];
  let f = layout.$.frame;
  let paint = layout.$.paints[s.paint];
  let a = devOf(s.p0, s.item);
  let b = devOf(s.p1, s.item);
  var hw: f32;
  var own = 0u;
  if ((s.flags & SEG_DOT) != 0u) {
    hw = s.width * f.toDev.x;
  } else {
    hw = select(paint.width, s.width, s.width > 0.0) * f.dpr * 0.5;
    if (s.crowd < CROWD_NONE_CONST && s.crowd * f.toDev.x < CROWD_REACH_HW * hw + CROWD_REACH_PX) {
      own = OWN_LOOP;
    } else {
      if ((s.flags & SEG_JOIN_START) != 0u) {
        own |= OWN_CLIP_START;
        // ties go to the lower segment index, as in the exact loop: the first segment of a closed polyline wins
        // against the last one, every other segment loses against its predecessor
        if (index == s.polyStart) { own |= OWN_START_TIE; }
      }
      if ((s.flags & SEG_JOIN_END) != 0u) {
        own |= OWN_CLIP_END;
        if (index + 1u != s.polyEnd) { own |= OWN_END_TIE; }
      }
    }
  }
  let e = hw + QUAD_MARGIN_PX;
  var t = b - a;
  let len = length(t);
  t = select(vec2f(1.0, 0.0), t / len, len > 1e-5);
  let n = vec2f(-t.y, t.x);
  let k = corners[in.vid];
  let p = select(a, b, k.x > 0.0) + t * (k.x * e) + n * (k.y * e);
  var out: Out;
  out.position = vec4f(toClip(p), depthOf(layout.$.items[s.item].base + s.layer), 1.0);
  out.seg = index;
  out.a = a;
  out.b = b;
  out.hw = hw;
  out.own = own;
  return out;
}`.$uses({ layout, devOf, toClip, depthOf, QUAD_MARGIN_PX, CROWD_REACH_HW, CROWD_REACH_PX, CROWD_NONE_CONST, ...FLAGS, ...OWN });

/**
 * Coverage 0..1 of the stroke / dot at device pixel `px`, 0 where another segment of the same polyline owns the pixel
 * (each pixel is blended once per polyline). The neighbour loop (storage reads) runs only for crowded segments.
 */
const strokeCoverage = tgpu.fn([d.vec2f, d.u32, d.vec2f, d.vec2f, d.f32, d.u32], d.f32)/* wgsl */ `(px: vec2f, seg: u32, a: vec2f, b: vec2f, hw: f32, own: u32) -> f32 {
  let flags = layout.$.segs[seg].flags;
  if ((flags & SEG_DOT) != 0u) {
    return diskCoverage(px, a, hw);
  }
  let dist = segDist(px, a, b);
  if ((own & OWN_LOOP) != 0u) {
    let s = layout.$.segs[seg];
    let n = i32(s.polyEnd - s.polyStart);
    let local = i32(seg - s.polyStart);
    let closed = (flags & SEG_CLOSED) != 0u;
    for (var k = -WINDOW; k <= WINDOW; k++) {
      if (k == 0) { continue; }
      var j = local + k;
      if (closed) {
        j = ((j % n) + n) % n;
      } else if (j < 0 || j >= n) {
        continue;
      }
      let other = s.polyStart + u32(j);
      if (other == seg) { continue; }
      let o = layout.$.segs[other];
      let od = segDist(px, devOf(o.p0, o.item), devOf(o.p1, o.item));
      if (od < dist || (od == dist && other < seg)) { return 0.0; }
    }
  } else {
    if ((own & OWN_CLIP_START) != 0u) {
      let ds = dot(px - a, layout.$.segs[seg].joinStart);
      if (!(ds > 0.0 || (ds == 0.0 && (own & OWN_START_TIE) != 0u))) { return 0.0; }
    }
    if ((own & OWN_CLIP_END) != 0u) {
      let de = dot(px - b, layout.$.segs[seg].joinEnd);
      if (!(de < 0.0 || (de == 0.0 && (own & OWN_END_TIE) != 0u))) { return 0.0; }
    }
  }
  var cov = bandCoverage(dist, hw);
  if ((flags & SEG_CAP_MASK) != 0u) {
    // Open polyline ends: separable box filter, band across × overlap along the axis with the stroke's extent. Butt
    // caps end at the point; thin round caps extend by THIN_ROUND_CAP_EXTENSION · hw; thicker round caps keep the
    // radial capsule shape of the band coverage.
    let ab = b - a;
    let len = length(ab);
    let t = select(vec2f(1.0, 0.0), ab / max(len, 1e-6), len > 1e-5);
    let u = dot(px - a, t);
    let thin = hw < THIN_CAP_HALF_WIDTH;
    let startCap = (flags & SEG_BUTT_START) != 0u || (thin && (flags & SEG_ROUND_START) != 0u);
    let endCap = (flags & SEG_BUTT_END) != 0u || (thin && (flags & SEG_ROUND_END) != 0u);
    let nearStart = u < len * 0.5;
    if ((nearStart && startCap) || (!nearStart && endCap) || (startCap && endCap)) {
      let round = THIN_ROUND_CAP_EXTENSION * hw;
      let extS = select(NO_CAP_EXTENT, select(round, 0.0, (flags & SEG_BUTT_START) != 0u), startCap);
      let extE = select(NO_CAP_EXTENT, select(round, 0.0, (flags & SEG_BUTT_END) != 0u), endCap);
      let along = clamp(min(u + 0.5, len + extE) - max(u - 0.5, -extS), 0.0, 1.0);
      let perp = abs(dot(px - a, vec2f(-t.y, t.x)));
      cov = bandCoverage(perp, hw) * along;
    }
  }
  return cov;
}`.$uses({ layout, devOf, segDist, bandCoverage, diskCoverage, THIN_CAP_HALF_WIDTH, THIN_ROUND_CAP_EXTENSION, NO_CAP_EXTENT, WINDOW, ...FLAGS, ...OWN });

const strokeIn = { position: d.builtin.position, ...strokeVaryings };

/** Source-over and screen blending: premultiplied output; transparent where the pixel is not this segment's. */
export const strokeFrag = tgpu.fragmentFn({ in: strokeIn, out: d.vec4f })/* wgsl */ `{
  let c = layout.$.paints[layout.$.segs[in.seg].paint].color;
  let alpha = c.a * layout.$.segs[in.seg].alpha * strokeCoverage(in.position.xy, in.seg, in.a, in.b, in.hw, in.own);
  return vec4f(c.rgb * alpha, alpha);
}`.$uses({ strokeCoverage, layout });

/** mix-blend-mode: multiply (lamp glow dots in light theme): dst · (1 − a + a·src), blend factors (dst, zero). */
export const strokeFragMultiply = tgpu.fragmentFn({ in: strokeIn, out: d.vec4f })/* wgsl */ `{
  let c = layout.$.paints[layout.$.segs[in.seg].paint].color;
  let alpha = c.a * layout.$.segs[in.seg].alpha * strokeCoverage(in.position.xy, in.seg, in.a, in.b, in.hw, in.own);
  return vec4f(vec3f(1.0 - alpha) + c.rgb * alpha, alpha);
}`.$uses({ strokeCoverage, layout });

// ---- halo: silhouette mask → separable gaussian → composite -----------------------------------------------------------
export const haloMaskVert = tgpu.vertexFn({
  in: { pos: d.vec2f, ids: d.vec4u },
  out: { position: d.builtin.position },
})/* wgsl */ `{
  let f = layout.$.frame;
  var out: Out;
  out.position = vec4f(toClip(in.pos * f.toDev.xy + f.toDev.zw), 0.5, 1.0);
  return out;
}`.$uses({ layout, toClip });

export const haloMaskFrag = tgpu.fragmentFn({ in: {}, out: d.vec4f })/* wgsl */ `{ return vec4f(1.0, 1.0, 1.0, 1.0); }`;

export const blurFrag = tgpu.fragmentFn({
  in: { position: d.builtin.position },
  out: d.vec4f,
})/* wgsl */ `{
  let p = blurLayout.$.params;
  let size = vec2i(textureDimensions(blurLayout.$.src));
  let c = vec2i(in.position.xy);
  var sum = 0.0;
  var wsum = 0.0;
  for (var i = -p.radius; i <= p.radius; i++) {
    let q = c + p.dir * i;
    let w = exp(-0.5 * f32(i * i) / (p.sigma * p.sigma));
    var v = 0.0;
    if (all(q >= vec2i(0)) && all(q < size)) { v = textureLoad(blurLayout.$.src, q, 0).r; }
    sum += v * w;
    wsum += w;
  }
  let r = sum / wsum;
  return vec4f(r, r, r, 1.0);
}`.$uses({ blurLayout });

/** A full-target triangle at the halo's depth; the renderer scissors it to the blurred silhouette's box. */
export const haloVert = tgpu.vertexFn({
  in: { vid: d.builtin.vertexIndex },
  out: { position: d.builtin.position },
})/* wgsl */ `{
  var pts = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: Out;
  out.position = vec4f(pts[in.vid], haloLayout.$.params.depth, 1.0);
  return out;
}`.$uses({ haloLayout });

export const haloFrag = tgpu.fragmentFn({
  in: { position: d.builtin.position },
  out: d.vec4f,
})/* wgsl */ `{
  let p = haloLayout.$.params;
  let uv = (in.position.xy - p.shift) / layout.$.frame.viewport;
  let a = textureSampleLevel(haloLayout.$.tex, haloLayout.$.samp, uv, 0.0).r * p.color.a;
  return vec4f(p.color.rgb * a, a);
}`.$uses({ haloLayout, layout });

// ---- group opacity: layers rendered into an atlas, composited at the group's depth ----------------------------------
export const compositeVert = tgpu.vertexFn({
  in: { vid: d.builtin.vertexIndex, iid: d.builtin.instanceIndex },
  out: { position: d.builtin.position, group: d.interpolate('flat', d.u32) },
})/* wgsl */ `{
  var corners = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  let g = compositeLayout.$.groups[in.iid];
  let dev = vec2f(g.canvasOrigin) + corners[in.vid] * vec2f(g.size);
  var out: Out;
  out.position = vec4f(toClip(dev), g.depth, 1.0);
  out.group = in.iid;
  return out;
}`.$uses({ compositeLayout, toClip });

/** The atlas holds the group's premultiplied colour; scaling it by the group alpha is SVG group opacity. */
export const compositeFrag = tgpu.fragmentFn({
  in: { position: d.builtin.position, group: d.interpolate('flat', d.u32) },
  out: d.vec4f,
})/* wgsl */ `{
  let g = compositeLayout.$.groups[in.group];
  let q = vec2i(in.position.xy) - g.canvasOrigin + g.atlasOrigin;
  return textureLoad(compositeLayout.$.atlas, q, 0) * g.alpha;
}`.$uses({ compositeLayout });

// ---- debug overlay (?cache=overlay) ---------------------------------------------------------------------------------
const OUTLINE_PX = f32Const(1.5);
const FILL_TINT = f32Const(0.12);

export const debugRectVert = tgpu.vertexFn({
  in: { vid: d.builtin.vertexIndex, iid: d.builtin.instanceIndex },
  out: { position: d.builtin.position, rect: d.interpolate('flat', d.u32) },
})/* wgsl */ `{
  var corners = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  let r = debugLayout.$.rects[in.iid];
  let dev = mix(r.min, r.max, corners[in.vid]);
  let vp = debugLayout.$.frame.viewport;
  var out: Out;
  out.position = vec4f(dev.x / vp.x * 2.0 - 1.0, 1.0 - dev.y / vp.y * 2.0, 0.0, 1.0);
  out.rect = in.iid;
  return out;
}`.$uses({ debugLayout });

export const debugRectFrag = tgpu.fragmentFn({
  in: { position: d.builtin.position, rect: d.interpolate('flat', d.u32) },
  out: d.vec4f,
})/* wgsl */ `{
  let r = debugLayout.$.rects[in.rect];
  let p = in.position.xy;
  let edge = min(min(p.x - r.min.x, r.max.x - p.x), min(p.y - r.min.y, r.max.y - p.y));
  let a = select(r.color.a * FILL_TINT, r.color.a, edge < OUTLINE_PX);
  return vec4f(r.color.rgb * a, a);
}`.$uses({ debugLayout, OUTLINE_PX, FILL_TINT });

// ---- static cache ---------------------------------------------------------------------------------------------------
/** Every sample of a pixel outside the redraw region gets the cached resolved colour (its resolve gives it back exactly). */
export const cachedFrameFrag = tgpu.fragmentFn({
  in: { position: d.builtin.position },
  out: d.vec4f,
})/* wgsl */ `{
  return textureLoad(cacheLayout.$.frame, vec2i(in.position.xy), 0);
}`.$uses({ cacheLayout });
