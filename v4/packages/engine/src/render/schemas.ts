/**
 * GPU data for the M1 renderer: vertex pulling (no vertex/index buffers), one triangle record
 * per triangle with its adjacency and edge flags, and per-part / per-line-set tables.
 */
import tgpu, { d } from 'typegpu';
import type { Mesh } from '../geo/mesh.ts';
import { NO_NEIGHBOUR, type Topology, triangleCountOf } from '../geo/topology.ts';

export const GpuVertex = d.struct({
  position: d.vec3f,
  u: d.f32,
  normal: d.vec3f,
  v: d.f32,
}); // 32 B

export const GpuTri = d.struct({
  idx: d.vec3u,
  part: d.u32,
  faceNormal: d.vec3f,
  /** Bits 0-2 crease[i], 3-5 boundary[i], 6 smooth, 8-15 line set (see FLAG). */
  flags: d.u32,
  adj: d.vec3u,
  /** The other half of this triangle's quad, or NO_NEIGHBOUR. */
  partner: d.u32,
}); // 48 B

export const Part = d.struct({
  model: d.mat4x4f,
  material: d.u32,
  outlineSlot: d.u32,
  creaseSlot: d.u32,
  /** Line width in CSS px at the fit zoom. */
  width: d.f32,
});

export const LineSet = d.struct({
  /** Lines per full turn of u. */
  count: d.f32,
  /** Shift in line units (x = u·count − phase). */
  phase: d.f32,
  /** Drawn line indices: first..last (inclusive, after wrapping into 0..count−1). */
  first: d.i32,
  last: d.i32,
  /** Every n-th line from `first` is a major (0 = none). */
  majorEvery: d.u32,
  minorSlot: d.u32,
  majorSlot: d.u32,
  width: d.f32,
  majorWidth: d.f32,
  /** Facing (n · toward) range over which the lines fade in; equal values = no fade. */
  fade: d.vec2f,
});

export const Frame = d.struct({
  viewProjection: d.mat4x4f,
  light: d.vec3f,
  toward: d.vec3f,
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
  parts: { storage: (n: number) => d.arrayOf(Part, n), visibility: ['vertex', 'fragment'] },
  lineSets: { storage: (n: number) => d.arrayOf(LineSet, n), visibility: ['fragment'] },
  palette: { storage: (n: number) => d.arrayOf(d.vec4f, n), visibility: ['fragment'] },
});

/** Packed vertex records, laid out as `arrayOf(GpuVertex, n)`. */
export function packVertices(mesh: Mesh): ArrayBuffer {
  const count = mesh.positions.length / 3;
  const out = new Float32Array(count * 8);
  for (let v = 0; v < count; v++) {
    out.set(mesh.positions.subarray(v * 3, v * 3 + 3), v * 8);
    out[v * 8 + 3] = mesh.uvs[v * 2]!;
    out.set(mesh.normals.subarray(v * 3, v * 3 + 3), v * 8 + 4);
    out[v * 8 + 7] = mesh.uvs[v * 2 + 1]!;
  }
  if (out.byteLength !== count * d.sizeOf(GpuVertex)) throw new Error('GpuVertex layout drift');
  return out.buffer;
}

/** Packed triangle records, laid out as `arrayOf(GpuTri, n)`. */
export function packTriangles(mesh: Mesh, topo: Topology): ArrayBuffer {
  const count = triangleCountOf(topo);
  const buffer = new ArrayBuffer(count * 48);
  const u32 = new Uint32Array(buffer);
  const f32 = new Float32Array(buffer);
  for (let t = 0; t < count; t++) {
    const o = t * 12;
    u32.set(mesh.indices.subarray(t * 3, t * 3 + 3), o);
    u32[o + 3] = mesh.parts[mesh.indices[t * 3]!]!;
    f32.set(topo.faceNormals.subarray(t * 3, t * 3 + 3), o + 4);
    u32[o + 7] = topo.flags[t]!;
    u32.set(topo.adj.subarray(t * 3, t * 3 + 3), o + 8);
    const partner = mesh.partners[t]!;
    u32[o + 11] = partner < 0 ? NO_NEIGHBOUR : partner;
  }
  if (buffer.byteLength !== count * d.sizeOf(GpuTri)) throw new Error('GpuTri layout drift');
  return buffer;
}
