// node tools/gate.mjs [--scene centrifuge] [--themes light,dark] [--no-pixels] [--no-chrome] [--mutate <name> [<arg>]]
// M1 gates:
//  1. structural checks on a fresh export (census, header, draw order, slots vs the generated page, bounds, record
//     agreement, polyline structure, nonzero area per fill, orientation of the stored triangles), the scene copy vs
//     its v2 source, determinism (a second export) and freshness of out/dl/;
//  2. palette + role checks inside Chrome (skipped by --no-chrome);
//  3. pixel diff DL→SVG vs the v2 static frame (skipped by --no-pixels or --no-chrome).
// Both pixel pages are the generated v2 page with its script removed (live slots empty, nothing animates); the "dl"
// page empties the figure svg and redraws it from the DL with paint resolved by in-page probes.
// --mutate damages the DL after the structural checks; the Chrome / pixel gate must then FAIL (gate self-test).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildSync } from "esbuild";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { exportScene, ROOT, SCENES, svgPageOf, dlFilesOf, cliOption, sceneModule } from "../export/export.mjs";
import { nonzeroArea, triangleArea } from "../export/tess.mjs";
import { itemMarkup, BACK_ITEM_NAME } from "../export/build-dl.mjs";
import { parseSvg } from "../export/svgsub.mjs";
import { sectionsOf, recordAt, FIELD_WORD, STRIDE_WORDS, PRIM_KIND, SEG_FLAG } from "../export/dl-format.mjs";

const CAPTURE = `${process.env.HOME}/.claude/skills/anatomy/scripts/capture.mjs`;
const PIXEL_DELTA = 8; // a pixel differs when any channel moves by more than this (of 255)
const PIXEL_LIMIT_FRACTION = 0.001; // < 0.1 % of the frame may differ…
const PIXEL_LIMIT_COUNT = 50; // …and never more than this many device pixels (clean runs: ≈ 10 light, ≈ 2 dark)…
const PIXEL_CLUSTER_LIMIT = 8; // …and no 8-connected blob larger than this (clean runs: isolated AA pixels, blob 1;
// a dropped 30 u² part such as centrifuge.drain-stem leaves a blob of ≈ 30)
const PIXEL_ANY_CHANGE_LIMIT_FRACTION = 0.01; // pixels changed at all (Δ ≥ 1): clean runs 0.17–0.33 % (AA shimmer); a
// swap of two dark shades only Δ 6 apart (#0f0f0f / #151515) changes ≈ 5 % while staying under PIXEL_DELTA
const AREA_TOLERANCE = 0.005;
const AREA_FLOOR = 0.01; // px²: slivers below this are judged by absolute error
// Byte layout as notes/DL-FORMAT.md states it, written out independently of export/dl-format.mjs
const DOCUMENTED = { magic: "RNDL", version: 1, headerBytes: 96, sectionAlign: 256, strides: { prims: 32, fillVertices: 24, fillIndices: 4, segments: 48, dots: 32 } };

