// Live slot markup → GPU-ready geometry for one slot, with the M1 exporter's rules (one source of truth in export/):
// the same strict SVG subset (svgsub: scanTags / attrsOf / parsePathData), roles (roles.mjs), polylines (polylines.mjs),
// palette keys (palette-key.mjs) and tessellation (tess.mjs). Output: one byte array per slot — Seg records, then
// FillVertex records — plus a draw list in document (= painter) order; layer = index of the primitive in the slot.
//
// Style cache: what an element's markup decides apart from its geometry (role, paint ids, opacities, stroke style) is
// cached per ancestor context, keyed by the element's tag text without its path data, so a new shape costs only its
// path parse, tessellation and segment records (whole elements are not cached: live content moves every frame).
import { paintKeyOf, probeNode } from '../../export/palette-key.mjs';
import { polylinesOf, ringOfCircle } from '../../export/polylines.mjs';
import { roleOf } from '../../export/roles.mjs';
import { attrsOf, numberAttr, opacityAttr, parsePathData, scanTags, strokeWidthOf, type Subpath, type SvgElement } from '../../export/svgsub.mjs';
import { cleanRing, EPS, triangulate } from '../../export/tess.mjs';
import { FillWriter } from '../core/fills.ts';
import { isOpaqueAlpha, type BlendMode, type ChainNode, type PaintTable } from '../core/paint.ts';
import { FILL_VERTEX_RECORD, SEG_RECORD } from '../core/schemas.ts';
import type { SlotExtent } from '../core/slots.ts';
import { emptyBox, growBox, isEmptyBox, unionBox, type Box } from '../core/static-geometry.ts';
import { SegWriter } from '../core/strokes.ts';

/**
 * An opacity attribute clamped to [0, 1], as CSS clamps it: an easing that overshoots must not brighten the GPU
 * figure (group layer and record alphas are multiplied in unclamped otherwise).
 */
const unitOpacity = (node: SvgElement, name: string) => Math.min(1, Math.max(0, opacityAttr(node, name)));

/** Cache entries kept before the caches start over (content that never repeats cannot pile up). */
const CACHE_LIMIT = 4096;

export type SlotDraw =
  | { kind: 'segs'; first: number; count: number; blend: BlendMode }
  | { kind: 'fill'; first: number; count: number; blend: BlendMode }
  | { kind: 'group'; group: number };

/** A `<g opacity>` over several drawables: rendered into an offscreen layer, then composited with `alpha`. */
export interface LayerGroup {
  alpha: number;
  /** Opaque fill vertex range (vertex indices relative to the slot's vertex region). */
  opaque: { first: number; count: number };
  /** Blended draws of the group, in painter order. */
  draws: SlotDraw[];
  /** Geometry bounds (viewBox units); strokes add `halfWidth` CSS px on top. */
  bounds: Box;
  halfWidth: number;
  /** Layer of the group's frontmost primitive: the composite sits at this depth. */
  frontLayer: number;
}

export interface SlotGeometry {
  /** Seg records, then FillVertex records; only the first `byteLength` bytes are meaningful. Reused per slot. */
  bytes: ArrayBuffer;
  byteLength: number;
  segCount: number;
  vertexCount: number;
  opaque: { first: number; count: number };
  draws: SlotDraw[];
  groups: LayerGroup[];
  layers: number;
  extent: SlotExtent | null;
}

export interface GeometryStats {
  /** Elements built. */
  elements: number;
  /** Path styles (everything but the geometry) reused / resolved. */
  styleHits: number;
  styleMisses: number;
  fills: number;
  segments: number;
}

type ElementPrim =
  | { kind: 'fill'; paint: number; alpha: number; tris: Float32Array; bounds: Box }
  | { kind: 'segs'; paint: number; alpha: number; words: Uint32Array; count: number; halfWidth: number; bounds: Box }
  | { kind: 'dot'; paint: number; alpha: number; x: number; y: number; r: number };

interface ElementPrims {
  prims: ElementPrim[];
}

