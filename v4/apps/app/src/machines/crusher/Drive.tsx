/**
 * The crusher's rollers and drive (v2 crusher.mjs L92–110, L140–233): two toothed graphite
 * rollers (seven rings each, the teeth a UV line set that turns with them), the fixed back
 * bearing block, the sliding front block on guide rails with its tramp-relief coil spring (a
 * scalable pool: it compresses as the block kicks back) against the abutment, the flywheel on
 * the back roller's shaft, the rubber V-belt (lacing clips scroll on its straight runs) down to
 * the three-piece motor pulley, the ribbed motor on a slotted slide base with its foot and
 * terminal box.
 *
 * Moving (written by the crusher's frame hook): `rollerBack`, `front` (kick) › `rollerFront`,
 * `fly`, `pulley` (spins), `spring` and `lacing` (pools).
 */
import { Belt, Box, Group, Instances, Lathe, Marks } from '../../blocks/blocks.tsx';
import { helix } from '@anatomy/engine';
import { FX, FY, type V3, circle, corners, faceScrews, placeFrame, ribs, screws, slot, turned } from '../kit.ts';
import { CR, FLYWHEEL, MOTOR_PROFILE, MOTOR_RIBS, ROLLER_PROFILE, VBELT } from './dims.ts';

const RL = CR.ROLLER;
const FL = CR.FLY;
const M = CR.MOTOR;
const SP = CR.SPRING;
const TEETH = ribs(14, 'mid');
const rollerLines = ROLLER_PROFILE.teeth.map((segment) => ({ segment, lines: TEETH }));

/** The belt plane's frame: model x = world y, model y = world z, model z = world x. */
export const BELT_FRAME = placeFrame([VBELT.x, 0, 0], [1, 0, 0], [0, 1, 0]);
/** The spring's frame: its helix runs along model z from the abutment (y1) toward the block. */
export const SPRING_AT: V3 = [SP.x, SP.y1, SP.z];

function Roller({ id, y }: { id: string; y: number }) {
  return (
    <Group id={id} moves {...FX(RL.x0, y, RL.axisZ)}>
      <Lathe id="body" material="graphite" outline="hi" profile={ROLLER_PROFILE.profile} lineSets={rollerLines} />
    </Group>
  );
}

export function Rollers() {
  const [yB, yF] = RL.ys;
  return (
    <Group id="drive">
      <Roller id="rollerBack" y={yB} />
      {/* The fixed back bearing block; the guides; the front block slides on them (kick). */}
      <Box id="bearingBack" material="graphite" {...corners([17, -10, 19], [20.4, -2, 27])} r={0.6} />
      <Marks id="bearingBack-screws" material="graphite" {...faceScrews('x', [[20.4, -8.6, 25.6], [20.4, -3.4, 20.4]], 0.55, 0.4)} />
      <Lathe id="bearingBackCap" material="graphite" profile={turned([[0, 2.2], [0.6, 2.2]])} {...FX(20.4, -6, 23)} />
      <Box id="guideTop" material="steel" outline="lo" {...corners([17, 0, 27], [19, 19, 28.2])} r={0.2} />
      <Box id="guideBottom" material="steel" outline="lo" {...corners([17, 0, 17.8], [19, 19, 19])} r={0.2} />
      <Group id="front" moves>
        <Roller id="rollerFront" y={yF} />
        <Box id="bearing" material="graphite" {...corners([17, 2, 19], [20.4, 10, 27])} r={0.6} />
        <Marks id="bearing-screws" material="graphite" {...faceScrews('x', [[20.4, 3.4, 25.6], [20.4, 8.6, 20.4]], 0.55, 0.4)} />
        <Lathe id="cap" material="graphite" profile={turned([[0, 2.2], [0.9, 2.2], [0.9, 1.2], [1.5, 1.2]])} {...FX(20.4, 6, 23)} />
        {/* The spring's seat on the block and the rod through the spring. */}
        <Lathe id="seat" material="steel" profile={turned([[0, SP.r], [0.4, SP.r]])} {...FY(SP.x, SP.y0, SP.z)} />
        <Lathe id="rod" material="steel" profile={turned([[0.4, 0.6], [SP.y1 - SP.y0 + 1, 0.6]])} steps={12} {...FY(SP.x, SP.y0, SP.z)} />
      </Group>
      <Instances
        id="spring"
        geo={{ kind: 'tube', path: helix({ from: [0, 0, 0], to: [0, 0, SP.y1 - SP.y0 - 0.4], r: SP.r - 0.08 - 0.2, turns: SP.turns, steps: 14 }), radius: 0.2, sides: 6, bend: 0 }}
        styles={[{ material: 'steel', outline: 'lo' }]}
        capacity={1}
        scalable
      />
      <Box id="abutment" material="steel" {...corners([17, 19, 18.6], [21, 22, 27.4])} r={0.5} />
      <Marks id="abutment-screws" material="steel" {...faceScrews('y', [[17.9, 22, 26.4], [17.9, 22, 19.6]], 0.4, 0.35)} />
      <Lathe id="nut" material="steel" profile={turned([[0, 1.3], [1.2, 1.3], [1.2, 0.6], [2.2, 0.6]])} {...FY(SP.x, 22, SP.z)} />
    </Group>
  );
}

