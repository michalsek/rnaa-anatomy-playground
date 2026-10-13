// Live slot markup → GPU-ready geometry for one slot, mirroring the M1 exporter's semantics (export/build-dl.mjs):
// same parser (svgsub), same roles (roles.mjs), same polyline and fill rules, same palette keys. Output is one byte
// array per slot — segments (shaders.Seg, 48 B) then fill vertices (shaders.FillVertex, 16 B) — plus a draw list in
// document (= painter) order. Layer = index of the primitive inside the slot.
import { numberAttr, parsePathData, parseSvg } from '../../export/svgsub.mjs';
import { roleOf } from '../../export/roles.mjs';
import { cleanRing, triangulate } from '../../export/tess.mjs';
import type { BlendMode } from '../palette.ts';
import type { ChainNode } from '../scene.ts';
import { SEG_BUTT_END, SEG_BUTT_START, SEG_CLOSED, SEG_DOT, SEG_ROUND_END, SEG_ROUND_START } from '../shaders.ts';

export const SEG_BYTES = 48;
export const VERTEX_BYTES = 16;
const SEG_WORDS = SEG_BYTES / 4;
const VERTEX_WORDS = VERTEX_BYTES / 4;
const CIRCLE_STEPS = 32;
const MESH_CACHE_LIMIT = 4096;
/** Fill alpha is folded into the paint (fill vertices carry no alpha); quantizing bounds the number of derived paints. */
const FILL_ALPHA_STEPS = 1024;
const EPS = 1e-9;

/** Attributes that never change the cascade result (geometry, identity, alpha carried by the records). */
const KEY_DROP = new Set(['data-name', 'data-route', 'data-slot', 'id', 'd', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'offset', 'gradientUnits', 'opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity', 'style', 'role', 'aria-hidden', 'aria-label']);

export interface PaintClass {
  /** Index into the renderer's paint table. */
  id: number;
  visible: boolean;
  /** Fully opaque with normal blending: drawn in the depth-writing fill phase. */
  opaque: boolean;
  blend: BlendMode;
}

/**
 * Palette lookup used while building geometry. `key` identifies the probe recipe (prop + class chain + alpha);
 * `chain` builds the recipe only when the key is new.
 */
export interface PaintLookup {
  paintOf(prop: 'fill' | 'stroke', key: string, chain: () => ChainNode[], alpha: number): PaintClass;
}

export type SlotDraw =
  | { kind: 'segs'; first: number; count: number; blend: BlendMode }
  | { kind: 'fill'; first: number; count: number; blend: BlendMode }
  | { kind: 'group'; group: number };

/** A `<g opacity>` over several drawables: rendered into an offscreen layer, then composited with `alpha`. */
export interface LayerGroup {
  alpha: number;
  /** Opaque fill vertex range (relative to the vertex region). */
  opaque: { first: number; count: number };
  /** Blended draws of the group, in painter order. */
  draws: SlotDraw[];
  /** Bounds in viewBox units [x0, y0, x1, y1]; strokes add their CSS width on top (maxWidth). */
  bounds: [number, number, number, number];
  maxWidth: number;
  /** Layer of the group's last primitive: the composite sits at this depth. */
  frontLayer: number;
}

export interface SlotGeometry {
  /** Segments, then fill vertices. Only the first `byteLength` bytes are meaningful. */
  bytes: ArrayBuffer;
  byteLength: number;
  segCount: number;
  vertexCount: number;
  opaque: { first: number; count: number };
  draws: SlotDraw[];
  groups: LayerGroup[];
  layers: number;
}

export interface GeometryStats {
  meshHits: number;
  meshMisses: number;
  fills: number;
  segments: number;
}

interface SvgNode {
  tag: string;
  attrs: Record<string, string>;
  children: SvgNode[];
}

type Prim =
  | { kind: 'group'; group: number; alpha: number }
  | { kind: 'fill'; layer: number; paint: PaintClass; tris: Float32Array; group: number; first: number }
  | { kind: 'segs'; layer: number; paint: PaintClass; group: number; polylines: Polyline[]; width: number; cap: string; alpha: number; first: number; count: number }
  | { kind: 'dot'; layer: number; paint: PaintClass; group: number; x: number; y: number; r: number; alpha: number; first: number; count: number };