interface GroupInfo {
  node: SvgElement;
  probe: ChainNode;
  opacity: number;
  hasOpacity: boolean;
}

/** What the markup decides about an element apart from its geometry (role, paints, opacities, stroke style). */
interface ElementStyle {
  fill: { paint: number; alpha: number } | null;
  stroke: { paint: number; alpha: number; width: number; cap: 'round' | 'butt' } | null;
}

/** Caches of one ancestor context (the same chain of group start tags). */
interface ContextCache {
  /** Path styles by the path's tag text without its `d` attribute. */
  styles: Map<string, ElementStyle>;
}

interface GroupFrame {
  key: string;
  cache: ContextCache;
  chain: SvgElement[];
  probeChain: ChainNode[];
  /** Opacity of non-layered ancestor groups (folded into each element). */
  alpha: number;
  /** Layer group index, −1 outside any. */
  group: number;
}

/** The primitives of one slot's markup, collected before the paint table resolved its new entries. */
export class CollectedSlot {
  readonly prims: SlotPrim[] = [];
  count = 0;
  groupAlphas: number[] = [];

  reset() {
    this.count = 0;
    this.groupAlphas.length = 0;
  }

  push(prim: ElementPrim, alpha: number, group: number) {
    const slot = this.prims[this.count];
    if (slot) {
      slot.prim = prim;
      slot.alpha = alpha;
      slot.group = group;
      slot.layer = slot.first = slot.count = 0;
    } else {
      this.prims.push({ prim, alpha, group, layer: 0, first: 0, count: 0 });
    }
    this.count++;
  }
}

/** An emitted primitive of the slot being built. */
interface SlotPrim {
  prim: ElementPrim;
  alpha: number;
  group: number;
  layer: number;
  first: number;
  count: number;
}

/** Whether a ring (no repeated points) is strictly convex: all turns one way, turning once around. */
function isConvexRing(ring: number[][]) {
  let sign = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = ring[(i + n - 1) % n];
    const [bx, by] = ring[i];
    const [cx, cy] = ring[(i + 1) % n];
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(cross) > EPS) {
      if (sign && Math.sign(cross) !== sign) return false;
      sign = Math.sign(cross);
    }
  }
  if (!sign) return false;
  // turning number 1, not a star that winds several times (only reached when every turn has the same sign)
  let turning = 0;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = ring[(i + n - 1) % n];
    const [bx, by] = ring[i];
    const [cx, cy] = ring[(i + 1) % n];
    const ux = bx - ax, uy = by - ay, vx = cx - bx, vy = cy - by;
    turning += Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  }
  return Math.abs(Math.abs(turning) - 2 * Math.PI) < 1e-6;
}

const ringBox = (ring: number[][]) => {
  const box = emptyBox();
  for (const [x, y] of ring) growBox(box, x, y);
  return box;
};
const boxesOverlap = (a: Box, b: Box) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/** Separating axis test: an edge normal of either convex ring along which their projections do not even touch. */
function convexRingsSeparate(a: number[][], b: number[][]) {
  for (const [ring, other] of [[a, b], [b, a]]) {
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[(i + 1) % ring.length];
      const nx = y0 - y1, ny = x1 - x0;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const [x, y] of ring) {
        const t = x * nx + y * ny;
        if (t < minA) minA = t;
        if (t > maxA) maxA = t;
      }
      for (const [x, y] of other) {
        const t = x * nx + y * ny;
        if (t < minB) minB = t;
        if (t > maxB) maxB = t;
      }
      if (maxA < minB - EPS || maxB < minA - EPS) return true;
    }
  }
  return false;
}

/**
 * Triangle list (x, y per vertex), every triangle with a positive cross product, zero-area ones dropped. Convex rings
 * that do not touch each other are fanned one by one (their nonzero union is each of them); anything else goes to the
 * exporter's tessellator.
 */
