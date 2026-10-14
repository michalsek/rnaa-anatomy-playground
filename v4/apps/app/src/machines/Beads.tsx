/**
 * The bead pool: loose fluff (v2 runtime `fluffSvg`, a React-blue sphere, radius 2.4), posed by its
 * bottom centre like every item.
 */
import { PK, type ProfilePoint, sphereProfile } from '@anatomy/engine';
import { Instances } from '../blocks/blocks.tsx';

const R = PK.bead;
/** A sphere resting on z = 0. */
const PROFILE: ProfilePoint[] = sphereProfile(R, 12).map(([r, z, s]) => [r, z + R, s] as ProfilePoint);

export function BeadPool({ id = 'beads', capacity }: { id?: string; capacity: number }) {
  return <Instances id={id} geo={{ kind: 'lathe', profile: PROFILE, steps: 24 }} styles={[{ material: 'fluff' }]} capacity={capacity} />;
}
