/**
 * The renderer: reads a SceneStore, rebuilds its GPU buffers when the store's structure changes,
 * uploads the instance table when something moved, and draws one MSAA pass with depth (fill
 * batches with in-face lines, then marks) resolved into the canvas. One encoder and one submit
 * per frame. Host-agnostic: it receives the TypeGPU root (which owns the device), a configured
 * canvas context, its format, size and DPR.
 */
import { d, type TgpuRoot } from 'typegpu';
import { DEV, PLATFORM, log, now } from '#platform/env.ts';
import {
  type Bounds,
  type CameraState,
  type FrameSpec,
  type ViewPreset,
  type Viewport,
  basisOf,
  cameraMatrices,
  createCameraMatrices,
  fitToBounds,
  viewCamera,
} from '../camera/camera.ts';
import type { LineSetSpec } from '../geo/spec.ts';
import { FX, LINE_GAIN, PALETTE_SIZE, PAPER, SLOT, type Theme, hexToRgb, paletteTable } from '../palette/tokens.ts';
import type { SceneBuild, SceneStore } from '../scene/store.ts';
import {
  Frame,
  GpuTri,
  GpuVertex,
  Gradient,
  Instance,
  LINE_KIND,
  LineSet,
  Mark,
  INSTANCE_FLOATS,
  SIZES,
  Sprite,
  Style,
  assertLayouts,
  sceneLayout,
  spriteLayout,
} from './schemas.ts';
import { createCameraEase } from '../camera/ease.ts';
import { fillFragment, fillVertex, marksFragment, marksVertex, spriteFragment, spriteVertex } from './shaders.ts';

const SAMPLES = 4;
/** No clip volume: a huge box. */
const NO_CLIP_LO = [-1e9, -1e9, -1e9, 0];
const NO_CLIP_HI = [1e9, 1e9, 1e9, 1e9];
/** `GPUTextureUsage.RENDER_ATTACHMENT`; the literal avoids relying on a host global. */
const RENDER_ATTACHMENT = 0x10;
const DEPTH_FORMAT = 'depth24plus';
/** Placeholder so the line-set table is never empty (draws nothing: last < first). */
const NO_LINES: LineSetSpec = {
  count: 1, phase: 0, first: 0, last: -1, majorEvery: 0,
  minor: 'lo', major: 'lo', width: 0, majorWidth: 0, fade: [0, 0],
};

/** 0 = normal, 1 = line classes on paper (outline red, contour magenta, crease blue, ticks
 * green, marks cyan), 2 = lines off. */
export type DebugMode = 0 | 1 | 2;

/**
 * A canvas context; react-native-webgpu adds `present()`, which must follow each submit. The
 * engine is built without the DOM lib, so the canvas is typed by the two fields it reads.
 */
export type CanvasContext = GPUCanvasContext & {
  present?: () => void;
  readonly canvas: { width: number; height: number };
};

export interface RendererOptions {
  root: TgpuRoot;
  context: CanvasContext;
  format: GPUTextureFormat;
  /** Initial size in device pixels and the device pixel ratio. */
  width: number;
  height: number;
  dpr: number;
  store: SceneStore;
  theme: Theme;
}

export interface Renderer {
  /**
   * Size in device pixels. A preset (or fit) camera is refitted to the new size; a camera set
   * with `setCamera()` is kept as it is.
   */
  resize(width: number, height: number, dpr: number): void;
  /** Fit the scene bounds into the current viewport, keeping the camera's yaw and elevation. */
  fit(): void;
  /**
   * Camera for a view preset (zoom relative to the fit at the preset's angles); `ease`: settle
   * there from the current camera (critically damped, `camera/ease.ts`) instead of cutting.
   */
  setView(view: ViewPreset, o?: { ease?: boolean }): void;
  /**
   * Where fits go (CSS px pads from the canvas edges, an optional aspect: `frameRect`). A preset
   * camera is refitted; the canvas keeps its size (overlays change the pads, never the canvas).
   */
  setFrame(frame: FrameSpec): void;

