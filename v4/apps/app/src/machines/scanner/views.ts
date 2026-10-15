/**
 * Scanner scene views and card text (v2's scanner page; world boxes: the loop at [−120, 70], the
 * scanner at [−30, 32], belt D from its lip along −y). Plain module.
 */
import type { ViewPreset } from '@anatomy/engine';

const at = (name: string, frame?: ViewPreset['frame']): ViewPreset => ({ name, yaw: 45, elevation: 30, zoom: 1, ...(frame && { frame }) });

export const SCANNER_VIEWS: ViewPreset[] = [
  at('fit'),
  /** The arm over the loop's near margin (v2 `qa/sheet-seek`). */
  at('arm', [[-50, 22, 84], [2, 72, 106]]),
  /** The preamp's window, lip and the cable's end. */
  at('preamp', [[-118, 34, 0], [-90, 56, 34]]),
  /** The whole machine. */
  at('scanner', [[-118, 4, 0], [-4, 66, 106]]),
  /** The lip onto belt D. */
  at('D', [[-122, 0, 0], [-92, 45, 34]]),
];

export const SCANNER_CARD = {
  fig: 'Part',
  title: 'Read arm',
  hint: 'one read per cleat · 4 per packet',
  /** The first sentence of the v2 caption. */
  label: 'The platform audio callback reads each finished 128-frame render quantum, one cleat gap of the audio belt, and four quanta leave the preamp as one packet on belt D.',
} as const;
