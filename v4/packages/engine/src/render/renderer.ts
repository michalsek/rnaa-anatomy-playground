/**
 * The M1 renderer: one merged mesh pulled from storage buffers, one pipeline (fills with
 * in-face lines), one MSAA pass with depth, resolved into the canvas. One encoder and one
 * submit per frame. Host-agnostic: it receives the TypeGPU root (which owns the device), a
 * configured canvas context, its format, size and DPR.
 */
import { d, type TgpuRoot } from 'typegpu';
import { mat4 } from 'wgpu-matrix';
import { DEV, PLATFORM, log } from '#platform/env.ts';
import {
  type CameraState,
  type ViewPreset,
  type Viewport,
  basisOf,
  cameraMatrices,
  createCameraMatrices,
  fitToBounds,
  viewCamera,
} from '../camera/camera.ts';
import { triangleCount, vertexCount } from '../geo/mesh.ts';
import { buildTopology } from '../geo/topology.ts';
import {
  MATERIALS,
  PAPER,
  SLOT,
  SLOT_COUNT,
  type Theme,
  hexToRgb,
  paletteTable,
} from '../palette/tokens.ts';
import { type LineSetSpec, type SceneSpec, partMatrix } from '../scene/m1.ts';
import {
  Frame,
  GpuTri,
  GpuVertex,
  LineSet,
  Part,
  packTriangles,
  packVertices,
  sceneLayout,
} from './schemas.ts';
import { fillFragment, fillVertex } from './shaders.ts';

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
 * green), 2 = lines off. */
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
  scene: SceneSpec;
  theme: Theme;
}

export interface Renderer {
  /**
   * Size in device pixels. The camera state (target, zoom in CSS px per unit) is kept, so a
   * user's view survives; call `fit()` or `setView()` to refit.
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
  /** Render one frame; `time` in seconds drives the spins. Plain function: no React, no DOM. */
  frame(time: number): void;
  destroy(): void;
}

