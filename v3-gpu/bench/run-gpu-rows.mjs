#!/usr/bin/env node
// M6b (preliminary): SVG vs GPU (M3 live adapter) rows on the M6a baseline configs. Every run is a fresh Chrome via
// tools/perf.mjs, sequential; SVG and GPU rows of one page are adjacent and their order alternates per repeat
// (A B / B A), so machine drift hits both sides alike. Existing JSONs are reused unless --force.
//
//   node bench/run-gpu-rows.mjs [--repeats 3] [--only substring] [--force] [--report-only] [--dry]
//
// Writes out/perf/m6b/<label>.json, out/perf/gpu-rows.json (raw per-run values) and the table in out/perf/gpu-rows.md
// between the <!-- table --> markers (the prose around it is hand-written and kept).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpuIdle } from "../tools/perf-lib.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const REPEATS = Number(value("--repeats", 3));
const QUIET = Number(value("--quiet", 50));
const NOISY = Number(value("--noisy", 25));
const ONLY = value("--only", null);
const DIR = "out/perf/m6b";
const idleOf = (j) => Math.min(j.meta.cpuIdle?.before ?? 0, j.meta.cpuIdle?.after ?? 0);
const noisy = (j) => idleOf(j) < NOISY;
function waitQuiet() {
  const t0 = Date.now();
  for (;;) {
    const idle = cpuIdle();
    if (idle === null || idle >= QUIET || Date.now() - t0 > 3 * 60000) return idle;
  }
}

const CONFIGS = {
  desktop: ["--width", "1280", "--dpr", "2", "--throttle", "1"],
  phone: ["--width", "390", "--dpr", "3", "--throttle", "4"],
  headed: ["--width", "1280", "--dpr", "2", "--throttle", "1", "--headed"],
};
// every run: the GPU timing preload (no-op on SVG pages) and the machine-wide GPU utilisation sampler
const COMMON = ["--preload", "bench/preload/gpu-timing.js", "--gpu-util", "--seconds", "8", "--warmup", "2", "--trace-seconds", "3"];
export const PAGES = {
  "centrifuge/svg": { file: "bench/v2/centrifuge-light.html" },
  "centrifuge/gpu": { file: "bench/gpu/live-light.html" },
  "stress10-iframe/svg": { file: "bench/stress10-iframe-light.html", args: ["--select", "none"] },
  "stress10-iframe/gpu": { file: "bench/stress10-iframe-gpu-light.html", args: ["--select", "none"] },
  "stress10-inline/svg": { file: "bench/stress10-light.html", args: ["--select", "none"] },
};
// [[pair of pages run back to back], configs, repeats]
const GROUPS = [
  [["centrifuge/svg", "centrifuge/gpu"], ["desktop", "phone"], REPEATS],
  [["stress10-iframe/svg", "stress10-iframe/gpu"], ["desktop", "phone"], REPEATS],
  [["stress10-inline/svg"], ["desktop", "phone"], REPEATS],
  [["centrifuge/svg", "centrifuge/gpu"], ["headed"], 1],
  [["stress10-iframe/svg", "stress10-iframe/gpu"], ["headed"], 1],
];
const labelOf = (page, config, r) => `${page.replace("/", "-")}-${config}-r${r}`;

if (!flag("--report-only")) {
  mkdirSync(DIR, { recursive: true });
  for (let r = 1; r <= REPEATS; r++) {
    for (const [pages, configs, repeats] of GROUPS) {
      if (r > repeats) continue;
      for (const config of configs) {
        for (const page of r % 2 ? pages : [...pages].reverse()) {
          const label = labelOf(page, config, r);
          if (ONLY && !label.includes(ONLY)) continue;
          const out = `${DIR}/${label}.json`;
          if (existsSync(out) && !flag("--force") && !noisy(JSON.parse(readFileSync(out, "utf8")))) continue;
          const args = ["tools/perf.mjs", PAGES[page].file, ...CONFIGS[config], ...(PAGES[page].args ?? []), ...COMMON, "--label", label, "--out", out];
          if (flag("--dry")) {
            console.log("node", args.join(" "));
            continue;
          }
          const idle = waitQuiet();
          const res = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 300000 });
          process.stdout.write(`[idle ${idle}%] ${res.stdout}${res.status ? res.stderr : ""}`);
        }
      }
    }
  }
}
report();

