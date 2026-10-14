import type { ComponentType } from 'react';
import type { ViewPreset } from '@anatomy/engine';
import { M1_VIEWS, M1Row } from './gallery/M1Row.tsx';

export interface SceneEntry {
  name: string;
  views: readonly ViewPreset[];
  Content: ComponentType;
}

export const SCENES: SceneEntry[] = [{ name: 'm1', views: M1_VIEWS, Content: () => <M1Row /> }];
