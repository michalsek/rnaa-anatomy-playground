#!/usr/bin/env node
// Frame-cost harness for factory pages (SVG or GPU). One fresh Chrome per run; see usage().
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ALL_FRAMES, Cdp, RECORDER, cpuIdle, frameSummary, launchChrome, loafSummary, roundAll, stats, summarizeTrace, vsyncOf } from "./perf-lib.mjs";

function usage() {
  console.log(`Measure per-frame cost of an animated page in Chrome over CDP.

  node tools/perf.mjs <page.html | url> [options]

  --width px          viewport width (default 1280)                --height px   (default 900, or 844 below 600 px)
  --dpr n             device pixel ratio (default 2)               --throttle n  CPU slowdown, renderer main thread (default 1)
  --seconds s         measurement window (default 8)               --warmup s    after load, before measuring (default 2)
  --trace-seconds s   trailing trace window (default 3)            --no-trace    skip it
  --label name        label in the JSON and summary                --out file    JSON output (default out/perf/<label>.json)
  --preload file.js   run before page scripts, in every frame (repeatable)
  --eval js           run in the page after load, before warmup (e.g. open the factory)
  --select css        element scrolled to the viewport centre (default .fx-stage; "none" to skip)
  --headed            real window instead of --headless=new
  --chrome-flag f     extra Chrome flag (repeatable)
  --shot file.png     screenshot of the viewport at the end
  --raw               keep the raw frame series in the JSON

Measured window: rAF intervals (own loop on the unwrapped rAF), page rAF callback time per frame (wrapped callbacks),
long animation frames, CDP Performance.getMetrics deltas. Trace window (after it, so tracing overhead never touches
the main numbers): renderer main-thread self time by kind, compositor, raster workers and GPU-process busy time.`);
}

