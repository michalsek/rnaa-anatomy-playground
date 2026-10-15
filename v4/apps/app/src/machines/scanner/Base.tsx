/**
 * The scanner's base and pedestal (v2 scanner.mjs L33–58): the floor plate on four levelling feet
 * (`stand`) with its seam, inset outline and corner screws, the label plate; the pedestal: flange
 * with screws, four gusset ribs, the turned column with two seam rings, the cap flange; the deck
 * casting the arm stands on.
 */
import { Box, Extrude, Group, Halo, Lathe, Marks } from '../../blocks/blocks.tsx';
import { type V3, corners, disc, placeFrame, screws } from '../kit.ts';
import { BASE, COLUMN, LABEL, planOutline } from './dims.ts';

const B = BASE;
/** Corners of a plan inset by d. */
const cornersOf = (d: number): [number, number][] => [
  [B.x0 + d, B.y0 + d],
  [B.x1 - d, B.y0 + d],
  [B.x0 + d, B.y1 - d],
  [B.x1 - d, B.y1 - d],
];

/** A slab on the base plan (plate or deck): seam, inset outline on top, corner screws. */
function Slab({ id, z0, z1, seam, inset, screwAt }: { id: string; z0: number; z1: number; seam: number; inset: number; screwAt: number }) {
  return (
    <Group id={id}>
      <Box id="slab" material="steel" {...(id === 'plate' && { outline: 'lo' as const })} {...corners([B.x0, B.y0, z0], [B.x1, B.y1, z1])} r={B.r} seams={[seam]} />
      <Marks
        id="marks"
        material="steel"
        segments={[...planOutline(B.x0 + inset, B.y0 + inset, B.x1 - inset, B.y1 - inset, B.r - 1, z1), ...screws(cornersOf(screwAt), z1, 1.2, 0.45).segments]}
        dots={screws(cornersOf(screwAt), z1, 1.2, 0.45).dots}
      />
    </Group>
  );
}

export function Base({ stand }: { stand: boolean }) {
  const L = LABEL;
  const rules = [4.2, 3.2, 2.2].map((len, i) => ({ a: [L.x0 + 2, L.y0 + 2 + i * 1.3, 6.6] as V3, b: [L.x0 + 2 + len, L.y0 + 2 + i * 1.3, 6.6] as V3, tone: 'lo' as const, normal: [0, 0, 1] as const }));
  return (
    <Group id="base">
      <Halo id="halo" plan={{ w: B.x1 - B.x0, d: B.y1 - B.y0, r: B.r }} position={[(B.x0 + B.x1) / 2, (B.y0 + B.y1) / 2, 0]} />
      {stand &&
        cornersOf(4).map(([x, y], i) => <Lathe key={i} id={`foot${i}`} material="steel" outline="lo" profile={disc(2.4, 0, 2)} steps={20} position={[x, y, 0]} />)}
      <Slab id="plate" z0={2} z1={6} seam={4} inset={2.6} screwAt={4.2} />
      <Box id="label" material="steel" {...corners([L.x0, L.y0, 6], [L.x1, L.y1, 6.6])} r={0.6} />
      <Marks
        id="label-marks"
        material="steel"
        segments={[...planOutline(L.x0 + 1, L.y0 + 1, L.x1 - 1, L.y1 - 1, 0.3, 6.6), ...rules]}
        dots={[{ at: [L.x0 + 1, L.y1 - 1, 6.6], size: 0.35, normal: [0, 0, 1] }]}
      />
    </Group>
  );
}

export function Pedestal() {
  const { x, y } = COLUMN;
  const flangeScrews = [0, 1, 2, 3, 4, 5]
    .map((i) => [x + 7 * Math.cos((i * Math.PI) / 3 + 0.5), y + 7 * Math.sin((i * Math.PI) / 3 + 0.5)] as [number, number])
    .filter(([sx, sy]) => sx - x + (sy - y) > -4);
  return (
    <Group id="pedestal">
      <Lathe id="flange" material="steel" profile={disc(8.5, 6, 8.5)} position={[x, y, 0]} />
      <Marks id="flange-screws" material="steel" {...screws(flangeScrews, 8.5, 0.8, 0.35)} />
      {[45, 135, 225, 315].map((deg) => {
        const a = (deg * Math.PI) / 180;
        // v2 F: axis along the tangent, u radial, v up (model y = −z here).
        const F = placeFrame([x, y, 8.5], [-Math.sin(a), Math.cos(a), 0], [Math.cos(a), Math.sin(a), 0]);
        return <Extrude key={deg} id={`rib${deg}`} material="steel" plan={{ polygon: [[6, 0], [8.4, 0], [6, -9]] }} z={-0.6} height={1.2} {...F} />;
      })}
      <Lathe id="column" material="steel" profile={disc(6, 8.5, 78)} seams={[34, 58]} position={[x, y, 0]} />
      <Lathe id="cap" material="steel" profile={disc(8, 78, 80)} position={[x, y, 0]} />
      <Slab id="deck" z0={80} z1={86} seam={82.5} inset={2.4} screwAt={4} />
    </Group>
  );
}
