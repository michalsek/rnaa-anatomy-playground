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
  /** Rotation, translation and uniform scale only (normals are transformed by it). */
  model: d.mat4x4f,
  style: d.u32,
  flags: d.u32,
  _pad: d.vec2u,
}); // 80 B
export const INSTANCE_FLOATS = 20;

/** Tone rules. */
export const TONE_RULE = { bands: 0, plan: 1, tube: 2 } as const;

export const Style = d.struct({
  material: d.u32,
  outlineSlot: d.u32,
  creaseSlot: d.u32,
  toneRule: d.u32,
  /** Edge line width in CSS px at the fit zoom. */
  width: d.f32,
  _p0: d.u32,
  _p1: d.u32,
  _p2: d.u32,
}); // 32 B

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
});

/** Mark kinds. */
export const MARK = { dot: 0, segment: 1 } as const;

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
  /** 0 = normal, 1 = line classes on paper, 2 = lines off. */
  debug: d.u32,
  /** The page paper (debug view 1 fills every face with it). */
  paper: d.vec4f,
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
});

/** Byte sizes the CPU packers assume; checked against TypeGPU's layout once. */
export const SIZES = { vertex: 48, tri: 48, instance: 80, style: 32, mark: 64 } as const;

export function assertLayouts() {
  const actual = {
    vertex: d.sizeOf(GpuVertex),
    tri: d.sizeOf(GpuTri),
    instance: d.sizeOf(Instance),
    style: d.sizeOf(Style),
    mark: d.sizeOf(Mark),
  };
  for (const [name, size] of Object.entries(SIZES)) {
    const got = actual[name as keyof typeof SIZES];
    if (got !== size) throw new Error(`GPU layout drift: ${name} is ${got} B, packers assume ${size}`);
  }
}
