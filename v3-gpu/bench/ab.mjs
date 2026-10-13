#!/usr/bin/env node
// Interleaved A/B for small effects on a shared, noisy machine: A B A B … (fresh Chrome each), paired differences.
//
//   node bench/ab.mjs --name halo --pairs 6 --b "--preload bench/preload/halo-off.js" -- <perf.mjs args (page + config)>
//   (--a "<extra args for A>" optional; both get the common args after --)
// Writes out/perf/ab-<name>-{a,b}<k>.json and out/perf/ab-<name>.json (per-metric A mean, B mean, paired Δ mean ± sd).
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const cut = argv.indexOf("--");
const own = cut < 0 ? argv : argv.slice(0, cut);
const common = cut < 0 ? [] : argv.slice(cut + 1);
const value = (name, fallback) => (own.includes(name) ? own[own.indexOf(name) + 1] : fallback);
const name = value("--name", "ab");
const pairs = Number(value("--pairs", 6));
const split = (s) => (s ? s.match(/"[^"]*"|\S+/g).map((t) => t.replace(/^"|"$/g, "")) : []);
const A = split(value("--a", ""));
const B = split(value("--b", ""));

const METRICS = {
  framePeriodP50: (j) => j.frames.intervals.p50,
  droppedPct: (j) => j.frames.droppedPct,
  rafCbMs: (j) => j.script.callbackMsPerFrame,
  styleLayoutMs: (j) => j.metrics.perFrame.styleMs + j.metrics.perFrame.layoutMs,
  mainTaskMs: (j) => j.metrics.perFrame.taskMs,
  paintMainMs: (j) => j.trace.perFrame.paintMainMs,
  rasterWorkerMs: (j) => j.trace.perFrame.rasterMs,
  gpuRasterMs: (j) => j.trace.perFrame.gpuRasterMs,
  gpuTotalMs: (j) => j.trace.perFrame.gpuMs,
};
const runs = { a: [], b: [] };
for (let k = 1; k <= pairs; k++) {
  for (const [side, extra] of k % 2 ? [["a", A], ["b", B]] : [["b", B], ["a", A]]) {
    const out = `out/perf/ab-${name}-${side}${k}.json`;
    const res = spawnSync(process.execPath, ["tools/perf.mjs", ...common, ...extra, "--label", `ab-${name}-${side}${k}`, "--out", out], { encoding: "utf8", timeout: 300000 });
    process.stdout.write(res.stdout + (res.status ? res.stderr : ""));
    runs[side].push(JSON.parse(readFileSync(out, "utf8")));
  }
}
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const sd = (a) => Math.sqrt(a.reduce((s, v) => s + (v - mean(a)) ** 2, 0) / Math.max(1, a.length - 1));
const result = { name, pairs, a: A, b: B, common, metrics: {} };
for (const [metric, get] of Object.entries(METRICS)) {
  const a = runs.a.map(get);
  const b = runs.b.map(get);
  const d = b.map((v, i) => v - a[i]);
  result.metrics[metric] = { a: mean(a), b: mean(b), delta: mean(d), deltaSd: sd(d), deltaPct: (100 * mean(d)) / mean(a), t: mean(d) / (sd(d) / Math.sqrt(d.length) || Infinity) };
}
writeFileSync(`out/perf/ab-${name}.json`, JSON.stringify(result, null, 1));
for (const [metric, m] of Object.entries(result.metrics)) console.log(`${metric.padEnd(16)} A ${m.a.toFixed(2).padStart(7)}  B ${m.b.toFixed(2).padStart(7)}  Δ ${m.delta >= 0 ? "+" : ""}${m.delta.toFixed(2)} ± ${m.deltaSd.toFixed(2)} (${m.deltaPct.toFixed(0)}%, t ${m.t.toFixed(1)})`);
