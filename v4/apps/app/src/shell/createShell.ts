// Adapted from BoneTideOSS (MIT, Konrad Reczko), `createGameShell.ts`: a plain JS-thread
// rAF loop that calls the engine's frame() (one submit) followed by `context.present?.()`.
import type { TgpuRoot } from 'typegpu';
import {
  type CanvasContext,
  type Theme,
  createRenderer,
  m0Scene,
} from '@anatomy/engine';

export interface CanvasLike {
  width: number;
  height: number;
}

export interface Shell {
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  setTheme(theme: Theme): void;
  stop(): void;
}

export function createShell(
  root: TgpuRoot,
  context: CanvasContext,
  canvas: CanvasLike,
  format: GPUTextureFormat,
  size: { width: number; height: number; dpr: number },
  theme: Theme,
  onFatal: (message: string) => void,
): Shell {
  let stopped = false;
  const fatal = (reason: unknown) => {
    if (stopped) return;
    stopped = true;
    onFatal(reason instanceof Error ? reason.message : String(reason));
  };
  void root.device.lost.then((info) => fatal(`device lost: ${info.message || info.reason}`));
  root.device.addEventListener('uncapturederror', (event) => fatal(event.error.message));

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
    scene: m0Scene(),
    theme,
  });

  const start = performance.now();
  let raf = 0;
  const loop = (now: number) => {
    if (stopped) return;
    try {
      renderer.frame((now - start) / 1000);
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
      renderer.resize(next.width, next.height, next.dpr);
    },
    setTheme: (next) => renderer.setTheme(next),
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      renderer.destroy();
    },
  };
}
