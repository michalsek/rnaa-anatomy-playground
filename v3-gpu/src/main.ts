// Boot: find the canvas, load the scene, init TypeGPU, probe the palette, size to device pixels, draw on demand.
// window.__gpu is the tool surface (ready, frameStats, setShare, setTheme, simulateDeviceLoss).
import tgpu from 'typegpu';
import { resolveBackground, resolvePalette } from './palette.ts';
import { Renderer } from './renderer.ts';
import { sceneFromWire, type GpuScene } from './scene.ts';
import { sceneFromDl } from './dl-loader.ts';

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

function loadScene(): GpuScene {
  const wire = document.getElementById('gpu-scene');
  if (wire) return sceneFromWire(JSON.parse(wire.textContent!));
  const dl = document.getElementById('gpu-dl');
  if (dl) return sceneFromDl(JSON.parse(dl.textContent!), document.getElementById('gpu-dl-bin')!.textContent!.trim());
  throw new Error('no scene data on the page');
}

function showFallback(canvas: HTMLCanvasElement, reason: string) {
  api.error = reason;
  const template = document.getElementById('svg-fallback') as HTMLTemplateElement | null;
  if (template) canvas.replaceWith(template.content.cloneNode(true));
  document.documentElement.dataset.gpu = 'fallback';
}

async function main() {
  const canvas = document.querySelector('canvas[data-gpu]') as HTMLCanvasElement;
  const stage = canvas.parentElement!;
  if (!navigator.gpu) return showFallback(canvas, 'no-webgpu');
  const scene = loadScene();
  let renderer: Renderer | null = null;
  let root: Awaited<ReturnType<typeof tgpu.init>> | null = null;
  let reinits = 0;
  let size = { width: 0, height: 0, dpr: 1 };
  let pending = false;
  let intentionalLoss = false;
  let share = 0;

  const draw = () => {
    pending = false;
    if (!renderer) return;
    renderer.share = share;
    renderer.render();
    api.frames++;
  };
  const request = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(draw);
  };
  const probe = () => {
    if (!renderer) return;
    renderer.setPalette(resolvePalette(scene, stage), resolveBackground(stage));
    request();
  };

  async function start() {
    try {
      root = await tgpu.init({ device: { optionalFeatures: ['timestamp-query'] } });
    } catch (e) {
      return showFallback(canvas, `no-adapter: ${(e as Error).message}`);
    }
    const info = (root.device as any).adapterInfo ?? {};
    api.adapter = { vendor: info.vendor, architecture: info.architecture, description: info.description, features: [...root.enabledFeatures] };
    root.device.lost.then((lost) => {
      renderer = null;
      if (lost.reason === 'destroyed' && !intentionalLoss) return;
      intentionalLoss = false;
      reinits++;
      start().then(() => request());
    });
    root.device.addEventListener('uncapturederror', (e: any) => console.error('WebGPU:', e.error?.message ?? e));
    renderer = new Renderer(root, canvas, scene);
    if (size.width) renderer.resize(size.width, size.height, size.dpr);
    probe();
  }

  // Device pixels: devicePixelContentBoxSize is exact (snapped) on real displays, but under CDP device-metrics
  // emulation (capture.mjs / drive.mjs --scale) Chrome reports it in CSS px while devicePixelRatio is emulated, so
  // trust it only when it agrees with devicePixelRatio to within a pixel.
  const applySize = (cssW: number, cssH: number, dev?: { inlineSize: number; blockSize: number }) => {
    const ratio = devicePixelRatio || 1;
    const agrees = dev && Math.abs(dev.inlineSize - cssW * ratio) <= 1 && Math.abs(dev.blockSize - cssH * ratio) <= 1;
    const width = agrees ? dev!.inlineSize : Math.max(1, Math.round(cssW * ratio));
    const height = agrees ? dev!.blockSize : Math.max(1, Math.round(cssH * ratio));
    size = { width, height, dpr: width / cssW };
    renderer?.resize(width, height, size.dpr);
    request();
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

  api.frameStats = () => ({ ...(renderer?.stats ?? {}), reinits, width: size.width, height: size.height, dpr: size.dpr, share });
  api.setShare = (x: number) => { share = x; request(); };
  api.setTheme = (theme) => { document.body.dataset.theme = theme; probe(); };
  api.redraw = request;
  api.simulateDeviceLoss = () => { intentionalLoss = true; root?.device.destroy(); };

  await start();
  // Ready once the first frame has been submitted and presented.
  await new Promise<void>((resolve) => {
    const wait = () => (api.frames > 0 ? root!.device.queue.onSubmittedWorkDone().then(() => requestAnimationFrame(() => resolve())) : requestAnimationFrame(wait));
    wait();
  });
  api.ready = true;
  document.documentElement.dataset.gpu = 'ready';
}

main().catch((e) => {
  api.error = String(e?.stack ?? e);
  console.error(e);
});
