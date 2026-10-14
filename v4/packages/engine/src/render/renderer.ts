/**
 * The renderer: reads a SceneStore, rebuilds its GPU buffers when the store's structure changes,
 * uploads the instance table when something moved, and draws one MSAA pass with depth (fill
 * batches with in-face lines, then marks) resolved into the canvas. One encoder and one submit
 * per frame. Host-agnostic: it receives the TypeGPU root (which owns the device), a configured
 * canvas context, its format, size and DPR.
 */
import { d, type TgpuRoot } from 'typegpu';
import { DEV, PLATFORM, log } from '#platform/env.ts';
import {
  type Bounds,
  type CameraState,
  type ViewPreset,
  type Viewport,
  basisOf,
  cameraMatrices,
  createCameraMatrices,
  fitToBounds,
  viewCamera,
} from '../camera/camera.ts';
import type { LineSetSpec } from '../geo/spec.ts';
import { MATERIALS, PAPER, SLOT, SLOT_COUNT, type Theme, hexToRgb, paletteTable } from '../palette/tokens.ts';
import type { SceneBuild, SceneStore } from '../scene/store.ts';
import {
  Frame,
  GpuTri,
  GpuVertex,
  Instance,
  LineSet,
  Mark,
  Style,
  assertLayouts,
  sceneLayout,
} from './schemas.ts';
import { fillFragment, fillVertex, marksFragment, marksVertex } from './shaders.ts';

const SAMPLES = 4;
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
  /** Camera for a view preset (zoom relative to the fit at the preset's angles). */
  setView(view: ViewPreset): void;
  getCamera(): CameraState;
  setCamera(state: CameraState): void;
  setDebug(mode: DebugMode): void;
  setTheme(theme: Theme): void;
  /** Render one frame. Plain function: no React, no DOM. */
  frame(): void;
  destroy(): void;
}

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
  };
}

export function createRenderer(options: RendererOptions): Renderer {
  const { root, context, format, store } = options;
  const device = root.device;
  assertLayouts();

  // ---- static resources --------------------------------------------------------------------
  const frameBuffer = root.createBuffer(Frame).$usage('uniform');
  const palette = root
    .createBuffer(d.arrayOf(d.vec4f, MATERIALS.length * SLOT_COUNT))
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

  // ---- scene resources (rebuilt when the store's structure changes) --------------------------
  type SceneGpu = {
    version: number;
    build: SceneBuild;
    owned: { destroy(): void }[];
    instances: ReturnType<typeof makeInstances>;
    fill: typeof fillPipeline;
    marks: typeof marksPipeline;
  };
  const makeInstances = (count: number) =>
    root.createBuffer(d.arrayOf(Instance, Math.max(1, count))).$usage('storage');
  let scene: SceneGpu | null = null;

  const rebuild = () => {
    const t0 = Date.now();
    const build = store.build();
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
    const bindGroup = root.createBindGroup(sceneLayout, {
      frame: frameBuffer,
      vertices,
      tris,
      instances,
      styles,
      lineSets,
      palette,
      marks,
    });
    const boundsChanged = !scene || !sameBounds(scene.build.bounds, build.bounds);
    scene = {
      version: store.version,
      build,
      owned: [vertices, tris, instances, styles, lineSets, marks],
      instances,
      fill: fillPipeline.with(bindGroup),
      marks: marksPipeline.with(bindGroup),
    };
    if (boundsChanged && onPreset) applyPreset();
    if (DEV) {
      const s = build.stats;
      log(
        `[engine] scene built in ${Date.now() - t0} ms on ${PLATFORM}: ${s.triangles} triangles, ` +
          `${build.vertexCount} vertices, ${s.parts} parts, ${s.pools} pools, ${s.instances} instances, ` +
          `${s.marks} marks (${s.contacts} contact segments), ${build.batches.length} batches`,
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
  const matrices = createCameraMatrices();
  let clear: [number, number, number, number] = [0, 0, 0, 1];

  const fitZoomNow = () =>
    fitToBounds(bounds, viewport, { yaw: camera.yaw, elevation: camera.elevation }).zoom;
  function applyPreset() {
    if (scene) bounds = scene.build.bounds;
    camera = preset
      ? viewCamera(bounds, viewport, preset)
      : fitToBounds(bounds, viewport, { yaw: camera.yaw, elevation: camera.elevation });
    onPreset = true;
    refZoom = fitZoomNow();
  }

  const setTheme = (theme: Theme) => {
    palette.write(paletteTable(theme));
    clear = [...hexToRgb(PAPER[theme]), 1];
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

  const frame = () => {
    if (!scene || scene.version !== store.version) rebuild();
    const s = scene!;
    // A hidden or collapsed canvas has no pixels (the web host sizes it from its own layout);
    // asking for its texture would raise a validation error, so skip until it has some.
    if (context.canvas.width === 0 || context.canvas.height === 0) return;
    const texture = context.getCurrentTexture();
    // The canvas may have been resized by the host since the last layout; trust the texture.
    if (texture.width !== viewport.width || texture.height !== viewport.height) {
      resize(texture.width, texture.height, viewport.dpr);
    }
    const { color, depth } = ensureTargets(texture.width, texture.height);

    const flat = store.flatten();
    if (flat.dirty && flat.used) {
      s.instances.write(flat.f32.buffer as ArrayBuffer);
    }

    cameraMatrices(camera, viewport, 1000, matrices);
    const basis = basisOf(camera.yaw, camera.elevation);
    frameBuffer.write({
      viewProjection: matrices.viewProjection,
      light: d.vec3f(...matrices.light),
      toward: d.vec3f(...basis.toward),
      right: d.vec3f(...basis.right),
      up: d.vec3f(...basis.up),
      viewport: d.vec2f(viewport.width, viewport.height),
      // Line widths scale with zoom like a pinch-zoomed SVG: 1 CSS px at the fit zoom.
      pxPerCss: (viewport.dpr * camera.zoom) / refZoom,
      debug,
      paper: d.vec4f(...clear),
    });

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
    const fill = s.fill.with(pass);
    for (const b of s.build.batches) {
      const count = b.pool === null ? 1 : store.poolCount(b.pool);
      if (count > 0 && b.triCount > 0) fill.draw(b.triCount * 3, count, b.firstTri * 3, b.firstInstance);
    }
    if (s.build.markCount > 0 && debug !== 2) s.marks.with(pass).draw(6, s.build.markCount);
    pass.end();
    device.queue.submit([encoder.finish()]);
    context.present?.();
  };

  return {
    resize,
    fit: () => {
      preset = null;
      applyPreset();
    },
    setView: (view) => {
      preset = view;
      applyPreset();
    },
    getCamera: () => copyCamera(camera),
    setCamera: (state) => {
      camera = copyCamera(state);
      onPreset = false;
    },
    setDebug: (mode) => {
      debug = mode;
    },
    setTheme,
    frame,
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
