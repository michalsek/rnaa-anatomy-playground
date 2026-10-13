#!/usr/bin/env node
// M4 final rows: the deliverable (WebGPU, native rotor) vs the committed v2 SVG page, single figure and 10-iframe
// stress, desktop (1280 px, DPR 2) and phone (390 px, DPR 3, CPU 4×), plus load metrics. Every frame-cost run is a
// fresh Chrome via tools/perf.mjs, sequential, the pages of one group back to back with the order rotating per
// repeat (as bench/run-m5-rows.mjs). CPU rows run with the User Timing preload only; GPU-pass rows are separate runs
// with GPU timestamps on. Existing JSONs are reused unless --force.
//
//   node bench/run-final-rows.mjs --freeze          copy the deliverable to bench/final/ and build its stress page
//   node bench/run-final-rows.mjs [--repeats 3] [--only substring] [--force] [--report-only] [--skip-load] [--dry]
//
// Pages:
//   bench/v2/centrifuge-light.html                  the committed v2 page (byte-identical copy)
//   bench/final/centrifuge-gpu-light.html           frozen copy of centrifuge-gpu-light.html
//   bench/stress10-iframe-light.html                10 iframes of the v2 page
//   bench/stress10-iframe-gpu-final-light.html      10 iframes of the frozen deliverable
//   bench/gpu-m5/live-light.html                    load metrics only: the M5 page (DL binary as plain base64)
// Load metrics (fresh Chrome per run, LOAD_REPEATS runs, medians): bytes raw / gzip, first contentful paint,
// DOMContentLoaded, load event, and on GPU pages the first presented GPU frame (html[data-gpu=ready]).
// Writes out/perf/final/<label>.json, out/perf/final/load.json and out/perf/final/rows.md.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { cpuIdle, launchChrome } from "../tools/perf-lib.mjs";
import { openPage, sleep, waitFor } from "../tools/harness.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const REPEATS = Number(value("--repeats", 3));
const LOAD_REPEATS = 5;
const LOAD_STALL_MS = 20000;
const QUIET = 50;
const NOISY = 25;
const ONLY = value("--only", null);
const DIR = "out/perf/final";
const FROZEN = "bench/final/centrifuge-gpu-light.html";
const STRESS_GPU = "bench/stress10-iframe-gpu-final-light.html";
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
  mkdirSync("bench/final", { recursive: true });
  copyFileSync("centrifuge-gpu-light.html", FROZEN);
  const run = spawnSync(process.execPath, ["bench/stress.mjs", FROZEN, "--mode", "iframe", "--out", STRESS_GPU], { stdio: "inherit" });
  if (run.status) process.exit(run.status);
  console.log(`froze ${FROZEN} and ${STRESS_GPU}`);
  process.exit(0);
}

const CONFIGS = {
  desktop: { args: ["--width", "1280", "--dpr", "2", "--throttle", "1"], viewport: { width: 1280, height: 900, dpr: 2, throttle: 1 } },
  phone: { args: ["--width", "390", "--dpr", "3", "--throttle", "4"], viewport: { width: 390, height: 844, dpr: 3, throttle: 4 } },
};
const COMMON = ["--preload", "bench/preload/gpu-timing.js", "--gpu-util", "--seconds", "8", "--warmup", "2", "--trace-seconds", "3"];
const GPU_TIME = ["--preload", "bench/preload/gpu-timestamps.js"];
const PAGES = {
  "centrifuge/svg": { file: "bench/v2/centrifuge-light.html" },
  "centrifuge/gpu": { file: FROZEN },
  "stress10-iframe/svg": { file: "bench/stress10-iframe-light.html", args: ["--select", "none"] },
  "stress10-iframe/gpu": { file: STRESS_GPU, args: ["--select", "none"] },
  "centrifuge-gputime/gpu": { file: FROZEN, args: GPU_TIME },
  "stress10-gputime/gpu": { file: STRESS_GPU, args: ["--select", "none", ...GPU_TIME] },
};
const GROUPS = [
  [["centrifuge/svg", "centrifuge/gpu"], ["desktop", "phone"]],
  [["stress10-iframe/svg", "stress10-iframe/gpu"], ["desktop", "phone"]],
  [["centrifuge-gputime/gpu", "stress10-gputime/gpu"], ["desktop", "phone"]],
];
const labelOf = (page, config, r) => `${page.replace("/", "-")}-${config}-r${r}`;

const LOAD_PAGES = {
  "v2 SVG": "bench/v2/centrifuge-light.html",
  "GPU deliverable (M4)": FROZEN,
  "GPU live page (M5, base64 DL)": "bench/gpu-m5/live-light.html",
};
/** Installed before page scripts: the time html[data-gpu] became "ready" (the first presented GPU frame). */
const READY_OBSERVER = `window.__readyAt = null; new MutationObserver(() => { if (window.__readyAt === null && document.documentElement?.dataset.gpu === "ready") window.__readyAt = performance.now(); }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-gpu"] });`;

