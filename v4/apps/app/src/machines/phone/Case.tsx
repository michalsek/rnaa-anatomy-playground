/**
 * The phone's case (v2 phone.mjs L39–157 with `walls: "low"`): the back plate, the low band in
 * two clean pieces (far and near halves), the buttons on +x, the USB-C port on the +y end, and
 * the floor details the machines stand over (vapour plate, battery, label, standoffs, bosses).
 * Its halo lies under the case. Static.
 */
import { Box, Extrude, Group, Halo, Lathe, Marks } from '../../blocks/blocks.tsx';
import { type V3, circle, closed, corners, rod, screws } from '../kit.ts';
import { bandHalves, caseDims, roundedRing } from './dims.ts';

/** A rounded-rect plan outline as segments on a horizontal face at z. */
const planOutline = (x0: number, y0: number, x1: number, y1: number, r: number, z: number, tone: 'lo' | 'faint' | 'mid' = 'faint') => {
  const { points } = roundedRing(x1 - x0, y1 - y0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2), 4, (x0 + x1) / 2, (y0 + y1) / 2);
  return closed(points.map(([x, y]) => [x, y, z] as V3), [0, 0, 1], tone);
};

/** A floor slab (0.4 thick) with an inset outline. */
function FloorPlate({ id, x0, y0, x1, y1, r, outline, inset }: { id: string; x0: number; y0: number; x1: number; y1: number; r: number; outline: 'mid' | 'lo'; inset: number }) {
  return (
    <Group id={id}>
      <Extrude id="slab" material="steel" outline={outline} plan={{ rect: [x1 - x0, y1 - y0], r, steps: 6 }} position={[(x0 + x1) / 2, (y0 + y1) / 2, 0]} height={0.4} />
      <Marks id="inset" material="steel" segments={planOutline(x0 + inset, y0 + inset, x1 - inset, y1 - inset, Math.max(0.5, r - inset), 0.4)} />
    </Group>
  );
}

