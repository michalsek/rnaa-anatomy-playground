// node tools/live-gate.mjs <command> [options] — page gates for the GPU renderer (exit 1 on any failed check;
// thresholds in tools/gates.config.mjs, rationale in notes/GATES.md; reports → out/tmp/gates/<command>.json).
// Runtime pages are driven in lockstep (tools/lockstep.js: turbo frames, time rebased at the runtime's start, GPU
// ready first) and frozen after exactly N runtime ticks, so both pages show the same simulation state.
//
//   static [--quick] [--mutate blur|patch]   M2 static frame (out/gpu/static*.html, fixture) vs the v2 static SVG frame
//   live [--quick] [--native 0] [--mutate drop-native|drop-slot]   live page (native rotor; --native 0: markup path)
//                                             vs the SVG page at LIVE.ticks, fades, reduced motion, DPR 4
//   motion [--quick] [--mutate pop]           consecutive frames: GPU-only flicker and frame-to-frame change vs SVG
//   determinism [--ticks 3000] [--mutate no-rebase]   runtime state per tick: SVG vs GPU page, two runs of each, identical
//   calib [--quick] [--mutate contrast]       hairline ink per calibration cell, GPU / SVG (src/fixture/make-calib.mjs)
//   perf                                      CPU cost per frame from __gpu.frameStats() (numbers only, never fails)
// Tools (no gate): timeline [--ticks 2400] · record [--ticks 1800] (→ tools/fixtures/live-markup.json) ·
//   sheet --from 600 --count 60 [--theme dark] [--page gpu|svg] [--box x,y,w,h]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { CALIB, LIVE, MOTION, PERF, STATIC } from "./gates.config.mjs";
import { compareImages, crop, erode, largestCluster, readPng, STRICT_DELTA } from "./diff.mjs";
import {
  GATES_OUT, PAGES, ROOT, RUNTIME_STATE, TICK_GATE, advanceTo, createChecks, fileUrl, lockstepPreload, openPage, openRuntimePage,
  parseArgs, settle, shot, stageBox, waitFor, withBrowser,
} from "./harness.mjs";

const INJECT_FADE = `FACTORY.machines.centrifuge.accept("in", FACTORY.item("graph"))`;
/** Self-test mutations of the GPU page; the gate must FAIL with any of them. */
const MUTATIONS = {
  // the native rotor draws no pocketed packets (v2's state and its on-demand strings stay intact: pixels must catch it)
  "drop-native": `window.__factoryHooks.push((f) => { const define = f.define; f.define = (id, make) => define.call(f, id, (api) => { let gpu; Object.defineProperty(api, "gpu", { configurable: true, get: () => gpu, set(next) { gpu = { rotor: (angle, pockets, ...rest) => next.rotor(angle, pockets.map(() => null), ...rest) }; } }); return make(api); }); });`,
  // the GPU page loses one live slot: the runtime's writes to it go to a detached element (markup path: --native 0)
  "drop-slot": `window.__factoryHooks.push((f) => { f.slots["centrifuge:rotorFront"] = document.createElementNS("http://www.w3.org/2000/svg", "g"); });`,
  // the figure renders soft (as a resampled canvas would)
  blur: `addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = "canvas.iso-svg{filter:blur(0.5px)}"; document.head.append(s); });`,
  // a 5 × 5 CSS px patch of wrong colour on the figure (a part that went missing or moved)
  patch: `addEventListener("load", () => { const c = document.querySelector("canvas.iso-svg"); const p = document.createElement("div"); const r = c.getBoundingClientRect(); p.style.cssText = "position:absolute;width:5px;height:5px;left:" + (r.left + scrollX + r.width * 0.5) + "px;top:" + (r.top + scrollY + r.height * 0.42) + "px;background:#808080"; document.body.append(p); });`,
  // hairlines drawn with more contrast
  contrast: `addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = "canvas.iso-svg{filter:contrast(1.3)}"; document.head.append(s); });`,
  // a 5 × 5 CSS px patch shows on one frame only (tick 880): a part popping for a frame
  pop: `window.__factoryHooks.push((f) => { let patch; f.onFrame(() => { if (!patch) { const c = document.querySelector("canvas.iso-svg"); const r = c.getBoundingClientRect(); patch = document.createElement("div"); patch.style.cssText = "position:absolute;width:5px;height:5px;left:" + (r.left + scrollX + r.width * 0.5) + "px;top:" + (r.top + scrollY + r.height * 0.42) + "px;background:#808080"; document.body.append(patch); } patch.hidden = __tickGate.ticks !== 880; }); });`,
};

