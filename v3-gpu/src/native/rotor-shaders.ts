// The native rotor's compute pass: one workgroup per part expands a RotorPart into
// - Seg records (src/core/schemas.ts) for the existing stroke pipeline, with exactly the semantics of
//   SegWriter.polyline (src/core/strokes.ts): round caps, join bisectors, `crowd` incl. pinch points, polyline index
//   ranges — so stroke coverage and ownership are the static scene's and the markup path's;
// - FillVertex records (as array<u32>: pos.x, pos.y, item | paint << 16, layer | alpha16 << 16) for the existing
//   opaque fill pipeline.
// Which faces are drawn and their tones come from the part's class record (facing / seam / shade bits: the kit's own
// decisions, made on the CPU, any ring size); the GPU only builds geometry. The top face is the template's own CPU
// triangulation (prism-templates.ts).
//
// Stroke slots of a part with an n-point ring, in v2's document order (kit solidSvg / extrude / ringSeam):
//   CREASE    n  top edge i of facing faces                       (paths.crease, runs of facing)
//   BEVEL     n  bevel line over facing faces, inset at run interiors (paths.bevel)
//   BACK      n  top edge i of faces turned away                  (paths.outline, runs of non-facing, top)
//   FRONT     n  bottom edge i of facing faces                    (paths.outline, runs of facing, bottom)
//   VERTICAL  n  top i → bottom i where facing changes at i       (paths.outline, verticals)
//   BAND      n  seam edge i at bandZ                             (ringSeam runs)
//   STRAP     1  the strap over the top                           (onTop([c − s·r, c + s·r], z0 + height))
// Run-based blocks walk the ring from the first index where the block's mask changes (kit runsOf; the CPU sends that
// index as facingRun / seamRun), so every run is a
// contiguous slot range: a polyline [polyStart, polyEnd) the stroke shader's ownership loop can walk. Undrawn slots are
// zero-alpha records far off-canvas.
import tgpu from 'typegpu';
import * as d from 'typegpu/data';
import { FILL_ALPHA_SCALE, SEG, Seg } from '../core/schemas.ts';
import { CHAIN_TOLERANCE, CROWD_NONE, OWNERSHIP_WINDOW } from '../core/strokes.ts';
import { PART_FLAG, PART_LAYER, RotorPart, RotorProjection, RotorStyle } from './rotor-schemas.ts';

export const WORKGROUP_SIZE = 64;

export const rotorLayout = tgpu.bindGroupLayout({
  projection: { uniform: RotorProjection },
  parts: { storage: d.arrayOf(RotorPart), access: 'readonly' },
  ring: { storage: d.arrayOf(d.vec2f), access: 'readonly' },
  styles: { storage: d.arrayOf(RotorStyle), access: 'readonly' },
  classes: { storage: d.arrayOf(d.u32), access: 'readonly' },
  triangles: { storage: d.arrayOf(d.u32), access: 'readonly' },
  segs: { storage: d.arrayOf(Seg), access: 'mutable' },
  fills: { storage: d.arrayOf(d.u32), access: 'mutable' },
});

