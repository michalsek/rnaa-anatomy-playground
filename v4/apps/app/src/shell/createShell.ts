// Adapted from BoneTideOSS (MIT, Konrad Reczko), `createGameShell.ts`: a plain JS-thread
// rAF loop that calls the engine's frame() (one submit) followed by `context.present?.()`.
import type { TgpuRoot } from 'typegpu';
import {
  type CameraState,
  type CanvasContext,
  type DebugMode,
  type FrameSpec,
  type SceneStore,
  type Theme,
  type ViewPreset,
  createRenderer,
} from '@anatomy/engine';

/** Longest scene step per frame, in seconds. */
const MAX_DT = 0.1;
/** Frames kept for the DEV perf summary (`__v4perf()`). */
const PERF_N = 300;

declare const __DEV__: boolean;

export interface CanvasLike {
  width: number;
  height: number;
}

/** Layout size in CSS px (points on native) and the device pixel ratio. */
export interface ShellSize {
  width: number;
  height: number;
  dpr: number;
}

/** What the UI controls; the shell applies it at start and whenever it changes. */
export interface ShellControls {
  theme: Theme;
  /**
   * A view of the scene by name (an unknown name falls back to the first view), or an ad-hoc
   * preset (dev hook `__v4.look`).
   */
  view: string | ViewPreset;
  paused: boolean;
  debug: DebugMode;
  /** Where fits go: pads from the canvas edges (the overlays' room), an optional aspect (16:9 recordings). */
  frame: FrameSpec;
}

export interface Shell {
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  /** The texture size the last frame drew into (DEV size probe). */
  texture(): { width: number; height: number };
  setTheme(theme: Theme): void;
  /** `ease`: settle into the view from the current camera (view chips, the tour). */
  setView(view: string | ViewPreset, o?: { ease?: boolean }): void;
  /** Re-apply the current view (the scene's view list changed, e.g. a `views.ts` edit). */
  refreshView(): void;
  setPaused(paused: boolean): void;
  setDebug(mode: DebugMode): void;
  setFrame(frame: FrameSpec): void;
  /** The current camera (a copy), and a free one (orbit, pan, zoom; `ease` for scripts). */
  camera(): CameraState;
  setCamera(state: CameraState, o?: { ease?: boolean }): void;
  /** The line-width reference (fit) zoom: orbit's zoom limits are relative to it. */
  refZoom(): number;
  /** Ease back to the current view's preset (double tap). */
  resetView(): void;
  /** M12 (film): the camera a named view (or preset) would get now, without applying it. */
  cameraFor(view: string | ViewPreset): CameraState;
  /** M12 (film): the eases' clock (ms; null: wall time) and pinned line widths (null: the view's). */
  setClock(clock: (() => number) | null): void;
  setLines(lines: { scale: number; ref: number } | null): void;
  /**
   * M12 (film): manual stepping. `setManual(true)` stops the rAF loop; `step(dt)` then ticks and
   * draws one frame of exactly dt seconds and resolves once the GPU has finished it.
   */
  setManual(on: boolean): void;
  step(dt: number): Promise<void>;
  stop(): void;
}