interface Polyline {
  points: number[][];
  closed: boolean;
}

/** Growable little-endian word buffer (f32 / u32 views over one ArrayBuffer), reused across frames. */
class Words {
  f32 = new Float32Array(1024);
  u32 = new Uint32Array(this.f32.buffer);
  length = 0;
  reserve(words: number) {
    if (this.length + words <= this.f32.length) return;
    let size = this.f32.length;
    while (size < this.length + words) size *= 2;
    const next = new Float32Array(size);
    next.set(this.f32.subarray(0, this.length));
    this.f32 = next;
    this.u32 = new Uint32Array(next.buffer);
  }
}

const isConvexRing = (ring: number[][]) => {
  let sign = 0;
  let turning = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = ring[(i + n - 1) % n];
    const [bx, by] = ring[i];
    const [cx, cy] = ring[(i + 1) % n];
    const ux = bx - ax, uy = by - ay, vx = cx - bx, vy = cy - by;
    const cross = ux * vy - uy * vx;
    if (Math.abs(cross) > EPS) {
      if (sign && Math.sign(cross) !== sign) return false;
      sign = Math.sign(cross);
    }
    turning += Math.atan2(cross, ux * vx + uy * vy);
  }
  return sign !== 0 && Math.abs(Math.abs(turning) - 2 * Math.PI) < 1e-6;
};

/** Triangle list (x, y per vertex), every triangle with a positive cross product, zero-area ones dropped. */
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
  if (rings.length === 1 && isConvexRing(rings[0])) {
    const ring = rings[0];
    for (let i = 1; i + 1 < ring.length; i++) push(ring[0], ring[i], ring[i + 1]);
  } else {
    const mesh = triangulate(subpaths);
    for (let t = 0; t < mesh.indices.length; t += 3) push(mesh.positions[mesh.indices[t]], mesh.positions[mesh.indices[t + 1]], mesh.positions[mesh.indices[t + 2]]);
  }
  return new Float32Array(out);
}

type Subpath = { points: number[][]; closed: boolean; drawn: boolean };

const CODE_M = 77, CODE_L = 76, CODE_Z = 90, CODE_SPACE = 32, CODE_MINUS = 45, CODE_DOT = 46, CODE_0 = 48, CODE_9 = 57;

/**
 * Path data in the exact form the kit's pathOf writes (absolute M / L / Z, plain decimal numbers separated by one
 * space: "M247.9 634.1L249.6 625.7Z") — about 4× faster than the general svgsub parser, which handles everything
 * else. Returns null on anything outside that form; equal results to parsePathData otherwise.
 */
function kitPathData(d: string): Subpath[] | null {
  const subpaths: Subpath[] = [];
  let current: Subpath | null = null;
  let i = 0;
  const n = d.length;
  const number = (): number => {
    const start = i;
    if (d.charCodeAt(i) === CODE_MINUS) i++;
    let digits = 0;
    while (i < n) {
      const c = d.charCodeAt(i);
      if ((c >= CODE_0 && c <= CODE_9) || c === CODE_DOT) {
        i++;
        digits++;
      } else break;
    }
    return digits ? Number(d.slice(start, i)) : NaN;
  };
  while (i < n) {
    const command = d.charCodeAt(i++);
    if (command === CODE_Z) {
      if (current && !current.closed) {
        current.closed = true;
        current.drawn = true;
      }
      continue;
    }
    if (command !== CODE_M && command !== CODE_L) return null;
    const x = number();
    if (d.charCodeAt(i++) !== CODE_SPACE) return null;
    const y = number();
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (command === CODE_M || !current || current.closed) {
      if (command === CODE_L && current?.closed) {
        const [sx, sy]: number[] = current.points[0];
        current = { points: [[sx, sy]], closed: false, drawn: false };
        subpaths.push(current);
      } else if (command === CODE_M) {
        current = { points: [[x, y]], closed: false, drawn: false };
        subpaths.push(current);
        continue;
      } else return null;
    }
    current.points.push([x, y]);
    current.drawn = true;
  }
  return subpaths;
}

const pathDataOf = (d: string): Subpath[] => kitPathData(d) ?? parsePathData(d);

