/** Film mode's frame hook (M12, `filmCtl.ts`): advances the film's timeline on the scene's dt. */
import { useFrame } from '../blocks/blocks.tsx';
import { filmCtl } from './filmCtl.ts';

export function FilmDriver() {
  useFrame((info) => filmCtl.frame(info.dt));
  return null;
}
