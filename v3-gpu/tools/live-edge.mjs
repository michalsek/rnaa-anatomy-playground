// node tools/live-edge.mjs [--quick] [--only case,case] — edge-case gate for the live GPU page (exit 1 on any failed
// check; thresholds in tools/gates.config.mjs EDGE / LIVE; report → out/tmp/gates/edge.json, shots →
// out/tmp/gates/edge/). Every reference shot is taken in the same run.
//   theme-switch     body[data-theme] flipped mid-animation == a fresh light page at the same tick (and the SVG page)
//   resize-storm     viewport / DPR changes mid-animation, ending at 520 px == a fresh page loaded at 520 px
//   hidden           stage scrolled out of view: the runtime stops and no GPU frames are drawn; back in view: resumes
//   loss-after-ready two device losses mid-animation, then the frame == a fresh page at the same tick
//   loss-before-ready device lost right after the first frame, before ready: the page still gets ready and draws
//   loss-no-adapter  device lost after ready and no adapter on re-init: the SVG fallback takes over and animates
//   loss-during-init the first device lost while its pipelines compile (0 / 2 ms after creation; reason "unknown" and an
//                    external destroy()): a new device, ready, == a fresh page (QA-FIXA D1)
//   external-destroy the device destroyed by someone else after ready: re-initialised, == a fresh page (QA-FIXA D5)
//   submit-failure   queue.submit throws on the theme-switch frame: no stale cache, the frame after == a fresh light
//                    page (QA-FIXA D2)
//   submit-failure-native  reduced motion: the frame whose rotor changed fails at submit, so its compute expansion
//                    never ran; nothing changes for a while, then one frame is drawn: == a fresh page (the native
//                    painter re-expands after Renderer.invalidate: SlotPainter.invalidate, fix C2 / C1-1)
//   zero-size        stage display:none (0 × 0 canvas box) plus a screenshot while hidden: no WebGPU errors, clean
//                    console; shown again == a fresh page (QA-FIXA D3)
//   dispose          __gpu.dispose(): every GPU buffer / texture / query set the page created was destroyed before
//                    its device, the SVG figure shows and animates == the SVG page (CQ-M2 S9)
//   stroke-crossing  polylines whose non-adjacent segments cross / touch at 90° turns, stroke-opacity .6, injected
//                    into a slot: no double blend at the crossings vs the SVG page (QA-FIXA D4)
//   no-webgpu        navigator.gpu missing: SVG fallback animates, bound to the visible figure, clean console
//   null-adapter     requestAdapter() → null: same expectations as no-webgpu
//   unsupported      markup the GPU path cannot draw: dev throws at the write and sets __gpu.error; prod warns once and
//                    keeps drawing
//   draw-count       one GPU frame per runtime tick in real display frames, also with slot writes from another rAF
//                    callback and from timers (CQ-M3 S3)
//   user-timing      User Timing entries stay bounded on the GPU page and on the fallback page
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EDGE, LIVE } from "./gates.config.mjs";
import { compareImages, readPng } from "./diff.mjs";
import { GATES_OUT, PAGES, ROOT, advanceTo, createChecks, openRuntimePage, parseArgs, settle, shot, stageBox, waitFor, withBrowser } from "./harness.mjs";

const DIR = join(GATES_OUT, "edge");
const LIMIT = LIVE.limits[LIVE.dpr];
const NO_WEBGPU = readFileSync(join(ROOT, "tools/no-webgpu.preload.js"), "utf8");
// as a real adapter request: resolves later, after the page's module script has run
const NULL_ADAPTER = `if (navigator.gpu) GPU.prototype.requestAdapter = () => new Promise((resolve) => setTimeout(() => resolve(null), 50));`;
// requestAdapter → null once window.__denyAdapter is set (a re-init after device loss fails)
const DENY_ADAPTER_LATER = `if (navigator.gpu) { const request = GPU.prototype.requestAdapter; GPU.prototype.requestAdapter = function (...args) { return window.__denyAdapter ? Promise.resolve(null) : request.apply(this, args); }; }`;
// simulateDeviceLoss() right after the first GPU frame (__gpu.frames 0 → 1), i.e. before __gpu.ready
const LOSE_AFTER_FIRST_FRAME = `(() => {
  let api;
  Object.defineProperty(window, "__gpu", { configurable: true, get: () => api, set(value) {
    api = value;
    let frames = value.frames;
    Object.defineProperty(value, "frames", { configurable: true, enumerable: true, get: () => frames, set(next) {
      frames = next;
      if (next === 1 && !window.__lostBeforeReady) { window.__lostBeforeReady = { ready: value.ready }; queueMicrotask(() => value.simulateDeviceLoss()); }
    } });
  } });
})();`;
/**
 * The first device is lost `delayMs` after it was created, while the renderer compiles: through an external
 * `destroy()` (reason "destroyed") or as a driver loss (reason "unknown": `lost` resolves, the device is destroyed).
 */
