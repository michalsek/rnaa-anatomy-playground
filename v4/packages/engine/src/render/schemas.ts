/**
 * GPU data: vertex pulling (no vertex/index buffers), one record per triangle with adjacency and
 * edge flags, an instance table (model matrix + style), a style table, line sets, the palette,
 * and free marks (dots and segments). CPU packers write raw ArrayBuffers in these layouts.
 */
import tgpu, { d } from 'typegpu';

export const GpuVertex = d.struct({
  position: d.vec3f,
  u: d.f32,
  normal: d.vec3f,
  v: d.f32,
  /** A tube's centreline direction (zero elsewhere). */
  tangent: d.vec3f,
  _pad: d.f32,
}); // 48 B
export const VERTEX_FLOATS = 12;

export const GpuTri = d.struct({
  idx: d.vec3u,
  /** Instance offset within the batch: the part's slot in the static batch, 0 in a pool. */
  slot: d.u32,
  faceNormal: d.vec3f,
  /** Bits 0-2 crease[i], 3-5 boundary[i], 6 smooth, 8-15 line set (see FLAG). */
  flags: d.u32,
  adj: d.vec3u,
  /** The other half of this triangle's quad, or NO_NEIGHBOUR. */
  partner: d.u32,
}); // 48 B

/** Instance flag bits. */
export const INSTANCE = { visible: 1 } as const;

export const Instance = d.struct({
  /**
   * Rotation, translation and uniform scale; pools declared `scalable` add an axis-aligned
   * scale in the instance's own frame (normals are transformed by the model and renormalised,
   * exact for box faces).
   */
  model: d.mat4x4f,
  style: d.u32,
  flags: d.u32,
  /** E2: the second style the fill (and pool marks) blend toward, by `mix` (0 = `style` only). */
  style2: d.u32,
  mix: d.f32,
  /** E1: shift of the UV line sets, in u (0..1 around the surface): scrolling slats, chains. */
  uShift: d.f32,
  _p0: d.f32,
  _p1: d.f32,
  _p2: d.f32,
}); // 96 B
export const INSTANCE_FLOATS = 24;

/** Tone rules. `gradient`: a 3-stop FX gradient along a model-space line (the funnel void). */
export const TONE_RULE = { bands: 0, plan: 1, tube: 2, gradient: 3 } as const;

export const Style = d.struct({
  material: d.u32,
  outlineSlot: d.u32,
  creaseSlot: d.u32,
  toneRule: d.u32,
  /** Edge line width in CSS px at the fit zoom. */
  width: d.f32,
  /** Index into the gradient table (tone rule `gradient`). */
  gradient: d.u32,
  _p1: d.u32,
  _p2: d.u32,
}); // 32 B

/** A linear gradient in a part's model space: `start` → `end`, 3 FX stops, the middle at `mid`. */
export const Gradient = d.struct({
  start: d.vec3f,
  mid: d.f32,
  end: d.vec3f,
  _p: d.u32,
  fx: d.vec3u,
  _q: d.u32,
}); // 48 B

export const LineSet = d.struct({
  count: d.f32,
  phase: d.f32,
  first: d.i32,
  last: d.i32,
  majorEvery: d.u32,
  minorSlot: d.u32,
  majorSlot: d.u32,
  width: d.f32,
  majorWidth: d.f32,
  fade: d.vec2f,
  /** LINE_KIND: ticks, or filled sectors (`duty` of each period) in the FX colour `fill`. */
  kind: d.u32,
  duty: d.f32,
  fill: d.u32,
});

export const LINE_KIND = { lines: 0, sectors: 1 } as const;

/**
 * Mark kinds. A contact is a segment on a crossing curve: its normal is the bigger part's face
 * there (the quad lies on that surface), with no facing fade.
 */
export const MARK = { dot: 0, segment: 1, contact: 2 } as const;

export const Mark = d.struct({
  /** Dot centre or segment start, in the instance's model space. */
  a: d.vec3f,
  /** Dot radius or segment width, CSS px at the fit zoom. */
  size: d.f32,
  b: d.vec3f,
  instance: d.u32,
  /** Surface normal for facing fade; zero = always shown. */
  normal: d.vec3f,
  kind: d.u32,
  /** Facing range over which the mark fades in. */
  fade: d.vec2f,
  material: d.u32,
  /** Palette slot: the line tone (segments) or the tone that sets a dot's opacity. */
  slot: d.u32,
}); // 64 B

