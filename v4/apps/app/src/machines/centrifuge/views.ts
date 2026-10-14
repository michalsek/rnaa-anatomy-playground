/**
 * Centrifuge views and card text. Crops are machine-local boxes matching the v2 QA crops
 * (`qa/z-rotor`, `z-instr`, `z-drive`, `z-funnel`); `lines` caps the line scale there, since a
 * crop of the whole page would otherwise ink lines many times their fit width.
 */
import type { ViewPreset } from '@anatomy/engine';

export const CENTRIFUGE_VIEWS: ViewPreset[] = [
  { name: 'fit', yaw: 45, elevation: 30, zoom: 1 },
  { name: 'rotor', yaw: 45, elevation: 30, zoom: 1, frame: [[-34, -34, 120], [34, 34, 150]], lines: 2 },
  { name: 'instr', yaw: 45, elevation: 30, zoom: 1, frame: [[6, 20, 108], [30, 42, 122]], lines: 2 },
  { name: 'drive', yaw: 45, elevation: 30, zoom: 1, frame: [[-8, -12, 162], [56, 14, 184]], lines: 2 },
  { name: 'funnel', yaw: 45, elevation: 30, zoom: 1, frame: [[-13, -36, 164], [13, -10, 187]], lines: 2 },
];

/** The overlay card (v2 `build.mjs` page options; the readout is the shot's "in sync" moment). */
export const CENTRIFUGE_CARD = {
  fig: 'Part',
  title: 'Centrifuge',
  hint: 'fills · spins up · drains one per quantum',
  readout: 'held 5/10 · 14.1 rpm · in sync',
  /** The first sentence of the v2 caption. */
  label: 'The lock-free ring between JS and the audio thread.',
} as const;