const LOSE_DURING_INIT = (reason, delayMs) => `(() => {
  if (!navigator.gpu) return;
  const request = GPUAdapter.prototype.requestDevice;
  let first = true;
  GPUAdapter.prototype.requestDevice = async function (...args) {
    const device = await request.apply(this, args);
    if (!first) return device;
    first = false;
    let resolveLost = null;
    if (${JSON.stringify(reason)} === "unknown") {
      const lost = new Promise((resolve) => (resolveLost = resolve));
      Object.defineProperty(device, "lost", { configurable: true, get: () => lost });
    }
    setTimeout(() => {
      window.__lostDuringInit = { reason: ${JSON.stringify(reason)}, ready: !!window.__gpu?.ready, frames: window.__gpu?.frames ?? 0 };
      device.destroy();
      resolveLost?.({ reason: "unknown", message: "test: lost during init" });
    }, ${delayMs});
    return device;
  };
})();`;
/** Every device the page requests, in order (window.__devices). */
const KEEP_DEVICES = `(() => {
  if (!navigator.gpu) return;
  const request = GPUAdapter.prototype.requestDevice;
  window.__devices = [];
  GPUAdapter.prototype.requestDevice = async function (...args) {
    const device = await request.apply(this, args);
    window.__devices.push(device);
    return device;
  };
})();`;
/** queue.submit throws while window.__failSubmits > 0 (counted down). */
const FAILING_SUBMIT = `(() => {
  if (!navigator.gpu) return;
  const submit = GPUQueue.prototype.submit;
  window.__failSubmits = 0;
  GPUQueue.prototype.submit = function (...args) {
    if (window.__failSubmits > 0) {
      window.__failSubmits--;
      throw new Error("test: submit failed");
    }
    return submit.apply(this, args);
  };
})();`;
/**
 * Live GPU buffers / textures / query sets per device: created, not yet destroyed. When a device is destroyed the
 * objects still alive on it are recorded (window.__gpuLeaks: their labels), then forgotten.
 */
const TRACK_GPU_OBJECTS = `(() => {
  if (!navigator.gpu) return;
  const live = new Map();
  window.__gpuLeaks = [];
  window.__liveGpuObjects = () => [...live.values()].reduce((n, set) => n + set.size, 0);
  for (const method of ["createBuffer", "createTexture", "createQuerySet"]) {
    const create = GPUDevice.prototype[method];
    GPUDevice.prototype[method] = function (...args) {
      const object = create.apply(this, args);
      const set = live.get(this) ?? live.set(this, new Set()).get(this);
      set.add(object);
      const destroy = object.destroy;
      object.destroy = function () { set.delete(object); return destroy.call(this); };
      return object;
    };
  }
  const destroyDevice = GPUDevice.prototype.destroy;
  GPUDevice.prototype.destroy = function () {
    const set = live.get(this);
    if (set?.size) window.__gpuLeaks.push(...[...set].map(describe));
    live.delete(this);
    return destroyDevice.call(this);
  };
  const describe = (object) => (object.label || "<unlabelled>") + " (" + object.constructor.name + ")";
})();`;
/** Shapes whose non-adjacent segments cross (k = 3) or touch (spiral, 0.3 units short), drawn into the lamp slot. */
const CROSSING_SLOT = "centrifuge:lamp";
const CROSSING_SHAPES = [
  { d: "M40 40 h30 v4 h-4 v-3.7", at: [66, 40.15] },
  { d: "M40 60 h30 v4 h-4 v-6", at: [66, 60] },
  { d: "M90 70 h20 v-8 h-8 v16", at: [102, 70] },
  { d: "M40 80 l30 0 l0.35 4 l-4 0.35 l-0.35 -3.7", at: [66.2, 80.3] },
  { d: "M90 40 h30 v6 h-6 v-5.8", at: [114, 40.1] },
];
const CROSSING_MARKUP = CROSSING_SHAPES.map(({ d }) => `<path class="iso-line" d="${d}" style="stroke-width:1.3px" stroke-opacity=".6"/>`).join("");
/** Every write to the slot is replaced by the crossing shapes (on the SVG and the GPU page alike). */
const INJECT_CROSSINGS = `(() => {
  document.addEventListener("DOMContentLoaded", () => {
    const el = document.querySelector('[data-slot="${CROSSING_SLOT}"]');
    const own = Object.getOwnPropertyDescriptor(el, "innerHTML") ?? Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(el, "innerHTML", { configurable: true, get() { return own.get.call(el); }, set() { own.set.call(el, ${JSON.stringify(CROSSING_MARKUP)}); } });
    el.innerHTML = "";
  }, { capture: true });
})();`;
/** Darkest luminance (0..255) within `radius` device px of (x, y). */
function darkestNear(image, x, y, radius) {
  let darkest = 255;
  for (let py = Math.max(0, Math.round(y) - radius); py <= Math.min(image.height - 1, Math.round(y) + radius); py++)
    for (let px = Math.max(0, Math.round(x) - radius); px <= Math.min(image.width - 1, Math.round(x) + radius); px++) {
      const o = (py * image.width + px) * 4;
      darkest = Math.min(darkest, 0.2126 * image.data[o] + 0.7152 * image.data[o + 1] + 0.0722 * image.data[o + 2]);
    }
  return darkest;
}

