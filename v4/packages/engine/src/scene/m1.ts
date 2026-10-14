/**
 * M1 line-spike scene: a steel box with a graphite tach on its front-left face, a spinning
 * steel rotor with a raised rib band and a dial on its hub, and a react-blue tube from the box
 * over to the rotor flange. Every line type of the spike appears at least once.
 */
import { vec3 } from 'wgpu-matrix';
import type { Bounds, ViewPreset } from '../camera/camera.ts';
import { box } from '../geo/box.ts';
import { lathe, type ProfilePoint } from '../geo/lathe.ts';
import { type Mesh, mergeMeshes } from '../geo/mesh.ts';
import { buildTopology, mergeTopologies } from '../geo/topology.ts';
import { tube } from '../geo/tube.ts';
import { MATERIAL } from '../palette/tokens.ts';
import { type LineSetSpec, type PartSpec, type SceneSpec, partMatrix } from './spec.ts';

/** Drum on a flanged foot, a raised rib band, a domed shoulder, and a hub with a dial ring. */
export const ROTOR_PROFILE: readonly ProfilePoint[] = [
  [0, 0],
  [10.6, 0],
  [10.6, 1.4],
  [8.2, 1.4],
  [8.2, 3],
  [8.5, 3],
  [8.5, 9.5], // segment 5: rib band
  [8.2, 9.5],
  [8.2, 11],
  [8.0, 12.2, true],
  [7.3, 13.3, true],
  [6.0, 14.2, true],
  [4.2, 14.7],
  [3.0, 14.7],
  [3.0, 17],
  [2.2, 17], // segment 14: hub dial annulus, ending on a forced ring
  [0, 17],
];

/** The v2 tach at 0.8 scale: bezel, recessed face, ticks between the step and a forced ring. */
export const TACH_PROFILE: readonly ProfilePoint[] = [
  [4.32, 0],
  [4.32, 1.92],
  [3.68, 1.92],
  [3.68, 1.52],
  [2.56, 1.52], // segment 3: tick annulus
  [0, 1.52],
];

const BOX_AT: [number, number, number] = [-13, 13, 0];
const ROTOR_AT: [number, number, number] = [13, -13, 0];
const STANDOFF = 0.02;
const TACH_AT: [number, number, number] = [BOX_AT[0], BOX_AT[1] + 6 + STANDOFF, 5];
const TUBE_R = 0.9;
/** Where the tube lands: on the flange, toward the box. */
const LAND = 9.5 / Math.SQRT2;
const TUBE_PATH: [number, number, number][] = [
  [BOX_AT[0] + 6 + STANDOFF, 11, 4],
  [-1, 11, 4],
  [-1, 11, 12],
  [ROTOR_AT[0] - LAND, ROTOR_AT[1] + LAND, 12],
  [ROTOR_AT[0] - LAND, ROTOR_AT[1] + LAND, 1.4 + STANDOFF],
];

export function m1Scene(): SceneSpec {
  const lines = { outline: 'mid', crease: 'faint', width: 0.6 } as const;
  const parts: PartSpec[] = [
    { material: MATERIAL.steel, position: BOX_AT, spin: 0, ...lines },
    { material: MATERIAL.steel, position: ROTOR_AT, spin: 0.35, ...lines },
    { material: MATERIAL.graphite, position: TACH_AT, rotation: [-90, 0, 0], spin: 0, ...lines },
    // The subject (react parts) gets the `hi` outline.
    { material: MATERIAL.react, position: [0, 0, 0], spin: 0, ...lines, outline: 'hi' },
  ];
  const tick = { width: 0.6, majorWidth: 0.6, fade: [0, 0] as [number, number] };
  const lineSets: LineSetSpec[] = [
    // 1: rotor ribs, faded toward the limbs so they end before the outline.
    { count: 36, phase: 0, first: 0, last: 35, majorEvery: 0, minor: 'lo', major: 'lo', ...tick, fade: [0.1, 0.55] },
    // 2: hub dial, a major every 6th.
    { count: 24, phase: 0, first: 0, last: 23, majorEvery: 6, minor: 'mid', major: 'hi', ...tick },
    // 3: tach, 18 intervals over 270° with the gap at the bottom, a major every 3rd.
    { count: 24, phase: 9, first: 0, last: 18, majorEvery: 3, minor: 'mid', major: 'hi', ...tick },
  ];
  const meshes = [
    box({ size: [12, 12, 10], center: [0, 0, 5], part: 0 }),
    lathe({
      profile: ROTOR_PROFILE,
      part: 1,
      lineSets: [
        { segment: 5, set: 1 },
        { segment: 14, set: 2 },
      ],
      marks: [15],
    }),
    lathe({ profile: TACH_PROFILE, steps: 96, part: 2, lineSets: [{ segment: 3, set: 3 }], marks: [4] }),
    tube({ path: TUBE_PATH, radius: TUBE_R, part: 3 }),
  ];
  const mesh = mergeMeshes(meshes);
  const topology = mergeTopologies(meshes.map(buildTopology));
  const bounds = boundsOf(mesh, parts);

  const tachFace: [number, number, number] = [TACH_AT[0], TACH_AT[1] + 1.52, TACH_AT[2]];
  const limb: [number, number, number] = [
    ROTOR_AT[0] + 8.5 * Math.SQRT1_2,
    ROTOR_AT[1] - 8.5 * Math.SQRT1_2,
    6,
  ];
  const views: ViewPreset[] = [
    { name: 'fit', yaw: 45, elevation: 30, zoom: 1 },
    { name: 'yaw 20', yaw: 20, elevation: 30, zoom: 1 },
    { name: 'yaw 70', yaw: 70, elevation: 30, zoom: 1 },
    { name: 'yaw 160', yaw: 160, elevation: 30, zoom: 1 },
    { name: 'elev 10', yaw: 45, elevation: 10, zoom: 1 },
    { name: 'elev 60', yaw: 45, elevation: 60, zoom: 1 },
    { name: '0.5× thin', yaw: 45, elevation: 30, zoom: 0.5 },
    { name: '4× box corner', yaw: 45, elevation: 30, zoom: 4, focus: [BOX_AT[0] + 6, BOX_AT[1] + 6, 10] },
    { name: '4× tach', yaw: 45, elevation: 30, zoom: 4, focus: tachFace },
    { name: '4× rotor limb', yaw: 45, elevation: 30, zoom: 4, focus: limb },
    { name: '4× tube bend', yaw: 45, elevation: 30, zoom: 4, focus: [-1.6, 11, 11.2] },
  ];
  return { mesh, topology, parts, lineSets, bounds, views };
}

/** World AABB of the mesh with every part at its rest transform (spin is about z, and the
 * spinning parts are lathes about z, so their AABB does not change). */
function boundsOf(mesh: Mesh, parts: PartSpec[]): Bounds {
  const models = parts.map((p) => partMatrix(p));
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const p = vec3.create();
  for (let v = 0; v < mesh.parts.length; v++) {
    vec3.transformMat4(mesh.positions.subarray(v * 3, v * 3 + 3), models[mesh.parts[v]!]!, p);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, p[k]!);
      max[k] = Math.max(max[k]!, p[k]!);
    }
  }
  return { min, max };
}
