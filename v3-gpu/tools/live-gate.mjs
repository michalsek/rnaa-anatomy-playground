// node tools/live-gate.mjs <command> [options]
// M3 gates for the live GPU pages (out/gpu/live*.html) against the v2 SVG pages (out/svg/centrifuge*.html), driven in
// lockstep: tools/lockstep.js fixes rAF time to 1/60 s steps, and a tick hook (FACTORY.onFrame) freezes the page
// after exactly N runtime ticks, so both pages show the same simulation state whatever their load times.
//
//   timeline [--ticks 1800]                          phase / held / readout per tick of the SVG page → out/gpu/live-gate/timeline.json
//   compare --ticks 60,300 [--themes dark,light] [--dpr 2] [--inject 400:js] [--reduced] [--crops name:x,y,w,h;…] [--zoom 4] [--tag t]
//                                                    shots of both pages at each tick, pixel diffs (pixelmatch thr 0.1 and Δ>8),
//                                                    side-by-side crops; report → out/gpu/live-gate/<tag>.json
//   sheet --from 600 --count 60 [--theme dark] [--box x,y,w,h] [--page gpu|svg]   consecutive ticks → contact sheet
//   record [--ticks 1800]                            largest markup per slot of the SVG page → out/gpu/live-gate/slot-markup.json
//   baseline [--themes dark,light] [--dpr 2]          M2 static frame (no slots) in the same box: the floor for compare
//   cost [--width 1280 --dpr 2 --throttle 4 --frames 600] [--page gpu|svg]   per-frame CPU breakdown from __gpu.frameStats()
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { Cdp, launchChrome } from "./perf-lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out/gpu/live-gate");
const STRICT_DELTA = 8; // tools/gate.mjs: a pixel differs when any channel moves by more than this (of 255)
const PAGES = {
  svg: (theme) => join(ROOT, "out/svg", `centrifuge${theme === "light" ? "-light" : ""}.html`),
  gpu: (theme) => join(ROOT, "out/gpu", `live${theme === "light" ? "-light" : ""}.html`),
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Counts runtime ticks through FACTORY.onFrame (called at the start of every tick) and freezes lockstep delivery after
// tick __tickGate.target. window.FACTORY is assigned by runtime.js before FACTORY.start(), so the setter trap hooks
// in before the first tick.
export const TICK_HOOK = `(() => {
  // runtime.js starts its rAF loop from its IntersectionObserver callback: restart virtual time there (see TURBO_LOCKSTEP)
  const NativeObserver = window.IntersectionObserver;
  let rebased = false;
  window.IntersectionObserver = class extends NativeObserver {
    constructor(callback, options) {
      super((entries, observer) => {
        if (!rebased) { rebased = true; __lockstep.rebase?.(); }
        callback(entries, observer);
      }, options);
    }
  };
  const gate = window.__tickGate = { ticks: 0, target: 1, frozenAt: -1 };
  let factory;
  Object.defineProperty(window, "FACTORY", {
    configurable: true,
    get: () => factory,
    set(value) {
      if (factory === value) return;
      factory = value;
      value.onFrame(() => {
        gate.ticks++;
        if (gate.ticks >= gate.target) { gate.frozenAt = __lockstep.frame; __lockstep.freezeAt(__lockstep.frame); }
      });
    },
  });
})();`;

export async function openPage(browser, { url, width = 1280, height = 1400, dpr = 2, reduced = false, throttle = 1, preloads = [] }) {
  const target = await (await fetch(`http://127.0.0.1:${browser.port}/json/new?about:blank`, { method: "PUT" })).json();
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  const problems = [];
  cdp.on("Runtime.consoleAPICalled", (p) => {
    if (p.type === "error" || p.type === "warning") problems.push(`console.${p.type}: ${p.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300)}`);
  });
  cdp.on("Runtime.exceptionThrown", (p) => problems.push(`exception: ${(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 300)}`));
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: width < 600 });
  if (reduced) await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  if (throttle !== 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: preloads.join("\n;\n") });
  const loaded = cdp.once("Page.loadEventFired", 120000);
  await cdp.send("Page.navigate", { url });
  await loaded;
  // closing the tab, not just the socket: a page left running (e.g. resumed lockstep) would starve the next one
  const close = async () => {
    cdp.close();
    await fetch(`http://127.0.0.1:${browser.port}/json/close/${target.id}`).catch(() => {});
  };
  return { cdp, problems, target, close };
}

