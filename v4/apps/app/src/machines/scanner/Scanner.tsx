/**
 * The scanner, the platform audio callback (v2 `parts/scanner`): a hard-disk read arm on a
 * pedestal beside the audio loop, its flex ribbon and round cable to the preamp. Its sim
 * (`Scanner` in the scene's graph) moves it through one frame hook: the arm's angle (the head
 * tracks a cleat, seeks back at each read), the ribbon laid along its curve, the mint pulse along
 * ribbon and cable, the lamp, the buffer cells, then the packet pushed off the preamp's lip.
 * `stand` (default on): the floor plate's feet and the preamp's legs.
 */
import {
  type GroupHandle,
  type PartHandle,
  type PoolHandle,
  RIBBON_N,
  SCANNER_POOLS,
  type ScannerOutputs,
  type Scanner as ScannerSim,
  type SpriteHandle,
  clamp01,
  ribbonCurve,
} from '@anatomy/engine';
import { useState } from 'react';
import { Group, useFrame, useNode, useNodes } from '../../blocks/blocks.tsx';
import type { LiveHandle } from '../../factory/live.ts';
import { PacketPool } from '../Packets.tsx';
import { usePacketPoses } from '../poses.ts';
import { Base, Pedestal } from './Base.tsx';
import { CABLE_PIECES, CELLS, SC, SCANNER_CABLE } from './dims.ts';
import { Arm, Fittings, Motor, Ribbon } from './Head.tsx';
import { Cable, Preamp } from './Preamp.tsx';

interface ScannerProps {
  live: LiveHandle;
  sim: () => ScannerSim;
  /** The floor plate's levelling feet and the preamp's legs. */
  stand?: boolean;
}

const CELL_IDS = CELLS.map((_, i) => `preamp.cell${i}`);
const PIECE_IDS = CABLE_PIECES.map((_, i) => `cable.piece${i}`);
/** Half the mint band a pulse lights on the ribbon (v2: ±3), and its soft edge. */
const BAND = 3;
const EDGE = 1;
/** A strip runs this far into its neighbours (the joints stay buried: no lines across the ribbon). */
const OVERLAP = 0.15;

function Frame({ live, sim }: ScannerProps) {
  const arm = useNode<GroupHandle>('head.arm');
  const ribbon = useNode<PoolHandle>('head.ribbon');
  const lens = useNode<PartHandle>('head.lamp.lens');
  const glow = useNode<SpriteHandle>('head.lamp.glow');
  const glowSoft = useNode<SpriteHandle>('head.lamp.glowSoft');
  const cells = useNodes<PartHandle>(CELL_IDS);
  const pieces = useNodes<PartHandle>(PIECE_IDS);
  const packets = usePacketPoses('packets', sim);
  // Scratch, made once per mount.
  const [s] = useState(() => {
    const o: ScannerOutputs = { head: 0, theta: 0, lamp: 0, cells: CELLS.map(() => 0) };
    const pulses = new Float64Array(SCANNER_POOLS.pulses);
    let n = 0;
    return {
      o,
      pts: new Float64Array(2 * RIBBON_N + 2),
      len: new Float64Array(RIBBON_N + 1),
      pulses,
      get n() {
        return n;
      },
      collect(sc: ScannerSim) {
        n = 0;
        sc.pulses((_, d) => {
          if (n < pulses.length) pulses[n++] = d;
        });
      },
    };
  });
  useFrame((info) => {
    live.step(info);
    const sc = sim();
    const { o, pts, len, pulses } = s;
    sc.outputs(o);
    arm().spin('z', -o.theta);
    s.collect(sc);
    const n = s.n;
    // The ribbon along the curve for this angle; mint where a pulse is (distance from the arm).
    ribbonCurve(o.theta, pts, len);
    const rb = ribbon();
    for (let i = 0; i < RIBBON_N; i++) {
      const x0 = pts[2 * i]!;
      const y0 = pts[2 * i + 1]!;
      const dx = pts[2 * i + 2]! - x0;
      const dy = pts[2 * i + 3]! - y0;
      const mid = (len[i]! + len[i + 1]!) / 2;
      let mix = 0;
      for (let k = 0; k < n; k++) mix = Math.max(mix, clamp01(1 - (Math.abs(mid - pulses[k]!) - BAND) / EDGE));
      rb.pose(i, x0 + dx / 2, y0 + dy / 2, SC.flexZ[0], Math.atan2(dy, dx));
      rb.scale(i, Math.hypot(dx, dy) + 2 * OVERLAP, 1, 1);
      rb.style(i, 0);
      rb.blend(i, 1, mix);
    }
    rb.count = RIBBON_N;
    // The cable, piece by piece (v2: a gaussian 0.05 of the cable wide).
    const ps = pieces();
    for (let j = 0; j < ps.length; j++) {
      const mid = CABLE_PIECES[j]!.mid;
      let on = 0;
      for (let k = 0; k < n; k++) {
        const u = (pulses[k]! - sc.ribbonLength) / SCANNER_CABLE.total;
        on = Math.max(on, Math.exp(-(((mid - u) / 0.05) ** 2)));
      }
      ps[j]!.mix = on < 0.01 ? 0 : on;
    }
    const cs = cells();
    for (let i = 0; i < cs.length; i++) cs[i]!.mix = o.cells[i]!;
    lens().mix = o.lamp;
    glow().level = o.lamp;
    glowSoft().level = o.lamp;
    packets();
  });
  return null;
}

export function Scanner(props: ScannerProps) {
  const { sim, stand = true } = props;
  const sc = sim();
  return (
    <Group id={sc.id} position={[...sc.origin]} contacts={false}>
      <Frame {...props} />
      <Base stand={stand} />
      <Pedestal />
      <Group id="head">
        <Motor />
        <Arm />
        <Ribbon />
        <Fittings />
      </Group>
      <Preamp stand={stand} />
      <Cable />
      <PacketPool capacity={SCANNER_POOLS.packets} />
    </Group>
  );
}
