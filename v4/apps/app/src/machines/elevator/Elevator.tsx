/**
 * The bucket elevator (v2 `parts/scanner/elevator.mjs`, v2 A's `access: false`): boot and chute,
 * tower and chain, the open head with its turning wheel, the discharge (hopper, duct, spout) and
 * the drive. Its sim (`Elevator` in the scene's graph) moves it through one frame hook: the chain
 * bands' pins (u shift), the wheel's turn, the cradles (five plate pools posed on the chain, rolled
 * round the sprockets), then the packets (chute, boot, cradles, flight, transit, spout).
 * `stand` (default on): the posts' base plates and the chute's leg.
 */
import { type GroupHandle, type PartHandle, type PoolHandle, type Elevator as ElevatorSim, mod } from '@anatomy/engine';
import { useState } from 'react';
import { Group, Halo, Instances, useFrame, useNode, useNodes } from '../../blocks/blocks.tsx';
import type { LiveHandle } from '../../factory/live.ts';
import { PacketPool } from '../Packets.tsx';
import { usePacketPoses } from '../poses.ts';
import { Boot } from './Boot.tsx';
import { CRADLE, EL, chainTotal } from './dims.ts';
import { Drive, Head } from './Head.tsx';
import { Tower } from './Tower.tsx';

interface ElevatorProps {
  live: LiveHandle;
  sim: () => ElevatorSim;
  /** The posts' base plates and the chute's leg. */
  stand?: boolean;
}

const BAND_IDS = EL.strands.map((_, i) => `tower.chain.strand${i}.band`);
const CRADLE_IDS = CRADLE.map((c) => `cradle.${c.id}`);

function Frame({ live, sim }: ElevatorProps) {
  const bands = useNodes<PartHandle>(BAND_IDS);
  const wheel = useNode<GroupHandle>('head.wheel');
  const pools = useNodes<PoolHandle>(CRADLE_IDS);
  const packets = usePacketPoses('packets', sim);
  // The cradle writer, made once per mount (no closure per frame).
  const [w] = useState(() => {
    let ps: readonly PoolHandle[] = [];
    const pose = (i: number, y: number, z: number, roll: number) => {
      for (const p of ps) p.pose(i, 0, y, z, 0, 0, roll);
    };
    return {
      write(el: ElevatorSim, pp: readonly PoolHandle[]) {
        ps = pp;
        const n = el.cradles(pose);
        for (const p of pp) p.count = n;
      },
    };
  });
  const [total] = useState(() => chainTotal(sim().geometry));
  useFrame((info) => {
    live.step(info);
    const el = sim();
    const travel = el.travel();
    const u = mod(travel / total, 1);
    for (const b of bands()) b.uShift = u;
    wheel().spin('x', travel / EL.r);
    w.write(el, pools());
    packets();
  });
  return null;
}

/** One plate of every cradle: a box in the cradle's frame (x across, y = n out, z = t along). */
function CradlePlates({ count }: { count: number }) {
  return (
    <Group id="cradle">
      {CRADLE.map(({ id, p: [x0, x1, n0, n1, t0, t1] }) => (
        <Instances
          key={id}
          id={id}
          geo={{ kind: 'box', size: [x1 - x0, n1 - n0, t1 - t0], center: [(x0 + x1) / 2, (n0 + n1) / 2, (t0 + t1) / 2], r: 0.2 }}
          styles={[{ material: 'steel' }]}
          capacity={count}
        />
      ))}
    </Group>
  );
}

export function Elevator(props: ElevatorProps) {
  const { sim, stand = true } = props;
  const el = sim();
  const g = el.geometry;
  return (
    <Group id={el.id} position={[...el.origin]} contacts={false}>
      <Frame {...props} />
      <Halo id="halo" plan={{ w: 30, d: 66, r: 4 }} position={[0, 7, 0]} />
      <Boot stand={stand} />
      <Tower g={g} stand={stand} />
      <Head g={g} />
      <Drive g={g} />
      <CradlePlates count={el.pools.cradles} />
      <PacketPool capacity={el.pools.packets} />
    </Group>
  );
}
