import { createContext, useContext } from 'react';
import type { SceneStore } from '@anatomy/engine';

export interface SceneContextValue {
  store: SceneStore;
  /** Full id of the enclosing group (null at the scene root). */
  path: string | null;
  /** Default for parts below that don't say: draw contact lines (`<Group contacts={false}>`). */
  contacts: boolean;
}

export const SceneContext = createContext<SceneContextValue | null>(null);

export function useScene(): SceneContextValue {
  const value = useContext(SceneContext);
  if (!value) throw new Error('scene blocks must be rendered inside <Scene>');
  return value;
}

/** Ids below a group resolve relative to it: `rotor` inside `centrifuge` is `centrifuge.rotor`. */
export const joinId = (path: string | null, id: string) => (path ? `${path}.${id}` : id);