const args = process.argv.slice(2);
const scene = cliOption(args, "--scene", "centrifuge");
const themes = cliOption(args, "--themes", "light,dark").split(",");
const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` · ${detail}` : ""}`);
  if (!ok) failures.push(label);
};
const rangeOf = (first, count) => Array.from({ length: count }, (_, i) => first + i);

function headerMatchesDocument(json, buffer) {
  const view = new DataView(buffer);
  const word = (i) => view.getUint32(i * 4, true);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  const expectedCounts = { prims: json.counts.prims, fillVertices: json.counts.fillVertices, fillIndices: json.counts.triangles * 3, segments: json.counts.segments, dots: json.counts.dots };
  const problems = [];
  if (magic !== DOCUMENTED.magic) problems.push(`magic ${magic}`);
  if (word(1) !== DOCUMENTED.version) problems.push(`version ${word(1)}`);
  if (word(2) !== Object.keys(DOCUMENTED.strides).length) problems.push(`section count ${word(2)}`);
  if (word(3) !== DOCUMENTED.headerBytes) problems.push(`header bytes ${word(3)}`);
  const alignUp = (n) => Math.ceil(n / DOCUMENTED.sectionAlign) * DOCUMENTED.sectionAlign;
  let offset = alignUp(DOCUMENTED.headerBytes);
  Object.entries(DOCUMENTED.strides).forEach(([name, stride], s) => {
    const expected = { name, offset, byteLength: expectedCounts[name] * stride, count: expectedCounts[name], stride };
    const decoded = { name, offset: word(4 + s * 4), byteLength: word(5 + s * 4), count: word(6 + s * 4), stride: word(7 + s * 4) };
    if (JSON.stringify(decoded) !== JSON.stringify(expected)) problems.push(`${name} ${JSON.stringify(decoded)} ≠ ${JSON.stringify(expected)}`);
    if (JSON.stringify(json.sections[s]) !== JSON.stringify(expected)) problems.push(`json.sections[${s}] ${JSON.stringify(json.sections[s])}`);
    offset = alignUp(offset + expected.byteLength);
  });
  if (buffer.byteLength !== offset) problems.push(`file ${buffer.byteLength} B, expected ${offset}`);
  return problems;
}

// stroke prims: start / end pairing, continuity, closure, uniform width / cap / join / alpha inside a prim
function polylineProblems(S, json) {
  const problems = [];
  const SEGMENT = FIELD_WORD.segments;
  const STYLE = SEG_FLAG.capRound | SEG_FLAG.joinRound | SEG_FLAG.widthOverride;
  for (let p = 0; p < S.prims.count; p++) {
    const prim = recordAt(S.prims, p);
    if (prim.kind !== PRIM_KIND.stroke) continue;
    let open = null; // the polyline in progress: { start: [x, y], closed }
    let pen = null;
    let style = null;
    for (const s of rangeOf(prim.first, prim.count)) {
      const f = (name) => S.segments.f32[s * STRIDE_WORDS.segments + SEGMENT[name]];
      const flags = S.segments.u32[s * STRIDE_WORDS.segments + SEGMENT.flags];
      const segmentStyle = `${f("width")}|${f("alpha")}|${flags & STYLE}`;
      const where = `prim ${p} (${json.items[prim.item].name}) segment ${s}`;
      if (style !== null && segmentStyle !== style) problems.push(`${where}: style changes inside the prim`);
      style = segmentStyle;
      if (Boolean(flags & SEG_FLAG.start) === Boolean(open)) problems.push(`${where}: ${open ? "start inside a polyline" : "continuation without a start"}`);
      if (flags & SEG_FLAG.start) open = { start: [f("x0"), f("y0")], closed: Boolean(flags & SEG_FLAG.closed) };
      else if (open && (pen[0] !== f("x0") || pen[1] !== f("y0"))) problems.push(`${where}: starts away from the previous end`);
      if (open && open.closed !== Boolean(flags & SEG_FLAG.closed)) problems.push(`${where}: closed flag changes inside a polyline`);
      pen = [f("x1"), f("y1")];
      if (flags & SEG_FLAG.end) {
        if (open?.closed && (pen[0] !== open.start[0] || pen[1] !== open.start[1])) problems.push(`${where}: closing segment does not return to the start`);
        open = null;
      }
    }
    if (open) problems.push(`prim ${p}: last polyline has no end flag`);
  }
  return problems;
}

function structural({ json, buffer, stats, fillChecks }, expected) {
  const census = Object.keys({ ...expected.census, ...stats }).filter((key) => stats[key] !== expected.census[key]);
  check(!census.length, `census matches scenes/${scene}.scene.mjs EXPECTED`, census.length ? census.map((key) => `${key} ${stats[key]} ≠ ${expected.census[key]}`).join(", ") : Object.entries(stats).map(([key, value]) => `${key} ${value}`).join(" "));
  const counts = Object.keys(expected.counts).filter((key) => json.counts[key] !== expected.counts[key]);
  check(!counts.length, "DL counts match EXPECTED", counts.map((key) => `${key} ${json.counts[key]} ≠ ${expected.counts[key]}`).join(", ") || JSON.stringify(json.counts));

  const header = headerMatchesDocument(json, buffer);
  check(!header.length, "bin header and section table match DL-FORMAT.md (256-aligned) and json.counts", header.join("; "));
  const S = sectionsOf(buffer);

  const sceneItems = json.items.filter((item) => !item.back);
  const back = json.items.filter((item) => item.back);
  const keysSorted = sceneItems.every((item, i) => item.index === i && item.rank === i && (i === 0 || item.key >= sceneItems[i - 1].key));
  const backLast = back.length <= 1 && back.every((item) => item === json.items[json.items.length - 1] && item.rank === -1 && item.key === null && item.name === BACK_ITEM_NAME);
  check(keysSorted && backLast, "settled keys non-decreasing by rank (page() left R.items sorted); back item last, rank −1");

  // prims stored in draw order: ascending item rank (back first), layers 0, 1, … inside an item; item ranges partition
  let orderBreaks = 0;
  const owner = new Array(S.prims.count).fill(-1);
  for (const item of json.items) for (const p of rangeOf(...item.prims)) owner[p] = owner[p] === -1 ? item.index : -2;
  for (let p = 0; p < S.prims.count; p++) {
    const prim = recordAt(S.prims, p);
    const previous = p ? recordAt(S.prims, p - 1) : null;
    const rank = json.items[prim.item].rank;
    const sameItem = previous && previous.item === prim.item;
    if (owner[p] !== prim.item || (previous && rank < json.items[previous.item].rank) || prim.layer !== (sameItem ? previous.layer + 1 : 0)) orderBreaks++;
  }
  check(orderBreaks === 0, "prims stored in draw order (back item first, then ranks; layers consecutive) and item ranges partition them", `${orderBreaks} breaks`);

  const [vx, vy, vw, vh] = json.viewBox;
  const inside = (x, y) => x >= vx && x <= vx + vw && y >= vy && y <= vy + vh;
  const point = (section, i, xField, yField) => [S[section].f32[i * STRIDE_WORDS[section] + FIELD_WORD[section][xField]], S[section].f32[i * STRIDE_WORDS[section] + FIELD_WORD[section][yField]]];
  let outside = 0;
  for (let i = 0; i < S.fillVertices.count; i++) if (!inside(...point("fillVertices", i, "x", "y"))) outside++;
  for (let i = 0; i < S.segments.count; i++) if (!inside(...point("segments", i, "x0", "y0")) || !inside(...point("segments", i, "x1", "y1"))) outside++;
  for (let i = 0; i < S.dots.count; i++) if (!inside(...point("dots", i, "cx", "cy"))) outside++;
  check(outside === 0, "every vertex / segment end / dot inside the viewBox", `${outside} outside`);

  // records agree with their prim (item, paint, layer, alpha; segments and dots name their prim); every fill vertex is
  // used by exactly one fill
  let disagree = 0;
  const vertexUse = new Array(S.fillVertices.count).fill(-1);
  for (let p = 0; p < S.prims.count; p++) {
    const prim = recordAt(S.prims, p);
    const section = { [PRIM_KIND.fill]: "fillIndices", [PRIM_KIND.stroke]: "segments", [PRIM_KIND.dot]: "dots" }[prim.kind];
    for (const r of rangeOf(prim.first, prim.count)) {
      let record;
      if (section === "fillIndices") {
        const vertex = S.fillIndices.u32[r];
        if (vertexUse[vertex] !== -1 && vertexUse[vertex] !== p) disagree++;
        vertexUse[vertex] = p;
        record = recordAt(S.fillVertices, vertex);
      } else {
        record = recordAt(S[section], r);
        if (record.prim !== p) disagree++;
      }
      if (record.item !== prim.item || record.paint !== prim.paint || record.layer !== prim.layer || record.alpha !== prim.alpha) disagree++;
    }
  }
  const unused = vertexUse.filter((owner) => owner === -1).length;
  check(disagree === 0 && unused === 0, "records carry their prim's item, paint, layer, alpha; fill vertices used by exactly one fill", `${disagree} disagree, ${unused} unused vertices`);

  const polylines = polylineProblems(S, json);
  check(!polylines.length, "stroke polylines: start/end paired, continuous, closed ones return to their start, uniform style per prim", polylines.slice(0, 3).join("; "));

  // area: Σ triangle area of the f64 mesh vs the exact nonzero area of the source subpaths
  let worst = { rel: 0 };
  let bad = 0;
  let total = 0;
  for (const { prim, subpaths, mesh } of fillChecks) {
    const tri = Math.abs(triangleArea(mesh.positions, mesh.indices));
    const exact = nonzeroArea(subpaths);
    const error = Math.abs(tri - exact);
    const rel = exact > 0 ? error / exact : error;
    total += exact;
    if (error > Math.max(AREA_TOLERANCE * exact, AREA_FLOOR)) bad++;
    if (rel > worst.rel && error > AREA_FLOOR) worst = { rel, prim, tri, exact };
  }
  check(bad === 0, "Σ triangle area ≈ nonzero area per fill (0.5 %)", `${fillChecks.length} fills, ${bad} off, worst ${(worst.rel * 100).toFixed(4)} %${worst.prim !== undefined ? ` (prim ${worst.prim}: ${worst.tri.toFixed(3)} vs ${worst.exact.toFixed(3)})` : ""}, total area ${total.toFixed(0)} px²`);

  // orientation of the triangles as stored (f32 in the binary)
  let notPositive = 0;
  const vertex = (i) => point("fillVertices", i, "x", "y");
  for (let t = 0; t < S.fillIndices.count; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => vertex(S.fillIndices.u32[t + k]));
    if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 0) notPositive++;
  }
  check(notPositive === 0, "every stored (f32) triangle has a positive cross product", `${notPositive} of ${S.fillIndices.count / 3} not positive`);
}

// the generated page's <g class="fx-parts"> is exactly the item wrappers in DL order with each slot at its seq
function pageMatchesSlots({ json, items }) {
  const html = readFileSync(svgPageOf(scene, "dark"), "utf8");
  const open = '<g class="fx-parts">';
  const start = html.indexOf(open);
  const parts = parseSvg(html.slice(start, html.indexOf('<g data-slot="overlay">', start))).children[0];
  const documentOrder = parts.children.map((node) => (node.attrs["data-slot"] !== undefined ? `slot ${node.attrs["data-slot"]}` : `item ${node.attrs["data-name"]}`));
  const expected = json.items.filter((item) => !item.back).map((item) => `item ${item.name}`);
  for (const slot of [...json.slots].sort((a, b) => a.seq - b.seq)) expected.splice(slot.seq, 0, `slot ${slot.name}`);
  const firstDifference = documentOrder.findIndex((entry, i) => entry !== expected[i]);
  check(documentOrder.length === expected.length && firstDifference < 0, "item + slot order equals the generated page's fx-parts", firstDifference >= 0 ? `#${firstDifference}: page ${documentOrder[firstDifference]} vs DL ${expected[firstDifference]}` : `${documentOrder.length} children`);

  const markup = items.map((item, index) => {
    const slotsAt = (side) => json.slots.filter((s) => s.side === side && s.anchor === index).map((s) => `<g data-slot="${s.name}"></g>`).join("");
    return slotsAt("before") + itemMarkup(item) + slotsAt("after");
  });
  check(html.includes(`${open}${markup.join("")}</g>`), "itemMarkup + slot anchors rebuild the page's fx-parts byte for byte");
}

