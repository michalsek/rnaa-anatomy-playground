/**
 * Pieces shared by both conveyors (v2 `parts/conveyor/conveyor.mjs` L55–120): the belt body (the
 * band with its slats, drum cores, flanges with bolt circles, hubs), a hex nut, the lit lamp, the
 * label plate and the ribbed drive motor. Placed in belt coordinates through a `BeltKit`.
 */
import { type LineSetSpec, type Material, boltCircle } from '@anatomy/engine';
import { Band, Box, Group, Lathe, Marks } from '../../blocks/blocks.tsx';
import { closed, ring } from '../kit.ts';
import { type BeltKit, RIBS, rod, turned } from './dims.ts';

export function BeltBody({
  f,
  axis,
  dir,
  L,
  W,
  T,
  RD,
  BT,
  flangeR,
  flangeT,
  hubR,
  hubL,
  bolts,
  lines,
  steps,
}: {
  f: BeltKit;
  axis: 'x' | 'y';
  dir: 1 | -1;
  L: number;
  W: number;
  T: number;
  RD: number;
  BT: number;
  flangeR: number;
  flangeT: number;
  hubR: number;
  hubL: number;
  bolts: number;
  lines: { outer?: LineSetSpec; inner?: LineSetSpec };
  /** Segments round the drums. */
  steps: number;
}) {
  const RW = RD + BT;
  const zc = T - RW;
  const half = W / 2;
  return (
    <Group id="body">
      {/* The belt: one closed band; its slats scroll with the sim (live uShift). */}
      <Band id="band" live material="steel" axis={axis} dir={dir} L={L} R={RW} thickness={BT} across={W} zc={zc} lines={lines} />
      {[0, L].map((s, i) => (
        <Group key={i} id={`drum${i}`}>
          <Lathe id="core" material="steel" outline="lo" profile={rod(RD, 0, W)} steps={steps} {...f.alongC(s, -half, zc)} />
          {[1, -1].map((side) => {
            const near = side > 0;
            const tag = near ? 'N' : 'F';
            const flange = near ? f.alongC(s, half, zc) : f.alongC(s, -half - flangeT, zc);
            const hub = near ? f.alongC(s, half + flangeT, zc) : f.alongC(s, -half - flangeT - hubL, zc);
            return (
              <Group key={tag} id={`flange${tag}`} {...flange}>
                <Lathe id="disc" material="steel" profile={rod(flangeR, 0, flangeT)} steps={steps} />
                {near && (
                  <Marks
                    id="bolts"
                    material="steel"
                    segments={[
                      ...closed(ring([0, 0, flangeT], hubR + 1.2, 24), [0, 0, 1], 'faint'),
                      ...closed(ring([0, 0, flangeT], flangeR - 0.6, 32), [0, 0, 1], 'faint'),
                    ]}
                    dots={boltCircle({ center: [0, 0, flangeT], r: flangeR - 1.6, count: bolts, size: 0.45 })}
                  />
                )}
                <Lathe id="hub" material="steel" outline="lo" profile={rod(hubR, 0, hubL)} steps={16} position={near ? [0, 0, flangeT] : [0, 0, -hubL]} />
              </Group>
            );
          })}
        </Group>
      ))}
    </Group>
  );
}

/** v2 `nutOnC`: a small hex nut on a face whose outward normal is +c. */
export function Nut({ f, id, s, c, z, r = 0.9, t = 0.6 }: { f: BeltKit; id: string; s: number; c: number; z: number; r?: number; t?: number }) {
  const tip = f.w(s, c + t, z);
  return (
    <>
      <Lathe id={id} material="steel" profile={rod(r, 0, t)} steps={6} {...f.alongC(s, c, z)} />
      <Marks id={`${id}-dot`} material="steel" dots={[{ at: tip, size: 0.35, normal: f.cV }]} />
    </>
  );
}

