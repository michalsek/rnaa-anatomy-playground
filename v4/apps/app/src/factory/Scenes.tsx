/**
 * Scenes built from machine blocks over one live graph each (`live.ts`):
 * - `CentrifugeScene`: the centrifuge between a short belt B (fed by a source in a hopper) and a
 *   short audio loop (its garbage drops into a bin);
 * - `LineScene`: source → belt B → centrifuge → audio loop → bin, at the final layout (§2.1).
 * Stand-ins: the hopper hides where the source makes packets; the bin hides where the sink takes
 * them (M6 replaces it with belt C and the crusher).
 */
import { type ConveyorPageGraph, type Item, type LineGraph, type PoolHandle, type Sink, packetStyle } from '@anatomy/engine';
import { useState } from 'react';
import { Box, Group, Lathe, useFrame, useNode } from '../blocks/blocks.tsx';
import { PacketPool } from '../machines/Packets.tsx';
import { Centrifuge } from '../machines/centrifuge/Centrifuge.tsx';
import { Loop } from '../machines/conveyor/Loop.tsx';
import { Top } from '../machines/conveyor/Top.tsx';
import { rod } from '../machines/conveyor/dims.ts';
import { corners } from '../machines/kit.ts';
import { type Live, type LiveHandle, centrifugeLive, conveyorLive, lineLive } from './live.ts';

/** A closed hopper over the source point (v2 conveyor page's demo hopper), on two posts. */
function Hopper({ at, legs }: { at: readonly [number, number, number]; legs: boolean }) {
  const [x, y, z] = at;
  const z0 = z - 6;
  const z1 = z + 12;
  return (
    <Group id="hopper" position={[x, y, 0]}>
      <Box id="box" material="steel" {...corners([-6.5, -6, z0], [6.5, 6, z1])} r={0.8} seams={[z0 + 3, z1 - 3]} />
      <Box id="lip" material="steel" outline="lo" {...corners([-7.9, -7.4, z1], [7.9, 7.4, z1 + 1.2])} r={1} />
      {[-1, 1].map((side) => (
        <Group key={side} id={`post${side > 0 ? 1 : 0}`} position={[side * 18.5, 0, 0]}>
          {legs && <Lathe id="post" material="steel" profile={rod(1.0, 1.2, z1 - 4)} steps={16} />}
          {legs && <Box id="foot" material="steel" outline="lo" {...corners([-3, -3, 0], [3, 3, 1.2])} r={0.8} />}
          <Box id="arm" material="steel" outline="lo" {...corners([side > 0 ? -12 : 1, -1, z1 - 6], [side > 0 ? -1 : 12, 1, z1 - 4])} r={0.3} />
        </Group>
      ))}
    </Group>
  );
}

/** A closed bin under the loop's drop: garbage falls into it (the sink takes it inside). */
function BinFrame({ live, sim }: { live: LiveHandle; sim: () => Sink }) {
  const packets = useNode<PoolHandle>('packets');
  const [scratch] = useState(() => {
    let pk: PoolHandle | null = null;
    return {
      pose(i: number, item: Item, x: number, y: number, z: number, yaw: number) {
        pk!.pose(i, x, y, z, yaw);
        pk!.style(i, packetStyle(item.kind));
      },
      bind(p: PoolHandle) {
        pk = p;
      },
    };
  });
  useFrame((info) => {
    live.step(info);
    const pk = packets();
    scratch.bind(pk);
    pk.count = sim().items(scratch.pose);
  });
  return null;
}

function SinkBin({
  live,
  sim,
  crate = [[1, -9, 0], [21, 9, 12]],
}: {
  live: LiveHandle;
  sim: () => Sink;
  /** The crate's corners in the sink's frame. */
  crate?: readonly [readonly [number, number, number], readonly [number, number, number]];
}) {
  const origin = sim().origin;
  return (
    <Group id="bin" position={[...origin]} contacts={false}>
      <BinFrame live={live} sim={sim} />
      <Box id="crate" material="steel" {...corners(crate[0], crate[1])} r={0.8} seams={[crate[1][2] - 2.5]} />
      <PacketPool capacity={8} />
    </Group>
  );
}

function LineOf({ live }: { live: Live<LineGraph> }) {
  const b = live.graph().beltB;
  return (
    <>
      <Top id="beltB" live={live} sim={() => live.graph().beltB} />
      <Group id="feed" position={[...b.origin]}>
        <Hopper at={[0, b.geometry.inS, b.geometry.T + 24]} legs />
      </Group>
      <Centrifuge live={live} sim={() => live.graph().centrifuge} />
      <Loop id="audio" live={live} sim={() => live.graph().audio} />
      <SinkBin live={live} sim={() => live.graph().sink} />
    </>
  );
}

export function CentrifugeScene() {
  return <LineOf live={centrifugeLive} />;
}

export function LineScene() {
  return <LineOf live={lineLive} />;
}

/** v2's conveyor page (checkpoint C): belt B → the audio loop → belt C → the bin, with a hopper. */
export function ConveyorScene() {
  const live: Live<ConveyorPageGraph> = conveyorLive;
  const b = live.graph().beltB;
  return (
    <>
      <Top id="beltB" live={live} sim={() => live.graph().beltB} />
      <Group id="feed" position={[...b.origin]}>
        <Hopper at={[0, 8, 140]} legs />
      </Group>
      <Loop id="audio" live={live} sim={() => live.graph().audio} />
      <Top id="beltC" live={live} sim={() => live.graph().beltC} />
      <SinkBin live={live} sim={() => live.graph().sink} crate={[[-11, 93, 0], [11, 114, 9]]} />
    </>
  );
}