  getCamera(): CameraState;
  /**
   * A free camera (orbit, pan, zoom; kept over resizes until the next view); `ease`: settle there
   * from the current camera (scripts: any yaw, elevation and zoom).
   */
  setCamera(state: CameraState, o?: { ease?: boolean }): void;
  /** The line-width reference zoom: the fit at the view's angles (orbit's zoom limits are relative to it). */
  refZoom(): number;
  /** The camera a view preset would get now (nothing changes; M12's scripted moves). */
  cameraFor(view: ViewPreset): CameraState;
  /**
   * M12 (film): the clock eased moves read (ms), instead of `performance.now()`; null restores it.
   * A frame-stepped capture feeds its own clock so the eases are deterministic.
   */
  setClock(clock: (() => number) | null): void;
  /**
   * M12 (film): line widths `dpr · scale · zoom / ref` with a pinned reference zoom (lines in
   * proportion to the film's band on every device); null restores the view's reference.
   */
  setLines(lines: { scale: number; ref: number } | null): void;
  setDebug(mode: DebugMode): void;
  setTheme(theme: Theme): void;
  /**
   * DEV: per-frame CPU cost of the last frames (ms): `flatten` (+ upload) and `frame` (the
   * whole call), the bytes uploaded per frame, and the last build's stats.
   */
  perf(): RendererPerf;
  /** Render one frame. Plain function: no React, no DOM. */
  frame(): void;
  destroy(): void;
}

export interface RendererPerf {
  frames: number;
  flattenMs: { median: number; p95: number };
  frameMs: { median: number; p95: number };
  bytesPerFrame: number;
  build: SceneBuild['stats'] | null;
  buildMs: number;
  /** The size of the texture the last frame drew into (0 × 0 before the first frame). */
  texture: { width: number; height: number };
}

const PERF_N = 600;
const quantiles = (a: Float32Array, n: number) => {
  const v = Array.from(a.subarray(0, n)).sort((x, y) => x - y);
  return { median: v[Math.floor(n / 2)] ?? 0, p95: v[Math.floor(n * 0.95)] ?? 0 };
};

function lineSetData(s: LineSetSpec) {
  return {
    count: s.count,
    phase: s.phase,
    first: s.first,
    last: s.last,
    majorEvery: s.majorEvery,
    minorSlot: SLOT[s.minor],
    majorSlot: SLOT[s.major],
    width: s.width,
    majorWidth: s.majorWidth,
    fade: d.vec2f(s.fade[0], s.fade[1]),
    kind: LINE_KIND[s.kind ?? 'lines'],
    duty: s.duty ?? 0.5,
    fill: FX[s.fill ?? 'strobe'],
    slant: s.kind === 'stripes' ? (s.slant ?? 1) : 0,
  };
}

