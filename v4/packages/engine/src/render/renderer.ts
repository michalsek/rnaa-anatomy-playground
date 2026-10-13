/**
 * The M0 renderer: one merged mesh, one pipeline, one MSAA pass with depth, resolved into the
 * canvas. One encoder and one submit per frame. Host-agnostic: it receives the TypeGPU root
 * (which owns the device), a configured canvas context, its format, size and DPR.
 */
import tgpu, { d, std, type TgpuRoot } from 'typegpu';
import { mat4 } from 'wgpu-matrix';
import { DEV, PLATFORM, log } from '#platform/env.ts';
import {
  type CameraState,
  type Viewport,
  cameraMatrices,
  createCameraMatrices,
  fitToBounds,
} from '../camera/camera.ts';
import { vertexCount } from '../geo/mesh.ts';
import {
  MATERIALS,
  PAPER,
  SLOT_COUNT,
  type Theme,
  hexToRgb,
  paletteTable,
} from '../palette/tokens.ts';
import type { SceneSpec } from '../scene/m0.ts';
import { toneOf, toneSlot } from '../shading/tone.ts';

const SAMPLES = 4;
/** `GPUTextureUsage.RENDER_ATTACHMENT`; the literal avoids relying on a host global. */
const RENDER_ATTACHMENT = 0x10;
const DEPTH_FORMAT = 'depth24plus';

const Frame = d.struct({
  viewProjection: d.mat4x4f,
  light: d.vec3f,
});

const Part = d.struct({
  model: d.mat4x4f,
  material: d.u32,
});

const Vertex = d.unstruct({
  position: d.float32x3,
  normal: d.float32x3,
  part: d.uint32,
});
const VERTEX_FLOATS = 7;

/** A canvas context; react-native-webgpu adds `present()`, which must follow each submit. */
export type CanvasContext = GPUCanvasContext & { present?: () => void };

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
  /** Size in device pixels; the camera refits to the scene. */
  resize(width: number, height: number, dpr: number): void;
  setTheme(theme: Theme): void;
  /** Render one frame; `time` in seconds. Plain function: no React, no DOM. */
  frame(time: number): void;
  destroy(): void;
}

export function createRenderer(options: RendererOptions): Renderer {
  const { root, context, format, scene } = options;
  const device = root.device;
  const { mesh } = scene;

  // ---- resources -------------------------------------------------------------------------
  const frameUniform = root.createUniform(Frame);
  const parts = root.createReadonly(d.arrayOf(Part, scene.parts.length));
  const palette = root.createReadonly(d.arrayOf(d.vec4f, MATERIALS.length * SLOT_COUNT));

  const vertexLayout = tgpu.vertexLayout(d.disarrayOf(Vertex));
  const vCount = vertexCount(mesh);
  const interleaved = new Float32Array(vCount * VERTEX_FLOATS);
  const asU32 = new Uint32Array(interleaved.buffer);
  for (let v = 0; v < vCount; v++) {
    const o = v * VERTEX_FLOATS;
    interleaved.set(mesh.positions.subarray(v * 3, v * 3 + 3), o);
    interleaved.set(mesh.normals.subarray(v * 3, v * 3 + 3), o + 3);
    asU32[o + 6] = mesh.parts[v]!;
  }
  const vertexBuffer = root.createBuffer(vertexLayout.schemaForCount(vCount)).$usage('vertex');
  vertexBuffer.write(interleaved.buffer);
  const indexBuffer = root.createBuffer(d.arrayOf(d.u32, mesh.indices.length)).$usage('index');
  indexBuffer.write(mesh.indices);

  // ---- shaders ---------------------------------------------------------------------------
  const vertex = tgpu.vertexFn({
    in: { position: d.vec3f, normal: d.vec3f, part: d.u32 },
    out: {
      clip: d.builtin.position,
      normal: d.vec3f,
      material: d.interpolate('flat', d.u32),
    },
  })((input) => {
    'use gpu';
    const part = parts.$[input.part];
    const world = std.mul(part.model, d.vec4f(input.position, 1));
    const normal = std.mul(part.model, d.vec4f(input.normal, 0)).xyz;
    return {
      clip: std.mul(frameUniform.$.viewProjection, world),
      normal,
      material: part.material,
    };
  });

  const fragment = tgpu.fragmentFn({
    in: { normal: d.vec3f, material: d.interpolate('flat', d.u32) },
    out: d.vec4f,
  })((input) => {
    'use gpu';
    const tone = toneOf(input.normal, frameUniform.$.light);
    return palette.$[input.material * SLOT_COUNT + toneSlot(tone)];
  });

  const pipeline = root
    .createRenderPipeline({
      attribs: vertexLayout.attrib,
      vertex,
      fragment,
      targets: { format },
      // The kit's projection is mirrored, so winding flips on screen; solids are closed and
      // depth-tested, so no culling is needed for M0.
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
      multisample: { count: SAMPLES },
    })
    .with(vertexLayout, vertexBuffer)
    .withIndexBuffer(indexBuffer);

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
  const matrices = createCameraMatrices();
  let clear: [number, number, number, number] = [0, 0, 0, 1];
  const model = mat4.identity();

  const setTheme = (theme: Theme) => {
    palette.write(paletteTable(theme));
    clear = [...hexToRgb(PAPER[theme]), 1];
  };
  setTheme(options.theme);
  if (DEV) log(`[engine] renderer up on ${PLATFORM}: ${vCount} vertices, ${format}`);

  parts.write(
    scene.parts.map((p) => ({
      model: mat4.translation(p.position),
      material: p.material,
    })),
  );

  const resize = (width: number, height: number, dpr: number) => {
    viewport.width = Math.max(1, Math.round(width));
    viewport.height = Math.max(1, Math.round(height));
    viewport.dpr = dpr;
    camera = fitToBounds(scene.bounds, viewport);
  };

  const frame = (time: number) => {
    const texture = context.getCurrentTexture();
    // The canvas may have been resized by the host since the last layout; trust the texture.
    if (texture.width !== viewport.width || texture.height !== viewport.height) {
      resize(texture.width, texture.height, viewport.dpr);
    }
    const { color, depth } = ensureTargets(texture.width, texture.height);

    cameraMatrices(camera, viewport, 1000, matrices);
    frameUniform.write({ viewProjection: matrices.viewProjection, light: matrices.light });
    scene.parts.forEach((p, index) => {
      if (p.spin === 0) return;
      mat4.translation(p.position, model);
      mat4.rotateZ(model, time * p.spin, model);
      parts.patch({ [index]: { model } });
    });

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
      .drawIndexed(mesh.indices.length);
    device.queue.submit([encoder.finish()]);
    context.present?.();
  };

  return {
    resize,
    setTheme,
    frame,
    destroy() {
      targets?.color.destroy();
      targets?.depth.destroy();
      targets = null;
    },
  };
}