export function createRenderer(options: RendererOptions): Renderer {
  const { root, context, format, scene } = options;
  const device = root.device;
  const { mesh } = scene;
  const topology = buildTopology(mesh);
  const triCount = triangleCount(mesh);
  const vCount = vertexCount(mesh);

  // ---- resources -------------------------------------------------------------------------
  const frameBuffer = root.createBuffer(Frame).$usage('uniform');
  const vertices = root.createBuffer(d.arrayOf(GpuVertex, vCount)).$usage('storage');
  vertices.write(packVertices(mesh));
  const tris = root.createBuffer(d.arrayOf(GpuTri, triCount)).$usage('storage');
  tris.write(packTriangles(mesh, topology));
  const parts = root.createBuffer(d.arrayOf(Part, scene.parts.length)).$usage('storage');
  const lineSetCount = Math.max(1, scene.lineSets.length);
  const lineSets = root.createBuffer(d.arrayOf(LineSet, lineSetCount)).$usage('storage');
  const palette = root
    .createBuffer(d.arrayOf(d.vec4f, MATERIALS.length * SLOT_COUNT))
    .$usage('storage');
  const owned = [frameBuffer, vertices, tris, parts, lineSets, palette];

  lineSets.write(
    (scene.lineSets.length ? scene.lineSets : [NO_LINES]).map((s) => ({
      count: s.count,
      phase: s.phase,
      first: s.first,
      last: s.last,
      majorEvery: s.majorEvery,
      minorSlot: SLOT[s.minor],
      majorSlot: SLOT[s.major],
      width: s.width,
      majorWidth: s.majorWidth,
      fade: d.vec2f(...s.fade),
    })),
  );

  const bindGroup = root.createBindGroup(sceneLayout, {
    frame: frameBuffer,
    vertices,
    tris,
    parts,
    lineSets,
    palette,
  });

  const pipeline = root
    .createRenderPipeline({
      vertex: fillVertex,
      fragment: fillFragment,
      targets: { format },
      // Solids are closed and wound CCW from outside; the kit's projection is mirrored, so
      // front faces are clockwise on screen.
      primitive: { topology: 'triangle-list', frontFace: 'cw', cullMode: 'back' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
      multisample: { count: SAMPLES },
    })
    .with(bindGroup);

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

  // ---- state -----------------------------------------------------------------------------
  const viewport: Viewport = { width: options.width, height: options.height, dpr: options.dpr };
  let camera: CameraState = fitToBounds(scene.bounds, viewport);
  let debug: DebugMode = 0;
  const matrices = createCameraMatrices();
  let clear: [number, number, number, number] = [0, 0, 0, 1];
  const rest = scene.parts.map((p) => partMatrix(p));
  const model = mat4.identity();

  const setTheme = (theme: Theme) => {
    palette.write(paletteTable(theme));
    clear = [...hexToRgb(PAPER[theme]), 1];
  };
  setTheme(options.theme);
  if (DEV) {
    log(`[engine] renderer up on ${PLATFORM}: ${vCount} vertices, ${triCount} triangles, ${format}`);
  }

  const resize = (width: number, height: number, dpr: number) => {
    viewport.width = Math.max(1, Math.round(width));
    viewport.height = Math.max(1, Math.round(height));
    viewport.dpr = dpr;
  };
  const fit = () => {
    camera = fitToBounds(scene.bounds, viewport, { yaw: camera.yaw, elevation: camera.elevation });
  };
  const copyCamera = (state: CameraState): CameraState => ({
    ...state,
    target: [...state.target],
  });

  const frame = (time: number) => {
    // A hidden or collapsed canvas has no pixels (the web host sizes it from its own layout);
    // asking for its texture would raise a validation error, so skip until it has some.
    if (context.canvas.width === 0 || context.canvas.height === 0) return;
    const texture = context.getCurrentTexture();
    // The canvas may have been resized by the host since the last layout; trust the texture.
    if (texture.width !== viewport.width || texture.height !== viewport.height) {
      resize(texture.width, texture.height, viewport.dpr);
    }
    const { color, depth } = ensureTargets(texture.width, texture.height);

    cameraMatrices(camera, viewport, 1000, matrices);
    // Line widths scale with zoom like a pinch-zoomed SVG: 1 CSS px at the fit zoom.
    const fitZoom = fitToBounds(scene.bounds, viewport, {
      yaw: camera.yaw,
      elevation: camera.elevation,
    }).zoom;
    frameBuffer.write({
      viewProjection: matrices.viewProjection,
      light: d.vec3f(...matrices.light),
      toward: d.vec3f(...basisOf(camera.yaw, camera.elevation).toward),
      viewport: d.vec2f(viewport.width, viewport.height),
      pxPerCss: (viewport.dpr * camera.zoom) / fitZoom,
      debug,
    });
    parts.write(
      scene.parts.map((p, index) => {
        mat4.rotateZ(rest[index]!, time * p.spin, model);
        return {
          model: mat4.clone(model),
          material: p.material,
          outlineSlot: SLOT[p.outline],
          creaseSlot: SLOT[p.crease],
          width: p.width,
        };
      }),
    );

    const encoder = device.createCommandEncoder();
    pipeline
      .with(encoder)
      .withColorAttachment({
        view: color.createView(),
        resolveTarget: texture.createView(),
        clearValue: clear,
        loadOp: 'clear',
        storeOp: 'discard',
      })
      .withDepthStencilAttachment({
        view: depth.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      })
      .draw(triCount * 3);
    device.queue.submit([encoder.finish()]);
    context.present?.();
  };

  return {
    resize,
    fit,
    setView: (view) => {
      camera = viewCamera(scene.bounds, viewport, view);
    },
    getCamera: () => copyCamera(camera),
    setCamera: (state) => {
      camera = copyCamera(state);
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
      for (const buffer of owned) buffer.destroy();
    },
  };
}
