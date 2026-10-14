/**
 * The centrifuge (v2 `parts/centrifuge`): an open-top basket centrifuge on a four-legged stand,
 * driven from above. Static in M3, posed at the shot's "in sync" moment: five packets held, three
 * waiting on the feeder.
 *
 * Moving parts for M4: groups `rotor`, `motorPulley`, `gate`, `crank`, `needle`; sprites
 * `lamp.glow` and `lamp.glowSoft`; pools `packets` and `stubBelt.slats`.
 */
import type { PoolHandle } from '@anatomy/engine';
import { Group, Instances, useFrame, useNode } from '../../blocks/blocks.tsx';
import { Bowl } from './Bowl.tsx';
import { Cabinet } from './Cabinet.tsx';
import { Cage } from './Cage.tsx';
import { Coolant } from './Coolant.tsx';
import { Drive } from './Drive.tsx';
import { Instruments } from './Instruments.tsx';
import { Intake } from './Intake.tsx';
import { Rotor } from './Rotor.tsx';
import { Stand } from './Stand.tsx';
import { AudioBelt, Feeder } from './Stubs.tsx';
import { DEG, R, Z, polar } from './dims.ts';

const CAPACITY = 16;
/** Pocket k (centre −90 + 36k) → packet kind (0 control, 1 graph, 2 data). */
const HELD: [pocket: number, kind: number][] = [
  [1, 0],
  [2, 1],
  [4, 2],
  [6, 0],
  [7, 1],
];
const WAITING: [y: number, kind: number][] = [
  [-90, 0],
  [-79, 1],
  [-68, 2],
];

function Packets() {
  const packets = useNode<PoolHandle>('packets');
  useFrame(() => {
    const pool = packets();
    pool.count = HELD.length + WAITING.length;
    HELD.forEach(([k, kind], i) => {
      const deg = -90 + 36 * k;
      pool.pose(i, polar(deg, R.pocket, Z.pocket), deg * DEG);
      pool.style(i, kind);
    });
    WAITING.forEach(([y, kind], j) => {
      pool.pose(HELD.length + j, [0, y, 191.4], 90 * DEG);
      pool.style(HELD.length + j, kind);
    });
  });
  return (
    <Instances
      id="packets"
      geo={{ kind: 'box', size: [10, 8, Z.packet], r: 0.6, center: [0, 0, Z.packet / 2], seams: [Z.packet * 0.55] }}
      styles={[
        { material: 'pkControl', outline: 'hi' },
        { material: 'pkGraph', outline: 'hi' },
        { material: 'pkData', outline: 'hi' },
      ]}
      capacity={CAPACITY}
      marks={{ material: 'pkControl', segments: [{ a: [-5, 0, Z.packet], b: [5, 0, Z.packet], tone: 'lo', normal: [0, 0, 1] }] }}
    />
  );
}

export function Centrifuge() {
  return (
    <>
      <Group id="centrifuge" contacts={false}>
        <Stand />
        <Bowl />
        <Rotor />
        <Cage />
        <Drive />
        <Intake />
        <Instruments />
        <Coolant />
        <Cabinet />
        <Packets />
      </Group>
      <Feeder />
      <AudioBelt />
    </>
  );
}
