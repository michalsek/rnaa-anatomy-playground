// node tools/test-export.mjs — edge-case checks for the exporter (no Chrome). Exit code 1 on any failure.
import { parsePathData, parseSvg, drawables } from "../export/svgsub.mjs";
import { triangulate, triangleArea, nonzeroArea } from "../export/tess.mjs";
import { primitivesOf, createPalette, createSink, placeSlots, polylinesOf } from "../export/build-dl.mjs";
import { pack, sectionsOf, recordAt, PRIM_KIND, PRIM_FLAG, SEG_FLAG, PAINT_GRADIENT } from "../export/dl-format.mjs";

let failed = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${name}: ${error.message}`);
  }
};
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const fillArea = (d) => {
  const subpaths = parsePathData(d);
  const mesh = triangulate(subpaths);
  return { tri: triangleArea(mesh.positions, mesh.indices), exact: nonzeroArea(subpaths), mesh };
};
const square = (x, y, s, ccw = false) => (ccw ? `M${x} ${y}L${x} ${y + s}L${x + s} ${y + s}L${x + s} ${y}Z` : `M${x} ${y}L${x + s} ${y}L${x + s} ${y + s}L${x} ${y + s}Z`);
const sinkFor = (markup, opts = {}) => {
  const palette = createPalette();
  const sink = createSink();
  primitivesOf(markup, { item: 0, palette, sink, ...opts });
  return { palette, sink };
};

test("single simple ring → earcut, exact area", () => {
  const { tri, exact, mesh } = fillArea(square(0, 0, 10));
  assert(mesh.method === "earcut" && near(tri, 100) && near(exact, 100), `${mesh.method} ${tri} ${exact}`);
});
test("two disjoint squares (multi-subpath) → libtess, union", () => {
  const { tri, exact, mesh } = fillArea(square(0, 0, 10) + square(20, 0, 10));
  assert(mesh.method === "libtess" && near(tri, 200) && near(exact, 200), `${tri} ${exact}`);
});
test("nested same orientation → nonzero keeps the inner square filled", () => {
  const { tri, exact } = fillArea(square(0, 0, 10) + square(2, 2, 4));
  assert(near(tri, 100) && near(exact, 100), `${tri} ${exact} (even-odd would give 84)`);
});
test("nested opposite orientation (mixed) → hole", () => {
  const { tri, exact } = fillArea(square(0, 0, 10) + square(2, 2, 4, true));
  assert(near(tri, 84) && near(exact, 84), `${tri} ${exact}`);
});
test("overlapping same orientation → union, no double cover", () => {
  const { tri, exact } = fillArea(square(0, 0, 10) + square(5, 5, 10));
  assert(near(tri, 175) && near(exact, 175), `${tri} ${exact}`);
});
test("self-intersecting bow-tie → libtess, two triangles of area 25", () => {
  const { tri, exact, mesh } = fillArea("M0 0L10 10L10 0L0 10Z");
  assert(mesh.method === "libtess" && near(tri, 50) && near(exact, 50), `${mesh.method} ${tri} ${exact}`);
});
test("pentagram → nonzero fills the centre", () => {
  const pts = Array.from({ length: 5 }, (_, i) => [50 + 40 * Math.cos(-Math.PI / 2 + (i * 4 * Math.PI) / 5), 50 + 40 * Math.sin(-Math.PI / 2 + (i * 4 * Math.PI) / 5)]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("") + "Z";
  const { tri, exact } = fillArea(d);
  const star = 1.12257 * 40 * 40; // regular pentagram incl. its centre pentagon: ≈ 1.1226 R² (even-odd: ≈ 0.775 R²)
  assert(near(tri, exact, 1e-6 * exact) && near(exact, star, 0.5), `${tri} ${exact} vs ${star}`);
});
test("degenerate: repeated points, zero-length segments, zero-area fill", () => {
  const a = fillArea("M0 0L0 0L10 0L10 0L10 10L0 10L0 0Z");
  assert(near(a.tri, 100), `repeated ${a.tri}`);
  const z = fillArea("M0 0L10 0L20 0Z");
  assert(z.mesh.indices.length === 0 && z.exact === 0, "zero-area fill draws nothing");
});
test("every triangle positively oriented, for both input orientations", () => {
  for (const d of [square(0, 0, 10), square(0, 0, 10, true), square(0, 0, 10) + square(2, 2, 4, true)]) {
    const { mesh } = fillArea(d);
    for (let t = 0; t < mesh.indices.length; t += 3) assert(triangleArea(mesh.positions, mesh.indices.slice(t, t + 3)) > 0, d);
  }
});
test("path data: relative m/l/h/v, implicit lineto, lone M, Z then L restarts at start", () => {
  const s = parsePathData("m1 1 2 0h2v2l-4 0zM9 9m1 1L3 3zL5 5");
  assert(s[0].points.length === 5 && s[0].closed && near(s[0].points[2][0], 5), JSON.stringify(s[0]));
  assert(!s[1].drawn, "lone M is not drawn");
  assert(s[2].points[0][0] === 10 && s[2].closed, "relative m after M");
  assert(s[3].points[0][0] === 10 && s[3].points[1][0] === 5, "L after Z starts at the subpath start");
});
test("polylines: open keeps ends, closed drops the closing duplicate, zero-length only with round caps", () => {
  const [open] = polylinesOf(parsePathData("M0 0L5 0L0 0"), "round");
  assert(open.points.length === 3 && !open.closed, "open path ending on its start keeps its last segment");
  const [closed] = polylinesOf(parsePathData("M0 0L5 0L5 5L0 0Z"), "round");
  assert(closed.points.length === 3 && closed.closed, JSON.stringify(closed));
  assert(polylinesOf(parsePathData("M1 1L1 1"), "round").length === 1, "zero-length round → dot");
  assert(polylinesOf(parsePathData("M1 1L1 1"), "butt").length === 0, "zero-length butt → nothing");
  assert(polylinesOf(parsePathData("M1 1"), "round").length === 0, "lone M → nothing");
});
test("stroke segments: closed polyline emits the closing segment and start/end/closed flags", () => {
  const { sink } = sinkFor(`<path class="iso-line" data-tone="lo" d="M0 0L5 0L5 5Z M10 10L20 10"/>`);
  assert(sink.segments.length === 4, `${sink.segments.length}`);
  const [a, , c, d] = sink.segments;
  assert(a.flags & SEG_FLAG.start && a.flags & SEG_FLAG.closed && c.flags & SEG_FLAG.end && c.x1 === 0, "closing segment back to start");
  assert(d.flags & SEG_FLAG.start && d.flags & SEG_FLAG.end && !(d.flags & SEG_FLAG.closed) && d.flags & SEG_FLAG.capRound, "open polyline");
  assert(near(a.width, 0.6), "default hairline 0.6 CSS px");
});
test("inline stroke-width overrides (tach sync mark)", () => {
  const { sink } = sinkFor(`<path class="iso-line" data-tone="hi" style="stroke-width:1.3" d="M0 0L1 1"/>`);
  assert(near(sink.segments[0].width, 1.3) && sink.segments[0].flags & SEG_FLAG.widthOverride, "1.3 with override flag");
});
test("dot groups: one run per (paint, alpha), tone in the palette key, fill-opacity → alpha", () => {
  const { sink, palette } = sinkFor(`<g class="iso-dots" data-tone="mid"><circle cx="1" cy="1" r="0.4"/><circle cx="2" cy="1" r="0.4"/><circle cx="3" cy="1" r="0.4" fill-opacity="0.50"/></g><g class="iso-dots" data-tone="hi"><circle cx="1" cy="2" r="0.4"/></g>`);
  assert(sink.dots.length === 4 && sink.prims.length === 3, `${sink.dots.length} dots ${sink.prims.length} prims`);
  assert(sink.dots[2].alpha === 0.5 && palette.entries.length === 2, "alpha 0.5, two tones");
  assert(palette.entries[0].alphaAttrs.some((a) => a.name === "fill-opacity" && a.at === -1), "alpha attribute location recorded");
});
test("tubes: tb-ring butt caps 0.45 with opacity attr, tb-edge round", () => {
  const { sink } = sinkFor(`<g class="tb"><path class="tb-body" d="${square(0, 0, 4)}"/><path class="tb-ring" data-tone="lo" d="M0 0L0 4" opacity="0.40"/><path class="iso-line tb-edge" data-tone="mid" d="M0 0L4 0"/></g>`);
  const ring = sink.segments.find((s) => near(s.width, 0.45));
  assert(ring && !(ring.flags & SEG_FLAG.capRound) && near(ring.alpha, 0.4), "ring");
  assert(sink.segments.some((s) => near(s.width, 0.6) && s.flags & SEG_FLAG.capRound), "edge");
});
test("gradient: url(#id) fill → gradient record with stop palette ids", () => {
  const { sink, palette } = sinkFor(`<defs><linearGradient id="v" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="10"><stop offset="0" class="cf-void-0"/><stop offset="1" class="cf-void-2"/></linearGradient></defs><path class="cf-void" fill="url(#v)" d="${square(0, 0, 10)}"/>`);
  const prim = sink.prims[0];
  assert(prim.paint & PAINT_GRADIENT && prim.flags & PRIM_FLAG.gradient, "gradient paint bit");
  const g = sink.gradients[0];
  assert(g.stops.length === 2 && palette.entries[g.stops[1].paint].prop === "stop-color" && g.y2 === 10, JSON.stringify(g));
});
test("group opacity multiplies; multi-child opacity groups are flagged", () => {
  const { sink } = sinkFor(`<g opacity="0.5"><g opacity="0.5"><path class="iso-line" d="M0 0L1 0"/></g></g><g opacity="0.5"><path class="iso-line" d="M0 0L1 0"/><path class="iso-line" d="M0 1L1 1"/></g>`);
  assert(near(sink.segments[0].alpha, 0.25) && !(sink.prims[0].flags & PRIM_FLAG.groupOpacity), "nested 0.25");
  assert(sink.prims[1].flags & PRIM_FLAG.groupOpacity, "multi-child group flagged");
});
test("halo and seamless solids", () => {
  const { sink, palette } = sinkFor(`<path class="iso-halo" d="${square(0, 0, 10)}"/><g class="iso-solid" data-seamless=""><path class="iso-fill" d="${square(0, 0, 4)}"/><path class="iso-shade" data-shade="1" d="${square(0, 0, 2)}"/><path class="iso-top" d="${square(2, 2, 2)}"/></g>`);
  assert(sink.prims[0].flags & PRIM_FLAG.halo, "halo flag");
  const kinds = sink.prims.map((p) => p.kind).join("");
  assert(kinds === `${PRIM_KIND.fill}${PRIM_KIND.fill}${PRIM_KIND.fill}${PRIM_KIND.stroke}${PRIM_KIND.fill}${PRIM_KIND.stroke}`, kinds);
  const seam = sink.segments[0];
  assert(near(seam.width, 0.4) && seam.flags & SEG_FLAG.closed && !(seam.flags & SEG_FLAG.capRound) && seam.flags & SEG_FLAG.joinRound, "0.4 closed butt/round");
  assert(palette.entries[sink.prims[3].paint].prop === "stroke" && palette.entries[sink.prims[2].paint].prop === "fill", "separate fill / stroke keys");
  assert(sink.prims.map((p) => p.layer).join() === "0,1,2,3,4,5", "fill then stroke layers in document order");
});
test("unknown classes, curves, unsupported elements and styles throw", () => {
  for (const markup of [`<path class="mystery" d="M0 0L1 1"/>`, `<path class="iso-line" d="M0 0C1 1 2 2 3 3"/>`, `<rect class="iso-fill"/>`, `<path class="iso-line" style="stroke:red" d="M0 0L1 0"/>`, `<text>hi</text>`]) {
    let threw = false;
    try {
      sinkFor(markup);
    } catch {
      threw = true;
    }
    assert(threw, markup);
  }
});
test("palette key ignores names/routes/geometry/alpha, keeps class/data context", () => {
  const { palette } = sinkFor(`<g class="it fx-graphite" data-name="a" data-route="r"><path class="iso-line" data-tone="lo" d="M0 0L1 0"/></g><g class="it fx-graphite" data-name="b"><path class="iso-line" data-tone="lo" opacity="0.5" d="M5 5L6 0"/></g><g class="it"><path class="iso-line" data-tone="lo" d="M0 0L1 0"/></g>`);
  assert(palette.entries.length === 2, `${palette.entries.length} entries`);
});
test("slot placement (v2 rules): after → latest target, before → earliest, a name matches its first #n, missing throws", () => {
  const items = ["a", "b", "b#2", "c"].map((name) => ({ name }));
  const slots = placeSlots(items, [{ name: "s1", after: "b" }, { name: "s2", before: ["c", "b"] }, { name: "s3", after: ["a", "c"] }]);
  assert(slots[0].anchor === 1 && slots[0].insertAt === 2, JSON.stringify(slots[0])); // findIndex: the first of b / b#2 (as kit.mjs)
  assert(slots[1].anchor === 1 && slots[1].insertAt === 1, JSON.stringify(slots[1]));
  assert(slots[2].insertAt === 4 && slots[2].seq > slots[0].seq, JSON.stringify(slots[2]));
  let threw = false;
  try {
    placeSlots(items, [{ name: "x", after: "zzz" }]);
  } catch {
    threw = true;
  }
  assert(threw, "missing target throws");
});
test("binary round trip", () => {
  const { sink } = sinkFor(`<path class="iso-fill" d="${square(0, 0, 10)}"/><path class="iso-line" d="M0 0L1 1"/><g class="iso-dots"><circle cx="1" cy="2" r="0.4"/></g>`);
  const { buffer } = pack(sink);
  const S = sectionsOf(buffer);
  assert(S.fillIndices.count === sink.fillIndices.length && S.fillIndices.u32[2] === sink.fillIndices[2], "indices");
  const seg = recordAt(S.segments, 0);
  assert(seg.x1 === 1 && near(seg.width, 0.6) && seg.flags === sink.segments[0].flags, JSON.stringify(seg));
  assert(recordAt(S.dots, 0).cy === 2 && recordAt(S.prims, 2).kind === PRIM_KIND.dot, "dots");
});
test("svgsub keeps the chain and resolves entities", () => {
  const { elements } = drawables(parseSvg(`<g class="a &amp; b"><g data-x="1"><path class="iso-line" d="M0 0L1 0"/></g></g>`));
  assert(elements[0].chain.length === 2 && elements[0].chain[0].attrs.class === "a & b", "chain");
});

// live slot markup the M3 adapter will feed through primitivesOf (built with the real kit, read-only import)
const { k } = await import("../../v2-factory/shared/kit.mjs");
test("live slot markup: packet, lamp glow (blend), strobe, tach needle", () => {
  const P = k.fitProjection([[0, 0, 0], [100, 100, 100]], 640, 760, { pad: 30 });
  const plan = { x: 10, y: 10, w: 10, d: 8, r: 0.6 };
  const packet = `<g class="pk" data-kind="graph" opacity="0.60">${k.solidSvg(k.slabOf(plan, 5, 7, P, 2, 0.3), { tone: "hi" })}${k.lineSvg(k.sideSeam(plan, 8, P, 2), { tone: "lo" })}</g>`;
  const glow = `<circle class="cf-glow-soft" cx="10" cy="10" r="4" opacity="0.150"/><circle class="cf-glow" cx="10" cy="10" r="2" opacity="0.850"/>`;
  const tach = `<g class="it fx-graphite"><path class="iso-line" data-tone="hi" data-free="" style="stroke-width:1" d="M0 0L3 3"/>${k.dotsSvg([[1, 1]], { size: 0.8, tone: "hi" })}</g>`;
  const { sink, palette } = sinkFor(packet + glow + `<path class="cf-strobe" d="${square(0, 0, 3)}"/>` + tach);
  assert(sink.prims.some((p) => p.flags & PRIM_FLAG.blend), "glow flagged blend");
  assert(sink.segments.some((s) => near(s.alpha, 0.6)) && sink.fillVertices.some((v) => near(v.alpha, 0.6)), "packet opacity folded");
  assert(palette.entries.some((e) => e.ancestors.some((a) => a.attrs["data-kind"] === "graph")), "packet kind in the palette key");
  assert(sink.segments.some((s) => s.width === 1 && s.flags & SEG_FLAG.widthOverride), "tach needle width 1");
});

console.log(failed ? `${failed} failed` : "all passed");
process.exitCode = failed ? 1 : 0;
