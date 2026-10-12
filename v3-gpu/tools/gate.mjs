// node tools/gate.mjs [--scene centrifuge] [--themes light,dark] [--no-pixels]
// M1 gates: (1) structural checks on a fresh export (census, ranks, slots, bounds, nonzero area per fill, orientation,
// determinism vs out/dl/), (2) palette + role checks inside Chrome, (3) pixel diff DL→SVG vs the v2 static frame.
// Pixel gate: both pages are the generated v2 page with its script removed (live slots empty, nothing animates);
// the "dl" page empties the figure svg and redraws it from the DL with paint resolved by in-page probes.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { exportScene, ROOT, svgPageOf } from "../export/export.mjs";
import { nonzeroArea, triangleArea } from "../export/tess.mjs";
import { sectionsOf, recordAt, SECTIONS, PRIM_KIND } from "../export/dl-format.mjs";

const CAPTURE = `${process.env.HOME}/.claude/skills/anatomy/scripts/capture.mjs`;
const PIXEL_LIMIT = 0.001; // < 0.1 % differing pixels
const PIXEL_DELTA = 8; // a pixel differs when any channel moves by more than this (of 255)
const AREA_TOLERANCE = 0.005;
const CENSUS = { fillPaths: 1136, fillSubpaths: 1956, multiSubpath: 379, mixedOrientation: 11, strokePaths: 525, polylines: 1025, dotCircles: 209, dotGroups: 37, opacityGroups: 3, halos: 1, seamlessSolids: 17 };

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const scene = option("--scene", "centrifuge");
const themes = option("--themes", "light,dark").split(",");
const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` · ${detail}` : ""}`);
  if (!ok) failures.push(label);
};


function structural({ json, buffer, stats, checks }) {
  const [vx, vy, vw, vh] = json.viewBox;
  const census = Object.entries(CENSUS).filter(([k, v]) => stats[k] !== v);
  check(!census.length, "census matches ROADMAP", census.length ? census.map(([k, v]) => `${k} ${stats[k]} ≠ ${v}`).join(", ") : Object.entries(CENSUS).map(([k, v]) => `${k} ${v}`).join(" "));
  check(Math.abs(stats.pathSegments - 15100) < 150, "stroke path segments ≈ 15.1k", `${stats.pathSegments}`);
  check(json.gradients.length === 1, "gradients 1", `${json.gradients.length}`);
  const ranks = json.items.filter((i) => !i.back).map((i) => i.rank);
  check(ranks.length === 239 && ranks.every((r, i) => r === i), "239 items, ranks 0..238 in order");
  check(json.slots.length === 15 && json.slots.every((s) => s.insertAt >= 0 && s.insertAt <= ranks.length && Number.isInteger(s.seq)), "15 slots placed", json.slots.map((s) => `${s.name}@${s.insertAt}`).join(" "));

  const S = sectionsOf(buffer);
  const roundTrip = SECTIONS.every((name) => S[name].count === exported.json.sections.find((t) => t.name === name).count);
  check(roundTrip, "bin header round trip");
  const inside = (x, y) => x >= vx && x <= vx + vw && y >= vy && y <= vy + vh;
  let outside = 0;
  for (let i = 0; i < S.fillVertices.count; i++) if (!inside(S.fillVertices.f32[i * 6], S.fillVertices.f32[i * 6 + 1])) outside++;
  for (let i = 0; i < S.segments.count; i++) if (!inside(S.segments.f32[i * 12], S.segments.f32[i * 12 + 1]) || !inside(S.segments.f32[i * 12 + 2], S.segments.f32[i * 12 + 3])) outside++;
  for (let i = 0; i < S.dots.count; i++) if (!inside(S.dots.f32[i * 8], S.dots.f32[i * 8 + 1])) outside++;
  check(outside === 0, "every vertex / segment end / dot inside the viewBox", `${outside} outside`);

  // records agree with their prim (item, paint, layer), layers strictly increase inside an item
  let disagree = 0;
  let layerBreaks = 0;
  for (const item of json.items) {
    let previous = -1;
    for (let p = item.prims[0]; p < item.prims[0] + item.prims[1]; p++) {
      const prim = recordAt(S.prims, p);
      if (prim.item !== item.index) disagree++;
      if (prim.layer <= previous) layerBreaks++;
      previous = prim.layer;
      const section = { [PRIM_KIND.fill]: "fillIndices", [PRIM_KIND.stroke]: "segments", [PRIM_KIND.dot]: "dots" }[prim.kind];
      for (let r = prim.first; r < prim.first + prim.count; r++) {
        const rec = section === "fillIndices" ? recordAt(S.fillVertices, S.fillIndices.u32[r]) : recordAt(S[section], r);
        if (rec.item !== prim.item || rec.paint !== prim.paint || rec.layer !== prim.layer) disagree++;
      }
    }
  }
  check(disagree === 0 && layerBreaks === 0, "vertices / segments / dots carry their prim's item, paint, layer; layers increase", `${disagree} disagree, ${layerBreaks} layer breaks`);

  // area: Σ triangle area vs exact nonzero area of the source subpaths; orientation all positive
  let worst = { rel: 0 };
  let bad = 0;
  let negative = 0;
  let total = 0;
  for (const { prim, subpaths, mesh } of checks) {
    const tri = Math.abs(triangleArea(mesh.positions, mesh.indices));
    for (let t = 0; t < mesh.indices.length; t += 3) if (triangleArea(mesh.positions, mesh.indices.slice(t, t + 3)) <= 0) negative++;
    const exact = nonzeroArea(subpaths);
    const error = Math.abs(tri - exact);
    const rel = exact > 0 ? error / exact : error;
    total += exact;
    if (error > Math.max(AREA_TOLERANCE * exact, 0.01)) bad++;
    if (rel > worst.rel && error > 0.01) worst = { rel, prim, tri, exact };
  }
  check(bad === 0, "Σ triangle area ≈ nonzero area per fill (0.5 %)", `${checks.length} fills, ${bad} off, worst ${(worst.rel * 100).toFixed(4)} %${worst.prim !== undefined ? ` (prim ${worst.prim}: ${worst.tri.toFixed(3)} vs ${worst.exact.toFixed(3)})` : ""}, total area ${total.toFixed(0)} px²`);
  check(negative === 0, "every triangle positively oriented", `${negative} negative`);

  const json1 = join(ROOT, "out/dl", `${scene}.dl.json`);
  if (existsSync(json1)) {
    const same = readFileSync(json1, "utf8") === JSON.stringify(json) && Buffer.compare(readFileSync(join(ROOT, "out/dl", `${scene}.dl.bin`)), Buffer.from(buffer)) === 0;
    check(same, "export is deterministic (matches out/dl/)");
  }
}

function inlineModule(path) {
  return readFileSync(join(ROOT, path), "utf8").replace(/^import .*$/gm, "").replace(/^export /gm, "");
}

const stripScript = (html) => html.replace(/<script type="module">[\s\S]*<\/script>/, "");

function dlPage(staticHtml, json, buffer) {
  const open = staticHtml.indexOf("<svg xmlns");
  const bodyStart = staticHtml.indexOf(">", open) + 1;
  const close = staticHtml.indexOf("</svg>", bodyStart);
  const script = `${inlineModule("export/dl-format.mjs")}
