#!/usr/bin/env node
// M6a baseline matrix: every run is a fresh Chrome via tools/perf.mjs, sequential (never parallel: runs would
// compete for the GPU and cores). Existing JSONs are reused unless --force; then out/perf/baselines.md is rebuilt.
//
//   node bench/run-baselines.mjs [--repeats 3] [--only substring] [--force] [--report-only] [--dry]
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { cpuIdle } from "../tools/perf-lib.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const REPEATS = Number(value("--repeats", 3));
// The machine is shared (other agents, test runners, simulators): wait (≤ 3 min) for idle CPU before a run; a run whose
// machine idle before/after was below NOISY % counts as missing (rerun) and is left out of the report.
const QUIET = Number(value("--quiet", 50));
const NOISY = Number(value("--noisy", 25));
const idleOf = (j) => Math.min(j.meta.cpuIdle?.before ?? 0, j.meta.cpuIdle?.after ?? 0);
// runs from before idle was recorded: judged by the load average (≈ 5–15 while other agents work)
const noisy = (j) => (j.meta.cpuIdle ? idleOf(j) < NOISY : Math.max(j.meta.loadavg.before[0], j.meta.loadavg.after?.[0] ?? 0) > 20);
function waitQuiet() {
  const t0 = Date.now();
  for (;;) {
    const idle = cpuIdle();
    if (idle === null || idle >= QUIET || Date.now() - t0 > 3 * 60000) return idle;
  }
}
// [page, variant, config]
export const MATRIX = [];
for (const page of ["centrifuge", "stress10", "factory"])
  for (const variant of ["svg", "dirty"])
    for (const config of ["desktop", "phone"]) MATRIX.push([page, variant, config]);
for (const config of ["desktop", "phone"]) {
  MATRIX.push(["centrifuge", "frozen", config], ["centrifuge", "halooff", config], ["stress10", "halooff", config]);
}
MATRIX.push(["factorytour", "svg", "desktop"], ["centrifuge", "layered", "desktop"], ["centrifuge", "headed", "desktop"], ["stress10", "headed", "desktop"]);

const labelOf = (page, variant, config, r) => `${page}-${variant}-${config}-r${r}`;

