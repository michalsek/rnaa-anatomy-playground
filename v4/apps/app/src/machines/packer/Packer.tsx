/**
 * The packer (v2 `parts/packer/packer.mjs`, `rig.mjs`, `live.src.js`): a packaging cell on a raised
 * deck. Beads roll off belt A over the transfer plate into the three-pocket gutter; the picker
 * lifts all three into the open carton at S1; the walking beam indexes cartons S0 (erected from a
 * blank the pusher slides out of the magazine) → S1 → S2, where the folder closes the flaps and
 * tapes them; the next stroke pushes the packet off the lane nose onto belt B.
 *
 * Its sim (`Packer` in the scene's graph) moves it through one frame hook: the two arms (solved
 * from the sim's tool points, `solveArm`), the pusher's plate and rod, the erector's pad and rod,
 * the beam's fingers, the pocket LEDs and the vacuum lamps, the cartons (floor, walls scaled to
 * their height, four flaps on their hinges, the tape), the magazine's stack, the beads, then the
 * taped packets. `stand` (default on): the stand under the deck (v2 A hangs it: `stand: false`;
 * M10 decides).
 */
import {
  type ArmPose,
  type CartonView,
  type GroupHandle,
  type ItemKind,
  type Packer as PackerSim,
  type PackerOutputs,
  type PartHandle,
  type PoolHandle,
  armPose,
  packerOutputs,
  packetStyle,
  solveArm,
} from '@anatomy/engine';
import { useState } from 'react';
import { Box, Group, Instances, Lathe, useFrame, useNode, useNodes } from '../../blocks/blocks.tsx';
import type { LiveHandle } from '../../factory/live.ts';
import { BeadPool } from '../Beads.tsx';
import { PacketPool } from '../Packets.tsx';
import { corners, rod } from '../kit.ts';
import { usePacketPoses } from '../poses.ts';
import { PACKET_STYLES } from '../styles.ts';
import { Arm } from './Arm.tsx';
import { Bridge, Cabinet, Deck, Gutter, Lane, Magazine, Pedestals, PusherBody, Stand } from './Deck.tsx';
import { CAB_LAMP, CARTON, LED_IDS, PK, VACUUM_LAMP } from './dims.ts';

interface PackerProps {
  live: LiveHandle;
  sim: () => PackerSim;
  /** The stand under the deck (legs, stringers, braces, shelf with the receiver and the pump). */
  stand?: boolean;
  /** The floor the stand's legs stand on (v2 `floor`; default 0). */
  floor?: number;
}

const ARM_GROUPS = ['turret', 'turret.link1', 'turret.link1.link2', 'turret.link1.link2.wrist', 'turret.link1.link2.wrist.tool'];
const PICKER_IDS = ARM_GROUPS.map((g) => `picker.${g}`);
const FOLDER_IDS = ARM_GROUPS.map((g) => `folder.${g}`);
const CARTON_IDS = ['carton.floor', 'carton.wallX', 'carton.wallY', 'carton.minor', 'carton.major', 'carton.tape'];
const LIVE_POOLS = ['stack', 'fingers', 'padRod', 'pusherRod'];
const LAMPS = [...LED_IDS, `picker.${ARM_GROUPS[4]}.${VACUUM_LAMP}`, CAB_LAMP];

const { w: CW, d: CD, wall: WALL, flap: FLAP } = CARTON;
const ZT = (c: CartonView) => c.z + c.H - FLAP;

/** Set an arm's five groups from its pose. */
function poseArm(gs: readonly GroupHandle[], q: ArmPose) {
  gs[0]!.spin('z', q.yaw);
  gs[1]!.spin('y', -q.a1);
  gs[2]!.spin('y', -(q.a2 - q.a1));
  gs[3]!.spin('y', q.a2);
  gs[4]!.spin('z', -q.yaw);
}

