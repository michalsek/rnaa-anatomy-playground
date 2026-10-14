/**
 * The page's stubs (v2 `build.mjs`): the end of belt B that feeds the centrifuge from above, and
 * the audio belt below the spout, with its slats. Siblings of the machine (`stubFeed.*`,
 * `stubBelt.*`); v2's absolute coordinates minus the origin [100, 66, 0].
 */
import { CF } from '@anatomy/engine';
import { Box, Extrude, Group, Instances, Lathe } from '../../blocks/blocks.tsx';
import { SPOUT, corners, disc } from './dims.ts';

/** The audio belt runs along −x under the spout's hand-over point (the sim moves its slats). */
const BELT = (() => {
  const { x0, x1, y } = CF.belt;
  if (x1 !== Math.round(SPOUT.hand[0] + 100 + 14) - 100) throw new Error('belt end out of step with the spout');
  return { x0, x1, y, y0: y - 8, y1: y + 8 };
})();

export function Feeder() {
  return (
    <Group id="stubFeed" contacts={false}>
      {[-7.5, 7.5].map((x, k) => (
        <Group key={k} id={`leg${k}`} position={[x, 0, 0]}>
          <Extrude id="foot" material="steel" outline="lo" plan={{ circle: 3.6, steps: 24 }} height={1.4} position={[0, -94, 0]} />
          <Box id="column" material="steel" {...corners([-1.5, -95.5, 1.4], [1.5, -92.5, 188])} r={0.4} />
        </Group>
      ))}
      <Box id="brace" material="steel" {...corners([-6, -95, 110], [6, -93, 113])} r={0.3} />
      <Box id="bed" material="steel" {...corners([-9, -100, 188], [9, -45, 191.4])} r={0.6} />
      <Box id="rail0" material="steel" {...corners([-9, -100, 191.4], [-7, -42.5, 194.6])} r={0.4} />
      <Box id="rail1" material="steel" {...corners([7, -100, 191.4], [9, -42.5, 194.6])} r={0.4} />
      <Lathe id="roller" material="steel" profile={disc(2.5, 0, 18)} position={[-9, -42.5, 188.9]} rotation={[0, 90, 0]} />
    </Group>
  );
}

export function AudioBelt() {
  const legs = [-66, -36, BELT.x1 - 8].flatMap((x) => [BELT.y0 + 1, BELT.y1 - 1].map((y) => [x, y] as const));
  return (
    <Group id="stubBelt" contacts={false}>
      {legs.map(([x, y], k) => (
        <Group key={k} id={`leg${k}`} position={[x, y, 0]}>
          <Extrude id="foot" material="steel" outline="lo" plan={{ circle: 2.6, steps: 20 }} height={1.2} />
          <Box id="leg" material="steel" {...corners([-1.2, -1.2, 1.2], [1.2, 1.2, 87])} r={0.3} />
        </Group>
      ))}
      <Box id="brace" material="steel" {...corners([-64.8, BELT.y0 - 0.2, 30], [-37.2, BELT.y0 + 1.8, 33])} r={0.3} />
      <Box id="bed" material="steel" {...corners([BELT.x0, BELT.y0, 87], [BELT.x1, BELT.y1, 91.4])} r={0.6} />
      <Box id="rail0" material="steel" {...corners([BELT.x0 + 3, BELT.y0 - 2.2, 87], [BELT.x1, BELT.y0, 94.4])} r={0.4} />
      <Box id="rail1" material="steel" {...corners([BELT.x0 + 3, BELT.y1, 87], [BELT.x1, BELT.y1 + 2.2, 94.4])} r={0.4} />
      <Lathe id="roller" material="steel" profile={disc(2.4, 0, 20.4)} position={[BELT.x0 - 2.4, BELT.y0 - 2.2, 89]} rotation={[-90, 0, 0]} />
      <Instances
        id="slats"
        geo={{ kind: 'box', size: [1.6, 15.2, 0.6], r: 0.3, center: [0, 0, 0.3] }}
        styles={[{ material: 'steel', outline: 'lo' }]}
        capacity={CF.belt.slats}
      />
    </Group>
  );
}
