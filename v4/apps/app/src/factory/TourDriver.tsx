/** The tour's frame hook (`tour.ts`): advances it on scene time; stops it when the scene goes. */
import { useEffect } from 'react';
import { useFrame } from '../blocks/blocks.tsx';
import { tourCtl } from './tour.ts';

export function TourDriver() {
  useEffect(() => () => tourCtl.stop(), []);
  useFrame((info) => tourCtl.advance(info.dt));
  return null;
}
