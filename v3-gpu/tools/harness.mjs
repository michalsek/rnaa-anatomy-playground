// Chrome / CDP harness shared by the page gates (tools/live-gate.mjs, tools/live-edge.mjs): open a page with
// preloads, drive the v2 runtime tick by tick under tools/lockstep.js, take shots of the figure.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Cdp, launchChrome } from "./perf-lib.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const GATES_OUT = join(ROOT, "out/tmp/gates");
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
/** A page path: absolute, or relative to ROOT. */
export const fileUrl = (path) => pathToFileURL(isAbsolute(path) ? path : join(ROOT, path)).href;

const themed = (stem, theme) => `${stem}${theme === "light" ? "-light" : ""}.html`;
/** Pages under test, relative to ROOT. */
export const PAGES = {
  svg: (theme) => themed("out/svg/centrifuge", theme),
  gpu: (theme) => themed("out/gpu/live", theme),
  gpuDev: () => "out/gpu/live-dev.html",
  gpuStatic: (theme) => themed("out/gpu/static", theme),
};

const LOCKSTEP_SOURCE = readFileSync(join(ROOT, "tools/lockstep.js"), "utf8");
/** tools/lockstep.js with its options, as a preload source. */
export const lockstepPreload = (options = {}) => `window.__LOCKSTEP_OPTIONS = ${JSON.stringify(options)};\n${LOCKSTEP_SOURCE}`;
/** What every runtime-driven gate uses: turbo frames, time restarted at the runtime's start, GPU ready first. */
export const GATE_LOCKSTEP = { mode: "turbo", rebase: "first-intersection", waitReady: true };

/**
 * Counts v2 runtime ticks through FACTORY.onFrame (called at the start of every tick) and freezes lockstep delivery
 * after tick __tickGate.target. The page script assigns window.FACTORY before FACTORY.start(), so the setter trap
 * hooks in before the first tick. Later preloads add (factory) => … to window.__factoryHooks to see it first too.
 */
export const TICK_GATE = `(() => {
  const gate = window.__tickGate = { ticks: 0, target: 1, frozenAt: -1 };
  const hooks = window.__factoryHooks = [];
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
      for (const hook of hooks) hook(value);
    },
  });
})();`;

/** In-page expression: the runtime state the gates compare between pages (after the current tick's writes). */
export const RUNTIME_STATE = `({
  ticks: __tickGate.ticks,
  readout: document.querySelector("[data-readout]")?.textContent ?? null,
  status: document.querySelector("[data-status]")?.textContent ?? null,
  centrifuge: JSON.stringify(FACTORY.machines.centrifuge.status()),
  slots: (() => {
    // SVG page slots hold parsed DOM, GPU page skeleton slots return the written string: compare both serialized
    const scratch = document.createElementNS("http://www.w3.org/2000/svg", "g");
    return Object.entries(FACTORY.slots).map(([name, el]) => { scratch.innerHTML = el.innerHTML; return name + "=" + scratch.innerHTML; }).join("\\n");
  })(),
})`;

export async function withBrowser(run) {
  const browser = await launchChrome();
  try {
    return await run(browser);
  } finally {
    browser.close();
  }
}

/**
 * Opens `path` (relative to ROOT, or a full URL) in a new tab. Console errors / warnings and uncaught exceptions are
 * collected in `problems`. `close()` closes the tab, not just the socket: a page left running (e.g. a resumed
 * lockstep) starves the next one.
 */