const pct = (value) => `${value}%`;
const describeDiff = (d) => `loose ${pct(d.loosePct)} (blob ${d.looseCluster}, solid ${d.solidCluster}) · incl. AA ${pct(d.withAAPct)} · Δ>${STRICT_DELTA} ${pct(d.strictPct)}`;
const withinLimits = (d, limit) => d.loosePct <= limit.loosePct && d.withAAPct <= limit.withAAPct && d.solidCluster <= limit.solidCluster;
const limitText = (limit) => `≤ ${limit.loosePct}% loose, ≤ ${limit.withAAPct}% incl. AA, solid blob ≤ ${limit.solidCluster} px`;

/**
 * Runs one runtime page through `ticks`, freezing at each: `inject` = [{ tick, js }] is evaluated while frozen at its
 * tick (before the next), a shot and the runtime state are taken at every tick in `ticks`.
 */
async function runPage(browser, { path, ticks, dpr, width, reduced = false, inject = [], dir, prefix, preloads = [] }) {
  const { cdp, problems, warnings, close } = await openRuntimePage(browser, { path, dpr, width, reduced, preloads });
  try {
    const box = await stageBox(cdp);
    const stops = [...new Set([...ticks, ...inject.map((i) => i.tick)])].sort((a, b) => a - b);
    const shots = {};
    for (const tick of stops) {
      await advanceTo(cdp, tick);
      for (const { js } of inject.filter((i) => i.tick === tick)) await cdp.evaluate(js);
      if (!ticks.includes(tick)) continue;
      await settle(cdp);
      const file = await shot(cdp, join(dir, `${prefix}-t${tick}.png`), box);
      shots[tick] = { file, state: await cdp.evaluate(RUNTIME_STATE), gpu: await cdp.evaluate("window.__gpu ? { error: __gpu.error, frames: __gpu.frames, ready: __gpu.ready } : null") };
    }
    return { shots, problems, warnings };
  } finally {
    await close();
  }
}

/** The GPU live page: native rotor (default), or `--native 0` for the markup path (`?native=0`). */
const gpuPageOf = (theme, native) => (String(native) === "0" ? `${fileUrl(PAGES.gpu(theme))}?native=0` : PAGES.gpu(theme));

/** SVG and GPU page through the same ticks; every shot pair must be within `limit` and the runtime states equal. */
async function compareRun(browser, checks, { name, theme, ticks, dpr, reduced = false, inject = [], mutate, native }) {
  const dir = join(GATES_OUT, "live", name);
  const common = { ticks, dpr, reduced, inject, dir };
  const svg = await runPage(browser, { ...common, path: PAGES.svg(theme), prefix: `${theme}-svg` });
  const gpu = await runPage(browser, { ...common, path: gpuPageOf(theme, native), prefix: `${theme}-gpu`, preloads: mutate ? [MUTATIONS[mutate]] : [] });
  const limit = LIVE.limits[dpr];
  const rows = [];
  for (const tick of ticks) {
    const a = svg.shots[tick];
    const b = gpu.shots[tick];
    const diff = compareImages(a.file, b.file, { diffFile: join(dir, `${theme}-diff-t${tick}.png`) });
    const stateEqual = Object.keys(a.state).filter((key) => a.state[key] !== b.state[key]);
    rows.push({ tick, ...diff, stateDiffers: stateEqual });
    checks.check(withinLimits(diff, limit), `${name} ${theme} t${tick} pixels (${limitText(limit)})`, describeDiff(diff));
    checks.check(!stateEqual.length, `${name} ${theme} t${tick} runtime state, readout and aria-live equal`, stateEqual.length ? `${stateEqual.join(", ")} differ: readout "${a.state.readout}" vs "${b.state.readout}"` : `"${b.state.readout}" · "${b.state.status}"`);
    checks.check(b.gpu?.ready && !b.gpu.error, `${name} ${theme} t${tick} GPU page ready, no __gpu.error`, b.gpu?.error ?? "");
  }
  for (const [kind, run] of [["svg", svg], ["gpu", gpu]]) checks.check(!run.problems.length && !run.warnings.length, `${name} ${theme} ${kind} page console clean`, [...run.problems, ...run.warnings].slice(0, 3).join(" | "));
  return rows;
}

