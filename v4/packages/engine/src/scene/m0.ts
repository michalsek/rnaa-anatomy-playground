/**
 * M0 scene: one box and one lathe (a drum/rotor), side by side along the screen's X axis.
 */
import type { Bounds } from '../camera/camera.ts';
import { box } from '../geo/box.ts';
import { lathe, type ProfilePoint } from '../geo/lathe.ts';
import { type Mesh, mergeMeshes } from '../geo/mesh.ts';
import { MATERIAL } from '../palette/tokens.ts';

export interface PartSpec {
  material: number;
  /** World position of the part's model origin. */
  position: [number, number, number];
  /** Spin about the part's z axis, radians per second (0 = static). */
  spin: number;
}

export interface SceneSpec {
  mesh: Mesh;
  parts: PartSpec[];
  bounds: Bounds;
}

/** Drum on a flanged foot with a domed shoulder and a hub; z up, r ≤ 10, z 0..17. */
export const ROTOR_PROFILE: readonly ProfilePoint[] = [
  [0, 0],
  [10, 0],
  [10, 1.4],
  [8.2, 1.4],
  [8.2, 11],
  [8.0, 12.2, true],
  [7.3, 13.3, true],
  [6.0, 14.2, true],
  [4.2, 14.7],
  [3.0, 14.7],
  [3.0, 17],
  [0, 17],
];

// Screen X is the world direction (sinA, −cosA, 0) at yaw 45°, so "side by side" is ±(1, −1).
const OFFSET = 13;

export function m0Scene(): SceneSpec {
  const parts: PartSpec[] = [
    { material: MATERIAL.graphite, position: [-OFFSET, OFFSET, 0], spin: 0 },
    { material: MATERIAL.react, position: [OFFSET, -OFFSET, 0], spin: 0.35 },
  ];
  const mesh = mergeMeshes([
    box({ size: [12, 12, 10], center: [0, 0, 5], part: 0 }),
    lathe({ profile: ROTOR_PROFILE, steps: 96, part: 1 }),
  ]);
  // Generous bounds: the box (±6) and the lathe (r 10) around their part origins.
  const bounds: Bounds = {
    min: [-OFFSET - 10, -OFFSET - 10, 0],
    max: [OFFSET + 10, OFFSET + 10, 17],
  };
  return { mesh, parts, bounds };
}