function Frame({ live, sim }: PackerProps) {
  const picker = useNodes<GroupHandle>(PICKER_IDS);
  const folder = useNodes<GroupHandle>(FOLDER_IDS);
  const cartonPools = useNodes<PoolHandle>(CARTON_IDS);
  const livePools = useNodes<PoolHandle>(LIVE_POOLS);
  const lamps = useNodes<PartHandle>(LAMPS);
  const pad = useNode<GroupHandle>('pad');
  const plate = useNode<GroupHandle>('plate');
  const beadPool = useNode<PoolHandle>('beads');
  const packets = usePacketPoses('packets', sim);
  // The writers, made once per mount (no closure per frame).
  const [w] = useState(() => {
    const o: PackerOutputs = packerOutputs();
    const qp = armPose();
    const qf = armPose();
    let cp: readonly PoolHandle[] = [];
    let nTape = 0;
    let st: PoolHandle | null = null;
    let lifted = false;
    let drop = 0;
    let bp: PoolHandle | null = null;
    const carton = (i: number, c: CartonView) => {
      const [floor, wx, wy, minor, major, tape] = cp as [PoolHandle, PoolHandle, PoolHandle, PoolHandle, PoolHandle, PoolHandle];
      const k = packetStyle(c.kind);
      const h = Math.max(0.05, c.H - FLAP);
      const zt = ZT(c);
      floor.pose(i, c.x, c.y, c.z);
      floor.style(i, k);
      for (const [pool, a, x, y] of [
        [wx, 2 * i, c.x - (CW - WALL) / 2, c.y],
        [wx, 2 * i + 1, c.x + (CW - WALL) / 2, c.y],
        [wy, 2 * i, c.x, c.y - (CD - WALL) / 2],
        [wy, 2 * i + 1, c.x, c.y + (CD - WALL) / 2],
      ] as const) {
        pool.pose(a, x, y, c.z);
        pool.style(a, k);
        pool.scale(a, 1, 1, h);
      }
      // Flaps on their hinges: yaw turns the flap's x inward, pitch −angle lifts it.
      minor.pose(2 * i, c.x - CW / 2, c.y, zt, 0, -c.flaps[0]!, 0);
      minor.pose(2 * i + 1, c.x + CW / 2, c.y, zt, Math.PI, -c.flaps[1]!, 0);
      major.pose(2 * i, c.x, c.y - CD / 2, zt, Math.PI / 2, -c.flaps[2]!, 0);
      major.pose(2 * i + 1, c.x, c.y + CD / 2, zt, -Math.PI / 2, -c.flaps[3]!, 0);
      for (let j = 0; j < 2; j++) {
        minor.style(2 * i + j, k);
        major.style(2 * i + j, k);
      }
      if (c.tape > 0.001) {
        const t = nTape++;
        tape.pose(t, c.x + CW / 2, c.y, c.z + c.H);
        tape.scale(t, CW * c.tape, 1, 1);
      }
    };
    const stack = (i: number, kind: ItemKind) => {
      st!.pose(i, PK.magazine.x, PK.magazine.y, PK.magazine.z + i + (lifted ? 1 : drop));
      st!.style(i, packetStyle(kind));
    };
    const bead = (i: number, x: number, y: number, z: number) => bp!.pose(i, x, y, z);
    return {
      o,
      write(pk: PackerSim, cps: readonly PoolHandle[], lps: readonly PoolHandle[], beads: PoolHandle) {
        pk.outputs(o);
        cp = cps;
        nTape = 0;
        const n = pk.cartons(carton);
        cps[0]!.count = n;
        for (let j = 1; j < 5; j++) cps[j]!.count = 2 * n;
        cps[5]!.count = nTape;
        const [stk, fingers, padRod, pusherRod] = lps as [PoolHandle, PoolHandle, PoolHandle, PoolHandle];
        st = stk;
        lifted = o.stackLifted;
        drop = o.stackDrop;
        stk.count = pk.stack(stack);
        // Beam fingers rise out of the bed's slot (hidden inside it at rest).
        let f = 0;
        for (const y0 of PK.lane.stations) {
          const y = y0 - 4.6 + o.shift;
          if (y > PK.lane.y1 - 1.4) continue;
          fingers.pose(f++, PK.lane.x, y, PK.lane.z - 3 * (1 - o.rise));
        }
        fingers.count = f;
        padRod.pose(0, PK.erector.x, PK.erector.y, o.pad + 1);
        padRod.scale(0, 1, 1, Math.max(0.05, PK.erector.glandZ - o.pad - 1));
        padRod.count = 1;
        pusherRod.pose(0, PK.magazine.x, PK.pusher.glandY, PK.pusher.z, 0, 0, -Math.PI / 2);
        pusherRod.scale(0, 1, 1, Math.max(0.05, o.pusher - 0.6 - PK.pusher.glandY));
        pusherRod.count = 1;
        bp = beads;
        beads.count = pk.beads(bead);
        solveArm(PK.picker.arm, o.picker[0], o.picker[1], o.picker[2], qp);
        solveArm(PK.folder.arm, o.folder[0], o.folder[1], o.folder[2], qf);
      },
      qp,
      qf,
    };
  });
  useFrame((info) => {
    live.step(info);
    const pk = sim();
    w.write(pk, cartonPools(), livePools(), beadPool());
    poseArm(picker(), w.qp);
    poseArm(folder(), w.qf);
    pad().translate(0, 0, w.o.pad - PK.erector.rest);
    plate().translate(0, w.o.pusher - PK.pusher.rest, 0);
    const ls = lamps();
    for (let i = 0; i < 3; i++) ls[i]!.mix = w.o.leds[i] ? 1 : 0;
    ls[3]!.mix = w.o.vacuum ? 1 : 0;
    ls[4]!.mix = w.o.vacuum ? 1 : 0;
    packets();
  });
  return null;
}

