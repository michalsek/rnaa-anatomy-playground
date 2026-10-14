/**
 * The centrifuge (v2 `parts/centrifuge`): an open-top basket centrifuge on a four-legged stand
 * (`stand`, default on), driven from above. Its sim (`Centrifuge` in the scene's graph, M5: between
 * a real belt B and the real audio loop) moves it through one `useFrame` that writes the moving
 * groups, the lamp glows and the packet pool. No React state per frame, no per-frame allocation.
 */
import { CF, type Centrifuge as CentrifugeSim, type GroupHandle, type Outputs, type SpriteHandle, TAU, clamp01, mod } from '@anatomy/engine';
import { useState } from 'react';
import { Group, useFrame, useNode } from '../../blocks/blocks.tsx';
import type { LiveHandle } from '../../factory/live.ts';
import { PacketPool } from '../Packets.tsx';
import type { V3 } from '../kit.ts';
import { usePacketPoses } from '../poses.ts';
import { Bowl } from './Bowl.tsx';
import { Cabinet } from './Cabinet.tsx';
import { Cage } from './Cage.tsx';
import { Coolant } from './Coolant.tsx';
import { Drive } from './Drive.tsx';
import { Instruments } from './Instruments.tsx';
import { Intake } from './Intake.tsx';
import { Rotor } from './Rotor.tsx';
import { Stand } from './Stand.tsx';
import { DEG } from './dims.ts';

/** The needle is drawn on the sync tick (70% of the 270° sweep from −135°). */
const SYNC_DEG = -135 + 270 * 0.7;

interface CentrifugeProps {
  live: LiveHandle;
  sim: () => CentrifugeSim;
  /** The four-legged stand (v2 `stand`). */
  stand?: boolean;
}

/** The one frame hook: step the sim (once per frame), then write its outputs into the scene. */
function useCentrifugeFrame(live: LiveHandle, sim: () => CentrifugeSim) {
  const rotor = useNode<GroupHandle>('rotor');
  const motor = useNode<GroupHandle>('drive.motorPulley');
  const gate = useNode<GroupHandle>('bowl.gate');
  const crank = useNode<GroupHandle>('instruments.crank-mount.crank');
  const needle = useNode<GroupHandle>('instruments.tach.needle');
  const glow = useNode<SpriteHandle>('instruments.lamp.glow');
  const glowSoft = useNode<SpriteHandle>('instruments.lamp.glowSoft');
  const packets = usePacketPoses('packets', sim);
  // The outputs scratch, made once per mount.
  const [o] = useState((): Outputs => ({ rotor: 0, motor: 0, open: 0, share: 0, lamp: 0 }));
  useFrame((info) => {
    live.step(info);
    sim().outputs(o);
    // Wrap the angles only here: the sim keeps A unwrapped for its pocket crossings.
    rotor().spin('z', mod(o.rotor - CF.restAngle, TAU));
    motor().spin('z', mod(o.motor, TAU));
    gate().translate(0, 0, CF.gateLift * o.open);
    crank().spin('z', -60 * DEG * o.open);
    needle().spin('z', (-135 + 270 * clamp01(0.7 * o.share) - SYNC_DEG) * DEG);
    glow().level = o.lamp;
    glowSoft().level = o.lamp;
    packets();
  });
}

function Frame({ live, sim }: CentrifugeProps) {
  useCentrifugeFrame(live, sim);
  return null;
}

export function Centrifuge(props: CentrifugeProps) {
  const { sim, stand = true } = props;
  const origin: V3 = [...sim().origin];
  return (
    <Group id="centrifuge" position={origin} contacts={false}>
      <Frame {...props} />
      {stand && <Stand />}
      <Bowl />
      <Rotor />
      <Cage />
      <Drive />
      <Intake />
      <Instruments />
      <Coolant />
      <Cabinet />
      <PacketPool capacity={sim().pools.packets} />
    </Group>
  );
}
