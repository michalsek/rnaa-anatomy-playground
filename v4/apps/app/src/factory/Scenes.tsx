/**
 * Scenes built from machine blocks over one live graph each (`live.ts`):
 * - `CentrifugeScene`: the centrifuge between a short belt B (fed by a source in a hopper) and a
 *   short audio loop (its garbage drops into a bin);
 * - `LineScene`: source → belt B → centrifuge → audio loop → belt C → crusher, at the final
 *   layout (§2.1);
 * - `ConveyorScene`: v2's conveyor page; `CrusherScene`: v2's crusher page (a source over a short
 *   belt C); `ScannerScene`: v2's scanner page (a source over the loop, the scanner, belt D).
 * The line also runs the read and output paths: the scanner reads the loop, belt D carries its
 * packets to the elevator, which lifts them to the speaker. `OutputScene`: a source over a short
 * belt D, the elevator and the speaker.
 * Stand-ins: the hopper hides where a source makes packets; a crate hides where a sink takes them.
 */
import { useSyncExternalStore } from 'react';
import { type Conveyor, type ConveyorPageGraph, type CrusherPageGraph, type FactoryGraph, type LineGraph, type OutputPageGraph, type PackerPageGraph, type ScannerPageGraph, type Sink, type V3 } from '@anatomy/engine';
import { Box, Group, Lathe, useFrame } from '../blocks/blocks.tsx';
import { PacketPool } from '../machines/Packets.tsx';
import { Centrifuge } from '../machines/centrifuge/Centrifuge.tsx';
import { Crusher } from '../machines/crusher/Crusher.tsx';
import { Elevator } from '../machines/elevator/Elevator.tsx';
import { Packer } from '../machines/packer/Packer.tsx';
import { Phone } from '../machines/phone/Phone.tsx';
import { Speaker } from '../machines/speaker/Speaker.tsx';
import { Scanner } from '../machines/scanner/Scanner.tsx';
import { Loop } from '../machines/conveyor/Loop.tsx';
import { Top } from '../machines/conveyor/Top.tsx';
import { corners, rod } from '../machines/kit.ts';
import { usePacketPoses } from '../machines/poses.ts';
import { RevealDriver } from './RevealDriver.tsx';
import { TourDriver } from './TourDriver.tsx';
import { standsStore } from './stands.ts';
import { type Live, type LiveHandle, centrifugeLive, conveyorLive, crusherLive, factoryLive, lineLive, outputLive, packerLive, scannerLive } from './live.ts';

/**
 * A closed hopper over the source's point (v2 conveyor page's demo hopper), on two posts either
 * side of it along `across` (across the belt below it).
 */
function Hopper({ source, legs, across = 'x', floor = 0 }: { source: { origin: V3; from: V3 }; legs: boolean; across?: 'x' | 'y'; floor?: number }) {
  const [x, y, z] = source.from;
  const z0 = z - 6;
  const z1 = z + 12;
  return (
    <Group id="hopper" position={[source.origin[0] + x, source.origin[1] + y, 0]} rotation={across === 'y' ? [0, 0, 90] : [0, 0, 0]}>
      <Box id="box" material="steel" {...corners([-6.5, -6, z0], [6.5, 6, z1])} r={0.8} seams={[z0 + 3, z1 - 3]} />
      <Box id="lip" material="steel" outline="lo" {...corners([-7.9, -7.4, z1], [7.9, 7.4, z1 + 1.2])} r={1} />
      {[-1, 1].map((side) => (
        <Group key={side} id={`post${side > 0 ? 1 : 0}`} position={[side * 18.5, 0, 0]}>
          {legs && <Lathe id="post" material="steel" profile={rod(1.0, floor + 1.2, z1 - 4)} steps={16} />}
          {legs && <Box id="foot" material="steel" outline="lo" {...corners([-3, -3, floor], [3, 3, floor + 1.2])} r={0.8} />}
          <Box id="arm" material="steel" outline="lo" {...corners([side > 0 ? -12 : 1, -1, z1 - 6], [side > 0 ? -1 : 12, 1, z1 - 4])} r={0.3} />
        </Group>
      ))}
    </Group>
  );
}