if (!flag("--report-only")) {
  if (!existsSync(FROZEN) || !existsSync(STRESS_GPU)) throw new Error("run node bench/run-final-rows.mjs --freeze first");
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
          const args = ["tools/perf.mjs", PAGES[page].file, ...CONFIGS[config].args, ...(PAGES[page].args ?? []), ...COMMON, "--label", label, "--out", out];
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
  if (!flag("--skip-load") && !flag("--dry")) await measureLoads();
}
report();

// ---- load metrics ---------------------------------------------------------------------------------------------------

/** Loads `file` once in `browser`; resolves to its load metrics (ms since navigation start). */
async function loadOnce(browser, file, viewport) {
  const page = await openPage(browser, { path: resolve(file), ...viewport, preloads: [READY_OBSERVER] });
  try {
    const gpu = await page.cdp.evaluate("!!window.__gpu");
    if (gpu) await waitFor(page.cdp, "window.__readyAt !== null || !!window.__gpu.error", 30000);
    await sleep(200);
    return await page.cdp.evaluate(`(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      return { fcp: fcp?.startTime ?? null, domContentLoaded: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, ready: window.__readyAt, error: window.__gpu?.error ?? null };
    })()`);
  } finally {
    await page.close();
  }
}

/**
 * One load in a fresh Chrome, retried in a new one when CDP stops answering: on this machine a Runtime.evaluate on a
 * freshly loaded page occasionally never returns (renderer idle, no frames; seen on the v2 page too), so a stalled
 * browser is closed and the run repeated rather than waited for.
 */
async function loadWithRetry(file, viewport) {
  for (let attempt = 1; ; attempt++) {
    const browser = await launchChrome();
    let timer;
    const stalled = new Promise((_, fail) => (timer = setTimeout(() => fail(new Error("stalled")), LOAD_STALL_MS)));
    try {
      return { ...(await Promise.race([loadOnce(browser, file, viewport), stalled])), attempts: attempt };
    } catch (error) {
      if (attempt >= 4) throw error;
      console.log(`load ${file}: attempt ${attempt} ${error.message}, retrying`);
    } finally {
      clearTimeout(timer);
      await browser.close();
    }
  }
}

async function measureLoads() {
  const results = {};
  for (const [name, file] of Object.entries(LOAD_PAGES)) {
    const bytes = readFileSync(file);
    results[name] = { file, bytes: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length, configs: {} };
    for (const [config, { viewport }] of Object.entries(CONFIGS)) {
      const runs = [];
      for (let r = 0; r < LOAD_REPEATS; r++) {
        waitQuiet();
        runs.push(await loadWithRetry(file, { width: viewport.width, height: viewport.height, dpr: viewport.dpr, throttle: viewport.throttle }));
      }
      results[name].configs[config] = runs;
      console.log(`load ${name} ${config}: ${JSON.stringify(runs.map((run) => Math.round(run.ready ?? run.fcp)))}`);
    }
  }
  writeFileSync(`${DIR}/load.json`, JSON.stringify(results, null, 1));
}

// ---- report ---------------------------------------------------------------------------------------------------------

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
    ["encode", (j) => pf(j, "gpuEncodeMs"), 2],
    ["GPU pass Σ", (j) => msOf(j, "gpuPass"), 2],
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
  let loads = "";
  if (existsSync(`${DIR}/load.json`)) {
    const data = JSON.parse(readFileSync(`${DIR}/load.json`, "utf8"));
    const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
    const lines = Object.entries(data).flatMap(([name, entry]) =>
      Object.entries(entry.configs).map(([config, runs]) => `| ${name} | ${kb(entry.bytes)} | ${kb(entry.gzip)} | ${config} | ${runs.length} | ${fmt(med(runs.map((r) => r.fcp)), 0)} | ${fmt(med(runs.map((r) => r.domContentLoaded)), 0)} | ${fmt(med(runs.map((r) => r.load)), 0)} | ${fmt(med(runs.map((r) => r.ready ?? NaN)), 0)} |`),
    );
    loads = `\n\n## Load (fresh Chrome per run, medians; ms since navigation start, file://)\n\n| page | raw | gzip -9 | config | runs | first contentful paint | DOMContentLoaded | load | first GPU frame (ready) |\n|---|---:|---:|---|---:|---:|---:|---:|---:|\n${lines.join("\n")}\n\nThe GPU pages show the v2 SVG figure from the first paint (it is in the markup); "first GPU frame" is when the canvas replaced it.`;
  }
  writeFileSync(`${DIR}/rows.md`, `# M4 final perf rows (medians of ${REPEATS}, ms per frame unless noted; generated by bench/run-final-rows.mjs)\n\nsvg = the committed v2 page; gpu = the frozen deliverable (WebGPU, native rotor, static cache). desktop = 1280 px DPR 2; phone = 390 px DPR 3, CPU 4× throttle. "GPU pass Σ" only in the *-gputime rows (timestamps on).\n\n${table}${loads}\n`);
  console.log(table);
}