const samePoint = (p: number[], q: number[]) => Math.abs(p[0] - q[0]) <= EPS && Math.abs(p[1] - q[1]) <= EPS;

/** Polylines as SVG strokes them (export/build-dl.mjs polylinesOf): a zero-length subpath paints only with round caps. */
function polylinesOf(subpaths: { points: number[][]; closed: boolean; drawn: boolean }[], cap: string): Polyline[] {
  const out: Polyline[] = [];
  for (const sp of subpaths) {
    if (!sp.drawn) continue;
    const points = sp.points.filter((p, i) => i === 0 || !samePoint(p, sp.points[i - 1]));
    if (sp.closed && points.length > 1 && samePoint(points[0], points[points.length - 1])) points.pop();
    if (points.length === 1) {
      if (cap === 'round') out.push({ points: [points[0], points[0]], closed: false });
      continue;
    }
    out.push({ points, closed: sp.closed });
  }
  return out;
}

const ringOfCircle = (cx: number, cy: number, r: number) =>
  Array.from({ length: CIRCLE_STEPS }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / CIRCLE_STEPS), cy + r * Math.sin((2 * Math.PI * i) / CIRCLE_STEPS)]);

const opacityOf = (node: SvgNode, name: string): number => numberAttr(node, name, 1, { percent: true });

/** Inline `style="stroke-width:…"` override in CSS px (parseSvg already rejects any other inline property). */
function strokeWidthOverride(node: SvgNode): number | undefined {
  const declaration = (node.attrs.style ?? '').split(';').find((part) => part.trim().startsWith('stroke-width'));
  if (!declaration) return undefined;
  const value = parseFloat(declaration.slice(declaration.indexOf(':') + 1));
  if (!Number.isFinite(value)) throw new Error(`live: bad inline ${declaration.trim()}`);
  return value;
}

/** Probe-relevant attributes of a node, in markup order (the palette key of export/build-dl.mjs probeNode). */
function probeNodeOf(node: SvgNode): ChainNode {
  const attrs: Record<string, string> = {};
  for (const [name, value] of Object.entries(node.attrs)) {
    if (KEY_DROP.has(name)) continue;
    if ((name === 'fill' || name === 'stroke') && value.startsWith('url(')) continue;
    attrs[name] = value;
  }
  return { tag: node.tag, attrs };
}

const keyOf = (node: ChainNode) => {
  let key = node.tag;
  for (const name in node.attrs) key += ` ${name}=${node.attrs[name]}`;
  return key;
};

const countDrawables = (node: SvgNode): number => node.children.reduce((n, child) => n + (child.tag === 'path' || child.tag === 'circle' ? 1 : countDrawables(child)), 0);

/**
 * Builds slot geometry. One instance per page: it owns the mesh cache (fills memoized by their `d` string; packets,
 * vanes and slats repeat while they rest) and a scratch buffer per slot.
 */
export class SlotGeometryBuilder {
  readonly stats: GeometryStats = { meshHits: 0, meshMisses: 0, fills: 0, segments: 0 };
  private readonly meshes = new Map<string, Float32Array>();
  private readonly segs = new Words();
  private readonly verts = new Words();

  constructor(
    private readonly palette: PaintLookup,
    /** Probe ancestors of every slot's content (`g.fx-parts > g[data-slot]` in the v2 page). */
    private readonly chainPrefix: ChainNode[],
  ) {}

  /** Throws on markup the GPU path cannot draw (unknown element, curve, dash, gradient, inline style…). */
  validate(markup: string) {
    const visit = (node: SvgNode, chain: SvgNode[]) => {
      for (const child of node.children) {
        if (child.tag === 'g') visit(child, [...chain, child]);
        else if (child.tag === 'path' || child.tag === 'circle') {
          this.checkElement(child);
          roleOf({ tag: child.tag, attrs: child.attrs, chain });
          if (child.tag === 'path') parsePathData(child.attrs.d ?? '');
        } else throw new Error(`live: <${child.tag}> is not supported in a live slot`);
      }
    };
    visit(parseSvg(markup) as SvgNode, []);
  }