/** A closed bin under the loop's drop: garbage falls into it (the sink takes it inside). */
function BinFrame({ live, sim }: { live: LiveHandle; sim: () => Sink }) {
  const packets = usePacketPoses('packets', sim);
  useFrame((info) => {
    live.step(info);
    packets();
  });
  return null;
}

function SinkBin({
  id = 'bin',
  live,
  sim,
  crate,
}: {
  id?: string;
  live: LiveHandle;
  sim: () => Sink;
  /** The crate's corners in the sink's frame. */
  crate: readonly [readonly [number, number, number], readonly [number, number, number]];
}) {
  const origin = sim().origin;
  return (
    <Group id={id} position={[...origin]} contacts={false}>
      <BinFrame live={live} sim={sim} />
      <Box id="crate" material="steel" {...corners(crate[0], crate[1])} r={0.8} seams={[crate[1][2] - 2.5]} />
      <PacketPool capacity={sim().pools.packets} />
    </Group>
  );
}

/** A crate where belt D tips its packets off the head drum (the scanner page). */
function BeltDEnd({ live, sim, belt }: { live: LiveHandle; sim: () => Sink; belt: () => Conveyor }) {
  const [, oy] = belt().geometry.ports.out;
  return <SinkBin id="crateD" live={live} sim={sim} crate={[[-11, oy - 13, 0], [11, oy + 4.5, 6]]} />;
}

function LineOf({ live }: { live: Live<LineGraph> }) {
  const g = live.graph();
  // Without the garbage path, the garbage leaves the head drum moving +x (the bottom run): a
  // crate catches it there.
  const [dx] = g.audio.geometry.ports.drop;
  return (
    <>
      {g.beadSource && <InputPath live={live} />}
      <Top id="beltB" live={live} sim={() => live.graph().beltB} />
      {g.source && <Hopper source={g.source} legs />}
      <Centrifuge live={live} sim={() => live.graph().centrifuge} />
      <Loop id="audio" live={live} sim={() => live.graph().audio} />
      {g.beltC && <Top id="beltC" live={live} sim={() => live.graph().beltC!} />}
      {g.crusher && <Crusher live={live} sim={() => live.graph().crusher!} />}
      {g.sink && <SinkBin live={live} sim={() => live.graph().sink!} crate={[[dx + 1, -9, 0], [dx + 21, 9, 12]]} />}
      {g.scanner && <Scanner live={live} sim={() => live.graph().scanner!} />}
      {g.beltD && <Top id="beltD" live={live} sim={() => live.graph().beltD!} />}
      {g.elevator && <Elevator live={live} sim={() => live.graph().elevator!} />}
      {g.speaker && <Speaker live={live} sim={() => live.graph().speaker!} />}
    </>
  );
}