${inlineModule("export/palette-probe.mjs")}
${inlineModule("tools/dl2svg.mjs")}
${readFileSync(join(ROOT, "tools/gate-page.js"), "utf8")}
runGate(${JSON.stringify(json)}, "${Buffer.from(buffer).toString("base64")}");`;
  return staticHtml.slice(0, bodyStart) + staticHtml.slice(close).replace("</body>", `<script type="module">${script}</script></body>`);
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

async function pixels({ json, buffer }, theme) {
  const dir = join(ROOT, "out/gate");
  mkdirSync(dir, { recursive: true });
  const staticHtml = stripScript(readFileSync(svgPageOf(scene, theme), "utf8"));
  const pages = { v2: join(dir, `${scene}-v2-${theme}.html`), dl: join(dir, `${scene}-dl-${theme}.html`) };
  writeFileSync(pages.v2, staticHtml);
  writeFileSync(pages.dl, dlPage(staticHtml, json, buffer));
  const pngs = { v2: pages.v2.replace(/\.html$/, ".png"), dl: pages.dl.replace(/\.html$/, ".png") };
  const [, logDl] = await Promise.all([capture(pages.v2, pngs.v2), capture(pages.dl, pngs.dl)]);
  const lines = logDl.split("\n").filter((l) => l.includes("DLGATE") || l.startsWith("exception"));
  for (const line of lines) console.log(`  [${theme}] ${line.replace(/^console\.\w+: /, "")}`);
  check(lines.some((l) => l.includes("DLGATE ok")) && !lines.some((l) => l.includes("FAIL") || l.startsWith("exception")), `palette + role checks in Chrome (${theme})`);
  const a = PNG.sync.read(readFileSync(pngs.v2));
  const b = PNG.sync.read(readFileSync(pngs.dl));
  if (a.width !== b.width || a.height !== b.height) return check(false, `pixel gate (${theme})`, `size ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  const diff = new PNG({ width: a.width, height: a.height });
  const matched = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1, includeAA: true });
  writeFileSync(join(dir, `${scene}-diff-${theme}.png`), PNG.sync.write(diff));
  let exact = 0;
  let differing = 0;
  let maxDelta = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const delta = Math.max(...[0, 1, 2, 3].map((c) => Math.abs(a.data[i + c] - b.data[i + c])));
    if (delta) exact++;
    if (delta > PIXEL_DELTA) differing++;
    maxDelta = Math.max(maxDelta, delta);
  }
  const n = a.width * a.height;
  const pct = (count) => `${((count / n) * 100).toFixed(4)} %`;
  check(differing / n < PIXEL_LIMIT, `pixel gate (${theme}, DPR 2, ${a.width}x${a.height})`, `Δ>${PIXEL_DELTA}: ${differing} px = ${pct(differing)} · pixelmatch(0.1, AA counted) ${matched} px = ${pct(matched)} · any change ${exact} px = ${pct(exact)} · max channel Δ ${maxDelta}`);
}