  build(markup: string, item: number, out?: SlotGeometry): SlotGeometry {
    const prims = markup ? this.collect(markup) : [];
    return this.pack(prims, item, out);
  }

  private checkElement(node: SvgNode) {
    strokeWidthOverride(node);
    for (const prop of ['fill', 'stroke']) if (node.attrs[prop]?.startsWith('url(')) throw new Error(`live: ${prop}="${node.attrs[prop]}" (paint server) is not supported in a live slot`);
  }

  private collect(markup: string): Prim[] {
    const root = parseSvg(markup) as SvgNode;
    const prims: Prim[] = [];
    let groups = 0;
    const prefixKey = this.chainPrefix.map(keyOf).join('>');
    const visit = (node: SvgNode, chain: SvgNode[], probeChain: ChainNode[], chainKey: string, alpha: number, group: number) => {
      for (const child of node.children) {
        if (child.tag === 'g') {
          const probe = probeNodeOf(child);
          const own = opacityOf(child, 'opacity');
          const layered = group < 0 && child.attrs.opacity !== undefined && countDrawables(child) > 1;
          // A layered group's opacity is applied once, when its layer is composited; any other opacity folds into the
          // elements (exact for a single drawable). Groups nested in a layered group fold too (approximation).
          const childGroup = layered ? groups++ : group;
          const childAlpha = layered ? 1 : alpha * own;
          if (layered) prims.push({ kind: 'group', group: childGroup, alpha: alpha * own });
          visit(child, [...chain, child], [...probeChain, probe], `${chainKey}>${keyOf(probe)}`, childAlpha, childGroup);
          continue;
        }
        if (child.tag !== 'path' && child.tag !== 'circle') throw new Error(`live: <${child.tag}> is not supported in a live slot`);
        this.checkElement(child);
        const el = { tag: child.tag, attrs: child.attrs, chain };
        const role = roleOf(el);
        if (role.special.halo) throw new Error('live: halos are not supported in a live slot');
        const elProbe = probeNodeOf(child);
        const elKey = `${chainKey}>${keyOf(elProbe)}`;
        const chainOf = () => [...this.chainPrefix, ...probeChain, elProbe];
        const elAlpha = alpha * opacityOf(child, 'opacity');
        let subpaths;
        if (child.tag === 'circle') {
          const [x, y, r] = ['cx', 'cy', 'r'].map((name) => numberAttr(child, name, 0));
          const dotAlpha = elAlpha * opacityOf(child, 'fill-opacity');
          prims.push({ kind: 'dot', layer: 0, paint: this.palette.paintOf('fill', `fill|${prefixKey}${elKey}`, chainOf, 1), group, x, y, r, alpha: dotAlpha, first: 0, count: 0 });
          if (!role.stroke) continue;
          subpaths = [{ points: ringOfCircle(x, y, r), closed: true, drawn: true }];
        } else {
          const d = child.attrs.d ?? '';
          subpaths = pathDataOf(d);
          if (role.fill) {
            const fillAlpha = Math.round(elAlpha * opacityOf(child, 'fill-opacity') * FILL_ALPHA_STEPS) / FILL_ALPHA_STEPS;
            const paint = this.palette.paintOf('fill', `fill|${fillAlpha}|${prefixKey}${elKey}`, chainOf, fillAlpha);
            prims.push({ kind: 'fill', layer: 0, paint, tris: this.meshOf(d, subpaths), group, first: 0 });
          }
        }
        if (role.stroke) {
          const width = strokeWidthOverride(child) ?? role.stroke.width;
          const paint = this.palette.paintOf('stroke', `stroke|${prefixKey}${elKey}`, chainOf, 1);
          prims.push({ kind: 'segs', layer: 0, paint, group, polylines: polylinesOf(subpaths, role.stroke.cap), width, cap: role.stroke.cap, alpha: elAlpha * opacityOf(child, 'stroke-opacity'), first: 0, count: 0 });
        }
      }
    };
    visit(root, [], [], '', 1, -1);
    return prims;
  }

  private meshOf(d: string, subpaths: { points: number[][] }[]) {
    const cached = this.meshes.get(d);
    if (cached) {
      this.stats.meshHits++;
      return cached;
    }
    this.stats.meshMisses++;
    if (this.meshes.size >= MESH_CACHE_LIMIT) this.meshes.clear();
    const tris = trianglesOf(subpaths);
    this.meshes.set(d, tris);
    return tris;
  }

