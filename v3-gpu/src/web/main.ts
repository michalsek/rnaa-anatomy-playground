// Web host: boots a GPU figure on a page built by tools/build.mjs. The stage holds `canvas[data-gpu]` and, right after
// it, the figure's own <svg class="iso-svg"> (the v2 markup, slots included). The SVG overlays the hidden canvas until
// the first GPU frame is presented (it is the accessible image while WebGPU boots), then hides; if the GPU path fails
// it takes the canvas' place for good. On live pages (`canvas[data-live]`) the v2 runtime binds to that same SVG, so
// `api.el / els` work in every mode, and its slot writes are intercepted (src/web/dom-slots.ts).
import tgpu from 'typegpu';
import type { DlJson } from '../../export/dl-format.mjs';
import { sceneFromDl } from '../core/dl-loader.ts';
import { GpuView, type DeviceSize, type GpuHost } from '../core/frame-loop.ts';
import { PaintTable, type ChainNode } from '../core/paint.ts';
import { NO_PROFILER, type Profiler, type TimingSpan } from '../core/profiler.ts';
import type { CacheMode } from '../core/renderer.ts';
import { decodeBase64, sceneFromWire, type GpuScene } from '../core/scene.ts';
import type { SlotPlacement } from '../core/slots.ts';
import { LiveAdapter } from '../live/adapter.ts';
import { CollectedSlot, SlotGeometryBuilder } from '../live/geometry.ts';
import { LiveSlotPath } from '../live/live-path.ts';
import { NativeRotor, type MachineApi } from '../native/native-rotor.ts';
import type { MachineGpu } from '../native/rotor-contract.ts';
import { createApi, type GpuApi } from './api.ts';
import { DomSlotSource } from './dom-slots.ts';
import { DomPaintResolver } from './palette-dom.ts';

/** Build-time flag (tools/build.mjs dev bundle): unsupported live markup throws at the runtime's write. */
declare const __GPU_DEV__: boolean;

/** Probe ancestors of slot content in the v2 page: `<g class="fx-parts">` › `<g data-slot>` (data-slot is no key). */
const SLOT_CHAIN: ChainNode[] = [{ tag: 'g', attrs: { class: 'fx-parts' } }, { tag: 'g', attrs: {} }];

/** A machine's api as FACTORY.define hands it to the machine (runtime.js). */
type MachineApiOf = MachineApi & { gpu?: MachineGpu };

/** The v2 runtime (FACTORY, runtime.js): the hook every tick calls first, and how machines are created. */
interface FactoryHandle {
  onFrame(hook: (dt: number) => void): void;
  define(id: string, make: (api: MachineApiOf) => unknown): unknown;
}

declare global {
  interface Window {
    FACTORY?: FactoryHandle;
  }
}

/** The real clock even under tools/lockstep.js (which virtualizes performance.now, not event time stamps). */
const eventClock = { now: () => new Event('clock').timeStamp };

/** User Timing mirror of the renderer's spans (bench tooling); entries are cleared as soon as observers saw them. */
const userTimingProfiler: Profiler = {
  begin(span: TimingSpan) {
    performance.mark(`${span}-start`);
  },
  end(span: TimingSpan) {
    performance.measure(span, `${span}-start`);
    performance.clearMarks(`${span}-start`);
    performance.clearMeasures(span);
  },
};

function loadScene(): { scene: GpuScene; slots: SlotPlacement[] } {
  const wire = document.getElementById('gpu-scene');
  if (wire) return { scene: sceneFromWire(JSON.parse(wire.textContent ?? '')), slots: [] };
  const dl = document.getElementById('gpu-dl');
  const bin = document.getElementById('gpu-dl-bin');
  if (!dl || !bin) throw new Error('no scene data on the page');
  const json: DlJson = JSON.parse(dl.textContent ?? '');
  const slots = json.slots.map(({ name, anchor, side, seq }) => ({ name, anchor, side, seq }));
  return { scene: sceneFromDl(json, decodeBase64((bin.textContent ?? '').trim())), slots };
}

/** Calls `use` with the v2 runtime as soon as the page script assigns window.FACTORY (keeps any accessor already there). */
function whenFactory(use: (factory: FactoryHandle) => void) {
  const prior = Object.getOwnPropertyDescriptor(window, 'FACTORY');
  if (prior && !prior.set && prior.value) return use(prior.value);
  let value: FactoryHandle | undefined = prior?.value;
  let seen: FactoryHandle | undefined;
  Object.defineProperty(window, 'FACTORY', {
    configurable: true,
    enumerable: true,
    get: () => (prior?.get ? prior.get.call(window) : value),
    set(next: FactoryHandle) {
      if (prior?.set) prior.set.call(window, next);
      else value = next;
      if (next && next !== seen) {
        seen = next;
        use(next);
      }
    },
  });
}

const cacheModeOf = (param: string | null): CacheMode => (param === '0' || param === 'off' ? 'off' : param === 'overlay' ? 'overlay' : 'on');