/** v2 `lamp`: a lit lens in a bezel on a small steel plate, on a face whose outward normal is +c. */
export function Lamp({ f, s, c, z, r = 1.5 }: { f: BeltKit; s: number; c: number; z: number; r?: number }) {
  const plateH = r * 2 + 2.2;
  return (
    <Group id="lamp">
      <Box id="plate" material="steel" {...f.box([s - r - 1.6, s + r + 1.6], [c, c + 0.5], [z - plateH / 2, z + plateH / 2])} r={0.3} />
      <Marks id="plate-dots" material="steel" dots={[s - r - 0.9, s + r + 0.9].map((ss) => ({ at: f.w(ss, c + 0.5, z), size: 0.4, normal: f.cV }))} />
      <Lathe id="bezel" material="steel" profile={rod(r + 0.6, 0, 0.5)} steps={24} {...f.alongC(s, c + 0.5, z)} />
      <Lathe
        id="lens"
        material="lit"
        outline="hi"
        profile={[[0, 0], [r, 0], [r * 0.85, 0.35, true], [r * 0.45, 0.6, true], [0.01, 0.7], [0, 0.7]]}
        steps={24}
        subdivisions={2}
        {...f.alongC(s, c + 1.0, z)}
      />
    </Group>
  );
}

/** v2 `labelPlate`: three rules and two screws on the near face (outward normal +c). */
export function LabelPlate({ f, sMid, c, z0, z1, len = 16 }: { f: BeltKit; sMid: number; c: number; z0: number; z1: number; len?: number }) {
  if (!(len > 7)) return null;
  const face = c + 0.4;
  const zs = [z1 - 1.3, z1 - 2.4, z1 - 3.5].filter((z) => z > z0 + 0.9);
  const lens = [0.62, 0.8, 0.45];
  const s0 = sMid - len / 2 + 2.8;
  return (
    <Group id="label">
      <Box id="plate" material="steel" {...f.box([sMid - len / 2, sMid + len / 2], [c, face], [z0, z1])} r={0.2} />
      <Marks
        id="rules"
        material="steel"
        segments={zs.map((z, i) => ({ a: f.w(s0, face, z), b: f.w(s0 + (len - 5.6) * lens[i]!, face, z), tone: 'lo' as const, normal: f.cV }))}
        dots={[sMid - len / 2 + 1.3, sMid + len / 2 - 1.3].map((s) => ({ at: f.w(s, face, (z0 + z1) / 2), size: 0.45, normal: f.cV }))}
      />
    </Group>
  );
}

/** v2 `motor`: a ribbed drive motor along s (sign away from the gearbox face at s), fan cowl vents, terminal box. */
export function Motor({ f, s, c, z, sign, r = 2.9, len = 14, material = 'graphite' }: { f: BeltKit; s: number; c: number; z: number; sign: number; r?: number; len?: number; material?: Material }) {
  const profile = turned([[0, r + 0.4], [0.8, r + 0.4], [0.8, r], [len - 3, r], [len - 3, r - 0.25], [len, r - 0.25]]);
  const tb0 = s + sign * 3;
  const tb1 = s + sign * 7.4;
  const mid = (tb0 + tb1) / 2;
  return (
    <Group id="motor">
      <Lathe
        id="body"
        material={material}
        profile={profile}
        steps={32}
        // Segment 3 is the ribbed body; the cowl gets three vent rings.
        lineSets={[{ segment: 3, lines: RIBS }]}
        seams={[len - 2.2, len - 1.4, len - 0.6]}
        {...f.alongS(s, c, z, sign)}
      />
      <Box id="tbox" material={material} {...f.box([tb0, tb1], [c - 1.5, c + 1.5], [z + r, z + r + 2.2])} r={0.3} />
      <Marks
        id="tbox-dots"
        material={material}
        dots={[f.w(mid - sign * 1.2, c - 0.8, z + r + 2.2), f.w(mid + sign * 1.2, c + 0.8, z + r + 2.2)].map((at) => ({ at, size: 0.4, normal: [0, 0, 1] as const }))}
      />
    </Group>
  );
}