/** The renderer is back after the n-th re-init: reinits counted and the frame stats carry renderer fields again. */
const rendererBack = (n) => `(() => { const s = __gpu.frameStats(); return s.reinits === ${n} && "lastEncodeMs" in s; })()`;
const UNSUPPORTED = `<g class="iso-dots"><text>x</text></g>`;
const FIGURE_STATE = `(() => {
  const figure = document.querySelector(".fx-stage svg.iso-svg");
  const scratch = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const serialized = (markup) => { scratch.innerHTML = markup; return scratch.innerHTML; };
  const rotor = (root) => root?.querySelector('[data-slot="centrifuge:rotorFront"]')?.innerHTML ?? null;
  return {
    gpuAttr: document.documentElement.dataset.gpu ?? null,
    error: window.__gpu?.error ?? null,
    canvas: !!document.querySelector("canvas[data-gpu]"),
    figureVisible: !!figure && getComputedStyle(figure).display !== "none" && figure.getAttribute("aria-hidden") !== "true",
    figureLabel: figure?.getAttribute("aria-label") ?? null,
    figureRotor: figure ? serialized(rotor(figure)) : null,
    runtimeRotor: serialized(FACTORY.slots["centrifuge:rotorFront"].innerHTML),
    runtimeBoundToFigure: FACTORY.svg === figure,
    readout: document.querySelector("[data-readout]").textContent,
  };
})()`;
const sizeOf = `(() => { const c = document.querySelector("canvas[data-gpu]"); const r = c.getBoundingClientRect(); return { backing: [c.width, c.height], box: [r.width, r.height], dpr: devicePixelRatio }; })()`;

/** Opens a runtime page, runs `steps(page)` and closes it; the shot helper names files after the case. */
async function withPage(browser, options, steps) {
  const page = await openRuntimePage(browser, { dpr: LIVE.dpr, ...options });
  page.shot = async (name) => {
    await settle(page.cdp);
    return shot(page.cdp, join(DIR, `${name}.png`), await stageBox(page.cdp));
  };
  try {
    return await steps(page);
  } finally {
    await page.close();
  }
}

/** Shot of a fresh page of `kind` at `tick` (reference). */
const referenceShot = (browser, { kind, theme, tick, width, name }) =>
  withPage(browser, { path: PAGES[kind](theme), width }, async (page) => {
    await advanceTo(page.cdp, tick);
    return page.shot(name);
  });

const consoleText = (page) => [...page.problems, ...page.warnings].slice(0, 3).join(" | ");

