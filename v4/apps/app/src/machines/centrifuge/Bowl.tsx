/**
 * The bowl (v2 L214–253, L272–325): base flange, the turned bowl with its knuckle, ribs, top
 * flange, the stationary rim (open at the gate), the gate sill, guides, lintel and plate, and
 * the discharge spout.
 */
import { boltCircle } from '@anatomy/engine';
import { Extrude, Group, Lathe, Marks } from '../../blocks/blocks.tsx';
import { AZ, GATE_DEG, GATE_HALF, R, SPOUT, SPOUT_LEN, Z, disc, polar, radial } from './dims.ts';

/** v2's quarter-ellipse knuckle (r 30 → 34 over z 103 → 109), as smooth knots. */
const BOWL = [
  [0, Z.bowl[0]],
  [30, Z.bowl[0]],
  [32, 103.8, true],
  [33.46, 106, true],
  [34, Z.knuckle, true],
  [R.bowl, Z.bowl[1]],
  [0, Z.bowl[1]],
] as const;
const RIBS = [32, 95, 140, 175, 210, 245, 280, 312];
const G0 = GATE_DEG - GATE_HALF;
const G1 = GATE_DEG + GATE_HALF;
const RIM_H = Z.rimTop - Z.top[1];
const UP = [0, 0, 1] as const;

/** Rim dots every 20° from a0 + 10, on the rim top. */
const rimDots = (a0: number, a1: number) =>
  Array.from({ length: Math.floor((a1 - a0) / 20) }, (_, i) => ({
    at: polar(a0 + 10 + i * 20, (R.rimIn + R.rimOut) / 2, Z.rimTop),
    size: 0.36,
    normal: UP,
  }));

function RimPiece({ id, a0, a1 }: { id: string; a0: number; a1: number }) {
  return (
    <>
      <Extrude id={id} material="steel" plan={{ sector: { r0: R.rimIn, r1: R.rimOut, a0, a1 } }} z={Z.top[1]} height={RIM_H} />
      <Marks id={`${id}-dots`} material="steel" dots={rimDots(a0, a1)} />
    </>
  );
}

export function Bowl() {
  return (
    <Group id="bowl">
      <Lathe id="base-flange" material="steel" profile={disc(R.flange, Z.flange[0], Z.flange[1])} />
      <Marks id="base-flange-dots" material="steel" dots={boltCircle({ center: [0, 0, Z.flange[1]], r: 35.6, count: 24, size: 0.42 })} />
      <Lathe id="body" material="steel" profile={BOWL} seams={[Z.knuckle + 0.6, 116]} subdivisions={4} contacts />
      {RIBS.map((deg) => (
        <Extrude
          key={deg}
          id={`rib${deg}`}
          material="steel"
          plan={radial(R.bowl - 0.05, R.bowl + 2.2, 0.7)}
          z={Z.bowl[0]}
          height={Z.bowl[1] - Z.bowl[0]}
          rotation={[0, 0, deg]}
          contacts
        />
      ))}
      <Lathe id="top-flange" material="steel" profile={disc(R.top, Z.top[0], Z.top[1])} />
      <Marks
        id="top-flange-dots"
        material="steel"
        dots={boltCircle({ center: [0, 0, Z.top[1]], r: 34.9, count: 32, phase: 180 / 32, size: 0.38 })}
      />
      {/* The stationary rim the packets ride against: back half, and the front half split by the gate. */}
      <RimPiece id="rim-back" a0={AZ + 90} a1={AZ + 270} />
      <RimPiece id="rim-front0" a0={AZ - 90} a1={G0} />
      <RimPiece id="rim-front1" a0={G1} a1={AZ + 90} />
      <Extrude id="gate-sill" material="steel" plan={{ sector: { r0: R.rimIn - 0.2, r1: R.rimOut, a0: G0, a1: G1 }, steps: 4 }} z={Z.top[1]} height={Z.pocket - Z.top[1]} />
      {[-1, 1].map((sgn) => (
        <Extrude
          key={sgn}
          id={`gate-guide${sgn > 0 ? 1 : 0}`}
          material="steel"
          plan={radial(R.rimOut, R.rimOut + 1.4, 0.7)}
          z={Z.top[1]}
          height={138.2 - Z.top[1]}
          rotation={[0, 0, GATE_DEG + sgn * (GATE_HALF + 1.5)]}
        />
      ))}
      <Extrude id="gate-lintel" material="steel" plan={{ sector: { r0: R.rimOut, r1: R.rimOut + 1.4, a0: G0 - 3, a1: G1 + 3 }, steps: 6 }} z={138.2} height={1.4} />
      <Marks
        id="gate-lintel-dots"
        material="steel"
        dots={[GATE_DEG - 6, GATE_DEG + 6].map((deg) => ({ at: polar(deg, 32.1, 139.6), size: 0.36, normal: UP }))}
      />
      {/* The guillotine plate (M4 lifts it by 8.3 · open). */}
      <Group id="gate" moves>
        <Extrude
          id="plate"
          material="steel"
          plan={{ sector: { r0: R.rimOut + 0.1, r1: R.rimOut + 0.9, a0: G0 + 0.4, a1: G1 - 0.4 }, steps: 6 }}
          z={Z.pocket + 0.05}
          height={4.5}
        />
        <Marks
          id="plate-dots"
          material="steel"
          dots={[-4.01, 4.01].map((d) => ({ at: polar(GATE_DEG + d, R.rimOut + 0.5, Z.pocket + 4.55), size: 0.36, normal: UP }))}
        />
      </Group>
      {/* The discharge spout: a floor and two low walls on the spout frame (model z = down the slope). */}
      <Group id="spout" {...SPOUT.frame}>
        <Extrude id="floor" material="steel" plan={{ polygon: [[-5, -1], [5, -1], [5, 0], [-5, 0]] }} height={SPOUT_LEN} />
        <Extrude id="wall0" material="steel" plan={{ polygon: [[4.4, 0], [5, 0], [5, 2.4], [4.4, 2.4]] }} z={1.6} height={SPOUT_LEN - 1.6} />
        <Extrude id="wall1" material="steel" plan={{ polygon: [[-5, 0], [-4.4, 0], [-4.4, 2.4], [-5, 2.4]] }} z={1.6} height={SPOUT_LEN - 1.6} />
      </Group>
    </Group>
  );
}
