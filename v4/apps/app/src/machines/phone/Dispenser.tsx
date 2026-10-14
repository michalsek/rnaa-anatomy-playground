/**
 * The fluff dispenser under the display (v2 phone.mjs L231–274), React blue: the mounting plate,
 * the drop pipe (neck), the collars, the sight cage (v4: four rods, so the queued beads show; v2's
 * glass tube was see-through), the star valve's box with its sight glass (a dark window, the rotor's
 * six spokes on a `rotor` group) and its gearmotor, and the knurled nozzle down to the tip. The
 * beads (the sim's queue and the ones dropping through the valve) are a bead pool.
 */
import { boltCircle } from '@anatomy/engine';
import { Box, Group, Lathe, Marks } from '../../blocks/blocks.tsx';
import { BeadPool } from '../Beads.tsx';
import { type V3, corners, faceScrews, ribs, rod, turned } from '../kit.ts';
import { dispenserDims } from './dims.ts';

const KNURL = ribs(16, 'lo');

export function Dispenser({ beads }: { beads: number }) {
  const { g, dx, dy, VB, VC, cageR, rod: rr } = dispenserDims();
  const [p0, p1] = g.plate;
  const [n0, n1] = g.neck;
  const [t0, t1] = g.tube;
  const glass = turned([[0, 4.6], [1.2, 4.6], [1.2, 3.7], [1.5, 3.7]]);
  const motor = turned([[0, 4.4], [1.2, 4.4], [1.2, 3.8], [9.6, 3.8], [9.6, 3.2], [10.6, 2.8], [11.2, 1.6], [11.4, 0]]);
  const nozzle = turned([[0, 4], [1.4, 4], [1.4, 2.9], [7.4, 2.5], [7.4, 3.2], [9.4, 3.2], [9.4, 2.6], [11, 2.6]]);
  const spokes = Array.from({ length: 6 }, (_, k) => {
    const a = (k * Math.PI) / 3;
    return { a: [0.9 * Math.cos(a), 0, 0.9 * Math.sin(a)] as V3, b: [3.7 * Math.cos(a), 0, 3.7 * Math.sin(a)] as V3, normal: [0, 1, 0] as V3, tone: 'mid' as const };
  });
  return (
    <Group id="dispenser" contacts={false}>
      <Box id="plate" material="react" outline="mid" {...corners([dx - 12, dy - 12, p0], [dx + 12, dy + 12, p1])} r={2} />
      <Marks
        id="plate-screws"
        material="react"
        {...(() => {
          const a = faceScrews('y', [[dx - 8, dy + 12, p0 + 1.2], [dx + 8, dy + 12, p0 + 1.2]], 0.7, 0.36);
          const b = faceScrews('x', [[dx + 12, dy - 8, p0 + 1.2], [dx + 12, dy + 8, p0 + 1.2]], 0.7, 0.36);
          return { segments: [...a.segments, ...b.segments], dots: [...a.dots, ...b.dots] };
        })()}
      />
      <Group id="axis" position={[dx, dy, 0]}>
        <Lathe id="neck" material="react" profile={rod(3.4, n0, n1)} steps={24} seams={[n0 + 2, n1 - 2]} />
        <Lathe id="collarTop" material="react" profile={rod(5.4, g.collarTop[0], g.collarTop[1])} steps={28} seams={[g.collarTop[0] + 1.5]} />
        <Lathe id="collarBottom" material="react" profile={rod(5.4, g.collarBottom[0], g.collarBottom[1])} steps={28} />
        {/* The sight cage: four rods outside the beads (r 2.4 in a 4.4 cage). */}
        {[45, 135, 225, 315].map((deg) => {
          const a = (deg * Math.PI) / 180;
          return <Lathe key={deg} id={`cage${deg}`} material="react" profile={rod(rr, t0, t1)} steps={10} position={[cageR * Math.cos(a), cageR * Math.sin(a), 0]} />;
        })}
        <Lathe id="nozzle" material="react" profile={nozzle} steps={24} lineSets={[{ segment: 5, lines: KNURL }]} position={[0, 0, VB.z0]} rotation={[180, 0, 0]} />
      </Group>
      <Box id="valve" material="react" outline="mid" {...corners([VB.x0, VB.y0, VB.z0], [VB.x1, VB.y1, VB.z1])} r={1.4} seams={[VB.z1 - 1.6]} />
      <Marks id="valve-screws" material="react" {...faceScrews('y', [[VB.x0 + 1.8, VB.y1, VB.z0 + 1.6], [VB.x1 - 1.8, VB.y1, VB.z0 + 1.6]], 0.7, 0.38)} />
      {/* The sight glass on +y: its flange, the dark window, the rotor's spokes. */}
      <Group id="glass" position={VC} rotation={[-90, 0, 0]}>
        <Lathe id="flange" material="react" profile={glass} steps={28} />
        <Lathe id="window" material="screen" outline="mid" profile={rod(3.7, 1.5, 1.52)} steps={28} />
        <Marks id="bolts" material="react" dots={boltCircle({ center: [0, 0, 1.2], r: 4.15, count: 4, phase: Math.PI / 4, size: 0.4, tone: 'lo' })} />
      </Group>
      <Group id="rotor" moves position={[VC[0], VC[1] + 1.58, VC[2]]}>
        <Marks id="spokes" material="graphite" segments={spokes} dots={[{ at: [0, 0, 0], size: 0.5, normal: [0, 1, 0] }]} />
      </Group>
      <Lathe id="motor" material="react" profile={motor} steps={28} lineSets={[{ segment: 3, lines: ribs(18, 'lo') }]} position={[VB.x1, dy, VC[2]]} rotation={[0, 90, 0]} />
      <BeadPool capacity={beads} />
    </Group>
  );
}