// --mutate <name>: gate self-test — damage the DL after the structural gate; the pixel gate must then FAIL
const MUTATIONS = {
  // drop every fill of the item with the most triangles
  "drop-fill": ({ json, buffer }) => {
    const S = sectionsOf(buffer);
    const fillsOf = (item) => Array.from({ length: item.prims[1] }, (_, i) => item.prims[0] + i).filter((p) => S.prims.u32[p * 8] === PRIM_KIND.fill);
    const triangles = (item) => fillsOf(item).reduce((n, p) => n + S.prims.u32[p * 8 + 6], 0);
    const victim = json.items.reduce((best, item) => (triangles(item) > triangles(best) ? item : best));
    console.log(`  dropping the fills of ${victim.name}`);
    for (const p of fillsOf(victim)) S.prims.u32[p * 8 + 6] = 0;
  },
  // two shade tones swapped in the palette (1 and 3 are iso-shade 0 / 2 in the plain material)
  "swap-paint": ({ json }) => ([json.palette[1].el, json.palette[3].el] = [json.palette[3].el, json.palette[1].el]),
  // every hairline 1.5× wider
  "width": ({ buffer }) => {
    const S = sectionsOf(buffer);
    for (let s = 0; s < S.segments.count; s++) S.segments.f32[s * 12 + 8] *= 1.5;
  },
};

const exported = await exportScene(scene, { collect: true });
structural(exported);
const mutation = option("--mutate", null);
if (mutation) {
  MUTATIONS[mutation](exported);
  console.log(`mutated: ${mutation} (expect the pixel gate to FAIL)`);
}
if (!args.includes("--no-pixels")) for (const theme of themes) await pixels(exported, theme);
console.log(failures.length ? `gate FAILED: ${failures.join(", ")}` : "gate passed");
process.exitCode = failures.length ? 1 : 0;