// the scene module is a copy of its v2 build.mjs: compare both modulo the edits its header documents
async function sceneCopyMatchesV2() {
  const { V2_SOURCE } = await sceneModule(scene);
  const copyPath = join(ROOT, "export", SCENES[scene]); // SCENES paths are relative to export/export.mjs
  const copy = readFileSync(copyPath, "utf8");
  const original = readFileSync(join(dirname(copyPath), V2_SOURCE), "utf8");
  const between = (text, from, to) => {
    const start = text.indexOf(from);
    const end = text.indexOf(to, start);
    if (start < 0 || end < 0) throw new Error(`scene copy check: "${from}" … "${to}" not found`);
    return text.slice(start, end + to.length);
  };
  // indentation is ignored: the copy indents the body into run(), but not the lines inside its template literals
  const lines = (text) => text.split("\n").map((line) => line.trim()).filter(Boolean);
  const stubOf = (text) => between(text, "const STUB_LIVE = `", "\n};`;");
  const originalBody = original.replace(stubOf(original), "").replace('out: join(HERE, "centrifuge.html"),', "out,");
  const expected = lines(between(originalBody, "const ctx = scene(", "audit: {},\n});"));
  const actual = lines(between(copy, "const ctx = scene(", "audit: {},\n  });"));
  const firstDifference = expected.findIndex((line, i) => line !== actual[i]);
  const same = stubOf(original) === stubOf(copy) && expected.length === actual.length && firstDifference < 0;
  check(same, `scene copy matches ${V2_SOURCE} (modulo the documented edits)`, firstDifference >= 0 ? `v2: ${expected[firstDifference]} | copy: ${actual[firstDifference]}` : "");
}

