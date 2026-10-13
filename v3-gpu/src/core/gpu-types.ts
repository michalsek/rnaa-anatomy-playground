// Typed GPU resources shared across the renderer modules: factories return the exact TypeGPU handle types, and the
// aliases below are derived from them (no hand-written texture prop types).
import type { TgpuBuffer, TgpuRoot, VertexFlag } from 'typegpu';
import * as d from 'typegpu/data';
import { DEPTH_FORMAT, SAMPLES } from './pipelines.ts';
import { FillVertex } from './schemas.ts';

export type FillBuffer = TgpuBuffer<d.Disarray<typeof FillVertex>> & VertexFlag;

export const createFillBuffer = (root: TgpuRoot, vertices: number) => root.createBuffer(d.disarrayOf(FillVertex, Math.max(1, vertices))).$usage('vertex');

/**
 * The MSAA colour and depth / stencil targets are always cleared on load and discarded on store (only their resolve
 * survives a pass), so where the browser supports transient attachments they never need memory (tile memory on
 * tile-based GPUs).
 */
const ATTACHMENT_USAGE = typeof GPUTextureUsage !== 'undefined' && 'TRANSIENT_ATTACHMENT' in GPUTextureUsage ? 'transient' : 'render';

export const createMsaaColor = (root: TgpuRoot, size: [number, number], format: GPUTextureFormat) =>
  root.createTexture({ size, format, sampleCount: SAMPLES }).$usage(ATTACHMENT_USAGE);
export const createMsaaDepth = (root: TgpuRoot, size: [number, number]) =>
  root.createTexture({ size, format: DEPTH_FORMAT, sampleCount: SAMPLES }).$usage(ATTACHMENT_USAGE);
export const createResolveColor = (root: TgpuRoot, size: [number, number], format: GPUTextureFormat) =>
  root.createTexture({ size, format }).$usage('render', 'sampled');

export type MsaaColor = ReturnType<typeof createMsaaColor>;
export type MsaaDepth = ReturnType<typeof createMsaaDepth>;
export type ResolveColor = ReturnType<typeof createResolveColor>;
