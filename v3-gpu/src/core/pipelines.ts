// The renderer's pipeline set, created once per device. Every pipeline that draws into the main (or a layer) target
// shares its 4× MSAA colour + depth/stencil attachment formats. The stencil holds the static cache's redraw region
// (1 inside); every scene pipeline draws only where the stencil equals the pass's reference: 0 in passes that draw
// everything (the stencil is cleared to 0), 1 in a cached frame (inside the region).
import { common, warn, type TgpuRoot } from 'typegpu';
import type { BlendMode } from './paint.ts';
import * as S from './shaders.ts';

export const SAMPLES = 4;
export const DEPTH_FORMAT = 'depth24plus-stencil8';
export const MASK_FORMAT = 'r8unorm';

export const OVER: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};
export const MULTIPLY: GPUBlendState = {
  color: { srcFactor: 'dst', dstFactor: 'zero', operation: 'add' },
  alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
};
export const SCREEN: GPUBlendState = {
  color: { srcFactor: 'one-minus-dst', dstFactor: 'one', operation: 'add' },
  alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
};

const stencilFace = (compare: GPUCompareFunction, passOp: GPUStencilOperation = 'keep'): GPUStencilFaceState => ({ compare, failOp: 'keep', depthFailOp: 'keep', passOp });
const IN_REGION = { stencilFront: stencilFace('equal'), stencilBack: stencilFace('equal'), stencilWriteMask: 0 };
const DEPTH_WRITE: GPUDepthStencilState = { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less', ...IN_REGION };
const DEPTH_TEST: GPUDepthStencilState = { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'less', ...IN_REGION };
const DEPTH_ALWAYS: GPUDepthStencilState = { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'always' };
/** Writes the reference value into the stencil wherever it draws (the region mark). */
const MARK_REGION: GPUDepthStencilState = { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'always', stencilFront: stencilFace('always', 'replace'), stencilBack: stencilFace('always', 'replace') };
/** Draws where the stencil differs from the reference (outside the region). */
const OUTSIDE_REGION: GPUDepthStencilState = { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'always', stencilFront: stencilFace('not-equal'), stencilBack: stencilFace('not-equal'), stencilWriteMask: 0 };
const MULTISAMPLE = { count: SAMPLES };

export function createPipelines(root: TgpuRoot, format: GPUTextureFormat) {
  const fillAttribs = { pos: S.fillLayout.attrib.pos, ids: S.fillLayout.attrib.ids };
  const blendedFill = (fragment: typeof S.fillFragOver, blend: GPUBlendState) =>
    root.createRenderPipeline({ vertex: S.fillVert, fragment, attribs: fillAttribs, targets: { format, blend }, depthStencil: DEPTH_TEST, multisample: MULTISAMPLE });
  const stroke = (fragment: typeof S.strokeFrag, blend: GPUBlendState) =>
    root.createRenderPipeline({ vertex: S.strokeVert, fragment, targets: { format, blend }, depthStencil: DEPTH_TEST, multisample: MULTISAMPLE });
  return {
    fillOpaque: root.createRenderPipeline({ vertex: S.fillVert, fragment: S.fillFragOpaque, attribs: fillAttribs, targets: { format }, depthStencil: DEPTH_WRITE, multisample: MULTISAMPLE }),
    fillOver: blendedFill(S.fillFragOver, OVER),
    fillMultiply: blendedFill(S.fillFragMultiply, MULTIPLY),
    fillScreen: blendedFill(S.fillFragOver, SCREEN),
    stroke: stroke(S.strokeFrag, OVER),
    strokeMultiply: stroke(S.strokeFragMultiply, MULTIPLY),
    strokeScreen: stroke(S.strokeFrag, SCREEN),
    haloMask: root.createRenderPipeline({ vertex: S.haloMaskVert, fragment: S.haloMaskFrag, attribs: fillAttribs, targets: { format: MASK_FORMAT } }),
    blur: root.createRenderPipeline({ vertex: common.fullScreenTriangle, fragment: S.blurFrag, targets: { format: MASK_FORMAT } }),
    halo: root.createRenderPipeline({ vertex: S.haloVert, fragment: S.haloFrag, targets: { format, blend: OVER }, depthStencil: DEPTH_TEST, multisample: MULTISAMPLE }),
    composite: root.createRenderPipeline({ vertex: S.compositeVert, fragment: S.compositeFrag, targets: { format, blend: OVER }, depthStencil: DEPTH_TEST, multisample: MULTISAMPLE }),
    debugRects: root.createRenderPipeline({ vertex: S.debugRectVert, fragment: S.debugRectFrag, targets: { format, blend: OVER }, depthStencil: DEPTH_ALWAYS, multisample: MULTISAMPLE }),
    markRegion: root.createRenderPipeline({ vertex: S.debugRectVert, fragment: S.debugRectFrag, targets: { format, writeMask: 0 }, depthStencil: MARK_REGION, multisample: MULTISAMPLE }),
    cachedFrame: root.createRenderPipeline({ vertex: common.fullScreenTriangle, fragment: S.cachedFrameFrag, targets: { format }, depthStencil: OUTSIDE_REGION, multisample: MULTISAMPLE }),
  };
}

export type Pipelines = ReturnType<typeof createPipelines>;

export const fillPipelineOf = (pipelines: Pipelines, blend: BlendMode) =>
  blend === 'multiply' ? pipelines.fillMultiply : blend === 'screen' ? pipelines.fillScreen : pipelines.fillOver;
export const strokePipelineOf = (pipelines: Pipelines, blend: BlendMode) =>
  blend === 'multiply' ? pipelines.strokeMultiply : blend === 'screen' ? pipelines.strokeScreen : pipelines.stroke;

/**
 * Compiles every pipeline ahead of the first frame (TypeGPU resolves lazily on first draw otherwise). WGSL-string entry
 * functions that read their struct input (`in.pos`) make TypeGPU's external replacer warn `external-omitted` while it
 * resolves them; the emitted code is correct, so that warning kind is muted only while these pipelines resolve.
 */
export async function compilePipelines(pipelines: Pipelines) {
  warn.disable('external-omitted');
  try {
    await Promise.all(Object.values(pipelines).map((pipeline) => pipeline.initAsync()));
  } finally {
    warn.reset();
  }
}
