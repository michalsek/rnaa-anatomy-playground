import type { ComponentType } from 'react';
import type { ViewPreset } from '@anatomy/engine';
import { Gallery } from './gallery/Gallery.tsx';
import { M1Row } from './gallery/M1Row.tsx';
import { GALLERY_VIEWS, M1_VIEWS } from './gallery/views.ts';
import { CentrifugeScene, ConveyorScene, CrusherScene, LineScene, OutputScene, ScannerScene } from './factory/Scenes.tsx';
import { centrifugeLive, conveyorLive, crusherLive, lineLive, outputLive, scannerLive } from './factory/live.ts';
import { CONVEYOR_CARD, CONVEYOR_VIEWS, LINE_CARD, LINE_VIEWS, OUTPUT_CARD, OUTPUT_VIEWS } from './factory/views.ts';
import { CENTRIFUGE_CARD, CENTRIFUGE_VIEWS } from './machines/centrifuge/views.ts';
import { CRUSHER_CARD, CRUSHER_VIEWS } from './machines/crusher/views.ts';
import { SCANNER_CARD, SCANNER_VIEWS } from './machines/scanner/views.ts';
import type { ReadoutSource } from './overlay/readout.ts';

export interface CardText {
  fig: string;
  title: string;
  hint: string;
  /** A fixed line, or a live source (only the readout leaf subscribes to it). */
  readout: string | ReadoutSource;
  /** Accessible label of the figure. */
  label: string;
}

export interface SceneEntry {
  name: string;
  views: readonly ViewPreset[];
  Content: ComponentType;
  card: CardText;
  /** Dev-only hook object, exposed as `__v4.sim`. */
  dev?: object;
}

const M1Only = () => <M1Row />;

export const SCENES: SceneEntry[] = [
  {
    name: 'line',
    views: LINE_VIEWS,
    Content: LineScene,
    card: { ...LINE_CARD, readout: lineLive.readout },
    dev: lineLive.dev,
  },
  {
    name: 'centrifuge',
    views: CENTRIFUGE_VIEWS,
    Content: CentrifugeScene,
    card: { ...CENTRIFUGE_CARD, readout: centrifugeLive.readout },
    dev: centrifugeLive.dev,
  },
  {
    name: 'crusher',
    views: CRUSHER_VIEWS,
    Content: CrusherScene,
    card: { ...CRUSHER_CARD, readout: crusherLive.readout },
    dev: crusherLive.dev,
  },
  {
    name: 'scanner',
    views: SCANNER_VIEWS,
    Content: ScannerScene,
    card: { ...SCANNER_CARD, readout: scannerLive.readout },
    dev: scannerLive.dev,
  },
  {
    name: 'output',
    views: OUTPUT_VIEWS,
    Content: OutputScene,
    card: { ...OUTPUT_CARD, readout: outputLive.readout },
    dev: outputLive.dev,
  },
  {
    name: 'conveyor',
    views: CONVEYOR_VIEWS,
    Content: ConveyorScene,
    card: { ...CONVEYOR_CARD, readout: conveyorLive.readout },
    dev: conveyorLive.dev,
  },
  {
    name: 'gallery',
    views: GALLERY_VIEWS,
    Content: Gallery,
    card: { fig: 'Gallery', title: 'Building blocks', hint: 'one of each block', readout: 'M2 gallery', label: 'Every building block once, in rows.' },
  },
  {
    name: 'm1',
    views: M1_VIEWS,
    Content: M1Only,
    card: { fig: 'Spike', title: 'Lines', hint: 'box · tach · rotor · tube', readout: 'M1 line spike', label: 'The M1 line spike: a box, a tach, a rotor and a tube.' },
  },
];
