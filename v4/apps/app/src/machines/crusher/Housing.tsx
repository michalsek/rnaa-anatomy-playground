/**
 * The crusher's base, housing and hopper (v2 crusher.mjs L51–139): skid rails on four feet and
 * cross members (`stand`), side plates, back and front walls, the gear guard, the rating plate,
 * the flared hopper (four wall slabs, two wear liners with countersunk screws, two lips) and the
 * photo-eye (emitter on −x, receiver on +x, one axis).
 */
import { Box, Extrude, Group, Halo, Lathe, Marks } from '../../blocks/blocks.tsx';
import { type V3, circle, corners, disc, dots, faceScrews, plateX, screws } from '../kit.ts';
import { CR } from './dims.ts';

const H = CR.HOPPER;
const fl = H.flare;
const z0 = H.z0;

export function Base({ stand }: { stand: boolean }) {
  return (
    <Group id="base">
      <Halo id="halo" plan={{ w: 38, d: 50, r: 3 }} position={[0, 1, 0]} />
      {stand && (
        <>
          {([[-15, -19], [15, -19], [-15, 21], [15, 21]] as const).map(([x, y], i) => (
            <Group key={i} id={`foot${i}`} position={[x, y, 0]}>
              <Lathe id="pad" material="steel" outline="lo" profile={disc(2.8, 0, 0.8)} steps={28} />
              <Lathe id="foot" material="steel" profile={disc(2.1, 0.8, 2)} steps={24} />
            </Group>
          ))}
          {[-17, 13].map((x) => (
            <Group key={x} id={`rail${x < 0 ? 'L' : 'R'}`}>
              <Box id="rail" material="steel" outline="lo" {...corners([x, -22, 2], [x + 4, 24, 5])} r={0.4} seams={[3.5]} />
              <Marks id="screws" material="steel" {...screws([[x + 2, -20.2], [x + 2, 22.2]], 5, 0.9, 0.45)} />
            </Group>
          ))}
          <Box id="crossBack" material="steel" outline="lo" {...corners([-13, -21, 2], [13, -18, 5])} r={0.3} />
          <Box id="crossFront" material="steel" outline="lo" {...corners([-13, 15, 2], [13, 18, 5])} r={0.3} />
        </>
      )}
    </Group>
  );
}

export function Housing() {
  const rules: [number, number, number][] = [[10.4, 12.6, 18.2], [10.4, 11.4, 16.6], [10.4, 10.2, 17.6]];
  const xF = 17.3;
  return (
    <Group id="housing">
      <Box id="plateL" material="steel" {...corners([-17, -15, 5], [-13, 22, 30])} r={0.5} seams={[8]} />
      <Box id="plateR" material="steel" {...corners([13, -15, 5], [17, 22, 30])} r={0.5} seams={[8]} />
      <Marks id="plateR-screws" material="steel" {...faceScrews('x', [[17, -13, 7.4], [17, 20.4, 7.4], [17, -13, 14], [17, 20.4, 15.4]])} />
      <Box id="rating" material="steel" outline="lo" {...corners([17, 9.2, 8.6], [xF, 19.4, 13.8])} r={0.3} />
      <Marks
        id="rating-marks"
        material="steel"
        segments={rules.map(([y0, z, y1]) => ({ a: [xF, y0, z] as V3, b: [xF, y1, z] as V3, tone: 'lo' as const, normal: [1, 0, 0] as const }))}
        dots={dots([[xF, 9.9, 9.3], [xF, 18.7, 9.3], [xF, 9.9, 13.1], [xF, 18.7, 13.1]], [1, 0, 0], 0.35)}
      />
      <Box id="wallBack" material="steel" {...corners([-13, -15, 15], [13, -13, 30])} r={0.2} />
      <Box id="wallFront" material="steel" {...corners([-13, 13, 15.5], [13, 15, 30])} r={0.2} />
      <Marks id="wallFront-screws" material="steel" {...faceScrews('y', [[-10.5, 15, 28], [10.5, 15, 28], [-10.5, 15, 20], [10.5, 15, 20]])} />
      <Box id="guard" material="steel" {...corners([-20.5, -13, 16], [-17, 12, 30])} r={1.4} seams={[23]} />
      <Marks id="guard-screws" material="steel" {...screws([[-18.75, -11], [-18.75, 10]], 30, 0.8, 0.45)} />
    </Group>
  );
}