async function liveGate(options) {
  const native = options.native ?? "1";
  const checks = createChecks(`live${native === "0" ? "-markup" : ""}${options.mutate ? `-mutate-${options.mutate}` : ""}`);
  const quick = Boolean(options.quick);
  const report = {};
  await withBrowser(async (browser) => {
    for (const theme of LIVE.themes) {
      report[`ticks-${theme}`] = await compareRun(browser, checks, { name: "ticks", theme, ticks: quick ? LIVE.quickTicks : LIVE.ticks, dpr: LIVE.dpr, mutate: options.mutate, native });
      if (options.mutate) continue;
      const inject = LIVE.fade.injectAt.map((tick) => ({ tick, js: INJECT_FADE }));
      report[`fade-${theme}`] = await compareRun(browser, checks, { name: "fade", theme, ticks: quick ? LIVE.fade.ticks.slice(0, 2) : LIVE.fade.ticks, dpr: LIVE.dpr, inject, native });
      report[`reduced-${theme}`] = await compareRun(browser, checks, { name: "reduced", theme, ticks: quick ? LIVE.reduced.ticks.slice(0, 1) : LIVE.reduced.ticks, dpr: LIVE.dpr, reduced: true, native });
      if (!quick) report[`dpr${LIVE.highDpr.dpr}-${theme}`] = await compareRun(browser, checks, { name: `dpr${LIVE.highDpr.dpr}`, theme, ticks: LIVE.highDpr.ticks, dpr: LIVE.highDpr.dpr, native });
    }
  });
  checks.finish(report);
}

/** Static pages (no runtime): ready → shot. */
async function staticShot(browser, { path, dpr, file, preloads = [] }) {
  const { cdp, problems, warnings, close } = await openPage(browser, { path, dpr, preloads });
  try {
    await waitFor(cdp, "!window.__gpu || window.__gpu.ready || !!window.__gpu.error", 60000);
    const error = await cdp.evaluate("window.__gpu?.error ?? null");
    await cdp.evaluate("new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))");
    await shot(cdp, file, await stageBox(cdp));
    return { file, problems: [...problems, ...warnings, ...(error ? [`__gpu.error: ${error}`] : [])] };
  } finally {
    await close();
  }
}

/** The v2 page with its module script removed: the static frame the DL describes (live slots empty). */
function staticSvgPage(theme) {
  const html = readFileSync(join(ROOT, PAGES.svg(theme)), "utf8").replace(/<script type="module">[\s\S]*?<\/script>/, "");
  const file = join(GATES_OUT, "pages", `centrifuge-static-${theme}.html`);
  mkdirSync(join(GATES_OUT, "pages"), { recursive: true });
  writeFileSync(file, html);
  return file;
}

async function staticGate(options) {
  const checks = createChecks(options.mutate ? `static-mutate-${options.mutate}` : "static");
  const dprs = options.quick ? STATIC.quickDprs : STATIC.dprs;
  const preloads = options.mutate ? [MUTATIONS[options.mutate]] : [];
  const dir = join(GATES_OUT, "static");
  const rows = [];
  await withBrowser(async (browser) => {
    const pairs = [];
    for (const theme of STATIC.themes) for (const dpr of dprs) pairs.push({ name: "centrifuge", theme, dpr, svg: staticSvgPage(theme), gpu: PAGES.gpuStatic(theme), limit: STATIC.limits[dpr] });
    if (!options.mutate) for (const theme of STATIC.themes) for (const dpr of STATIC.fixture.dprs) pairs.push({ name: "fixture", theme, dpr, svg: `out/gpu/fixture/fixture${theme === "light" ? "-light" : ""}.html`, gpu: `out/gpu/fixture/fixture-gpu${theme === "light" ? "-light" : ""}.html`, limit: STATIC.fixture.limits[dpr] });
    for (const { name, theme, dpr, svg, gpu, limit } of pairs) {
      const tag = `${name}-${theme}-dpr${dpr}`;
      const a = await staticShot(browser, { path: svg, dpr, file: join(dir, `${tag}-svg.png`) });
      const b = await staticShot(browser, { path: gpu, dpr, file: join(dir, `${tag}-gpu.png`), preloads });
      let diff;
      try {
        diff = compareImages(a.file, b.file, { diffFile: join(dir, `${tag}-diff.png`) });
      } catch (error) {
        checks.check(false, `${tag} same shot size`, error.message);
        continue;
      }
      rows.push({ tag, ...diff });
      checks.check(withinLimits(diff, limit), `${tag} pixels (${limitText(limit)})`, describeDiff(diff));
      checks.check(!b.problems.length, `${tag} GPU page console clean, no __gpu.error`, b.problems.slice(0, 3).join(" | "));
    }
  });
  checks.finish({ rows });
}

