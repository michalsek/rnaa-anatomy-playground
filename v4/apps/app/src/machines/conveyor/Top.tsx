/**
 * The "top" conveyor (v2 `parts/conveyor/conveyor.mjs` buildTop, L134–258): a single-sided belt
 * on legs. Side channels with lips, carrying and return idlers with axle nuts, pillow blocks, the
 * graphite drive (gearbox with cover and breather, ribbed motor), guide bars on arms and posts,
 * the lit run lamp by the idle drum, a label plate, and (`legs`, default on) legs, feet with
 * anchor screws, braces and the near stretcher. The sim (`Conveyor`) gives the geometry and moves
 * the slats (the band's u shift) and the packets.
 */
import type { Conveyor, PartHandle } from '@anatomy/engine';
import { Box, Group, Lathe, Marks, useFrame, useNode } from '../../blocks/blocks.tsx';
import type { LiveHandle } from '../../factory/live.ts';
import { PacketPool } from '../Packets.tsx';
import { closed, ring, rod, turned } from '../kit.ts';
import { usePacketPoses } from '../poses.ts';
import { type BeltKit, beltKit, slats } from './dims.ts';
import { BeltBody, LabelPlate, Lamp, Motor, Nut } from './Parts.tsx';

interface TopProps {
  id: string;
  live: LiveHandle;
  sim: () => Conveyor;
  /** Legs, feet and braces (v2 `legs`); off hangs the belt from its rails. */
  legs?: boolean;
}

function Frame({ live, sim }: TopProps) {
  const band = useNode<PartHandle>('body.band');
  const packets = usePacketPoses('packets', sim);
  useFrame((info) => {
    live.step(info);
    band().uShift = sim().uShift();
    packets();
  });
  return null;
}

function Pillow({ f, id, s, side, cWebOut, zc }: { f: BeltKit; id: string; s: number; side: number; cWebOut: number; zc: number }) {
  const c0 = side * cWebOut;
  const c1 = side * (cWebOut + 2.0);
  return (
    <Group id={id}>
      <Box id="block" material="steel" {...f.box([s - 3.2, s + 3.2], [c0, c1], [zc - 2.6, zc + 2.2])} r={0.5} />
      {side > 0 && (
        <>
          <Marks id="bolts" material="steel" dots={[s - 2.1, s + 2.1].map((ss) => ({ at: f.w(ss, (c0 + c1) / 2, zc + 2.2), size: 0.45, normal: [0, 0, 1] as const }))} />
          <Lathe id="cap" material="steel" outline="lo" profile={turned([[0, 1.5], [0.7, 1.5], [0.7, 0.9], [1.2, 0.9]])} steps={20} {...f.alongC(s, c1, zc)} />
          <Marks id="cap-dot" material="steel" dots={[{ at: f.w(s, c1 + 1.2, zc), size: 0.4, normal: f.cV }]} />
        </>
      )}
    </Group>
  );
}