export function createRenderer(options: RendererOptions): Renderer {
  const { root, context, format, store } = options;
  const device = root.device;
  assertLayouts();

  // ---- static resources --------------------------------------------------------------------
  const frameBuffer = root.createBuffer(Frame).$usage('uniform');
  // The frame uniform is written from one preallocated block each frame (no object per frame).
  const frameData = new ArrayBuffer(d.sizeOf(Frame));
  const frameF32 = new Float32Array(frameData);
  const frameU32 = new Uint32Array(frameData);
  const word = (pick: (f: d.Infer<typeof Frame>) => unknown) => d.memoryLayoutOf(Frame, pick).offset / 4;
  const FW = {
    viewProjection: word((f) => f.viewProjection),
    light: word((f) => f.light),
    toward: word((f) => f.toward),
    right: word((f) => f.right),
    up: word((f) => f.up),
    viewport: word((f) => f.viewport),
    pxPerCss: word((f) => f.pxPerCss),
    pxPerUnit: word((f) => f.pxPerUnit),
    debug: word((f) => f.debug),
    paper: word((f) => f.paper),
    lineGain: word((f) => f.lineGain),
    clipLo: word((f) => f.clipLo),
    clipHi: word((f) => f.clipHi),
  };
  const palette = root
    .createBuffer(d.arrayOf(d.vec4f, PALETTE_SIZE))
    .$usage('storage');

  const fillPipeline = root.createRenderPipeline({
    vertex: fillVertex,
    fragment: fillFragment,
    targets: { format },
    // Solids are closed and wound CCW from outside; the kit's projection is mirrored, so
    // front faces are clockwise on screen.
    primitive: { topology: 'triangle-list', frontFace: 'cw', cullMode: 'back' },
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    multisample: { count: SAMPLES },
  });
  // Open meshes (pipes without caps): no culling, the fragment shades inner walls as a void.
  const openPipeline = root.createRenderPipeline({
    vertex: fillVertex,
    fragment: fillFragment,
    targets: { format },
    primitive: { topology: 'triangle-list', frontFace: 'cw', cullMode: 'none' },
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    multisample: { count: SAMPLES },
  });
  const marksPipeline = root.createRenderPipeline({
    vertex: marksVertex,
    fragment: marksFragment,
    targets: {
      format,
      blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      },
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'less-equal' },
    multisample: { count: SAMPLES },
  });

  // Sprites: premultiplied, depth-tested, no depth write. `glow` sprites blend multiply on
  // light and screen on dark (v2's `.cf-glow`); everything else is premultiplied over.
  const spritePipeline = (color: GPUBlendComponent) =>
    root.createRenderPipeline({
      vertex: spriteVertex,
      fragment: spriteFragment,
      targets: {
        format,
        blend: { color, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } },
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'less-equal' },
      multisample: { count: SAMPLES },
    });
  const spriteNormal = spritePipeline({ srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' });
  const spriteMultiply = spritePipeline({ srcFactor: 'dst', dstFactor: 'one-minus-src-alpha', operation: 'add' });
  const spriteScreen = spritePipeline({ srcFactor: 'one-minus-dst', dstFactor: 'one', operation: 'add' });

  // ---- scene resources (rebuilt when the store's structure changes) --------------------------
  type SceneGpu = {
    version: number;
    build: SceneBuild;
    owned: { destroy(): void }[];
    instances: ReturnType<typeof makeInstances>;
    sprites: ReturnType<typeof makeSprites>;
    fill: typeof fillPipeline;
    open: typeof openPipeline;
    marks: typeof marksPipeline;
    spriteNormal: typeof spriteNormal;
    spriteMultiply: typeof spriteMultiply;
    spriteScreen: typeof spriteScreen;
  };
  const makeSprites = (count: number) =>
    root.createBuffer(d.arrayOf(Sprite, Math.max(1, count))).$usage('storage');
  const makeInstances = (count: number) =>
    root.createBuffer(d.arrayOf(Instance, Math.max(1, count))).$usage('storage');
  let scene: SceneGpu | null = null;
  // DEV perf ring.
  const flattenRing = new Float32Array(PERF_N);
  const frameRing = new Float32Array(PERF_N);
  let perfFrames = 0;
  let uploaded = 0;
  let buildMs = 0;

  const rebuild = () => {
    const t0 = now();
    const build = store.build();
    const t1 = now();
    for (const r of scene?.owned ?? []) r.destroy();
    const vertices = root.createBuffer(d.arrayOf(GpuVertex, Math.max(1, build.vertexCount))).$usage('storage');
    if (build.vertexCount) vertices.write(build.vertices.buffer as ArrayBuffer);
    const tris = root.createBuffer(d.arrayOf(GpuTri, Math.max(1, build.triCount))).$usage('storage');
    if (build.triCount) tris.write(build.tris);
    const instances = makeInstances(build.instanceCount);
    const styles = root.createBuffer(d.arrayOf(Style, Math.max(1, build.styleCount))).$usage('storage');
    styles.write(build.styles);
    const sets = build.lineSets.length ? build.lineSets : [NO_LINES];
    const lineSets = root.createBuffer(d.arrayOf(LineSet, sets.length)).$usage('storage');
    lineSets.write(sets.map(lineSetData));
    const marks = root.createBuffer(d.arrayOf(Mark, Math.max(1, build.markCount))).$usage('storage');
    marks.write(build.marks);
    const gradients = root.createBuffer(d.arrayOf(Gradient, Math.max(1, build.gradientCount))).$usage('storage');
    gradients.write(build.gradients);
    const sprites = makeSprites(build.spriteCount);
    const bindGroup = root.createBindGroup(sceneLayout, {
      frame: frameBuffer,
      vertices,
      tris,
      instances,
      styles,
      lineSets,
      palette,
      marks,
      gradients,
    });
    const spriteGroup = root.createBindGroup(spriteLayout, { frame: frameBuffer, instances, palette, sprites });
    const boundsChanged = !scene || !sameBounds(scene.build.bounds, build.bounds);
    scene = {
      version: store.version,
      build,
      owned: [vertices, tris, instances, styles, lineSets, marks, gradients, sprites],
      instances,
      sprites,
      fill: fillPipeline.with(bindGroup),
      open: openPipeline.with(bindGroup),
      marks: marksPipeline.with(bindGroup),
      spriteNormal: spriteNormal.with(spriteGroup),
      spriteMultiply: spriteMultiply.with(spriteGroup),
      spriteScreen: spriteScreen.with(spriteGroup),
    };
    if (boundsChanged && onPreset) applyPreset();
    buildMs = now() - t0;
    if (DEV) {
      const s = build.stats;
      const phases = Object.entries({ ...build.timings, upload: now() - t1 })
        .map(([k, ms]) => `${k} ${ms.toFixed(1)}`)
        .join(', ');
      log(
        `[engine] scene built in ${(now() - t0).toFixed(1)} ms on ${PLATFORM} (${phases}): ${s.triangles} triangles, ` +
          `${build.vertexCount} vertices, ${s.parts} parts, ${s.pools} pools, ${s.instances} instances, ` +
          `${s.marks} marks (${s.contacts} contact segments), ${s.sprites} sprites, ${build.batches.length} batches`,
      );
    }
  };

  // ---- per-size targets ------------------------------------------------------------------
  let targets: { width: number; height: number; color: GPUTexture; depth: GPUTexture } | null =
    null;
  const ensureTargets = (width: number, height: number) => {
    if (targets && targets.width === width && targets.height === height) return targets;
    targets?.color.destroy();
    targets?.depth.destroy();
    const common = { size: [width, height], sampleCount: SAMPLES, usage: RENDER_ATTACHMENT };
    targets = {
      width,
      height,
      color: device.createTexture({ ...common, format }),
      depth: device.createTexture({ ...common, format: DEPTH_FORMAT }),
    };
    return targets;
  };

  // ---- camera ------------------------------------------------------------------------------
  const viewport: Viewport = { width: options.width, height: options.height, dpr: options.dpr };
  let bounds: Bounds = { min: [-1, -1, -1], max: [1, 1, 1] };
  let camera: CameraState = fitToBounds(bounds, viewport);
  // True while the camera is a preset's (or the fit); a user camera survives resizes.
  let onPreset = true;
  let preset: ViewPreset | null = null;
  // Line widths scale with zoom relative to the fit zoom, cached per view and resize so they
  // stay put while orbiting.
  let refZoom = camera.zoom;
  let debug: DebugMode = 0;
  let theme: Theme = options.theme;
  const matrices = createCameraMatrices();
  // The camera basis, recomputed only when the angles change.
  let basis: ReturnType<typeof basisOf> | null = null;
  let basisYaw = NaN;
  let basisElevation = NaN;
  let clear: [number, number, number, number] = [0, 0, 0, 1];
  const clipLo = new Float32Array(NO_CLIP_LO);
  const clipHi = new Float32Array(NO_CLIP_HI);

  let frameSpec: FrameSpec = {};
  const fitZoomNow = () =>
    fitToBounds(bounds, viewport, { ...frameSpec, yaw: camera.yaw, elevation: camera.elevation }).zoom;
  // Eased view changes: the goal is the preset's camera; `camera` moves toward it each frame.
  const ease = createCameraEase();
  let easing = false;
  let easeLast = 0;
  // M12 (film): an injected clock and pinned line widths (null: today's behaviour).
  let clock: (() => number) | null = null;
  const easeNow = () => (clock ? clock() : now());
  let lines: { scale: number; ref: number } | null = null;
  function applyPreset() {
    // A refit (resize, rebuild, new frame) cuts to the preset: no easing toward a stale goal.
    easing = false;
    ease.cancel();
    if (scene) bounds = scene.build.bounds;
    camera = preset
      ? viewCamera(bounds, viewport, preset, frameSpec)
      : fitToBounds(bounds, viewport, { ...frameSpec, yaw: camera.yaw, elevation: camera.elevation });
    onPreset = true;
    refZoom = fitZoomNow();
  }

  const setTheme = (next: Theme) => {
    theme = next;
    palette.write(paletteTable(next));
    clear = [...hexToRgb(PAPER[next]), 1];
  };
  setTheme(options.theme);
  if (DEV) log(`[engine] renderer up on ${PLATFORM}: ${format}`);

  const resize = (width: number, height: number, dpr: number) => {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w === viewport.width && h === viewport.height && dpr === viewport.dpr) return;
    viewport.width = w;
    viewport.height = h;
    viewport.dpr = dpr;
    if (onPreset) applyPreset();
    else refZoom = fitZoomNow();
  };
  const copyCamera = (state: CameraState): CameraState => ({
    ...state,
    target: [...state.target],
  });

  const lastTexture = { width: 0, height: 0 };
  const frame = () => {
    const f0 = DEV ? now() : 0;
    if (!scene || scene.version !== store.version) rebuild();
    const s = scene!;
    // A hidden or collapsed canvas has no pixels (the web host sizes it from its own layout);
    // asking for its texture would raise a validation error, so skip until it has some.
    if (context.canvas.width === 0 || context.canvas.height === 0) return;
    const texture = context.getCurrentTexture();
    lastTexture.width = texture.width;
    lastTexture.height = texture.height;
    // The canvas may have been resized by the host since the last layout; trust the texture.
    if (texture.width !== viewport.width || texture.height !== viewport.height) {
      resize(texture.width, texture.height, viewport.dpr);
    }
    const { color, depth } = ensureTargets(texture.width, texture.height);
    if (easing) {
      const t = easeNow();
      refZoom = ease.step(Math.min(0.1, Math.max(0, (t - easeLast) / 1000)), camera);
      easeLast = t;
      if (ease.done()) easing = false;
    }

    // E8: upload only the instances this frame rewrote (moving slots are packed last).
    const fl0 = DEV ? now() : 0;
    const flat = store.flatten();
    if (flat.dirty && flat.hi > flat.lo) {
      const lo = flat.lo * INSTANCE_FLOATS;
      device.queue.writeBuffer(s.instances.buffer, lo * 4, flat.f32, lo, (flat.hi - flat.lo) * INSTANCE_FLOATS);
      if (DEV) uploaded += (flat.hi - flat.lo) * SIZES.instance;
    }
    const f1 = DEV ? now() : 0;
    const sprites = store.sprites();
    if (sprites.dirty && sprites.count) s.sprites.write(sprites.buffer);

    cameraMatrices(camera, viewport, 1000, matrices);
    if (basis === null || basisYaw !== camera.yaw || basisElevation !== camera.elevation) {
      basis = basisOf(camera.yaw, camera.elevation);
      basisYaw = camera.yaw;
      basisElevation = camera.elevation;
    }
    frameF32.set(matrices.viewProjection, FW.viewProjection);
    frameF32.set(matrices.light, FW.light);
    frameF32.set(basis.toward, FW.toward);
    frameF32.set(basis.right, FW.right);
    frameF32.set(basis.up, FW.up);
    frameF32[FW.viewport] = viewport.width;
    frameF32[FW.viewport + 1] = viewport.height;
    // Line widths scale with zoom like a pinch-zoomed SVG: 1 CSS px at the fit zoom.
    frameF32[FW.pxPerCss] = lines ? viewport.dpr * lines.scale * (camera.zoom / lines.ref) : viewport.dpr * (camera.zoom / refZoom);
    frameF32[FW.pxPerUnit] = viewport.dpr * camera.zoom;
    frameU32[FW.debug] = debug;
    frameF32.set(clear, FW.paper);
    frameF32[FW.lineGain] = LINE_GAIN[theme];
    // The store's clip volume (machines in the factory's case), else none.
    const cv = store.clipVolume;
    if (cv) {
      clipLo[0] = cv.lo[0];
      clipLo[1] = cv.lo[1];
      clipLo[2] = cv.lo[2];
      clipLo[3] = cv.r;
      clipHi[0] = cv.hi[0];
      clipHi[1] = cv.hi[1];
      clipHi[2] = cv.hi[2];
      clipHi[3] = cv.band;
    } else {
      clipLo.set(NO_CLIP_LO);
      clipHi.set(NO_CLIP_HI);
    }
    frameF32.set(clipLo, FW.clipLo);
    frameF32.set(clipHi, FW.clipHi);
    frameBuffer.write(frameData);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: color.createView(),
          resolveTarget: texture.createView(),
          clearValue: clear,
          loadOp: 'clear',
          storeOp: 'discard',
        },
      ],
      depthStencilAttachment: {
        view: depth.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    });
    for (const b of s.build.batches) {
      const count = b.pool === null ? 1 : store.poolCount(b.pool);
      if (count > 0 && b.triCount > 0) {
        (b.open ? s.open : s.fill).with(pass).draw(b.triCount * 3, count, b.firstTri * 3, b.firstInstance);
      }
    }
    if (s.build.markCount > 0 && debug !== 2) s.marks.with(pass).draw(6, s.build.markCount);
    const [nFirst, nCount] = s.build.spriteRanges.normal;
    if (nCount > 0) s.spriteNormal.with(pass).draw(6, nCount, 0, nFirst);
    const [gFirst, gCount] = s.build.spriteRanges.glow;
    if (gCount > 0) (theme === 'dark' ? s.spriteScreen : s.spriteMultiply).with(pass).draw(6, gCount, 0, gFirst);
    pass.end();
    device.queue.submit([encoder.finish()]);
    context.present?.();
    if (DEV) {
      const k = perfFrames++ % PERF_N;
      flattenRing[k] = f1 - fl0;
      frameRing[k] = now() - f0;
    }
  };

  return {
    resize,
    fit: () => {
      preset = null;
      applyPreset();
    },
    setView: (view, o) => {
      const from = copyCamera(camera);
      const fromRef = refZoom;
      preset = view;
      applyPreset();
      if (o?.ease && scene) {
        ease.to(from, fromRef, camera, refZoom);
        camera = from;
        refZoom = fromRef;
        easing = true;
        easeLast = easeNow();
      }
    },
    setFrame: (frame) => {
      frameSpec = { ...frame };
      if (onPreset) applyPreset();
      else refZoom = fitZoomNow();
    },
    getCamera: () => copyCamera(camera),
    setCamera: (state, o) => {
      if (o?.ease && scene) {
        ease.to(camera, refZoom, state, refZoom);
        easing = true;
        easeLast = easeNow();
      } else {
        easing = false;
        ease.cancel();
        camera = copyCamera(state);
      }
      onPreset = false;
    },
    refZoom: () => refZoom,
    cameraFor: (view) => viewCamera(scene ? scene.build.bounds : bounds, viewport, view, frameSpec),
    setClock: (next) => {
      clock = next;
      easeLast = easeNow();
    },
    setLines: (next) => {
      lines = next ? { ...next } : null;
    },
    setDebug: (mode) => {
      debug = mode;
    },
    setTheme,
    frame,
    perf() {
      const n = Math.min(perfFrames, PERF_N);
      return {
        frames: perfFrames,
        flattenMs: quantiles(flattenRing, n),
        frameMs: quantiles(frameRing, n),
        bytesPerFrame: perfFrames ? uploaded / perfFrames : 0,
        build: scene?.build.stats ?? null,
        buildMs,
        texture: { ...lastTexture },
      };
    },
    destroy() {
      targets?.color.destroy();
      targets?.depth.destroy();
      targets = null;
      for (const r of scene?.owned ?? []) r.destroy();
      scene = null;
      frameBuffer.destroy();
      palette.destroy();
    },
  };
}

const sameBounds = (a: Bounds, b: Bounds) =>
  a.min.every((v, i) => v === b.min[i]) && a.max.every((v, i) => v === b.max[i]);