// Same contract as tools/lockstep.js (virtual 1/60 s rAF time and performance.now, frame, freezeAt, resume), but frames
// are delivered one per macrotask (MessageChannel) instead of one per display refresh: fast-forwarding to tick 1,600
// takes seconds instead of minutes. Frames are only presented once the page is frozen, which is all a shot needs.
export const TURBO_LOCKSTEP = `(() => {
  const STEP = 1000 / 60;
  // Virtual time restarts at the runtime's first tick (rebase): rAF deltas (t0 + n·STEP) − (t0 + (n−1)·STEP) round
  // differently for different n, and the machine simulation amplifies those last-bit differences until two pages
  // that started their runtime at different frame numbers (the GPU page spends frames on its own rAF requests while
  // booting) disagree visibly after ~1,500 ticks.
  const t0 = 1000 * STEP;
  let base = 0;
  let frame = 0;
  let freezeAt = Infinity;
  let pending = [];
  let scheduled = false;
  const channel = new MessageChannel();
  const realRaf = window.requestAnimationFrame.bind(window);
  const virtual = () => t0 + (frame - base) * STEP;
  function tick() {
    scheduled = false;
    if (frame >= freezeAt || !pending.length) return;
    frame++;
    const callbacks = pending;
    pending = [];
    for (const callback of callbacks) {
      try { callback(virtual()); } catch (e) { setTimeout(() => { throw e; }); }
    }
    schedule();
  }
  function schedule() {
    if (scheduled || !pending.length || frame >= freezeAt) return;
    scheduled = true;
    channel.port2.postMessage(0);
  }
  channel.port1.onmessage = tick;
  window.requestAnimationFrame = (callback) => { pending.push(callback); schedule(); return pending.length; };
  window.cancelAnimationFrame = () => {};
  performance.now = () => virtual();
  window.__lockstep = {
    get frame() { return frame; },
    now: virtual,
    freezeAt(n) { freezeAt = n; },
    resume() { freezeAt = Infinity; schedule(); },
    rebase() { base = frame; },
    /** Resolves after k real display frames (presentation of what the page drew while frozen). */
    realFrames(k = 2) { return new Promise((done) => { const step = () => (k-- > 0 ? realRaf(step) : done()); step(); }); },
  };
})();`;
export const lockstepSource = () => (process.env.REAL_LOCKSTEP ? readFileSync(join(ROOT, "tools/lockstep.js"), "utf8") : TURBO_LOCKSTEP);

export async function waitFor(cdp, expression, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await cdp.evaluate(expression)) return true;
    await sleep(100);
  }
  throw new Error(`timeout: ${expression}`);
}

/** Freezes the page after `tick` runtime ticks; injections run while frozen at their tick (before the next tick). */
export async function advanceTo(cdp, tick) {
  await cdp.evaluate(`(() => { const g = __tickGate; g.target = ${tick}; if (g.ticks < ${tick}) __lockstep.resume(); })()`);
  await waitFor(cdp, `__tickGate.ticks >= ${tick} && __tickGate.frozenAt === __lockstep.frame`, 120000);
  const ticks = await cdp.evaluate("__tickGate.ticks");
  if (ticks !== tick) throw new Error(`overshot: at tick ${ticks}, wanted ${tick}`);
}

/** After a freeze: the GPU frame is encoded in a microtask after the tick; wait for its submission and presentation. */
export async function settle(cdp, kind) {
  if (kind === "gpu") {
    await waitFor(cdp, "window.__gpu && (window.__gpu.ready || !!window.__gpu.error)", 60000);
    await cdp.evaluate("(async () => { await (__lockstep.realFrames?.(3) ?? new Promise((r) => setTimeout(r, 50))); return __gpu.frames; })()");
  }
  await sleep(120);
}

