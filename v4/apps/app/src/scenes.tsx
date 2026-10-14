import type { ComponentType } from 'react';
import type { ViewPreset } from '@anatomy/engine';
import { Gallery } from './gallery/Gallery.tsx';
import { M1Row } from './gallery/M1Row.tsx';
import { GALLERY_VIEWS, M1_VIEWS } from './gallery/views.ts';

export interface SceneEntry {
  name: string;
  views: readonly ViewPreset[];
  Content: ComponentType;
}

const M1Only = () => <M1Row />;

export const SCENES: SceneEntry[] = [
  { name: 'gallery', views: GALLERY_VIEWS, Content: Gallery },
  { name: 'm1', views: M1_VIEWS, Content: M1Only },
];
