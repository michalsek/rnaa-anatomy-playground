// Shared pieces of the perf harness: Chrome launch (the anatomy skill's chromePort, read-only import), a tiny CDP
// client, the in-page recorder, statistics and the trace summary.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SKILL_SCRIPTS = process.env.ANATOMY_SCRIPTS ?? join(homedir(), ".claude/skills/anatomy/scripts");
const { chromePort } = await import(pathToFileURL(join(SKILL_SCRIPTS, "chrome-port.mjs")).href);

// Machine idle % over ~1 s (macOS top; null elsewhere). The perf machine is shared, so every run records it.
export function cpuIdle() {
  try {
    const text = execFileSync("top", ["-l", "2", "-n", "0", "-s", "1"], { encoding: "utf8" });
    const all = [...text.matchAll(/([\d.]+)% idle/g)];
    return all.length ? Number(all[all.length - 1][1]) : null;
  } catch {
    return null;
  }
}

export function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const playwright = join(homedir(), "Library/Caches/ms-playwright");
  if (existsSync(playwright)) {
    for (const dir of readdirSync(playwright).sort().reverse()) {
      candidates.push(join(playwright, dir, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"));
    }
  }
  return candidates.find((path) => existsSync(path));
}

// Fresh profile per run. Same base flags as drive.mjs / capture.mjs, plus the anti-backgrounding flags a headed perf
// run needs (an occluded or unfocused window must keep producing frames).
export async function launchChrome({ headed = false, windowSize = [1300, 1000], flags = [] } = {}) {
  const binary = chromePath();
  if (!binary) throw new Error("No Chrome found. Set CHROME_PATH.");
  const profile = mkdtempSync(join(tmpdir(), "v3-perf-"));
  const args = [
    ...(headed ? [`--window-size=${windowSize[0]},${windowSize[1]}`, "--window-position=40,40"] : ["--headless=new", "--hide-scrollbars"]),
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--allow-file-access-from-files",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-extensions",
    ...flags,
    "about:blank",
  ];
  const chrome = spawn(binary, args);
  const port = await chromePort(chrome, profile);
  const close = () => {
    chrome.kill("SIGKILL");
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {}
  };
  return { binary, args, chrome, port, close };
}

export class Cdp {
  static async connect(url) {
    const cdp = new Cdp(new WebSocket(url));
    await new Promise((done, fail) => {
      cdp.socket.onopen = done;
      cdp.socket.onerror = fail;
    });
    return cdp;
  }
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.onmessage = (message) => {
      const data = JSON.parse(message.data);
      if (data.id && this.pending.has(data.id)) {
        const { done, fail, method } = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) fail(new Error(`${method}: ${data.error.message}`));
        else done(data.result);
      } else if (data.method) {
        for (const fn of this.listeners.get(data.method) ?? []) fn(data.params);
      }
    };
  }
  send(method, params = {}) {
    return new Promise((done, fail) => {
      const call = ++this.id;
      this.pending.set(call, { done, fail, method });
      this.socket.send(JSON.stringify({ id: call, method, params }));
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
    return () => this.listeners.set(method, this.listeners.get(method).filter((f) => f !== fn));
  }
  once(method, timeout = 30000) {
    return new Promise((done, fail) => {
      const timer = setTimeout(() => {
        off();
        fail(new Error(`timeout waiting for ${method}`));
      }, timeout);
      const off = this.on(method, (params) => {
        clearTimeout(timer);
        off();
        done(params);
      });
    });
  }
  async evaluate(expression) {
    const reply = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
    return reply.result?.value;
  }
  close() {
    this.socket.close();
  }
}

// The in-page recorder, installed before any page script (Page.addScriptToEvaluateOnNewDocument, every frame).
// - own: rAF timestamps from our own loop on the UNWRAPPED rAF (frame cadence, independent of the page loop)
// - frames: per rAF timestamp, the summed duration and count of the page's rAF callbacks (wrapped: two
//   performance.now() calls and one closure per callback; the page loop itself is untouched)
// - loaf: long-animation-frame entries
// Recording is on only between __perf.start() and __perf.stop(), so load and warmup are excluded.
export const RECORDER = String.raw`(() => {
  if (window.__perf) return;
  const raf = window.requestAnimationFrame.bind(window);
  const now = performance.now.bind(performance);
  const P = (window.__perf = { on: false, own: [], ft: [], fms: [], fn: [], loaf: [], t0: 0, t1: 0 });
  function loop(ts) { if (P.on) P.own.push(ts); raf(loop); }
  raf(loop);
  window.requestAnimationFrame = function requestAnimationFrame(callback) {
    return raf((ts) => {
      const s = now();
      try { return callback(ts); }
      finally {
        if (P.on) {
          const d = now() - s;
          const i = P.ft.length - 1;
          if (i >= 0 && P.ft[i] === ts) { P.fms[i] += d; P.fn[i]++; }
          else { P.ft.push(ts); P.fms.push(d); P.fn.push(1); }
        }
      }
    });
  };
  try {
    new PerformanceObserver((list) => {
      if (!P.on) return;
      for (const e of list.getEntries()) {
        let scriptMs = 0;
        for (const s of e.scripts ?? []) scriptMs += s.duration;
        P.loaf.push({ start: e.startTime, duration: e.duration, blocking: e.blockingDuration, renderStart: e.renderStart, styleAndLayoutStart: e.styleAndLayoutStart, scriptMs });
      }
    }).observe({ type: "long-animation-frame", buffered: false });
  } catch {}
  P.start = () => { P.own = []; P.ft = []; P.fms = []; P.fn = []; P.loaf = []; P.t0 = now(); P.on = true; };
  P.stop = () => { P.on = false; P.t1 = now(); return { own: P.own, ft: P.ft, fms: P.fms, fn: P.fn, loaf: P.loaf, t0: P.t0, t1: P.t1 }; };
})();`;

// Expression evaluated in the top frame: start/stop the recorder in every same-origin frame and merge the data.
export const ALL_FRAMES = `(() => { const out = [window]; const walk = (w) => { for (let i = 0; i < w.frames.length; i++) { try { const f = w.frames[i]; if (f.__perf) { out.push(f); walk(f); } } catch {} } }; walk(window); return out; })()`;

export function stats(values) {
  const a = [...values].filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return { n: 0 };
  const q = (p) => a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
  const sum = a.reduce((s, v) => s + v, 0);
  return { n: a.length, mean: sum / a.length, min: a[0], p50: q(0.5), p95: q(0.95), p99: q(0.99), max: a[a.length - 1] };
}

export const round = (v, digits = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** digits) / 10 ** digits : v);
export function roundAll(obj, digits = 3) {
  if (Array.isArray(obj)) return obj.map((v) => roundAll(v, digits));
  if (obj && typeof obj === "object") return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, roundAll(v, digits)]));
  return typeof obj === "number" ? round(obj, digits) : obj;
}

