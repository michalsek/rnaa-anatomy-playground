/**
 * The drive cabinet (v2 L631–654): a graphite cabinet on a plinth at +x, with a door, vents,
 * a rating plate and rules on its +x face, a handle and hinges, and the motor cable up to the
 * terminal box on the motor.
 */
import type { SegmentSpec, Vec3 } from '@anatomy/engine';
import { Box, Extrude, Group, Lathe, Marks, Tube } from '../../blocks/blocks.tsx';
import { MOTOR, closed, corners, disc, frameAlong } from './dims.ts';

const C = { x0: 52, x1: 62, y0: -6, y1: 16, z0: 2, z1: 40 };
/** Marks on the +x face sit a hair off it. */
const FX = C.x1 + 0.01;
const ON_FACE: Vec3 = [1, 0, 0];
const face = (pts: readonly (readonly [number, number])[]): SegmentSpec[] =>
  closed(pts.map(([y, z]) => [FX, y, z] as Vec3), ON_FACE, 'lo');
const rect = (y0: number, z0: number, y1: number, z1: number) => face([[y0, z0], [y1, z0], [y1, z1], [y0, z1]]);
const GLAND: Vec3 = [57.5, 14, 0];
const CABLE_R = 0.7;
const SHELL = Math.max(1.8, CABLE_R * 2.2);
const CABLE_TOP: Vec3 = [MOTOR[0], 9, 175.9];
const CABLE: Vec3[] = [
  [GLAND[0], GLAND[1], C.z1 + 1.4],
  [GLAND[0], GLAND[1], 183],
  [CABLE_TOP[0], CABLE_TOP[1], 183],
  CABLE_TOP,
];

export function Cabinet() {
  const segments = [
    // Door, four vents, the rating plate.
    ...rect(C.y0 + 1.6, C.z0 + 1.6, C.y1 - 1.6, C.z1 - 1.6),
    ...[0, 1, 2, 3].flatMap((i) => rect(C.y0 + 4, C.z1 - 7 - i * 2.4, C.y1 - 7, C.z1 - 6 - i * 2.4)),
    ...rect(C.y0 + 4, C.z0 + 8, C.y0 + 12, C.z0 + 14),
    // Three rules on the plate.
    ...[0, 1, 2].map((i) => ({
      a: [FX, C.y0 + 5.2, C.z0 + 12.6 - i * 1.6] as const,
      b: [FX, C.y0 + [11, 9.2, 10.2][i]!, C.z0 + 12.6 - i * 1.6] as const,
      normal: ON_FACE,
      tone: 'lo' as const,
    })),
  ];
  const dots = [
    [C.y0 + 3.2, C.z1 - 3.2],
    [C.y1 - 3.2, C.z1 - 3.2],
    [C.y0 + 3.2, C.z0 + 3.2],
    [C.y1 - 3.2, C.z0 + 3.2],
  ].map(([y, z]) => ({ at: [FX, y!, z!] as const, size: 0.4, normal: ON_FACE }));
  return (
    <Group id="cabinet">
      <Box id="plinth" material="steel" outline="lo" {...corners([C.x0 - 1, C.y0 - 1, 0], [C.x1 + 1, C.y1 + 1, C.z0])} r={0.6} />
      <Box id="body" material="graphite" {...corners([C.x0, C.y0, C.z0], [C.x1, C.y1, C.z1])} r={0.8} />
      <Marks id="face" material="graphite" segments={segments} dots={dots} />
      <Box id="handle" material="graphite" {...corners([C.x1, C.y1 - 4.4, 20], [C.x1 + 1.4, C.y1 - 3, 27])} r={0.3} />
      {[10, 30].map((z, k) => (
        <Extrude key={k} id={`hinge${k}`} material="graphite" plan={{ circle: 0.6, steps: 12 }} z={z} height={3.5} position={[C.x1 + 0.6, C.y0 + 2.4, 0]} />
      ))}
      <Extrude id="gland" material="graphite" plan={{ circle: 1.2, steps: 16 }} z={C.z1} height={1.4} position={GLAND} />
      {/* The motor cable, with a connector shell at each end. */}
      <Tube id="cable" material="steel" outline="lo" path={CABLE} radius={CABLE_R} sides={12} bend={3} />
      <Lathe id="shell0" material="steel" profile={disc(CABLE_R * 1.6, 0, SHELL)} steps={16} {...frameAlong(CABLE[0]!, [0, 0, 1])} />
      <Lathe id="shell1" material="steel" profile={disc(CABLE_R * 1.6, -SHELL, 0)} steps={16} {...frameAlong(CABLE_TOP, [0, 0, -1])} />
    </Group>
  );
}
