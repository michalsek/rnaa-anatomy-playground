// DL → plain SVG debug renderer (dependency-free apart from dl-format; bundled into the gate page). Every primitive is
// drawn with inline resolved paint, no classes, in the stored prim order (the DL's draw order). A fill is ONE path
// whose subpaths are its triangles: all triangles share one orientation, so shared edges cancel in the nonzero winding
// and the path covers exactly the tessellated region with no triangle seams — the pixel gate then measures
// tessellation coverage, palette, stroke geometry and order, not triangle AA seams.
// Strokes are rebuilt from every segment field, so a wrong field shows up as pixels: a continuation segment whose
// start is not the previous end starts a new subpath (extra caps), a closing segment is drawn as `Z` only when it
// really ends at its polyline's start, and a change of width / cap / join / alpha inside a prim starts a new <path>.
import { FIELD_WORD, STRIDE_WORDS, PRIM_KIND, SEG_FLAG, isGradientPaint, gradientIndexOf } from "../export/dl-format.mjs";

const num = (v) => String(Math.round(v * 1e4) / 1e4);
const rgb = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
const PRIM = FIELD_WORD.prims;
const VERTEX = FIELD_WORD.fillVertices;
const SEGMENT = FIELD_WORD.segments;
const DOT = FIELD_WORD.dots;

function paintOf(paints, id) {
  const p = paints[id];
  return { color: p.color ? rgb(p.color) : "none", alpha: (p.color ? p.color[3] : 1) * p.alpha, p };
}

// effects(paint) → inline style for the halo filter / transform and blend mode; a filtered element takes its alpha as
// element opacity, applied after the filter (as the CSS opacity in v2)
function effects(p) {
  const style = [];
  const hasFilter = Boolean(p.filter && p.filter !== "none");
  if (hasFilter) style.push(`filter:${p.filter}`);
  if (p.transform && p.transform !== "none") style.push(`transform:${p.transform}`);
  if (p.blend && p.blend !== "normal") style.push(`mix-blend-mode:${p.blend}`);
  return { style: style.length ? ` style="${style.join(";")}"` : "", hasFilter };
}

// renderDlSvg(json, sections (dl-format sectionsOf), paints (palette-probe resolvePalette)) → svg markup
export function renderDlSvg(json, sections, paints) {
  const { prims, fillVertices, fillIndices, segments, dots } = sections;
  const out = [];
  const gradientIds = json.gradients.map((g, i) => {
    const id = `dl-gradient-${i}`;
    const stops = g.stops.map((s) => {
      const { color, alpha } = paintOf(paints, s.paint);
      return `<stop offset="${s.offset}" stop-color="${color}" stop-opacity="${num(alpha * s.alpha)}"/>`;
    });
    out.push(`<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}">${stops.join("")}</linearGradient></defs>`);
    return id;
  });
  for (let p = 0; p < prims.count; p++) {
    const word = (field) => p * STRIDE_WORDS.prims + PRIM[field];
    const kind = prims.u32[word("kind")];
    const paintId = prims.u32[word("paint")];
    const first = prims.u32[word("first")];
    const count = prims.u32[word("count")];
    if (!count) continue;
    const gradient = isGradientPaint(paintId) ? json.gradients[gradientIndexOf(paintId)] : null;
    const { color, alpha: paintAlpha, p: paint } = paintOf(paints, gradient ? gradient.paint : paintId);
    const baseAlpha = gradient ? paint.alpha : paintAlpha;
    const fx = effects(paint);
    const alphaAttr = (name, alpha) => (fx.hasFilter ? ` opacity="${num(alpha)}"` : alpha < 1 ? ` ${name}="${num(alpha)}"` : "");
    if (kind === PRIM_KIND.fill) {
      const fillValue = gradient ? `url(#${gradientIds[gradientIndexOf(paintId)]})` : color;
      const vertex = (v) => `${num(fillVertices.f32[v * STRIDE_WORDS.fillVertices + VERTEX.x])} ${num(fillVertices.f32[v * STRIDE_WORDS.fillVertices + VERTEX.y])}`;
      let d = "";
      for (let t = first; t < first + count; t += 3) d += `M${vertex(fillIndices.u32[t])}L${vertex(fillIndices.u32[t + 1])}L${vertex(fillIndices.u32[t + 2])}Z`;
      out.push(`<path d="${d}" fill="${fillValue}" stroke="none"${alphaAttr("fill-opacity", baseAlpha * prims.f32[word("alpha")])}${fx.style}/>`);
    } else if (kind === PRIM_KIND.stroke) {
      for (const run of strokeRuns(segments, first, count)) {
        const cap = run.flags & SEG_FLAG.capRound ? "round" : "butt";
        const join = run.flags & SEG_FLAG.joinRound ? "round" : "miter";
        out.push(`<path d="${run.d}" fill="none" stroke="${color}" stroke-width="${num(run.width)}" stroke-linecap="${cap}" stroke-linejoin="${join}" vector-effect="non-scaling-stroke"${alphaAttr("stroke-opacity", baseAlpha * run.alpha)}${fx.style}/>`);
      }
    } else if (kind === PRIM_KIND.dot) {
      for (let k = first; k < first + count; k++) {
        const field = (name) => dots.f32[k * STRIDE_WORDS.dots + DOT[name]];
        const alpha = baseAlpha * field("alpha");
        out.push(`<circle cx="${num(field("cx"))}" cy="${num(field("cy"))}" r="${num(field("r"))}" fill="${color}"${alpha < 1 ? ` fill-opacity="${num(alpha)}"` : ""}${fx.style}/>`);
      }
    }
  }
  return out.join("");
}

const STYLE_FLAGS = SEG_FLAG.capRound | SEG_FLAG.joinRound;

// strokeRuns(segments, first, count) → [{ d, width, flags, alpha }]: one run per stretch of segments with the same
// width / cap / join / alpha
function strokeRuns(segments, first, count) {
  const runs = [];
  let run = null;
  let pen = null; // end of the previous segment
  let subpathStart = null; // point of the last M
  let needsMove = true;
  for (let s = first; s < first + count; s++) {
    const field = (name) => segments.f32[s * STRIDE_WORDS.segments + SEGMENT[name]];
    const flags = segments.u32[s * STRIDE_WORDS.segments + SEGMENT.flags];
    const [x0, y0, x1, y1, width, alpha] = [field("x0"), field("y0"), field("x1"), field("y1"), field("width"), field("alpha")];
    if (!run || run.width !== width || run.alpha !== alpha || (run.flags & STYLE_FLAGS) !== (flags & STYLE_FLAGS)) {
      run = { d: "", width, flags, alpha };
      runs.push(run);
      needsMove = true;
    }
    if (needsMove || flags & SEG_FLAG.start || pen[0] !== x0 || pen[1] !== y0) {
      run.d += `M${num(x0)} ${num(y0)}`;
      subpathStart = [x0, y0];
    }
    const closesSubpath = flags & SEG_FLAG.closed && flags & SEG_FLAG.end && x1 === subpathStart[0] && y1 === subpathStart[1];
    run.d += closesSubpath ? "Z" : `L${num(x1)} ${num(y1)}`;
    pen = [x1, y1];
    needsMove = Boolean(flags & SEG_FLAG.end);
  }
  return runs;
}