/** Sprite kinds: a soft floor shadow, and a screen-facing disc (glows). */
export const SPRITE = { halo: 0, disc: 1 } as const;

export const Sprite = d.struct({
  /** Model-space centre (halo: the floor point under the plan centre). */
  center: d.vec3f,
  kind: d.u32,
  /** Halo: plan half-extent, corner radius and blur σ (world units). */
  half: d.vec2f,
  corner: d.f32,
  sigma: d.f32,
  /** Disc: radius = radius + grow · level (world units), alpha = min(opacity · level, cap). */
  radius: d.f32,
  grow: d.f32,
  opacity: d.f32,
  cap: d.f32,
  /** FX colour; instance (rides moves groups); level; halo: screen-down shift, disc: toward-viewer bias. */
  fx: d.u32,
  instance: d.u32,
  level: d.f32,
  bias: d.f32,
}); // 64 B

export const Frame = d.struct({
  viewProjection: d.mat4x4f,
  light: d.vec3f,
  toward: d.vec3f,
  /** World directions of screen right and screen up. */
  right: d.vec3f,
  up: d.vec3f,
  /** Device px. */
  viewport: d.vec2f,
  /** Device px per CSS px of line width: dpr × zoom / fit zoom. */
  pxPerCss: d.f32,
  /** Device px per world unit. */
  pxPerUnit: d.f32,
  /** 0 = normal, 1 = line classes on paper, 2 = lines off. */
  debug: d.u32,
  /** The page paper (debug view 1 fills every face with it). */
  paper: d.vec4f,
  /** Ink gain on line coverage (edges, ticks, mark segments): `LINE_GAIN[theme]`. */
  lineGain: d.f32,
});

export const sceneLayout = tgpu.bindGroupLayout({
  frame: { uniform: Frame },
  vertices: { storage: (n: number) => d.arrayOf(GpuVertex, n), visibility: ['vertex'] },
  tris: { storage: (n: number) => d.arrayOf(GpuTri, n), visibility: ['vertex'] },
  instances: { storage: (n: number) => d.arrayOf(Instance, n), visibility: ['vertex'] },
  styles: { storage: (n: number) => d.arrayOf(Style, n), visibility: ['vertex', 'fragment'] },
  lineSets: { storage: (n: number) => d.arrayOf(LineSet, n), visibility: ['fragment'] },
  palette: { storage: (n: number) => d.arrayOf(d.vec4f, n), visibility: ['vertex', 'fragment'] },
  marks: { storage: (n: number) => d.arrayOf(Mark, n), visibility: ['vertex'] },
  gradients: { storage: (n: number) => d.arrayOf(Gradient, n), visibility: ['vertex', 'fragment'] },
});

/**
 * The sprite pass has its own layout: the scene layout is at the 8 storage buffers per stage
 * that WebGPU guarantees (`maxStorageBuffersPerShaderStage`).
 */
export const spriteLayout = tgpu.bindGroupLayout({
  frame: { uniform: Frame },
  instances: { storage: (n: number) => d.arrayOf(Instance, n), visibility: ['vertex'] },
  palette: { storage: (n: number) => d.arrayOf(d.vec4f, n), visibility: ['vertex', 'fragment'] },
  sprites: { storage: (n: number) => d.arrayOf(Sprite, n), visibility: ['vertex', 'fragment'] },
});

/** Byte sizes the CPU packers assume; checked against TypeGPU's layout once. */
export const SIZES = { vertex: 48, tri: 48, instance: 96, style: 32, mark: 64, gradient: 48, sprite: 64 } as const;

export function assertLayouts() {
  const actual = {
    vertex: d.sizeOf(GpuVertex),
    tri: d.sizeOf(GpuTri),
    instance: d.sizeOf(Instance),
    style: d.sizeOf(Style),
    mark: d.sizeOf(Mark),
    gradient: d.sizeOf(Gradient),
    sprite: d.sizeOf(Sprite),
  };
  for (const [name, size] of Object.entries(SIZES)) {
    const got = actual[name as keyof typeof SIZES];
    if (got !== size) throw new Error(`GPU layout drift: ${name} is ${got} B, packers assume ${size}`);
  }
}