const CASES = {
  async "theme-switch"(browser, { check }) {
    const switched = await withPage(browser, { path: PAGES.gpu("dark") }, async (page) => {
      await advanceTo(page.cdp, 690);
      await page.cdp.evaluate(`document.body.dataset.theme = "light"`);
      await advanceTo(page.cdp, 700);
      check(!page.problems.length && !page.warnings.length, "theme-switch: console clean", consoleText(page));
      return page.shot("theme-switch-gpu-t700");
    });
    const freshGpu = await referenceShot(browser, { kind: "gpu", theme: "light", tick: 700, name: "theme-switch-fresh-gpu-light-t700" });
    const freshSvg = await referenceShot(browser, { kind: "svg", theme: "light", tick: 700, name: "theme-switch-fresh-svg-light-t700" });
    const same = compareImages(switched, freshGpu);
    check(same.loosePct <= EDGE.identicalLoosePct, "theme-switch: switched dark page == fresh light GPU page", `${same.loose} px differ`);
    const svg = compareImages(freshSvg, switched);
    check(svg.loosePct <= LIMIT.loosePct && svg.solidCluster <= LIMIT.solidCluster, "theme-switch: switched page vs light SVG page within live limits", `loose ${svg.loosePct}%`);
  },

  async "resize-storm"(browser, { check }) {
    const storm = [[1600, 1], [360, 3], [900, 1.5], [1280, 2.625], [391, 3], [1024, 1], [520, 2]];
    const stormed = await withPage(browser, { path: PAGES.gpu("dark") }, async (page) => {
      let tick = 600;
      await advanceTo(page.cdp, tick);
      for (const [width, dpr] of storm) {
        await page.cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 1400, deviceScaleFactor: dpr, mobile: false });
        await advanceTo(page.cdp, (tick += 4));
      }
      await advanceTo(page.cdp, 660);
      const size = await page.cdp.evaluate(sizeOf);
      check(!page.problems.length && !page.warnings.length, "resize-storm: console clean", consoleText(page));
      return { file: await page.shot("resize-storm-gpu-t660"), size };
    });
    const fresh = await withPage(browser, { path: PAGES.gpu("dark"), width: 520 }, async (page) => {
      await advanceTo(page.cdp, 660);
      return { file: await page.shot("resize-fresh-gpu-t660"), size: await page.cdp.evaluate(sizeOf) };
    });
    const svg = await referenceShot(browser, { kind: "svg", theme: "dark", tick: 660, width: 520, name: "resize-fresh-svg-t660" });
    check(JSON.stringify(stormed.size.backing) === JSON.stringify(fresh.size.backing), "resize-storm: canvas backing == a fresh load's", `${stormed.size.backing} vs ${fresh.size.backing} (box ${stormed.size.box.map((v) => v.toFixed(2))} CSS px, DPR ${stormed.size.dpr})`);
    const same = compareImages(stormed.file, fresh.file);
    check(same.loosePct <= EDGE.identicalLoosePct, "resize-storm: frame == a fresh page at 520 px", `${same.loose} px differ`);
    const vsSvg = compareImages(svg, stormed.file);
    const narrow = EDGE.narrowLimits;
    check(vsSvg.loosePct <= narrow.loosePct && vsSvg.withAAPct <= narrow.withAAPct && vsSvg.solidCluster <= narrow.solidCluster, `resize-storm: frame vs SVG page at 520 px (≤ ${narrow.loosePct}% loose, ≤ ${narrow.withAAPct}% incl. AA, solid blob ≤ ${narrow.solidCluster} px)`, `loose ${vsSvg.loosePct}% · incl. AA ${vsSvg.withAAPct}% · solid ${vsSvg.solidCluster}`);
  },

  async hidden(browser, { check }) {
    await withPage(browser, { path: PAGES.gpu("dark") }, async (page) => {
      const { cdp } = page;
      await advanceTo(cdp, 300);
      await settle(cdp);
      const sample = () => cdp.evaluate(`({ ticks: __tickGate.ticks, frames: __gpu.frames })`);
      await cdp.evaluate(`__tickGate.target = Infinity; document.body.style.paddingTop = "6000px"; window.scrollTo(0, 0); __lockstep.resume(); __lockstep.realFrames(5)`);
      const hidden = await sample();
      await cdp.evaluate(`__lockstep.step(${EDGE.hiddenFrames})`);
      const stillHidden = await sample();
      check(hidden.ticks === stillHidden.ticks && hidden.frames === stillHidden.frames, `hidden: no runtime ticks and no GPU frames over ${EDGE.hiddenFrames} delivered frames`, `${JSON.stringify(hidden)} → ${JSON.stringify(stillHidden)}`);
      await cdp.evaluate(`document.querySelector(".fx-stage").scrollIntoView({ block: "center" }); __lockstep.resume(); 1`);
      const resumed = await waitFor(cdp, `__tickGate.ticks > ${stillHidden.ticks + 10} && __gpu.frames > ${stillHidden.frames + 10}`, 10000).catch(() => false);
      check(resumed, "hidden: back in view, the runtime ticks and GPU frames resume", JSON.stringify(await sample()));
      check(!page.problems.length && !page.warnings.length, "hidden: console clean", consoleText(page));
    });
  },

  async "loss-after-ready"(browser, { check }) {
    const lost = await withPage(browser, { path: PAGES.gpu("dark") }, async (page) => {
      const { cdp } = page;
      for (const [n, tick] of [[1, 690], [2, 693]]) {
        await advanceTo(cdp, tick);
        await cdp.evaluate("__gpu.simulateDeviceLoss()");
        const back = await waitFor(cdp, rendererBack(n), 15000).catch(() => false);
        check(back, `loss-after-ready: renderer back after loss ${n} (tick ${tick})`, JSON.stringify(await cdp.evaluate("__gpu.frameStats().reinits")));
      }
      await advanceTo(cdp, 700);
      check(!page.problems.length && !page.warnings.length, "loss-after-ready: console clean", consoleText(page));
      return page.shot("loss-after-ready-gpu-t700");
    });
    const fresh = await referenceShot(browser, { kind: "gpu", theme: "dark", tick: 700, name: "loss-fresh-gpu-t700" });
    const same = compareImages(lost, fresh);
    check(same.loosePct <= EDGE.identicalLoosePct, "loss-after-ready: frame == a fresh page at the same tick", `${same.loose} px differ`);
  },

  async "loss-before-ready"(browser, { check }) {
    const file = await withPage(browser, { path: PAGES.gpu("dark"), waitLoad: false, preloads: [LOSE_AFTER_FIRST_FRAME] }, async (page) => {
      const { cdp } = page;
      const ready = await waitFor(cdp, "window.__gpu && (__gpu.ready || !!__gpu.error)", 20000).catch(() => false);
      const state = await cdp.evaluate(`({ lost: window.__lostBeforeReady ?? null, ready: window.__gpu?.ready, error: window.__gpu?.error ?? null, frames: window.__gpu?.frames, reinits: window.__gpu?.frameStats?.().reinits })`);
      check(state.lost && state.lost.ready === false, "loss-before-ready: the device was lost before ready", JSON.stringify(state));
      check(ready && state.ready && !state.error, "loss-before-ready: the page still becomes ready (no error)", JSON.stringify(state));
      if (!ready || !state.ready) return null;
      await advanceTo(cdp, 120);
      check(!page.problems.length && !page.warnings.length, "loss-before-ready: console clean", consoleText(page));
      return page.shot("loss-before-ready-gpu-t120");
    });
    if (!file) return;
    const fresh = await referenceShot(browser, { kind: "gpu", theme: "dark", tick: 120, name: "loss-before-ready-fresh-t120" });
    const same = compareImages(file, fresh);
    check(same.loosePct <= EDGE.identicalLoosePct, "loss-before-ready: frame == a fresh page at the same tick", `${same.loose} px differ`);
  },

  async "loss-no-adapter"(browser, { check }) {
    const file = await withPage(browser, { path: PAGES.gpu("dark"), preloads: [DENY_ADAPTER_LATER] }, async (page) => {
      const { cdp } = page;
      await advanceTo(cdp, 300);
      await cdp.evaluate("window.__denyAdapter = true; __gpu.simulateDeviceLoss()");
      const fellBack = await waitFor(cdp, "document.documentElement.dataset.gpu === 'fallback'", 15000).catch(() => false);
      check(fellBack, "loss-no-adapter: data-gpu=fallback after the failed re-init", JSON.stringify(await cdp.evaluate("({ error: __gpu.error, attr: document.documentElement.dataset.gpu })")));
      await advanceTo(cdp, 360);
      const state = await cdp.evaluate(FIGURE_STATE);
      check(state.figureVisible && !state.canvas, "loss-no-adapter: the SVG figure replaced the canvas", JSON.stringify({ figureVisible: state.figureVisible, canvas: state.canvas }));
      check(state.figureRotor === state.runtimeRotor, "loss-no-adapter: the fallback figure animates (its rotor slot == the runtime's markup at tick 360)", state.figureRotor === null ? "no rotor slot in the figure" : `${state.figureRotor?.length} vs ${state.runtimeRotor.length} chars`);
      return page.shot("loss-no-adapter-t360");
    });
    const svg = await referenceShot(browser, { kind: "svg", theme: "dark", tick: 360, name: "loss-no-adapter-svg-t360" });
    const same = compareImages(svg, file);
    check(same.loosePct <= EDGE.fallbackLoosePct, "loss-no-adapter: fallback frame == SVG page at the same tick", `loose ${same.loosePct}% (${same.loose} px)`);
  },

  "no-webgpu": (browser, context) => fallbackCase(browser, context, { name: "no-webgpu", preload: NO_WEBGPU, errorPrefix: "no-webgpu" }),
  "null-adapter": (browser, context) => fallbackCase(browser, context, { name: "null-adapter", preload: NULL_ADAPTER, errorPrefix: "no-adapter" }),

  async unsupported(browser, { check }) {
    await withPage(browser, { path: PAGES.gpuDev() }, async (page) => {
      await advanceTo(page.cdp, 120);
      await settle(page.cdp);
      const write = await page.cdp.evaluate(`(() => { try { FACTORY.slots["centrifuge:lamp"].innerHTML = '${UNSUPPORTED}'; return "no throw"; } catch (e) { return "threw: " + e.message; } })()`);
      const error = await page.cdp.evaluate("__gpu.error");
      check(write.startsWith("threw"), "unsupported (dev): the runtime's write throws", write);
      check(Boolean(error), "unsupported (dev): __gpu.error records why", String(error));
    });
    await withPage(browser, { path: PAGES.gpu("dark") }, async (page) => {
      const { cdp } = page;
      await advanceTo(cdp, 120);
      await settle(cdp);
      const before = await cdp.evaluate("__gpu.frames");
      const write = await cdp.evaluate(`(() => { try { FACTORY.slots["centrifuge:lamp"].innerHTML = '${UNSUPPORTED}'; return "no throw"; } catch (e) { return "threw: " + e.message; } })()`);
      await advanceTo(cdp, 130);
      await settle(cdp);
      const after = await cdp.evaluate(`({ frames: __gpu.frames, error: __gpu.error })`);
      check(write === "no throw", "unsupported (prod): the runtime's write does not throw", write);
      check(page.warnings.length === 1 && !page.problems.length, "unsupported (prod): exactly one console warning, no errors", [...page.warnings, ...page.problems].join(" | ") || "none");
      check(after.frames > before && !after.error, "unsupported (prod): keeps drawing, __gpu.error stays null", JSON.stringify({ before, ...after }));
    });
  },

  async "draw-count"(browser, { check }) {
    // real display frames: every rAF callback in its own task, microtasks in between, as in production
    const lockstep = { mode: "real", rebase: "first-intersection", waitReady: true };
    // in each tick, writes to a slot that do not come from the runtime's own callback: from a second rAF callback and
    // from two timers (an input handler, the explode slider)
    const foreignWrites = `window.__factoryHooks.push((factory) => factory.onFrame(() => {
      const lamp = factory.slots["centrifuge:lamp"];
      const write = (suffix) => () => { lamp.innerHTML = lamp.innerHTML.trimEnd() + suffix; };
      requestAnimationFrame(write(" "));
      setTimeout(write("  "));
      setTimeout(write("   "));
    }));`;
    for (const [name, preloads] of [["runtime writes only", []], ["writes from another rAF callback and timers", [foreignWrites]]])
      await withPage(browser, { path: PAGES.gpu("dark"), lockstep, preloads }, async (page) => {
        const { cdp } = page;
        await advanceTo(cdp, 100);
        await settle(cdp);
        const before = await cdp.evaluate(`({ ticks: __tickGate.ticks, frames: __gpu.frames })`);
        await advanceTo(cdp, 160);
        await settle(cdp);
        const after = await cdp.evaluate(`({ ticks: __tickGate.ticks, frames: __gpu.frames })`);
        const ticks = after.ticks - before.ticks;
        const frames = after.frames - before.frames;
        check(frames === ticks, `draw-count (${name}): one GPU frame per runtime tick`, `${frames} GPU frames for ${ticks} ticks`);
      });
  },

  async "loss-during-init"(browser, { check }) {
    const fresh = await referenceShot(browser, { kind: "gpu", theme: "dark", tick: 120, name: "loss-during-init-fresh-t120" });
    for (const [reason, delayMs] of [["unknown", 0], ["unknown", 2], ["destroyed", 0]]) {
      const name = `loss-during-init (${reason}, ${delayMs} ms)`;
      const file = await withPage(browser, { path: PAGES.gpu("dark"), waitLoad: false, preloads: [LOSE_DURING_INIT(reason, delayMs)] }, async (page) => {
        const { cdp } = page;
        const settled = await waitFor(cdp, "window.__gpu && (__gpu.ready || !!__gpu.error)", 20000).catch(() => false);
        const state = await cdp.evaluate(`({ lost: window.__lostDuringInit ?? null, ready: __gpu.ready, error: __gpu.error, reinits: __gpu.frameStats().reinits, frames: __gpu.frames })`);
        check(state.lost && !state.lost.ready && state.lost.frames === 0, `${name}: the device was lost before the first frame`, JSON.stringify(state.lost));
        check(settled && state.ready && !state.error && state.reinits === 1, `${name}: a new device, ready, no error`, JSON.stringify(state));
        if (!state.ready) return null;
        await advanceTo(cdp, 120);
        check(!page.problems.length, `${name}: no console errors`, consoleText(page));
        return page.shot(`loss-during-init-${reason}-${delayMs}-t120`);
      });
      if (!file) continue;
      const same = compareImages(file, fresh);
      check(same.loosePct <= EDGE.identicalLoosePct, `${name}: frame == a fresh page at the same tick (not blank)`, `${same.loose} px differ`);
    }
  },

  async "external-destroy"(browser, { check }) {
    const file = await withPage(browser, { path: PAGES.gpu("dark"), preloads: [KEEP_DEVICES] }, async (page) => {
      const { cdp } = page;
      await advanceTo(cdp, 300);
      await settle(cdp);
      await cdp.evaluate("__devices.at(-1).destroy()");
      const back = await waitFor(cdp, rendererBack(1), 15000).catch(() => false);
      check(back, "external-destroy: re-initialised after a destroy() from outside the figure", JSON.stringify(await cdp.evaluate("({ reinits: __gpu.frameStats().reinits, error: __gpu.error, devices: __devices.length })")));
      await advanceTo(cdp, 320);
      const frames = await cdp.evaluate("__gpu.frames");
      check(frames > 300, "external-destroy: the figure keeps drawing", `${frames} frames`);
      check(!page.problems.length, "external-destroy: no console errors", consoleText(page));
      return page.shot("external-destroy-t320");
    });
    const fresh = await referenceShot(browser, { kind: "gpu", theme: "dark", tick: 320, name: "external-destroy-fresh-t320" });
    const same = compareImages(file, fresh);
    check(same.loosePct <= EDGE.identicalLoosePct, "external-destroy: frame == a fresh page at the same tick", `${same.loose} px differ`);
  },

  async "submit-failure"(browser, { check }) {
    const file = await withPage(browser, { path: PAGES.gpu("dark"), preloads: [FAILING_SUBMIT] }, async (page) => {
      const { cdp } = page;
      await advanceTo(cdp, 690);
      await settle(cdp);
      // the frame that re-renders the static cache for the new theme fails at submit
      await cdp.evaluate(`window.__failSubmits = 1; document.body.dataset.theme = "light"`);
      await advanceTo(cdp, 700);
      const state = await cdp.evaluate("({ failed: __failSubmits === 0, error: __gpu.error, errors: __gpu.errors.slice(), cached: __gpu.frameStats().cachedFrames })");
      check(state.failed && !state.error && state.errors.some((e) => e.includes("submit failed")), "submit-failure: one frame failed, recorded, the figure kept running", JSON.stringify(state));
      return page.shot("submit-failure-gpu-t700");
    });
    const fresh = await referenceShot(browser, { kind: "gpu", theme: "light", tick: 700, name: "submit-failure-fresh-light-t700" });
    const same = compareImages(file, fresh);
    check(same.loosePct <= EDGE.identicalLoosePct && same.withAA === 0, "submit-failure: the frames after the failure == a fresh light page (no stale cache)", `${same.withAA} px differ`);
  },

  async "submit-failure-native"(browser, { check }) {
    // a tick where the rotor changes under reduced motion, followed by quiet ticks (found on a reference page)
    const quiet = 5;
    const found = await withPage(browser, { path: PAGES.gpu("dark"), reduced: true }, async (page) => {
      const changed = [];
      let last = -1;
      for (let tick = 100; tick <= 1200; tick++) {
        await advanceTo(page.cdp, tick);
        const now = await page.cdp.evaluate("__gpu.frameStats().native?.changedFrames ?? -1");
        if (last >= 0 && now > last) changed.push(tick);
        last = now;
        const k = changed.find((t) => tick - t >= quiet && !changed.some((u) => u > t && u <= t + quiet));
        if (k) return { tick: k, shot: await (async () => { await advanceTo(page.cdp, k + quiet); return page.shot("submit-failure-native-fresh"); })() };
      }
      return null;
    });
    check(!!found, "submit-failure-native: a rotor change followed by quiet ticks under reduced motion", JSON.stringify(found));
    if (!found) return;
    const file = await withPage(browser, { path: PAGES.gpu("dark"), reduced: true, preloads: [FAILING_SUBMIT] }, async (page) => {
      const { cdp } = page;
      await advanceTo(cdp, found.tick - 1);
      const before = await cdp.evaluate("__gpu.frameStats().native.changedFrames");
      await cdp.evaluate("window.__failSubmits = 1");
      await advanceTo(cdp, found.tick);
      const state = await cdp.evaluate("({ failed: __failSubmits === 0, changed: __gpu.frameStats().native.changedFrames, error: __gpu.error })");
      check(state.failed && state.changed === before + 1 && !state.error, `submit-failure-native: t${found.tick} changed the rotor and its frame failed at submit`, JSON.stringify(state));
      // quiet ticks: no frame; then one requested frame (folded into the next tick)
      await advanceTo(cdp, found.tick + quiet - 1);
      await cdp.evaluate("__gpu.redraw()");
      await advanceTo(cdp, found.tick + quiet);
      return page.shot("submit-failure-native-gpu");
    });
    const same = compareImages(file, found.shot);
    check(same.loosePct <= EDGE.identicalLoosePct && same.withAA === 0, `submit-failure-native: the next frame after the failure == a fresh page at t${found.tick + quiet} (the rotor re-expanded)`, `${same.withAA} px differ`);
  },

  async "zero-size"(browser, { check }) {
    const file = await withPage(browser, { path: PAGES.gpu("dark") }, async (page) => {
      const { cdp } = page;
      await advanceTo(cdp, 300);
      await settle(cdp);
      await cdp.evaluate(`document.querySelector(".fx-stage").style.display = "none"; __lockstep.realFrames(5)`);
      // a full-page screenshot resizes the page for a moment (QA-FIXA D3's other trigger)
      await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      await cdp.evaluate(`__lockstep.realFrames(5)`);
      const hidden = await cdp.evaluate("({ errors: __gpu.errors.slice(), width: __gpu.frameStats().width, backing: (() => { const c = document.querySelector('canvas[data-gpu]'); return [c.width, c.height]; })() })");
      check(!hidden.errors.length && hidden.backing[0] > 0 && hidden.width > 0, "zero-size: hidden stage keeps its canvas backing and targets, no WebGPU errors", JSON.stringify(hidden));
      await cdp.evaluate(`document.querySelector(".fx-stage").style.display = ""; __lockstep.realFrames(3)`);
      await advanceTo(cdp, 320);
      const shown = await cdp.evaluate("({ errors: __gpu.errors.slice(), error: __gpu.error })");
      check(!shown.errors.length && !shown.error, "zero-size: shown again, still no errors", JSON.stringify(shown));
      check(!page.problems.length && !page.warnings.length, "zero-size: console clean", consoleText(page));
      return page.shot("zero-size-t320");
    });
    const fresh = await referenceShot(browser, { kind: "gpu", theme: "dark", tick: 320, name: "zero-size-fresh-t320" });
    const same = compareImages(file, fresh);
    check(same.loosePct <= EDGE.identicalLoosePct, "zero-size: frame after showing == a fresh page", `${same.loose} px differ`);
  },

  async dispose(browser, { check }) {
    const file = await withPage(browser, { path: PAGES.gpu("dark"), preloads: [TRACK_GPU_OBJECTS, KEEP_DEVICES] }, async (page) => {
      const { cdp } = page;
      await advanceTo(cdp, 300);
      await settle(cdp);
      const before = await cdp.evaluate("__liveGpuObjects()");
      await cdp.evaluate("__gpu.dispose()");
      const after = await cdp.evaluate(`({ live: __liveGpuObjects(), leaks: __gpuLeaks.slice(0, 8), leakCount: __gpuLeaks.length, attr: document.documentElement.dataset.gpu, deviceLost: null })`);
      after.deviceLost = await cdp.evaluate("Promise.race([__devices.at(-1).lost.then((l) => l.reason), new Promise((r) => setTimeout(() => r(null), 1000))])");
      check(before > 0 && after.live === 0 && after.leakCount === 0, "dispose: every GPU buffer / texture / query set destroyed before the device", JSON.stringify({ before, ...after }));
      check(after.deviceLost === "destroyed" && after.attr === "disposed", "dispose: the device is destroyed, html[data-gpu=disposed]", JSON.stringify(after));
      await advanceTo(cdp, 360);
      const state = await cdp.evaluate(FIGURE_STATE);
      check(state.figureVisible && !state.canvas && state.figureRotor === state.runtimeRotor && state.runtimeBoundToFigure, "dispose: the SVG figure is shown, bound to the runtime and animates", JSON.stringify({ figureVisible: state.figureVisible, canvas: state.canvas, rotor: state.figureRotor === state.runtimeRotor }));
      check(!page.problems.length, "dispose: no console errors", consoleText(page));
      // no GPU figure left to settle: let the compositor present the SVG
      await cdp.evaluate("__lockstep.realFrames(3)");
      return shot(cdp, join(DIR, "dispose-t360.png"), await stageBox(cdp));
    });
    const svg = await referenceShot(browser, { kind: "svg", theme: "dark", tick: 360, name: "dispose-svg-t360" });
    const same = compareImages(svg, file);
    check(same.loosePct <= EDGE.fallbackLoosePct, "dispose: the figure == the SVG page at the same tick", `loose ${same.loosePct}% (${same.loose} px)`);
  },

  async "stroke-crossing"(browser, { check }) {
    const shots = {};
    for (const kind of ["svg", "gpu"])
      shots[kind] = await withPage(browser, { path: PAGES[kind]("light"), preloads: [INJECT_CROSSINGS] }, async (page) => {
        await advanceTo(page.cdp, 60);
        const viewBox = await page.cdp.evaluate(`document.querySelector("svg.iso-svg").getAttribute("viewBox").split(" ").map(Number)`);
        return { file: await page.shot(`stroke-crossing-${kind}-t60`), viewBox };
      });
    const [svg, gpu] = [readPng(shots.svg.file), readPng(shots.gpu.file)];
    const [vx, vy, vw] = shots.gpu.viewBox;
    const scale = gpu.width / vw;
    for (const { d, at } of CROSSING_SHAPES) {
      const [x, y] = [(at[0] - vx) * scale, (at[1] - vy) * scale];
      const [g, s] = [darkestNear(gpu, x, y, 3), darkestNear(svg, x, y, 3)];
      check(g >= s - EDGE.crossingDarkerLevels, `stroke-crossing "${d}": no double blend at (${at}) (darkest GPU ≥ SVG − ${EDGE.crossingDarkerLevels})`, `GPU ${g.toFixed(1)} vs SVG ${s.toFixed(1)}`);
    }
  },

  async "user-timing"(browser, { check }) {
    const count = `performance.getEntriesByType("mark").length + performance.getEntriesByType("measure").length`;
    for (const [name, preloads] of [["gpu page", []], ["fallback page", [NO_WEBGPU]]])
      await withPage(browser, { path: PAGES.gpu("dark"), preloads, dpr: 1 }, async (page) => {
        await advanceTo(page.cdp, EDGE.userTimingTicks, 300000);
        const entries = await page.cdp.evaluate(count);
        check(entries <= EDGE.userTimingEntries, `user-timing (${name}): ≤ ${EDGE.userTimingEntries} entries after ${EDGE.userTimingTicks} ticks`, `${entries} entries`);
      });
  },
};