/**
 * Consecutive frames, read back three at a time. A pixel "toggles" at frame i when frames i−1 and i+1 agree (Δ ≤ 8)
 * and frame i differs from both (Δ > 8). Popping and z-fighting are toggles the SVG page does not have, over an area:
 * per frame, the GPU-only toggles are eroded (3 × 3) so that AA noise along moving edges drops out, and the largest
 * remaining blob is kept.
 */
function motionStats(svgFiles, gpuFiles) {
  const delta = (a, b, i) => Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
  const totals = { svgChange: 0, gpuChange: 0, svgToggles: 0, gpuToggles: 0, gpuOnlyToggles: 0, gpuOnlySolidBlob: 0, gpuOnlySolidBlobFrame: null, frames: svgFiles.length };
  let recent = [];
  for (let f = 0; f < svgFiles.length; f++) {
    recent.push({ svg: readPng(svgFiles[f]), gpu: readPng(gpuFiles[f]) });
    if (recent.length > 3) recent.shift();
    if (recent.length >= 2) {
      const [previous, current] = recent.slice(-2);
      for (let i = 0; i < current.svg.data.length; i += 4) {
        if (delta(previous.svg, current.svg, i) > STRICT_DELTA) totals.svgChange++;
        if (delta(previous.gpu, current.gpu, i) > STRICT_DELTA) totals.gpuChange++;
      }
    }
    if (recent.length === 3) {
      const [before, middle, after] = recent;
      const { width, height } = middle.gpu;
      const gpuOnly = new Uint8Array(width * height);
      const toggles = (page, i) => delta(before[page], after[page], i) <= STRICT_DELTA && delta(before[page], middle[page], i) > STRICT_DELTA && delta(middle[page], after[page], i) > STRICT_DELTA;
      for (let p = 0, i = 0; p < gpuOnly.length; p++, i += 4) {
        const svgToggle = toggles("svg", i);
        const gpuToggle = toggles("gpu", i);
        if (svgToggle) totals.svgToggles++;
        if (gpuToggle) totals.gpuToggles++;
        if (gpuToggle && !svgToggle) {
          totals.gpuOnlyToggles++;
          gpuOnly[p] = 1;
        }
      }
      const blob = largestCluster(erode(gpuOnly, width, height), width, height);
      if (blob > totals.gpuOnlySolidBlob) Object.assign(totals, { gpuOnlySolidBlob: blob, gpuOnlySolidBlobFrame: f - 1 });
    }
  }
  return totals;
}

