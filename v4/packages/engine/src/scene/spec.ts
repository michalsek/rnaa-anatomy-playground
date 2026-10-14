/**
 * Scene-neutral render input: a merged mesh with its topology, a part table and a line-set
 * table. Any scene source (the M1 scene now, the SceneStore in M2) produces this.
 */
import { mat4 } from 'wgpu-matrix';
import type { Bounds, ViewPreset } from '../camera/camera.ts';
import type { Mesh } from '../geo/mesh.ts';
import type { Topology } from '../geo/topology.ts';
import type { Slot } from '../palette/tokens.ts';

export interface PartSpec {
  material: number;
  /** World position of the part's model origin. */
  position: [number, number, number];
  /** Euler rotation in degrees, applied X then Y then Z (model = T · Rz · Ry · Rx · spin). */
  rotation?: [number, number, number];
  /** Spin about the part's z axis, radians per second (0 = static). */
  spin: number;
  /** Line tones and width (CSS px at the fit zoom). */
  outline: Slot;
  crease: Slot;
  width: number;
}

export interface LineSetSpec {
  /** Lines per full turn of u. */
  count: number;
  /** Shift in line units (x = u·count − phase). */
  phase: number;
  /** Drawn line indices: first..last (inclusive, after wrapping into 0..count−1). */
  first: number;
  last: number;
  /** Every n-th line from `first` is a major (0 = none). */
  majorEvery: number;
  minor: Slot;
  major: Slot;
  width: number;
  majorWidth: number;
  /** Facing range over which the lines fade in; equal values = no fade. */
  fade: [number, number];
}

export interface SceneSpec {
  mesh: Mesh;
  /** Topology of `mesh`, built per source mesh and merged (never welded across meshes). */
  topology: Topology;
  parts: PartSpec[];
  /** Line set i is referenced by tag i + 1. */
  lineSets: LineSetSpec[];
  bounds: Bounds;
  views: ViewPreset[];
}

/** Model matrix without spin. */
export function partMatrix(part: PartSpec, out = mat4.identity()) {
  const [rx, ry, rz] = (part.rotation ?? [0, 0, 0]).map((deg) => (deg * Math.PI) / 180) as [
    number,
    number,
    number,
  ];
  mat4.translation(part.position, out);
  mat4.rotateZ(out, rz, out);
  mat4.rotateY(out, ry, out);
  mat4.rotateX(out, rx, out);
  return out;
}