function parse(argv) {
  const o = { width: 1280, height: null, dpr: 2, throttle: 1, seconds: 8, warmup: 2, traceSeconds: 3, trace: true, label: null, out: null, preload: [], evals: [], select: ".fx-stage", headed: false, flags: [], shot: null, raw: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--width") o.width = Number(next());
    else if (a === "--height") o.height = Number(next());
    else if (a === "--dpr") o.dpr = Number(next());
    else if (a === "--throttle") o.throttle = Number(next());
    else if (a === "--seconds") o.seconds = Number(next());
    else if (a === "--warmup") o.warmup = Number(next());
    else if (a === "--trace-seconds") o.traceSeconds = Number(next());
    else if (a === "--no-trace") o.trace = false;
    else if (a === "--label") o.label = next();
    else if (a === "--out") o.out = next();
    else if (a === "--preload") o.preload.push(next());
    else if (a === "--eval") o.evals.push(next());
    else if (a === "--select") o.select = next();
    else if (a === "--headed") o.headed = true;
    else if (a === "--chrome-flag") o.flags.push(next());
    else if (a === "--shot") o.shot = next();
    else if (a === "--raw") o.raw = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else rest.push(a);
  }
  o.target = rest[0];
  o.height ??= o.width < 600 ? 844 : 900;
  o.label ??= `${(o.target ?? "page").split("/").pop().replace(/\.html$/, "")}-${o.width}x${o.dpr}-t${o.throttle}`;
  o.out ??= `out/perf/${o.label}.json`;
  return o;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const T0 = Date.now();
const step = (what) => process.env.PERF_DEBUG && console.error(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${what}`);

async function main() {
  const o = parse(process.argv.slice(2));
  if (o.help || !o.target) {
    usage();
    process.exit(o.help ? 0 : 1);
  }
  const isUrl = /^https?:|^file:/.test(o.target);
  const url = isUrl ? o.target : pathToFileURL(resolve(o.target)).href;
  const sha1 = isUrl ? null : createHash("sha1").update(readFileSync(o.target)).digest("hex").slice(0, 12);
  const preloads = o.preload.map((file) => readFileSync(file, "utf8"));
  const load0 = loadavg();
  const idle0 = cpuIdle();

  const browser = await launchChrome({ headed: o.headed, windowSize: [o.width + 20, o.height + 120], flags: o.flags });
  const problems = [];
  let cdp;
  try {
    const version = await (await fetch(`http://127.0.0.1:${browser.port}/json/version`)).json();
    step('const root = await Cdp.connect');
    const root = await Cdp.connect(version.webSocketDebuggerUrl);
    let gpu = null;
    try {
      if (process.env.NO_SYSINFO) throw new Error("skipped");
      const info = await root.send("SystemInfo.getInfo");
      const dev = info.gpu.devices?.[0] ?? {};
      gpu = { featureStatus: info.gpu.featureStatus, device: `${dev.vendorString ?? ""} ${dev.deviceString ?? ""}`.trim(), driver: dev.driverVersion };
    } catch (error) {
      gpu = { error: String(error.message) };
    }
    step('root.close();');
    root.close();

    const target = await (await fetch(`http://127.0.0.1:${browser.port}/json/new?about:blank`, { method: "PUT" })).json();
    cdp = await Cdp.connect(target.webSocketDebuggerUrl);
    cdp.on("Runtime.consoleAPICalled", (p) => {
      if (p.type === "error" || p.type === "warning") problems.push(`console.${p.type}: ${p.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300)}`);
    });
    cdp.on("Runtime.exceptionThrown", (p) => problems.push(`exception: ${(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 300)}`));
    step('await cdp.send("Runtime.enable");');
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
    if (o.headed) await cdp.send("Page.bringToFront");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: o.width, height: o.height, deviceScaleFactor: o.dpr, mobile: o.width < 600 });

    // vsync: rAF cadence on about:blank, before any page or throttling
    await cdp.evaluate(RECORDER);
    await cdp.evaluate("__perf.start()");
    await sleep(1000);
    const blank = await cdp.evaluate("__perf.stop().own");
    const blankIv = blank.slice(1).map((t, i) => t - blank[i]);
    step('const vsync = vsyncOf');
    const vsync = vsyncOf(blankIv);

    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: [RECORDER, ...preloads].join("\n;\n") });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: o.throttle });
    const loaded = cdp.once("Page.loadEventFired", 120000);
    const nav = await cdp.send("Page.navigate", { url });
    if (nav.errorText) throw new Error(`navigation failed: ${nav.errorText}`);
    step('await loaded;');
    await loaded;
    if (o.select !== "none") await cdp.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(o.select)}); if (el) el.scrollIntoView({ block: "center", inline: "center" }); return !!el; })()`);
    for (const js of o.evals) await cdp.evaluate(js);
    await sleep(o.warmup * 1000);

    step('// ---------------- measurement window');
    // ---------------- measurement window
    const metric = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
    const benchStats = () => cdp.evaluate(`(() => { const all = ${ALL_FRAMES}.map((w) => w.__benchStats).filter(Boolean); if (!all.length) return null; const sum = {}; for (const s of all) for (const [k, v] of Object.entries(s)) sum[k] = (sum[k] ?? 0) + v; return sum; })()`);
    const b0 = await benchStats();
    const m0 = await metric();
    await cdp.evaluate(`${ALL_FRAMES}.forEach((w) => w.__perf.start())`);
    await sleep(o.seconds * 1000);
    const rec = await cdp.evaluate(`${ALL_FRAMES}.map((w) => w.__perf.stop())`);
    const m1 = await metric();
    const b1 = await benchStats();

    const own = rec[0].own;
    const frames = frameSummary(own, vsync);
    const perTs = new Map();
    for (const r of rec)
      r.ft.forEach((ts, i) => {
        const cur = perTs.get(ts) ?? { ms: 0, n: 0 };
        cur.ms += r.fms[i];
        cur.n += r.fn[i];
        perTs.set(ts, cur);
      });
    const pageFrames = [...perTs.values()];
    const cbTotal = pageFrames.reduce((s, f) => s + f.ms, 0);
    const seconds = (rec[0].t1 - rec[0].t0) / 1000;
    const nFrames = Math.max(1, frames.frames);
    const d = (name) => (m1[name] ?? 0) - (m0[name] ?? 0);
    const metrics = {
      deltas: { ScriptDuration: d("ScriptDuration"), LayoutDuration: d("LayoutDuration"), RecalcStyleDuration: d("RecalcStyleDuration"), TaskDuration: d("TaskDuration"), LayoutCount: d("LayoutCount"), RecalcStyleCount: d("RecalcStyleCount") },
      perFrame: {
        scriptMs: (1000 * d("ScriptDuration")) / nFrames,
        layoutMs: (1000 * d("LayoutDuration")) / nFrames,
        styleMs: (1000 * d("RecalcStyleDuration")) / nFrames,
        taskMs: (1000 * d("TaskDuration")) / nFrames,
        layouts: d("LayoutCount") / nFrames,
        styleRecalcs: d("RecalcStyleCount") / nFrames,
      },
      end: { Nodes: m1.Nodes, JSHeapUsedMB: m1.JSHeapUsedSize / 2 ** 20, JSHeapTotalMB: m1.JSHeapTotalSize / 2 ** 20, Documents: m1.Documents, Frames: m1.Frames },
    };
    const result = {
      meta: {
        label: o.label, page: o.target, url, sha1, date: new Date().toISOString(),
        viewport: { width: o.width, height: o.height, dpr: o.dpr, mobile: o.width < 600 }, throttle: o.throttle, seconds: o.seconds, warmup: o.warmup,
        mode: o.headed ? "headed" : "headless=new", chrome: version.Browser, gpu, preload: o.preload, eval: o.evals, flags: o.flags,
        vsyncMs: vsync, blankIntervals: stats(blankIv), loadavg: { before: load0 }, cpuIdle: { before: idle0 },
      },
      frames: { ...frames, measuredSeconds: seconds, pageFrames: pageFrames.length, pageFrameRatio: pageFrames.length / nFrames },
      script: {
        callbackMsPerFrame: cbTotal / nFrames,
        callbackMs: stats(pageFrames.map((f) => f.ms)),
        callbacksPerFrame: pageFrames.reduce((s, f) => s + f.n, 0) / Math.max(1, pageFrames.length),
      },
      loaf: loafSummary(rec.flatMap((r) => r.loaf), seconds),
      metrics,
    };

    step('// ---------------- trace window');
    // ---------------- trace window
    if (o.trace) {
      await cdp.evaluate(`${ALL_FRAMES}.forEach((w) => w.__perf.start())`);
      // ReportEvents: IO.read on a ReturnAsStream handle hangs on a page target in Chrome 154
      const events = [];
      const offData = cdp.on("Tracing.dataCollected", (p) => events.push(...p.value));
      await cdp.send("Tracing.start", {
        transferMode: "ReportEvents",
        traceConfig: {
          recordMode: "recordAsMuchAsPossible",
          includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "toplevel", "v8.execute", "cc", "gpu", "viz", "benchmark"],
        },
      });
      await sleep(o.traceSeconds * 1000);
      const complete = cdp.once("Tracing.tracingComplete", 120000);
      await cdp.send("Tracing.end");
      const traceRec = await cdp.evaluate(`${ALL_FRAMES}[0].__perf.stop()`);
      await complete;
      offData();
      if (process.env.PERF_TRACE_OUT) writeFileSync(process.env.PERF_TRACE_OUT, JSON.stringify(events));
      result.trace = { seconds: o.traceSeconds, events: events.length, ...summarizeTrace(events, Math.max(1, traceRec.own.length)) };
    }

    step('// ---------------- page facts');
    // ---------------- page facts
    try {
      await cdp.send("LayerTree.enable");
      const layers = await cdp.once("LayerTree.layerTreeDidChange", 3000).catch(() => null);
      await cdp.send("LayerTree.disable");
      if (layers?.layers) result.layers = { count: layers.layers.length, drawsContent: layers.layers.filter((l) => l.drawsContent).length };
    } catch {}
    result.dom = await cdp.evaluate(`(() => { let elements = 0, slots = 0; for (const w of ${ALL_FRAMES}) { elements += w.document.getElementsByTagName("*").length; slots += w.document.querySelectorAll("[data-slot]").length; } return { elements, slots, scrollY, stageInView: (() => { const el = document.querySelector(${JSON.stringify(o.select === "none" ? "body" : o.select)}); if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height, width: r.width, innerHeight }; })() }; })()`);
    // preload counters (window.__benchStats), measurement window only, plus per frame
    if (b1) result.pageStats = Object.fromEntries(Object.entries(b1).map(([k, v]) => [k, { window: v - (b0?.[k] ?? 0), perFrame: (v - (b0?.[k] ?? 0)) / nFrames }]));
    if (o.shot) {
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
      mkdirSync(dirname(resolve(o.shot)), { recursive: true });
      writeFileSync(o.shot, Buffer.from(shot.data, "base64"));
    }
    result.meta.loadavg.after = loadavg();
    result.meta.cpuIdle.after = cpuIdle();
    result.problems = problems.slice(0, 20);
    if (o.raw) result.raw = { own, pageFrames: [...perTs].map(([ts, f]) => [ts, f.ms, f.n]), loaf: rec.flatMap((r) => r.loaf) };

    mkdirSync(dirname(resolve(o.out)), { recursive: true });
    writeFileSync(o.out, JSON.stringify(roundAll(result), null, 1));
    console.log(summaryLine(result));
    if (result.frames.pageFrameRatio < 0.95) console.log(`  warning: page rAF ran in only ${(100 * result.frames.pageFrameRatio).toFixed(0)}% of frames (IO gate / stage off screen?)`);
    if (problems.length) console.log(`  ${problems.length} console problems, first: ${problems[0]}`);
    cdp.close();
    browser.close();
    process.exit(0);
  } catch (error) {
    console.error(error);
    cdp?.close();
    browser.close();
    process.exit(1);
  }
}

export function summaryLine(r) {
  const f = (v, n = 1) => (Number.isFinite(v) ? v.toFixed(n) : "–");
  const t = r.trace?.perFrame;
  return [
    `${r.meta.label}:`,
    `frame p50 ${f(r.frames.intervals.p50)} p95 ${f(r.frames.intervals.p95)} p99 ${f(r.frames.intervals.p99)} ms, dropped ${f(r.frames.droppedPct)}%`,
    `| rAF cb ${f(r.script.callbackMsPerFrame, 2)} · script ${f(r.metrics.perFrame.scriptMs, 2)} · style ${f(r.metrics.perFrame.styleMs, 2)} · layout ${f(r.metrics.perFrame.layoutMs, 2)} · task ${f(r.metrics.perFrame.taskMs, 2)} ms/f`,
    t ? `| trace main ${f(t.mainBusyMs, 2)} (paint ${f(t.paintMainMs, 2)}) raster ${f(t.rasterMs, 2)} gpu ${f(t.gpuMs, 2)} (raster ${f(t.gpuRasterMs, 2)}) ms/f` : "",
    `| LoAF ${r.loaf.count} | nodes ${r.metrics.end.Nodes} | page-frames ${f(100 * r.frames.pageFrameRatio, 0)}%`,
  ].filter(Boolean).join(" ");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