/** The SVG fallback after a failed WebGPU start: animates, matches the SVG page, runtime bound to the visible figure. */
async function fallbackCase(browser, { check }, { name, preload, errorPrefix }) {
  const file = await withPage(browser, { path: PAGES.gpu("dark"), preloads: [preload] }, async (page) => {
    const { cdp } = page;
    await advanceTo(cdp, 60);
    const early = await cdp.evaluate(FIGURE_STATE);
    await advanceTo(cdp, 120);
    const state = await cdp.evaluate(FIGURE_STATE);
    check(state.gpuAttr === "fallback" && String(state.error).startsWith(errorPrefix), `${name}: data-gpu=fallback, __gpu.error "${errorPrefix}…"`, JSON.stringify({ attr: state.gpuAttr, error: state.error?.slice(0, 80) }));
    check(state.figureVisible && !state.canvas && state.figureLabel, `${name}: the labelled SVG figure replaced the canvas`, JSON.stringify({ figureVisible: state.figureVisible, canvas: state.canvas, label: state.figureLabel }));
    check(state.figureRotor === state.runtimeRotor && state.figureRotor !== early.figureRotor, `${name}: the fallback figure animates (rotor slot follows the runtime)`, `t60 ${early.figureRotor?.length} chars, t120 ${state.figureRotor?.length} vs runtime ${state.runtimeRotor.length}`);
    check(state.runtimeBoundToFigure, `${name}: the runtime is bound to the visible figure (api.el / api.els work)`, state.runtimeBoundToFigure ? "" : await cdp.evaluate(`"FACTORY.svg is svg." + FACTORY.svg.getAttribute("class")`));
    check(!page.problems.length && !page.warnings.length, `${name}: console clean`, consoleText(page));
    return page.shot(`${name}-t120`);
  });
  const svg = await referenceShot(browser, { kind: "svg", theme: "dark", tick: 120, name: `${name}-svg-t120` });
  const same = compareImages(svg, file);
  check(same.loosePct <= EDGE.fallbackLoosePct, `${name}: fallback frame == SVG page at the same tick`, `loose ${same.loosePct}% (${same.loose} px)`);
}

const QUICK = ["theme-switch", "hidden", "loss-after-ready", "loss-during-init", "submit-failure", "submit-failure-native", "zero-size", "no-webgpu", "unsupported"];

const options = parseArgs(["quick"]);
const names = options.only ? String(options.only).split(",") : options.quick ? QUICK : Object.keys(CASES);
const unknown = names.filter((name) => !CASES[name]);
if (unknown.length) {
  console.error(`unknown case ${unknown.join(", ")} (have: ${Object.keys(CASES).join(", ")})`);
  process.exit(2);
}
const checks = createChecks("edge");
await withBrowser(async (browser) => {
  for (const name of names) {
    try {
      await CASES[name](browser, checks);
    } catch (error) {
      checks.check(false, `${name}: ran to completion`, String(error.message ?? error).slice(0, 300));
    }
  }
});
checks.finish({ cases: names });