function trianglesOf(subpaths: { points: number[][] }[]): Float32Array {
  const rings = subpaths.map((s) => cleanRing(s.points)).filter((r) => r.length >= 3);
  if (!rings.length) return new Float32Array(0);
  const out: number[] = [];
  const push = (a: number[], b: number[], c: number[]) => {
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) <= EPS) return;
    if (area > 0) out.push(a[0], a[1], b[0], b[1], c[0], c[1]);
    else out.push(a[0], a[1], c[0], c[1], b[0], b[1]);
  };
  const boxes = rings.length > 1 ? rings.map(ringBox) : [];
  const convex = rings.every(isConvexRing);
  const separate = convex && boxes.every((box, i) => boxes.every((other, j) => j <= i || !boxesOverlap(box, other) || convexRingsSeparate(rings[i], rings[j])));
  if (convex && separate) {
    for (const ring of rings) for (let i = 1; i + 1 < ring.length; i++) push(ring[0], ring[i], ring[i + 1]);
  } else {
    const mesh = triangulate(subpaths);
    for (let t = 0; t < mesh.indices.length; t += 3) push(mesh.positions[mesh.indices[t]], mesh.positions[mesh.indices[t + 1]], mesh.positions[mesh.indices[t + 2]]);
  }
  return new Float32Array(out);
}

/**
 * Builds slot geometry. One instance per page: it owns the element cache and the scratch writers, so building is
 * allocation-light once warm. `chainPrefix` = probe ancestors of every slot's content (`g.fx-parts > g[data-slot]`).
 */
export class SlotGeometryBuilder {
  readonly stats: GeometryStats = { elements: 0, styleHits: 0, styleMisses: 0, fills: 0, segments: 0 };
  /** Style caches per ancestor context (the group start tags above the element, concatenated). */
  private readonly contexts = new Map<string, ContextCache>();
  /** Styles, contexts and group infos cached (the caches start over at CACHE_LIMIT). */
  private cachedEntries = 0;
  private readonly groupInfos = new Map<string, GroupInfo>();
  private readonly segs = new SegWriter(1024);
  private readonly verts = new FillWriter(4096);
  private readonly elementSegs = new SegWriter(256);
  private readonly points: number[] = [];
  private readonly scratch = new CollectedSlot();

  constructor(
    private readonly paints: PaintTable,
    private readonly chainPrefix: ChainNode[],
  ) {}

  /**
   * Throws on markup the GPU path cannot draw (unsupported element, attribute, curve, dash, paint server, halo,
   * inline style…): exactly the checks `collect` applies. Styles resolved here are reused by the next build.
   */
  validate(markup: string) {
    this.collect(markup, this.scratch);
  }

  /** Phase 1: walks the markup and registers its paints (new ones stay pending until the table resolves them). */
  collect(markup: string, into: CollectedSlot) {
    into.reset();
    if (!markup) return;
    const counts = /<g\b[^>]*\sopacity=/.test(markup) ? drawnLeafCounts(markup) : null;
    const root: GroupFrame = { key: '', cache: this.contextOf(''), chain: [], probeChain: this.chainPrefix, alpha: 1, group: -1 };
    const stack: GroupFrame[] = [root];
    let ordinal = 0;
    scanTags(markup, {
      open: (tag, attrSource, selfClosing, raw) => {
        const frame = stack[stack.length - 1];
        const open = ordinal++;
        if (tag === 'g') {
          if (selfClosing) return;
          const info = this.groupInfoOf(raw, attrSource);
          const layered = frame.group < 0 && info.hasOpacity && (counts?.[open] ?? 0) > 1;
          const group = layered ? into.groupAlphas.push(frame.alpha * info.opacity) - 1 : frame.group;
          const key = frame.key + raw;
          stack.push({ key, cache: this.contextOf(key), chain: [...frame.chain, info.node], probeChain: [...frame.probeChain, info.probe], alpha: layered ? 1 : frame.alpha * info.opacity, group });
          return;
        }
        if (tag !== 'path' && tag !== 'circle') throw new Error(`live: <${tag}> is not supported in a live slot`);
        const element = this.elementPrims(frame, tag, attrSource, raw);
        for (const prim of element.prims) into.push(prim, prim.alpha * frame.alpha, frame.group);
      },
      close: (tag) => {
        if (tag === 'g') stack.pop();
      },
    });
  }

