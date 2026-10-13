// TypeGPU schemas, layouts and WGSL-string shader functions. No build plugin: every body is WGSL, and resources are
// reached through `layout.$.<name>` after `.$uses({ layout })`.
import tgpu, { warn } from 'typegpu';
import * as d from 'typegpu/data';

// WGSL-string entry functions that read their struct input (`in.vb`) make TypeGPU's external replacer look `in.vb` up
// in its argument-externals map, miss, and warn — the code it emits is correct. Silence only that kind.
warn.disable('external-omitted');

// ---- schemas (byte layout is mirrored by the packers in renderer.ts; asserted at startup) -------------------------
export const Frame = d.struct({
  toDev: d.vec4f, // device px = viewBox · toDev.xy + toDev.zw
  viewport: d.vec2f, // canvas size in device px
  dpr: d.f32, // device px per CSS px (non-scaling strokes)
  total: d.f32, // depth denominator: total primitive slots + 2
});
export const Item = d.struct({ offset: d.vec2f, base: d.u32, pad: d.u32 });
export const Paint = d.struct({ color: d.vec4f, width: d.f32, kind: d.u32, grad: d.u32, pad: d.u32 });
export const Gradient = d.struct({ p0: d.vec2f, p1: d.vec2f, first: d.u32, count: d.u32, pad0: d.u32, pad1: d.u32 });
export const Stop = d.struct({ color: d.vec4f, offset: d.f32, pad0: d.f32, pad1: d.f32, pad2: d.f32 });
export const Seg = d.struct({
  p0: d.vec2f,
  p1: d.vec2f,
  width: d.f32, // CSS px (0 → paint width); dots: radius in viewBox units
  item: d.u32,
  paint: d.u32,
  layer: d.u32,
  alpha: d.f32,
  flags: d.u32, // 1 dot, 2 closed polyline, 4/8 butt cap at p0/p1, 16/32 round cap at p0/p1 (open ends)
  polyStart: d.u32,
  polyEnd: d.u32,
});
export const FillVertex = d.struct({ pos: d.vec2f, ids: d.vec2u }); // ids.x = item | paint << 16, ids.y = layer
export const Blur = d.struct({ dir: d.vec2i, sigma: d.f32, radius: d.i32 });
export const HaloParams = d.struct({ color: d.vec4f, shift: d.vec2f, depth: d.f32, pad: d.f32 });

export const SEG_DOT = 1;
export const SEG_CLOSED = 2;
export const SEG_BUTT_START = 4;
export const SEG_BUTT_END = 8;
export const SEG_ROUND_START = 16;
export const SEG_ROUND_END = 32;

// ---- layouts -------------------------------------------------------------------------------------------------------
export const fillLayout = tgpu.vertexLayout(d.arrayOf(FillVertex), 'vertex');

