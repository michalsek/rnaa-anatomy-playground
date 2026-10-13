// Boot: find the canvas, load the scene, init TypeGPU, probe the palette, size to device pixels, draw on demand.
// window.__gpu is the tool surface (ready, frameStats, setShare, setTheme, simulateDeviceLoss).
import tgpu from 'typegpu';
import { resolveBackground, resolvePaints, resolvePalette } from './palette.ts';
import { Renderer } from './renderer.ts';
import { sceneFromWire, type ChainNode, type GpuScene } from './scene.ts';
import { sceneFromDl } from './dl-loader.ts';
import { LiveAdapter, measureSince } from './live/adapter.ts';
import { DomSlotSource } from './live/dom-slots.ts';
import { LiveSlots, type SlotPlacement } from './live/slot-renderer.ts';

/** Build-time flag (tools/build.mjs --dev): unsupported live markup throws at the runtime's write instead of warning. */
declare const __GPU_DEV__: boolean;

/** Probe ancestors of slot content in the v2 page: `<g class="fx-parts">` › `<g data-slot>` (data-slot is not a key). */
const SLOT_CHAIN: ChainNode[] = [{ tag: 'g', attrs: { class: 'fx-parts' } }, { tag: 'g', attrs: {} }];
/** User Timing entries of the live path are cleared this often (PerformanceObservers still see every entry). */
const TIMING_CLEAR_FRAMES = 600;
const TIMING_MEASURES = ['live-js', 'adapter-parse', 'adapter-upload', 'gpu-encode', 'gpu:encode'];
const TIMING_MARKS = ['live-js-start', 'adapter-parse-start', 'adapter-upload-start', 'gpu:encode-start', 'gpu:encode-end'];

interface GpuApi {
  ready: boolean;
  error: string | null;
  adapter: Record<string, unknown> | null;
  frameStats(): Record<string, unknown>;
  setShare(x: number): void;
  setTheme(theme: 'light' | 'dark'): void;
  redraw(): void;
  simulateDeviceLoss(): void;
  frames: number;
}

const api: GpuApi = ((window as any).__gpu = {
  ready: false,
  error: null,
  adapter: null,
  frames: 0,
  frameStats: () => ({}),
  setShare: () => {},
  setTheme: () => {},
  redraw: () => {},
  simulateDeviceLoss: () => {},
});

function loadScene(): { scene: GpuScene; slots: SlotPlacement[] } {
  const wire = document.getElementById('gpu-scene');
  if (wire) return { scene: sceneFromWire(JSON.parse(wire.textContent!)), slots: [] };
  const dl = document.getElementById('gpu-dl');
  if (dl) {
    const json = JSON.parse(dl.textContent!);
    const slots: SlotPlacement[] = json.slots.map(({ name, anchor, side, seq }: SlotPlacement) => ({ name, anchor, side, seq }));
    return { scene: sceneFromDl(json, document.getElementById('gpu-dl-bin')!.textContent!.trim()), slots };
  }
  throw new Error('no scene data on the page');
}

/**
 * Live pages (canvas[data-live]): the v2 runtime keeps running verbatim against hidden skeleton slots. Installed
 * synchronously, before the page's module script runs; returns null on static pages.
 */
function installLive(canvas: HTMLCanvasElement, scene: GpuScene, slots: SlotPlacement[]) {
  if (canvas.dataset.live === undefined) return null;
  const stage = canvas.parentElement!;
  const skeleton = stage.querySelector('svg.fx-live-slots');
  if (!skeleton) throw new Error('live page without its slot skeleton (svg.fx-live-slots)');
  const elements = new Map<string, Element>();
  for (const { name } of slots) {
    const el = skeleton.querySelector(`[data-slot="${CSS.escape(name)}"]`);
    if (!el) throw new Error(`live slot ${name} is missing from the skeleton`);
    elements.set(name, el);
  }
  let adapter: LiveAdapter | null = null;
  const source = new DomSlotSource(elements, __GPU_DEV__ ? (markup) => adapter!.validate(markup) : null);
  adapter = new LiveAdapter(source, scene, { resolve: (paints) => resolvePaints(paints, scene, stage) }, __GPU_DEV__ ? 'throw' : 'skip', SLOT_CHAIN);
  // live-js: every page rAF callback (the runtime's tick: simulation + slot writes), timed on the real clock.
  const pageRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) =>
    pageRaf((time) => {
      performance.mark('live-js-start');
      try {
        callback(time);
      } finally {
        adapter!.samples.liveJs.push(measureSince('live-js', 'live-js-start'));
      }
    });
  return { source, adapter, pageRaf };
}