  /** Phase 2 (after the paint table resolved): packs the collected primitives with the current paint classes. */
  pack(collected: CollectedSlot, item: number, previous?: SlotGeometry): SlotGeometry {
    const { segs, verts, paints } = this;
    segs.reset();
    verts.reset();
    const prims = collected.prims;
    const n = collected.count;
    const groups: LayerGroup[] = collected.groupAlphas.map((alpha) => ({ alpha, opaque: { first: 0, count: 0 }, draws: [], bounds: emptyBox(), halfWidth: 0, frontLayer: 0 }));
    const draws: SlotDraw[] = [];
    const extentBox = emptyBox();
    let extentHalfWidth = 0;
    let layer = 0;
    const visible = (p: SlotPrim) => paints.classes[p.prim.paint].visible && p.alpha > 0;
    const opaque = (p: SlotPrim) => paints.classes[p.prim.paint].opaque && isOpaqueAlpha(p.alpha);
    // Pass 1: segments (strokes and dots) in document order; a layer for every drawn primitive.
    for (let i = 0; i < n; i++) {
      const p = prims[i];
      if (!visible(p)) continue;
      p.layer = layer++;
      if (p.group >= 0) groups[p.group].frontLayer = p.layer;
      const prim = p.prim;
      if (prim.kind === 'fill') {
        unionBox(extentBox, prim.bounds);
        if (p.group >= 0) unionBox(groups[p.group].bounds, prim.bounds);
        continue;
      }
      p.first = segs.count;
      if (prim.kind === 'dot') {
        segs.dot(prim.x, prim.y, prim.r, { item, paint: prim.paint, layer: p.layer, alpha: p.alpha });
        growBox(extentBox, prim.x, prim.y, prim.r);
        if (p.group >= 0) growBox(groups[p.group].bounds, prim.x, prim.y, prim.r);
      } else {
        segs.appendRecords(prim.words, prim.count, item, p.layer, p.alpha);
        unionBox(extentBox, prim.bounds);
        extentHalfWidth = Math.max(extentHalfWidth, prim.halfWidth);
        if (p.group >= 0) {
          unionBox(groups[p.group].bounds, prim.bounds);
          groups[p.group].halfWidth = Math.max(groups[p.group].halfWidth, prim.halfWidth);
        }
      }
      p.count = segs.count - p.first;
    }
    this.stats.segments += segs.count;
    // Pass 2: fill vertices — opaque outside groups, then each group's opaque fills, then translucent fills in order.
    const pushFill = (p: SlotPrim) => {
      const prim = p.prim as ElementPrim & { kind: 'fill' };
      p.first = verts.triangles(prim.tris, 0, prim.tris.length / 2, item, prim.paint, p.layer, p.alpha);
      p.count = prim.tris.length / 2;
      this.stats.fills++;
    };
    const opaqueOf = (group: number) => {
      const first = verts.count;
      for (let i = 0; i < n; i++) {
        const p = prims[i];
        if (p.prim.kind === 'fill' && p.group === group && visible(p) && opaque(p)) pushFill(p);
      }
      return { first, count: verts.count - first };
    };
    const opaqueRange = opaqueOf(-1);
    groups.forEach((group, index) => (group.opaque = opaqueOf(index)));
    for (let i = 0; i < n; i++) {
      const p = prims[i];
      if (p.prim.kind === 'fill' && visible(p) && !opaque(p)) pushFill(p);
    }
    // Pass 3: blended draw lists in painter order; consecutive runs merge.
    const append = (list: SlotDraw[], next: SlotDraw) => {
      const last = list[list.length - 1];
      if (last && last.kind === next.kind && next.kind !== 'group' && last.kind !== 'group' && last.blend === next.blend && last.first + last.count === next.first) last.count += next.count;
      else list.push(next);
    };
    let openGroup = -1;
    for (let i = 0; i < n; i++) {
      const p = prims[i];
      if (!visible(p)) continue;
      const list = p.group >= 0 ? groups[p.group].draws : draws;
      if (p.group >= 0 && p.group !== openGroup) {
        openGroup = p.group;
        draws.push({ kind: 'group', group: p.group });
      }
      const blend = paints.classes[p.prim.paint].blend;
      if (p.prim.kind === 'fill') {
        if (!opaque(p) && p.count) append(list, { kind: 'fill', first: p.first, count: p.count, blend });
      } else if (p.count) {
        append(list, { kind: 'segs', first: p.first, count: p.count, blend });
      }
    }
    // [Seg records | FillVertex records] into the slot's reusable byte array
    const segBytes = segs.count * SEG_RECORD.bytes;
    const byteLength = segBytes + verts.count * FILL_VERTEX_RECORD.bytes;
    let bytes = previous?.bytes;
    if (!bytes || bytes.byteLength < byteLength) bytes = new ArrayBuffer(2 ** Math.ceil(Math.log2(Math.max(1024, byteLength))));
    const words = new Uint32Array(bytes, 0, byteLength / 4);
    words.set(segs.u32.subarray(0, segBytes / 4));
    words.set(verts.words, segBytes / 4);
    const extent = isEmptyBox(extentBox) ? null : { box: extentBox, halfWidth: extentHalfWidth };
    return { bytes, byteLength, segCount: segs.count, vertexCount: verts.count, opaque: opaqueRange, draws, groups, layers: layer, extent };
  }

