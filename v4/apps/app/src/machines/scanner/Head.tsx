/**
 * The read head (v2 scanner.mjs L60–107 and LIVE `armAt`): the pivot's base flange and bearing
 * cartridge; the voice-coil motor (kidney bottom plate, two magnets, three standoffs, two crash
 * stops, the top plate on its standoffs); the moving arm (`arm`, turned about the pivot by the
 * frame hook): the coil and its graphite fork under the top plate, the E-block blade with two
 * lightening slots and a trace, the load beam, the slider, the hub and clamp nut; the flex
 * ribbon (a pool of strips laid along the sim's curve each frame, mint where a pulse runs); the
 * flex bracket with its cable boss, the park ramp; the status lamp on the top plate (lit, blends
 * mint with a glow per read, E2).
 */
import { RIBBON_N, type SegmentSpec } from '@anatomy/engine';
import { Box, Extrude, Glow, Group, Instances, Lathe, Marks } from '../../blocks/blocks.tsx';
import { FX, type V3, closed, corners, disc, faceScrews, screws, turned } from '../kit.ts';
import { ARM, BOSS, BRACKET, RAMP, SC, phi, polar } from './dims.ts';

const [Z0, Z1] = SC.armZ;
/** The lamp's dome (v2 lens: a ball of r 1.7 on the base), smooth. */
const LENS = (() => {
  const r = SC.lampR;
  const c = SC.lamp[2] - 102.2;
  const out: [number, number, boolean?][] = [[0, c - r]];
  for (let i = 1; i < 12; i++) {
    const a = -Math.PI / 2 + (i / 12) * Math.PI;
    out.push([r * Math.cos(a), c + r * Math.sin(a), true]);
  }
  out.push([0, c + r]);
  return out;
})();

const topMarks = (pts: readonly (readonly [number, number])[], z: number, tone: SegmentSpec['tone']) =>
  closed(pts.map(([x, y]) => [x, y, z] as V3), [0, 0, 1], tone);

/** The VCM's static parts (graphite): plates, magnets, standoffs, stops, and the pivot. */
export function Motor() {
  const plate = { sector: { r0: 7, r1: 19.5, a0: phi(46), a1: phi(-46) } };
  return (
    <Group id="vcm">
      <Lathe id="pivotBase" material="graphite" profile={disc(4.6, 86, 88)} />
      <Marks id="pivotBase-screws" material="graphite" {...screws([0, 1, 2].map((i) => [3.4 * Math.cos(i * 2.09 + 0.9), 3.4 * Math.sin(i * 2.09 + 0.9)] as [number, number]), 88, 0.6, 0.3)} />
      <Lathe id="cartridge" material="graphite" profile={disc(3, 88, 94)} seams={[91]} />
      <Extrude id="bottom" material="graphite" plan={plate} z={86} height={2.5} />
      <Marks id="bottom-screws" material="graphite" {...screws([polar(17.5, -30), polar(17.5, 30)], 88.5, 0.7, 0.3)} />
      <Extrude id="magnetA" material="graphite" outline="lo" plan={{ sector: { r0: 9, r1: 16, a0: phi(-1), a1: phi(-30) } }} z={88.5} height={1.5} />
      <Extrude id="magnetB" material="graphite" outline="lo" plan={{ sector: { r0: 9, r1: 16, a0: phi(30), a1: phi(1) } }} z={88.5} height={1.5} />
      {([[16.5, -41], [16.5, 41], [18.2, 0]] as const).map(([r, a], i) => (
        <Lathe key={`s${i}`} id={`standoff${i}`} material="graphite" profile={disc(1.1, 88.5, 98.5)} steps={16} position={[...polar(r, a), 0]} />
      ))}
      {[-39, 39].map((a, i) => (
        <Lathe key={`c${i}`} id={`stop${i}`} material="graphite" outline="lo" profile={disc(0.8, 90, 98.5)} steps={14} position={[...polar(12.5, a), 0]} />
      ))}
      <Extrude id="top" material="graphite" plan={plate} z={98.5} height={2.5} />
      <Marks id="top-screws" material="graphite" {...screws([polar(16.5, -41), polar(16.5, 41), polar(18.2, 0)], 101, 0.8, 0.32)} />
    </Group>
  );
}

