// node export/export.mjs [--scene centrifuge] [--theme light|dark]
// Runs the scene through the real v2 page() (SVG baseline + fallback into out/svg/), then writes the display list
// out/dl/<scene>.dl.json + .dl.bin. The DL is theme-independent (paint resolved from CSS at runtime); --theme only
// names the SVG page reported as the baseline.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { buildDisplayList } from "./build-dl.mjs";
import { pack } from "./dl-format.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SCENES = { centrifuge: "../scenes/centrifuge.scene.mjs" };

export const svgPageOf = (scene, theme) => join(ROOT, "out/svg", `${scene}${theme === "light" ? "-light" : ""}.html`);

// exportScene(scene, { collect }) → { dl json, buffer, table, stats, checks, timings }
export async function exportScene(scene = "centrifuge", { collect = false } = {}) {
  if (!SCENES[scene]) throw new Error(`unknown scene ${scene} (have: ${Object.keys(SCENES).join(", ")})`);
  const { run } = await import(SCENES[scene]);
  mkdirSync(join(ROOT, "out/svg"), { recursive: true });
  const t0 = performance.now();
  const ctx = run({ out: svgPageOf(scene, "dark") });
  const t1 = performance.now();
  const { json, sections, stats, checks } = buildDisplayList({ scene, items: ctx.R.items, back: ctx.back, slots: ctx.slots, V: ctx.V, width: ctx.W, height: ctx.H, collect });
  const { buffer, table } = pack(sections);
  json.sections = table;
  json.counts = { items: json.items.length, prims: sections.prims.length, triangles: sections.fillIndices.length / 3, fillVertices: sections.fillVertices.length, segments: sections.segments.length, dots: sections.dots.length, palette: json.palette.length, gradients: json.gradients.length, slots: json.slots.length };
  const t2 = performance.now();
  return { json, buffer, table, stats, checks, timings: { pageMs: t1 - t0, exportMs: t2 - t1 } };
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const scene = option("--scene", "centrifuge");
  const theme = option("--theme", "light");
  const { json, buffer, stats, timings } = await exportScene(scene);
  const dir = join(ROOT, "out/dl");
  mkdirSync(dir, { recursive: true });
  const text = JSON.stringify(json);
  const bin = new Uint8Array(buffer);
  writeFileSync(join(dir, `${scene}.dl.json`), text);
  writeFileSync(join(dir, `${scene}.dl.bin`), bin);
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  console.log(`baseline ${svgPageOf(scene, theme)}`);
  console.log(`dl json ${kb(text.length)} (gzip ${kb(gzipSync(text).length)}) · bin ${kb(bin.length)} (gzip ${kb(gzipSync(bin).length)})`);
  console.log(`counts ${JSON.stringify(json.counts)}`);
  console.log(`census ${JSON.stringify(stats)}`);
  console.log(`time page() ${timings.pageMs.toFixed(0)} ms · export ${timings.exportMs.toFixed(0)} ms`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