async function motionGate(options) {
  const checks = createChecks(options.mutate ? `motion-mutate-${options.mutate}` : "motion");
  const runs = options.quick ? MOTION.quickRuns : MOTION.runs;
  const report = [];
  await withBrowser(async (browser) => {
    for (const { theme, from, count } of runs) {
      const ticks = Array.from({ length: count }, (_, i) => from + i);
      const dir = join(GATES_OUT, "motion", `${theme}-${from}`);
      const svg = await runPage(browser, { path: PAGES.svg(theme), ticks, dpr: MOTION.dpr, dir, prefix: "svg" });
      const gpu = await runPage(browser, { path: PAGES.gpu(theme), ticks, dpr: MOTION.dpr, dir, prefix: "gpu", preloads: options.mutate ? [MUTATIONS[options.mutate]] : [] });
      const stats = motionStats(ticks.map((t) => svg.shots[t].file), ticks.map((t) => gpu.shots[t].file));
      const changeRatio = stats.gpuChange / Math.max(1, stats.svgChange);
      const flickerRatio = stats.gpuToggles / Math.max(1, stats.svgToggles);

      const states = ticks.filter((t) => svg.shots[t].state.slots !== gpu.shots[t].state.slots || svg.shots[t].state.readout !== gpu.shots[t].state.readout);
      const label = `${theme} ticks ${from}–${from + count - 1}`;
      report.push({ theme, from, count, ...stats, changeRatio, flickerRatio });
      checks.check(changeRatio >= MOTION.changeRatio[0] && changeRatio <= MOTION.changeRatio[1], `${label} frame-to-frame change GPU / SVG in [${MOTION.changeRatio.join(", ")}]`, `${changeRatio.toFixed(3)} (${stats.gpuChange} vs ${stats.svgChange} px)`);
      checks.check(flickerRatio <= MOTION.flickerRatio, `${label} toggles GPU / SVG ≤ ${MOTION.flickerRatio}`, `${flickerRatio.toFixed(3)} (${stats.gpuToggles} vs ${stats.svgToggles})`);
      const blobAt = stats.gpuOnlySolidBlobFrame === null ? "" : ` at tick ${from + stats.gpuOnlySolidBlobFrame}`;
      checks.check(stats.gpuOnlySolidBlob <= MOTION.gpuOnlySolidBlob, `${label} no GPU-only flicker area (solid blob ≤ ${MOTION.gpuOnlySolidBlob} px)`, `largest ${stats.gpuOnlySolidBlob} px${blobAt}; ${stats.gpuOnlyToggles} GPU-only toggling px in all (AA noise at moving edges)`);
      checks.check(!states.length, `${label} runtime state equal at every frame`, states.slice(0, 5).join(", "));
      checks.check(![...svg.problems, ...gpu.problems, ...gpu.warnings].length, `${label} console clean`, [...svg.problems, ...gpu.problems, ...gpu.warnings].slice(0, 3).join(" | "));
    }
  });
  checks.finish({ runs: report });
}

/** Per-tick runtime state hashes, recorded after each tick's writes (a microtask queued at the start of the tick). */
const STATE_RECORDER = `window.__factoryHooks.push((factory) => {
  const rows = window.__stateLog = [];
  const hash = (text) => { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
  factory.onFrame(() => queueMicrotask(() => { const s = ${RUNTIME_STATE}; rows.push([s.ticks, hash(s.readout + "|" + s.status), hash(s.centrifuge), hash(s.slots)]); }));
});`;

async function recordStates(browser, { path, ticks, mode, rebase = "first-intersection" }) {
  const lockstep = { mode, rebase, waitReady: true };
  const { cdp, problems, close } = await openPage(browser, { path, dpr: 1, preloads: [lockstepPreload(lockstep), TICK_GATE, STATE_RECORDER] });
  try {
    await advanceTo(cdp, ticks, 600000);
    return { rows: await cdp.evaluate("__stateLog"), problems };
  } finally {
    await close();
  }
}

async function determinismGate(options) {
  // --mutate no-rebase: virtual time not restarted at the runtime's start; SVG vs GPU must then diverge (self-test)
  const rebase = options.mutate === "no-rebase" ? null : "first-intersection";
  const checks = createChecks(rebase ? "determinism" : "determinism-mutate-no-rebase");
  const ticks = Number(options.ticks ?? 3000);
  const realTicks = Number(options["real-ticks"] ?? 120);
  const firstDifference = (a, b) => {
    const fields = ["readout+status", "centrifuge.status()", "slot markup"];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (JSON.stringify(a[i]) === JSON.stringify(b[i])) continue;
      const differs = fields.filter((_, f) => a[i]?.[f + 1] !== b[i]?.[f + 1]);
      return `first difference at tick ${a[i]?.[0] ?? b[i]?.[0]}: ${differs.join(", ")}`;
    }
    return "";
  };
  const report = {};
  await withBrowser(async (browser) => {
    const theme = options.theme ?? "dark";
    const runs = {
      svg1: await recordStates(browser, { path: PAGES.svg(theme), ticks, mode: "turbo", rebase }),
      svg2: await recordStates(browser, { path: PAGES.svg(theme), ticks, mode: "turbo", rebase }),
      gpu1: await recordStates(browser, { path: PAGES.gpu(theme), ticks, mode: "turbo", rebase }),
      gpu2: await recordStates(browser, { path: PAGES.gpu(theme), ticks, mode: "turbo", rebase }),
      svgReal: await recordStates(browser, { path: PAGES.svg(theme), ticks: realTicks, mode: "real", rebase }),
      gpuReal: await recordStates(browser, { path: PAGES.gpu(theme), ticks: realTicks, mode: "real", rebase }),
    };
    for (const [name, run] of Object.entries(runs)) report[name] = { rows: run.rows.length, problems: run.problems };
    for (const [name, run] of Object.entries(runs)) checks.check(run.rows.length === (name.endsWith("Real") ? realTicks : ticks), `${name}: one state row per tick`, `${run.rows.length} rows`);
    const pairs = [["svg1", "svg2", "SVG page twice"], ["gpu1", "gpu2", "GPU page twice"], ["svg1", "gpu1", "SVG vs GPU page"], ["svgReal", "gpuReal", "SVG vs GPU page in real-frame mode"], ["svgReal", "svg1", "real-frame mode vs turbo (SVG)"]];
    for (const [a, b, label] of pairs) {
      const length = Math.min(runs[a].rows.length, runs[b].rows.length);
      const difference = firstDifference(runs[a].rows.slice(0, length), runs[b].rows.slice(0, length));
      checks.check(!difference, `${label}: bit-identical runtime state over ${length} ticks`, difference);
    }
  });
  checks.finish(report);
}

