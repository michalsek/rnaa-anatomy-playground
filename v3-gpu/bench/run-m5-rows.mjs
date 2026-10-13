#!/usr/bin/env node
// M5: native rotor vs markup path (?native=0) vs SVG, on the M6a/M6b configs. Every run is a fresh Chrome via
// tools/perf.mjs, sequential, the pages of one group back to back with the order rotating per repeat. CPU rows run with
// the User Timing preload only (no GPU timestamps: they add a pass and two submits per frame); the GPU-pass rows are
// separate runs with GPU timestamps on (bench/preload/gpu-timestamps.js). Existing JSONs are reused unless --force.
//
//   node bench/run-m5-rows.mjs [--repeats 3] [--only substring] [--force] [--report-only] [--dry]
//
// Pages (frozen copies, built by --freeze from out/gpu/live-light.html):
//   bench/gpu-m5/live-light.html                       native rotor (default)
//   bench/gpu-m5/live-light.html?native=0              markup path (fix-A behaviour)
//   bench/stress10-iframe-gpu-m5-light.html            10 iframes, native
//   bench/stress10-iframe-gpu-m5-markup-light.html     10 iframes, ?native=0
// Writes out/perf/m5/<label>.json and out/perf/m5/rows.md (table).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cpuIdle } from "../tools/perf-lib.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const REPEATS = Number(value("--repeats", 3));
const QUIET = 50;
const NOISY = 25;
const ONLY = value("--only", null);
const DIR = "out/perf/m5";
const idleOf = (j) => Math.min(j.meta.cpuIdle?.before ?? 0, j.meta.cpuIdle?.after ?? 0);
const noisy = (j) => idleOf(j) < NOISY;
function waitQuiet() {
  const t0 = Date.now();
  for (;;) {
    const idle = cpuIdle();
    if (idle === null || idle >= QUIET || Date.now() - t0 > 3 * 60000) return idle;
  }
}

if (flag("--freeze")) {
  mkdirSync("bench/gpu-m5", { recursive: true });
  copyFileSync("out/gpu/live-light.html", "bench/gpu-m5/live-light.html");
  spawnSync(process.execPath, ["bench/stress.mjs", "bench/gpu-m5/live-light.html", "--mode", "iframe", "--out", "bench/stress10-iframe-gpu-m5-light.html"], { stdio: "inherit" });
  const stress = readFileSync("bench/stress10-iframe-gpu-m5-light.html", "utf8");
  const markup = stress.replaceAll("live-light.html", "live-light.html?native=0");
  if (markup === stress) throw new Error("stress page: no iframe src to switch to ?native=0");
  writeFileSync("bench/stress10-iframe-gpu-m5-markup-light.html", markup);
  console.log("froze bench/gpu-m5/live-light.html and the two stress10 pages");
  process.exit(0);
}

const url = (file, query = "") => pathToFileURL(resolve(file)).href + query;
const CONFIGS = {
  desktop: ["--width", "1280", "--dpr", "2", "--throttle", "1"],
  phone: ["--width", "390", "--dpr", "3", "--throttle", "4"],
};
const COMMON = ["--preload", "bench/preload/gpu-timing.js", "--gpu-util", "--seconds", "8", "--warmup", "2", "--trace-seconds", "3"];
const GPU_TIME = ["--preload", "bench/preload/gpu-timestamps.js"];
const PAGES = {
  "centrifuge/svg": { file: "bench/v2/centrifuge-light.html" },
  "centrifuge/markup": { file: url("bench/gpu-m5/live-light.html", "?native=0") },
  "centrifuge/native": { file: "bench/gpu-m5/live-light.html" },
  "stress10-iframe/svg": { file: "bench/stress10-iframe-light.html", args: ["--select", "none"] },
  "stress10-iframe/markup": { file: "bench/stress10-iframe-gpu-m5-markup-light.html", args: ["--select", "none"] },
  "stress10-iframe/native": { file: "bench/stress10-iframe-gpu-m5-light.html", args: ["--select", "none"] },
  "centrifuge-gputime/markup": { file: url("bench/gpu-m5/live-light.html", "?native=0"), args: GPU_TIME },
  "centrifuge-gputime/native": { file: "bench/gpu-m5/live-light.html", args: GPU_TIME },
  "stress10-gputime/markup": { file: "bench/stress10-iframe-gpu-m5-markup-light.html", args: ["--select", "none", ...GPU_TIME] },
  "stress10-gputime/native": { file: "bench/stress10-iframe-gpu-m5-light.html", args: ["--select", "none", ...GPU_TIME] },
};
const GROUPS = [
  [["centrifuge/svg", "centrifuge/markup", "centrifuge/native"], ["desktop", "phone"]],
  [["stress10-iframe/svg", "stress10-iframe/markup", "stress10-iframe/native"], ["desktop", "phone"]],
  [["centrifuge-gputime/markup", "centrifuge-gputime/native"], ["desktop", "phone"]],
  [["stress10-gputime/markup", "stress10-gputime/native"], ["desktop", "phone"]],
];
const labelOf = (page, config, r) => `${page.replace("/", "-")}-${config}-r${r}`;

