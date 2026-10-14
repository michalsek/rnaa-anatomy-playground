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
} from '@anatomy/engine';
import { Box, Group, Lathe, Tube, useFrame, useNode } from '../blocks/blocks.tsx';
import { M1 } from './views.ts';

const { BOX_AT, ROTOR_AT, STANDOFF, TACH_AT } = M1;
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
