// DL → plain SVG debug renderer (dependency-free; inlined into the gate page next to dl-format + palette-probe).
// Every primitive is drawn with inline resolved paint, no classes, in DL order (back, then items by rank, prims by
// layer). A fill is ONE path whose subpaths are its triangles: all triangles share one orientation, so shared edges
// cancel in the nonzero winding and the path covers exactly the tessellated region with no triangle seams — the
// pixel gate then measures tessellation coverage, palette, stroke geometry and order, not triangle AA seams.
// Expects LAYOUTS, PRIM_KIND, SEG_FLAG, PAINT_GRADIENT (dl-format) in scope when inlined; imported otherwise.
import { LAYOUTS, PRIM_KIND, SEG_FLAG, PAINT_GRADIENT } from "../export/dl-format.mjs";

const num = (v) => String(Math.round(v * 1e4) / 1e4);
const rgb = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
const words = (name) => LAYOUTS[name].stride / 4;
const field = (name, key) => LAYOUTS[name].fields.findIndex(([f]) => f === key);

function paintOf(paints, id) {
  const p = paints[id];
  return { color: p.color ? rgb(p.color) : "none", alpha: (p.color ? p.color[3] : 1) * p.alpha, p };
}

function effects(p, alpha) {
  const style = [];
  if (p.filter && p.filter !== "none") style.push(`filter:${p.filter}`);
  if (p.transform && p.transform !== "none") style.push(`transform:${p.transform}`);
  if (p.blend && p.blend !== "normal") style.push(`mix-blend-mode:${p.blend}`);
  // a filtered element gets element opacity (applied after the filter, as CSS opacity is in v2)
  return { style: style.length ? ` style="${style.join(";")}"` : "", groupAlpha: p.filter && p.filter !== "none" ? alpha : null };
}

// renderDlSvg(json, sections (dl-format sectionsOf), paints (palette-probe resolvePalette)) → svg markup
export function renderDlSvg(json, sections, paints) {
  const { prims, fillVertices: fv, fillIndices: fi, segments: sg, dots: dt } = sections;
  const P = words("prims");
  const V = words("fillVertices");
  const S = words("segments");
  const D = words("dots");
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
  const ordered = [...json.items].sort((a, b) => a.rank - b.rank);
  for (const item of ordered) {
    for (let p = item.prims[0]; p < item.prims[0] + item.prims[1]; p++) {
      const at = p * P;
      const kind = prims.u32[at + field("prims", "kind")];
      const paintId = prims.u32[at + field("prims", "paint")];
      const primAlpha = prims.f32[at + field("prims", "alpha")];
      const first = prims.u32[at + field("prims", "first")];
      const count = prims.u32[at + field("prims", "count")];
      if (!count) continue;
      const gradient = paintId & PAINT_GRADIENT ? json.gradients[paintId & ~PAINT_GRADIENT] : null;
      const { color, alpha, p: paint } = paintOf(paints, gradient ? gradient.paint : paintId);
      const fillValue = gradient ? `url(#${gradientIds[paintId & ~PAINT_GRADIENT]})` : color;
      const total = (gradient ? paint.alpha : alpha) * primAlpha;
      const fx = effects(paint, total);
      const alphaAttr = (name) => (fx.groupAlpha !== null ? ` opacity="${num(total)}"` : total < 1 ? ` ${name}="${num(total)}"` : "");
      if (kind === PRIM_KIND.fill) {
        let d = "";
        for (let t = first; t < first + count; t += 3) {
          const [a, b, c] = [fi.u32[t], fi.u32[t + 1], fi.u32[t + 2]].map((v) => `${num(fv.f32[v * V])} ${num(fv.f32[v * V + 1])}`);
          d += `M${a}L${b}L${c}Z`;
        }
        out.push(`<path d="${d}" fill="${fillValue}" stroke="none"${alphaAttr("fill-opacity")}${fx.style}/>`);
      } else if (kind === PRIM_KIND.stroke) {
        let d = "";
        let flags = 0;
        let width = 0;
        for (let s = first; s < first + count; s++) {
          const base = s * S;
          flags = sg.u32[base + field("segments", "flags")];
          width = sg.f32[base + field("segments", "width")];
          if (flags & SEG_FLAG.start) d += `M${num(sg.f32[base])} ${num(sg.f32[base + 1])}`;
          d += flags & SEG_FLAG.closed && flags & SEG_FLAG.end ? "Z" : `L${num(sg.f32[base + 2])} ${num(sg.f32[base + 3])}`;
        }
        const cap = flags & SEG_FLAG.capRound ? "round" : "butt";
        const join = flags & SEG_FLAG.joinRound ? "round" : "miter";
        out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${num(width)}" stroke-linecap="${cap}" stroke-linejoin="${join}" vector-effect="non-scaling-stroke"${alphaAttr("stroke-opacity")}${fx.style}/>`);
      } else if (kind === PRIM_KIND.dot) {
        for (let k = first; k < first + count; k++) {
          const base = k * D;
          const dotAlpha = total; // dots merged into one prim share their alpha
          out.push(`<circle cx="${num(dt.f32[base])}" cy="${num(dt.f32[base + 1])}" r="${num(dt.f32[base + 2])}" fill="${color}"${dotAlpha < 1 ? ` fill-opacity="${num(dotAlpha)}"` : ""}${fx.style}/>`);
        }
      }
    }
  }
  return out.join("");
}
