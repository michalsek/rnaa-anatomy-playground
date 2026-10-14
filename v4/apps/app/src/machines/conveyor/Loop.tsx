/**
 * The "loop" conveyor, the audio belt (v2 `parts/conveyor/conveyor.mjs` buildLoop, L262–470): a
 * double-sided belt in a riveted truss (chords, end plates, verticals), carrying idlers on stubs,
 * return rollers on hangers outside the bail straps, pillow blocks, the take-up at the tail
 * (rails, bracket, rod, nut, coil spring), the shaft-mounted graphite gear motor at the head
 * with its torque arm, the lit read lamp at `readAt`, a label plate and (`legs`, default on) legs,
 * feet and cross beams kept below the hanging parcels.
 *
 * Moving: the slats (band u shift, E1), the cleats (a pool pitched round the drums, E3), the
 * parcels (pitched, greyed by a style blend at the read point, E2) and their bail straps (an
 * axis-scaled pool, E3).
 */
import { type Loop as LoopSim, PACKET_SIZE, type PartHandle, type PoolHandle, helix } from '@anatomy/engine';
import { useState } from 'react';
import { Box, Group, Instances, Lathe, Marks, Tube, useFrame, useNode } from '../../blocks/blocks.tsx';
import type { LiveHandle } from '../../factory/live.ts';
import { PacketPool } from '../Packets.tsx';
import { type V3, closed, ring } from '../kit.ts';
import { usePacketPoses } from '../poses.ts';
import { beltKit, rod, slats, turned } from './dims.ts';
import { BeltBody, LabelPlate, Lamp, Motor } from './Parts.tsx';

interface LoopProps {
  id: string;
  live: LiveHandle;
  sim: () => LoopSim;
  /** Legs, feet and cross beams (v2 `legs`); off hangs the truss from its chords. */
  legs?: boolean;
}

/** The loop's frame hook: slats, cleats and bail straps (machine-specific), then the parcels. */
function Frame({ live, sim }: LoopProps) {
  const band = useNode<PartHandle>('body.band');
  const cleats = useNode<PoolHandle>('cleats');
  const straps = useNode<PoolHandle>('straps');
  const packets = usePacketPoses('packets', sim);
  const [scratch] = useState(() => {
    let cl: PoolHandle | null = null;
    let st: PoolHandle | null = null;
    let xAxis = true;
    return {
      cleat(j: number, x: number, y: number, z: number, tilt: number) {
        if (xAxis) cl!.pose(j, x, y, z, 0, tilt, 0);
        else cl!.pose(j, x, y, z, 0, 0, tilt);
      },
      strap(i: number, x: number, y: number, z: number, tilt: number, len: number) {
        if (xAxis) st!.pose(i, x, y, z, 0, tilt, 0);
        else st!.pose(i, x, y, z, 0, 0, tilt);
        st!.scale(i, 1, 1, len);
      },
      bind(c: PoolHandle, s: PoolHandle, x: boolean) {
        cl = c;
        st = s;
        xAxis = x;
      },
    };
  });
  useFrame((info) => {
    live.step(info);
    const s = sim();
    band().uShift = s.uShift();
    const c = cleats();
    const st = straps();
    scratch.bind(c, st, s.geometry.axis === 'x');
    c.count = s.cleats(scratch.cleat);
    st.count = s.straps(scratch.strap);
    packets();
  });
  return null;
}