export async function stageBox(cdp) {
  return cdp.evaluate(`(() => { const el = document.querySelector("canvas.iso-svg, svg.iso-svg"); const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; })()`);
}

export async function shot(cdp, file, box) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 1 }, captureBeyondViewport: true });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(data, "base64"));
  return file;
}

async function pageState(cdp) {
  return cdp.evaluate(`({ readout: document.querySelector("[data-readout]")?.textContent ?? null, status: document.querySelector("[data-status]")?.textContent ?? null, gpu: window.__gpu ? { error: __gpu.error, frames: __gpu.frames } : null })`);
}

/** Runs one page through `ticks` (sorted), taking a shot at each; `inject` = [{ tick, js }] evaluated while frozen. */
async function runPage(browser, { kind, theme, ticks, dpr, reduced, inject = [], dir, prefix, scale = 1, width }) {
  const url = pathToFileURL(PAGES[kind](theme)).href;
  const { cdp, problems, close } = await openPage(browser, { url, dpr: dpr * scale, reduced, width, preloads: [lockstepSource(), TICK_HOOK] });
  try {
    const box = await stageBox(cdp);
    const stops = [...new Set([...ticks, ...inject.map((i) => i.tick)])].sort((a, b) => a - b);
    const shots = {};
    for (const tick of stops) {
      await advanceTo(cdp, tick);
      for (const { js } of inject.filter((i) => i.tick === tick)) await cdp.evaluate(js);
      if (!ticks.includes(tick)) continue;
      await settle(cdp, kind);
      const file = await shot(cdp, join(dir, `${prefix}-${kind}-${theme}-t${tick}.png`), box);
      shots[tick] = { file, ...(await pageState(cdp)) };
    }
    const stats = kind === "gpu" ? await cdp.evaluate("window.__gpu && __gpu.frameStats()") : null;
    return { shots, problems, box, stats };
  } finally {
    await close();
  }
}

const readPng = (file) => PNG.sync.read(readFileSync(file));
function crop(img, x, y, w, h) {
  const out = new PNG({ width: w, height: h });
  for (let j = 0; j < h; j++) img.data.copy(out.data, j * w * 4, ((y + j) * img.width + x) * 4, ((y + j) * img.width + x + w) * 4);
  return out;
}
function zoom(img, k) {
  const out = new PNG({ width: img.width * k, height: img.height * k });
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) img.data.copy(out.data, (y * out.width + x) * 4, (Math.floor(y / k) * img.width + Math.floor(x / k)) * 4, (Math.floor(y / k) * img.width + Math.floor(x / k)) * 4 + 4);
  return out;
}
function strictCount(a, b) {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4)
    if (Math.abs(a.data[i] - b.data[i]) > STRICT_DELTA || Math.abs(a.data[i + 1] - b.data[i + 1]) > STRICT_DELTA || Math.abs(a.data[i + 2] - b.data[i + 2]) > STRICT_DELTA) n++;
  return n;
}

export function diffImages(aFile, bFile, diffFile) {
  let a = readPng(aFile);
  let b = readPng(bFile);
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  if (a.width !== w || a.height !== h) a = crop(a, 0, 0, w, h);
  if (b.width !== w || b.height !== h) b = crop(b, 0, 0, w, h);
  const diff = new PNG({ width: w, height: h });
  const loose = pixelmatch(a.data, b.data, diff.data, w, h, { threshold: 0.1 });
  const withAA = pixelmatch(a.data, b.data, null, w, h, { threshold: 0.1, includeAA: true });
  const strict = strictCount(a, b);
  if (diffFile) writeFileSync(diffFile, PNG.sync.write(diff));
  const total = w * h;
  const pct = (n) => +((100 * n) / total).toFixed(4);
  return { width: w, height: h, pixelmatch: loose, pixelmatchPct: pct(loose), withAA, withAAPct: pct(withAA), strict, strictPct: pct(strict) };
}