/** The moving arm, in its own frame (turned about z by −θ): coil, fork, blade, beam, slider, hub, nut. */
export function Arm() {
  const coilOuter = { sector: { r0: 9, r1: 16, a0: -90 - 17, a1: -90 + 17 } };
  const coilIn: [number, number][] = [
    [11 * Math.cos(((-99) * Math.PI) / 180), 11 * Math.sin(((-99) * Math.PI) / 180)],
    [14 * Math.cos(((-99) * Math.PI) / 180), 14 * Math.sin(((-99) * Math.PI) / 180)],
    [14 * Math.cos(((-81) * Math.PI) / 180), 14 * Math.sin(((-81) * Math.PI) / 180)],
    [11 * Math.cos(((-81) * Math.PI) / 180), 11 * Math.sin(((-81) * Math.PI) / 180)],
  ];
  const [t0, t1] = ARM.trace;
  return (
    <Group id="arm" moves>
      <Extrude id="coil" material="steel" outline="hi" plan={coilOuter} z={91} height={5.5} />
      <Marks id="coil-line" material="steel" segments={topMarks(coilIn, 96.5, 'lo')} />
      <Extrude id="fork" material="graphite" plan={{ polygon: ARM.fork }} z={Z0} height={Z1 - Z0} />
      <Extrude id="blade" material="steel" outline="hi" plan={{ polygon: ARM.blade }} z={Z0} height={Z1 - Z0} />
      <Marks
        id="blade-marks"
        material="steel"
        segments={[...topMarks(ARM.slotA, Z1, 'lo'), ...topMarks(ARM.slotB, Z1, 'lo'), { a: [t0[0], t0[1], Z1], b: [t1[0], t1[1], Z1], tone: 'faint', normal: [0, 0, 1] }]}
        dots={[t0, t1].map(([x, y]) => ({ at: [x, y, Z1] as V3, size: 0.32, tone: 'mid' as const, normal: [0, 0, 1] as const }))}
      />
      <Extrude id="beam" material="steel" plan={{ polygon: ARM.beam }} z={95} height={0.4} />
      <Extrude id="slider" material="steel" outline="hi" plan={{ polygon: ARM.slider }} z={93.6} height={1.4} />
      <Lathe id="hub" material="graphite" profile={disc(4.2, 94, 96.5)} />
      <Extrude id="nut" material="graphite" plan={{ circle: 2.6, steps: 6 }} z={96.5} height={1.5} />
      <Marks id="nut-dot" material="graphite" dots={[{ at: [0, 0, 98], size: 0.4, normal: [0, 0, 1] }]} />
    </Group>
  );
}

/**
 * The flex ribbon's strips: laid along the sim's curve each frame (x = along, scaled per strip).
 * Round-ended in plan (r = half the thickness), so no crease runs across the ribbon at a joint:
 * only its top and bottom edges draw.
 */
export function Ribbon() {
  const [za, zb] = SC.flexZ;
  return (
    <Instances
      id="ribbon"
      geo={{ kind: 'box', size: [1, 0.3, zb - za], center: [0, 0, (zb - za) / 2], r: 0.149 }}
      styles={[{ material: 'steel' }, { material: 'pkAudio' }]}
      capacity={RIBBON_N}
      scalable
    />
  );
}

/** Flex bracket and boss, the park ramp, the status lamp. */
export function Fittings() {
  const [b0, b1] = [BRACKET.lo, BRACKET.hi];
  const L = SC.lamp;
  return (
    <>
      <Group id="bracket">
        <Box id="block" material="steel" {...corners(b0, b1)} r={0.5} />
        <Marks id="screws" material="steel" {...faceScrews('y', [[b0[0] + 1.8, b1[1], 94.6], [b0[0] + 3.2, b1[1], 94.6]], 0.5, 0.3)} />
        <Lathe id="boss" material="steel" profile={turned([[-0.2, 1.5], [1.6, 1.5]])} steps={16} {...FX(...BOSS)} />
      </Group>
      <Group id="ramp">
        <Box id="bar" material="steel" {...corners(...RAMP.bar)} r={0.3} />
        <Box id="post" material="steel" {...corners(...RAMP.post)} r={0.4} />
        <Box id="tongue" material="steel" outline="hi" {...corners(...RAMP.tongue)} r={0.3} />
      </Group>
      <Group id="lamp" position={[L[0], L[1], 0]}>
        <Lathe id="base" material="graphite" profile={disc(1.6, 101, 102.2)} steps={20} />
        <Lathe id="lens" live material="lit" outline="hi" blend={{ material: 'mint', outline: 'hi' }} profile={LENS} subdivisions={2} steps={24} position={[0, 0, 102.2]} />
        <Glow id="glowSoft" fx="mintSoft" radius={2.8} grow={3.2} opacity={0.45} blend="normal" bias={3} level={0} position={[0, 0, L[2]]} />
        <Glow id="glow" fx="mint" radius={1.9} grow={1.3} opacity={0.85} cap={0.85} blend="glow" bias={3} level={0} position={[0, 0, L[2]]} />
      </Group>
    </>
  );
}