function report() {
  const med = (a) => {
    const s = a.filter(Number.isFinite).sort((x, y) => x - y);
    return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
  };
  const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "–");
  const pf = (j, key) => j.pageStats?.[key]?.perFrame;
  const COLS = [
    ["fps", (j) => j.frames.fps, 1],
    ["frame p50", (j) => j.frames.intervals.p50, 1],
    ["frame p95", (j) => j.frames.intervals.p95, 1],
    ["dropped %", (j) => j.frames.droppedPct, 1],
    ["main task", (j) => j.metrics.perFrame.taskMs, 2],
    ["script", (j) => j.metrics.perFrame.scriptMs, 2],
    ["style+layout", (j) => j.metrics.perFrame.styleMs + j.metrics.perFrame.layoutMs, 2],
    ["paint (main)", (j) => j.trace?.perFrame.paintMainMs, 2],
    ["live-js", (j) => pf(j, "gpuLiveJsMs"), 2],
    ["parse", (j) => pf(j, "gpuParseMs"), 2],
    ["upload", (j) => pf(j, "gpuUploadMs"), 2],
    ["encode", (j) => pf(j, "gpuEncodeMs"), 2],
    ["raster (wkr)", (j) => j.trace?.perFrame.rasterMs, 2],
    ["GPU raster", (j) => j.trace?.perFrame.gpuRasterMs, 2],
    ["WebGPU decode", (j) => j.trace?.perFrame.webgpuMs, 2],
    ["GPU-proc CPU", (j) => j.trace?.perFrame.gpuCpuMs, 2],
    ["GPU-proc wait", (j) => j.trace?.perFrame.gpuWaitMs, 2],
    ["GPU total", (j) => j.trace?.perFrame.gpuMs, 2],
    ["GPU pass Σ", (j) => j.gpuPage?.medianSumMs.gpuPass, 1],
    ["GPU util %", (j) => (j.gpuUtil ? j.gpuUtil.window.p50 : NaN), 0],
    ["util idle %", (j) => (j.gpuUtil ? j.gpuUtil.before.p50 : NaN), 0],
    ["Nodes", (j) => j.metrics.end.Nodes, 0],
  ];
  const rows = [];
  const raw = {};
  for (const [pages, configs, repeats] of GROUPS) {
    for (const config of configs) {
      for (const page of pages) {
        const runs = [];
        for (let r = 1; r <= repeats; r++) {
          const f = `${DIR}/${labelOf(page, config, r)}.json`;
          if (existsSync(f)) {
            const j = JSON.parse(readFileSync(f, "utf8"));
            if (!noisy(j)) runs.push(j);
          }
        }
        if (!runs.length) continue;
        const [name, renderer] = page.split("/");
        const cells = COLS.map(([, get, d]) => {
          const vals = runs.map(get);
          const m = med(vals);
          const fin = vals.filter(Number.isFinite);
          const lo = Math.min(...fin);
          const hi = Math.max(...fin);
          const spread = Number.isFinite(m) && m > 0.05 && fin.length > 1 && (hi - lo) / m > 0.15 ? ` <sub>${fmt(lo, d)}–${fmt(hi, d)}</sub>` : "";
          return fmt(m, d) + spread;
        });
        const ratio = Math.min(...runs.map((j) => j.frames.pageFrameRatio));
        const gpu = runs[0].gpuPage;
        const problems = runs.reduce((s, j) => s + (j.problems?.length ?? 0), 0);
        const note = `${fmt(100 * ratio, 0)}%${gpu ? ` · ${Math.min(...runs.map((j) => j.gpuPage.ready))}/${gpu.instances} devices` : ""}${problems ? ` ⚠${problems}` : ""}`;
        rows.push(`| ${name} | **${renderer}** | ${config} | ${runs.length} | ${cells.join(" | ")} | ${note} |`);
        raw[`${page}-${config}`] = Object.fromEntries(COLS.map(([n, get]) => [n, runs.map(get)]));
      }
    }
  }
  const header = `| page | renderer | config | runs | ${COLS.map(([n]) => n).join(" | ")} | page frames · devices |\n|---|---|---|---|${COLS.map(() => "---:").join("|")}|---|`;
  const table = `<!-- table: generated by node bench/run-gpu-rows.mjs --report-only -->\n${header}\n${rows.join("\n")}\n<!-- /table -->`;
  const md = existsSync("out/perf/gpu-rows.md") ? readFileSync("out/perf/gpu-rows.md", "utf8") : "# SVG vs GPU rows\n\n<!-- table --><!-- /table -->\n";
  const out = md.replace(/<!-- table[\s\S]*?<!-- \/table -->/, table);
  writeFileSync("out/perf/gpu-rows.md", out);
  writeFileSync("out/perf/gpu-rows.json", JSON.stringify(raw, null, 1));
  console.log(`wrote out/perf/gpu-rows.md (${rows.length} rows)`);
}