export async function openPage(browser, { path, width = 1280, height = 1400, dpr = 2, reduced = false, throttle = 1, preloads = [], waitLoad = true }) {
  const target = await (await fetch(`http://127.0.0.1:${browser.port}/json/new?about:blank`, { method: "PUT" })).json();
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  const problems = [];
  const warnings = [];
  cdp.on("Runtime.consoleAPICalled", (p) => {
    if (p.type !== "error" && p.type !== "warning") return;
    const text = `console.${p.type}: ${p.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300)}`;
    (p.type === "error" ? problems : warnings).push(text);
  });
  cdp.on("Runtime.exceptionThrown", (p) => problems.push(`exception: ${(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 300)}`));
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Page.bringToFront"); // background tabs get no real animation frames
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: width < 600 });
  if (reduced) await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  if (throttle !== 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  if (preloads.length) await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: preloads.join("\n;\n") });
  const loaded = cdp.once("Page.loadEventFired", 120000);
  await cdp.send("Page.navigate", { url: path.includes("://") ? path : fileUrl(path) });
  if (waitLoad) await loaded;
  const close = async () => {
    cdp.close();
    await fetch(`http://127.0.0.1:${browser.port}/json/close/${target.id}`).catch(() => {});
  };
  return { cdp, problems, warnings, close };
}

/** Opens a runtime page under the gate lockstep with the tick gate (frozen after its first tick). */
export const openRuntimePage = (browser, options) => openPage(browser, { ...options, preloads: [lockstepPreload(options.lockstep ?? GATE_LOCKSTEP), TICK_GATE, ...(options.preloads ?? [])] });

export async function waitFor(cdp, expression, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await cdp.evaluate(expression)) return true;
    await sleep(50);
  }
  throw new Error(`timeout after ${timeout} ms: ${expression}`);
}

/** Freezes the page right after runtime tick `tick`; evaluations at that point see the tick's writes. */
export async function advanceTo(cdp, tick, timeout = 120000) {
  await cdp.evaluate(`(() => { const g = __tickGate; g.target = ${tick}; if (g.ticks < ${tick}) __lockstep.resume(); })()`);
  await waitFor(cdp, `__tickGate.ticks >= ${tick} && __tickGate.frozenAt === __lockstep.frame`, timeout);
  const ticks = await cdp.evaluate("__tickGate.ticks");
  if (ticks !== tick) throw new Error(`overshot: at tick ${ticks}, wanted ${tick}`);
}

/**
 * After a freeze: a GPU page encodes its frame in a microtask after the tick; wait until it is ready (or failed) and
 * let the compositor present a few real frames.
 */
export async function settle(cdp) {
  await waitFor(cdp, "!window.__gpu || window.__gpu.ready || !!window.__gpu.error", 60000);
  await cdp.evaluate("__lockstep.realFrames(3)");
}

export function stageBox(cdp) {
  return cdp.evaluate(`(() => { const el = document.querySelector("canvas.iso-svg, svg.iso-svg"); const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; })()`);
}

export async function shot(cdp, file, box) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 1 }, captureBeyondViewport: true });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(data, "base64"));
  return file;
}

/**
 * `--name value`, positionals, and the boolean flags listed in `booleans` (never take a value, so
 * `--json a.png b.png` keeps both paths). A repeated option collects into an array.
 */
export function parseArgs(booleans = [], argv = process.argv.slice(2)) {
  const options = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) {
      options._.push(argv[i]);
      continue;
    }
    const name = argv[i].slice(2);
    if (!booleans.includes(name) && (argv[i + 1] === undefined || argv[i + 1].startsWith("--"))) throw new Error(`--${name} needs a value`);
    const value = booleans.includes(name) ? true : argv[++i];
    options[name] = options[name] === undefined ? value : [].concat(options[name], value);
  }
  return options;
}

/** One gate check: prints PASS / FAIL and remembers failures for the exit code. */
export function createChecks(name) {
  const failures = [];
  const results = [];
  return {
    failures,
    results,
    check(ok, label, detail = "") {
      console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` · ${detail}` : ""}`);
      results.push({ ok, label, detail });
      if (!ok) failures.push(label);
      return ok;
    },
    finish(report = {}) {
      mkdirSync(GATES_OUT, { recursive: true });
      writeFileSync(join(GATES_OUT, `${name}.json`), JSON.stringify({ name, failures, results, ...report }, null, 1));
      console.log(failures.length ? `${name} FAILED (${failures.length}): ${failures.join(" | ")}` : `${name} passed`);
      process.exitCode = failures.length ? 1 : 0;
    },
  };
}