/** The input path: the bead source's hopper (the dispenser stand-in), belt A, the packer. */
function InputPath({ live, floor = 0 }: { live: Live<LineGraph> | Live<PackerPageGraph>; floor?: number }) {
  const g = live.graph();
  return (
    <>
      <Hopper source={g.beadSource!} legs across="y" floor={floor} />
      <Top id="beltA" live={live} sim={() => live.graph().beltA!} beads floor={floor} />
      <Packer live={live} sim={() => live.graph().packer!} floor={floor} />
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
  const g = live.graph();
  // The bin under belt C's head drum, where it tips (the sink shares belt C's frame).
  const [ox, oy] = g.beltC.geometry.ports.out;
  return (
    <>
      <Top id="beltB" live={live} sim={() => live.graph().beltB} />
      <Hopper source={g.source} legs />
      <Loop id="audio" live={live} sim={() => live.graph().audio} />
      <Top id="beltC" live={live} sim={() => live.graph().beltC} />
      <SinkBin live={live} sim={() => live.graph().sink} crate={[[ox - 11, oy - 8, 0], [ox + 11, oy + 13, 9]]} />
    </>
  );
}

/** v2's crusher page: a spent packet every 2.4 s from a hopper onto a short belt C. */
export function CrusherScene() {
  const live: Live<CrusherPageGraph> = crusherLive;
  const g = live.graph();
  return (
    <>
      <Hopper source={g.source} legs />
      <Top id="beltC" live={live} sim={() => live.graph().beltC} />
      <Crusher live={live} sim={() => live.graph().crusher} />
    </>
  );
}

/** v2's scanner page: a packet every 2.2 s from a hopper onto the loop, the scanner, belt D. */
export function ScannerScene() {
  const live: Live<ScannerPageGraph> = scannerLive;
  const g = live.graph();
  const [dx] = g.audio.geometry.ports.drop;
  return (
    <>
      <Hopper source={g.source} legs across="y" />
      <Loop id="audio" live={live} sim={() => live.graph().audio} />
      <SinkBin live={live} sim={() => live.graph().sink} crate={[[dx + 1, -9, 0], [dx + 21, 9, 12]]} />
      <Scanner live={live} sim={() => live.graph().scanner} />
      <Top id="beltD" live={live} sim={() => live.graph().beltD} />
      <BeltDEnd live={live} sim={() => live.graph().sinkD} belt={() => live.graph().beltD} />
    </>
  );
}

/** The output path: an audio packet every 2.28 s from a hopper onto belt D, the elevator, the speaker. */
export function OutputScene() {
  const live: Live<OutputPageGraph> = outputLive;
  const g = live.graph();
  return (
    <>
      <Hopper source={g.source} legs across="y" />
      <Top id="beltD" live={live} sim={() => live.graph().beltD} />
      <Elevator live={live} sim={() => live.graph().elevator} />
      <Speaker live={live} sim={() => live.graph().speaker} />
    </>
  );
}

/**
 * v2's packer page: the bead source over belt A, the packer, a short belt B tipping into a crate,
 * on v2's raised floor (`PACKER_FLOOR`: the stand's shelf stays readable).
 */
export function PackerScene() {
  const live: Live<PackerPageGraph> = packerLive;
  const g = live.graph();
  const floor = g.sink.floorZ ?? 0;
  const [, oy] = g.beltB.geometry.ports.out;
  return (
    <>
      <InputPath live={live} floor={floor} />
      <Top id="beltB" live={live} sim={() => live.graph().beltB} floor={floor} />
      <SinkBin live={live} sim={() => live.graph().sink} crate={[[-11, oy - 8, floor], [11, oy + 13, floor + 12]]} />
    </>
  );
}

/**
 * The final factory (M10): the phone (case, display, the dispenser over belt A) and every machine
 * at the line's layout, stands per `FACTORY_LAYOUT.stands` (overridable: `stands.ts`).
 */
export function FactoryScene() {
  const live: Live<FactoryGraph> = factoryLive;
  const st = useSyncExternalStore(standsStore.subscribe, standsStore.get, standsStore.get);
  const g = () => live.graph();
  return (
    <>
      <RevealDriver />
      <TourDriver />
      <Phone reveal live={live} sim={() => g().dispenser} reads={() => g().scanner.stats.delivered} />
      <Top id="beltA" reveal live={live} sim={() => g().beltA} beads legs={st.beltA} />
      <Packer reveal live={live} sim={() => g().packer} stand={st.packer} />
      <Top id="beltB" reveal live={live} sim={() => g().beltB} legs={st.beltB} />
      <Centrifuge reveal live={live} sim={() => g().centrifuge} stand={st.centrifuge} />
      <Loop id="audio" reveal live={live} sim={() => g().audio} legs={st.audio} />
      <Top id="beltC" reveal live={live} sim={() => g().beltC} legs={st.beltC} />
      <Crusher reveal live={live} sim={() => g().crusher} stand={st.crusher} />
      <Scanner reveal live={live} sim={() => g().scanner} stand={st.scanner} />
      <Top id="beltD" reveal live={live} sim={() => g().beltD} legs={st.beltD} />
      <Elevator reveal live={live} sim={() => g().elevator} stand={st.elevator} />
      <Speaker reveal live={live} sim={() => g().speaker} stand={st.speaker} />
    </>
  );
}
