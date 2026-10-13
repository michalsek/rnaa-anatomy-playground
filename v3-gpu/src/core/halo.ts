// CSS-blurred halos (filter: blur(σ) + translate on a silhouette): the silhouette is rendered into a half-resolution
// mask, blurred with a separable gaussian, and composited at the halo's painter position (scissored to its box).
// Owns every texture, buffer and bind group it creates; `dispose` releases them all.
import type { TgpuBindGroup, TgpuBuffer, TgpuCommandEncoder, TgpuRenderPass, TgpuRoot, TgpuSampler, UniformFlag } from 'typegpu';
import * as d from 'typegpu/data';
import type { LayoutGroup } from './bindings.ts';
import type { FillBuffer } from './gpu-types.ts';
import type { PaintTable } from './paint.ts';
import { MASK_FORMAT, type Pipelines } from './pipelines.ts';
import { Blur, HaloParams } from './schemas.ts';
import * as S from './shaders.ts';
import type { HaloPrim } from './static-geometry.ts';
import type { DeviceRect } from './static-cache.ts';

/** The mask and blur run at this fraction of the canvas resolution. */
const MASK_SCALE = 0.5;
/** Gaussian taps reach this many standard deviations. */
const BLUR_EXTENT_SIGMAS = 3;
/** Smallest σ in mask texels (a sharper blur would alias). */
const MIN_SIGMA_TEXELS = 0.5;
/** Device px added around a halo's box (bilinear footprint of the half-resolution mask). */
const BOX_MARGIN_PX = 2;

const createMask = (root: TgpuRoot, size: [number, number]) => root.createTexture({ size, format: MASK_FORMAT }).$usage('render', 'sampled');
type MaskTexture = ReturnType<typeof createMask>;
type BlurBuffer = TgpuBuffer<typeof Blur> & UniformFlag;
type ParamsBuffer = TgpuBuffer<typeof HaloParams> & UniformFlag;

interface HaloTargets {
  mask: MaskTexture;
  scratch: MaskTexture;
  horizontal: BlurBuffer;
  vertical: BlurBuffer;
  params: ParamsBuffer;
  blurH: TgpuBindGroup<(typeof S.blurLayout)['entries']>;
  blurV: TgpuBindGroup<(typeof S.blurLayout)['entries']>;
  composite: TgpuBindGroup<(typeof S.haloLayout)['entries']>;
  /** Device-px box of the composited halo this frame. */
  box: DeviceRect;
  /** Composite parameters last written (colour, shift, depth): unchanged ones are not re-uploaded. */
  written: Float32Array;
}

export interface HaloView {
  scale: number;
  translate: [number, number];
  width: number;
  height: number;
}

export class HaloEffect {
  private targets: HaloTargets[] = [];
  private readonly sampler: TgpuSampler;
  private maskDirty = true;

  constructor(private readonly root: TgpuRoot, private readonly pipelines: Pipelines) {
    this.sampler = root.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  }

  /** The masks must be re-rendered (size, palette or geometry changed). */
  invalidate() {
    this.maskDirty = true;
  }

  get count() {
    return this.targets.length;
  }

  /**
   * Renders and blurs every mask when invalidated (before the main pass), and writes the composite parameters: colour,
   * shift (explode offset + CSS translate) and depth at the halo's painter position.
   */
  prepare(encoder: TgpuCommandEncoder, halos: HaloPrim[], vertices: FillBuffer, group: LayoutGroup, view: HaloView, paints: PaintTable, offsetOf: (item: number) => [number, number], depthOf: (item: number, layer: number) => number) {
    if (this.maskDirty || this.targets.length !== halos.length) this.renderMasks(encoder, halos, vertices, group, view, paints);
    halos.forEach((halo, i) => {
      const paint = paints.resolved[halo.paint];
      const [ox, oy] = offsetOf(halo.item);
      const shift: [number, number] = [(ox + paint.translate[0]) * view.scale, (oy + paint.translate[1]) * view.scale];
      const t = this.targets[i];
      const depth = depthOf(halo.item, halo.layer);
      const values = [...paint.rgba, shift[0], shift[1], depth];
      if (values.some((v, k) => Math.fround(v) !== t.written[k])) {
        t.written.set(values);
        t.params.write({ color: d.vec4f(...paint.rgba), shift: d.vec2f(...shift), depth });
      }
      const reach = this.sigmaOf(paint.blur, view.scale) * BLUR_EXTENT_SIGMAS / MASK_SCALE + BOX_MARGIN_PX;
      t.box.x0 = Math.max(0, Math.floor(halo.bounds.x0 * view.scale + view.translate[0] + shift[0] - reach));
      t.box.y0 = Math.max(0, Math.floor(halo.bounds.y0 * view.scale + view.translate[1] + shift[1] - reach));
      t.box.x1 = Math.min(view.width, Math.ceil(halo.bounds.x1 * view.scale + view.translate[0] + shift[0] + reach));
      t.box.y1 = Math.min(view.height, Math.ceil(halo.bounds.y1 * view.scale + view.translate[1] + shift[1] + reach));
    });
  }

