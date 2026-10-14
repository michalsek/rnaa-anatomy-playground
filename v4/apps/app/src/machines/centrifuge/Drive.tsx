/**
 * The drive (v2 L401–471): motor plate on a spacer, the graphite motor with its ribs and
 * terminal box, the motor pulley (a moving group for M4), and the belt over both pulleys.
 */
import { type LineSetSpec, type ProfilePoint, boltCircle } from '@anatomy/engine';
import { Belt, Box, Extrude, Group, Lathe, Marks } from '../../blocks/blocks.tsx';
import { MOTOR, Z, closed, corners, disc, pulley, screws, spokes } from './dims.ts';

/** The motor can: a straight drum (ribbed between z 168 and 175.6), a chamfer and a lid. */
const MOTOR_CAN: ProfilePoint[] = [
  [0, 167],
  [7, 167],
  [7, 168],
  [7, 175.6], // segment 2: ribs
  [7, 176.4],
  [6.4, 177],
  [6.4, 177.6],
  [0, 177.6],
];
const RIBS: LineSetSpec = {
  count: 36, phase: 0, first: 0, last: 35, majorEvery: 0, minor: 'lo', major: 'lo',
  width: 0.6, majorWidth: 0.6, fade: [0.1, 0.55],
};
const BOX = { x: MOTOR[0] - 4, y: 7, w: 8, d: 4, z0: 168.5, h: 6 };
const UP = [0, 0, 1] as const;

export function Drive() {
  const boxTop = BOX.z0 + BOX.h;
  const inset = 0.7;
  return (
    <Group id="drive">
      <Box id="motor-spacer" material="steel" {...corners([26, -1.5, Z.arm[1]], [30, 1.5, Z.plate[0]])} r={0.3} />
      <Extrude
        id="motor-plate"
        material="steel"
        plan={{ rect: [30, 18], r: 1.2, steps: 4 }}
        z={Z.plate[0]}
        height={Z.plate[1] - Z.plate[0]}
        seams={[(Z.plate[0] + Z.plate[1]) / 2]}
        position={[41, 0, 0]}
      />
      <Marks id="motor-plate-screws" material="steel" {...screws([[28.5, -6.5], [28.5, 6.5]], Z.plate[1], 1, 0.4)} />
      <Group id="motor" position={MOTOR}>
        <Lathe id="flange" material="graphite" profile={disc(8.5, Z.plate[1], Z.plate[1] + 1.4)} />
        <Marks id="flange-dots" material="graphite" dots={boltCircle({ center: [0, 0, Z.plate[1] + 1.4], r: 7.6, count: 6, phase: 30, size: 0.4 })} />
        <Lathe id="can" material="graphite" profile={MOTOR_CAN} marks={[2, 3]} lineSets={[{ segment: 2, lines: RIBS }]} />
        <Lathe id="shaft" material="steel" profile={disc(1, 177.6, Z.pulley[0])} steps={24} />
      </Group>
      <Group id="motorPulley" moves position={MOTOR}>
        <Lathe
          id="pulley"
          material="steel"
          outline="hi"
          crease="lo"
          profile={pulley(4, 3.5, 1.3)}
          marks={[5, 6]}
          lineSets={[{ segment: 5, lines: spokes(0) }]}
        />
      </Group>
      <Box id="terminal-box" material="graphite" {...corners([BOX.x, BOX.y, BOX.z0], [BOX.x + BOX.w, BOX.y + BOX.d, boxTop])} r={0.5} />
      <Marks
        id="terminal-box-marks"
        material="graphite"
        segments={closed(
          [
            [BOX.x + inset, BOX.y + inset, boxTop],
            [BOX.x + BOX.w - inset, BOX.y + inset, boxTop],
            [BOX.x + BOX.w - inset, BOX.y + BOX.d - inset, boxTop],
            [BOX.x + inset, BOX.y + BOX.d - inset, boxTop],
          ],
          UP,
          'faint',
        )}
        dots={[
          { at: [BOX.x + 1.2, BOX.y + 1, boxTop], size: 0.38, normal: UP },
          { at: [BOX.x + BOX.w - 1.2, BOX.y + BOX.d - 1, boxTop], size: 0.38, normal: UP },
        ]}
      />
      <Extrude id="gland" material="graphite" plan={{ circle: 1.1, steps: 16 }} z={boxTop} height={1.4} position={[BOX.x + BOX.w / 2, BOX.y + BOX.d / 2, 0]} />
      <Belt id="belt" material="graphite" a={[0, 0, Z.belt]} ra={5.5 + 1} b={[MOTOR[0], MOTOR[1], Z.belt]} rb={4 + 1} radius={1} />
    </Group>
  );
}