const u32Const = (value: number) => tgpu.const(d.u32, value);
const f32Const = (value: number) => tgpu.const(d.f32, value);
const CONSTS = {
  CREASE: u32Const(0),
  BEVEL: u32Const(1),
  BACK: u32Const(2),
  FRONT: u32Const(3),
  VERTICAL: u32Const(4),
  BAND: u32Const(5),
  STRAP: u32Const(6),
  FLAG_COUNTER: u32Const(PART_FLAG.counter),
  FLAG_BAND: u32Const(PART_FLAG.band),
  LAYER_SHADE: u32Const(PART_LAYER.shade),
  LAYER_TOP: u32Const(PART_LAYER.top),
  LAYER_CREASE: u32Const(PART_LAYER.crease),
  LAYER_BEVEL: u32Const(PART_LAYER.bevel),
  LAYER_EDGE: u32Const(PART_LAYER.edge),
  LAYER_LINE: u32Const(PART_LAYER.line),
  SEG_ROUND_START: u32Const(SEG.roundStart),
  SEG_ROUND_END: u32Const(SEG.roundEnd),
  SEG_JOIN_START: u32Const(SEG.joinStart),
  SEG_JOIN_END: u32Const(SEG.joinEnd),
  CROWD_NONE_VALUE: f32Const(CROWD_NONE),
  /** strokes.ts DIRECTION_EPSILON / HAIRPIN_EPSILON / PARALLEL_EPSILON (private there), CHAIN_TOLERANCE. */
  DIRECTION_EPS: f32Const(1e-12),
  HAIRPIN_EPS: f32Const(1e-6),
  PARALLEL_EPS: f32Const(1e-9),
  CHAIN_TOL: f32Const(CHAIN_TOLERANCE),
  WINDOW: u32Const(OWNERSHIP_WINDOW),
  OPAQUE_ALPHA16: u32Const(FILL_ALPHA_SCALE),
  /** Where undrawn slots go: far outside any canvas, so their quads are clipped before rasterization. */
  OFF_CANVAS: f32Const(-1e6),
  WG: u32Const(WORKGROUP_SIZE),
  RotorPart,
};

const ringPoint = tgpu.fn([RotorPart, d.u32], d.vec2f)/* wgsl */ `(p: RotorPart, i: u32) -> vec2f {
  let t = rotorLayout.$.ring[p.ringFirst + i % p.ringCount];
  return p.centre + vec2f(t.x * p.rotation.x - t.y * p.rotation.y, t.x * p.rotation.y + t.y * p.rotation.x);
}`.$uses({ rotorLayout, RotorPart });

const project = tgpu.fn([d.vec2f, d.f32], d.vec2f)/* wgsl */ `(w: vec2f, z: f32) -> vec2f {
  let q = rotorLayout.$.projection;
  return q.origin + w.x * q.xAxis + w.y * q.yAxis + vec2f(0.0, z * q.zAxis);
}`.$uses({ rotorLayout });

/** Bit `i mod n` of the mask that starts `at` words into the part's class record. */
const classBit = tgpu.fn([RotorPart, d.u32, d.u32], d.bool)/* wgsl */ `(p: RotorPart, at: u32, i: u32) -> bool {
  let j = i % p.ringCount;
  return ((rotorLayout.$.classes[p.classFirst + at + j / 32u] >> (j % 32u)) & 1u) != 0u;
}`.$uses({ rotorLayout, RotorPart });

/** Face i (mod n) faces the viewer (kit extrude). */
const facingAt = tgpu.fn([RotorPart, d.u32], d.bool)/* wgsl */ `(p: RotorPart, i: u32) -> bool {
  return classBit(p, 0u, i);
}`.$uses({ classBit, RotorPart });

/** The seam runs along edge i (mod n) (kit ringSeam). */
const seamAt = tgpu.fn([RotorPart, d.u32], d.bool)/* wgsl */ `(p: RotorPart, i: u32) -> bool {
  return classBit(p, (p.ringCount + 31u) / 32u, i);
}`.$uses({ classBit, RotorPart });

/** Tone index of face i (kit extrude). */
const shadeAt = tgpu.fn([RotorPart, d.u32], d.u32)/* wgsl */ `(p: RotorPart, i: u32) -> u32 {
  let j = i % p.ringCount;
  let at = p.classFirst + 2u * ((p.ringCount + 31u) / 32u) + j / 16u;
  return (rotorLayout.$.classes[at] >> (2u * (j % 16u))) & 3u;
}`.$uses({ rotorLayout, RotorPart });