  private groupInfoOf(raw: string, attrSource: string): GroupInfo {
    let info = this.groupInfos.get(raw);
    if (!info) {
      const node = { tag: 'g', attrs: attrsOf('g', attrSource) };
      info = { node, probe: probeNode(node), opacity: unitOpacity(node, 'opacity'), hasOpacity: node.attrs.opacity !== undefined };
      this.groupInfos.set(raw, info);
      this.counted();
    }
    return info;
  }

  private contextOf(key: string): ContextCache {
    let cache = this.contexts.get(key);
    if (!cache) {
      cache = { styles: new Map() };
      this.contexts.set(key, cache);
      this.counted();
    }
    return cache;
  }

  /** Counts one cache entry; past the limit every cache starts over (content that never repeats cannot pile up). */
  private counted() {
    if (++this.cachedEntries < CACHE_LIMIT) return;
    for (const context of this.contexts.values()) context.styles.clear();
    this.contexts.clear();
    this.groupInfos.clear();
    this.cachedEntries = 0;
  }

  private elementPrims(frame: GroupFrame, tag: string, attrSource: string, raw: string): ElementPrims {
    this.stats.elements++;
    return tag === 'path' ? this.pathPrims(frame, attrSource, raw) : this.circlePrims(frame, attrSource);
  }

  /**
   * A path: its style comes from the context's style cache, keyed by the tag text without `d` (paths that differ only
   * in geometry share it), so only the path data is parsed for a new shape. Tags whose `d` cannot be cut out plainly
   * (single quotes, entities) take the full attribute parse.
   */
  private pathPrims(frame: GroupFrame, attrSource: string, raw: string): ElementPrims {
    const at = raw.indexOf(' d="');
    const end = at < 0 ? -1 : raw.indexOf('"', at + 4);
    const d = end < 0 ? null : raw.slice(at + 4, end);
    if (d === null || d.includes('&')) {
      const node = { tag: 'path', attrs: attrsOf('path', attrSource) };
      return this.primsOf(this.styleOf(frame, node), parsePathData(node.attrs.d ?? ''));
    }
    const styleKey = raw.slice(0, at) + raw.slice(end + 1);
    let style = frame.cache.styles.get(styleKey);
    if (style) this.stats.styleHits++;
    else {
      this.stats.styleMisses++;
      style = this.styleOf(frame, { tag: 'path', attrs: attrsOf('path', attrSource) });
      frame.cache.styles.set(styleKey, style);
      this.counted();
    }
    return this.primsOf(style, parsePathData(d));
  }