async function determinismAndFreshness(exported) {
  const svgDir = join(ROOT, "out/tmp/gate-determinism");
  const again = await exportScene(scene, { svgDir });
  const sameBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
  const pagesSame = ["light", "dark"].every((theme) => readFileSync(svgPageOf(scene, theme)).equals(readFileSync(svgPageOf(scene, theme, svgDir))));
  check(JSON.stringify(again.json) === JSON.stringify(exported.json) && sameBytes(again.buffer, exported.buffer) && pagesSame, "export is deterministic (second export: same json, bin and pages)");
  const files = dlFilesOf(scene);
  const present = existsSync(files.json) && existsSync(files.bin);
  const fresh = present && readFileSync(files.json, "utf8") === JSON.stringify(exported.json) && sameBytes(readFileSync(files.bin), exported.buffer);
  check(fresh, "out/dl is fresh (equals this export)", present ? (fresh ? "" : "stale: run node export/export.mjs") : "missing: run node export/export.mjs");
}

const stripScript = (html) => html.replace(/<script type="module">[\s\S]*?<\/script>/, "");

function gatePageScript() {
  const { outputFiles } = buildSync({ entryPoints: [join(ROOT, "tools/gate-page.js")], bundle: true, format: "iife", globalName: "dlGate", write: false, target: "es2022", logLevel: "warning" });
  return outputFiles[0].text;
}