/**
 * Until the first GPU frame is presented the SVG from the <template> covers the (hidden) canvas, so the figure is
 * never blank while WebGPU boots and compiles. It is appended at the end of the stage: runtime.js binds to the first
 * <svg> of the stage, which must stay the live slot skeleton.
 */
function showPreview(canvas: HTMLCanvasElement): SVGSVGElement | null {
  const template = document.getElementById('svg-fallback') as HTMLTemplateElement | null;
  const svg = template?.content.querySelector('svg')?.cloneNode(true) as SVGSVGElement | undefined;
  if (!svg) return null;
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = `position:absolute;left:${canvas.offsetLeft}px;top:${canvas.offsetTop}px;width:${canvas.offsetWidth}px;height:${canvas.offsetHeight}px`;
  canvas.style.visibility = 'hidden';
  canvas.parentElement!.appendChild(svg);
  return svg;
}

/** No WebGPU: the preview SVG takes the canvas' place for good. */
function showFallback(canvas: HTMLCanvasElement, preview: SVGSVGElement | null, reason: string) {
  api.error = reason;
  if (preview) {
    preview.removeAttribute('style');
    preview.removeAttribute('aria-hidden');
    canvas.replaceWith(preview);
  } else {
    canvas.remove();
  }
  document.documentElement.dataset.gpu = 'fallback';
}

