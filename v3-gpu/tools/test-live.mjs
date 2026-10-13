// node --test tools/test-live.mjs — src/live/geometry.ts (live slot markup → GPU records), browser-free.
// Contract: the live path follows the M1 exporter (export/build-dl.mjs primitivesOf) on real markup recorded from the
// v2 page (tools/fixtures/live-markup.json, `node tools/live-gate.mjs record`), plus the paint classes the exporter
// does not model: translucent and blended paints, invisible paints, group opacity layers, cap flags, draw merging.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as esbuild from "esbuild";
import { primitivesOf, createPalette, createSink } from "../export/build-dl.mjs";
import { PRIM_KIND } from "../export/dl-format.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
// SlotGeometryBuilder, the paint table and the record layouts (src/core/schemas.ts: SEG_RECORD, FILL_VERTEX_RECORD, SEG)
const SOURCES = ["src/live/geometry.ts", "src/core/paint.ts", "src/core/schemas.ts"].filter((path) => existsSync(ROOT + path));
const bundle = await esbuild.build({
  stdin: { contents: SOURCES.map((path) => `export * from "./${path}";`).join("\n"), resolveDir: ROOT, loader: "ts" },
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "error",
  define: { __GPU_DEV__: "true" },
});
const live = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const { SlotGeometryBuilder, CollectedSlot, PaintTable, SEG_RECORD, FILL_VERTEX_RECORD, FILL_ALPHA_SCALE, SEG } = live;
const { closed: SEG_CLOSED, buttStart: SEG_BUTT_START, buttEnd: SEG_BUTT_END, roundStart: SEG_ROUND_START, roundEnd: SEG_ROUND_END } = SEG;
const fixture = JSON.parse(readFileSync(new URL("fixtures/live-markup.json", import.meta.url), "utf8"));

// Record layouts written by geometry.ts (src/core/schemas.ts Seg / FillVertex): segments first, then fill vertices.
const S = SEG_RECORD;
const V = FILL_VERTEX_RECORD;
function decode(geometry) {
  const f32 = new Float32Array(geometry.bytes, 0, geometry.byteLength / 4);
  const u32 = new Uint32Array(geometry.bytes, 0, geometry.byteLength / 4);
  const segments = Array.from({ length: geometry.segCount }, (_, s) => {
    const o = s * S.words;
    return { x0: f32[o + S.p0], y0: f32[o + S.p0 + 1], x1: f32[o + S.p1], y1: f32[o + S.p1 + 1], width: f32[o + S.width], paint: u32[o + S.paint], layer: u32[o + S.layer], alpha: f32[o + S.alpha], flags: u32[o + S.flags] };
  });
  const vertexBase = geometry.segCount * S.words;
  const vertices = Array.from({ length: geometry.vertexCount }, (_, v) => {
    const o = vertexBase + v * V.words;
    // ids: item | paint << 16, layer | alpha16 << 16
    return { x: f32[o + V.pos], y: f32[o + V.pos + 1], paint: u32[o + V.ids] >>> 16, layer: u32[o + V.ids + 1] & 0xffff, alpha: (u32[o + V.ids + 1] >>> 16) / FILL_ALPHA_SCALE };
  });
  return { segments, vertices };
}
const triangleArea = (vertices, first, count) => {
  let area = 0;
  for (let v = first; v < first + count; v += 3) {
    const [a, b, c] = [vertices[v], vertices[v + 1], vertices[v + 2]];
    area += ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
  }
  return area;
};

/**
 * Palette stand-in: a paint table whose resolver paints everything opaque black and visible, with `.cf-glow*` paints
 * blending with "screen" (the dark theme). `classify(prop, probe)` may override the probed paint.
 */
function paletteStub(classify = () => ({})) {
  const table = new PaintTable();
  const resolver = {
    resolve: (probes) => probes.map((probe) => ({ color: [0, 0, 0, 1], alpha: 1, width: 0.6, cap: "round", blend: /cf-glow/.test(probe.el.attrs.class ?? "") ? "screen" : "normal", blur: 0, translate: [0, 0], ...classify(probe.prop, probe) })),
  };
  return { table, resolver };
}
const buildOf = (markup, classify) => {
  const palette = paletteStub(classify);
  const builder = new SlotGeometryBuilder(palette.table, []);
  const collected = new CollectedSlot();
  builder.collect(markup, collected);
  palette.table.resolvePending(palette.resolver);
  const geometry = builder.pack(collected, 7);
  return { geometry, palette: palette.table, ...decode(geometry) };
};