/** The carton pools (one instance per carton, two per wall pair and flap pair), stack, fingers, rods. */
function LiveParts({ pools }: { pools: PackerSim['pools'] }) {
  const n = pools.cartons;
  const box = (size: [number, number, number], center: [number, number, number]) => ({ kind: 'box' as const, size, center });
  return (
    <>
      <Group id="carton">
        <Instances id="floor" geo={box([CW, CD, WALL], [0, 0, WALL / 2])} styles={PACKET_STYLES} capacity={n} />
        <Instances id="wallX" geo={box([WALL, CD, 1], [0, 0, 0.5])} styles={PACKET_STYLES} capacity={2 * n} scalable />
        <Instances id="wallY" geo={box([CW, WALL, 1], [0, 0, 0.5])} styles={PACKET_STYLES} capacity={2 * n} scalable />
        <Instances id="minor" geo={box([CARTON.minor.len, 2 * CARTON.minor.half, FLAP], [CARTON.minor.len / 2, 0, FLAP / 2])} styles={PACKET_STYLES} capacity={2 * n} />
        <Instances id="major" geo={box([CARTON.major.len, 2 * CARTON.major.half, FLAP], [CARTON.major.len / 2, 0, FLAP / 2])} styles={PACKET_STYLES} capacity={2 * n} />
        <Instances id="tape" geo={box([1, 1.2, 0.08], [-0.5, 0, 0.04])} styles={[{ material: 'graphite' }]} capacity={2} scalable />
      </Group>
      <Instances id="stack" geo={{ kind: 'box', size: [CW, CD, 1], center: [0, 0, 0.5], r: 0.1 }} styles={PACKET_STYLES} capacity={pools.stack} />
      <Instances id="fingers" geo={{ kind: 'box', size: [1.2, 1.2, 3], center: [0, 0, 1.5], r: 0.15 }} styles={[{ material: 'steel' }]} capacity={3} />
      <Instances id="padRod" geo={{ kind: 'lathe', profile: rod(0.5, 0, 1), steps: 16 }} styles={[{ material: 'steel' }]} capacity={1} scalable />
      <Instances id="pusherRod" geo={{ kind: 'lathe', profile: rod(0.45, 0, 1), steps: 16 }} styles={[{ material: 'steel' }]} capacity={1} scalable />
      <Group id="pad" moves position={[PK.erector.x, PK.erector.y, PK.erector.rest]}>
        <Lathe id="disc" material="steel" profile={rod(2.6, 0, 1)} steps={32} />
      </Group>
      <Group id="plate" moves position={[PK.magazine.x, PK.pusher.rest, 0]}>
        <Box id="plate" material="steel" {...corners([-4, -0.6, PK.pusher.z - 0.45], [4, 0, PK.pusher.z + 0.45])} r={0.1} />
      </Group>
    </>
  );
}

export function Packer(props: PackerProps) {
  const { sim, stand = true, floor = 0 } = props;
  const pk = sim();
  return (
    <Group id={pk.id} position={[...pk.origin]} contacts={false}>
      <Frame {...props} />
      {stand && <Stand floor={floor} />}
      <Deck />
      <Lane />
      <Magazine />
      <PusherBody />
      <Bridge />
      <Gutter />
      <Pedestals />
      <Cabinet />
      <Arm id="picker" spec={PK.picker.arm} tool="picker" />
      <Arm id="folder" spec={PK.folder.arm} tool="folder" />
      <LiveParts pools={pk.pools} />
      <BeadPool capacity={pk.pools.beads} />
      <PacketPool capacity={pk.pools.packets} />
    </Group>
  );
}