/** kit extrude: outward unit normal of edge i (length 0 → divided by 1). */
const edgeNormal = tgpu.fn([RotorPart, d.u32], d.vec2f)/* wgsl */ `(p: RotorPart, i: u32) -> vec2f {
  let e = ringPoint(p, i + 1u) - ringPoint(p, i);
  let l = length(e);
  let len = select(l, 1.0, l == 0.0);
  return select(vec2f(-e.y, e.x), vec2f(e.y, -e.x), (p.flags & FLAG_COUNTER) != 0u) / len;
}`.$uses({ ringPoint, ...CONSTS });

const topPoint = tgpu.fn([RotorPart, d.u32], d.vec2f)/* wgsl */ `(p: RotorPart, i: u32) -> vec2f {
  return project(ringPoint(p, i), p.z0 + p.height);
}`.$uses({ project, ringPoint, RotorPart });

const bottomPoint = tgpu.fn([RotorPart, d.u32], d.vec2f)/* wgsl */ `(p: RotorPart, i: u32) -> vec2f {
  return project(ringPoint(p, i), p.z0);
}`.$uses({ project, ringPoint, RotorPart });

/** kit extrude bevel: run ends stay on the top ring, interior points move inward along the corner bisector. */
const bevelPoint = tgpu.fn([RotorPart, d.u32], d.vec2f)/* wgsl */ `(p: RotorPart, i: u32) -> vec2f {
  let n = p.ringCount;
  if (!(facingAt(p, i + n - 1u) && facingAt(p, i))) { return topPoint(p, i); }
  let m = edgeNormal(p, i + n - 1u) + edgeNormal(p, i);
  let l = length(m);
  let len = select(l, 1.0, l == 0.0);
  return project(ringPoint(p, i) - m / len * p.bevel, p.z0 + p.height);
}`.$uses({ facingAt, topPoint, edgeNormal, ringPoint, project, RotorPart });

/** Whether slot k of a block draws anything. */
const slotDrawn = tgpu.fn([RotorPart, d.u32, d.u32], d.bool)/* wgsl */ `(p: RotorPart, block: u32, k: u32) -> bool {
  let n = p.ringCount;
  if (block == STRAP) { return p.strap > 0.0; }
  if (block == VERTICAL) { return p.height > 0.0 && facingAt(p, k + n - 1u) != facingAt(p, k); }
  if (block == BAND) { return (p.flags & FLAG_BAND) != 0u && seamAt(p, p.seamRun + k); }
  let facing = facingAt(p, p.facingRun + k);
  if (block == CREASE) { return facing; }
  if (block == BEVEL) { return p.bevel > 0.0 && facing; }
  if (block == BACK) { return !facing; }
  return p.height > 0.0 && facing;
}`.$uses({ facingAt, seamAt, ...CONSTS });

/** End points (viewBox units) of slot k of a block: xy = start, zw = end. */
const slotEnds = tgpu.fn([RotorPart, d.u32, d.u32], d.vec4f)/* wgsl */ `(p: RotorPart, block: u32, k: u32) -> vec4f {
  let n = p.ringCount;
  if (block == STRAP) {
    let along = vec2f(p.rotation.x, p.rotation.y) * p.strap;
    let z = p.z0 + p.height;
    return vec4f(project(p.centre - along, z), project(p.centre + along, z));
  }
  if (block == VERTICAL) { return vec4f(topPoint(p, k), bottomPoint(p, k)); }
  if (block == BAND) {
    let e = p.seamRun + k;
    return vec4f(project(ringPoint(p, e), p.bandZ), project(ringPoint(p, e + 1u), p.bandZ));
  }
  let e = p.facingRun + k;
  if (block == BEVEL) { return vec4f(bevelPoint(p, e % n), bevelPoint(p, (e + 1u) % n)); }
  if (block == FRONT) { return vec4f(bottomPoint(p, e), bottomPoint(p, e + 1u)); }
  return vec4f(topPoint(p, e), topPoint(p, e + 1u));
}`.$uses({ project, topPoint, bottomPoint, bevelPoint, ringPoint, ...CONSTS });

const direction = tgpu.fn([d.vec4f], d.vec2f)/* wgsl */ `(s: vec4f) -> vec2f {
  let u = s.zw - s.xy;
  let l = length(u);
  return select(vec2f(0.0), u / l, l > DIRECTION_EPS);
}`.$uses(CONSTS);