function dlPage(staticHtml, json, buffer) {
  const stage = staticHtml.indexOf('class="iso-stage fx-stage"');
  const open = staticHtml.indexOf("<svg", stage);
  const bodyStart = staticHtml.indexOf(">", open) + 1;
  const close = staticHtml.indexOf("</svg>", bodyStart);
  if (stage < 0 || open < 0 || close < 0) throw new Error("gate: no svg inside .fx-stage");
  const scriptSafe = (text) => text.replace(/<\/(script)/gi, "<\\/$1");
  const script = `${gatePageScript()}\ndlGate.runGate(${JSON.stringify(json)}, "${Buffer.from(buffer).toString("base64")}");`;
  return staticHtml.slice(0, bodyStart) + staticHtml.slice(close).replace("</body>", () => `<script>${scriptSafe(script)}</script></body>`);
}

function capture(page, png) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [CAPTURE, page, "--out", png, "--scale", "2", "--wait", "2000"]);
    let text = "";
    child.stdout.on("data", (d) => (text += d));
    child.stderr.on("data", (d) => (text += d));
    child.on("exit", (code) => (code ? fail(new Error(`capture ${page}: ${text}`)) : done(text)));
  });
}

// largest 8-connected cluster of differing pixels
function largestCluster(mask, width, height) {
  const seen = new Uint8Array(mask.length);
  let largest = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let size = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      size++;
      const x = i % width;
      const y = (i - x) / width;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          const j = ny * width + nx;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && mask[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
    }
    largest = Math.max(largest, size);
  }
  return largest;
}

