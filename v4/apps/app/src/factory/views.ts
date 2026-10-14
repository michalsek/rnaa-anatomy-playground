/**
 * Views and card text of the line scene and v2's conveyor page scene (world boxes to frame, named
 * like v2's `assembly/shots/z-*` and the conveyor QA crops). Plain module (no components).
 */
import type { ViewPreset } from '@anatomy/engine';

const at = (name: string, frame: ViewPreset['frame']): ViewPreset => ({ name, yaw: 45, elevation: 30, zoom: 1, ...(frame && { frame }) });

export const LINE_VIEWS: ViewPreset[] = [
  at('fit', undefined),
  /** v2 `z-centrifuge-audio`: the centrifuge over the audio belt. */
  at('centrifuge-audio', [[40, 20, 40], [140, 150, 205]]),
  at('funnel', [[85, 5, 168], [115, 60, 208]]),
  at('release', [[76, 100, 88], [118, 138, 128]]),
  at('read', [[12, 108, 42], [48, 132, 82]]),
  at('head', [[-118, 98, 25], [-62, 142, 112]]),
  /** v2 `z-audio-C`: the loop's head drum over belt C, where garbage drops. */
  at('audio-C', [[-125, 92, 0], [-55, 160, 112]]),
  /** v2 `z-C-crusher`: belt C's end and the crusher. */
  at('C-crusher', [[-130, 180, 0], [-50, 300, 45]]),
];

export const LINE_CARD = {
  fig: 'Line',
  title: 'Centrifuge → render loop → disposer',
  hint: 'packets → rings → one per quantum → render loop → crusher',
  label: 'Packets ride belt B into the centrifuge, which drains them one per render quantum onto the audio belt; spent ones ride belt C to the crusher.',
} as const;

export const CONVEYOR_VIEWS: ViewPreset[] = [
  at('fit', undefined),
  at('beltB', [[50, -60, 80], [100, 75, 160]]),
  at('tail', [[60, 50, 30], [112, 100, 112]]),
  at('hanging', [[-60, 50, 30], [20, 100, 100]]),
  at('head', [[-158, 50, 25], [-100, 100, 112]]),
  at('beltC', [[-150, 40, 0], [-110, 170, 50]]),
];

export const CONVEYOR_CARD = {
  fig: 'Part',
  title: 'Conveyors',
  hint: 'belt → audio belt → belt',
  label: 'Two conveyor variants: a single-sided belt and the audio belt, the render loop.',
} as const;
