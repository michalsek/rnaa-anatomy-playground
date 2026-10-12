// Helpers shared by the scanner and the elevator (kept in this part's folder; shared/ is not edited).
import { k, G, T, A } from "../../shared/kit.mjs";

// A straight bar of rectangular section w (along u) × h (along v) from a to b: diagonal braces, rails, rungs, arms.
// `u` is a direction across the bar (it is made perpendicular to the bar); the section's v is the cross product.
export function bar(ctx, name, a, b, w, h, style = {}, { u = [0, 0, 1], bias = 0, inner = "", extra = "" } = {}) {
  const axis = G.sub3(b, a);
  const len = G.len3(axis);
  const ax = G.unit3(axis);
  let uu = G.sub3(u, G.mul3(ax, G.dot3(u, ax)));
  if (G.len3(uu) < 1e-6) uu = G.cross3(ax, [1, 0, 0]);
  uu = G.unit3(uu);
  const vv = G.cross3(ax, uu);
  const F = { o: a, a: ax, u: uu, v: vv };
  const poly = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  const paths = G.prismOf(F, poly, 0, len, ctx.P);
  const shape = ctx.record(A.prism(F, poly, 0, len, { name }));
  ctx.put(name, G.add3(a, G.mul3(ax, len / 2)), ctx.S(paths, { tone: "mid", ...style, inner }) + extra, [shape], { bias });
  return F;
}

// A prism of any convex polygon (in the frame's u, v plane) along F.a from s0 to s1.
export function slabAlong(ctx, name, F, poly, s0, s1, style = {}, { bias = 0, inner = "", extra = "", ref } = {}) {
  const paths = G.prismOf(F, poly, s0, s1, ctx.P);
  const shape = ctx.record(A.prism(F, poly, s0, s1, { name }));
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  const mid = G.add3(F.o, G.add3(G.mul3(F.a, (s0 + s1) / 2), G.add3(G.mul3(F.u, cx), G.mul3(F.v, cy))));
  ctx.put(name, ref ?? mid, ctx.S(paths, { tone: "mid", ...style, inner }) + extra, [shape], { bias });
}

// A cable like ctx.cable, but every chunk also carries a hidden copy of its body (`.fx-pulse`, filled mint by the page)
// and its arc-length span, so the page can run a pulse along the cable chunk by chunk in true painter's order.
export function pulseCable(ctx, name, points, r = 0.9, { bend = 4, shells = [true, true], maxLength = 10, bias = 0.05, limp = true, tone = "mid" } = {}) {
  const { R, P } = ctx;
  const route = G.fillet(points, Math.max(bend, r * 2.6), 10, { P, tube: r });
  const total = G.pathLength(route);
  const SHELL = Math.max(1.8, r * 2.2);
  const gaps = [...(shells[0] ? [[0, SHELL]] : []), ...(shells[1] ? [[total - SHELL, total]] : [])];
  R.route(name, route, r, { gaps, limp, rims: shells.map((on) => (on ? r * 1.6 : r)) });
  ctx.routes[name] = route;
  T.tubePieces(route, r, P, { maxLength, spacing: Math.max(0.6, Math.min(1.6, r)), gaps }).forEach((piece) => {
    const svg = T.tubeSvg(piece, { tone }).replace('<path class="iso-line tb-edge"', `<path class="fx-pulse" d="${piece.body}" style="fill:var(--pk-audio-face);opacity:0"/><path class="iso-line tb-edge"`);
    ctx.put(`${name}:chunk`, piece.mid, svg, [A.tube(piece.points, piece.radii)], { bias, attrs: ` data-route="${name}" data-span="${(piece.from / total).toFixed(4)},${(piece.to / total).toFixed(4)}"` });
  });
  [0, 1].forEach((index) => {
    if (!shells[index]) return;
    const end = index ? route[route.length - 1] : route[0];
    const tangent = G.tangentAlong(route, index ? total : 0);
    const F = G.frameAlong(end, tangent);
    const [s0, s1] = index ? [-SHELL, 0] : [0, SHELL];
    const shape = ctx.record(A.disc(F, s0, s1, r * 1.6, { name: `${name}.shell${index}`, owner: name }));
    ctx.put(`${name}.shell${index}`, G.add3(end, G.mul3(tangent, (s0 + s1) / 2)), ctx.S(G.disc(s0, s1, r * 1.6, F, ctx.P, { steps: 24, bevel: 0.2 }), { tone: "mid" }), [shape], { bias: bias + 0.1 });
  });
  return route;
}

// Screws on a vertical face: dots with rings, as for ctx.screws but in the face plane (axis "x" face normal or "y").
export function faceScrews(ctx, points, axis, { ring = 0.9, size = 0.42 } = {}) {
  const rings = points.map((p) => k.sideRing(p, ring, axis, ctx.P, 12)).join("");
  return ctx.Ln(rings, { tone: "lo" }) + ctx.Dots(points.map(ctx.at), { size });
}