if (!flag("--report-only")) {
  // repeats outermost: a burst of machine load hits one repeat of many rows, not every repeat of one row
  for (let r = 1; r <= REPEATS; r++) {
    for (const [page, variant, config] of MATRIX) {
      const label = labelOf(page, variant, config, r);
      if (ONLY && !label.includes(ONLY)) continue;
      const out = `out/perf/${label}.json`;
      if (existsSync(out) && !flag("--force") && !noisy(JSON.parse(readFileSync(out, "utf8")))) continue;
      const args = ["tools/perf.mjs", PAGES[page].file, ...CONFIGS[config], ...(PAGES[page].args ?? []), ...VARIANTS[variant], "--seconds", "8", "--warmup", "2", "--trace-seconds", "3", "--label", label, "--out", out];
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
report();

function report() {
  const med = (a) => {
    const s = a.filter(Number.isFinite).sort((x, y) => x - y);
    return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
  };
  const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "–");
  const COLS = [
    ["frame p50", (j) => j.frames.intervals.p50, 1],
    ["frame p95", (j) => j.frames.intervals.p95, 1],
    ["dropped %", (j) => j.frames.droppedPct, 1],
    ["rAF cb", (j) => j.script.callbackMsPerFrame, 2],
    ["script", (j) => j.metrics.perFrame.scriptMs, 2],
    ["style+layout", (j) => j.metrics.perFrame.styleMs + j.metrics.perFrame.layoutMs, 2],
    ["main task", (j) => j.metrics.perFrame.taskMs, 2],
    ["paint (main)", (j) => j.trace?.perFrame.paintMainMs, 2],
    ["raster (wkr)", (j) => j.trace?.perFrame.rasterMs, 2],
    ["GPU raster", (j) => j.trace?.perFrame.gpuRasterMs, 2],
    ["GPU total", (j) => j.trace?.perFrame.gpuMs, 2],
    ["LoAF/s", (j) => j.loaf.perSecond, 1],
    ["DOM elems", (j) => j.dom.elements, 0],
    ["Nodes", (j) => j.metrics.end.Nodes, 0],
  ];
  const rows = [];
  const raw = {};
  for (const [page, variant, config] of MATRIX) {
    const runs = [];
    for (let r = 1; r <= REPEATS; r++) {
      const f = `out/perf/${labelOf(page, variant, config, r)}.json`;
      if (existsSync(f)) {
        const j = JSON.parse(readFileSync(f, "utf8"));
        if (!noisy(j)) runs.push(j);
      }
    }
    if (!runs.length) continue;
    const cells = COLS.map(([, get, d]) => {
      const vals = runs.map(get);
      const m = med(vals);
      const lo = Math.min(...vals.filter(Number.isFinite));
      const hi = Math.max(...vals.filter(Number.isFinite));
      const spread = Number.isFinite(m) && m > 0.05 && runs.length > 1 && (hi - lo) / m > 0.15 ? ` <sub>${fmt(lo, d)}–${fmt(hi, d)}</sub>` : "";
      return fmt(m, d) + spread;
    });
    const ratio = Math.min(...runs.map((j) => j.frames.pageFrameRatio));
    const problems = runs.reduce((s, j) => s + (j.problems?.length ?? 0), 0);
    const extra = runs[0].pageStats?.slotSkipped ? ` skip ${fmt((100 * med(runs.map((j) => j.pageStats.slotSkipped.window / j.pageStats.slotWrites.window))), 0)}% writes / ${fmt(100 * med(runs.map((j) => j.pageStats.slotKBSkipped.window / j.pageStats.slotKB.window)), 0)}% KB` : "";
    rows.push(`| ${page} | ${variant} | ${config} | ${runs.length} | ${cells.join(" | ")} | ${fmt(100 * ratio, 0)}%${problems ? ` ⚠${problems}` : ""}${extra} |`);
    raw[`${page}-${variant}-${config}`] = Object.fromEntries(COLS.map(([name, get]) => [name, runs.map(get)]));
  }
  const first = (() => {
    for (const [p, v, c] of MATRIX) {
      const f = `out/perf/${labelOf(p, v, c, 1)}.json`;
      if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
    }
  })();
  const md = `# M6a SVG baselines

Generated by \`node bench/run-baselines.mjs\` (\`--report-only\` to rebuild this table). Median of ${REPEATS} runs, each a fresh
Chrome; a small range (min–max) is shown when the runs spread by more than 15 % of the median.
Chrome ${first?.meta.chrome ?? "?"}, ${first?.meta.gpu?.device ?? "?"}; vsync ${fmt(first?.meta.vsyncMs, 2)} ms (headless BeginFrame cadence).

Configs: **desktop** = 1280×900 CSS px, DPR 2, no CPU throttle; **phone** = 390×844, DPR 3, mobile emulation, 4× CPU
throttle (CDP throttling slows only the renderer main thread: raster workers and the GPU process run at full speed).
Variants: **svg** = page as built; **dirty** = slot innerHTML writes skipped when the string is unchanged
(bench/preload/dirty-check.js); **frozen** = slot writes after the first dropped (diagnostic floor: simulation + string
building only); **halooff** = \`.iso-halo{filter:none}\`; **layered** = \`will-change:transform\` on slot groups;
**headed** = real window instead of --headless=new.

Columns (ms per frame unless noted): frame p50/p95 = rAF-to-rAF interval; dropped = Σ(round(interval/vsync)−1) as % of
expected frames; rAF cb = page rAF callbacks (wrapped, performance.now); script / style+layout / main task = CDP
Performance.getMetrics deltas ÷ frames (main task = everything the renderer main thread ran); paint (main) =
PrePaint+Paint+Layerize+Commit self time from the trailing 3 s trace; raster (wkr) = cc RasterTask on the renderer
worker pool (paint-op playback/serialisation); GPU raster = RasterDecoderImpl (Skia Graphite replay of the SVG paint
ops) on CrGpuMain; GPU total = CrGpuMain + VizCompositorThread busy; DOM elems = live elements at the end; Nodes = CDP
Nodes (includes detached nodes awaiting GC: slot innerHTML churn); last column = min page-frame ratio (share of
frames in which the page's own rAF ran: proves the IntersectionObserver gate kept the loop alive).

| page | variant | config | runs | ${COLS.map(([n]) => n).join(" | ")} | page frames |
|---|---|---|---|${COLS.map(() => "---:").join("|")}|---|
${rows.join("\n")}

Pages: centrifuge = bench/v2/centrifuge-light.html (frozen copy of v2-factory/parts/centrifuge, sha1 ${first?.meta.sha1 ?? "?"});
stress10 = bench/stress10-light.html (10 inline instances, bench/stress.mjs); factory = bench/v2/factory-light.html
(frozen copy of v2-factory/assembly/factory-light.html, default tour: opens at 1.4 s, so the measured 2–10 s window is open).
`;
  writeFileSync("out/perf/baselines.md", md);
  writeFileSync("out/perf/baselines.json", JSON.stringify(raw, null, 1));
  console.log(`wrote out/perf/baselines.md (${rows.length} rows)`);
}
