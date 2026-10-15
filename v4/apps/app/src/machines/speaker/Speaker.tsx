/**
 * The speaker (v2 `parts/screen/speaker.mjs`): a bare driver, membrane up, on its baffle, with the
 * throat, feed ledge and level meter on its +x side. Its sim (`Speaker` in the scene's graph)
 * moves it through one frame hook: the cone and the dust cap pump along +z, the meter's LEDs jump
 * (E2 blend), then the packets (falling onto the ledge, sliding into the throat).
 * `stand` (default on): the base plate and four posts (off: the baffle's mounting ears and a
 * connector under the baffle, as v2 A hangs it). M11: the machine turns by the sim's `yaw` and the
 * driver is drawn `k` (the geometry's `scale`) times v2's size.
 */
import { type GroupHandle, type PartHandle, SPK, type Speaker as SpeakerSim, type SpeakerOutputs } from '@anatomy/engine';
import { useState } from 'react';
import { Group, useFrame, useNode, useNodes } from '../../blocks/blocks.tsx';
import type { LiveHandle } from '../../factory/live.ts';
import { PacketPool } from '../Packets.tsx';
import { usePacketPoses } from '../poses.ts';
import { driver } from './dims.ts';
import { Baffle, Basket, Cone, Stand, Surround } from './Driver.tsx';
import { Terminal, Throat, Wiring } from './Throat.tsx';

interface SpeakerProps {
  /** The factory's reveal moves the whole machine (its root moves, rarely) and clips it to the case. */
  reveal?: boolean;
  live: LiveHandle;
  sim: () => SpeakerSim;
  /** The base plate and posts (off: mounting ears, as v2 A). */
  stand?: boolean;
}

const LED_IDS = Array.from({ length: SPK.leds }, (_, i) => `throat.meter.led${i}`);

function Frame({ live, sim }: SpeakerProps) {
  const cone = useNode<GroupHandle>('driver.cone');
  const cap = useNode<GroupHandle>('driver.cap');
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
    <Group id={sp.id} position={[...sp.origin]} moves={props.reveal === true} rare={props.reveal === true} clip={props.reveal === true} contacts={false}>
      {/* The machine's turn (the sim's yaw); the driver grows by `k` about the baffle's top. */}
      <Group id="body" rotation={[0, 0, sp.yaw ?? 0]}>
        <Frame {...props} />
        {stand && <Stand d={d} />}
        <Group id="driver" position={[0, 0, d.ZB * (1 - d.k)]} scale={d.k}>
          <Baffle d={d} stand={stand} />
          <Basket d={d} />
          <Surround d={d} />
          <Cone d={d} />
          <Terminal d={d} />
        </Group>
        <Throat g={g} d={d} />
        <Wiring d={d} stand={stand} />
        <PacketPool capacity={sp.pools.packets} />
      </Group>
    </Group>
  );
}