/** [svg | gpu | diff] side by side, nearest-neighbour ×k. */
export function cropSheet(aFile, bFile, box, k, outFile) {
  const a = readPng(aFile);
  const b = readPng(bFile);
  const [x, y, w, h] = box;
  const ca = crop(a, x, y, w, h);
  const cb = crop(b, x, y, w, h);
  const cd = new PNG({ width: w, height: h });
  const n = pixelmatch(ca.data, cb.data, cd.data, w, h, { threshold: 0.1 });
  const gap = 4;
  const sheet = new PNG({ width: w * 3 * k + gap * 2, height: h * k });
  sheet.data.fill(255);
  [ca, cb, cd].forEach((img, i) => PNG.bitblt(zoom(img, k), sheet, 0, 0, w * k, h * k, i * (w * k + gap), 0));
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, PNG.sync.write(sheet));
  return { file: outFile, pixelmatch: n, strict: strictCount(ca, cb), pct: +((100 * n) / (w * h)).toFixed(3) };
}

function args() {
  const argv = process.argv.slice(2);
  const o = { command: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const name = argv[i].slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    if (o[name] !== undefined) o[name] = [].concat(o[name], value);
    else o[name] = value;
  }
  return o;
}

async function timeline(o) {
  const browser = await launchChrome();
  try {
    const total = Number(o.ticks ?? 1800);
    const url = pathToFileURL(PAGES.svg(o.theme ?? "dark")).href;
    const hook = `(() => { const rows = window.__timeline = []; const t = setInterval(() => { if (!window.FACTORY?.machines?.centrifuge) return; clearInterval(t); FACTORY.onFrame(() => { const s = FACTORY.machines.centrifuge.status(); rows.push([__tickGate.ticks, s.phase, s.held, s.queued, +s.rpm.toFixed(1)]); }); }, 0); })();`;
    const { cdp } = await openPage(browser, { url, dpr: 1, preloads: [lockstepSource(), TICK_HOOK, hook] });
    await advanceTo(cdp, total);
    const rows = await cdp.evaluate("__timeline");
    const spans = [];
    for (const [tick, phase, held, queued, rpm] of rows) {
      const last = spans[spans.length - 1];
      if (last && last.phase === phase) Object.assign(last, { to: tick, held, rpm });
      else spans.push({ phase, from: tick, to: tick, held, queued, rpm });
    }
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "timeline.json"), JSON.stringify({ spans, rows }, null, 0));
    for (const s of spans) console.log(`${String(s.from).padStart(5)}–${String(s.to).padEnd(5)} ${s.phase.padEnd(16)} held ${s.held} rpm ${s.rpm}`);
    cdp.close();
  } finally {
    browser.close();
  }
}

async function compare(o) {
  const ticks = String(o.ticks).split(",").map(Number);
  const themes = String(o.themes ?? "dark,light").split(",");
  const dpr = Number(o.dpr ?? 2);
  const scale = Number(o.scale ?? 1);
  const tag = o.tag ?? `compare-dpr${dpr}${scale > 1 ? `-s${scale}` : ""}${o.reduced ? "-reduced" : ""}`;
  const dir = join(OUT, tag);
  const inject = [].concat(o.inject ?? []).filter((x) => x !== true).map((spec) => ({ tick: Number(spec.slice(0, spec.indexOf(":"))), js: spec.slice(spec.indexOf(":") + 1) }));
  const crops = String(o.crops ?? "").split(";").filter(Boolean).map((spec) => {
    const [name, box] = spec.split(":");
    return { name, box: box.split(",").map(Number) };
  });
  const browser = await launchChrome();
  const report = { tag, dpr, scale, ticks, themes, inject, reduced: !!o.reduced, results: [] };
  try {
    for (const theme of themes) {
      const runs = {};
      for (const kind of ["svg", "gpu"]) runs[kind] = await runPage(browser, { kind, theme, ticks, dpr, scale, reduced: !!o.reduced, inject, dir, prefix: tag, width: o.width ? Number(o.width) : undefined });
      for (const tick of ticks) {
        const a = runs.svg.shots[tick];
        const b = runs.gpu.shots[tick];
        const diff = diffImages(a.file, b.file, join(dir, `${tag}-diff-${theme}-t${tick}.png`));
        const sheets = crops.map(({ name, box }) => cropSheet(a.file, b.file, box.map((v) => v * scale), Number(o.zoom ?? 4), join(ROOT, "out/gpu/live-crops", `${tag}-${name}-${theme}-t${tick}.png`)));
        const row = { theme, tick, ...diff, readout: [a.readout, b.readout], status: [a.status, b.status], readoutMatch: a.readout === b.readout && a.status === b.status, crops: sheets };
        report.results.push(row);
        console.log(`${theme} t${tick}: pixelmatch ${diff.pixelmatchPct}% (incl. AA ${diff.withAAPct}%) · Δ>8 ${diff.strictPct}% · readout ${row.readoutMatch ? "=" : "≠"} "${b.readout}"`);
        for (const c of sheets) console.log(`   crop ${c.file.replace(ROOT + "/", "")}: ${c.pct}%`);
      }
      report[`problems-${theme}`] = { svg: runs.svg.problems, gpu: runs.gpu.problems };
      report[`stats-${theme}`] = runs.gpu.stats;
      if (runs.gpu.problems.length) console.log("gpu page problems:", runs.gpu.problems.slice(0, 5));
    }
  } finally {
    browser.close();
  }
  writeFileSync(join(OUT, `${tag}.json`), JSON.stringify(report, null, 1));
  return report;
}

