/**
 * The rotor (v2 L255–352): carousel, ten vanes, hub collar and column, the strobe disc, the shaft
 * and its pulley. One moving group about the bowl's axis (M4 spins it); vanes are static parts of
 * it, since they never move relative to the rotor.
 */
import { type LineSetSpec, type ProfilePoint, boltCircle } from '@anatomy/engine';
import { Extrude, Group, Lathe, Marks } from '../../blocks/blocks.tsx';
import { A0, ALPHA, POCKETS, R, Z, disc, pulley, radial, spokes } from './dims.ts';

/** Strobe disc: a hi rim, rings at r 9.8 and 2.8, and ten half-pocket sectors between them. */
const STROBE: ProfilePoint[] = [
  [0, Z.hub],
  [R.strobe, Z.hub],
  [R.strobe, Z.strobe],
  [R.strobe - 0.7, Z.strobe],
  [R.strobe - 1, Z.strobe], // segment 4: sectors, r 9.5 → 3.1
  [3.1, Z.strobe],
  [2.8, Z.strobe],
  [0, Z.strobe],
];
/** Sector k starts at A0 + 36k; A0 / 36 is a whole number, so the phase is 0. */
const SECTORS: LineSetSpec = {
  count: POCKETS, phase: 0, first: 0, last: POCKETS - 1, majorEvery: 0, minor: 'lo', major: 'lo',
  width: 0, majorWidth: 0, fade: [0, 0], kind: 'sectors', duty: 0.5, fill: 'strobe',
};

export function Rotor() {
  return (
    <Group id="rotor" moves>
      <Lathe id="carousel" material="steel" profile={disc(R.carousel, Z.carousel[0], Z.carousel[1])} seams={[Z.carousel[0] + 1.25]} />
      {Array.from({ length: POCKETS }, (_, i) => (
        <Extrude
          key={i}
          id={`vane${i}`}
          material="steel"
          plan={radial(R.vaneIn, R.vaneOut, 0.6)}
          z={Z.pocket}
          height={Z.vane}
          rotation={[0, 0, A0 + ALPHA * i]}
        />
      ))}
      <Lathe id="hub-collar" material="steel" outline="hi" profile={disc(R.hubCollar, Z.pocket, Z.pocket + 4)} />
      <Marks id="hub-collar-dots" material="steel" dots={boltCircle({ center: [0, 0, Z.pocket + 4], r: 9.8, count: 10, size: 0.36 })} />
      <Lathe id="hub-column" material="steel" outline="hi" profile={disc(R.hubColumn, Z.pocket + 4, Z.hub)} seams={[Z.pocket + 8]} />
      <Lathe
        id="strobe"
        material="steel"
        outline="hi"
        crease="lo"
        profile={STROBE}
        marks={[3, 6]}
        lineSets={[{ segment: 4, lines: SECTORS }]}
      />
      <Lathe id="shaft" material="steel" profile={disc(R.shaft, Z.strobe, Z.spider[0])} steps={24} seams={[149]} />
      <Lathe id="shaft-neck" material="steel" profile={disc(2, Z.bearing[1], Z.pulley[0])} steps={24} />
      <Lathe
        id="shaft-pulley"
        material="steel"
        outline="hi"
        crease="lo"
        profile={pulley(5.5, 5, 1.8)}
        marks={[5, 6]}
        lineSets={[{ segment: 5, lines: spokes(A0) }]}
      />
    </Group>
  );
}