if (!flag("--report-only")) {
  mkdirSync(DIR, { recursive: true });
  for (let r = 1; r <= REPEATS; r++) {
    for (const [pages, configs] of GROUPS) {
      for (const config of configs) {
        const rotated = [...pages.slice((r - 1) % pages.length), ...pages.slice(0, (r - 1) % pages.length)];
        for (const page of rotated) {
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
  const msOf = (j, key) => j.gpuPage?.medianSumMs?.[key];
  const COLS = [
    ["fps", (j) => j.frames.fps, 1],
    ["dropped %", (j) => j.frames.droppedPct, 1],
    ["main task", (j) => j.metrics.perFrame.taskMs, 2],
    ["script", (j) => j.metrics.perFrame.scriptMs, 2],
    ["live-js", (j) => pf(j, "gpuLiveJsMs"), 2],
    ["parse", (j) => pf(j, "gpuParseMs"), 2],
    ["upload", (j) => pf(j, "gpuUploadMs"), 2],
    ["encode", (j) => pf(j, "gpuEncodeMs"), 2],
    ["live-js med Σ", (j) => msOf(j, "liveJs"), 2],
    ["parse med Σ", (j) => msOf(j, "parse"), 2],
    ["encode med Σ", (j) => msOf(j, "encode"), 2],
    ["GPU pass Σ", (j) => msOf(j, "gpuPass"), 2],
    ["WebGPU decode", (j) => j.trace?.perFrame.webgpuMs, 2],
    ["GPU-proc CPU", (j) => j.trace?.perFrame.gpuCpuMs, 2],
    ["GPU raster", (j) => j.trace?.perFrame.gpuRasterMs, 2],
    ["GPU total", (j) => j.trace?.perFrame.gpuMs, 2],
    ["GPU util %", (j) => (j.gpuUtil ? j.gpuUtil.window.p50 : NaN), 0],
    ["heap MB", (j) => j.metrics.end.JSHeapUsedMB, 1],
  ];
  const rows = [];
  for (const [pages, configs] of GROUPS) {
    for (const config of configs) {
      for (const page of pages) {
        const runs = [];
        for (let r = 1; r <= REPEATS; r++) {
          const f = `${DIR}/${labelOf(page, config, r)}.json`;
          if (!existsSync(f)) continue;
          const j = JSON.parse(readFileSync(f, "utf8"));
          if (!noisy(j)) runs.push(j);
        }
        if (!runs.length) continue;
        const cells = COLS.map(([, get, d]) => fmt(med(runs.map(get)), d));
        const problems = runs.reduce((s, j) => s + (j.problems?.length ?? 0) + (j.gpuPage?.errors?.length ?? 0), 0);
        const devices = runs[0].gpuPage ? ` · ${Math.min(...runs.map((j) => j.gpuPage.ready))}/${runs[0].gpuPage.instances} dev` : "";
        rows.push(`| ${page} | ${config} | ${runs.length} | ${cells.join(" | ")} | ${problems ? `⚠${problems}` : "–"}${devices} |`);
      }
    }
  }
  const table = [`| page | config | runs | ${COLS.map(([name]) => name).join(" | ")} | notes |`, `|---|---|---|${COLS.map(() => "---:").join("|")}|---|`, ...rows].join("\n");
  writeFileSync(`${DIR}/rows.md`, `# M5 perf rows (medians, ms per frame unless noted; generated by bench/run-m5-rows.mjs)\n\n${table}\n`);
  console.log(table);
}
