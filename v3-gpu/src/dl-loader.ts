// M1 display list v1 (notes/DL-FORMAT.md) → GpuScene. The DL is already in the renderer's shape (item / layer /
// paint per primitive, palette = probe recipes); this only re-expresses it:
// - fills: indexed triangles → triangle-list ranges; record alpha folded into a per-(palette, alpha) paint so the
//   opaque / translucent split stays a pure palette question;
// - strokes: segments → polylines (start/end/closed flags) with the record's CSS width and cap style;
// - dots: per circle; gradients: palette id 0x80000000 | g → a 'linear' paint with stop-colour probes;
// - the back item (`@back`, key null) sorts before everything.
import type { ChainNode, DotElem, FillElem, GpuScene, PaintDesc, StrokeElem } from './scene.ts';

const KIND_FILL = 0, KIND_STROKE = 1, KIND_DOT = 2;
const PRIM_HALO = 1;
const SEG_START = 1, SEG_END = 2, SEG_CLOSED = 4, SEG_ROUND_CAP = 8;
const PAINT_GRADIENT = 0x80000000;

function decodeBase64(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function sceneFromDl(json: any, binBase64: string): GpuScene {
  if (json.format !== 'rnaa-dl' || json.version !== 1) throw new Error(`dl-loader: unsupported ${json.format} v${json.version}`);
  const buffer = decodeBase64(binBase64);
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x4c444e52) throw new Error('dl-loader: bad magic');
  const section = (name: string) => {
    const entry = json.sections.find((s: any) => s.name === name);
    return { count: entry.count as number, stride: entry.stride / 4, f32: new Float32Array(buffer, entry.offset, entry.byteLength / 4), u32: new Uint32Array(buffer, entry.offset, entry.byteLength / 4) };
  };
  const prims = section('prims');
  const verts = section('fillVertices');
  const indices = section('fillIndices');
  const segs = section('segments');
  const dots = section('dots');

  // Paints: palette entries become probes; record alpha and gradients create derived paints on demand.
  const paints: PaintDesc[] = [];
  const paintKey = new Map<string, number>();
  const chainOf = (id: number): ChainNode[] => {
    const entry = json.palette[id];
    return [...entry.ancestors, entry.el];
  };
  const paintFor = (id: number, alpha: number, prop: 'fill' | 'stroke') => {
    const key = `${id}|${alpha}|${prop}`;
    let index = paintKey.get(key);
    if (index !== undefined) return index;
    let desc: PaintDesc;
    if (id & PAINT_GRADIENT) {
      const g = json.gradients[id & 0x7fffffff];
      desc = {
        kind: 'linear', x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, units: g.units, chain: chainOf(g.paint),
        stops: g.stops.map((s: any) => ({ offset: s.offset, chain: chainOf(s.paint), alpha: s.alpha })),
      } as PaintDesc;
    } else {
      desc = { kind: 'probe', prop, chain: chainOf(id) };
    }
    if (alpha !== 1) (desc as any).alpha = alpha;
    index = paints.length;
    paints.push(desc);
    paintKey.set(key, index);
    return index;
  };

  const layersOf = new Array(json.items.length).fill(1);
  const tris: number[] = [];
  const points: number[] = [];
  const fills: FillElem[] = [];
  const strokes: StrokeElem[] = [];
  const dotElems: DotElem[] = [];
  for (let p = 0; p < prims.count; p++) {
    const o = p * prims.stride;
    const kind = prims.u32[o], item = prims.u32[o + 1], layer = prims.u32[o + 2], paint = prims.u32[o + 3];
    const alpha = prims.f32[o + 4], first = prims.u32[o + 5], count = prims.u32[o + 6], flags = prims.u32[o + 7];
    layersOf[item] = Math.max(layersOf[item], layer + 1);
    if (kind === KIND_FILL) {
      if (!count) continue;
      const start = tris.length / 2;
      for (let i = first; i < first + count; i++) {
        const v = indices.u32[i] * verts.stride;
        tris.push(verts.f32[v], verts.f32[v + 1]);
      }
      fills.push({ item, layer, paint: paintFor(paint, alpha, 'fill'), first: start, count, ...(flags & PRIM_HALO ? { special: 'halo' as const } : {}) });
    } else if (kind === KIND_STROKE) {
      const polys: [number, number, number][] = [];
      let width = 0.6, round = true, polyStart = -1, closed = false;
      for (let s = first; s < first + count; s++) {
        const r = s * segs.stride;
        const sf = segs.u32[r + 9];
        width = segs.f32[r + 8];
        round = (sf & SEG_ROUND_CAP) !== 0;
        if (sf & SEG_START || polyStart < 0) {
          polyStart = points.length / 2;
          closed = false;
          points.push(segs.f32[r], segs.f32[r + 1]);
        }
        points.push(segs.f32[r + 2], segs.f32[r + 3]);
        if (sf & SEG_CLOSED) closed = true;
        if (sf & SEG_END) {
          let n = points.length / 2 - polyStart;
          if (closed && n > 2) { points.length -= 2; n--; } // closing segment is implied by the closed flag
          polys.push([polyStart, n, closed ? 1 : 0]);
          polyStart = -1;
        }
      }
      if (polyStart >= 0) polys.push([polyStart, points.length / 2 - polyStart, closed ? 1 : 0]);
      strokes.push({ item, layer, paint: paintFor(paint, 1, 'stroke'), polys, width, alpha, cap: round ? 'round' : 'butt' });
    } else if (kind === KIND_DOT) {
      const dpaint = paintFor(paint, 1, 'fill');
      for (let i = first; i < first + count; i++) {
        const r = i * dots.stride;
        dotElems.push({ item, layer, paint: dpaint, x: dots.f32[r], y: dots.f32[r + 1], r: dots.f32[r + 2], alpha: dots.f32[r + 6] });
      }
    }
  }
  const items = json.items.map((it: any, i: number) => ({
    name: it.name,
    key: it.key ?? -1e9, // @back draws before rank 0
    lift: it.lift ?? 0,
    move: [0, 0] as [number, number],
    layers: layersOf[i],
  }));
  return {
    viewBox: json.viewBox,
    svgClass: 'iso-svg',
    chainPrefix: [],
    items,
    paints,
    tris: new Float32Array(tris),
    fills,
    points: new Float32Array(points),
    strokes,
    dots: dotElems,
  };
}