export const layout = tgpu.bindGroupLayout({
  frame: { uniform: Frame },
  items: { storage: d.arrayOf(Item), access: 'readonly' },
  paints: { storage: d.arrayOf(Paint), access: 'readonly' },
  grads: { storage: d.arrayOf(Gradient), access: 'readonly' },
  stops: { storage: d.arrayOf(Stop), access: 'readonly' },
  segs: { storage: d.arrayOf(Seg), access: 'readonly' },
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

// ---- helpers ---------------------------------------------------------------------------------------------------------
const toClip = tgpu.fn([d.vec2f], d.vec2f)/* wgsl */ `(dev: vec2f) -> vec2f {
  let vp = layout.$.frame.viewport;
  return vec2f(dev.x / vp.x * 2.0 - 1.0, 1.0 - dev.y / vp.y * 2.0);
}`.$uses({ layout });

const depthOf = tgpu.fn([d.u32], d.f32)/* wgsl */ `(seq: u32) -> f32 {
  return 1.0 - (f32(seq) + 1.0) / layout.$.frame.total;
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
 * Stroke coverage: box filter of a band of half-width hw at distance d from the pixel centre, in device px.
 * Integrated ink across the line equals the width also below 1 px (Skia "modulate by width" hairlines).
 */
const bandCoverage = tgpu.fn([d.f32, d.f32], d.f32)/* wgsl */ `(dist: f32, hw: f32) -> f32 {
  return max(min(dist + hw, 0.5) - max(dist - hw, -0.5), 0.0);
}`;

/**
 * Disk coverage as a distance ramp at the pixel centre, clamp(r + ½ − d): this is what Chrome's raster does for the
 * kit's tiny bolt dots (r ≈ 0.36–0.5 viewBox units) — measured on the calibration sheet it lays ~1.6× the exact
 * area at DPR 1 and ~1.1× at DPR 2; exact (supersampled) area coverage came out 40 % / 10 % too light.
 */
const diskCoverage = tgpu.fn([d.vec2f, d.vec2f, d.f32], d.f32)/* wgsl */ `(p: vec2f, c: vec2f, r: f32) -> f32 {
  return clamp(r + 0.5 - length(p - c), 0.0, 1.0);
}`;

const paintColor = tgpu.fn([d.u32, d.vec2f], d.vec4f)/* wgsl */ `(paint: u32, vb: vec2f) -> vec4f {
  let p = layout.$.paints[paint];
  if (p.kind == 1u) {
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
}`.$uses({ layout });

// ---- fills -------------------------------------------------------------------------------------------------------------
export const fillVert = tgpu.vertexFn({
  in: { pos: d.vec2f, ids: d.vec2u },
  out: { position: d.builtin.position, vb: d.vec2f, paint: d.interpolate('flat', d.u32) },
})/* wgsl */ `{
  let item = in.ids.x & 0xffffu;
  let dev = devOf(in.pos, item);
  var out: Out;
  out.position = vec4f(toClip(dev), depthOf(layout.$.items[item].base + in.ids.y), 1.0);
  out.vb = in.pos;
  out.paint = in.ids.x >> 16u;
  return out;
}`.$uses({ layout, devOf, toClip, depthOf });

export const fillFragOpaque = tgpu.fragmentFn({
  in: { vb: d.vec2f, paint: d.interpolate('flat', d.u32) },
  out: d.vec4f,
})/* wgsl */ `{
  let c = paintColor(in.paint, in.vb);
  return vec4f(c.rgb, 1.0);
}`.$uses({ paintColor });

export const fillFragOver = tgpu.fragmentFn({
  in: { vb: d.vec2f, paint: d.interpolate('flat', d.u32) },
  out: d.vec4f,
})/* wgsl */ `{
  let c = paintColor(in.paint, in.vb);
  return vec4f(c.rgb * c.a, c.a);
}`.$uses({ paintColor });

/** mix-blend-mode: multiply → dst · (1 − a + a·src); blend factors (dst, zero). */
export const fillFragMultiply = tgpu.fragmentFn({
  in: { vb: d.vec2f, paint: d.interpolate('flat', d.u32) },
  out: d.vec4f,
})/* wgsl */ `{
  let c = paintColor(in.paint, in.vb);
  return vec4f(vec3f(1.0 - c.a) + c.rgb * c.a, c.a);
}`.$uses({ paintColor });

/** mix-blend-mode: screen → dst + a·src·(1 − dst); blend factors (one-minus-dst, one). */
export const fillFragScreen = fillFragOver;

// ---- strokes and dots ---------------------------------------------------------------------------------------------
export const strokeVert = tgpu.vertexFn({
  in: { vid: d.builtin.vertexIndex, iid: d.builtin.instanceIndex },
  out: {
    position: d.builtin.position,
    seg: d.interpolate('flat', d.u32),
    a: d.interpolate('flat', d.vec2f),
    b: d.interpolate('flat', d.vec2f),
    hw: d.interpolate('flat', d.f32),
  },
})/* wgsl */ `{
  var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let index = layout.$.order[in.iid];
  let s = layout.$.segs[index];
  let f = layout.$.frame;
  let a = devOf(s.p0, s.item);
  let b = devOf(s.p1, s.item);
  var hw: f32;
  if ((s.flags & 1u) != 0u) {
    hw = s.width * f.toDev.x;
  } else {
    hw = select(layout.$.paints[s.paint].width, s.width, s.width > 0.0) * f.dpr * 0.5;
  }
  let e = hw + 1.0;
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
  return out;
}`.$uses({ layout, devOf, toClip, depthOf });

/**
 * Premultiplied stroke / dot colour at device pixel `px`; alpha ≤ 0 means "draw nothing here" (another segment of
 * the polyline owns the pixel, or no coverage) and the entry points discard.
 */
const strokeShade = tgpu.fn([d.vec2f, d.u32, d.vec2f, d.vec2f, d.f32], d.vec4f)/* wgsl */ `(px: vec2f, seg: u32, a: vec2f, b: vec2f, hw: f32) -> vec4f {
  let s = layout.$.segs[seg];
  var cov: f32;
  if ((s.flags & 1u) != 0u) {
    cov = diskCoverage(px, a, hw);
  } else {
    let dist = segDist(px, a, b);
    // Nearest-segment ownership inside the polyline: each pixel is blended once per path (no double blend at joins).
    let n = i32(s.polyEnd - s.polyStart);
    let local = i32(seg - s.polyStart);
    let closed = (s.flags & 2u) != 0u;
    for (var k = -3; k <= 3; k++) {
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
      if (od < dist || (od == dist && other < seg)) { return vec4f(0.0); }
    }
    cov = bandCoverage(dist, hw);
    if ((s.flags & 60u) != 0u) {
      // Open polyline ends: separable box filter — band across × overlap along the axis with the stroke's extent.
      // Butt caps end at the point; thin round caps get an extension of 0.6·hw, fitted on the calibration sheet's
      // short ticks (the radial band formula over-inked them +20 % at 0.6 px and +100 % at 0.4 px @DPR1; the
      // area-equivalent π/4·hw still left +6–12 % at DPR 2–3).
      let ab = b - a;
      let len = length(ab);
      let t = select(vec2f(1.0, 0.0), ab / max(len, 1e-6), len > 1e-5);
      let u = dot(px - a, t);
      // Round caps of strokes ≥ 1.5 device px keep the true (radial) capsule shape.
      let thin = hw < 0.75;
      let startCap = (s.flags & 4u) != 0u || (thin && (s.flags & 16u) != 0u);
      let endCap = (s.flags & 8u) != 0u || (thin && (s.flags & 32u) != 0u);
      let nearStart = u < len * 0.5;
      if ((nearStart && startCap) || (!nearStart && endCap) || (startCap && endCap)) {
        let round = 0.6 * hw;
        let extS = select(1e4, select(round, 0.0, (s.flags & 4u) != 0u), startCap);
        let extE = select(1e4, select(round, 0.0, (s.flags & 8u) != 0u), endCap);
        let along = clamp(min(u + 0.5, len + extE) - max(u - 0.5, -extS), 0.0, 1.0);
        let perp = abs(dot(px - a, vec2f(-t.y, t.x)));
        cov = bandCoverage(perp, hw) * along;
      }
    }
  }
  let c = layout.$.paints[s.paint].color;
  let alpha = c.a * s.alpha * cov;
  return vec4f(c.rgb * alpha, alpha);
}`.$uses({ layout, devOf, segDist, bandCoverage, diskCoverage });

const strokeIn = {
  position: d.builtin.position,
  seg: d.interpolate('flat', d.u32),
  a: d.interpolate('flat', d.vec2f),
  b: d.interpolate('flat', d.vec2f),
  hw: d.interpolate('flat', d.f32),
};

/** Normal (source-over) and screen blending: premultiplied output. */
export const strokeFrag = tgpu.fragmentFn({ in: strokeIn, out: d.vec4f })/* wgsl */ `{
  let c = strokeShade(in.position.xy, in.seg, in.a, in.b, in.hw);
  if (c.a <= 0.0) { discard; }
  return c;
}`.$uses({ strokeShade });

/** mix-blend-mode: multiply (lamp glow dots in light theme): dst · (1 − a + a·src), blend factors (dst, zero). */
export const strokeFragMultiply = tgpu.fragmentFn({ in: strokeIn, out: d.vec4f })/* wgsl */ `{
  let c = strokeShade(in.position.xy, in.seg, in.a, in.b, in.hw);
  if (c.a <= 0.0) { discard; }
  return vec4f(vec3f(1.0 - c.a) + c.rgb, c.a);
}`.$uses({ strokeShade });

// ---- halo: silhouette mask → separable gaussian → composite -----------------------------------------------------------
export const haloMaskVert = tgpu.vertexFn({
  in: { pos: d.vec2f, ids: d.vec2u },
  out: { position: d.builtin.position },
})/* wgsl */ `{
  let f = layout.$.frame;
  var out: Out;
  out.position = vec4f(toClip(in.pos * f.toDev.xy + f.toDev.zw), 0.5, 1.0);
  return out;
}`.$uses({ layout, toClip });

export const haloMaskFrag = tgpu.fragmentFn({ in: {}, out: d.vec4f })/* wgsl */ `{ return vec4f(1.0, 1.0, 1.0, 1.0); }`;

export const fullscreenVert = tgpu.vertexFn({
  in: { vid: d.builtin.vertexIndex },
  out: { position: d.builtin.position },
})/* wgsl */ `{
  var pts = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: Out;
  out.position = vec4f(pts[in.vid], 0.0, 1.0);
  return out;
}`;

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
  let m = textureSampleLevel(haloLayout.$.tex, haloLayout.$.samp, uv, 0.0).r;
  let a = m * p.color.a;
  if (a <= 0.0) { discard; }
  return vec4f(p.color.rgb * a, a);
}`.$uses({ haloLayout, layout });

// ---- group opacity: an offscreen layer composited at the group's depth ------------------------------------------------
export const GroupParams = d.struct({ origin: d.vec2i, depth: d.f32, alpha: d.f32 });

export const compositeLayout = tgpu.bindGroupLayout({
  layer: { texture: d.texture2d(d.f32) },
  groups: { storage: d.arrayOf(GroupParams), access: 'readonly' },
});

export const compositeVert = tgpu.vertexFn({
  in: { vid: d.builtin.vertexIndex, iid: d.builtin.instanceIndex },
  out: { position: d.builtin.position, group: d.interpolate('flat', d.u32) },
})/* wgsl */ `{
  var pts = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: Out;
  out.position = vec4f(pts[in.vid], compositeLayout.$.groups[in.iid].depth, 1.0);
  out.group = in.iid;
  return out;
}`.$uses({ compositeLayout });

/** The layer holds the group's premultiplied colour; scaling it by the group alpha is SVG group opacity. */
export const compositeFrag = tgpu.fragmentFn({
  in: { position: d.builtin.position, group: d.interpolate('flat', d.u32) },
  out: d.vec4f,
})/* wgsl */ `{
  let g = compositeLayout.$.groups[in.group];
  let q = vec2i(in.position.xy) - g.origin;
  let size = vec2i(textureDimensions(compositeLayout.$.layer));
  if (any(q < vec2i(0)) || any(q >= size)) { discard; }
  let c = textureLoad(compositeLayout.$.layer, q, 0) * g.alpha;
  if (c.a <= 0.0) { discard; }
  return c;
}`.$uses({ compositeLayout });
