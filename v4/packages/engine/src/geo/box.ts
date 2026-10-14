import { extrude } from './extrude.ts';
import type { Mesh } from './mesh.ts';

export interface BoxSpec {
  /** Centre of the box (model space). */
  center?: readonly [number, number, number];
  /** Full extents along x, y, z. */
  size: readonly [number, number, number];
  /** Plan corner radius (rounded vertical edges). */
  r?: number;
  /** Heights (model z) of seam rings around the sides. */
  seams?: readonly number[];
}

/** Axis-aligned box: an extruded rectangle (flat normals, CCW seen from outside). */
export function box({ center = [0, 0, 0], size, r = 0, seams = [] }: BoxSpec): Mesh {
  return extrude({
    plan: { rect: [size[0], size[1]], r },
    z: center[2] - size[2] / 2,
    height: size[2],
    seams,
    offset: [center[0], center[1]],
  });
}