/** The exporter's view of the same markup: segments, dots, layered primitives and the exact triangle area. */
function exporterOf(markup) {
  const sink = createSink();
  primitivesOf(markup, { item: 0, palette: createPalette(), sink });
  let fillArea = 0;
  for (const prim of sink.prims.filter((p) => p.kind === PRIM_KIND.fill)) {
    const indices = sink.fillIndices.slice(prim.first, prim.first + prim.count);
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [sink.fillVertices[indices[t]], sink.fillVertices[indices[t + 1]], sink.fillVertices[indices[t + 2]]];
      fillArea += ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
    }
  }
  // the exporter packs all dots of an element into one dot prim; the live path gives every dot its own layer
  const layers = sink.prims.filter((p) => p.kind !== PRIM_KIND.dot).length + sink.dots.length;
  return { segments: sink.segments.length, dots: sink.dots.length, layers, fillArea };
}

function assertMatchesExporter(markup, label) {
  const { geometry, vertices } = buildOf(markup);
  const reference = exporterOf(markup);
  const area = triangleArea(vertices, 0, vertices.length);
  assert.equal(geometry.segCount, reference.segments + reference.dots, `${label}: segments + dots`);
  assert.equal(geometry.layers, reference.layers, `${label}: layers`);
  assert.ok(Math.abs(area - reference.fillArea) <= 1e-3 * Math.max(1, reference.fillArea), `${label}: fill area ${area} vs ${reference.fillArea}`);
}

test("recorded slot markup: segments, dots, layers and fill area agree with the M1 exporter", () => {
  for (const [slot, markup] of Object.entries(fixture.slots)) assertMatchesExporter(markup, slot);
  assertMatchesExporter(fixture.fadingIntake, "fading intake");
});

test("path data outside the kit's fast-path form parses like the exporter's general parser", () => {
  const forms = [
    "M10 10L20 10L20 20Z",
    "M10 10L20 10L20 20L10 10Z",
    "M10 10L20 10L20 10L20 20",
    "M-10 -10L20 -10L20 20Z",
    "M10,10 L20,10 L20,20 Z",
    "M1e1 1e1L2e1 10L20 20Z",
    "M+10 10L+20 10L20 +20Z",
    "M10 10L20 10L20 20ZL30 30",
    "M10 10L20 10L20 20ZM40 40L50 40L50 50Z",
    "M10 10l10 0l0 10z",
    "M10 10H20V20Z",
    "M.5 .5L10.25 .5L10.25 9.75Z",
  ];
  for (const d of forms) {
    assertMatchesExporter(`<path class="iso-line" d="${d}"/>`, `stroke ${d}`);
    assertMatchesExporter(`<g class="iso-solid"><path class="iso-fill" d="${d}"/></g>`, `fill ${d}`);
  }
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let n = 0; n < 200; n++) {
    const points = Array.from({ length: 3 + Math.floor(random() * 6) }, () => [(random() * 400 - 50).toFixed(1), (random() * 300 - 50).toFixed(1)]);
    const d = points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("") + (random() < 0.5 ? "Z" : "");
    assertMatchesExporter(`<path class="iso-line" d="${d}"/><g class="iso-solid"><path class="iso-fill" d="${d}"/></g>`, `random ${d}`);
  }
});

test("translucent and blended paints leave the opaque pass and draw in painter order", () => {
  const { geometry, segments, palette } = buildOf(fixture.slots["centrifuge:lamp"]);
  const glows = segments.filter((s) => palette.classes[s.paint].blend === "screen");
  assert.equal(glows.length, 2, "both glow circles are dots with the screen paint");
  assert.deepEqual(glows.map((s) => +s.alpha.toFixed(3)), [0.119, 0.289], "element opacity is carried per dot");
  assert.deepEqual(geometry.draws, [{ kind: "segs", first: 0, count: 2, blend: "screen" }], "one merged screen draw");
  assert.equal(geometry.opaque.count, 0);

  const half = buildOf(`<g class="iso-solid"><path class="iso-fill" fill-opacity="0.5" d="M0 0L10 0L10 10Z"/><path class="iso-fill" d="M20 0L30 0L30 10Z"/></g>`);
  assert.equal(half.palette.size, 1, "fill-opacity does not make a paint of its own: one paint for both fills");
  assert.ok(half.vertices.slice(3, 6).every((v) => Math.abs(v.alpha - 0.5) < 1 / FILL_ALPHA_SCALE), "the translucent fill carries alpha 0.5 per vertex");
  assert.deepEqual(half.geometry.opaque, { first: 0, count: 3 }, "the opaque fill comes first");
  assert.deepEqual(half.geometry.draws, [{ kind: "fill", first: 3, count: 3, blend: "normal" }], "the translucent fill is drawn blended");
  assert.equal(half.vertices[3].layer, 0, "and keeps its painter layer (first in the markup)");
});

