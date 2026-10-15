/**
 * Crusher views and card text (v2 crusher page and its QA crops `qa/z-hopper`, `z-spring`,
 * `z-drive`, `z-ctl`, `z-bin`). Crops are machine-local boxes. Plain module.
 */
import type { ViewPreset } from '@anatomy/engine';

const at = (name: string, frame?: ViewPreset['frame']): ViewPreset => ({ name, yaw: 45, elevation: 30, zoom: 1, ...(frame && { frame }) });

export const CRUSHER_VIEWS: ViewPreset[] = [
  at('fit'),
  at('hopper', [[-19, -20, 22], [19, 20, 38]]),
  at('spring', [[15, 0, 17], [23, 23, 29]]),
  at('drive', [[20, -36, 0], [41, -2, 34]]),
  at('ctl', [[-38, -1, 16], [-26, 12, 37]]),
  at('bin', [[-13, 13, 0], [13, 60, 30]]),
];

export const CRUSHER_CARD = {
  fig: 'Part',
  title: 'Crusher',
  hint: 'a spent packet arrives every 2.4 s',
  /** The first sentence of the v2 caption. */
  label: 'The Disposer: spent buffers ride belt C to this crusher and are destroyed off the audio thread.',
} as const;
