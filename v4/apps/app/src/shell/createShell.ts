// Adapted from BoneTideOSS (MIT, Konrad Reczko), `createGameShell.ts`: a plain JS-thread
// rAF loop that calls the engine's frame() (one submit) followed by `context.present?.()`.
import type { TgpuRoot } from 'typegpu';
import {
  type CanvasContext,
  type DebugMode,
  type SceneSpec,
  type Theme,
  createRenderer,
} from '@anatomy/engine';

/** Longest scene step per frame, in seconds. */
const MAX_DT = 0.1;

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
  /** Index into `scene.views`. */
  view: number;
  paused: boolean;
  debug: DebugMode;
}

export interface Shell {
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  setTheme(theme: Theme): void;
  setView(index: number): void;
  setPaused(paused: boolean): void;
  setDebug(mode: DebugMode): void;
  stop(): void;
}

export function createShell(
  root: TgpuRoot,
  context: CanvasContext,
  canvas: CanvasLike,
  format: GPUTextureFormat,
  size: ShellSize,
  scene: SceneSpec,
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
    scene,
    theme: controls.theme,
  });
  let view = controls.view;
  const applyView = () => {
    const preset = scene.views[view];
    if (preset) renderer.setView(preset);
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
  const loop = (now: number) => {
    if (stopped) return;
    if (!paused) time += Math.min(Math.max(0, (now - last) / 1000), MAX_DT);
    last = now;
    try {
      renderer.frame(time);
    } catch (err) {
      fatal(err);
      return;
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return {
    resize(cssWidth, cssHeight, dpr) {
      const next = applySize(cssWidth, cssHeight, dpr);
      // The renderer refits a preset camera itself and leaves a user camera alone.
      renderer.resize(next.width, next.height, next.dpr);
    },
    setTheme: (next) => renderer.setTheme(next),
    setView(index) {
      view = index;
      applyView();
    },
    setPaused(next) {
      paused = next;
    },
    setDebug: (mode) => renderer.setDebug(mode),
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      device.removeEventListener('uncapturederror', onUncaptured);
      renderer.destroy();
    },
  };
}
