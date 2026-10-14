/**
 * The crusher's discharge (v2 crusher.mjs L234–291): the chute under the rollers with its cheeks,
 * brackets and vibrator; the slide gate at the lip (guides, bar, actuator; the gate lifts open,
 * moving); floor rails and the dump grate; the drawer bin on casters (moving along +y) with its
 * mat, walls, the hazard band on its front (E6 stripes), the handle, the pile (a scalable slab)
 * and the chips on it.
 */
import type { LineSetSpec } from '@anatomy/engine';
import { Box, Extrude, Group, Halo, Instances, Lathe, Marks } from '../../blocks/blocks.tsx';
import { corners } from '../kit.ts';
import { turned } from '../conveyor/dims.ts';
import { CHIP, CR, FX, chuteTop, dots, faceScrews, plateX, slot } from './dims.ts';

const C = CR.CHUTE;
const B = CR.BIN;

/** The hazard band: 45° stripes 2.2 apart on a thin plate (u = perimeter fraction, v = z). */
const BAND = { x0: B.x0 + 1, x1: B.x1 - 1, z0: 7.2, z1: 9.4, t: 0.2 } as const;
const STRIPES: LineSetSpec = (() => {
  const perimeter = 2 * (BAND.x1 - BAND.x0 + BAND.t);
  const count = Math.round(perimeter / 2.2);
  return {
    kind: 'stripes', count, phase: 0, first: 0, last: count - 1, majorEvery: 0, minor: 'lo', major: 'lo',
    width: 0.9, majorWidth: 0.9, fade: [0.05, 0.2], slant: count / perimeter,
  };
})();

export function Chute() {
  const zl = chuteTop(C.y1);
  return (
    <Group id="chute">
      <Extrude id="floor" material="steel" {...plateX(C.x0, C.x1, [[C.y0, C.z0], [C.y1, C.z1], [C.y1, C.z1 - 1], [C.y0, C.z0 - 1]])} />
      {([['L', C.x0], ['R', C.x1 - 1]] as const).map(([tag, x0]) => {
        const bx = tag === 'L' ? [-13, C.x0] : [C.x1, 13];
        return (
          <Group key={tag} id={`side${tag}`}>
            <Extrude id="cheek" material="steel" {...plateX(x0, x0 + 1, [[15, chuteTop(15)], [C.y1, chuteTop(C.y1)], [C.y1, chuteTop(C.y1) + 2.6], [15, chuteTop(15) + 3.4]])} />
            <Box id="bracket" material="steel" outline="lo" {...corners([bx[0]!, 17, chuteTop(17) + 0.4], [bx[1]!, 20, chuteTop(17) + 2.8])} r={0.2} />
            <Box id="guide" material="steel" {...corners([x0, C.y1, zl - 0.4], [x0 + 1, C.y1 + 0.8, zl + 6.6])} r={0.15} />
          </Group>
        );
      })}
      <Box id="gateBar" material="steel" {...corners([C.x0, C.y1, zl + 6.6], [C.x1, C.y1 + 0.8, zl + 7.4])} r={0.15} />
      <Box id="actuator" material="steel" {...corners([-1.6, C.y1 - 0.2, zl + 7.4], [1.6, C.y1 + 1.0, zl + 9.4])} r={0.4} />
      <Group id="gate" moves>
        <Box id="plate" material="steel" outline="lo" {...corners([C.x0 + 1, C.y1 + 0.15, zl + 0.05], [C.x1 - 1, C.y1 + 0.65, zl + 2.6])} r={0.1} />
        <Marks id="dots" material="steel" dots={dots([-7, 0, 7].map((x) => [x, C.y1 + 0.65, zl + 1.8] as const), [0, 1, 0], 0.38)} />
      </Group>
      <Box id="vibrator" material="steel" {...corners([-3, 15.4, chuteTop(19.4) - 1 - 3.2], [3, 19.4, chuteTop(19.4) - 0.95])} r={0.6} />
    </Group>
  );
}

