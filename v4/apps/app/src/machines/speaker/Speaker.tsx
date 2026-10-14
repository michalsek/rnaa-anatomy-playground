/**
 * The speaker (v2 `parts/screen/speaker.mjs`): a bare driver, membrane up, on its baffle, with the
 * throat, feed ledge and level meter on its +x side. Its sim (`Speaker` in the scene's graph)
 * moves it through one frame hook: the cone and the dust cap pump along +z, the meter's LEDs jump
 * (E2 blend), then the packets (falling onto the ledge, sliding into the throat).
 * `stand` (default on): the base plate and four posts (off: the baffle's mounting ears and a
 * connector under the baffle, as v2 A hangs it).
 */
import { type GroupHandle, type PartHandle, SPK, type Speaker as SpeakerSim, type SpeakerOutputs } from '@anatomy/engine';
import { useState } from 'react';
import { Group, useFrame, useNode, useNodes } from '../../blocks/blocks.tsx';
import type { LiveHandle } from '../../factory/live.ts';
import { PacketPool } from '../Packets.tsx';
import { usePacketPoses } from '../poses.ts';
import { driver } from './dims.ts';
import { Basket, Cone, Mount, Surround } from './Driver.tsx';
import { Throat, Wiring } from './Throat.tsx';

interface SpeakerProps {
  live: LiveHandle;
  sim: () => SpeakerSim;
  /** The base plate and posts (off: mounting ears, as v2 A). */
  stand?: boolean;
}

const LED_IDS = Array.from({ length: SPK.leds }, (_, i) => `throat.meter.led${i}`);

function Frame({ live, sim }: SpeakerProps) {
  const cone = useNode<GroupHandle>('cone');
  const cap = useNode<GroupHandle>('cap');
  const leds = useNodes<PartHandle>(LED_IDS);
  const packets = usePacketPoses('packets', sim);
  const [o] = useState<SpeakerOutputs>(() => ({ cone: 0, cap: 0, lit: 0, peak: -1 }));
  useFrame((info) => {
    live.step(info);
    sim().outputs(o);
    cone().translate(0, 0, o.cone);
    cap().translate(0, 0, o.cap);
    const ls = leds();
    for (let i = 0; i < ls.length; i++) ls[i]!.mix = i < o.lit || i === o.peak ? 1 : 0;
    packets();
  });
  return null;
}

export function Speaker(props: SpeakerProps) {
  const { sim, stand = true } = props;
  const sp = sim();
  const g = sp.geometry;
  const d = driver(g);
  return (
    <Group id={sp.id} position={[...sp.origin]} contacts={false}>
      <Frame {...props} />
      <Mount d={d} stand={stand} />
      <Basket d={d} />
      <Surround d={d} />
      <Cone d={d} />
      <Throat g={g} d={d} />
      <Wiring d={d} stand={stand} />
      <PacketPool capacity={sp.pools.packets} />
    </Group>
  );
}
