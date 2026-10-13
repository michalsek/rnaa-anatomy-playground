// Typed GPU resources shared across the renderer modules: factories return the exact TypeGPU handle types, and the
// aliases below are derived from them (no hand-written texture prop types).
import type { TgpuBuffer, TgpuRoot, VertexFlag } from 'typegpu';
import * as d from 'typegpu/data';
import { DEPTH_FORMAT, SAMPLES } from './pipelines.ts';
import { FillVertex } from './schemas.ts';

export type FillBuffer = TgpuBuffer<d.Disarray<typeof FillVertex>> & VertexFlag;

export const createFillBuffer = (root: TgpuRoot, vertices: number) => root.createBuffer(d.disarrayOf(FillVertex, Math.max(1, vertices))).$usage('vertex');

/**
 * Usage flags are exactly what each texture is used for (TypeGPU's `$usage` adds COPY_SRC | COPY_DST to every texture,
 * which costs memory / compression on some GPUs). The MSAA colour and depth / stencil targets are always cleared on
 * load and discarded on store (only their resolve survives a pass), so where the browser supports transient
 * attachments they never need memory (tile memory on tile-based GPUs). Read when a texture is created, so the module
 * loads where WebGPU's globals do not exist.
 */
const attachmentUsage = () => {
  // newer than @webgpu/types
  const transient = (GPUTextureUsage as { readonly TRANSIENT_ATTACHMENT?: number }).TRANSIENT_ATTACHMENT ?? 0;
  return GPUTextureUsage.RENDER_ATTACHMENT | transient;
};
/** A target that is rendered (resolved) into and sampled later: the static cache, the group-layer atlas, halo masks. */
export const sampledTargetUsage = () => GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;

export const createMsaaColor = (root: TgpuRoot, size: [number, number], format: GPUTextureFormat) =>
  root.createTexture({ size, format, sampleCount: SAMPLES }).$overrideFlags(attachmentUsage());
export const createMsaaDepth = (root: TgpuRoot, size: [number, number]) =>
  root.createTexture({ size, format: DEPTH_FORMAT, sampleCount: SAMPLES }).$overrideFlags(attachmentUsage());
export const createResolveColor = (root: TgpuRoot, size: [number, number], format: GPUTextureFormat) =>
  root.createTexture({ size, format }).$overrideFlags(sampledTargetUsage());

export type MsaaColor = ReturnType<typeof createMsaaColor>;
export type MsaaDepth = ReturnType<typeof createMsaaDepth>;
export type ResolveColor = ReturnType<typeof createResolveColor>;
