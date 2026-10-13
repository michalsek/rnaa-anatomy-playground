// M1 display list v1 (notes/DL-FORMAT.md, export/dl-format.mjs) → GpuScene. The binary is validated and read through
// dl-format's own tables (sectionsOf checks magic, version, strides and bounds; FIELD_WORD / STRIDE_WORDS address the
// records), so this module never re-declares an offset or a flag.
// - fills: indexed triangles → triangle-list ranges; record alpha stays per element (fill vertices carry it);
// - strokes: segments → polylines (start / end / closed flags) with the record's CSS width and cap;
// - dots: one per circle; gradient paint ids → 'linear' palette entries appended after the probes;
// - the back item (`@back`, key null) sorts before every scene item.
import { FIELD_WORD, PRIM_FLAG, PRIM_KIND, SEG_FLAG, STRIDE_WORDS, gradientIndexOf, isGradientPaint, sectionsOf, type DlJson } from '../../export/dl-format.mjs';
import type { DotElem, FillElem, GpuScene, ScenePaint, StrokeElem } from './scene.ts';
import { paintKeyOf } from '../../export/palette-key.mjs';

const SUPPORTED_VERSION = 1;
/** The back item has no key: it sorts before every scene item. */
const BACK_KEY = -Infinity;

/**
 * The scene palette in id order — probe recipes, then one linear entry per gradient — from the JSON half alone, so a
 * host can register the palette before the binary half is decoded (`sceneFromDl` returns the same entries).
 */
export function paletteOfDl(json: DlJson): ScenePaint[] {
  if (json.format !== 'rnaa-dl' || json.version !== SUPPORTED_VERSION) throw new Error(`dl-loader: unsupported ${json.format} v${json.version}`);
  const palette: ScenePaint[] = json.palette.map((entry, id) => {
    if (entry.id !== id) throw new Error(`dl-loader: palette entry ${entry.id} at position ${id}`);
    return { key: paintKeyOf(entry.prop, entry.ancestors, entry.el), desc: { kind: 'probe', prop: entry.prop, ancestors: entry.ancestors, el: entry.el } };
  });
  for (const g of json.gradients) {
    if (g.units !== 'userSpaceOnUse') throw new Error(`dl-loader: gradient ${g.id} units ${g.units} not supported`);
    palette.push({ key: `dl-gradient:${g.id}`, desc: { kind: 'linear', x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, paint: g.paint, stops: g.stops.map((s) => ({ offset: s.offset, alpha: s.alpha, paint: s.paint })) } });
  }
  return palette;
}

export function sceneFromDl(json: DlJson, bin: ArrayBuffer): GpuScene {
  const palette = paletteOfDl(json);
  const { prims, fillVertices, fillIndices, segments, dots } = sectionsOf(bin);
  const gradientBase = json.palette.length;
  const paintOf = (id: number) => (isGradientPaint(id) ? gradientBase + gradientIndexOf(id) : id);

  const P = FIELD_WORD.prims, V = FIELD_WORD.fillVertices, G = FIELD_WORD.segments, D = FIELD_WORD.dots;
  const layersOf = new Array<number>(json.items.length).fill(1);
  const tris: number[] = [];
  const points: number[] = [];
  const fills: FillElem[] = [];
  const strokes: StrokeElem[] = [];
  const dotElems: DotElem[] = [];
  for (let p = 0; p < prims.count; p++) {
    const o = p * STRIDE_WORDS.prims;
    const kind = prims.u32[o + P.kind], item = prims.u32[o + P.item], layer = prims.u32[o + P.layer], paint = prims.u32[o + P.paint];
    const alpha = prims.f32[o + P.alpha], first = prims.u32[o + P.first], count = prims.u32[o + P.count], flags = prims.u32[o + P.flags];
    layersOf[item] = Math.max(layersOf[item], layer + 1);
    if (kind === PRIM_KIND.fill) {
      if (!count) continue;
      const start = tris.length / 2;
      for (let i = first; i < first + count; i++) {
        const v = fillIndices.u32[i] * STRIDE_WORDS.fillVertices;
        tris.push(fillVertices.f32[v + V.x], fillVertices.f32[v + V.y]);
      }
      fills.push({ item, layer, paint: paintOf(paint), alpha, first: start, count, halo: (flags & PRIM_FLAG.halo) !== 0 });
    } else if (kind === PRIM_KIND.stroke) {
      if (!count) continue;
      const polys: [number, number, boolean][] = [];
      let width = 0;
      let round = true;
      let polyStart = -1;
      let closed = false;
      for (let s = first; s < first + count; s++) {
        const r = s * STRIDE_WORDS.segments;
        const segFlags = segments.u32[r + G.flags];
        width = segments.f32[r + G.width];
        round = (segFlags & SEG_FLAG.capRound) !== 0;
        if (segFlags & SEG_FLAG.start || polyStart < 0) {
          polyStart = points.length / 2;
          closed = false;
          points.push(segments.f32[r + G.x0], segments.f32[r + G.y0]);
        }
        points.push(segments.f32[r + G.x1], segments.f32[r + G.y1]);
        if (segFlags & SEG_FLAG.closed) closed = true;
        if (segFlags & SEG_FLAG.end) {
          let n = points.length / 2 - polyStart;
          // a closed polyline's last segment returns to its first point; the closed flag implies that segment
          if (closed && n > 2) {
            points.length -= 2;
            n--;
          }
          polys.push([polyStart, n, closed]);
          polyStart = -1;
        }
      }
      if (polyStart >= 0) polys.push([polyStart, points.length / 2 - polyStart, closed]);
      strokes.push({ item, layer, paint: paintOf(paint), alpha, polys, width, cap: round ? 'round' : 'butt' });
    } else if (kind === PRIM_KIND.dot) {
      for (let i = first; i < first + count; i++) {
        const r = i * STRIDE_WORDS.dots;
        dotElems.push({ item, layer, paint: paintOf(paint), x: dots.f32[r + D.cx], y: dots.f32[r + D.cy], r: dots.f32[r + D.r], alpha: dots.f32[r + D.alpha] });
      }
    } else {
      throw new Error(`dl-loader: prim ${p} has unknown kind ${kind}`);
    }
  }
  const items = json.items.map((it, i) => ({ name: it.name, key: it.key ?? BACK_KEY, lift: it.lift ?? 0, move: [0, 0] as [number, number], layers: layersOf[i] }));
  return { viewBox: json.viewBox, svgClass: 'iso-svg', items, palette, tris: new Float32Array(tris), fills, points: new Float32Array(points), strokes, dots: dotElems };
}