export function Case() {
  const c = caseDims();
  const { w, d, back, cut } = c;
  const bands = bandHalves();
  const X = w / 2;
  const Y = d / 2;
  // Floor details (v2: inset 22 vapour plate over the first fifth, battery, label, standoffs, bosses).
  const VC = { x0: -w / 2 + 22, y0: -d / 2 + 22, x1: w / 2 - 22, y1: -d / 2 + 22 + d * 0.2 };
  const BAT = { x0: -w / 2 + 26, y0: -d * 0.06, x1: w / 2 - 26, y1: d * 0.28 };
  const LBL = { x0: -w / 2 + 24, y0: d / 2 - 64, x1: -w / 2 + 84, y1: d / 2 - 40 };
  const sInset = c.t + 16;
  const standoffs: [number, number][] = [-1, 1].flatMap((sx) => [-d / 2 + sInset + 8, 0, d / 2 - sInset - 8].map((y) => [sx * (w / 2 - sInset), y] as [number, number]));
  const bosses: [number, number][] = [-1, 1].flatMap((sx) => [-d / 4, d / 4].map((y) => [sx * (w / 2 - c.t - 2.6), y] as [number, number]));
  const vcCorners: [number, number][] = [
    [VC.x0 + 8, VC.y0 + 8],
    [VC.x1 - 8, VC.y0 + 8],
    [VC.x0 + 8, VC.y1 - 8],
    [VC.x1 - 8, VC.y1 - 8],
  ];
  const vcScrews = screws(vcCorners, 0.4, 1.4, 0.45);
  return (
    <Group id="case" contacts={false}>
      <Halo id="halo" plan={{ w: w + 8, d: d + 8, r: c.r + 4 }} position={[0, 0, -back]} />
      <Extrude id="back" material="steel" outline="lo" plan={{ rect: [c.inner.w, c.inner.d], r: c.inner.r, steps: 10 }} position={[0, 0, -back]} height={back} />
      <Extrude id="far" material="steel" outline="mid" plan={bands.far} position={[0, 0, -back]} height={cut + back} />
      <Extrude id="near" material="steel" outline="mid" plan={bands.near} position={[0, 0, -back]} height={cut + back} />
      {/* Buttons on the +x side (action, volume up, volume down). */}
      {(
        [
          ['action', -d / 2 + 96, -d / 2 + 112],
          ['volUp', -d / 2 + 130, -d / 2 + 160],
          ['volDown', -d / 2 + 172, -d / 2 + 202],
        ] as const
      ).map(([id, y0, y1]) => (
        <Box key={id} id={id} material="steel" {...corners([X, y0, 10], [X + 1.8, y1, 26])} r={0.8} />
      ))}
      {/* USB-C on the +y end: the recess, its tongue slot. */}
      <Group id="usb" position={[0, Y, 0]}>
        <Box id="port" material="steel" outline="lo" tone="gradient" gradient={{ from: [0, 0, 22], to: [0, 0, 13], stops: ['void0', 'void1', 'void2'], mid: 0.55 }} {...corners([-14, -0.05, 13], [14, 0.02, 22])} r={0} />
        <Marks id="tongue" material="steel" segments={closed([[-8, 0.04, 16.4], [8, 0.04, 16.4], [8, 0.04, 18.6], [-8, 0.04, 18.6]], [0, 1, 0], 'mid')} />
      </Group>
      {/* The floor: vapour plate, battery, label, standoffs, bosses (low and flat). */}
      <FloorPlate id="vapour" {...VC} r={14} outline="mid" inset={4} />
      <Marks id="vapour-screws" material="steel" dots={vcScrews.dots} segments={[...vcScrews.segments, ...planOutline(VC.x0 + 14, (VC.y0 + VC.y1) / 2 - 3, VC.x1 - 14, (VC.y0 + VC.y1) / 2 + 3, 3, 0.4)]} />
      <FloorPlate id="battery" {...BAT} r={8} outline="lo" inset={3} />
      <Marks
        id="battery-lines"
        material="steel"
        segments={[0, 1].map((i) => ({ a: [BAT.x0 + 10, BAT.y0 + 12 + i * 6, 0.4] as V3, b: [BAT.x0 + 10 + (BAT.x1 - BAT.x0) * (i ? 0.3 : 0.42), BAT.y0 + 12 + i * 6, 0.4] as V3, normal: [0, 0, 1] as V3, tone: 'lo' as const }))}
      />
      <FloorPlate id="label" {...LBL} r={1.5} outline="lo" inset={2} />
      <Marks
        id="label-lines"
        material="steel"
        segments={[40, 30, 34].map((len, i) => ({ a: [LBL.x0 + 6, LBL.y0 + 6 + i * 5, 0.4] as V3, b: [LBL.x0 + 6 + len, LBL.y0 + 6 + i * 5, 0.4] as V3, normal: [0, 0, 1] as V3, tone: 'lo' as const }))}
      />
      {standoffs.map(([x, y], i) => (
        <Group key={`s${i}`} id={`standoff${i}`} position={[x, y, 0]}>
          <Lathe id="post" material="steel" profile={rod(3.2, 0, 5)} steps={20} />
          <Marks id="screw" material="steel" segments={circle([0, 0, 5], 1.5, [0, 0, 1], 'lo', 12)} dots={[{ at: [0, 0, 5], size: 0.45, normal: [0, 0, 1] }]} />
        </Group>
      ))}
      {bosses.map(([x, y], i) => (
        <Group key={`b${i}`} id={`boss${i}`} position={[x, y, 0]}>
          <Lathe id="boss" material="steel" profile={rod(2.6, 0, 3.6)} steps={16} />
          <Marks id="dot" material="steel" dots={[{ at: [0, 0, 3.6], size: 0.4, normal: [0, 0, 1], tone: 'lo' }]} />
        </Group>
      ))}
    </Group>
  );
}