export function Drive() {
  const beltX = VBELT.x;
  const holes = Array.from({ length: FL.holes }, (_, i) => {
    const a = (i / FL.holes) * 2 * Math.PI;
    return circle([FL.holeAt * Math.cos(a), FL.holeAt * Math.sin(a), FL.w], FL.holeR, [0, 0, 1], 'lo', 18);
  }).flat();
  const pulleyMarks = [
    ...Array.from({ length: 3 }, (_, i) => {
      const a = (i / 3) * 2 * Math.PI;
      return circle([1.7 * Math.cos(a), 1.7 * Math.sin(a), 3], 0.55, [0, 0, 1], 'lo', 12);
    }).flat(),
    ...circle([0, 0, 3], 0.9, [0, 0, 1], 'lo', 14),
  ];
  const slots = ([[26.5, -29.6], [26.5, -20.4], [38.5, -29.6], [38.5, -20.4]] as const).flatMap(([x, y]) => slot([x, y, 1.6], [0, 1, 0], [1, 0, 0], 1.2, 0.6, [0, 0, 1]));
  return (
    <Group id="power">
      <Group id="fly" moves {...FX(FL.x, RL.ys[0], RL.axisZ)}>
        <Lathe id="wheel" material="graphite" outline="mid" profile={FLYWHEEL.profile} marks={FLYWHEEL.marks} seams={[FL.w / 2 - 1, FL.w / 2 + 1]} />
        <Marks id="holes" material="graphite" segments={holes} />
      </Group>
      <Lathe id="flyNut" material="graphite" profile={turned([[0, 1.3], [0.7, 1.3]])} {...FX(FL.x + FL.w + 0.6, RL.ys[0], RL.axisZ)} />
      <Group id="pulley" moves {...FX(beltX - 1.5, M.y, M.z)}>
        <Lathe id="back" material="graphite" profile={turned([[0, 3.4], [0.6, 3.4]])} steps={32} />
        <Lathe id="hub" material="graphite" profile={turned([[0.6, 2.8], [2.4, 2.8]])} steps={32} />
        <Lathe id="front" material="graphite" profile={turned([[2.4, 3.4], [3, 3.4]])} steps={32} />
        <Marks id="holes" material="graphite" segments={pulleyMarks} />
      </Group>
      <Lathe id="shaft" material="graphite" profile={turned([[0, 0.9], [M.x - beltX - 1.5, 0.9]])} steps={12} {...FX(beltX + 1.5, M.y, M.z)} />
      <Lathe
        id="motor"
        material="graphite"
        profile={MOTOR_PROFILE}
        lineSets={[{ segment: MOTOR_RIBS.body, lines: ribs(22, 'lo') }, { segment: MOTOR_RIBS.cowl, lines: ribs(26, 'faint') }]}
        {...FX(M.x, M.y, M.z)}
      />
      <Box id="motorBase" material="steel" outline="lo" {...corners([25, -31, 0], [40, -17, 1.6])} r={0.6} />
      <Marks id="motorBase-slots" material="steel" segments={slots} />
      <Box id="motorFoot" material="steel" {...corners([28, -27.4, 1.6], [37.6, -20.6, M.z - 5])} r={0.4} />
      <Marks id="motorFoot-screws" material="steel" {...screws([[29.4, -26], [36.2, -26], [29.4, -22], [36.2, -22]], M.z - 5, 0.6, 0.4)} />
      <Box id="tbox" material="steel" {...corners([30.4, -27, M.z + 5], [34.8, -21, M.z + 8.2])} r={0.5} />
      <Marks id="tbox-screws" material="steel" {...screws([[31.2, -26.2], [34, -21.8]], M.z + 8.2, 0.45, 0.35)} />
      {/* The V-belt round the flywheel and the pulley, in the plane x = beltX. */}
      <Group id="vbelt" {...BELT_FRAME}>
        <Belt id="belt" material="rubber" outline="lo" a={[VBELT.a[0], VBELT.a[1], 0]} ra={VBELT.ra} b={[VBELT.b[0], VBELT.b[1], 0]} rb={VBELT.rb} radius={CR.BELT_R} contacts={false} />
        <Instances id="lacing" geo={{ kind: 'box', size: [0.55, 0.55, 0.3], center: [0, 0, 0.15] }} styles={[{ material: 'steel', outline: 'lo' }]} capacity={12} />
      </Group>
    </Group>
  );
}
