/**
 * The preamp and the cable (v2 scanner.mjs L109–143): a graphite box on four legs and pads
 * (`stand`), its seam, the lid with screws, seven fins on the +y face, the input boss and the
 * 4-cell buffer window on the +x face (each cell a live part that blends dark → mint as it
 * fills, E2), the output lip under the −y face; the round cable from the flex boss down to the
 * floor and along to the input, cut into pieces that blend mint as a pulse passes (E2), with a
 * connector shell at each end.
 */
import { Box, Group, Halo, Lathe, Marks, Tube } from '../../blocks/blocks.tsx';
import { FX, type V3, closed, corners, disc, faceScrews, frameAlong, screws, turned } from '../kit.ts';
import { CABLE_PIECES, CELLS, FINS, PRE, PRE_IN, PRE_LEGS, SC, SCANNER_CABLE } from './dims.ts';

const LIP = SC.lip;
const WIN = SC.win;

export function Preamp({ stand }: { stand: boolean }) {
  const lid = { x0: PRE.x0 + 0.8, y0: PRE.y0 + 0.8, x1: PRE.x1 - 0.8, y1: PRE.y1 - 0.8 };
  const lidScrews: [number, number][] = [
    [lid.x0 + 1.6, lid.y0 + 1.6],
    [lid.x1 - 1.6, lid.y0 + 1.6],
    [lid.x0 + 1.6, lid.y1 - 1.6],
    [lid.x1 - 1.6, lid.y1 - 1.6],
  ];
  const fx = PRE.x1;
  const win: V3[] = [[fx, WIN.y0, WIN.z0], [fx, WIN.y1, WIN.z0], [fx, WIN.y1, WIN.z1], [fx, WIN.y0, WIN.z1]];
  return (
    <Group id="preamp">
      <Halo id="halo" plan={{ w: PRE.x1 - PRE.x0, d: PRE.y1 - PRE.y0, r: 1 }} position={[(PRE.x0 + PRE.x1) / 2, (PRE.y0 + PRE.y1) / 2, 0]} />
      {stand &&
        PRE_LEGS.map(([x, y], i) => (
          <Group key={i} id={`leg${i}`} position={[x, y, 0]}>
            <Lathe id="pad" material="graphite" outline="lo" profile={disc(1.9, 0, 1)} steps={16} />
            <Lathe id="leg" material="graphite" profile={disc(1.1, 1, PRE.z0)} steps={14} />
          </Group>
        ))}
      <Box id="box" material="graphite" {...corners([PRE.x0, PRE.y0, PRE.z0], [PRE.x1, PRE.y1, PRE.z1])} r={1} seams={[PRE.z1 - 2]} />
      <Marks
        id="box-marks"
        material="graphite"
        segments={[...closed(win, [1, 0, 0], 'lo'), ...faceScrews('x', [[fx, PRE.y1 - 1.8, 18], [fx, PRE.y0 + 2, 18.6]], 0.5, 0.28).segments]}
        dots={faceScrews('x', [[fx, PRE.y1 - 1.8, 18], [fx, PRE.y0 + 2, 18.6]], 0.5, 0.28).dots}
      />
      {CELLS.map((c, i) => (
        <Box key={i} id={`cell${i}`} live material="rubber" blend={{ material: 'pkAudio' }} {...corners([fx - 0.05, c.y0, c.z0], [fx + 0.2, c.y1, c.z1])} />
      ))}
      <Box id="lid" material="graphite" {...corners([lid.x0, lid.y0, PRE.z1], [lid.x1, lid.y1, PRE.z1 + 1.2])} r={0.8} />
      <Marks id="lid-screws" material="graphite" {...screws(lidScrews, PRE.z1 + 1.2, 0.6, 0.3)} />
      {FINS.map((x, i) => (
        <Box key={i} id={`fin${i}`} material="graphite" {...corners([x, PRE.y1, 18], [x + 0.8, PRE.y1 + 1.8, 28.4])} r={0.2} />
      ))}
      <Lathe id="in" material="graphite" profile={turned([[-0.2, 1.6], [2, 1.6]])} steps={16} {...FX(...PRE_IN)} />
      <Box id="lip" material="graphite" {...corners([LIP.x0, LIP.y0, LIP.z0], [LIP.x1, LIP.y1, LIP.z1])} r={0.3} />
    </Group>
  );
}

/** The round cable: pieces along one centreline (the sim times the pulse on it), shells at the ends. */
export function Cable() {
  const { points, r, bend, shell } = SC.cable;
  const pts = SCANNER_CABLE.points;
  const n = pts.length;
  const startDir: V3 = [pts[1]![0] - pts[0]![0], pts[1]![1] - pts[0]![1], pts[1]![2] - pts[0]![2]];
  const endDir: V3 = [pts[n - 1]![0] - pts[n - 2]![0], pts[n - 1]![1] - pts[n - 2]![1], pts[n - 1]![2] - pts[n - 2]![2]];
  return (
    <Group id="cable">
      {CABLE_PIECES.map((p, i) => (
        <Tube key={i} id={`piece${i}`} live material="steel" blend={{ material: 'pkAudio' }} path={points} radius={r} bend={bend} sides={16} range={p.range} />
      ))}
      <Lathe id="shell0" material="steel" profile={turned([[0, r * 1.6], [shell, r * 1.6]])} steps={16} {...frameAlong(pts[0]!, startDir)} />
      <Lathe id="shell1" material="steel" profile={turned([[-shell, r * 1.6], [0, r * 1.6]])} steps={16} {...frameAlong(pts[n - 1]!, endDir)} />
    </Group>
  );
}
