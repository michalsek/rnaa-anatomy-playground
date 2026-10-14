/**
 * The elevator's tower and chain (v2 elevator.mjs L87–130, `access: false`): four posts on base
 * plates with anchor screws (`stand`), seam rings and splice plates at the splices; girts on all
 * four faces at every level; gussets with bolts at every girt joint on the two side faces; the
 * chain's guide channels on the front and back runs; the two chain strands, each one band round
 * both sprockets (E1: its pins are a line set that scrolls with the chain, live `uShift`).
 */
import type { ElevatorGeometry } from '@anatomy/engine';
import { Band, Box, Group, Marks } from '../../blocks/blocks.tsx';
import { type V3, corners, faceScrews, placeFrame, screws } from '../kit.ts';
import { CHAIN, EL, PH, PX, PY, chainTotal, pins, tower } from './dims.ts';

export function Tower({ g, stand }: { g: ElevatorGeometry; stand: boolean }) {
  const t = tower(g);
  const [PXL, PXR] = PX;
  const [PYB, PYF] = PY;
  const z0 = stand ? 1.5 : 0;
  return (
    <Group id="tower">
      {PX.flatMap((x) =>
        PY.map((y) => {
          const left = x < 0;
          const bx: [number, number] = left ? [-14, -8.4] : [8.4, 14];
          const sx = left ? bx[0] + 1.3 : bx[1] - 1.3;
          const tag = `${left ? 'L' : 'R'}${y < 0 ? 'B' : 'F'}`;
          return (
            <Group key={tag} id={`post${tag}`}>
              {stand && (
                <>
                  <Box id="base" material="steel" outline="lo" {...corners([bx[0], y - 3, 0], [bx[1], y + 3, 1.5])} r={0.4} />
                  <Marks id="anchors" material="steel" {...screws([[sx, y - 1.8], [sx, y + 1.8]], 1.5, 0.55, 0.32)} />
                </>
              )}
              <Box id="post" material="steel" {...corners([x - PH, y - PH, z0], [x + PH, y + PH, t.top])} r={0.3} seams={t.splices} />
            </Group>
          );
        }),
      )}
      {t.splices.map((z, i) => {
        const front = PX.map((x) => faceScrews('y', [[x, PYF + PH + 0.5, z - 2.6], [x, PYF + PH + 0.5, z + 2.6]], 0.45, 0.28));
        const side = faceScrews('x', [[PXR + PH + 0.5, PYB, z - 2.6], [PXR + PH + 0.5, PYB, z + 2.6]], 0.45, 0.28);
        return (
          <Group key={i} id={`splice${i}`}>
            {PX.map((x, k) => (
              <Box key={k} id={`front${k}`} material="steel" {...corners([x - PH, PYF + PH, z - 4], [x + PH, PYF + PH + 0.5, z + 4])} r={0.2} />
            ))}
            <Box id="side" material="steel" {...corners([PXR + PH, PYB - PH, z - 4], [PXR + PH + 0.5, PYB + PH, z + 4])} r={0.2} />
            <Marks id="bolts" material="steel" segments={[...front.flatMap((f) => f.segments), ...side.segments]} dots={[...front.flatMap((f) => f.dots), ...side.dots]} />
          </Group>
        );
      })}
      {t.levels.map((L, i) => {
        const yy: [number, number][] = [
          [PYB - PH, -4.8],
          [4.8, PYF + PH],
        ];
        const xo = PXR + PH;
        const bolts = yy.map(([y0, y1]) => {
          const ym = (y0 + y1) / 2;
          return faceScrews('x', ([[-1.6, -1.8], [1.6, -1.8], [-1.6, 1.8], [1.6, 1.8]] as const).map(([dy, dz]) => [xo + 0.6, ym + dy, L + dz] as V3), 0.42, 0.26);
        });
        return (
          <Group key={i} id={`level${i}`}>
            <Box id="girtF" material="steel" {...corners([PXL + PH, PYF - 0.8, L - 1], [PXR - PH, PYF + 0.8, L + 1])} r={0.3} />
            <Box id="girtB" material="steel" {...corners([PXL + PH, PYB - PH, L - 1], [PXR - PH, PYB - PH + 1.6, L + 1])} r={0.3} />
            <Box id="girtL" material="steel" {...corners([PXL - PH, PYB + PH, L - 1], [PXL - PH + 1.6, PYF - PH, L + 1])} r={0.3} />
            <Box id="girtR" material="steel" {...corners([PXR + PH - 1.6, PYB + PH, L - 1], [PXR + PH, PYF - PH, L + 1])} r={0.3} />
            {yy.map(([y0, y1], k) => (
              <Box key={`r${k}`} id={`gussetR${k}`} material="steel" {...corners([xo, y0, L - 3.4], [xo + 0.6, y1, L + 3.4])} r={0.2} />
            ))}
            {yy.map(([y0, y1], k) => (
              <Box key={`l${k}`} id={`gussetL${k}`} material="steel" {...corners([PXL - PH - 0.6, y0, L - 3.4], [PXL - PH, y1, L + 3.4])} r={0.2} />
            ))}
            <Marks id="bolts" material="steel" segments={bolts.flatMap((b) => b.segments)} dots={bolts.flatMap((b) => b.dots)} />
          </Group>
        );
      })}
      <Chain g={g} />
    </Group>
  );
}

/** Guide channels on both runs, and the two strands (bands round both sprockets). */
function Chain({ g }: { g: ElevatorGeometry }) {
  const yf = EL.yc + EL.r;
  const yb = EL.yc - EL.r;
  const lines = { outer: pins(chainTotal(g)) };
  return (
    <Group id="chain">
      {EL.strands.map((x, i) => (
        <Group key={i} id={`strand${i}`}>
          <Box id="channelF" material="steel" {...corners([x - 1.4, PY[1] + 0.8, EL.zBootTop], [x + 1.4, yf - 0.7, g.zh - 8])} r={0.3} />
          <Box id="channelB" material="steel" {...corners([x - 1.4, yb + 0.7, EL.zBootTop], [x + 1.4, PY[0] - PH, g.zh - 8])} r={0.3} />
          {/* The band's s runs up (model x → world z), its height out from the axes (model z → world y). */}
          <Band
            id="band"
            live
            material="graphite"
            outline="lo"
            axis="x"
            dir={1}
            L={g.Lf}
            R={CHAIN.R}
            thickness={CHAIN.depth}
            across={CHAIN.across}
            zc={0}
            lines={lines}
            {...placeFrame([x, EL.yc, EL.zb], [0, 1, 0], [0, 0, 1])}
          />
        </Group>
      ))}
    </Group>
  );
}