export function Bin({ plan }: { plan: { x0: number; x1: number; y0: number; y1: number; z: number } }) {
  const wz = B.floorZ + 0.8;
  const grate = Array.from({ length: 7 }, (_, i) => slot([-4.8 + i * 1.6, 51, 0.4], [0, 1, 0], [1, 0, 0], 6.6, 0.4, [0, 0, 1])).flat();
  const cx = (plan.x0 + plan.x1) / 2;
  const cy = (plan.y0 + plan.y1) / 2;
  return (
    <>
      <Group id="floor">
        {[-9, 7].map((x) => (
          <Box key={x} id={`rail${x < 0 ? 'L' : 'R'}`} material="steel" outline="lo" {...corners([x, 19, 0], [x + 2, 60, 0.8])} r={0.2} />
        ))}
        <Box id="grate" material="steel" outline="lo" {...corners([-6.6, 43, 0], [6.6, 59, 0.4])} r={0.6} />
        <Marks id="grate-slots" material="steel" segments={grate} />
      </Group>
      <Group id="bin" moves>
        <Halo id="halo" plan={{ w: 26, d: 22, r: 2 }} position={[0, 30, 0]} />
        {([[-8.6, 23], [7.4, 23], [-8.6, 37], [7.4, 37]] as const).map(([x, y], i) => (
          <Lathe key={i} id={`caster${i}`} material="steel" profile={turned([[0, 0.9], [1.2, 0.9]])} steps={16} {...FX(x, y, 1.7)} />
        ))}
        <Box id="floor" material="steel" {...corners([B.x0, B.y0, B.floorZ], [B.x1, B.y1, wz])} r={0.6} />
        <Box id="mat" material="steel" outline="lo" {...corners([B.x0 + B.wall, B.y0 + B.wall, wz], [B.x1 - B.wall, B.y1 - B.wall, wz + 0.6])} r={0.2} />
        <Box id="wallBack" material="steel" {...corners([B.x0, B.y0, wz], [B.x1, B.y0 + B.wall, B.rimZ])} r={0.3} />
        <Box id="wallLeft" material="steel" {...corners([B.x0, B.y0 + B.wall, wz], [B.x0 + B.wall, B.y1 - B.wall, B.rimZ])} r={0.2} />
        <Box id="wallRight" material="steel" {...corners([B.x1 - B.wall, B.y0 + B.wall, wz], [B.x1, B.y1 - B.wall, B.rimZ])} r={0.2} />
        <Marks id="wallRight-screws" material="steel" {...faceScrews('x', [[B.x1, 23, 8.6], [B.x1, 37, 8.6]], 0.5, 0.35)} />
        <Box id="wallFront" material="steel" {...corners([B.x0, B.y1 - B.wall, wz], [B.x1, B.y1, B.rimZ])} r={0.3} />
        <Box id="hazard" material="steel" outline="lo" lines={STRIPES} {...corners([BAND.x0, B.y1, BAND.z0], [BAND.x1, B.y1 + BAND.t, BAND.z1])} />
        <Box id="handleL" material="steel" outline="lo" {...corners([-5, B.y1, 4.6], [-4, B.y1 + 1.6, 5.6])} r={0.2} />
        <Box id="handleR" material="steel" outline="lo" {...corners([4, B.y1, 4.6], [5, B.y1 + 1.6, 5.6])} r={0.2} />
        <Box id="handle" material="steel" {...corners([-5, B.y1 + 1.6, 4.5], [5, B.y1 + 2.6, 5.7])} r={0.4} />
        {/* The pile (scaled to its height) and the chips on it, in the bin's frame. */}
        <Instances
          id="pile"
          geo={{ kind: 'box', size: [plan.x1 - plan.x0, plan.y1 - plan.y0, 1], center: [0, 0, 0.5], r: 0.4 }}
          styles={[{ material: 'pkGarbage', outline: 'hi' }]}
          capacity={1}
          scalable
          position={[cx, cy, plan.z]}
        />
        <Instances id="chips" geo={{ kind: 'box', size: CHIP, center: [0, 0, CHIP[2] / 2], r: 0.2 }} styles={[{ material: 'pkGarbage', outline: 'lo' }]} capacity={70} scalable />
      </Group>
    </>
  );
}