// Snap the shortest common interval to a display rate (rAF timestamps are vsync-aligned).
export function vsyncOf(intervals) {
  const s = stats(intervals);
  if (!s.n) return 1000 / 60;
  const rates = [240, 144, 120, 90, 60, 50, 30];
  const ref = s.p50;
  return 1000 / rates.reduce((best, r) => (Math.abs(1000 / r - ref) < Math.abs(1000 / best - ref) ? r : best), 60);
}

export function frameSummary(own, vsync) {
  const iv = [];
  for (let i = 1; i < own.length; i++) iv.push(own[i] - own[i - 1]);
  let dropped = 0;
  for (const v of iv) dropped += Math.max(0, Math.round(v / vsync) - 1);
  const span = own.length > 1 ? own[own.length - 1] - own[0] : 0;
  return { frames: own.length, intervals: stats(iv), droppedFrames: dropped, droppedPct: iv.length ? (100 * dropped) / (dropped + iv.length) : 0, fps: span ? (1000 * iv.length) / span : 0, longIntervals50: iv.filter((v) => v > 50).length };
}

export function loafSummary(loaf, seconds) {
  const sum = (fn) => loaf.reduce((s, e) => s + fn(e), 0);
  const pre = (e) => Math.max(0, (e.renderStart || e.start + e.duration) - e.start);
  const rafPart = (e) => (e.renderStart ? Math.max(0, (e.styleAndLayoutStart || e.start + e.duration) - e.renderStart) : 0);
  const slp = (e) => (e.styleAndLayoutStart ? Math.max(0, e.start + e.duration - e.styleAndLayoutStart) : 0);
  return {
    count: loaf.length,
    perSecond: loaf.length / seconds,
    duration: stats(loaf.map((e) => e.duration)),
    blockingMsPerSecond: sum((e) => e.blocking) / seconds,
    split: loaf.length ? { preRenderMs: sum(pre) / loaf.length, rafMs: sum(rafPart) / loaf.length, styleLayoutPaintMs: sum(slp) / loaf.length, scriptAttributedMs: sum((e) => e.scriptMs) / loaf.length } : null,
  };
}