const pointSegmentDistance = tgpu.fn([d.vec2f, d.vec2f, d.vec2f], d.f32)/* wgsl */ `(q: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let l2 = dot(ab, ab);
  let t = select(0.0, clamp(dot(q - a, ab) / l2, 0.0, 1.0), l2 > 0.0);
  return length(q - (a + ab * t));
}`;

/** strokes.ts joinPolyline, one join (segments s → t): 0 for a hairpin, the far-end distance for a sharp turn. */
const joinCrowd = tgpu.fn([d.vec4f, d.vec4f], d.f32)/* wgsl */ `(s: vec4f, t: vec4f) -> f32 {
  let m = direction(s) + direction(t);
  if (dot(m, m) < HAIRPIN_EPS) { return 0.0; }
  if (dot(s.zw - s.xy, t.zw - t.xy) < 0.0) {
    return min(pointSegmentDistance(s.xy, t.xy, t.zw), pointSegmentDistance(t.zw, s.xy, s.zw));
  }
  return CROWD_NONE_VALUE;
}`.$uses({ direction, pointSegmentDistance, ...CONSTS });

/** strokes.ts joinPolyline, pinch point: where segment s's two join lines meet, as a distance from s. */
const pinchCrowd = tgpu.fn([d.vec4f, d.vec4f, d.vec4f], d.f32)/* wgsl */ `(prev: vec4f, s: vec4f, next: vec4f) -> f32 {
  let m = direction(prev) + direction(s);
  let k = direction(s) + direction(next);
  let det = m.x * k.y - m.y * k.x;
  if (abs(det) < PARALLEL_EPS * length(m) * length(k)) { return CROWD_NONE_VALUE; }
  let c1 = dot(m, s.xy);
  let c2 = dot(k, s.zw);
  let pinch = vec2f((c1 * k.y - m.y * c2) / det, (m.x * c2 - c1 * k.x) / det);
  return pointSegmentDistance(pinch, s.xy, s.zw);
}`.$uses({ direction, pointSegmentDistance, ...CONSTS });

/** Distance between segments a and b (xy → zw); 0 when they cross (strokes.ts segmentDistance). */
const segmentDistance = tgpu.fn([d.vec4f, d.vec4f], d.f32)/* wgsl */ `(a: vec4f, b: vec4f) -> f32 {
  let r = a.zw - a.xy;
  let s = b.zw - b.xy;
  let den = r.x * s.y - r.y * s.x;
  if (den != 0.0) {
    let q = b.xy - a.xy;
    let t = (q.x * s.y - q.y * s.x) / den;
    let w = (q.x * r.y - q.y * r.x) / den;
    if (t >= 0.0 && t <= 1.0 && w >= 0.0 && w <= 1.0) { return 0.0; }
  }
  return min(min(pointSegmentDistance(a.xy, b.xy, b.zw), pointSegmentDistance(a.zw, b.xy, b.zw)), min(pointSegmentDistance(b.xy, a.xy, a.zw), pointSegmentDistance(b.zw, a.xy, a.zw)));
}`.$uses({ pointSegmentDistance });

/**
 * strokes.ts joinPolyline, ownership-window pair: segment `early` and the later segment `late` (2…WINDOW apart in one
 * polyline) when they come closer than the chain between them: their distance, else none.
 */
const windowCrowd = tgpu.fn([d.vec4f, d.vec4f], d.f32)/* wgsl */ `(early: vec4f, late: vec4f) -> f32 {
  let gap = segmentDistance(early, late);
  let chain = length(late.xy - early.zw);
  return select(CROWD_NONE_VALUE, gap, gap < chain * (1.0 - CHAIN_TOL));
}`.$uses({ segmentDistance, ...CONSTS });