/** Calibration sheet: per cell, GPU ink / SVG ink inside the cell box (box from cells.json, in viewBox units). */
function calibInk(image, box, viewBox, cssScale) {
  const [vx, vy] = viewBox;
  const toPx = (v, origin) => Math.round((v - origin) * cssScale);
  const x0 = toPx(box[0], vx);
  const y0 = toPx(box[1], vy);
  const w = Math.round(box[2] * cssScale);
  const h = Math.round(box[3] * cssScale);
  const lum = (x, y) => {
    const i = (y * image.width + x) * 4;
    return 0.2126 * image.data[i] + 0.7152 * image.data[i + 1] + 0.0722 * image.data[i + 2];
  };
  const border = [];
  for (let x = x0; x < x0 + w; x++) border.push(lum(x, y0), lum(x, y0 + h - 1));
  for (let y = y0; y < y0 + h; y++) border.push(lum(x0, y), lum(x0 + w - 1, y));
  border.sort((p, q) => p - q);
  const background = border[border.length >> 1];
  let ink = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) ink += Math.abs(lum(x, y) - background);
  return ink;
}

const calibLimit = (cell, dpr) => {
  const limits = CALIB.limits[dpr];
  const byKind = limits[cell.kind];
  return byKind?.[cell.width] ?? byKind?.default ?? limits.default;
};

async function calibGate(options) {
  const checks = createChecks(options.mutate ? `calib-mutate-${options.mutate}` : "calib");
  const meta = JSON.parse(readFileSync(join(ROOT, "out/gpu/calib/cells.json"), "utf8"));
  const { dprs, themes } = options.quick ? CALIB.quick : CALIB;
  const preloads = options.mutate ? [MUTATIONS[options.mutate]] : [];
  const rows = [];
  await withBrowser(async (browser) => {
    for (const theme of themes)
      for (const dpr of dprs) {
        const suffix = theme === "light" ? "-light" : "";
        const dir = join(GATES_OUT, "calib");
        const svg = await staticShot(browser, { path: `out/gpu/calib/calib${suffix}.html`, dpr, file: join(dir, `${theme}-dpr${dpr}-svg.png`) });
        const gpu = await staticShot(browser, { path: `out/gpu/calib/calib-gpu${suffix}.html`, dpr, file: join(dir, `${theme}-dpr${dpr}-gpu.png`), preloads });
        checks.check(!gpu.problems.length, `calib ${theme} DPR ${dpr} GPU page console clean`, gpu.problems.slice(0, 2).join(" | "));
        const a = readPng(svg.file);
        const b = readPng(gpu.file);
        if (a.width !== b.width || a.height !== b.height) {
          checks.check(false, `calib ${theme} DPR ${dpr} same shot size`, `${a.width}x${a.height} vs ${b.width}x${b.height}`);
          continue;
        }
        const cssScale = a.width / meta.viewBox[2];
        const failing = [];
        let measured = 0;
        for (const cell of meta.cells) {
          const svgInk = calibInk(a, cell.box, meta.viewBox, cssScale);
          if (svgInk < CALIB.minInk * dpr * dpr) continue;
          const ratio = calibInk(b, cell.box, meta.viewBox, cssScale) / svgInk;
          const [min, max] = calibLimit(cell, dpr);
          const row = { theme, dpr, ...cell, ratio: +ratio.toFixed(3), min, max };
          rows.push(row);
          measured++;
          if (ratio < min || ratio > max) failing.push(row);
        }
        const name = (c) => `${c.half} ${c.kind} w${c.width}${c.angle !== undefined ? ` ${c.angle}°` : ""}${c.offset ? ` +${c.offset}` : ""}: ${c.ratio} ∉ [${c.min}, ${c.max}]`;
        checks.check(!failing.length, `calib ${theme} DPR ${dpr}: every cell's GPU / SVG ink within its limits (${measured} cells)`, failing.slice(0, 6).map(name).join("; ") + (failing.length > 6 ? ` … ${failing.length} failing` : ""));
      }
  });
  checks.finish({ rows });
}