// ---------------------------------------------------------------- trace
// Main-thread self time is attributed to the nearest enclosing event of a known kind (so a forced layout inside a
// rAF callback counts as layout, the callback's own time as script).
const MAIN_KIND = new Map([
  ["FireAnimationFrame", "script"], ["FunctionCall", "script"], ["EvaluateScript", "script"], ["TimerFire", "script"], ["EventDispatch", "script"],
  ["v8.compile", "script"], ["v8.compileModule", "script"], ["v8.evaluateModule", "script"], ["RunMicrotasks", "script"], ["V8.Execute", "script"],
  ["MinorGC", "gc"], ["MajorGC", "gc"], ["V8.GC_SCAVENGER", "gc"], ["V8.GC_MARK_COMPACTOR", "gc"], ["BlinkGC.AtomicPhase", "gc"], ["V8.GCScavenger", "gc"], ["V8.GCCompactor", "gc"], ["V8.GCFinalizeMC", "gc"], ["V8.GCIncrementalMarking", "gc"],
  ["ParseHTML", "parse"],
  ["UpdateLayoutTree", "style"], ["RecalculateStyles", "style"],
  ["Layout", "layout"],
  ["PrePaint", "prepaint"],
  ["Paint", "paint"], ["PaintImage", "paint"],
  ["Layerize", "layerize"], ["UpdateLayer", "layerize"],
  ["Commit", "commit"],
]);
const kindOf = (name) => MAIN_KIND.get(name) ?? (name.startsWith("V8.GC") ? "gc" : null);

function threadCost(events, withKinds) {
  events.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const stack = [];
  const self = new Map();
  const kinds = {};
  let busy = 0;
  const closeTo = (ts) => {
    while (stack.length && stack[stack.length - 1].end <= ts) {
      const e = stack.pop();
      const s = Math.max(0, e.dur - e.child);
      self.set(e.name, (self.get(e.name) ?? 0) + s);
      if (withKinds) kinds[e.kind ?? "other"] = (kinds[e.kind ?? "other"] ?? 0) + s;
    }
  };
  for (const ev of events) {
    closeTo(ev.ts);
    const parent = stack[stack.length - 1];
    const e = { name: ev.name, ts: ev.ts, dur: ev.dur, end: ev.ts + ev.dur, child: 0, kind: kindOf(ev.name) ?? parent?.kind ?? null };
    if (parent) parent.child += Math.min(e.end, parent.end) - e.ts;
    else busy += e.dur;
    stack.push(e);
  }
  closeTo(Infinity);
  return { busy, self, kinds };
}

// summed duration of the outermost events matching pred (nested matches are inside an already counted one)
function outermost(lists, pred) {
  let total = 0;
  for (const list of lists) {
    let end = -Infinity;
    for (const e of [...list].filter((x) => pred(x.name)).sort((a, b) => a.ts - b.ts || b.dur - a.dur)) {
      if (e.ts < end) continue;
      total += e.dur;
      end = e.ts + e.dur;
    }
  }
  return total;
}