/** Writes Seg slot `slot` of part `p`. */
const writeSeg = tgpu.fn([RotorPart, d.u32])/* wgsl */ `(p: RotorPart, slot: u32) {
  let n = p.ringCount;
  let block = min(slot / n, STRAP);
  let k = slot - block * n;
  let index = p.segFirst + slot;
  let style = rotorLayout.$.styles[p.style];
  var paint = style.edge;
  var width = style.edgeWidth;
  var layer = LAYER_EDGE;
  if (block == CREASE) { paint = style.crease; width = style.creaseWidth; layer = LAYER_CREASE; }
  if (block == BEVEL) { paint = style.bevel; width = style.bevelWidth; layer = LAYER_BEVEL; }
  if (block == BAND || block == STRAP) { paint = style.line; width = style.lineWidth; layer = LAYER_LINE; }
  rotorLayout.$.segs[index].item = p.item;
  rotorLayout.$.segs[index].paint = paint;
  rotorLayout.$.segs[index].layer = p.layer + layer;
  rotorLayout.$.segs[index].width = width;
  if (!slotDrawn(p, block, k)) {
    rotorLayout.$.segs[index].p0 = vec2f(OFF_CANVAS);
    rotorLayout.$.segs[index].p1 = vec2f(OFF_CANVAS);
    rotorLayout.$.segs[index].joinStart = vec2f(0.0);
    rotorLayout.$.segs[index].joinEnd = vec2f(0.0);
    rotorLayout.$.segs[index].alpha = 0.0;
    rotorLayout.$.segs[index].flags = 0u;
    rotorLayout.$.segs[index].polyStart = index;
    rotorLayout.$.segs[index].polyEnd = index + 1u;
    rotorLayout.$.segs[index].crowd = CROWD_NONE_VALUE;
    return;
  }
  // the run: verticals and the strap are polylines of one segment; other blocks extend while their slots draw
  var first = k;
  var last = k;
  if (block != VERTICAL && block != STRAP) {
    while (first > 0u && slotDrawn(p, block, first - 1u)) { first--; }
    while (last + 1u < n && slotDrawn(p, block, last + 1u)) { last++; }
  }
  let s = slotEnds(p, block, k);
  var flags = 0u;
  var joinStart = vec2f(0.0);
  var joinEnd = vec2f(0.0);
  var crowd = CROWD_NONE_VALUE;
  if (k == first) { flags |= SEG_ROUND_START; }
  if (k == last) { flags |= SEG_ROUND_END; }
  if (k > first) {
    let before = slotEnds(p, block, k - 1u);
    flags |= SEG_JOIN_START;
    joinStart = direction(before) + direction(s);
    crowd = min(crowd, joinCrowd(before, s));
    if (k - 1u > first) { crowd = min(crowd, pinchCrowd(slotEnds(p, block, k - 2u), before, s)); }
  }
  if (k < last) {
    let after = slotEnds(p, block, k + 1u);
    flags |= SEG_JOIN_END;
    joinEnd = direction(s) + direction(after);
    crowd = min(crowd, joinCrowd(s, after));
    if (k + 1u < last) { crowd = min(crowd, pinchCrowd(s, after, slotEnds(p, block, k + 2u))); }
    if (k > first) { crowd = min(crowd, pinchCrowd(slotEnds(p, block, k - 1u), s, after)); }
  }
  // the ownership window's non-adjacent neighbours (k ± 2 … k ± WINDOW) inside the run
  for (var apart = 2u; apart <= WINDOW; apart++) {
    if (k >= first + apart) { crowd = min(crowd, windowCrowd(slotEnds(p, block, k - apart), s)); }
    if (k + apart <= last) { crowd = min(crowd, windowCrowd(s, slotEnds(p, block, k + apart))); }
  }
  rotorLayout.$.segs[index].p0 = s.xy;
  rotorLayout.$.segs[index].p1 = s.zw;
  rotorLayout.$.segs[index].joinStart = joinStart;
  rotorLayout.$.segs[index].joinEnd = joinEnd;
  rotorLayout.$.segs[index].alpha = 1.0;
  rotorLayout.$.segs[index].flags = flags;
  rotorLayout.$.segs[index].polyStart = p.segFirst + block * n + first;
  rotorLayout.$.segs[index].polyEnd = p.segFirst + block * n + last + 1u;
  rotorLayout.$.segs[index].crowd = crowd;
}`.$uses({ rotorLayout, slotDrawn, slotEnds, direction, joinCrowd, pinchCrowd, windowCrowd, ...CONSTS });

