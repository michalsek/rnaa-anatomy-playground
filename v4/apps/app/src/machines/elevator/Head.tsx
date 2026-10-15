/**
 * The elevator's head and drive (v2 elevator.mjs L132–208, `access: false`): the open head frame
 * on the posts (ring beams, side beams, pillow blocks with screws, top beams); the turning wheel
 * (`wheel`, spun about x by the frame hook): the shaft in pieces, two hub flanges, two toothed
 * sprockets (fading U teeth, the near one with a bolt circle) and the hub; the discharge hopper
 * on two arms behind the head (flange with its mouth and screws), the duct with its flange, the
 * down-spout and its flange; the graphite drive: gearbox on its torque arm and beam, the ribbed
 * motor along +y with its terminal box, and the drive lamp (lit).
 */
import { type ElevatorGeometry, sphereProfile } from '@anatomy/engine';
import { Box, Group, Lathe, Marks } from '../../blocks/blocks.tsx';
import { FX, FY, type V3, circle, corners, disc, ribs, rod, screws } from '../kit.ts';
import { TopOpening } from '../Opening.tsx';
import { EL, PH, PX, PY, tower } from './dims.ts';

const [PXL, PXR] = PX;
const [PYB, PYF] = PY;
const TEETH = { segment: 1, lines: ribs(30, 'lo') };

/** Head frame, the turning wheel (in `wheel`), the discharge. */
export function Head({ g }: { g: ElevatorGeometry }) {
  const { zh } = g;
  const t = tower(g);
  const [zr0, zr1] = t.ringZ;
  return (
    <Group id="head">
      <Group id="frame">
        <Box id="ringL" material="steel" {...corners([PXL - PH, PYB + PH, zr0], [PXL + PH, PYF - PH, zr1])} r={0.3} />
        <Box id="ringR" material="steel" {...corners([PXR - PH, PYB + PH, zr0], [PXR + PH, PYF - PH, zr1])} r={0.3} />
        <Box id="ringB" material="steel" {...corners([PXL + PH, PYB - PH, zr0], [PXR - PH, PYB + PH, zr1])} r={0.3} />
        <Box id="ringF" material="steel" {...corners([PXL + PH, PYF - PH, zr0], [PXR - PH, PYF + 0.8, zr1])} r={0.3} />
        {PX.map((x, i) => (
          <Group key={i} id={`side${i}`}>
            <Box id="beam" material="steel" {...corners([x - PH, PYB + PH, zh - 6], [x + PH, PYF - PH, zh - 3.5])} r={0.3} />
            <Box id="pillow" material="steel" {...corners([x - PH, -3.5, zh - 3.5], [x + PH, 3.5, zh + 3.6])} r={0.3} />
            <PillowMarks x={x} z={zh + 3.6} shaftZ={zh} />
            <Box id="top" material="steel" {...corners([x - PH, PYB + PH, t.top - 2], [x + PH, PYF - PH, t.top])} r={0.3} />
          </Group>
        ))}
      </Group>
      <Group id="wheel" moves position={[0, EL.yc, zh]}>
        <Wheel />
      </Group>
      <Discharge g={g} />
    </Group>
  );
}

/** Pillow block screws; the +x one also shows the shaft's ring on its outer face. */
function PillowMarks({ x, z, shaftZ }: { x: number; z: number; shaftZ: number }) {
  const sc = screws([[x, -2.6], [x, 2.6]], z, 0.45, 0.28);
  const ring = x > 0 ? circle([x + PH, 0, shaftZ], 2.2, [1, 0, 0], 'lo', 20) : [];
  return <Marks id="pillow-marks" material="steel" segments={[...sc.segments, ...ring]} dots={sc.dots} />;
}

/** The shaft along x with its flanges, sprockets and hub (v2 `AX` pieces), about the origin. */
function Wheel() {
  const piece = (id: string, x0: number, x1: number, r: number, outline?: 'hi' | 'lo') => (
    <Lathe id={id} material="steel" {...(outline && { outline })} profile={rod(r, 0, x1 - x0)} steps={r > 3 ? 40 : 16} {...FX(x0, 0, 0)} />
  );
  const sprocket = (id: string, x0: number) => <Lathe id={id} material="steel" profile={rod(12.4, 0, 1.4)} steps={72} lineSets={[TEETH]} {...FX(x0, 0, 0)} />;
  const boltsR = [0, 1, 2, 3, 4, 5].map((k) => [7.1 * Math.cos((k * Math.PI) / 3 + 0.3), 7.1 * Math.sin((k * Math.PI) / 3 + 0.3), 1.4] as V3);
  const flangeDots = [0, 1, 2, 3, 4, 5].map((k) => [3.8 * Math.cos((k * Math.PI) / 3), 3.8 * Math.sin((k * Math.PI) / 3), 1.4] as V3);
  return (
    <>
      {piece('shaftL', -12.6, PXL - PH, 1.5, 'hi')}
      {piece('shaftLi', PXL + PH, -7.1, 1.5)}
      {piece('flangeL', -7.1, -5.7, 5)}
      {sprocket('sprocketL', -5.7)}
      {piece('hub', -4.3, 4.3, 3.4)}
      {sprocket('sprocketR', 4.3)}
      <Marks
        id="sprocketR-marks"
        material="steel"
        segments={[...circle([0, 0, 1.4], 9.6, [0, 0, 1], 'faint', 48), ...circle([0, 0, 1.4], 4.6, [0, 0, 1], 'faint', 32)]}
        dots={boltsR.map((at) => ({ at, size: 0.3, normal: [0, 0, 1] as V3 }))}
        {...FX(4.3, 0, 0)}
      />
      {piece('flangeR', 5.7, 7.1, 5)}
      <Marks id="flangeR-dots" material="steel" dots={flangeDots.map((at) => ({ at, size: 0.3, normal: [0, 0, 1] as V3 }))} {...FX(5.7, 0, 0)} />
      {piece('shaftRi', 7.1, PXR - PH, 1.5)}
      {piece('shaftR', PXR + PH, 12.4, 1.5, 'hi')}
    </>
  );
}