// events: raw trace events. frames: frames produced during the trace window (for per-frame normalisation).
export function summarizeTrace(events, frames) {
  const procName = new Map();
  const threadName = new Map();
  for (const e of events) {
    if (e.ph !== "M") continue;
    if (e.name === "process_name") procName.set(e.pid, e.args?.name);
    if (e.name === "thread_name") threadName.set(`${e.pid}:${e.tid}`, e.args?.name);
  }
  // complete events per thread (X, and B/E pairs)
  const byThread = new Map();
  const open = new Map();
  const push = (key, ev) => {
    if (!byThread.has(key)) byThread.set(key, []);
    byThread.get(key).push(ev);
  };
  let t0 = Infinity;
  let t1 = -Infinity;
  for (const e of events) {
    const key = `${e.pid}:${e.tid}`;
    if (e.ph === "X" && e.dur != null) {
      push(key, { name: e.name, ts: e.ts, dur: e.dur });
      t0 = Math.min(t0, e.ts);
      t1 = Math.max(t1, e.ts + e.dur);
    } else if (e.ph === "B") {
      if (!open.has(key)) open.set(key, []);
      open.get(key).push(e);
    } else if (e.ph === "E") {
      const b = open.get(key)?.pop();
      if (b) push(key, { name: b.name, ts: b.ts, dur: e.ts - b.ts });
    }
  }
  // the measured renderer: the CrRendererMain with the most FireAnimationFrame events
  let renderer = null;
  let best = -1;
  for (const [key, list] of byThread) {
    if (threadName.get(key) !== "CrRendererMain") continue;
    const n = list.filter((e) => e.name === "FireAnimationFrame").length;
    if (n > best) {
      best = n;
      renderer = key.split(":")[0];
    }
  }
  const gpuPid = [...procName].find(([, name]) => name === "GPU Process")?.[0];
  const groups = { main: [], compositor: [], raster: [], gpuMain: [], viz: [], gpuOther: [] };
  for (const [key, list] of byThread) {
    const [pid] = key.split(":");
    const name = threadName.get(key) ?? "";
    if (pid === renderer) {
      if (name === "CrRendererMain") groups.main.push(list);
      else if (name === "Compositor") groups.compositor.push(list);
      else if (/^(CompositorTileWorker|ThreadPoolForegroundWorker)/.test(name)) groups.raster.push(list);
    } else if (String(pid) === String(gpuPid)) {
      if (name === "CrGpuMain") groups.gpuMain.push(list);
      else if (name === "VizCompositorThread") groups.viz.push(list);
      else if (list.length) groups.gpuOther.push(list);
    }
  }
  const per = (us) => us / 1000 / Math.max(1, frames);
  const out = { frames, windowMs: (t1 - t0) / 1000, threads: {} };
  for (const [group, lists] of Object.entries(groups)) {
    let busy = 0;
    const self = new Map();
    const kinds = {};
    for (const list of lists) {
      const cost = threadCost(list, group === "main");
      busy += cost.busy;
      for (const [k, v] of cost.self) self.set(k, (self.get(k) ?? 0) + v);
      for (const [k, v] of Object.entries(cost.kinds)) kinds[k] = (kinds[k] ?? 0) + v;
    }
    out.threads[group] = {
      threads: lists.length,
      busyMsPerFrame: per(busy),
      top: [...self].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, us]) => ({ name, msPerFrame: per(us) })),
      ...(group === "main" ? { kindsMsPerFrame: Object.fromEntries(Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, per(v)])) } : {}),
    };
  }
  const k = out.threads.main.kindsMsPerFrame ?? {};
  out.perFrame = {
    scriptMs: (k.script ?? 0) + (k.parse ?? 0) + (k.gc ?? 0),
    styleMs: k.style ?? 0,
    layoutMs: k.layout ?? 0,
    paintMainMs: (k.prepaint ?? 0) + (k.paint ?? 0) + (k.layerize ?? 0) + (k.commit ?? 0),
    // cc raster tasks (paint-op playback + serialisation to the GPU process, on the renderer's worker pool)
    rasterMs: per(outermost(groups.raster, (n) => n === "RasterTask")),
    // GPU process: raster replay (RasterDecoderImpl*) + compositing / presentation, CrGpuMain + VizCompositorThread
    gpuRasterMs: per(outermost(groups.gpuMain, (n) => n.startsWith("RasterDecoderImpl::Do"))),
    gpuMs: out.threads.gpuMain.busyMsPerFrame + out.threads.viz.busyMsPerFrame,
    compositorMs: out.threads.compositor.busyMsPerFrame,
    mainBusyMs: out.threads.main.busyMsPerFrame,
  };
  // cc's frame reporter: presented / dropped as the compositor sees them
  const reporter = events.filter((e) => e.name === "PipelineReporter" && (e.ph === "b" || e.ph === "X") && String(e.pid) === String(renderer));
  if (reporter.length) {
    const states = {};
    for (const e of reporter) {
      const s = e.args?.frame_reporter?.state ?? e.args?.chrome_frame_reporter?.state ?? "unknown";
      states[s] = (states[s] ?? 0) + 1;
    }
    out.pipelineReporter = states;
  }
  return out;
}