export function createShell(
  root: TgpuRoot,
  context: CanvasContext,
  canvas: CanvasLike,
  format: GPUTextureFormat,
  size: ShellSize,
  store: SceneStore,
  /** Read on every view change, so an edited view list doesn't need a new shell. */
  views: () => readonly ViewPreset[],
  controls: ShellControls,
  onFatal: (message: string) => void,
): Shell {
  const device = root.device;
  let stopped = false;
  const fatal = (reason: unknown) => {
    if (stopped) return;
    stopped = true;
    onFatal(reason instanceof Error ? reason.message : String(reason));
  };
  void device.lost.then((info) => {
    // 'destroyed' is our own root.destroy() (unmount, Fast Refresh), not a failure.
    if (info.reason !== 'destroyed') fatal(`device lost: ${info.message || info.reason}`);
  });
  const onUncaptured = (event: GPUUncapturedErrorEvent) => fatal(event.error.message);
  device.addEventListener('uncapturederror', onUncaptured);

  const applySize = (cssWidth: number, cssHeight: number, dpr: number) => {
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    return { width: canvas.width, height: canvas.height, dpr };
  };

  const px = applySize(size.width, size.height, size.dpr);
  const renderer = createRenderer({
    root,
    context,
    format,
    width: px.width,
    height: px.height,
    dpr: px.dpr,
    store,
    theme: controls.theme,
  });
  renderer.setFrame(controls.frame);
  let view = controls.view;
  const applyView = (o?: { ease?: boolean }) => {
    const list = views();
    const preset = typeof view === 'string' ? (list.find((v) => v.name === view) ?? list[0]) : view;
    if (preset) renderer.setView(preset, o);
    else renderer.fit();
  };
  applyView();
  renderer.setDebug(controls.debug);

  // Scene time: wall time minus the time spent paused. A frame step is clamped to MAX_DT, so
  // returning from the background (rAF stops there) does not jump the scene forward.
  let paused = controls.paused;
  let last = performance.now();
  let time = 0;
  let raf = 0;
  // DEV perf: rAF gaps and the tick (sims + pose writes) per frame, the last PERF_N frames.
  const gaps = new Float32Array(PERF_N);
  const ticks = new Float32Array(PERF_N);
  let frames = 0;
  /** One frame: tick the scene by dt (0 while paused), draw. False after a fatal error. */
  const tickDraw = (dt: number, gap: number) => {
    try {
      // Tick every frame (dt 0 while paused), so poses written while paused (a seek) render.
      if (!paused) time += dt;
      const t0 = performance.now();
      store.tick(time, paused ? 0 : dt);
      const k = frames++ % PERF_N;
      gaps[k] = gap;
      ticks[k] = performance.now() - t0;
      renderer.frame();
    } catch (err) {
      fatal(err);
      return false;
    }
    return true;
  };
  let manual = false;
  const loop = (now: number) => {
    if (stopped || manual) return;
    const dt = Math.min(Math.max(0, (now - last) / 1000), MAX_DT);
    const gap = now - last;
    last = now;
    if (!tickDraw(dt, gap)) return;
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  if (__DEV__) {
    /** `__v4perf()`: fps and the max rAF gap, tick (sims + writes), flatten (+ upload), frame CPU. */
    (globalThis as { __v4perf?: () => unknown }).__v4perf = () => {
      const n = Math.min(frames, PERF_N);
      const q = (a: Float32Array) => {
        const v = Array.from(a.subarray(0, n)).sort((x, y) => x - y);
        return { median: +(v[Math.floor(n / 2)] ?? 0).toFixed(2), p95: +(v[Math.floor(n * 0.95)] ?? 0).toFixed(2), max: +(v[n - 1] ?? 0).toFixed(2) };
      };
      const g = q(gaps);
      const r = renderer.perf();
      let total = 0;
      for (let i = 0; i < n; i++) total += gaps[i]!;
      return {
        frames: n,
        fps: +(n / (total / 1000)).toFixed(1),
        gapMs: g,
        over25: Array.from(gaps.subarray(0, n)).filter((x) => x > 25).length,
        tickMs: q(ticks),
        flattenMs: r.flattenMs,
        frameMs: r.frameMs,
        kbPerFrame: +(r.bytesPerFrame / 1024).toFixed(1),
        buildMs: +r.buildMs.toFixed(1),
        build: r.build,
      };
    };
  }

  return {
    resize(cssWidth, cssHeight, dpr) {
      const next = applySize(cssWidth, cssHeight, dpr);
      // The renderer refits a preset camera itself and leaves a user camera alone.
      renderer.resize(next.width, next.height, next.dpr);
    },
    texture: () => renderer.perf().texture,
    setTheme: (next) => renderer.setTheme(next),
    setView(next, o) {
      view = next;
      applyView(o);
    },
    refreshView: () => applyView(),
    setPaused(next) {
      paused = next;
    },
    setDebug: (mode) => renderer.setDebug(mode),
    setFrame: (frame) => renderer.setFrame(frame),
    camera: () => renderer.getCamera(),
    setCamera: (state, o) => renderer.setCamera(state, o),
    refZoom: () => renderer.refZoom(),
    resetView: () => applyView({ ease: true }),
    cameraFor(v) {
      const list = views();
      const preset = typeof v === 'string' ? (list.find((x) => x.name === v) ?? list[0]) : v;
      if (!preset) throw new Error(`no view ${JSON.stringify(v)}`);
      return renderer.cameraFor(preset);
    },
    setClock: (clock) => renderer.setClock(clock),
    setLines: (lines) => renderer.setLines(lines),
    setManual(on) {
      if (on === manual || stopped) return;
      manual = on;
      cancelAnimationFrame(raf);
      if (!on) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    },
    async step(dt) {
      if (stopped) throw new Error('the shell stopped');
      if (!manual) throw new Error('step() needs setManual(true)');
      if (!tickDraw(dt, dt * 1000)) throw new Error('the frame failed');
      await device.queue.onSubmittedWorkDone();
    },
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      device.removeEventListener('uncapturederror', onUncaptured);
      renderer.destroy();
    },
  };
}