async function sheet(o) {
  const from = Number(o.from ?? 600);
  const count = Number(o.count ?? 60);
  const theme = o.theme ?? "dark";
  const kind = o.page ?? "gpu";
  const box = o.box ? String(o.box).split(",").map(Number) : null;
  const dpr = Number(o.dpr ?? 2);
  const columns = Number(o.columns ?? 10);
  const ticks = Array.from({ length: count }, (_, i) => from + i);
  const dir = join(OUT, `sheet-${kind}-${theme}-${from}`);
  const browser = await launchChrome();
  try {
    const run = await runPage(browser, { kind, theme, ticks, dpr, dir, prefix: "f" });
    const frames = ticks.map((t) => readPng(run.shots[t].file)).map((img) => (box ? crop(img, ...box) : img));
    const [w, h] = [frames[0].width, frames[0].height];
    const rows = Math.ceil(frames.length / columns);
    const out = new PNG({ width: columns * (w + 2), height: rows * (h + 2) });
    out.data.fill(255);
    frames.forEach((img, i) => PNG.bitblt(img, out, 0, 0, w, h, (i % columns) * (w + 2), Math.floor(i / columns) * (h + 2)));
    const file = join(ROOT, "out/gpu/live-crops", `sheet-${kind}-${theme}-t${from}-${count}.png`);
    writeFileSync(file, PNG.sync.write(out));
    console.log(file.replace(ROOT + "/", ""), run.problems.slice(0, 3));
  } finally {
    browser.close();
  }
}

/** The largest markup each slot receives over `--ticks` (default 1,800) of the SVG page → slot-markup.json (tools/test-live.mjs). */
async function record(o) {
  const browser = await launchChrome();
  try {
    const hook = `(() => {
      const native = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
      const largest = window.__slotMarkup = {};
      Object.defineProperty(Element.prototype, "innerHTML", { configurable: true, get() { return native.get.call(this); }, set(value) {
        const slot = this.getAttribute?.("data-slot");
        if (slot && (largest[slot] ?? "").length <= value.length) largest[slot] = value;
        native.set.call(this, value);
      } });
    })();`;
    const { cdp, close } = await openPage(browser, { url: pathToFileURL(PAGES.svg("dark")).href, dpr: 1, preloads: [lockstepSource(), TICK_HOOK, hook] });
    await advanceTo(cdp, Number(o.ticks ?? 1800));
    const markup = await cdp.evaluate("__slotMarkup");
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "slot-markup.json"), JSON.stringify(markup));
    console.log(Object.entries(markup).map(([slot, m]) => `${slot} ${m.length} B`).join("\n"));
    await close();
  } finally {
    browser.close();
  }
}

