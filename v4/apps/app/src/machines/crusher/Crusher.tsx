/**
 * The crusher, the Disposer (v2 `parts/crusher`): a double-roll crusher on skids (`stand`,
 * default on: feet, skid rails, cross members and the control box's pedestal). Its sim
 * (`Crusher` in the scene's graph) moves it through one frame hook: rollers, flywheel, pulley,
 * V-belt lacing, the front bearing block's kick and the spring, the gate, the drawer, the pile
 * and chips, the flakes, the needle and the lamp, then the squashed packet.
 */
import {
  type CrusherOutputs,
  type Crusher as CrusherSim,
  type GroupHandle,
  type PartHandle,
  type PoolHandle,
  type SpriteHandle,
  beltPath,
  mod,
} from '@anatomy/engine';
import { useState } from 'react';
import { Group, Instances, useFrame, useNode } from '../../blocks/blocks.tsx';
import type { LiveHandle } from '../../factory/live.ts';
import { PacketPool } from '../Packets.tsx';
import { usePacketPoses } from '../poses.ts';
import { Control } from './Control.tsx';
import { Bin, Chute } from './Discharge.tsx';
import { Drive, Rollers, SPRING_AT } from './Drive.tsx';
import { Base, Housing, Hopper } from './Housing.tsx';
import { CR, FLAKE, VBELT } from './dims.ts';

interface CrusherProps {
  live: LiveHandle;
  sim: () => CrusherSim;
  /** Feet, skid rails, cross members and the control box's pedestal. */
  stand?: boolean;
}

const SPRING_LEN = CR.SPRING.y1 - CR.SPRING.y0 - 0.4;
const RATIO = VBELT.ra / VBELT.rb;

