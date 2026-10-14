/**
 * Instruments on the bowl (v2 L520–593): the tachometer with its needle, the sync lamp with its
 * glow, the gate crank, and the drain valve with its handwheel.
 *
 * Each sits on a face frame (`faceFrame(deg, z)`): model z = out of the bowl along dir(deg),
 * model x = up, so v2's face angles (from up toward the viewer's right) are model angles as is.
 */
import { type LineSetSpec, type ProfilePoint, sphereProfile } from '@anatomy/engine';
import { Extrude, Glow, Group, Lathe, Marks } from '../../blocks/blocks.tsx';
import {
  CRANK_DEG,
  DEG,
  DRAIN_DEG,
  LAMP_DEG,
  R,
  TACH_DEG,
  closed,
  disc,
  faceFrame,
  polar,
  ring,
} from './dims.ts';

/** A pad sunk into the bowl wall (v2 `saddle`): a disc of radius a out to s1. */
const pad = (a: number, s1: number): ProfilePoint[] => disc(a, Math.sqrt(R.bowl ** 2 - a * a) - 1, s1);

// ---- tachometer --------------------------------------------------------------------------------

const TZ = 114.7;
const FACE_S = 37.3;
/** Bezel, recessed rim step, the tick annulus (r 4.6 → 3.2) and the face. */
const TACH: ProfilePoint[] = [
  [0, 35.4],
  [5.4, 35.4],
  [5.4, 37.8],
  [4.6, 37.8],
  [4.6, FACE_S],
  [3.2, FACE_S], // segment 4: ticks
  [0, FACE_S],
];
/** 18 intervals over 270° from −135° (15° apart), a major every third: index i at −135 + 15i. */
const TICKS: LineSetSpec = {
  count: 24, phase: 15, first: 0, last: 18, majorEvery: 3, minor: 'mid', major: 'hi',
  width: 0.6, majorWidth: 0.6, fade: [0, 0],
};
/** The needle's "in sync" angle: 70% of the 270° sweep. */
const SYNC = -135 + 270 * 0.7;
const face = (r: number, deg: number, s: number) =>
  [r * Math.cos(deg * DEG), r * Math.sin(deg * DEG), s] as [number, number, number];
const OUT = [0, 0, 1] as const;

function Tach() {
  return (
    <Group id="tach" {...faceFrame(TACH_DEG, TZ)}>
      <Lathe id="pad" material="steel" profile={pad(5.4, 35.4)} contacts />
      <Lathe id="dial" material="graphite" crease="mid" profile={TACH} marks={[5]} lineSets={[{ segment: 4, lines: TICKS }]} />
      <Marks
        id="sync"
        material="graphite"
        segments={[{ a: face(3.2, SYNC, FACE_S + 0.01), b: face(4.6, SYNC, FACE_S + 0.01), width: 1.3, tone: 'hi', normal: OUT }]}
      />
      {/* The needle (M4 turns it about the face axis); at rest it sits on the sync tick. */}
      <Group id="needle" moves position={[0, 0, FACE_S + 0.05]}>
        <Marks
          id="hand"
          material="graphite"
          segments={[{ a: face(0.9, SYNC + 180, 0), b: face(3.9, SYNC, 0), width: 1, tone: 'hi', normal: OUT }]}
          dots={[{ at: [0, 0, 0], size: 0.8, tone: 'hi', normal: OUT }]}
        />
      </Group>
    </Group>
  );
}

// ---- sync lamp ---------------------------------------------------------------------------------

const LZ = 115.5;
const LENS_S = 37.8 + Math.sqrt(2.1 ** 2 - 1.9 ** 2);

function Lamp() {
  return (
    <Group id="lamp" {...faceFrame(LAMP_DEG, LZ)}>
      <Lathe id="pad" material="steel" profile={pad(3, 35.2)} contacts />
      <Lathe id="housing" material="graphite" profile={disc(2.7, 35.2, 37.2)} steps={24} />
      <Lathe id="bezel" material="graphite" profile={disc(1.9, 37.2, 37.8)} steps={24} />
      <Lathe id="lens" material="lit" outline="hi" profile={sphereProfile(2.1, 10)} steps={24} subdivisions={2} position={[0, 0, LENS_S]} />
      {/* v2 drawLamp at the "in sync" level (.45). */}
      <Glow id="glowSoft" fx="glowSoft" radius={2.4} grow={3.2} opacity={0.35} blend="normal" bias={2.2} level={0.45} position={[0, 0, LENS_S]} />
      <Glow id="glow" fx="glow" radius={1.6} opacity={0.85} cap={0.85} blend="glow" bias={2.2} level={0.45} position={[0, 0, LENS_S]} />
    </Group>
  );
}