const writeVertex = tgpu.fn([d.u32, d.vec2f, d.u32, d.u32, d.u32])/* wgsl */ `(vertex: u32, at: vec2f, item: u32, paint: u32, layer: u32) {
  let o = vertex * 4u;
  rotorLayout.$.fills[o] = bitcast<u32>(at.x);
  rotorLayout.$.fills[o + 1u] = bitcast<u32>(at.y);
  rotorLayout.$.fills[o + 2u] = item | (paint << 16u);
  rotorLayout.$.fills[o + 3u] = layer | (OPAQUE_ALPHA16 << 16u);
}`.$uses({ rotorLayout, ...CONSTS });

/** Writes fill triangle `t` of part `p`: the top face (the template's triangles) first, then two per side face. */
const writeTriangle = tgpu.fn([RotorPart, d.u32])/* wgsl */ `(p: RotorPart, t: u32) {
  let n = p.ringCount;
  let style = rotorLayout.$.styles[p.style];
  let v = p.vertexFirst + t * 3u;
  if (t < p.triangleCount) {
    let layer = p.layer + LAYER_TOP;
    let corner = p.triangleFirst + t * 3u;
    writeVertex(v, topPoint(p, rotorLayout.$.triangles[corner]), p.item, style.top, layer);
    writeVertex(v + 1u, topPoint(p, rotorLayout.$.triangles[corner + 1u]), p.item, style.top, layer);
    writeVertex(v + 2u, topPoint(p, rotorLayout.$.triangles[corner + 2u]), p.item, style.top, layer);
    return;
  }
  let face = (t - p.triangleCount) / 2u;
  let half = (t - p.triangleCount) % 2u;
  if (!facingAt(p, face)) {
    // a face turned away: a zero-area triangle (rasterizes nothing)
    let at = topPoint(p, face);
    writeVertex(v, at, p.item, style.top, p.layer);
    writeVertex(v + 1u, at, p.item, style.top, p.layer);
    writeVertex(v + 2u, at, p.item, style.top, p.layer);
    return;
  }
  let shade = shadeAt(p, face);
  let paint = style.shade[shade];
  let layer = p.layer + LAYER_SHADE + shade;
  let a = topPoint(p, face);
  let c = bottomPoint(p, face + 1u);
  writeVertex(v, a, p.item, paint, layer);
  if (half == 0u) {
    writeVertex(v + 1u, topPoint(p, face + 1u), p.item, paint, layer);
    writeVertex(v + 2u, c, p.item, paint, layer);
  } else {
    writeVertex(v + 1u, c, p.item, paint, layer);
    writeVertex(v + 2u, bottomPoint(p, face), p.item, paint, layer);
  }
}`.$uses({ rotorLayout, topPoint, bottomPoint, facingAt, shadeAt, writeVertex, ...CONSTS });

export const expandParts = tgpu.computeFn({
  in: { lid: d.builtin.localInvocationIndex, wid: d.builtin.workgroupId },
  workgroupSize: [WORKGROUP_SIZE],
})/* wgsl */ `{
  let p = rotorLayout.$.parts[in.wid.x];
  let n = p.ringCount;
  for (var slot = in.lid; slot < 6u * n + 1u; slot += WG) { writeSeg(p, slot); }
  for (var t = in.lid; t < p.triangleCount + 2u * n; t += WG) { writeTriangle(p, t); }
}`.$uses({ rotorLayout, writeSeg, writeTriangle, ...CONSTS });
