// node tools/test-export.mjs — edge-case checks for the exporter, the binary format and the debug renderer (no
// Chrome). Exit code 1 on any failure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { parsePathData, parseSvg, drawables } from "../export/svgsub.mjs";
import { triangulate, triangleArea, nonzeroArea } from "../export/tess.mjs";
import { primitivesOf, createPalette, createSink, placeSlots, polylinesOf } from "../export/build-dl.mjs";
import { pack, sectionsOf, recordAt, PRIM_KIND, PRIM_FLAG, SEG_FLAG, PAINT_GRADIENT, gradientPaint, isGradientPaint, gradientIndexOf } from "../export/dl-format.mjs";
import { renderDlSvg } from "./dl2svg.mjs";

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
  assert.ok(mesh.method === "earcut" && near(tri, 100) && near(exact, 100), `${mesh.method} ${tri} ${exact}`);
});
test("two disjoint squares (multi-subpath) → libtess, union", () => {
  const { tri, exact, mesh } = fillArea(square(0, 0, 10) + square(20, 0, 10));
  assert.ok(mesh.method === "libtess" && near(tri, 200) && near(exact, 200), `${tri} ${exact}`);
});
test("nested same orientation → nonzero keeps the inner square filled", () => {
  const { tri, exact } = fillArea(square(0, 0, 10) + square(2, 2, 4));
  assert.ok(near(tri, 100) && near(exact, 100), `${tri} ${exact} (even-odd would give 84)`);
});
test("nested opposite orientation (mixed) → hole", () => {
  const { tri, exact } = fillArea(square(0, 0, 10) + square(2, 2, 4, true));
  assert.ok(near(tri, 84) && near(exact, 84), `${tri} ${exact}`);
});
test("overlapping same orientation → union, no double cover", () => {
  const { tri, exact } = fillArea(square(0, 0, 10) + square(5, 5, 10));
  assert.ok(near(tri, 175) && near(exact, 175), `${tri} ${exact}`);
});
test("self-intersecting bow-tie → libtess, two triangles of area 25", () => {
  const { tri, exact, mesh } = fillArea("M0 0L10 10L10 0L0 10Z");
  assert.ok(mesh.method === "libtess" && near(tri, 50) && near(exact, 50) && mesh.simpleRings[0] === false, `${mesh.method} ${tri} ${exact}`);
});
test("pentagram → nonzero fills the centre", () => {
  const pts = Array.from({ length: 5 }, (_, i) => [50 + 40 * Math.cos(-Math.PI / 2 + (i * 4 * Math.PI) / 5), 50 + 40 * Math.sin(-Math.PI / 2 + (i * 4 * Math.PI) / 5)]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("") + "Z";
  const { tri, exact } = fillArea(d);
  const star = 1.12257 * 40 * 40; // regular pentagram incl. its centre pentagon: ≈ 1.1226 R² (even-odd: ≈ 0.775 R²)
  assert.ok(near(tri, exact, 1e-6 * exact) && near(exact, star, 0.5), `${tri} ${exact} vs ${star}`);
});
test("degenerate: repeated points, zero-length segments, zero-area fill", () => {
  const a = fillArea("M0 0L0 0L10 0L10 0L10 10L0 10L0 0Z");
  assert.ok(near(a.tri, 100), `repeated ${a.tri}`);
  const z = fillArea("M0 0L10 0L20 0Z");
  assert.ok(z.mesh.indices.length === 0 && z.exact === 0, "zero-area fill draws nothing");
});
test("every triangle positively oriented, for both input orientations; no unused vertices", () => {
  for (const d of [square(0, 0, 10), square(0, 0, 10, true), square(0, 0, 10) + square(2, 2, 4, true), "M0 0L5 0L10 0L10 10L0 10Z"]) {
    const { mesh } = fillArea(d);
    for (let t = 0; t < mesh.indices.length; t += 3) assert.ok(triangleArea(mesh.positions, mesh.indices.slice(t, t + 3)) > 0, d);
    assert.equal(new Set(mesh.indices).size, mesh.positions.length, `${d}: every position indexed`);
  }
});
test("path data: relative m/l/h/v, implicit lineto, lone M, Z then L restarts at start", () => {
  const s = parsePathData("m1 1 2 0h2v2l-4 0zM9 9m1 1L3 3zL5 5");
  assert.ok(s[0].points.length === 5 && s[0].closed && near(s[0].points[2][0], 5), JSON.stringify(s[0]));
  assert.ok(!s[1].drawn, "lone M is not drawn");
  assert.ok(s[2].points[0][0] === 10 && s[2].closed, "relative m after M");
  assert.ok(s[3].points[0][0] === 10 && s[3].points[1][0] === 5, "L after Z starts at the subpath start");
  assert.equal(parsePathData("M1,2 3,4").at(0).points.at(1)[1], 4, "comma separators");
});
test("polylines: open keeps ends, closed drops the closing duplicate, zero-length (open or closed) only with round caps", () => {
  const [open] = polylinesOf(parsePathData("M0 0L5 0L0 0"), "round");
  assert.ok(open.points.length === 3 && !open.closed, "open path ending on its start keeps its last segment");
  const [closed] = polylinesOf(parsePathData("M0 0L5 0L5 5L0 0Z"), "round");
  assert.ok(closed.points.length === 3 && closed.closed, JSON.stringify(closed));
  assert.equal(polylinesOf(parsePathData("M1 1L1 1"), "round").length, 1, "zero-length round → dot");
  assert.equal(polylinesOf(parsePathData("M1 1L1 1"), "butt").length, 0, "zero-length butt → nothing");
  assert.equal(polylinesOf(parsePathData("M1 1"), "round").length, 0, "lone M → nothing");
  const [closedDot] = polylinesOf(parsePathData("M1 1Z"), "round");
  assert.ok(closedDot && !closedDot.closed && closedDot.points.length === 2, "closed zero-length round → one zero-length segment");
  assert.equal(polylinesOf(parsePathData("M1 1Z"), "butt").length, 0, "closed zero-length butt → nothing");
});
test("stroke segments: closed polyline emits the closing segment and start/end/closed flags", () => {
  const { sink } = sinkFor(`<path class="iso-line" data-tone="lo" d="M0 0L5 0L5 5Z M10 10L20 10"/>`);
  assert.equal(sink.segments.length, 4);
  const [a, , c, d] = sink.segments;
  assert.ok(a.flags & SEG_FLAG.start && a.flags & SEG_FLAG.closed && c.flags & SEG_FLAG.end && c.x1 === 0, "closing segment back to start");
  assert.ok(d.flags & SEG_FLAG.start && d.flags & SEG_FLAG.end && !(d.flags & SEG_FLAG.closed) && d.flags & SEG_FLAG.capRound, "open polyline");
  assert.ok(near(a.width, 0.6), "default hairline 0.6 CSS px");
});
test("inline stroke-width overrides (tach sync mark), with or without px", () => {
  for (const value of ["1.3", "1.3px"]) {
    const { sink } = sinkFor(`<path class="iso-line" data-tone="hi" style="stroke-width:${value}" d="M0 0L1 1"/>`);
    assert.ok(near(sink.segments[0].width, 1.3) && sink.segments[0].flags & SEG_FLAG.widthOverride, value);
  }
});
test("dot groups: one run per (paint, alpha), tone in the palette key, fill-opacity → alpha", () => {
  const { sink, palette } = sinkFor(`<g class="iso-dots" data-tone="mid"><circle cx="1" cy="1" r="0.4"/><circle cx="2" cy="1" r="0.4"/><circle cx="3" cy="1" r="0.4" fill-opacity="0.50"/></g><g class="iso-dots" data-tone="hi"><circle cx="1" cy="2" r="0.4"/></g>`);
  assert.ok(sink.dots.length === 4 && sink.prims.length === 3, `${sink.dots.length} dots ${sink.prims.length} prims`);
  assert.ok(sink.dots[2].alpha === 0.5 && palette.entries.length === 2, "alpha 0.5, two tones");
  assert.ok(palette.entries[0].alphaAttrs.some((a) => a.name === "fill-opacity" && a.at === -1), "alpha attribute location recorded");
});
test("tubes: tb-ring butt caps 0.45 with opacity attr, iso-line tb-edge round", () => {
  const { sink } = sinkFor(`<g class="tb"><path class="tb-body" d="${square(0, 0, 4)}"/><path class="tb-ring" data-tone="lo" d="M0 0L0 4" opacity="0.40"/><path class="iso-line tb-edge" data-tone="mid" d="M0 0L4 0"/></g>`);
  const ring = sink.segments.find((s) => near(s.width, 0.45));
  assert.ok(ring && !(ring.flags & SEG_FLAG.capRound) && near(ring.alpha, 0.4), "ring");
  assert.ok(sink.segments.some((s) => near(s.width, 0.6) && s.flags & SEG_FLAG.capRound), "edge");
});
test("iso-wire-end circle: fill dot plus a butt / miter outline (its CSS sets no cap or join)", () => {
  const { sink } = sinkFor(`<circle class="iso-wire-end" cx="5" cy="5" r="1"/>`);
  assert.deepEqual(sink.prims.map((p) => p.kind), [PRIM_KIND.dot, PRIM_KIND.stroke]);
  assert.ok(sink.segments.every((s) => !(s.flags & SEG_FLAG.capRound) && !(s.flags & SEG_FLAG.joinRound) && s.flags & SEG_FLAG.closed));
});
test("gradient: url(#id) fill → unsigned gradient paint id, gradient record with stop palette ids", () => {
  const { sink, palette } = sinkFor(`<defs><linearGradient id="v" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="10"><stop offset="0" class="cf-void-0"/><stop offset="100%" class="cf-void-2"/></linearGradient></defs><path class="cf-void" fill="url(#v)" d="${square(0, 0, 10)}"/>`);
  const prim = sink.prims[0];
  assert.ok(prim.paint === PAINT_GRADIENT && isGradientPaint(prim.paint) && gradientIndexOf(prim.paint) === 0 && prim.flags & PRIM_FLAG.gradient, `paint ${prim.paint}`);
  assert.ok(sink.fillVertices.every((v) => v.paint === PAINT_GRADIENT), "vertices carry the unsigned id");
  const g = sink.gradients[0];
  assert.ok(g.stops.length === 2 && g.stops[1].offset === 1 && palette.entries[g.stops[1].paint].prop === "stop-color" && g.y2 === 10, JSON.stringify(g));
});
test("group opacity multiplies; groups drawing more than one element are flagged, at any depth", () => {
  const { sink } = sinkFor(`<g opacity="0.5"><g opacity="0.5"><path class="iso-line" d="M0 0L1 0"/></g></g><g opacity="0.5"><path class="iso-line" d="M0 0L1 0"/><path class="iso-line" d="M0 1L1 1"/></g><g opacity="0.5"><g class="iso-solid"><path class="iso-fill" d="${square(0, 0, 2)}"/><path class="iso-shade" data-shade="1" d="${square(0, 0, 1)}"/></g></g>`);
  assert.ok(near(sink.segments[0].alpha, 0.25) && !(sink.prims[0].flags & PRIM_FLAG.groupOpacity), "nested single-element groups: 0.25, not flagged");
  assert.ok(sink.prims[1].flags & PRIM_FLAG.groupOpacity && sink.prims[2].flags & PRIM_FLAG.groupOpacity, "two siblings flagged");
  assert.ok(sink.prims[3].flags & PRIM_FLAG.groupOpacity && sink.prims[4].flags & PRIM_FLAG.groupOpacity, "single child group holding two drawn elements flagged");
});
test("halo and seamless solids", () => {
  const { sink, palette } = sinkFor(`<path class="iso-halo" d="${square(0, 0, 10)}"/><g class="iso-solid" data-seamless=""><path class="iso-fill" d="${square(0, 0, 4)}"/><path class="iso-shade" data-shade="1" d="${square(0, 0, 2)}"/><path class="iso-top" d="${square(2, 2, 2)}"/></g>`);
  assert.ok(sink.prims[0].flags & PRIM_FLAG.halo, "halo flag");
  const kinds = sink.prims.map((p) => p.kind).join("");
  assert.equal(kinds, `${PRIM_KIND.fill}${PRIM_KIND.fill}${PRIM_KIND.fill}${PRIM_KIND.stroke}${PRIM_KIND.fill}${PRIM_KIND.stroke}`);
  const seam = sink.segments[0];
  assert.ok(near(seam.width, 0.4) && seam.flags & SEG_FLAG.closed && !(seam.flags & SEG_FLAG.capRound) && seam.flags & SEG_FLAG.joinRound, "0.4 closed butt/round");
  assert.ok(palette.entries[sink.prims[3].paint].prop === "stroke" && palette.entries[sink.prims[2].paint].prop === "fill", "separate fill / stroke keys");
  assert.equal(sink.prims.map((p) => p.layer).join(), "0,1,2,3,4,5", "fill then stroke layers in document order");
});
test("unsupported markup throws with the reason", () => {
  const cases = [
    [`<path class="mystery" d="M0 0L1 1"/>`, /unknown path class "mystery"/],
    [`<path class="tb-edge" d="M0 0L1 1"/>`, /unknown path class "tb-edge"/],
    [`<path class="iso-line" d="M0 0C1 1 2 2 3 3"/>`, /unsupported path command C/],
    [`<path class="iso-line" d="M0 0 X 5 5 L1 1"/>`, /unsupported path command X/],
    [`<path class="iso-line" d="M0 0 L1 1 #"/>`, /unexpected "#"/],
    [`<path class="iso-line" d="M0 0 L1"/>`, /missing number/],
    [`<rect class="iso-fill"/>`, /unsupported element <rect>/],
    [`<path class="iso-line" style="stroke:red" d="M0 0L1 0"/>`, /inline style "stroke"/],
    [`<path class="iso-line" style="stroke-width:1em" d="M0 0L1 0"/>`, /inline stroke-width "1em" is not a plain number/],
    [`<text>hi</text>`, /text content|unsupported element <text>/],
    [`<path class="iso-fill" transform="translate(100 0)" d="M0 0L1 0L1 1Z"/>`, /<path transform> is not supported/],
    [`<g transform="scale(2)"><path class="iso-fill" d="M0 0L1 0L1 1Z"/></g>`, /<g transform> is not supported/],
    [`<path class="iso-fill" fill-rule="evenodd" d="M0 0L1 0L1 1Z"/>`, /fill-rule="evenodd" is not supported/],
    [`<path class="iso-fill" clip-path="url(#c)" d="M0 0L1 0L1 1Z"/>`, /<path clip-path> is not supported/],
    [`<path class="iso-fill" mask="url(#m)" d="M0 0L1 0L1 1Z"/>`, /<path mask> is not supported/],
    [`<path class="iso-fill" filter="url(#f)" d="M0 0L1 0L1 1Z"/>`, /<path filter> is not supported/],
    [`<path class="iso-line" stroke-dasharray="1 2" d="M0 0L1 0"/>`, /<path stroke-dasharray> is not supported/],
    [`<path class="iso-line" data-dashed="" d="M0 0L1 0"/>`, /dashed strokes \(data-dashed\)/],
    [`<g class="iso-dots"><circle cx="1" cy="1" r="0.4" data-pulse=""/></g>`, /pulsing dots .*\(data-pulse\)/],
    [`<defs><linearGradient id="v" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="1" gradientTransform="rotate(9)"/></defs>`, /<linearGradient gradientTransform> is not supported/],
    [`<defs><linearGradient id="v" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="1" href="#w"/></defs>`, /<linearGradient href> is not supported/],
    [`<defs><linearGradient id="v" x1="0" y1="0" x2="0" y2="1"/></defs>`, /only userSpaceOnUse/],
    [`<defs><linearGradient id="v" gradientUnits="userSpaceOnUse" x1="0" y1="0" y2="1"/></defs>`, /x2 is required/],
    [`<defs><path class="iso-fill" d="M0 0L1 0L1 1Z"/></defs>`, /<path> inside <defs> is not supported/],
    [`<g class="iso-dots"><circle cx="1px" cy="1" r="0.4"/></g>`, /<circle cx> "1px" is not a plain number/],
    [`<g class="iso-dots"><circle cx="1" cy="1" r="40%"/></g>`, /<circle r> "40%" is not a plain number/],
    [`<g class="a &nbsp; b"><path class="iso-line" d="M0 0L1 0"/></g>`, /unknown entity &nbsp;/],
    [`<g><path class="iso-line" d="M0 0L1 0"/>`, /unclosed <g>/],
  ];
  for (const [markup, reason] of cases) assert.throws(() => sinkFor(markup), reason, markup);
});
test("accepted syntax: single-quoted attributes, numeric and named entities, percentage opacity", () => {
  const { elements } = drawables(parseSvg(`<g class='a &amp; b &#39;c&#x27;'><g data-x="1"><path class='iso-line' opacity="50%" d='M0 0L1 0'/></g></g>`));
  assert.equal(elements[0].chain.length, 2);
  assert.equal(elements[0].chain[0].attrs.class, "a & b 'c'");
  assert.equal(elements[0].opacity, 0.5);
});
test("palette key ignores names / routes / geometry / alpha, keeps the class + data-* chain", () => {
  const { palette } = sinkFor(`<g class="it fx-graphite" data-name="a" data-route="r"><path class="iso-line" data-tone="lo" d="M0 0L1 0"/></g><g class="it fx-graphite" data-name="b"><path class="iso-line" data-tone="lo" opacity="0.5" d="M5 5L6 0"/></g><g class="it"><path class="iso-line" data-tone="lo" d="M0 0L1 0"/></g>`);
  assert.equal(palette.entries.length, 2);
  assert.deepEqual(palette.entries[0].ancestors, [{ tag: "g", attrs: { class: "it fx-graphite" } }]);
});
test("slot placement mirrors kit page(): after → latest target, before → earliest, a target resolves to its first name / name#n item", () => {
  const items = ["a", "b", "b#2", "c"].map((name) => ({ name }));
  const slots = placeSlots(items, [{ name: "s1", after: "b" }, { name: "s2", before: ["c", "b"] }, { name: "s3", after: ["a", "c"] }]);
  assert.ok(slots[0].anchor === 1 && slots[0].insertAt === 2, JSON.stringify(slots[0])); // "b" resolves to b, not the later b#2 (kit's findIndex)
  assert.ok(slots[1].anchor === 1 && slots[1].insertAt === 1, JSON.stringify(slots[1]));
  assert.ok(slots[2].insertAt === 4 && slots[2].seq > slots[0].seq, JSON.stringify(slots[2]));
  assert.throws(() => placeSlots(items, [{ name: "x", after: "zzz" }]), /slot x: no item named zzz/);
});
test("binary round trip", () => {
  const { sink } = sinkFor(`<path class="iso-fill" d="${square(0, 0, 10)}"/><path class="iso-line" d="M0 0L1 1"/><g class="iso-dots"><circle cx="1" cy="2" r="0.4"/></g>`);
  const { buffer, table } = pack(sink);
  const S = sectionsOf(buffer);
  assert.ok(table.every((entry) => entry.offset % 256 === 0), "sections 256-aligned");
  assert.ok(S.fillIndices.count === sink.fillIndices.length && S.fillIndices.u32[2] === sink.fillIndices[2], "indices");
  const seg = recordAt(S.segments, 0);
  assert.ok(seg.x1 === 1 && near(seg.width, 0.6) && seg.flags === sink.segments[0].flags, JSON.stringify(seg));
  assert.ok(recordAt(S.dots, 0).cy === 2 && recordAt(S.prims, 2).kind === PRIM_KIND.dot, "dots");
});
test("pack rejects missing, misspelled, negative, fractional and non-finite fields", () => {
  const { sink } = sinkFor(`<path class="iso-line" d="M0 0L1 1"/>`);
  const withPrim = (patch) => ({ ...sink, prims: [{ ...sink.prims[0], ...patch }] });
  const { item, ...misspelled } = sink.prims[0];
  assert.throws(() => pack({ ...sink, prims: [{ ...misspelled, itme: item }] }), /prims\[0\]\.item = undefined: not a u32/);
  assert.throws(() => pack(withPrim({ item: -1 })), /prims\[0\]\.item = -1: not a u32/);
  assert.throws(() => pack(withPrim({ first: 1.5 })), /prims\[0\]\.first = 1\.5: not a u32/);
  assert.throws(() => pack(withPrim({ alpha: NaN })), /prims\[0\]\.alpha = NaN: not a finite number/);
  assert.throws(() => pack(withPrim({ paint: PAINT_GRADIENT | 0 })), /paint = -2147483648: not a u32/, "a signed gradient id is caught");
  assert.throws(() => pack({ ...sink, dots: undefined }), /section dots missing/);
  assert.equal(gradientPaint(3), 0x80000003);
  assert.throws(() => gradientPaint(-1), /gradient index -1/);
});
test("sectionsOf validates the header and accepts views at any byteOffset", () => {
  const { sink } = sinkFor(`<path class="iso-fill" d="${square(0, 0, 10)}"/>`);
  const { buffer } = pack(sink);
  const corrupt = (wordIndex, value) => {
    const copy = buffer.slice(0);
    new DataView(copy).setUint32(wordIndex * 4, value, true);
    return copy;
  };
  assert.throws(() => sectionsOf(corrupt(0, 0)), /bad magic/);
  assert.throws(() => sectionsOf(corrupt(2, 6)), /6 sections, expected 5/);
  assert.throws(() => sectionsOf(corrupt(4 + 3, 16)), /section prims stride, expected 32/);
  assert.throws(() => sectionsOf(corrupt(4 + 4 * 1 + 2, 1e6)), /section fillVertices byteLength ≠ count × stride/);
  assert.throws(() => sectionsOf(buffer.slice(0, buffer.byteLength - 256)), /runs past the end/);
  assert.throws(() => sectionsOf(buffer.slice(0, 40)), /shorter than the 96-byte header/);
  for (const shift of [3, 4]) {
    const host = new Uint8Array(buffer.byteLength + shift);
    host.set(new Uint8Array(buffer), shift);
    const S = sectionsOf(host.subarray(shift));
    assert.deepEqual([...S.fillIndices.u32], sink.fillIndices, `byteOffset ${shift}`);
  }
});
test("dl2svg draws every segment field: continuation starts, closing ends, per-segment style", () => {
  const paints = [{ color: [0, 0, 0, 1], alpha: 1, filter: "none", transform: "none", blend: "normal" }];
  const render = (segments) => {
    const sink = { prims: [{ kind: PRIM_KIND.stroke, item: 0, layer: 0, paint: 0, alpha: 1, first: 0, count: segments.length, flags: 0 }], fillVertices: [], fillIndices: [], segments: segments.map((s) => ({ item: 0, paint: 0, layer: 0, alpha: 1, width: 0.6, prim: 0, ...s })), dots: [] };
    return renderDlSvg({ gradients: [] }, sectionsOf(pack(sink).buffer), paints);
  };
  const round = SEG_FLAG.capRound | SEG_FLAG.joinRound;
  const closed = round | SEG_FLAG.closed;
  const triangle = [
    { x0: 0, y0: 0, x1: 4, y1: 0, flags: closed | SEG_FLAG.start },
    { x0: 4, y0: 0, x1: 4, y1: 4, flags: closed },
    { x0: 4, y0: 4, x1: 0, y1: 0, flags: closed | SEG_FLAG.end },
  ];
  assert.match(render(triangle), /d="M0 0L4 0L4 4Z"/);
  assert.match(render([triangle[0], { ...triangle[1], x0: 3 }, triangle[2]]), /d="M0 0L4 0M3 0L4 4L0 0"/, "a continuation away from the pen restarts the subpath");
  assert.match(render([triangle[0], triangle[1], { ...triangle[2], x1: 1 }]), /L4 4L1 0"/, "a closing segment not ending at the start is drawn, not closed");
  const twoWidths = render([{ ...triangle[0], flags: round | SEG_FLAG.start }, { ...triangle[1], width: 1.2, flags: round | SEG_FLAG.end }]);
  assert.equal(twoWidths.match(/<path /g).length, 2, "a width change inside a prim starts a new path");
});

// live slot markup the M3 adapter will feed through primitivesOf, built with the anatomy kit itself (not the v2
// kit.mjs wrapper, which other work edits): the boundary contract for the live adapter
const k = await import(join(homedir(), ".claude/skills/anatomy/kit/iso-kit.mjs"));
test("live slot markup: packet, lamp glow (blend), strobe, tach needle", () => {
  const P = k.fitProjection([[0, 0, 0], [100, 100, 100]], 640, 760, { pad: 30 });
  const plan = { x: 10, y: 10, w: 10, d: 8, r: 0.6 };
  const packet = `<g class="pk" data-kind="graph" opacity="0.60">${k.solidSvg(k.slabOf(plan, 5, 7, P, 2, 0.3), { tone: "hi" })}${k.lineSvg(k.sideSeam(plan, 8, P, 2), { tone: "lo" })}</g>`;
  const glow = `<circle class="cf-glow-soft" cx="10" cy="10" r="4" opacity="0.150"/><circle class="cf-glow" cx="10" cy="10" r="2" opacity="0.850"/>`;
  const tach = `<g class="it fx-graphite"><path class="iso-line" data-tone="hi" data-free="" style="stroke-width:1" d="M0 0L3 3"/>${k.dotsSvg([[1, 1]], { size: 0.8, tone: "hi" })}</g>`;
  const { sink, palette } = sinkFor(packet + glow + `<path class="cf-strobe" d="${square(0, 0, 3)}"/>` + tach);
  assert.ok(sink.prims.some((p) => p.flags & PRIM_FLAG.blend), "glow flagged blend");
  assert.ok(sink.segments.some((s) => near(s.alpha, 0.6)) && sink.fillVertices.some((v) => near(v.alpha, 0.6)), "packet opacity folded");
  assert.ok(palette.entries.some((e) => e.ancestors.some((a) => a.attrs["data-kind"] === "graph")), "packet kind in the palette key");
  assert.ok(sink.segments.some((s) => s.width === 1 && s.flags & SEG_FLAG.widthOverride), "tach needle width 1");
});