/** The V-belt's centreline in its plane, with arc lengths (lacing clips ride its straight runs). */
function lacingPath() {
  const pts = beltPath({ a: [VBELT.a[0], VBELT.a[1], 0], ra: VBELT.ra, b: [VBELT.b[0], VBELT.b[1], 0], rb: VBELT.rb });
  const cum = [0];
  for (let i = 1; i <= pts.length; i++) {
    const p = pts[i - 1]!;
    const q = pts[i % pts.length]!;
    cum.push(cum[i - 1]! + Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  const total = cum[cum.length - 1]!;
  // Straight = a segment longer than 2 units (arcs are sampled densely); keep its middle 76%.
  const runs: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const len = cum[i + 1]! - cum[i]!;
    if (len > 2) runs.push([cum[i]! + 0.12 * len, cum[i + 1]! - 0.12 * len]);
  }
  const at = (s: number, out: [number, number]) => {
    let i = 0;
    while (i < pts.length - 1 && cum[i + 1]! < s) i++;
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    const t = (s - cum[i]!) / Math.max(1e-9, cum[i + 1]! - cum[i]!);
    out[0] = p[0] + (q[0] - p[0]) * t;
    out[1] = p[1] + (q[1] - p[1]) * t;
    return out;
  };
  return { total, runs, at };
}

function Frame({ live, sim }: CrusherProps) {
  const rollerBack = useNode<GroupHandle>('drive.rollerBack');
  const front = useNode<GroupHandle>('drive.front');
  const rollerFront = useNode<GroupHandle>('drive.front.rollerFront');
  const spring = useNode<PoolHandle>('drive.spring');
  const fly = useNode<GroupHandle>('power.fly');
  const pulley = useNode<GroupHandle>('power.pulley');
  const lacing = useNode<PoolHandle>('power.vbelt.lacing');
  const gate = useNode<GroupHandle>('chute.gate');
  const bin = useNode<GroupHandle>('bin');
  const pile = useNode<PoolHandle>('bin.pile');
  const chips = useNode<PoolHandle>('bin.chips');
  const flakes = useNode<PoolHandle>('flakes');
  const needle = useNode<GroupHandle>('control.dial.needle');
  const lens = useNode<PartHandle>('control.lamp.lens');
  const glow = useNode<SpriteHandle>('control.lamp.glow');
  const glowSoft = useNode<SpriteHandle>('control.lamp.glowSoft');
  const packets = useNode<PoolHandle>('packets');
  const packetPoses = usePacketPoses('packets', sim);
  // Scratch and callbacks, made once per mount.
  const [s] = useState(() => {
    const o: CrusherOutputs = { phase: 0, belt: 0, spin: 0, kick: 0, lamp: 0, needle: 0, gate: 0, bin: 0, pile: 0, fill: 0 };
    const path = lacingPath();
    const p: [number, number] = [0, 0];
    let ch: PoolHandle | null = null;
    let fl: PoolHandle | null = null;
    let pk: PoolHandle | null = null;
    return {
      o,
      path,
      p,
      bind(c: PoolHandle, f: PoolHandle, k: PoolHandle) {
        ch = c;
        fl = f;
        pk = k;
      },
      chip(i: number, x: number, y: number, z: number, yaw: number, size: number, grow: number) {
        const g = Math.max(0.05, size * grow);
        ch!.pose(i, x, y, z, yaw);
        ch!.scale(i, g, g, 1);
      },
      flake(i: number, x: number, y: number, z: number, roll: number, size: number, flat: number) {
        fl!.pose(i, x, y, z, 0, 0, roll);
        fl!.scale(i, size * (1 - 0.4 * flat), size * (1 - 0.4 * flat), size * (1 - 0.8 * flat));
      },
      squash(i: number, sx: number, sy: number, sz: number) {
        pk!.scale(i, sx, sy, sz);
      },
    };
  });
  useFrame((info) => {
    live.step(info);
    const c = sim();
    const { o } = s;
    c.outputs(o);
    // The rollers turn toward the nip: the back one's top runs +y, the front one's −y.
    rollerBack().spin('z', mod(-o.phase, 2 * Math.PI));
    rollerFront().spin('z', mod(o.phase, 2 * Math.PI));
    front().translate(0, o.kick, 0);
    const sp = spring();
    sp.count = 1;
    sp.pose(0, SPRING_AT[0], SPRING_AT[1], SPRING_AT[2], 0, 0, Math.PI / 2);
    sp.scale(0, 1, 1, Math.max(0.2, (SPRING_LEN - o.kick) / SPRING_LEN));
    fly().spin('z', mod(-o.phase, 2 * Math.PI));
    pulley().spin('z', mod(-o.phase * RATIO, 2 * Math.PI));
    // Lacing clips on the open middle of the two straight runs (the belt runs with the flywheel).
    const lc = lacing();
    const { total, runs, at } = s.path;
    let n = 0;
    for (let d = mod(-o.belt, VBELT.spacing); d < total && n < lc.capacity; d += VBELT.spacing) {
      let open = false;
      for (const [a, b] of runs) if (d > a && d < b) open = true;
      if (!open) continue;
      at(d, s.p);
      lc.pose(n++, s.p[0], s.p[1], CR.BELT_R - 0.15);
    }
    lc.count = n;
    gate().translate(0, 0, o.gate);
    bin().translate(0, o.bin, 0);
    const pl = pile();
    pl.count = o.pile > 0.01 ? 1 : 0;
    if (pl.count) {
      // A heap more than a slab: it also spreads from the middle as the bin fills.
      const spread = Math.min(1, 0.45 + 0.9 * o.fill);
      pl.pose(0, 0, 0, 0);
      pl.scale(0, spread, spread, o.pile);
    }
    const chp = chips();
    const flk = flakes();
    const pk = packets();
    s.bind(chp, flk, pk);
    chp.count = c.chips(s.chip);
    flk.count = c.flakes(s.flake);
    needle().spin('z', o.needle);
    lens().mix = o.lamp;
    glow().level = o.lamp;
    glowSoft().level = o.lamp;
    packetPoses();
    c.scales(s.squash);
  });
  return null;
}

export function Crusher(props: CrusherProps) {
  const { sim, stand = true } = props;
  const c = sim();
  return (
    <Group id={c.id} position={[...c.origin]} contacts={false}>
      <Frame {...props} />
      <Base stand={stand} />
      <Housing />
      <Hopper />
      <Rollers />
      <Drive />
      <Chute />
      <Bin plan={c.pilePlan} chips={c.pools.chips} />
      <Control stand={stand} />
      <Instances
        id="flakes"
        geo={{ kind: 'box', size: FLAKE, center: [0, 0, FLAKE[2] / 2], r: 0.15 }}
        styles={[{ material: 'pkGarbage', outline: 'hi' }]}
        capacity={c.pools.flakes}
        scalable
      />
      <PacketPool capacity={c.pools.packets} scalable />
    </Group>
  );
}