test("group fade: a <g opacity> over several drawables becomes one layer group", () => {
  const markup = fixture.fadingIntake;
  const fading = [...markup.matchAll(/<g class="pk"[^>]*opacity="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(fading.length >= 2, "the fixture holds two fading packets");
  const { geometry, segments, vertices } = buildOf(markup);
  assert.deepEqual(geometry.groups.map((g) => g.alpha), fading, "one group per fading packet, with its opacity");
  const groupDraws = geometry.draws.filter((d) => d.kind === "group").map((d) => d.group);
  assert.deepEqual(groupDraws, fading.map((_, i) => i), "groups composite in painter order");
  for (const [index, group] of geometry.groups.entries()) {
    const fills = vertices.slice(group.opaque.first, group.opaque.first + group.opaque.count);
    const strokes = group.draws.filter((d) => d.kind === "segs").flatMap((d) => segments.slice(d.first, d.first + d.count));
    assert.ok(fills.length > 0 && strokes.length > 0, `group ${index} holds the packet's fills and lines`);
    assert.equal(Math.max(...[...fills, ...strokes].map((r) => r.layer)), group.frontLayer, `group ${index} composites at its frontmost layer`);
    assert.ok(strokes.every((s) => s.alpha === 1), `group ${index}: its opacity is applied once, when compositing, not per element`);
    const { x0, y0, x1, y1 } = group.bounds;
    const inside = (x, y) => x >= x0 - 1e-4 && x <= x1 + 1e-4 && y >= y0 - 1e-4 && y <= y1 + 1e-4;
    assert.ok(fills.every((v) => inside(v.x, v.y)) && strokes.every((s) => inside(s.x0, s.y0) && inside(s.x1, s.y1)), `group ${index} bounds cover its records`);
    assert.ok(group.halfWidth > 0, `group ${index} pads its bounds by its widest stroke`);
  }
});

test("a <g opacity> over one drawable folds into the element instead of a layer", () => {
  const { geometry, segments } = buildOf(`<g opacity="0.5"><g class="iso-dots" data-tone="hi"><circle cx="5" cy="5" r="1"/></g></g>`);
  assert.equal(geometry.groups.length, 0);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].alpha, 0.5);
});

test("caps: round for .iso-line, butt for .tb-ring; closed polylines carry no caps", () => {
  const capsOf = (markup) => buildOf(markup).segments.map((s) => s.flags & (SEG_CLOSED | SEG_BUTT_START | SEG_BUTT_END | SEG_ROUND_START | SEG_ROUND_END));
  assert.deepEqual(capsOf(`<path class="iso-line" d="M0 0L10 0L10 10"/>`), [SEG_ROUND_START, SEG_ROUND_END]);
  assert.deepEqual(capsOf(`<path class="tb-ring" d="M0 0L10 0L10 10"/>`), [SEG_BUTT_START, SEG_BUTT_END]);
  assert.deepEqual(capsOf(`<path class="iso-line" d="M0 0L10 0L10 10Z"/>`), [SEG_CLOSED, SEG_CLOSED, SEG_CLOSED]);
  assert.equal(capsOf(`<path class="iso-line" d="M5 5L5 5"/>`).length, 1, "a zero-length round-capped subpath paints a dot");
  assert.equal(capsOf(`<path class="tb-ring" d="M5 5L5 5"/>`).length, 0, "a zero-length butt-capped subpath paints nothing");
  const widths = buildOf(`<path class="iso-line" style="stroke-width:1.3" d="M0 0L10 0"/><path class="iso-line" d="M0 5L10 5"/>`).segments.map((s) => +s.width.toFixed(2));
  assert.deepEqual(widths, [1.3, 0.6], "inline stroke-width overrides the role width");
});

test.todo("miter joins (.iso-wire-end, .fx-fluff): live strokes are always round-joined (FINDINGS-M3 known gap)");

test("invisible paints take no layer and no records", () => {
  const markup = `<g class="iso-solid"><path class="iso-fill" d="M0 0L10 0L10 10Z"/></g><path class="iso-line" d="M0 0L10 0"/>`;
  const all = buildOf(markup);
  const noStrokes = buildOf(markup, (prop) => (prop === "stroke" ? { color: null } : {}));
  assert.equal(noStrokes.geometry.segCount, all.geometry.segCount - 1);
  assert.equal(noStrokes.geometry.layers, all.geometry.layers - 1);
  assert.equal(noStrokes.geometry.draws.length, 0);
});

test("blended draws merge only while the blend mode stays the same", () => {
  const dots = (tone, cls = "") => `<g class="iso-dots${cls}" data-tone="${tone}"><circle cx="1" cy="1" r="1" opacity="0.5"/><circle cx="3" cy="1" r="1" opacity="0.5"/></g>`;
  const merged = buildOf(dots("hi") + dots("lo"));
  assert.deepEqual(merged.geometry.draws, [{ kind: "segs", first: 0, count: 4, blend: "normal" }]);
  const split = buildOf(dots("hi") + `<circle class="cf-glow" cx="5" cy="5" r="2" opacity="0.3"/>` + dots("lo"));
  assert.deepEqual(split.geometry.draws.map((d) => [d.blend, d.count]), [["normal", 2], ["screen", 1], ["normal", 2]]);
});