export function Top(props: TopProps) {
  const { id, sim, legs = true } = props;
  const conveyor = sim();
  const D = conveyor.geometry;
  const { axis, dir, L, T, W, RD, BT, RW, zc } = D;
  const half = W / 2;
  const f = beltKit(conveyor.frame);
  const cWebIn = half + 2.4;
  const cWebOut = half + 4.0;
  const zRail0 = T - 13;
  const zRail1 = T - 2.2;
  const sR0 = -7;
  const sR1 = L + 7;
  // Carrying idlers under the top run, return idlers under the return run.
  const idlerR = 1.8;
  const idlerZ = T - BT - idlerR;
  const idlerStep = (L - 20) / Math.max(1, Math.round((L - 20) / 9));
  const idlers: number[] = [];
  for (let s = 10; s <= L - 10 + 1e-6; s += idlerStep) idlers.push(s);
  const retR = 1.3;
  const retZ = zc - RW - retR;
  const returns: number[] = [];
  for (let s = 14; s <= L - 14 + 1e-6; s += Math.max(20, (L - 28) / Math.max(1, Math.round((L - 28) / 26)))) returns.push(s);
  const sDrive = dir > 0 ? L : 0;
  const sIdle = dir > 0 ? 0 : L;
  const gbC0 = cWebOut;
  const gbC1 = cWebOut + 6.0;
  const mSign = dir > 0 ? -1 : 1;
  // Legs, feet, braces.
  const nLegs = legs ? Math.max(2, Math.ceil((L - 12) / 54) + 1) : 0;
  const legAt = Array.from({ length: nLegs }, (_, i) => 6 + ((L - 12) * i) / (nLegs - 1));
  const cLeg0 = half + 2.0;
  const cLeg1 = half + 4.4;
  const braceZ = [Math.max(4, zRail0 * 0.18), zRail0 * 0.62].filter((z, i, a) => (i === 0 ? z + 4 < zRail0 : z - a[0]! > 10));
  const coverDots = (() => {
    const F = f.alongC(sDrive, gbC1, zc);
    return { F, dots: Array.from({ length: 6 }, (_, k) => ({ at: [1.75 * Math.cos((k * Math.PI) / 3), 1.75 * Math.sin((k * Math.PI) / 3), 0.7] as const, size: 0.4, normal: [0, 0, 1] as const })) };
  })();
  return (
    <Group id={id} position={conveyor.origin} contacts={false}>
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
        flangeR={5.4}
        flangeT={0.8}
        hubR={1.5}
        hubL={1.6}
        bolts={6}
        steps={24}
        lines={{ outer: slats(D.total, D.pitch, 'faint') }}
      />
      {[1, -1].map((side) => {
        const tag = side > 0 ? 'N' : 'F';
        return (
          <Group key={tag} id={`rail${tag}`}>
            <Box id="web" material="steel" {...f.box([sR0, sR1], [side * cWebIn, side * cWebOut], [zRail0 + 0.8, zRail1])} r={0.2} />
            <Box id="lip" material="steel" outline="lo" {...f.box([sR0, sR1], [side * cWebIn, side * (cWebOut + 1.6)], [zRail0, zRail0 + 0.8])} r={0.2} />
          </Group>
        );
      })}
      {idlers.map((s, i) => (
        <Group key={`i${i}`} id={`idler${i}`}>
          <Lathe id="roll" material="steel" outline="hi" profile={rod(idlerR, 0, 2 * cWebIn)} steps={16} seams={[2.4, 2 * cWebIn - 2.4]} {...f.alongC(s, -cWebIn, idlerZ)} />
          <Nut f={f} id="nut" s={s} c={cWebOut} z={idlerZ} r={0.9} t={0.5} />
        </Group>
      ))}
      {returns.map((s, i) => (
        <Group key={`r${i}`} id={`return${i}`}>
          <Lathe id="roll" material="steel" outline="lo" profile={rod(retR, 0, 2 * cWebIn)} steps={12} {...f.alongC(s, -cWebIn, retZ)} />
          <Nut f={f} id="nut" s={s} c={cWebOut} z={retZ} r={0.8} t={0.5} />
        </Group>
      ))}
      <Pillow f={f} id="bearingIdle" s={sIdle} side={1} cWebOut={cWebOut} zc={zc} />
      <Pillow f={f} id="bearingIdleF" s={sIdle} side={-1} cWebOut={cWebOut} zc={zc} />
      <Pillow f={f} id="bearingDriveF" s={sDrive} side={-1} cWebOut={cWebOut} zc={zc} />
      <Lamp f={f} s={sIdle + dir * 6.4} c={cWebOut} z={T - 7.2} r={1.0} />
      <Group id="drive">
        <Box id="gearbox" material="graphite" {...f.box([sDrive - 4, sDrive + 4], [gbC0, gbC1], [zc - 4.6, zc + 2.4])} r={0.9} seams={[zc - 1.2]} />
        <Group id="cover" {...coverDots.F}>
          <Lathe id="disc" material="graphite" profile={turned([[0, 2.3], [0.7, 2.3], [0.7, 1.2], [1.3, 1.2]])} steps={24} />
          <Marks id="bolts" material="graphite" dots={coverDots.dots} />
        </Group>
        <Lathe id="breather" material="graphite" outline="lo" profile={turned([[0, 0.7], [0.7, 0.7], [0.7, 0.45], [1.3, 0.45]])} steps={12} {...f.up(sDrive - 1.6 * dir, (gbC0 + gbC1) / 2 + 0.8, zc + 2.4)} />
        <Motor f={f} s={sDrive + mSign * 4} c={(gbC0 + gbC1) / 2} z={zc - 1.4} sign={mSign} r={2.8} len={Math.min(14, L * 0.4)} />
      </Group>
      {[1, -1].map((side) => {
        const tag = side > 0 ? 'N' : 'F';
        const cp = side * (half + 3.2);
        // The near bar stops 12 short of the front drum (a parcel moving into the drum is clear of it).
        const b0 = 2;
        const b1 = side > 0 ? L - 12 : L - 2;
        const n = Math.max(2, Math.round((b1 - b0 - 4) / 24) + 1);
        const posts = Array.from({ length: n }, (_, i) => b0 + 2 + ((b1 - b0 - 4) * i) / (n - 1));
        return (
          <Group key={tag} id={`guide${tag}`}>
            {posts.map((s, i) => (
              <Group key={i} id={`post${i}`}>
                <Lathe id="post" material="steel" profile={rod(0.6, 0, T + 4.2 - zRail1)} steps={12} {...f.up(s, cp, zRail1)} />
                <Box id="arm" material="steel" {...f.box([s - 0.5, s + 0.5], [side * (half + 0.2), side * (half + 2.6)], [T + 2.8, T + 3.8])} r={0.15} />
              </Group>
            ))}
            <Box id="bar" material="steel" {...f.box([b0, b1], [side * (half - 1.0), side * (half + 0.2)], [T + 2.4, T + 4.2])} r={0.3} />
          </Group>
        );
      })}
      {legAt.map((s, i) => (
        <Group key={`leg${i}`} id={`leg${i}`}>
          {[1, -1].map((side) => {
            const tag = side > 0 ? 'N' : 'F';
            const cm = side * ((cLeg0 + cLeg1) / 2);
            return (
              <Group key={tag} id={tag}>
                <Box id="leg" material="steel" {...f.box([s - 1.2, s + 1.2], [side * cLeg0, side * cLeg1], [1.2, zRail0])} r={0.3} />
                <Box id="foot" material="steel" outline="lo" {...f.box([s - 2.6, s + 2.6], [side * (cLeg0 - 1.4), side * (cLeg1 + 1.4)], [0, 1.2])} r={0.6} />
                {side > 0 && (
                  <Marks
                    id="screws"
                    material="steel"
                    segments={[s - 1.9, s + 1.9].flatMap((ss) => closed(ring(f.w(ss, cm, 1.2), 0.6, 12), [0, 0, 1], 'lo'))}
                    dots={[s - 1.9, s + 1.9].map((ss) => ({ at: f.w(ss, cm, 1.2), size: 0.35, normal: [0, 0, 1] as const }))}
                  />
                )}
              </Group>
            );
          })}
          {braceZ.map((z, k) => (
            <Box key={k} id={`brace${k}`} material="steel" outline="lo" {...f.box([s - 0.7, s + 0.7], [-cLeg0, cLeg0], [z, z + 1.4])} r={0.2} />
          ))}
        </Group>
      ))}
      {braceZ.length > 0 &&
        legAt.slice(1).map((s, i) => (
          <Box
            key={`st${i}`}
            id={`stretcher${i}`}
            material="steel"
            outline="lo"
            {...f.box([legAt[i]! + 1.2, s - 1.2], [half + 2.6, half + 3.8], [braceZ[0]! + 3, braceZ[0]! + 4.2])}
            r={0.2}
          />
        ))}
      {idlers.length > 3 && (
        <LabelPlate
          f={f}
          sMid={(idlers[Math.floor(idlers.length / 2) - 1]! + idlers[Math.floor(idlers.length / 2)]!) / 2}
          c={cWebOut}
          z0={T - 9.4}
          z1={T - 4.4}
          len={Math.min(14, idlerStep * 1.6)}
        />
      )}
      <PacketPool capacity={Math.ceil(L / D.spacing) + 4} />
    </Group>
  );
}