function boot(api: GpuApi) {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-gpu]');
  const stage = canvas?.parentElement;
  const figure = stage?.querySelector<SVGSVGElement>('svg.iso-svg');
  if (!canvas || !stage || !figure) throw new Error('page without canvas[data-gpu] and its svg.iso-svg figure');
  const params = new URLSearchParams(location.search);
  const live = canvas.dataset.live !== undefined;

  const showFigure = (reason: string) => {
    api.error = reason;
    canvas.remove();
    figure.removeAttribute('style');
    figure.removeAttribute('aria-hidden');
    document.documentElement.dataset.gpu = 'fallback';
  };
  if (!navigator.gpu) return showFigure('no-webgpu');

  const { scene, slots } = loadScene();
  const paints = new PaintTable();
  for (const { key, desc } of scene.palette) paints.idOf(key, () => desc);
  const resolver = new DomPaintResolver(stage, scene.svgClass);
  const profiler = window.__gpuProfile || params.has('profile') ? userTimingProfiler : NO_PROFILER;

  let source: DomSlotSource | null = null;
  let path: LiveSlotPath | null = null;
  let native: NativeRotor | null = null;
  let view: GpuView | null = null;
  const sync = () => {
    if (!view) return;
    api.error = view.error;
    api.adapter = view.adapterInfo;
  };
  if (live) {
    const elements = new Map(slots.map(({ name }) => {
      const element = figure.querySelector(`[data-slot="${CSS.escape(name)}"]`);
      if (!element) throw new Error(`live slot ${name} is missing from the figure`);
      return [name, element] as const;
    }));
    source = new DomSlotSource(elements);
    const builder = new SlotGeometryBuilder(paints, SLOT_CHAIN);
    const adapter = new LiveAdapter({
      source, builder, paints, resolver, profiler,
      policy: __GPU_DEV__ ? 'report' : 'skip',
      itemBase: scene.items.length,
      clock: eventClock,
      onError: (error) => {
        view?.recordError(error, true);
        sync();
      },
      onWarning: (message) => console.warn(message),
    });
    path = new LiveSlotPath(source, adapter);
    // ?native=0: the rotor slots stay on the markup path (v2 builds their strings every frame)
    if (params.get('native') !== '0') {
      const nativeRotor = new NativeRotor({
        paints, resolver, slotChain: SLOT_CHAIN, slotNames: slots.map(({ name }) => name), itemBase: scene.items.length, owner: source, clock: eventClock,
        onChange: () => view?.request(),
      });
      native = nativeRotor;
      if (__GPU_DEV__) {
        api.nativeCheck = async () => {
          const gpu = await nativeRotor.readback();
          if (!gpu) return null;
          const reference = gpu.slots.map(({ slot }) => {
            const collected = new CollectedSlot();
            builder.collect(elements.get(slots[slot].name)!.innerHTML, collected);
            paints.resolvePending(resolver);
            const geometry = builder.pack(collected, scene.items.length + slot);
            return { slot, segCount: geometry.segCount, vertexCount: geometry.vertexCount, words: [...new Uint32Array(geometry.bytes, 0, geometry.byteLength / 4)] };
          });
          return { gpu: { ...gpu, segs: [...gpu.segs], fills: [...gpu.fills] }, reference };
        };
      }
    }
    if (__GPU_DEV__) {
      source.validate = (markup) => {
        try {
          builder.validate(markup);
        } catch (error) {
          view?.recordError(error, true);
          sync();
          throw error;
        }
      };
    }
  }

  const host: GpuHost = {
    clock: eventClock,
    profiler,
    resolver,
    createRoot: async () => {
      const root = await tgpu.init({ device: { optionalFeatures: ['timestamp-query'] } });
      return root;
    },
    createSurface: (root) => ({ context: root.configureContext({ canvas, alphaMode: 'opaque' }), format: navigator.gpu.getPreferredCanvasFormat() }),
    requestFrame: (callback) => requestAnimationFrame(callback),
    background: () => resolver.background(),
    onReady: () => {
      figure.style.display = 'none';
      figure.setAttribute('aria-hidden', 'true');
      canvas.style.visibility = '';
      if (source) source.writeThrough = false;
      native?.activate();
      api.ready = true;
      document.documentElement.dataset.gpu = 'ready';
    },
    onFallback: (reason) => {
      native?.deactivate();
      source?.release();
      showFigure(reason);
    },
  };
  // GPU timestamps cost an extra pass and two submits per measured frame: only when asked for (not by __gpuProfile, so
  // CPU breakdowns measured through User Timing stay free of them)
  const timestamps = params.has('profile') || params.has('gpuTime') || window.__gpuTimestamps === true;
  view = new GpuView(host, { scene, slots, paints, cache: cacheModeOf(params.get('cache')), live: path, painters: native ? [native] : [], timestamps, measureRepeat: Number(params.get('gpuRepeat') ?? 1) });
  const gpuView = view;
  gpuView.onFrame = () => {
    api.frames = gpuView.frames;
  };
  if (source) source.onChange = (slot) => (slot < 0 ? gpuView.request() : gpuView.slotChanged(slot));
  if (live) {
    whenFactory((factory) => {
      factory.onFrame(() => gpuView.beginRuntimeFrame());
      const nativeRotor = native;
      if (!nativeRotor) return;
      // every machine gets `api.gpu` (the centrifuge's drawRotor calls api.gpu.rotor, src/native/rotor-contract.ts)
      const define = factory.define;
      factory.define = (id, make) => define.call(factory, id, (machineApi) => {
        const gpu = nativeRotor.machineGpu(id, machineApi);
        if (gpu) machineApi.gpu = gpu;
        return make(machineApi);
      });
    });
  }

  // Device pixels: the backing store must have exactly the device rows / columns Chrome shows the canvas in (a
  // fractional CSS box such as 774.25 px is snapped). devicePixelContentBoxSize gives them on real displays; under CDP
  // device-scale emulation it reports the snapped box in CSS px instead, which is then scaled by devicePixelRatio.
  const applySize = (cssWidth: number, cssHeight: number, device?: ResizeObserverSize) => {
    const ratio = devicePixelRatio || 1;
    const near = (a: number, b: number) => Math.abs(a - b) <= 1;
    const devicePx = !!device && near(device.inlineSize, cssWidth * ratio) && near(device.blockSize, cssHeight * ratio);
    const snappedCssPx = !!device && !devicePx && near(device.inlineSize, cssWidth) && near(device.blockSize, cssHeight);
    const pick = (devicePixels: number | undefined, css: number) => (devicePx ? devicePixels! : snappedCssPx ? Math.round(devicePixels! * ratio) : Math.max(1, Math.round(css * ratio)));
    const width = pick(device?.inlineSize, cssWidth);
    const height = pick(device?.blockSize, cssHeight);
    const size: DeviceSize = { width, height, dpr: cssWidth > 0 ? width / cssWidth : ratio };
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    // ResizeObserver callbacks run in the rendering steps right before paint: drawing now means the resized (cleared)
    // canvas never shows a blank frame, also while the page's animation frames are held
    gpuView.resize(size);
  };
  const resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    applySize(entry.contentBoxSize[0].inlineSize, entry.contentBoxSize[0].blockSize, entry.devicePixelContentBoxSize?.[0]);
  });
  try {
    resizeObserver.observe(canvas, { box: 'device-pixel-content-box' });
  } catch {
    resizeObserver.observe(canvas);
  }
  // DPR changes (zoom, moving windows, emulation) do not always reach the observer: watch the resolution query too
  const watchResolution = () => {
    matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => {
      if (canvas.isConnected) {
        const r = canvas.getBoundingClientRect();
        applySize(r.width, r.height);
      }
      watchResolution();
    }, { once: true });
  };
  watchResolution();
  // Theme: kit pages switch with body[data-theme]; pages that follow the OS scheme switch with the media query
  new MutationObserver(() => gpuView.repaint()).observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => gpuView.repaint());

  api.frameStats = () => {
    const ms = { liveJs: gpuView.timings.liveJs, encode: gpuView.timings.encode, encodeWithGroups: gpuView.timings.encodeWithGroups, gpu: gpuView.timings.gpu, gpuCacheRebuild: gpuView.timings.gpuCacheRebuild };
    const adapter = path?.adapter;
    return {
      ...(gpuView.rendererStats ?? {}),
      reinits: gpuView.reinits,
      width: gpuView.size.width,
      height: gpuView.size.height,
      dpr: gpuView.size.dpr,
      share: gpuView.share,
      errors: gpuView.errors.length,
      paints: paints.size,
      envelopes: gpuView.envelopes,
      native: native ? native.stats : null,
      ...(adapter
        ? {
            live: {
              ...adapter.counters,
              mesh: { ...adapter.meshStats },
              gpu: { ...(gpuView.painterStats ?? {}) },
              ms: {
                ...Object.fromEntries(Object.entries(ms).map(([name, timings]) => [name, timings.summary()])),
                parse: adapter.timings.parse.summary(),
                upload: adapter.timings.upload.summary(),
              },
            },
          }
        : {}),
    };
  };
  api.errors = gpuView.errors;
  api.setShare = (share) => gpuView.setShare(share);
  api.setTheme = (theme) => {
    document.body.dataset.theme = theme;
  };
  api.redraw = () => gpuView.request();
  api.simulateDeviceLoss = () => gpuView.simulateDeviceLoss();
  gpuView.start().then(sync, (error: Error) => {
    gpuView.recordError(error, true);
    host.onFallback(`start-failed: ${error.message}`);
    sync();
  });
}

const api = createApi();
try {
  boot(api);
} catch (error) {
  api.error = String((error as Error)?.stack ?? error);
  console.error(error);
}