// ---- gate crank --------------------------------------------------------------------------------

const CZ = 114;
/** v2 `drawCrank`: the arm at 25° in the face plane (M4 turns it back by 60° · kick). */
const ARM_DEG = 25;

function Crank() {
  return (
    <Group id="crank-mount" {...faceFrame(CRANK_DEG, CZ)}>
      <Lathe id="pad" material="steel" profile={pad(2.8, 35.4)} contacts />
      <Lathe id="boss" material="graphite" profile={disc(2, 35.4, 37.6)} steps={24} />
      <Group id="crank" moves position={[0, 0, 38.4]}>
        <Lathe id="arm" material="steel" profile={disc(0.75, 0, 7)} steps={16} rotation={[0, 90, ARM_DEG]} />
        <Lathe id="tip" material="steel" profile={sphereProfile(1.4, 10)} steps={24} subdivisions={2} position={face(7.4, ARM_DEG, 0)} />
        <Lathe id="hub" material="steel" profile={disc(1.3, -0.8, 1)} steps={24} />
      </Group>
    </Group>
  );
}

// ---- drain valve -------------------------------------------------------------------------------

const VZ = 113;
/** The valve body: a stub, a bulge r 1.5 → 2.3 → 1.5 about s 41.8, then a neck. */
const VALVE: ProfilePoint[] = [
  [0, 39.6],
  [1.5, 39.6],
  [1.5, 40],
  [2.06, 40.6, true],
  [2.3, 41.8, true],
  [2.06, 43, true],
  [1.5, 43.6],
  [1.5, 44],
  [0, 44],
];
/** The handwheel's stem stands on the bulge's top (v2 `drain-stem`, frame SF). */
const STEM = polar(DRAIN_DEG, 41.8, VZ);
const WHEEL_Z = VZ + 4.2;

function Drain() {
  const top = WHEEL_Z + 0.6;
  const spokeAt = (i: number, r: number) => {
    const t = DRAIN_DEG * DEG + (i * 2 * Math.PI) / 3 + 0.4;
    return [STEM[0] + r * Math.cos(t), STEM[1] + r * Math.sin(t), top] as const;
  };
  return (
    <Group id="drain">
      <Group id="valve" {...faceFrame(DRAIN_DEG, VZ)}>
        <Lathe id="pad" material="steel" profile={pad(2, 35.4)} contacts />
        <Lathe id="stub" material="steel" profile={disc(1.2, 35.4, 39.6)} steps={24} />
        <Lathe id="body" material="steel" profile={VALVE} steps={24} subdivisions={3} contacts />
        <Lathe id="outlet" material="steel" profile={disc(1.2, 44, 46)} steps={24} />
        <Lathe id="plug" material="steel" profile={disc(1.6, 46, 47)} steps={24} />
      </Group>
      <Extrude id="stem" material="steel" plan={{ circle: 0.45, steps: 12 }} z={VZ + 2.15} height={WHEEL_Z - VZ - 2.15} position={[STEM[0], STEM[1], 0]} contacts />
      <Extrude id="wheel" material="steel" plan={{ circle: 2.6, steps: 24 }} z={WHEEL_Z} height={0.6} position={[STEM[0], STEM[1], 0]} />
      <Marks
        id="wheel-marks"
        material="steel"
        segments={[
          ...[0, 1, 2].map((i) => ({ a: spokeAt(i, 0.6), b: spokeAt(i, 1.9), normal: [0, 0, 1] as const, tone: 'lo' as const })),
          ...closed(ring([STEM[0], STEM[1], top], 1.9, 24), [0, 0, 1], 'lo'),
          ...closed(ring([STEM[0], STEM[1], top], 0.6, 12), [0, 0, 1], 'lo'),
        ]}
      />
    </Group>
  );
}

export function Instruments() {
  return (
    <Group id="instruments">
      <Tach />
      <Lamp />
      <Crank />
      <Drain />
    </Group>
  );
}