  private pack(prims: Prim[], item: number, previous?: SlotGeometry): SlotGeometry {
    const segs = this.segs;
    const verts = this.verts;
    segs.length = 0;
    verts.length = 0;
    const groups: LayerGroup[] = [];
    const draws: SlotDraw[] = [];
    let layer = 0;
    // Pass 1: segments (strokes and dots) in document order; layers assigned to every drawn primitive.
    for (const prim of prims) {
      if (prim.kind === 'group') {
        groups.push({ alpha: prim.alpha, opaque: { first: 0, count: 0 }, draws: [], bounds: [Infinity, Infinity, -Infinity, -Infinity], maxWidth: 0, frontLayer: 0 });
        continue;
      }
      if (!prim.paint.visible) continue;
      prim.layer = layer++;
      if (prim.group >= 0) groups[prim.group].frontLayer = prim.layer;
      if (prim.kind === 'fill') continue;
      const first = segs.length / SEG_WORDS;
      if (prim.kind === 'dot') this.pushSeg(prim.x, prim.y, prim.x, prim.y, prim.r, item, prim.paint.id, prim.layer, prim.alpha, SEG_DOT, 0, 1);
      else this.pushPolylines(prim, item);
      prim.first = first;
      prim.count = segs.length / SEG_WORDS - first;
      if (prim.group >= 0) this.growBounds(groups[prim.group], prim, first, prim.count);
    }
    const segCount = segs.length / SEG_WORDS;
    this.stats.segments += segCount;
    // Pass 2: fill vertices — opaque outside groups, then each group's opaque fills, then translucent fills in order.
    const pushFill = (prim: Prim & { kind: 'fill' }) => {
      prim.first = verts.length / VERTEX_WORDS;
      this.pushFill(prim, item);
      if (prim.group >= 0) this.growBoundsByFill(groups[prim.group], prim.tris);
    };
    const opaqueOf = (group: number) => {
      const first = verts.length / VERTEX_WORDS;
      for (const prim of prims) if (prim.kind === 'fill' && prim.paint.visible && prim.paint.opaque && prim.group === group) pushFill(prim);
      return { first, count: verts.length / VERTEX_WORDS - first };
    };
    const opaque = opaqueOf(-1);
    groups.forEach((group, index) => (group.opaque = opaqueOf(index)));
    for (const prim of prims) if (prim.kind === 'fill' && prim.paint.visible && !prim.paint.opaque) pushFill(prim);
    // Pass 3: blended draw lists in painter order; consecutive runs merge.
    const append = (list: SlotDraw[], next: SlotDraw) => {
      const last = list[list.length - 1];
      if (last && last.kind === next.kind && next.kind !== 'group' && last.kind !== 'group' && last.blend === next.blend && last.first + last.count === next.first) last.count += next.count;
      else list.push(next);
    };
    let openGroup = -1;
    for (const prim of prims) {
      if (prim.kind === 'group' || !prim.paint.visible) continue;
      const list = prim.group >= 0 ? groups[prim.group].draws : draws;
      if (prim.group >= 0 && prim.group !== openGroup) {
        openGroup = prim.group;
        draws.push({ kind: 'group', group: prim.group });
      }
      if (prim.kind === 'fill') {
        if (!prim.paint.opaque && prim.tris.length) append(list, { kind: 'fill', first: prim.first, count: prim.tris.length / 2, blend: prim.paint.blend });
      } else {
        if (prim.count) append(list, { kind: 'segs', first: prim.first, count: prim.count, blend: prim.paint.blend });
      }
    }
    // Pack: [segments | vertices] into the slot's reusable byte array.
    const byteLength = segs.length * 4 + verts.length * 4;
    let bytes = previous?.bytes;
    if (!bytes || bytes.byteLength < byteLength) bytes = new ArrayBuffer(Math.max(1024, 2 ** Math.ceil(Math.log2(byteLength))));
    const words = new Uint32Array(bytes);
    words.set(segs.u32.subarray(0, segs.length));
    words.set(verts.u32.subarray(0, verts.length), segs.length);
    return { bytes, byteLength, segCount, vertexCount: verts.length / VERTEX_WORDS, opaque, draws, groups, layers: layer };
  }