export function Hopper() {
  const sidePoly = [[-15, z0], [15, z0], [15 + fl, H.frontTop], [-15 - fl, H.backTop]] as const;
  // Wear liners on the back wall's inner face (offset along its normal) and the left wall.
  const n = [7 / Math.hypot(4, 7), 4 / Math.hypot(4, 7)] as const;
  const onBack = (t: number, off: number): [number, number] => [-13 - 4 * t + n[0] * off, z0 + 7 * t + n[1] * off];
  const lin = [onBack(0.12, 0), onBack(0.86, 0), onBack(0.86, 0.5), onBack(0.12, 0.5)];
  const backNormal: V3 = [0, n[0], n[1]];
  const backScrews = ([[-9, 0.22], [9, 0.22], [-9, 0.76], [9, 0.76], [0, 0.22], [0, 0.76]] as const).map(([x, t]) => {
    const [y, z] = onBack(t, 0.5);
    return [x, y, z] as V3;
  });
  const yAt = (z: number) => -13 - ((z - z0) / 7) * 4;
  const linL = [[yAt(31) + 0.8, 31], [12, 31], [14.2, 33.6], [yAt(33.6) + 0.8, 33.6]] as const;
  const lipBackY = -14 - fl - 0.1;
  const lipFrontY = 14 + fl + 0.1;
  return (
    <Group id="hopper">
      <Extrude id="back" material="steel" {...plateX(-13, 13, [[-15, z0], [-13, z0], [-13 - fl, H.backTop], [-15 - fl, H.backTop]])} />
      <Extrude id="left" material="steel" {...plateX(-14.6, -13, sidePoly)} />
      <Extrude id="right" material="steel" {...plateX(13, 14.6, sidePoly)} />
      <Marks id="right-screws" material="steel" {...faceScrews('x', [[14.6, -12.5, 31.4], [14.6, 0, 31.4], [14.6, 12.5, 31.4]], 0.7)} />
      <Extrude id="linerBack" material="steel" outline="lo" {...plateX(-11.4, 11.4, lin)} />
      <Marks id="linerBack-screws" material="steel" dots={dots(backScrews, backNormal)} />
      <Extrude id="linerLeft" material="steel" outline="lo" {...plateX(-13, -12.5, linL)} />
      <Marks id="linerLeft-screws" material="steel" dots={dots([[-12.5, -9, 32.6], [-12.5, 0, 32.6], [-12.5, 9, 32.6]], [1, 0, 0])} />
      <Extrude id="front" material="steel" {...plateX(-13, 13, [[13, z0], [15, z0], [15 + fl, H.frontTop], [13 + fl, H.frontTop]])} />
      <Box id="lipBack" material="steel" {...corners([-13, -15 - fl - 0.6, H.backTop], [13, -13 - fl + 0.4, H.backTop + 0.9])} r={0.3} />
      <Marks id="lipBack-screws" material="steel" {...screws([-9, 0, 9].map((x) => [x, lipBackY] as const), H.backTop + 0.9, 0.6, 0.4)} />
      <Box id="lipFront" material="steel" {...corners([-14.6, 13 + fl - 0.4, H.frontTop], [14.6, 15 + fl + 0.6, H.frontTop + 0.9])} r={0.3} />
      <Marks id="lipFront-screws" material="steel" {...screws([-9, 0, 9].map((x) => [x, lipFrontY] as const), H.frontTop + 0.9, 0.6, 0.4)} />
      {/* The photo-eye: it sees a packet enter and asks the drive for speed. */}
      <Box id="eyeEmitter" material="steel" {...corners([-17.2, 0.4, 31], [-14.6, 3.6, 33.4])} r={0.5} />
      <Box id="eye" material="steel" {...corners([14.6, 0.4, 31], [17.2, 3.6, 33.4])} r={0.5} />
      <Marks id="eye-lens" material="steel" segments={circle([15.9, 3.6, 32.2], 0.7, [0, 1, 0])} dots={dots([[15.9, 3.6, 32.2]], [0, 1, 0], 0.5, 'hi')} />
    </Group>
  );
}