async function main() {
  const canvas = document.querySelector('canvas[data-gpu]') as HTMLCanvasElement;
  const stage = canvas.parentElement!;
  const { scene, slots } = loadScene();
  const live = installLive(canvas, scene, slots);
  const raf = live?.pageRaf ?? requestAnimationFrame;
  const preview = showPreview(canvas);
  if (live && preview) live.source.forwardTo(preview);
  const fallback = (reason: string) => showFallback(canvas, preview, reason);
  const reveal = () => {
    if (!preview?.isConnected || api.error) return;
    preview.remove();
    canvas.style.visibility = '';
    live?.source.stopForwarding();
  };
  if (!navigator.gpu) return fallback('no-webgpu');
  let renderer: Renderer | null = null;
  let root: Awaited<ReturnType<typeof tgpu.init>> | null = null;
  let reinits = 0;
  let size = { width: 0, height: 0, dpr: 1 };
  let pending = false;
  let intentionalLoss = false;
  let share = 0;
  // Ready (and the preview swapped for the canvas) once the first frame's GPU work is done. Not tied to rAF: the live
  // pages' first frame may come from a slot write while tools/lockstep.js holds rAF frozen.
  let firstFrame: () => void = () => {};
  const presented = new Promise<void>((resolve) => {
    firstFrame = () => root!.device.queue.onSubmittedWorkDone().then(() => resolve());
  });

  const draw = () => {
    pending = false;
    if (!renderer) return;
    live?.adapter.flush();
    renderer.share = share;
    renderer.render();
    api.frames++;
    if (api.frames === 1) firstFrame();
    if (live) {
      const { samples } = live.adapter;
      samples.encode.push(renderer.stats.lastEncodeMs);
      if (renderer.live?.activeGroups) samples.encodeWithGroups.push(renderer.stats.lastEncodeMs);
      if (renderer.stats.lastGpuMs !== null) samples.gpu.push(renderer.stats.lastGpuMs);
      if (api.frames % TIMING_CLEAR_FRAMES === 0) {
        for (const name of TIMING_MEASURES) performance.clearMeasures(name);
        for (const name of TIMING_MARKS) performance.clearMarks(name);
      }
    }
  };
  const request = () => {
    if (pending) return;
    pending = true;
    raf(() => {
      if (pending) draw();
    });
  };
  // Live frames render right after the runtime's rAF callback has written its slots (microtask), so one rAF drives
  // both the simulation and the GPU frame; a pending resize / theme redraw is folded into it.
  if (live) live.source.onChange = () => queueMicrotask(() => renderer && draw());
  const probe = () => {
    if (!renderer) return;
    renderer.setPalette(resolvePalette(scene, stage), resolveBackground(stage));
    live?.adapter.reclassify();
    request();
  };

  async function start() {
    try {
      root = await tgpu.init({ device: { optionalFeatures: ['timestamp-query'] } });
    } catch (e) {
      fallback(`no-adapter: ${(e as Error).message}`);
      return false;
    }
    const info = (root.device as any).adapterInfo ?? {};
    api.adapter = { vendor: info.vendor, architecture: info.architecture, description: info.description, features: [...root.enabledFeatures] };
    root.device.lost.then((lost) => {
      renderer = null;
      live?.adapter.detach();
      if (lost.reason === 'destroyed' && !intentionalLoss) return;
      intentionalLoss = false;
      reinits++;
      start().then(() => request());
    });
    root.device.addEventListener('uncapturederror', (e: any) => console.error('WebGPU:', e.error?.message ?? e));
    const next = new Renderer(root, canvas, scene, live ? slots : []);
    if (live) next.live = new LiveSlots(next, slots);
    await next.compilePipelines();
    renderer = next;
    if (size.width) renderer.resize(size.width, size.height, size.dpr);
    probe();
    if (live && renderer.live) live.adapter.attach(renderer, renderer.live);
    return true;
  }

  // Device pixels: devicePixelContentBoxSize is exact (snapped) on real displays, but under CDP device-metrics
  // emulation (capture.mjs / drive.mjs --scale) Chrome reports it in CSS px while devicePixelRatio is emulated, so
  // trust it only when it agrees with devicePixelRatio to within a pixel.
  // The backing store must have exactly the device rows/columns Chrome displays the canvas in (a fractional CSS box,
  // e.g. 774.25 px, is snapped). devicePixelContentBoxSize gives them on real displays; under CDP device-scale
  // emulation it reports the snapped box in CSS px instead, which is scaled by devicePixelRatio here.
  const applySize = (cssW: number, cssH: number, dev?: { inlineSize: number; blockSize: number }) => {
    const ratio = devicePixelRatio || 1;
    const near = (a: number, b: number) => Math.abs(a - b) <= 1;
    const devicePx = dev && near(dev.inlineSize, cssW * ratio) && near(dev.blockSize, cssH * ratio);
    const snappedCssPx = dev && !devicePx && near(dev.inlineSize, cssW) && near(dev.blockSize, cssH);
    const width = devicePx ? dev!.inlineSize : snappedCssPx ? Math.round(dev!.inlineSize * ratio) : Math.max(1, Math.round(cssW * ratio));
    const height = devicePx ? dev!.blockSize : snappedCssPx ? Math.round(dev!.blockSize * ratio) : Math.max(1, Math.round(cssH * ratio));
    size = { width, height, dpr: width / cssW };
    if (!renderer) return request();
    // ResizeObserver callbacks run in the rendering steps right before paint: redraw now, so the resized (cleared)
    // canvas never shows a blank or stale frame, also while page rAF is held (tools/lockstep.js freeze).
    renderer.resize(width, height, size.dpr);
    draw();
  };
  const observer = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    applySize(entry.contentBoxSize[0].inlineSize, entry.contentBoxSize[0].blockSize, entry.devicePixelContentBoxSize?.[0]);
  });
  try {
    observer.observe(canvas, { box: 'device-pixel-content-box' });
  } catch {
    observer.observe(canvas);
  }
  // DPR changes (zoom, moving windows, emulation) do not always reach the observer: watch the resolution query too.
  const watchDpr = () => {
    matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => {
      const r = canvas.getBoundingClientRect();
      applySize(r.width, r.height);
      watchDpr();
    }, { once: true });
  };
  watchDpr();

  // Theme: kit pages switch with body[data-theme]; also follow the OS scheme when the page opts in (data-theme="auto").
  new MutationObserver(probe).observe(document.body, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', probe);

  api.frameStats = () => ({
    ...(renderer?.stats ?? {}),
    reinits,
    width: size.width,
    height: size.height,
    dpr: size.dpr,
    share,
    ...(live ? { live: liveStats() } : {}),
  });
  const liveStats = () => {
    const { adapter } = live!;
    const ms = Object.fromEntries(Object.entries(adapter.samples).map(([name, samples]) => [name, samples.summary()]));
    return { ...adapter.counters, mesh: { ...adapter.meshStats }, gpu: { ...(renderer?.live?.stats ?? {}) }, ms };
  };
  api.setShare = (x: number) => { share = x; request(); };
  api.setTheme = (theme) => { document.body.dataset.theme = theme; probe(); };
  api.redraw = request;
  api.simulateDeviceLoss = () => { intentionalLoss = true; root?.device.destroy(); };

  if (!(await start())) return;
  await presented;
  reveal();
  api.ready = true;
  document.documentElement.dataset.gpu = 'ready';
}

main().catch((e) => {
  api.error = String(e?.stack ?? e);
  console.error(e);
});
