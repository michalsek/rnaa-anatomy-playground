// The TypeGPU root (and its device) lives in module state, not in a component. Fast Refresh
// re-runs the effects of every edited component, App.tsx included; a root owned by an effect
// would be destroyed and recreated by such an edit (and every scene rebuilt cold on the new
// device). This module only re-evaluates on a full reload, which tears the runtime down anyway.
import type { TgpuRoot } from 'typegpu';
import { initGpu } from '@anatomy/engine';

let shared: Promise<TgpuRoot> | null = null;

/** The app's root, created on first use; a lost device makes the next call create a new one. */
export function acquireRoot(): Promise<TgpuRoot> {
  if (shared) return shared;
  const pending = initGpu();
  shared = pending;
  const forget = () => {
    if (shared === pending) shared = null;
  };
  pending.then((root) => void root.device.lost.then(forget), forget);
  return pending;
}
