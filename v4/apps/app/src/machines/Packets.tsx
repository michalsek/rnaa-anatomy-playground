/**
 * The packet pool every machine uses: a taped parcel (v2 runtime `packetSvg`, 10 × 8 × 7, long
 * axis on x), the band 0.55 up its sides, a strap over the top and (for hanging parcels, upside
 * down) the bottom. One style per packet kind, in `PACKET_KINDS` order (`packetStyle(kind)`).
 */
import { PACKET_KINDS, PACKET_SIZE, type Material } from '@anatomy/engine';
import { Instances } from '../blocks/blocks.tsx';

const H = PACKET_SIZE.h;
const MATERIAL: Record<(typeof PACKET_KINDS)[number], Material> = {
  control: 'pkControl',
  graph: 'pkGraph',
  data: 'pkData',
  audio: 'pkAudio',
  garbage: 'pkGarbage',
};

export function PacketPool({ id = 'packets', capacity }: { id?: string; capacity: number }) {
  return (
    <Instances
      id={id}
      geo={{ kind: 'box', size: [PACKET_SIZE.w, PACKET_SIZE.d, H], r: 0.6, center: [0, 0, H / 2], seams: [H * 0.55] }}
      styles={PACKET_KINDS.map((k) => ({ material: MATERIAL[k], outline: 'hi' as const }))}
      capacity={capacity}
      marks={{
        material: 'pkControl',
        segments: [
          { a: [-PACKET_SIZE.w / 2, 0, H], b: [PACKET_SIZE.w / 2, 0, H], tone: 'lo', normal: [0, 0, 1] },
          { a: [-PACKET_SIZE.w / 2, 0, 0], b: [PACKET_SIZE.w / 2, 0, 0], tone: 'lo', normal: [0, 0, -1] },
        ],
      }}
    />
  );
}