  private pushSeg(x0: number, y0: number, x1: number, y1: number, width: number, item: number, paint: number, layer: number, alpha: number, flags: number, polyStart: number, polyEnd: number) {
    const segs = this.segs;
    segs.reserve(SEG_WORDS);
    const o = segs.length;
    const { f32, u32 } = segs;
    f32[o] = x0;
    f32[o + 1] = y0;
    f32[o + 2] = x1;
    f32[o + 3] = y1;
    f32[o + 4] = width;
    u32[o + 5] = item;
    u32[o + 6] = paint;
    u32[o + 7] = layer;
    f32[o + 8] = alpha;
    u32[o + 9] = flags;
    u32[o + 10] = polyStart;
    u32[o + 11] = polyEnd;
    segs.length += SEG_WORDS;
  }

  /** Same segment flags as Renderer.buildGeometry for the static scene (closed ⇔ ≥ 3 points, caps on open ends). */
  private pushPolylines(prim: Prim & { kind: 'segs' }, item: number) {
    const butt = prim.cap === 'butt';
    for (const { points, closed } of prim.polylines) {
      const count = points.length;
      const isClosed = closed && count >= 3;
      const n = isClosed ? count : count - 1;
      if (butt && !isClosed && n === 1 && samePoint(points[0], points[count - 1])) continue;
      const polyStart = this.segs.length / SEG_WORDS;
      for (let i = 0; i < n; i++) {
        const a = points[i];
        const b = points[(i + 1) % count];
        let flags = isClosed ? SEG_CLOSED : 0;
        if (!isClosed && i === 0) flags |= butt ? SEG_BUTT_START : SEG_ROUND_START;
        if (!isClosed && i === n - 1) flags |= butt ? SEG_BUTT_END : SEG_ROUND_END;
        this.pushSeg(a[0], a[1], b[0], b[1], prim.width, item, prim.paint.id, prim.layer, prim.alpha, flags, polyStart, polyStart + n);
      }
    }
  }

  private pushFill(prim: Prim & { kind: 'fill' }, item: number) {
    const verts = this.verts;
    const tris = prim.tris;
    const n = tris.length / 2;
    verts.reserve(n * VERTEX_WORDS);
    const { f32, u32 } = verts;
    const ids = (item | (prim.paint.id << 16)) >>> 0;
    let o = verts.length;
    for (let v = 0; v < n; v++, o += VERTEX_WORDS) {
      f32[o] = tris[v * 2];
      f32[o + 1] = tris[v * 2 + 1];
      u32[o + 2] = ids;
      u32[o + 3] = prim.layer;
    }
    verts.length = o;
    this.stats.fills++;
  }

  private growBounds(group: LayerGroup, prim: Prim, first: number, count: number) {
    const f32 = this.segs.f32;
    for (let s = first; s < first + count; s++) {
      const o = s * SEG_WORDS;
      const pad = prim.kind === 'dot' ? f32[o + 4] : 0;
      group.bounds[0] = Math.min(group.bounds[0], f32[o] - pad, f32[o + 2] - pad);
      group.bounds[1] = Math.min(group.bounds[1], f32[o + 1] - pad, f32[o + 3] - pad);
      group.bounds[2] = Math.max(group.bounds[2], f32[o] + pad, f32[o + 2] + pad);
      group.bounds[3] = Math.max(group.bounds[3], f32[o + 1] + pad, f32[o + 3] + pad);
    }
    if (prim.kind === 'segs') group.maxWidth = Math.max(group.maxWidth, prim.width);
  }

  private growBoundsByFill(group: LayerGroup, tris: Float32Array) {
    for (let i = 0; i < tris.length; i += 2) {
      group.bounds[0] = Math.min(group.bounds[0], tris[i]);
      group.bounds[1] = Math.min(group.bounds[1], tris[i + 1]);
      group.bounds[2] = Math.max(group.bounds[2], tris[i]);
      group.bounds[3] = Math.max(group.bounds[3], tris[i + 1]);
    }
  }
}