/** CPU cost per frame without lockstep (real rAF pacing), from the page's own User Timing samples. Never fails. */
async function perf(options) {
  const results = [];
  await withBrowser(async (browser) => {
    for (const throttle of PERF.throttles) {
      const { cdp, problems, close } = await openPage(browser, { path: `${fileUrl(PAGES.gpu(options.theme ?? "dark"))}?gpuTime`, width: PERF.width, dpr: PERF.dpr, throttle });
      try {
        await waitFor(cdp, "window.__gpu && (__gpu.ready || !!__gpu.error)", 60000);
        await cdp.evaluate(`document.querySelector(".fx-stage").scrollIntoView({ block: "center" }), 1`);
        await new Promise((done) => setTimeout(done, PERF.warmupSeconds * 1000));
        const start = await cdp.evaluate("__gpu.frameStats().live.frames");
        await waitFor(cdp, `__gpu.frameStats().live.frames >= ${start + PERF.frames}`, 300000);
        const stats = await cdp.evaluate("__gpu.frameStats()");
        const ms = stats.live.ms;
        const f = (s) => (s?.median !== undefined ? `${s.median.toFixed(2)} / ${s.p95.toFixed(2)}` : "n/a");
        console.log(`perf ${PERF.width}px DPR ${PERF.dpr} CPU ×${throttle}: live-js ${f(ms.liveJs)} · parse ${f(ms.parse)} · upload ${f(ms.upload)} · encode ${f(ms.encode)} · GPU pass ${f(ms.gpu)} ms (median / p95)`);
        results.push({ throttle, adapter: await cdp.evaluate("__gpu.adapter"), ms, problems });
      } finally {
        await close();
      }
    }
  });
  mkdirSync(GATES_OUT, { recursive: true });
  writeFileSync(join(GATES_OUT, "perf.json"), JSON.stringify({ config: PERF, results }, null, 1));
}

/** Phase spans of the SVG page, sampled after each tick's writes → out/tmp/gates/timeline.json. */
async function timeline(options) {
  const total = Number(options.ticks ?? 2400);
  await withBrowser(async (browser) => {
    const hook = `window.__factoryHooks.push((factory) => { const rows = window.__timeline = []; factory.onFrame(() => queueMicrotask(() => { const s = factory.machines.centrifuge.status(); rows.push([__tickGate.ticks, s.phase, s.held, s.queued, +s.rpm.toFixed(1)]); })); });`;
    const { cdp, close } = await openRuntimePage(browser, { path: PAGES.svg(options.theme ?? "dark"), dpr: 1, preloads: [hook] });
    await advanceTo(cdp, total);
    const rows = await cdp.evaluate("__timeline");
    await close();
    const spans = [];
    for (const [tick, phase, held, queued, rpm] of rows) {
      const last = spans[spans.length - 1];
      if (last && last.phase === phase) Object.assign(last, { to: tick, held, rpm });
      else spans.push({ phase, from: tick, to: tick, held, queued, rpm });
    }
    mkdirSync(GATES_OUT, { recursive: true });
    writeFileSync(join(GATES_OUT, "timeline.json"), JSON.stringify({ spans, rows }));
    for (const s of spans) console.log(`${String(s.from).padStart(5)}–${String(s.to).padEnd(5)} ${s.phase.padEnd(16)} held ${s.held} rpm ${s.rpm}`);
  });
}

/**
 * Records real live markup from the SVG page for tools/test-live.mjs: the largest string each slot received over
 * `--ticks`, plus the intake slot while two injected packets fade in (group opacity) → tools/fixtures/live-markup.json.
 */