export function Loop(props: LoopProps) {
  const { id, sim, legs = true } = props;
  const loop = sim();
  const D = loop.geometry;
  const { axis, dir, L, T, W, RW, RD, BT, zc, CH, HOOK } = D;
  const half = W / 2;
  const f = beltKit(loop.frame);
  const flangeR = RW + 2.2;
  const zHang = zc - RW - CH - HOOK - PACKET_SIZE.h;
  const cIn = half + 1.2 + 1.8;
  const cOut = cIn + 1.6;
  const zBot0 = zc - RW + 3.0;
  const zBot1 = zBot0 + 3.2;
  const zTop1 = T - BT - 0.8;
  const zTop0 = zTop1 - 3.6;
  const sEnd = 9;
  const sHead = dir > 0 ? L : 0;
  const sTail = dir > 0 ? 0 : L;
  const inward = dir > 0 ? 1 : -1;
  const toMid = -inward;
  const TAKEUP = 19;
  const verts: number[] = [];
  const nV = Math.max(2, Math.round((L - 2 * sEnd) / 30));
  for (let i = 1; i < nV; i++) {
    const s = sEnd + ((L - 2 * sEnd) * i) / nV;
    if (Math.abs(s - sTail) > TAKEUP + 2) verts.push(s);
  }
  const idlerR = 2.2;
  const idlerZ = T - BT - idlerR;
  const i0 = flangeR + 6;
  const idlers: number[] = [];
  for (let s = i0; s <= L - i0 + 1e-6; s += (L - 2 * i0) / Math.max(1, Math.round((L - 2 * i0) / 16))) idlers.push(s);
  const legAt = [24, L - 24];
  if (L > 150) legAt.splice(1, 0, L / 2);
  const rr = 1.2;
  const rz = zc - RW - rr;
  const c0 = (axis === 'y' ? PACKET_SIZE.w : PACKET_SIZE.d) / 2 + 0.45 + 0.35 + 0.9;
  const nRet = Math.max(2, Math.round(L / 60));
  const returns = Array.from({ length: nRet }, (_, i) => {
    const s = (L * (i + 0.5)) / nRet;
    return legAt.some((x) => Math.abs(x - s) < 5) ? s + 8 : s;
  });
  const pbH = Math.min(3.6, 0.26 * RW);
  const tuC0 = cOut;
  const tuC1 = cOut + 3.0;
  const brS0 = sTail + inward * (TAKEUP - 3);
  const brS1 = sTail + inward * (TAKEUP - 1);
  const rodC = (tuC0 + tuC1) / 2;
  const springFrom = sTail + inward * 4;
  const readS = D.readS;
  const lampS = Math.abs(readS - sHead) < 30 || Math.abs(readS - sTail) < TAKEUP + 4 ? L / 2 : readS;
  // Drive: shaft-mounted gear motor at the head; sizes follow the drum.
  const gC0 = cOut + 3.0;
  const shaftEnd = gC0 + 1.2;
  const gbS = 0.43 * RW;
  const gbDown = 0.53 * RW;
  const gbUp = 0.43 * RW;
  const gbDepth = 0.53 * RW;
  const gC1 = shaftEnd + gbDepth;
  const coverR = Math.min(4.2, gbS - 1);
  const zGb0 = zc - gbDown;
  const a0 = sHead + toMid * 1.6;
  const a1 = sHead + toMid * Math.min(4.4, gbS - 0.8);
  const cLeg0 = cIn - 0.4;
  const cLeg1 = cOut + 0.4;
  const beams = [Math.min(8, zHang - 5)];
  if (zHang - 6 > beams[0]! + 12) beams.push(Math.min(30, zHang - 6));
  const pb = (key: string, s: number, side: number) => {
    const p0 = side * cOut;
    const p1 = side * (cOut + 3.0);
    return (
      <Group key={key} id={key}>
        <Box id="block" material="steel" {...f.box([s - 4, s + 4], [p0, p1], [zc - pbH, zc + pbH])} r={0.8} {...(side > 0 && { seams: [zc] })} />
        {side > 0 && (
          <Marks id="bolts" material="steel" dots={[s - 2.6, s + 2.6].map((ss) => ({ at: f.w(ss, (p0 + p1) / 2, zc + pbH), size: 0.5, normal: [0, 0, 1] as const }))} />
        )}
      </Group>
    );
  };
  const cover = f.alongC(sHead, gC1, zc);
  const cleatSize: V3 = axis === 'x' ? [1.6, W - 1.2, CH] : [W - 1.2, 1.6, CH];
  const strapSize: V3 = axis === 'x' ? [1.4, 0.7, 1] : [0.7, 1.4, 1];
  return (
    <Group id={id} position={loop.origin} contacts={false}>
      <Frame {...props} />
      <BeltBody
        f={f}
        axis={axis}
        dir={dir}
        L={L}
        W={W}
        T={T}
        RD={RD}
        BT={BT}
        flangeR={flangeR}
        flangeT={1.2}
        hubR={0.21 * RW}
        hubL={1.8}
        bolts={12}
        steps={48}
        lines={{ outer: slats(D.total, D.pitch, 'lo'), inner: slats(D.total, D.pitch, 'faint') }}
      />
      {[1, -1].map((side) => {
        const tag = side > 0 ? 'N' : 'F';
        const cc = [side * cIn, side * cOut] as const;
        return (
          <Group key={tag} id={`truss${tag}`}>
            <Box id="chordTop" material="steel" {...f.box([-sEnd, L + sEnd], cc, [zTop0, zTop1])} r={0.2} />
            <Box id="chordBot" material="steel" {...f.box([-sEnd, L + sEnd], cc, [zBot0, zBot1])} r={0.2} />
            {[0, L].map((s, i) => {
              const [a, b] = s === sTail ? [s - inward * sEnd, s + inward * TAKEUP] : [s - sEnd, s + sEnd];
              const lo = Math.min(a, b);
              const hi = Math.max(a, b);
              return (
                <Group key={i} id={`endPlate${i}`}>
                  <Box id="plate" material="steel" {...f.box([lo, hi], cc, [zBot1, zTop0])} r={0.6} />
                  {side > 0 && (
                    <Marks
                      id="rivets"
                      material="steel"
                      dots={[lo + 1.6, (lo + hi) / 2, hi - 1.6].flatMap((ss) => [zBot1 + 1.4, zTop0 - 1.4].map((z) => ({ at: f.w(ss, cOut, z), size: 0.45, normal: f.cV })))}
                    />
                  )}
                </Group>
              );
            })}
            {verts.map((s, i) => (
              <Group key={`v${i}`} id={`vert${i}`}>
                <Box id="bar" material="steel" outline="lo" {...f.box([s - 1.0, s + 1.0], cc, [zBot1, zTop0])} r={0.2} />
                {side > 0 && (
                  <Marks id="rivets" material="steel" dots={[zBot1 + 1.1, zBot1 + 2.3, zTop0 - 2.3, zTop0 - 1.1].map((z) => ({ at: f.w(s, cOut, z), size: 0.4, normal: f.cV }))} />
                )}
              </Group>
            ))}
          </Group>
        );
      })}
      {idlers.map((s, i) => (
        <Group key={`i${i}`} id={`idler${i}`}>
          <Lathe id="roll" material="steel" outline="hi" profile={rod(idlerR, 0, W)} steps={16} seams={[1.6, W - 1.6]} {...f.alongC(s, -half, idlerZ)} />
          <Lathe id="stubN" material="steel" outline="lo" profile={rod(0.7, 0, cIn - half)} steps={10} {...f.alongC(s, half, idlerZ)} />
          <Lathe id="stubF" material="steel" outline="lo" profile={rod(0.7, 0, cIn - half)} steps={10} {...f.alongC(s, -cIn, idlerZ)} />
        </Group>
      ))}
      {returns.map((s, i) => (
        <Group key={`r${i}`} id={`return${i}`}>
          {[1, -1].map((side) => {
            const tag = side > 0 ? 'N' : 'F';
            return (
              <Group key={tag} id={tag}>
                <Lathe id="roller" material="steel" outline="hi" profile={rod(rr, 0, half - c0)} steps={12} {...f.alongC(s, side > 0 ? c0 : -half, rz)} />
                <Lathe id="axle" material="steel" outline="lo" profile={rod(0.5, 0, cIn - 1.2 - half)} steps={8} {...f.alongC(s, side > 0 ? half : -(cIn - 1.2), rz)} />
                <Box id="hanger" material="steel" outline="lo" {...f.box([s - 1.2, s + 1.2], [side * (cIn - 1.2), side * cIn], [rz - 1.8, zBot0 + 2.2])} r={0.3} />
                {side > 0 && <Marks id="dots" material="steel" dots={[f.w(s, cIn, rz), f.w(s, cIn, zBot0 + 1.2)].map((at) => ({ at, size: 0.4, normal: f.cV }))} />}
              </Group>
            );
          })}
        </Group>
      ))}
      {pb('bearingHeadF', sHead, -1)}
      {pb('bearingTailF', sTail, -1)}
      {pb('bearingHead', sHead, 1)}
      {pb('bearingTail', sTail, 1)}
      <Group id="takeup">
        <Box id="railTop" material="steel" outline="lo" {...f.box([sTail + inward * (TAKEUP - 1), sTail - inward * 6], [tuC0, tuC1 - 0.6], [zc + pbH, zc + pbH + 1.4])} r={0.2} />
        <Box id="railBot" material="steel" outline="lo" {...f.box([sTail + inward * (TAKEUP - 1), sTail - inward * 6], [tuC0, tuC1 - 0.6], [zc - pbH - 1.4, zc - pbH])} r={0.2} />
        <Box id="bracket" material="steel" {...f.box([brS0, brS1], [tuC0, tuC1], [zc - pbH, zc + pbH])} r={0.4} />
        <Lathe id="rod" material="steel" outline="hi" profile={rod(0.55, 0, Math.abs(brS0 - springFrom))} steps={10} {...f.alongS(brS0, rodC, zc, -inward)} />
        <Lathe id="nut" material="steel" profile={rod(1.1, 0, 1.0)} steps={6} {...f.alongS(brS1, rodC, zc, inward)} />
        <Tube id="spring" material="steel" path={helix({ from: f.w(springFrom, rodC, zc), to: f.w(brS0, rodC, zc), r: 1.25, turns: 7 })} radius={0.22} sides={6} bend={0} />
      </Group>
      <Lamp f={f} s={lampS} c={cOut} z={(zBot0 + zBot1) / 2} r={1.5} />
      <Group id="drive">
        <Lathe id="shaft" material="graphite" outline="lo" profile={rod(1.6, 0, 1.2)} steps={20} {...f.alongC(sHead, gC0, zc)} />
        <Box id="gearbox" material="graphite" {...f.box([sHead - gbS, sHead + gbS], [shaftEnd, gC1], [zc - gbDown, zc + gbUp])} r={1.6} seams={[zc - 1.5]} />
        <Group id="cover" {...cover}>
          <Lathe id="disc" material="graphite" profile={turned([[0, coverR], [0.9, coverR], [0.9, coverR * 0.57], [1.8, coverR * 0.57]])} steps={28} />
          <Marks
            id="bolts"
            material="graphite"
            dots={Array.from({ length: 8 }, (_, k) => ({ at: [coverR * 0.8 * Math.cos((k * Math.PI) / 4), coverR * 0.8 * Math.sin((k * Math.PI) / 4), 0.9] as const, size: 0.45, normal: [0, 0, 1] as const }))}
            segments={closed(ring([0, 0, 1.8], coverR * 0.28, 16), [0, 0, 1], 'faint')}
          />
        </Group>
        <Lathe id="breather" material="graphite" outline="lo" profile={turned([[0, 0.9], [0.8, 0.9], [0.8, 0.55], [1.6, 0.55]])} steps={12} {...f.up(sHead + 3 * toMid, (shaftEnd + gC1) / 2 + 1.2, zc + gbUp)} />
        {zGb0 >= zBot1 + 0.2 ? (
          <>
            <Box id="torqueArm" material="graphite" outline="lo" {...f.box([a0, a1], [cOut, gC1 - 1.5], [zBot1 - 2.6, zBot1 - 0.4])} r={0.3} />
            <Box id="torqueDrop" material="graphite" outline="lo" {...f.box([a0, a1], [shaftEnd + 1.5, gC1 - 1.5], [zBot1 - 0.4, zGb0])} r={0.3} />
          </>
        ) : (
          <Box id="torqueArm" material="graphite" outline="lo" {...f.box([a0, a1], [cOut, gC1 - 1.5], [Math.max(zBot0 - 1, zGb0 - 2.2), zGb0])} r={0.3} />
        )}
        <Motor f={f} s={sHead + toMid * gbS} c={(shaftEnd + gC1) / 2} z={zc - 1.0} sign={toMid} r={Math.max(3.2, 0.3 * RW)} len={Math.max(16, 1.6 * RW)} />
      </Group>
      {(legs ? legAt : []).map((s, i) => (
        <Group key={`leg${i}`} id={`leg${i}`}>
          {[1, -1].map((side) => {
            const tag = side > 0 ? 'N' : 'F';
            const cm = side * ((cLeg0 + cLeg1) / 2);
            return (
              <Group key={tag} id={tag}>
                <Box id="leg" material="steel" {...f.box([s - 1.4, s + 1.4], [side * cLeg0, side * cLeg1], [1.4, zBot0])} r={0.3} />
                <Box id="foot" material="steel" outline="lo" {...f.box([s - 3, s + 3], [side * (cLeg0 - 1.6), side * (cLeg1 + 1.6)], [0, 1.4])} r={0.6} />
                {side > 0 && (
                  <Marks
                    id="screws"
                    material="steel"
                    segments={[s - 2.1, s + 2.1].flatMap((ss) => closed(ring(f.w(ss, cm, 1.4), 0.6, 12), [0, 0, 1], 'lo'))}
                    dots={[s - 2.1, s + 2.1].map((ss) => ({ at: f.w(ss, cm, 1.4), size: 0.35, normal: [0, 0, 1] as const }))}
                  />
                )}
              </Group>
            );
          })}
          {beams.map((z, k) => (
            <Box key={k} id={`beam${k}`} material="steel" outline="lo" {...f.box([s - 0.8, s + 0.8], [-cLeg0, cLeg0], [z, z + 1.8])} r={0.2} />
          ))}
        </Group>
      ))}
      {verts.length > 1 && (
        <LabelPlate f={f} sMid={(verts[Math.floor(verts.length / 2) - 1]! + verts[Math.floor(verts.length / 2)]!) / 2} c={cOut} z0={zTop0 + 0.3} z1={zTop1 - 0.3} len={14} />
      )}
      <Instances
        id="cleats"
        geo={{ kind: 'box', size: cleatSize, r: 0.2, center: [0, 0, CH / 2] }}
        styles={[{ material: 'steel', outline: 'lo' }]}
        capacity={D.nCleats}
      />
      <Instances
        id="straps"
        geo={{ kind: 'box', size: strapSize, r: 0.1, center: [0, 0, 0.5] }}
        styles={[{ material: 'steel', outline: 'lo' }]}
        capacity={2 * D.nCleats}
        scalable
      />
      <PacketPool capacity={D.nCleats + 4} />
    </Group>
  );
}
