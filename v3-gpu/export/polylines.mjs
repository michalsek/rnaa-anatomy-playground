// How SVG strokes path data: subpaths → polylines (shared by the exporter and the renderer's live slots), and the
// polygon a stroked <circle> becomes.
import { samePoint, withoutRepeats } from "./tess.mjs";

export const CIRCLE_STEPS = 32;

// ringOfCircle(cx, cy, r) → CIRCLE_STEPS points on the circle (a stroked circle is drawn as this closed polyline)
export const ringOfCircle = (cx, cy, r) => Array.from({ length: CIRCLE_STEPS }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / CIRCLE_STEPS), cy + r * Math.sin((2 * Math.PI * i) / CIRCLE_STEPS)]);

// polylinesOf(subpaths, cap) → [{ points, closed }] as SVG strokes them: a lone moveto draws nothing; a zero-length
// subpath (open or closed) draws only with round caps, as one zero-length segment (a dot)
export function polylinesOf(subpaths, cap) {
  const out = [];
  for (const sp of subpaths) {
    if (!sp.drawn) continue;
    const points = withoutRepeats(sp.points);
    if (sp.closed && points.length > 1 && samePoint(points[0], points[points.length - 1])) points.pop();
    if (points.length === 1) {
      if (cap === "round") out.push({ points: [points[0], points[0]], closed: false });
      continue;
    }
    out.push({ points, closed: sp.closed });
  }
  return out;
}
