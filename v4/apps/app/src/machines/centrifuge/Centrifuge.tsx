/**
 * The centrifuge (v2 `parts/centrifuge`): an open-top basket centrifuge on a four-legged stand,
 * driven from above, with the stub feeder above and the audio belt below. M4: animated by the
 * engine sim (`live.ts`) through one `useFrame` that writes the moving groups, the lamp glows and
 * the two pools (packets, slats). No React state per frame and no per-frame allocation.
 */
import {
  CF,
  type GroupHandle,
  type Kind,
  type Outputs,
  type PoolHandle,
  type SpriteHandle,
  type Status,
} from '@anatomy/engine';
import { useState } from 'react';
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
import { DEG, Z } from './dims.ts';
import { ctl, readout, sim } from './live.ts';

const TAU = Math.PI * 2;
/** The needle is drawn on the sync tick (70% of the 270° sweep from −135°). */
const SYNC_DEG = -135 + 270 * 0.7;
const mod = (a: number, n: number) => ((a % n) + n) % n;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

function Packets() {
  return (
    <Instances
      id="packets"
      geo={{ kind: 'box', size: [10, 8, Z.packet], r: 0.6, center: [0, 0, Z.packet / 2], seams: [Z.packet * 0.55] }}
      styles={[
        { material: 'pkControl', outline: 'hi' },
        { material: 'pkGraph', outline: 'hi' },
        { material: 'pkData', outline: 'hi' },
      ]}
      capacity={CF.capacity}
      marks={{ material: 'pkControl', segments: [{ a: [-5, 0, Z.packet], b: [5, 0, Z.packet], tone: 'lo', normal: [0, 0, 1] }] }}
    />
  );
}

/** The one frame hook: step the sim, then write its outputs into the scene. */
function useCentrifugeFrame() {
  const rotor = useNode<GroupHandle>('centrifuge.rotor');
  const motor = useNode<GroupHandle>('centrifuge.drive.motorPulley');
  const gate = useNode<GroupHandle>('centrifuge.bowl.gate');
  const crank = useNode<GroupHandle>('centrifuge.instruments.crank-mount.crank');
  const needle = useNode<GroupHandle>('centrifuge.instruments.tach.needle');
  const glow = useNode<SpriteHandle>('centrifuge.instruments.lamp.glow');
  const glowSoft = useNode<SpriteHandle>('centrifuge.instruments.lamp.glowSoft');
  const packets = useNode<PoolHandle>('centrifuge.packets');
  const slats = useNode<PoolHandle>('stubBelt.slats');
  // Scratch objects and callbacks, made once per mount.
  const [scratch] = useState(() => {
    const o: Outputs = { rotor: 0, motor: 0, open: 0, share: 0, lamp: 0 };
    const status = sim.status();
    let pk: PoolHandle | null = null;
    let sl: PoolHandle | null = null;
    const posePacket = (i: number, kind: Kind, x: number, y: number, z: number, yaw: number) => {
      pk!.pose(i, x, y, z, yaw);
      pk!.style(i, kind);
    };
    const poseSlat = (j: number, x: number) => sl!.pose(j, x, CF.belt.y, CF.belt.top - 0.6);
    return {
      o,
      status,
      posePacket,
      poseSlat,
      bind(p: PoolHandle, s: PoolHandle) {
        pk = p;
        sl = s;
      },
    };
  });
  useFrame(({ dt }) => {
    const { o } = scratch;
    sim.advance(ctl.paused ? 0 : dt, ctl.speed);
    sim.outputs(o);
    // Wrap the angles only here: the sim keeps A unwrapped for its pocket crossings.
    rotor().spin('z', mod(o.rotor - CF.restAngle, TAU));
    motor().spin('z', mod(o.motor, TAU));
    gate().translate(0, 0, CF.gateLift * o.open);
    crank().spin('z', -60 * DEG * o.open);
    needle().spin('z', (-135 + 270 * clamp01(0.7 * o.share) - SYNC_DEG) * DEG);
    glow().level = o.lamp;
    glowSoft().level = o.lamp;
    const pk = packets();
    const sl = slats();
    scratch.bind(pk, sl);
    pk.count = sim.packets(scratch.posePacket);
    sl.count = sim.slats(scratch.poseSlat);
    readout.publish(sim.status(scratch.status as Status), performance.now());
  });
}

export function Centrifuge() {
  useCentrifugeFrame();
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
