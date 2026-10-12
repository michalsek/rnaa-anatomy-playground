// node export/export.mjs [--scene centrifuge] [--theme light|dark]
// Runs the scene through the real v2 page() (SVG baseline + fallback into out/svg/), then writes the display list
// out/dl/<scene>.dl.json + .dl.bin. The DL is theme-independent (paint resolved from CSS at runtime); --theme only
// names the SVG page reported as the baseline.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { buildDisplayList } from "./build-dl.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SCENES = { centrifuge: "../scenes/centrifuge.scene.mjs" };
const SVG_DIR = join(ROOT, "out/svg");

export const svgPageOf = (scene, theme, svgDir = SVG_DIR) => join(svgDir, `${scene}${theme === "light" ? "-light" : ""}.html`);
export const dlFilesOf = (scene) => ({ json: join(ROOT, "out/dl", `${scene}.dl.json`), bin: join(ROOT, "out/dl", `${scene}.dl.bin`) });

// cliOption(args, "--scene", "centrifuge") → the value after the flag, the fallback when the flag is absent
export function cliOption(args, name, fallback) {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  const value = args[at + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

export const sceneModule = (scene) => {
  if (!SCENES[scene]) throw new Error(`unknown scene ${scene} (have: ${Object.keys(SCENES).join(", ")})`);
  return import(SCENES[scene]);
};

// exportScene(scene, { collectFillChecks, svgDir }) → { json, buffer, stats, fillChecks, items, timings }. page()
// writes its two theme pages into svgDir; items are the scene's settled and sorted recorder items.
export async function exportScene(scene = "centrifuge", { collectFillChecks = false, svgDir = SVG_DIR } = {}) {
  const { run } = await sceneModule(scene);
  mkdirSync(svgDir, { recursive: true });
  const t0 = performance.now();
  const ctx = run({ out: svgPageOf(scene, "dark", svgDir) });
  const t1 = performance.now();
  const { json, buffer, stats, fillChecks } = buildDisplayList({ scene, items: ctx.R.items, back: ctx.back, slots: ctx.slots, V: ctx.V, width: ctx.W, height: ctx.H, collectFillChecks });
  const t2 = performance.now();
  return { json, buffer, stats, fillChecks, items: ctx.R.items, timings: { pageMs: t1 - t0, exportMs: t2 - t1 } };
}

async function main() {
  const args = process.argv.slice(2);
  const scene = cliOption(args, "--scene", "centrifuge");
  const theme = cliOption(args, "--theme", "light");
  const { json, buffer, stats, timings } = await exportScene(scene);
  const files = dlFilesOf(scene);
  mkdirSync(dirname(files.json), { recursive: true });
  const text = JSON.stringify(json);
  const bin = new Uint8Array(buffer);
  writeFileSync(files.json, text);
  writeFileSync(files.bin, bin);
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  console.log(`baseline ${svgPageOf(scene, theme)}`);
  console.log(`dl json ${kb(text.length)} (gzip ${kb(gzipSync(text).length)}) · bin ${kb(bin.length)} (gzip ${kb(gzipSync(bin).length)})`);
  console.log(`counts ${JSON.stringify(json.counts)}`);
  console.log(`census ${JSON.stringify(stats)}`);
  console.log(`time page() ${timings.pageMs.toFixed(0)} ms · export ${timings.exportMs.toFixed(0)} ms`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