  boxOf(halo: number): DeviceRect {
    return this.targets[halo].box;
  }

  /** Composites halo `halo` in the current pass (its own pipeline and bind group; restores the full scissor). */
  draw(pass: TgpuRenderPass, halo: number, width: number, height: number) {
    const t = this.targets[halo];
    if (!(t.box.x1 > t.box.x0 && t.box.y1 > t.box.y0)) return;
    pass.setPipeline(this.pipelines.halo);
    pass.setBindGroup(S.haloLayout, t.composite);
    pass.setScissorRect(t.box.x0, t.box.y0, t.box.x1 - t.box.x0, t.box.y1 - t.box.y0);
    pass.draw(3);
    pass.setScissorRect(0, 0, width, height);
  }

  dispose() {
    for (const t of this.targets) {
      t.mask.destroy();
      t.scratch.destroy();
      t.horizontal.destroy();
      t.vertical.destroy();
      t.params.destroy();
    }
    this.targets = [];
  }

  private sigmaOf(blur: number, scale: number) {
    return Math.max(MIN_SIGMA_TEXELS, blur * scale * MASK_SCALE);
  }

  private renderMasks(encoder: TgpuCommandEncoder, halos: HaloPrim[], vertices: FillBuffer, group: LayoutGroup, view: HaloView, paints: PaintTable) {
    this.dispose();
    this.maskDirty = false;
    const size: [number, number] = [Math.max(1, Math.ceil(view.width * MASK_SCALE)), Math.max(1, Math.ceil(view.height * MASK_SCALE))];
    for (const halo of halos) {
      const sigma = this.sigmaOf(paints.resolved[halo.paint].blur, view.scale);
      const radius = Math.ceil(sigma * BLUR_EXTENT_SIGMAS);
      const mask = createMask(this.root, size);
      const scratch = createMask(this.root, size);
      const horizontal = this.root.createBuffer(Blur, { dir: d.vec2i(1, 0), sigma, radius }).$usage('uniform');
      const vertical = this.root.createBuffer(Blur, { dir: d.vec2i(0, 1), sigma, radius }).$usage('uniform');
      const params = this.root.createBuffer(HaloParams).$usage('uniform');
      const targets: HaloTargets = {
        mask, scratch, horizontal, vertical, params,
        blurH: this.root.createBindGroup(S.blurLayout, { src: mask, params: horizontal }),
        blurV: this.root.createBindGroup(S.blurLayout, { src: scratch, params: vertical }),
        composite: this.root.createBindGroup(S.haloLayout, { tex: mask, samp: this.sampler, params }),
        box: { x0: 0, y0: 0, x1: 0, y1: 0 },
        written: new Float32Array(7).fill(Number.NaN),
      };
      this.targets.push(targets);
      const silhouette = encoder.beginRenderPass({ colorAttachments: [{ view: mask, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }] });
      silhouette.setPipeline(this.pipelines.haloMask);
      silhouette.setBindGroup(S.layout, group);
      silhouette.setVertexBuffer(S.fillLayout, vertices);
      silhouette.draw(halo.count, 1, halo.first);
      silhouette.end();
      for (const [target, bindGroup] of [[scratch, targets.blurH], [mask, targets.blurV]] as const) {
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }] });
        pass.setPipeline(this.pipelines.blur);
        pass.setBindGroup(S.blurLayout, bindGroup);
        pass.draw(3);
        pass.end();
      }
    }
  }
}

