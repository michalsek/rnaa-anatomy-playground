// Root lifetime across Fast Refresh. A refresh re-runs every effect: the root's cleanup
// destroys it, and in the same commit the stage's effect runs again with the old root still in
// its props. Marking retired roots lets the stage skip them instead of building a shell on a
// destroyed device (which can stall the browser's GPU process).
import type { TgpuRoot } from 'typegpu';

const retired = new WeakSet<TgpuRoot>();

export function retireRoot(root: TgpuRoot) {
  retired.add(root);
  root.destroy();
}

export const isRetired = (root: TgpuRoot) => retired.has(root);