  private circlePrims(frame: GroupFrame, attrSource: string): ElementPrims {
    const node = { tag: 'circle', attrs: attrsOf('circle', attrSource) };
    const style = this.styleOf(frame, node);
    const x = numberAttr(node, 'cx', 0), y = numberAttr(node, 'cy', 0), r = numberAttr(node, 'r', 0);
    const dot: ElementPrim = { kind: 'dot', paint: style.fill!.paint, alpha: style.fill!.alpha, x, y, r };
    if (!style.stroke) return { prims: [dot] };
    const ring = this.primsOf({ fill: null, stroke: style.stroke }, [{ points: ringOfCircle(x, y, r), closed: true, drawn: true }]);
    return { prims: [dot, ...ring.prims] };
  }

  /** Role, paints and opacities of an element (every check of the subset that does not depend on its geometry). */
  private styleOf(frame: GroupFrame, node: SvgElement): ElementStyle {
    const role = roleOf({ ...node, chain: frame.chain });
    if (role.special.halo) throw new Error('live: halos are not supported in a live slot');
    for (const prop of ['fill', 'stroke'] as const) if (node.attrs[prop]?.startsWith('url(')) throw new Error(`live: ${prop}="${node.attrs[prop]}" (paint server) is not supported in a live slot`);
    const widthOverride = strokeWidthOf(node);
    const elProbe = probeNode(node);
    const paintOf = (prop: 'fill' | 'stroke') => this.paints.idOf(paintKeyOf(prop, frame.probeChain, elProbe), () => ({ kind: 'probe', prop, ancestors: frame.probeChain, el: elProbe }));
    const opacity = unitOpacity(node, 'opacity');
    // a circle always paints its fill (a dot); a path only when its role fills
    const fills = node.tag === 'circle' || role.fill;
    return {
      fill: fills ? { paint: paintOf('fill'), alpha: opacity * unitOpacity(node, 'fill-opacity') } : null,
      stroke: role.stroke ? { paint: paintOf('stroke'), alpha: opacity * unitOpacity(node, 'stroke-opacity'), width: widthOverride ?? role.stroke.width, cap: role.stroke.cap } : null,
    };
  }

  private primsOf(style: ElementStyle, subpaths: Subpath[]): ElementPrims {
    const prims: ElementPrim[] = [];
    if (style.fill) {
      const tris = trianglesOf(subpaths);
      const bounds = emptyBox();
      for (let i = 0; i < tris.length; i += 2) growBox(bounds, tris[i], tris[i + 1]);
      prims.push({ kind: 'fill', paint: style.fill.paint, alpha: style.fill.alpha, tris, bounds });
    }
    if (style.stroke) {
      const { width, cap, paint, alpha } = style.stroke;
      const writer = this.elementSegs;
      writer.reset();
      const bounds = emptyBox();
      const xy = this.points;
      for (const { points, closed } of polylinesOf(subpaths, cap)) {
        xy.length = 0;
        for (const [x, y] of points) {
          xy.push(x, y);
          growBox(bounds, x, y);
        }
        writer.polyline(xy, 0, points.length, closed, cap, { width, item: 0, paint, layer: 0, alpha: 1 });
      }
      prims.push({ kind: 'segs', paint, alpha, words: writer.u32.slice(0, writer.count * SEG_RECORD.words), count: writer.count, halfWidth: width / 2, bounds });
    }
    return { prims };
  }
}

/** Drawn leaves (path / circle) under every open tag, by open-tag ordinal (layered-group decisions need them). */
function drawnLeafCounts(markup: string): number[] {
  const counts: number[] = [];
  const stack: number[] = [];
  let ordinal = 0;
  scanTags(markup, {
    open: (tag, _attrs, selfClosing) => {
      const index = ordinal++;
      counts[index] = 0;
      if (tag === 'path' || tag === 'circle') for (const open of stack) counts[open]++;
      if (!selfClosing) stack.push(index);
    },
    close: () => {
      stack.pop();
    },
  });
  return counts;
}
