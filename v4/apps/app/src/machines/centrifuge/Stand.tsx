/**
 * The stand (v2 L149–212): halo, floor skids with lifting eyes, four legs on feet and levellers,
 * leg pads with rubber isolators under the base flange, rails, and the cooler shelf with its
 * gussets and label plate.
 */
import { Box, Extrude, Group, Halo, Lathe, Marks, Tube } from '../../blocks/blocks.tsx';
import { LEG, SHELF_TOP, closed, corners, screws } from './dims.ts';

const LEGS = [
  [-LEG, -LEG],
  [LEG, -LEG],
  [-LEG, LEG],
  [LEG, LEG],
] as const;
const SKID = 4;
const IN = LEG - 2.5;
/** The isolator: a rubber bun, r 2.4 → 3.1 → 2.4 over z 98.2–100 (v2 samples a sine). */
const ISOLATOR = [
  [0, 98.2],
  [2.4, 98.2],
  [2.9, 98.7, true],
  [3.1, 99.1, true],
  [2.9, 99.5, true],
  [2.4, 100],
  [0, 100],
] as const;
const circle = (cx: number, cz: number, r: number, y: number, n = 24) =>
  Array.from({ length: n }, (_, k) => {
    const t = (2 * Math.PI * k) / n;
    return [cx + r * Math.cos(t), y, cz + r * Math.sin(t)] as const;
  });

function Leg({ k, x, y }: { k: number; x: number; y: number }) {
  const sx = Math.sign(x);
  const sy = Math.sign(y);
  const pad = screws(
    [
      [x + sx * 2.6, y + sy * 2.6],
      [x - sx * 2.6, y + sy * 2.6],
      [x + sx * 2.6, y - sy * 2.6],
    ],
    98.2,
    0.9,
    0.4,
  );
  const footDots = [0, 1, 2, 3].map((i) => {
    const t = (i + 0.5) * (Math.PI / 2);
    return { at: [x + 3.8 * Math.cos(t), y + 3.8 * Math.sin(t), SKID + 1.6] as const, size: 0.4, normal: [0, 0, 1] as const };
  });
  return (
    <Group id={`leg${k}`}>
      <Extrude id="foot" material="steel" outline="lo" plan={{ circle: 5, steps: 32 }} z={SKID} height={1.6} position={[x, y, 0]} />
      <Marks id="foot-dots" material="steel" dots={footDots} />
      <Extrude id="leveller" material="steel" plan={{ circle: 3.2, steps: 24 }} z={SKID + 1.6} height={3.4} seams={[7.3]} position={[x, y, 0]} />
      <Extrude id="leg" material="steel" plan={{ rect: [5, 5], r: 0.6, steps: 3 }} z={SKID + 5} height={96 - SKID - 5} seams={[34, 70]} position={[x, y, 0]} />
      <Extrude id="pad" material="steel" plan={{ rect: [9, 9], r: 0.8, steps: 3 }} z={96} height={2.2} position={[x, y, 0]} />
      <Marks id="pad-screws" material="steel" {...pad} />
      <Lathe id="isolator" material="steel" outline="lo" profile={ISOLATOR} steps={24} subdivisions={3} position={[x, y, 0]} />
    </Group>
  );
}

export function Stand() {
  const plate = { x: LEG + 2.5 + 1.2, y: -9, w: 4.6, d: 18 };
  const top = SHELF_TOP + 0.6;
  const inset = 0.8;
  return (
    <Group id="stand">
      <Halo id="halo" plan={{ w: 68, d: 68, r: 30 }} />
      {[-LEG, LEG].map((y, k) => (
        <Group key={k} id={`skid${k}`}>
          <Box id="skid" material="steel" outline="lo" {...corners([-40, y - 3.5, 0], [40, y + 3.5, SKID])} r={0.6} seams={[SKID / 2]} />
          {[-36.5, 36.5].map((x, j) => (
            <Tube key={j} id={`eye${j}`} material="steel" path={circle(x, SKID + 2.3, 1.775, y)} radius={0.525} sides={12} bend={0} closed />
          ))}
        </Group>
      ))}
      {LEGS.map(([x, y], k) => (
        <Leg key={k} k={k} x={x} y={y} />
      ))}
      {/* Rails at z 22 (all four sides) and z 58 (front and back). */}
      <Box id="rail0" material="steel" {...corners([-IN, -LEG - 1.5, 22], [IN, -LEG + 1.5, 26])} r={0.4} />
      <Box id="rail1" material="steel" {...corners([-IN, LEG - 1.5, 22], [IN, LEG + 1.5, 26])} r={0.4} />
      <Box id="rail2" material="steel" {...corners([-LEG - 1.5, -IN, 22], [-LEG + 1.5, IN, 26])} r={0.4} />
      <Box id="rail3" material="steel" {...corners([LEG - 1.5, -IN, 22], [LEG + 1.5, IN, 26])} r={0.4} />
      <Box id="rail-upper0" material="steel" {...corners([-IN, -LEG - 1.5, 58], [IN, -LEG + 1.5, 61])} r={0.4} />
      <Box id="rail-upper1" material="steel" {...corners([-IN, LEG - 1.5, 58], [IN, LEG + 1.5, 61])} r={0.4} />
      {/* The cooler shelf between the +x legs. */}
      <Box id="shelf" material="steel" {...corners([LEG + 2.5, -LEG - 2.5, SHELF_TOP - 2.5], [LEG + 24, LEG + 2.5, SHELF_TOP])} r={0.8} seams={[SHELF_TOP - 1.25]} />
      <Marks id="shelf-screws" material="steel" {...screws([[29.4, -24.6], [29.4, 24.6]], SHELF_TOP, 0.9, 0.4)} />
      {[-LEG, LEG].map((y, k) => (
        // A triangle in the xz plane, 2 thick in y: model (x, y) = world (x, z).
        <Extrude
          key={k}
          id={`gusset${k}`}
          material="steel"
          plan={{ polygon: [[LEG + 2.5, SHELF_TOP - 2.5], [LEG + 15, SHELF_TOP - 2.5], [LEG + 2.5, SHELF_TOP - 16]] }}
          z={-1}
          height={2}
          rotation={[90, 0, 0]}
          position={[0, y, 0]}
        />
      ))}
      <Box id="label" material="steel" {...corners([plate.x, plate.y, SHELF_TOP], [plate.x + plate.w, plate.y + plate.d, top])} r={0.6} />
      <Marks
        id="label-marks"
        material="steel"
        segments={[
          ...closed(
            [
              [plate.x + inset, plate.y + inset, top],
              [plate.x + plate.w - inset, plate.y + inset, top],
              [plate.x + plate.w - inset, plate.y + plate.d - inset, top],
              [plate.x + inset, plate.y + plate.d - inset, top],
            ],
            [0, 0, 1],
            'faint',
          ),
          ...[0, 1, 2].map((i) => ({
            a: [plate.x + 1.6 + i * 1.1, plate.y + 3, top] as const,
            b: [plate.x + 1.6 + i * 1.1, plate.y + [12, 9, 13][i]!, top] as const,
            normal: [0, 0, 1] as const,
            tone: 'lo' as const,
          })),
        ]}
        dots={[
          { at: [plate.x + plate.w / 2, plate.y + 1.4, top], size: 0.38, normal: [0, 0, 1] },
          { at: [plate.x + plate.w / 2, plate.y + plate.d - 1.4, top], size: 0.38, normal: [0, 0, 1] },
        ]}
      />
    </Group>
  );
}
