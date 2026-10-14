/**
 * Gallery row `m1`: the M1 line-spike composition (regression check). A steel box with a
 * graphite tach on its front-left face, a spinning steel rotor with a raised rib band and a dial
 * on its hub, and a react-blue tube from the box over to the rotor flange.
 */
import {
  ROTOR_DIAL,
  ROTOR_PROFILE,
  ROTOR_RIBS,
  TACH_PROFILE,
  TACH_TICKS,
  type GroupHandle,
  type Vec3,
  type ViewPreset,
} from '@anatomy/engine';
import { Box, Group, Lathe, Tube, useFrame, useNode } from '../blocks/blocks.tsx';

const BOX_AT: Vec3 = [-13, 13, 0];
const ROTOR_AT: Vec3 = [13, -13, 0];
const STANDOFF = 0.02;
const TACH_AT: Vec3 = [BOX_AT[0], BOX_AT[1] + 6 + STANDOFF, 5];
const TUBE_R = 0.9;
/** Where the tube lands: on the flange, toward the box. */
const LAND = 9.5 / Math.SQRT2;
const TUBE_PATH: Vec3[] = [
  [BOX_AT[0] + 6 + STANDOFF, 11, 4],
  [-1, 11, 4],
  [-1, 11, 12],
  [ROTOR_AT[0] - LAND, ROTOR_AT[1] + LAND, 12],
  [ROTOR_AT[0] - LAND, ROTOR_AT[1] + LAND, 1.4 + STANDOFF],
];
const SPIN = 0.35;

export function M1Row({ id = 'm1', at = [0, 0, 0] }: { id?: string; at?: Vec3 }) {
  const rotor = useNode<GroupHandle>(`${id}.rotor`);
  useFrame(({ t }) => rotor().spin('z', t * SPIN));
  return (
    <Group id={id} position={at}>
      <Box id="box" material="steel" size={[12, 12, 10]} center={[0, 0, 5]} position={BOX_AT} />
      <Lathe
        id="tach"
        material="graphite"
        profile={TACH_PROFILE}
        steps={96}
        lineSets={[{ segment: 3, lines: TACH_TICKS }]}
        marks={[4]}
        position={TACH_AT}
        rotation={[-90, 0, 0]}
      />
      <Group id="rotor" moves position={ROTOR_AT}>
        <Lathe
          id="body"
          material="steel"
          profile={ROTOR_PROFILE}
          steps={128}
          lineSets={[
            { segment: 5, lines: ROTOR_RIBS },
            { segment: 14, lines: ROTOR_DIAL },
          ]}
          marks={[15]}
        />
      </Group>
      {/* The subject (react parts) gets the `hi` outline; bands keep the row identical to M1. */}
      <Tube id="tube" material="react" outline="hi" tone="bands" path={TUBE_PATH} radius={TUBE_R} />
    </Group>
  );
}

const add = (a: Vec3, b: Vec3): [number, number, number] => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** The M1 views, around a row placed at `at`. */
export function m1Views(at: Vec3 = [0, 0, 0], prefix = ''): ViewPreset[] {
  const tachFace: Vec3 = [TACH_AT[0], TACH_AT[1] + 1.52, TACH_AT[2]];
  const limb: Vec3 = [ROTOR_AT[0] + 8.5 * Math.SQRT1_2, ROTOR_AT[1] - 8.5 * Math.SQRT1_2, 6];
  const focus = (p: Vec3) => add(p, at);
  return [
    { name: `${prefix}4× box corner`, yaw: 45, elevation: 30, zoom: 4, focus: focus([BOX_AT[0] + 6, BOX_AT[1] + 6, 10]) },
    { name: `${prefix}4× tach`, yaw: 45, elevation: 30, zoom: 4, focus: focus(tachFace) },
    { name: `${prefix}4× rotor limb`, yaw: 45, elevation: 30, zoom: 4, focus: focus(limb) },
    { name: `${prefix}4× tube bend`, yaw: 45, elevation: 30, zoom: 4, focus: focus([-1.6, 11, 11.2]) },
  ];
}

/** The M1 scene on its own: the row at the origin with the M1 view list. */
export const M1_VIEWS: ViewPreset[] = [
  { name: 'fit', yaw: 45, elevation: 30, zoom: 1 },
  { name: 'yaw 20', yaw: 20, elevation: 30, zoom: 1 },
  { name: 'yaw 70', yaw: 70, elevation: 30, zoom: 1 },
  { name: 'yaw 160', yaw: 160, elevation: 30, zoom: 1 },
  { name: 'elev 10', yaw: 45, elevation: 10, zoom: 1 },
  { name: 'elev 60', yaw: 45, elevation: 60, zoom: 1 },
  { name: '0.5× thin', yaw: 45, elevation: 30, zoom: 0.5 },
  ...m1Views(),
];