async function record(options) {
  // the strings the runtime writes (the SVG page's own innerHTML getter would return a re-serialization)
  const hook = `(() => {
    const native = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    const largest = window.__slotMarkup = {};
    const last = window.__lastMarkup = {};
    Object.defineProperty(Element.prototype, "innerHTML", { configurable: true, get() { return native.get.call(this); }, set(value) {
      const slot = this.getAttribute?.("data-slot");
      if (slot) {
        last[slot] = value;
        if ((largest[slot] ?? "").length <= value.length) largest[slot] = value;
      }
      native.set.call(this, value);
    } });
  })();`;
  const ticks = Number(options.ticks ?? 1800);
  const [fadeAt, secondFadeAt] = LIVE.fade.injectAt;
  const fadeTick = secondFadeAt + 4;
  await withBrowser(async (browser) => {
    const run = await openRuntimePage(browser, { path: PAGES.svg("dark"), dpr: 1, preloads: [hook] });
    await advanceTo(run.cdp, ticks);
    const largest = await run.cdp.evaluate("__slotMarkup");
    await run.close();
    const fade = await openRuntimePage(browser, { path: PAGES.svg("dark"), dpr: 1, preloads: [hook] });
    await advanceTo(fade.cdp, fadeAt);
    await fade.cdp.evaluate(INJECT_FADE);
    await advanceTo(fade.cdp, secondFadeAt);
    await fade.cdp.evaluate(INJECT_FADE);
    await advanceTo(fade.cdp, fadeTick);
    const intake = await fade.cdp.evaluate(`__lastMarkup["centrifuge:intake"]`);
    await fade.close();
    const file = join(ROOT, "tools/fixtures/live-markup.json");
    mkdirSync(join(ROOT, "tools/fixtures"), { recursive: true });
    const fixture = {
      recorded: `node tools/live-gate.mjs record --ticks ${ticks}: ${PAGES.svg("dark")}, largest string per slot over ${ticks} ticks; fadingIntake = the intake slot at tick ${fadeTick}, packets injected at ${fadeAt} and ${secondFadeAt}`,
      slots: largest,
      fadingIntake: intake,
    };
    writeFileSync(file, `${JSON.stringify(fixture, null, 1)}\n`);
    console.log(Object.entries(largest).map(([slot, m]) => `${slot} ${m.length} B`).join("\n"), `\nfading intake ${intake.length} B →`, file.replace(`${ROOT}/`, ""));
  });
}

/** Consecutive ticks of one page → contact sheet (inspection aid, not a gate). */
async function sheet(options) {
  const from = Number(options.from ?? 600);
  const count = Number(options.count ?? 60);
  const theme = options.theme ?? "dark";
  const kind = options.page ?? "gpu";
  const box = options.box ? String(options.box).split(",").map(Number) : null;
  const columns = Number(options.columns ?? 10);
  const ticks = Array.from({ length: count }, (_, i) => from + i);
  const dir = join(GATES_OUT, `sheet-${kind}-${theme}-${from}`);
  await withBrowser(async (browser) => {
    const run = await runPage(browser, { path: PAGES[kind](theme), ticks, dpr: Number(options.dpr ?? 2), dir, prefix: "f" });
    const frames = ticks.map((t) => readPng(run.shots[t].file)).map((image) => (box ? crop(image, ...box) : image));
    const [w, h] = [frames[0].width, frames[0].height];
    const out = new PNG({ width: columns * (w + 2), height: Math.ceil(frames.length / columns) * (h + 2) });
    out.data.fill(255);
    frames.forEach((image, i) => PNG.bitblt(image, out, 0, 0, w, h, (i % columns) * (w + 2), Math.floor(i / columns) * (h + 2)));
    const file = join(GATES_OUT, `sheet-${kind}-${theme}-t${from}-${count}.png`);
    writeFileSync(file, PNG.sync.write(out));
    console.log(file.replace(`${ROOT}/`, ""), run.problems.slice(0, 3));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(["quick"]);
  const commands = { static: staticGate, live: liveGate, motion: motionGate, determinism: determinismGate, calib: calibGate, perf, timeline, record, sheet };
  // command names before fix loop B
  Object.assign(commands, { compare: liveGate, baseline: staticGate, cost: perf });
  const command = commands[options._[0]];
  if (!command || (options.mutate && !MUTATIONS[options.mutate] && options.mutate !== "no-rebase")) {
    const usage = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n");
    console.log(usage.slice(0, usage.findIndex((line) => !line.startsWith("//"))).join("\n"));
    process.exit(2);
  }
  await command(options);
}
