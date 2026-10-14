import { type ReactNode, type RefObject, useEffect, useMemo } from 'react';
import type { TgpuRoot } from 'typegpu';
import { type SceneStore, type ViewPreset, createSceneStore } from '@anatomy/engine';
import { Stage } from '../Stage.tsx';
import type { ShellControls } from '../shell/createShell.ts';
import { SceneContext } from './context.ts';

/** Owns a SceneStore and the canvas that renders it; blocks below register into the store. */
export function Scene({
  root,
  views,
  controls,
  storeRef,
  children,
}: {
  root: TgpuRoot;
  views: readonly ViewPreset[];
  controls: ShellControls;
  /** Exposes the store (dev hooks). */
  storeRef?: RefObject<SceneStore | null>;
  children?: ReactNode;
}) {
  const store = useMemo(() => createSceneStore(), []);
  useEffect(() => {
    if (!storeRef) return undefined;
    storeRef.current = store;
    return () => {
      if (storeRef.current === store) storeRef.current = null;
    };
  }, [store, storeRef]);
  const value = useMemo(() => ({ store, path: null, contacts: true }), [store]);

  return (
    <SceneContext.Provider value={value}>
      <Stage root={root} store={store} views={views} controls={controls} />
      {children}
    </SceneContext.Provider>
  );
}
