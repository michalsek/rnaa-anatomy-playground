/** Materials of the packet kinds, in `PACKET_KINDS` order (`packetStyle(kind)` indexes them). Plain module. */
import { type Material, PACKET_KINDS } from '@anatomy/engine';

export const PACKET_MATERIAL: Record<(typeof PACKET_KINDS)[number], Material> = {
  control: 'pkControl',
  graph: 'pkGraph',
  data: 'pkData',
  audio: 'pkAudio',
  garbage: 'pkGarbage',
};

/** One style per packet kind (hi outline), for any pool posed by kind. */
export const PACKET_STYLES = PACKET_KINDS.map((k) => ({ material: PACKET_MATERIAL[k], outline: 'hi' as const }));
