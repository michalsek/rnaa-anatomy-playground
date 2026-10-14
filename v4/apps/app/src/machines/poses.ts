/**
 * The one pose API from a sim to a packet pool: every machine's sim has `poses(cb)` (an item's
 * pose and grey blend in the machine's frame, `PoseFn`), and `usePacketPoses` returns a writer
 * that copies them into the pool `nodeId` (below the current group). Call the writer from the
 * machine's frame hook after `live.step(f)`. It writes every per-instance field (pose, style,
 * blend) every frame, as pool slots are reused. Plain module (hooks, no components).
 */
import { type PoolHandle, type PoseFn, type PoseSource, packetStyle } from '@anatomy/engine';
import { useState } from 'react';
import { useNode } from '../blocks/blocks.tsx';

const GARBAGE = packetStyle('garbage');

export function usePacketPoses(nodeId: string, sim: () => PoseSource): () => void {
  const pool = useNode<PoolHandle>(nodeId);
  // One callback per mount: no closure per frame.
  const [w] = useState(() => {
    let pk: PoolHandle | null = null;
    const pose: PoseFn = (i, item, x, y, z, yaw, pitch, roll, spend) => {
      pk!.pose(i, x, y, z, yaw, pitch, roll);
      pk!.style(i, packetStyle(item.kind));
      pk!.blend(i, GARBAGE, spend);
    };
    return {
      write(src: PoseSource, p: PoolHandle) {
        pk = p;
        p.count = src.poses(pose);
      },
    };
  });
  return () => w.write(sim(), pool());
}