/** The hopper on its arms, the duct and the down-spout (v2 −y variant at `reach`). */
function Discharge({ g }: { g: ElevatorGeometry }) {
  const H = EL.hopper;
  const z0 = g.hopperZ0;
  const z1 = g.hopperZ1;
  const rim = g.rim;
  const d = g.duct;
  const [sx, sy] = g.spout;
  const mouthScrews: [number, number][] = [
    [H.x0 - 0.1, H.y0 - 0.1],
    [H.x1 + 0.1, H.y0 - 0.1],
    [H.x0 - 0.1, H.y1 + 0.1],
    [H.x1 + 0.1, H.y1 + 0.1],
    [0, H.y1 + 0.1],
    [0, H.y0 - 0.1],
  ];
  return (
    <Group id="discharge">
      {PX.map((x, i) => (
        <Box key={i} id={`arm${i}`} material="steel" {...corners([x - PH, H.y1, z0], [x + PH, PYB - PH, z0 + 2.4])} r={0.3} />
      ))}
      <Box id="hopper" material="steel" {...corners([H.x0, H.y0, z0], [H.x1, H.y1, z1])} r={0.6} seams={[z0 + 3, z0 + 7]} />
      <Box id="hopperFlange" material="steel" {...corners([H.x0 - 0.8, H.y0 - 0.8, z1], [H.x1 + 0.8, H.y1 + 0.8, rim])} r={0.8} />
      <TopOpening id="mouth" x0={H.x0 + 1.4} x1={H.x1 - 1.4} y0={H.y0 + 1.4} y1={H.y1 - 1.4} z={rim} />
      <Marks id="mouth-screws" material="steel" {...screws(mouthScrews, rim, 0.4, 0.26)} />
      <Box id="ductFlange" material="steel" {...corners([-7.5, H.y0 - 1, d.z0 - 1.5], [7.5, H.y0, d.z1 + 1.5])} r={0.4} />
      <Box id="duct" material="steel" {...corners([-EL.ductHalf, d.y0, d.z0], [EL.ductHalf, d.y1, d.z1])} r={0.5} />
      <Lathe id="spout" material="steel" profile={disc(EL.spoutR, g.zh - 6, d.z0)} seams={[g.zh - 1]} steps={48} position={[sx, sy, 0]} />
      <Lathe id="spoutFlange" material="steel" outline="lo" profile={disc(8, g.ports.out[2], g.zh - 6)} steps={48} position={[sx, sy, 0]} />
    </Group>
  );
}

/** The graphite drive on the +x side and the drive lamp (v2 L188–208). */
export function Drive({ g }: { g: ElevatorGeometry }) {
  const { zh } = g;
  const zhb = tower(g).ringZ[1];
  const GB = { x0: 12.4, x1: 21, y0: -10, y1: 6 };
  const motor = FY(16.7, GB.y1, zh);
  const tb = { x0: 14.4, x1: 19, y0: 11, y1: 16, z0: zh + 4.1, z1: zh + 7.4 };
  const lamp: V3 = [16.7, -6, zh + 6];
  return (
    <Group id="drive">
      <Box id="gearbox" material="graphite" {...corners([GB.x0, GB.y0, zh - 6], [GB.x1, GB.y1, zh + 6])} r={1} seams={[zh]} />
      <Marks
        id="gearbox-screws"
        material="graphite"
        {...screws([[GB.x0 + 1.6, GB.y0 + 1.6], [GB.x1 - 1.6, GB.y0 + 1.6], [GB.x0 + 1.6, GB.y1 - 1.6], [GB.x1 - 1.6, GB.y1 - 1.6]], zh + 6, 0.6, 0.3)}
      />
      <Box id="arm" material="graphite" {...corners([15, -10, zhb], [18, -8, zh - 6])} r={0.3} />
      <Box id="beam" material="steel" {...corners([PXR + PH, PYB - 0.8, zhb - 2.4], [19, -7.5, zhb])} r={0.3} />
      <Lathe
        id="motor"
        material="graphite"
        profile={[[0, 0], [4.9, 0], [4.9, 1.2], [4.3, 1.2], [4.3, 13], [4.6, 13], [4.6, 15.4, true], [3.6, 16.4, true], [0, 16.9]]}
        lineSets={[{ segment: 3, lines: ribs(28, 'lo') }]}
        subdivisions={2}
        steps={40}
        {...motor}
      />
      <Box id="terminal" material="graphite" {...corners([tb.x0, tb.y0, tb.z0], [tb.x1, tb.y1, tb.z1])} r={0.3} />
      <Marks id="terminal-screws" material="graphite" {...screws([[tb.x0 + 0.6, tb.y0 + 0.6], [tb.x1 - 0.6, tb.y0 + 0.6], [tb.x0 + 0.6, tb.y1 - 0.6], [tb.x1 - 0.6, tb.y1 - 0.6]], tb.z1, 0.35, 0.24)} />
      <Group id="lamp" position={[lamp[0], lamp[1], 0]}>
        <Lathe id="base" material="steel" profile={disc(1.4, lamp[2], lamp[2] + 1)} steps={20} />
        <Lathe id="lens" material="lit" outline="hi" profile={sphereProfile(1.5, 12)} subdivisions={2} steps={24} position={[0, 0, lamp[2] + 2.6]} />
      </Group>
    </Group>
  );
}