/** M2 static frame in the same harness (same box, DPR): v2 page without script vs out/gpu/static — the floor for compare. */
async function baseline(o) {
  const dpr = Number(o.dpr ?? 2);
  const browser = await launchChrome();
  const rows = [];
  try {
    for (const theme of String(o.themes ?? "dark,light").split(",")) {
      const files = {};
      for (const [kind, page] of [["svg", join(ROOT, `out/gate/centrifuge-v2-${theme}.html`)], ["gpu", join(ROOT, "out/gpu", `static${theme === "light" ? "-light" : ""}.html`)]]) {
        const { cdp } = await openPage(browser, { url: pathToFileURL(page).href, dpr });
        if (kind === "gpu") await waitFor(cdp, "window.__gpu && __gpu.ready", 60000);
        await sleep(300);
        files[kind] = await shot(cdp, join(OUT, "baseline", `static-${kind}-${theme}.png`), await stageBox(cdp));
        cdp.close();
      }
      const diff = diffImages(files.svg, files.gpu, join(OUT, "baseline", `static-diff-${theme}.png`));
      rows.push({ theme, ...diff });
      console.log(`static ${theme}: pixelmatch ${diff.pixelmatchPct}% (incl. AA ${diff.withAAPct}%) · Δ>8 ${diff.strictPct}%`);
    }
  } finally {
    browser.close();
  }
  writeFileSync(join(OUT, `baseline-dpr${dpr}.json`), JSON.stringify(rows, null, 1));
}

/** CPU cost per frame without lockstep (real rAF pacing), from the page's own User Timing samples. */
async function cost(o) {
  const width = Number(o.width ?? 1280);
  const dpr = Number(o.dpr ?? 2);
  const throttle = Number(o.throttle ?? 4);
  const frames = Number(o.frames ?? 600);
  const browser = await launchChrome();
  try {
    const url = pathToFileURL(PAGES.gpu(o.theme ?? "dark")).href;
    const { cdp, problems } = await openPage(browser, { url, width, height: width < 600 ? 844 : 1400, dpr, throttle });
    await waitFor(cdp, "window.__gpu && __gpu.ready", 60000);
    await cdp.evaluate(`document.querySelector(".fx-stage").scrollIntoView({ block: "center" })`);
    // --fades: a packet fading in at the intake every 400 ms (accept without `from`), so ~45 % of frames carry a group layer
    if (o.fades) await cdp.evaluate(`setInterval(() => FACTORY.machines.centrifuge.accept("in", FACTORY.item("data")), 400), 1`);
    // warm-up: past the first fill so the rotor spins inside the window
    await sleep(Number(o.warmup ?? 4) * 1000);
    const startFrames = await cdp.evaluate("__gpu.frameStats().live.frames");
    await waitFor(cdp, `__gpu.frameStats().live.frames >= ${startFrames + frames}`, 600000);
    const stats = await cdp.evaluate("__gpu.frameStats()");
    const result = { width, dpr, throttle, frames, adapter: await cdp.evaluate("__gpu.adapter"), stats, problems };
    mkdirSync(OUT, { recursive: true });
    const file = join(OUT, `cost-${width}x${dpr}-t${throttle}${o.fades ? "-fades" : ""}.json`);
    writeFileSync(file, JSON.stringify(result, null, 1));
    const ms = stats.live.ms;
    const f = (s) => `${s.median.toFixed(3)} / ${s.p95.toFixed(3)}`;
    console.log(`${width}px DPR${dpr} ×${throttle}${o.fades ? " fades" : ""}: live-js ${f(ms.liveJs)} · parse ${f(ms.parse)} · upload ${f(ms.upload)} · encode ${f(ms.encode)} (with groups ${f(ms.encodeWithGroups)}, n=${ms.encodeWithGroups.n}) · gpu pass ${f(ms.gpu)} ms (median / p95, n=${ms.encode.n})`);
    cdp.close();
    return result;
  } finally {
    browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = args();
  const commands = { timeline, compare, sheet, cost, baseline, record };
  if (!commands[o.command]) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 12).join("\n"));
    process.exit(1);
  }
  await commands[o.command](o);
}