async function chromeChecks({ json, buffer }, theme, withPixels) {
  const dir = join(ROOT, "out/gate");
  mkdirSync(dir, { recursive: true });
  const staticHtml = stripScript(readFileSync(svgPageOf(scene, theme), "utf8"));
  const pages = { v2: join(dir, `${scene}-v2-${theme}.html`), dl: join(dir, `${scene}-dl-${theme}.html`) };
  writeFileSync(pages.v2, staticHtml);
  writeFileSync(pages.dl, dlPage(staticHtml, json, buffer));
  const pngs = { v2: pages.v2.replace(/\.html$/, ".png"), dl: pages.dl.replace(/\.html$/, ".png") };
  const [, logDl] = await Promise.all([withPixels ? capture(pages.v2, pngs.v2) : null, capture(pages.dl, pngs.dl)]);
  const lines = logDl.split("\n").filter((l) => l.includes("DLGATE") || l.startsWith("exception"));
  for (const line of lines) console.log(`  [${theme}] ${line.replace(/^console\.\w+: /, "")}`);
  check(lines.some((l) => l.includes("DLGATE ok")) && !lines.some((l) => l.includes("FAIL") || l.startsWith("exception")), `palette + role checks in Chrome (${theme})`);
  if (!withPixels) return;
  const a = PNG.sync.read(readFileSync(pngs.v2));
  const b = PNG.sync.read(readFileSync(pngs.dl));
  if (a.width !== b.width || a.height !== b.height) return check(false, `pixel gate (${theme})`, `size ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  const diff = new PNG({ width: a.width, height: a.height });
  const mismatched = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1, includeAA: true });
  writeFileSync(join(dir, `${scene}-diff-${theme}.png`), PNG.sync.write(diff));
  const differs = new Uint8Array(a.width * a.height);
  let changed = 0;
  let differing = 0;
  let maxDelta = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const delta = Math.max(...[0, 1, 2, 3].map((c) => Math.abs(a.data[i + c] - b.data[i + c])));
    if (delta) changed++;
    if (delta > PIXEL_DELTA) {
      differing++;
      differs[i / 4] = 1;
    }
    maxDelta = Math.max(maxDelta, delta);
  }
  const n = a.width * a.height;
  const pct = (count) => `${((count / n) * 100).toFixed(4)} %`;
  const cluster = largestCluster(differs, a.width, a.height);
  const ok = differing / n < PIXEL_LIMIT_FRACTION && differing <= PIXEL_LIMIT_COUNT && cluster <= PIXEL_CLUSTER_LIMIT && changed / n < PIXEL_ANY_CHANGE_LIMIT_FRACTION;
  check(ok, `pixel gate (${theme}, DPR 2, ${a.width}x${a.height}, Δ>${PIXEL_DELTA}: ≤ ${PIXEL_LIMIT_COUNT} px, < ${PIXEL_LIMIT_FRACTION * 100} %, blobs ≤ ${PIXEL_CLUSTER_LIMIT} px; any change < ${PIXEL_ANY_CHANGE_LIMIT_FRACTION * 100} %)`, `Δ>${PIXEL_DELTA}: ${differing} px = ${pct(differing)}, largest blob ${cluster} px · pixelmatch(0.1, AA counted) ${mismatched} px = ${pct(mismatched)} · any change ${changed} px = ${pct(changed)} · max channel Δ ${maxDelta}`);
}

const primsOf = (S, item) => rangeOf(...item.prims).map((p) => ({ p, ...recordAt(S.prims, p) }));
const setPrimCount = (S, p, count) => (S.prims.u32[p * STRIDE_WORDS.prims + FIELD_WORD.prims.count] = count);

const MUTATIONS = {
  // drop every fill of the item with the most triangles
  "drop-fill": ({ json, buffer }) => {
    const S = sectionsOf(buffer);
    const fillsOf = (item) => primsOf(S, item).filter((prim) => prim.kind === PRIM_KIND.fill);
    const triangles = (item) => fillsOf(item).reduce((n, prim) => n + prim.count, 0);
    const victim = json.items.reduce((best, item) => (triangles(item) > triangles(best) ? item : best));
    console.log(`  dropping the fills of ${victim.name}`);
    for (const prim of fillsOf(victim)) setPrimCount(S, prim.p, 0);
  },
  // drop every prim of the named item
  "drop-item": ({ json, buffer }, name) => {
    const victim = json.items.find((item) => item.name === name);
    if (!victim) throw new Error(`--mutate drop-item: no item named ${name}`);
    const S = sectionsOf(buffer);
    console.log(`  dropping the ${victim.prims[1]} prims of ${victim.name}`);
    for (const prim of primsOf(S, victim)) setPrimCount(S, prim.p, 0);
  },
  // two shade tones of the plain material swapped in the palette
  "swap-paint": ({ json }) => {
    const shade = (tone, ancestors) => json.palette.find((e) => e.prop === "fill" && e.el.attrs.class === "iso-shade" && e.el.attrs["data-shade"] === tone && (!ancestors || JSON.stringify(e.ancestors) === ancestors));
    const a = shade("0");
    const b = shade("2", JSON.stringify(a.ancestors));
    if (!a || !b) throw new Error("--mutate swap-paint: no iso-shade 0 / 2 pair with the same ancestors");
    console.log(`  swapping palette ${a.id} and ${b.id}`);
    [a.el, b.el] = [b.el, a.el];
  },
  // every hairline 1.5× wider
  width: ({ buffer }) => {
    const S = sectionsOf(buffer);
    for (let s = 0; s < S.segments.count; s++) S.segments.f32[s * STRIDE_WORDS.segments + FIELD_WORD.segments.width] *= 1.5;
  },
};

const mutation = cliOption(args, "--mutate", null);
if (mutation && !MUTATIONS[mutation]) throw new Error(`unknown --mutate ${mutation} (have: ${Object.keys(MUTATIONS).join(", ")})`);
const { EXPECTED } = await sceneModule(scene);
const exported = await exportScene(scene, { collectFillChecks: true });
structural(exported, EXPECTED);
pageMatchesSlots(exported);
await sceneCopyMatchesV2();
await determinismAndFreshness(exported);
if (mutation) {
  MUTATIONS[mutation](exported, args[args.indexOf("--mutate") + 2]);
  console.log(`mutated: ${mutation} (expect the Chrome / pixel gate to FAIL)`);
}
const withChrome = !args.includes("--no-chrome");
const withPixels = withChrome && !args.includes("--no-pixels");
if (withChrome) for (const theme of themes) await chromeChecks(exported, theme, withPixels);
console.log(failures.length ? `gate FAILED: ${failures.join(", ")}` : "gate passed");
process.exitCode = failures.length ? 1 : 0;
