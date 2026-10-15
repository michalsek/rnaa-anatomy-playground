/**
 * The one pose API from a sim to its item pools: every machine's sim has `poses(cb)` (an item's
 * pose and grey blend in the machine's frame, `PoseFn`), and `useItemPoses` returns a writer that
 * copies them into the machine's pools (below the current group): packets into the packet pool,
 * fluff beads into the bead pool. Call the writer from the machine's frame hook after
 * `live.step(f)`. It writes every per-instance field (pose, style, blend) every frame, as pool
 * slots are reused.
 *
 * An item beyond its pool's capacity (or of a kind with no pool here) is skipped, with one DEV
 * warning per pool: the store would throw on it, and a sim that outgrows a pool (a sender that
 * doesn't ask) should cost a missing item, not the frame. Plain module (hooks, no components).
 */
import { type PoolHandle, type PoseFn, type PoseSource, packetStyle } from '@anatomy/engine';
import { useState } from 'react';
import { useNode } from '../blocks/blocks.tsx';

declare const __DEV__: boolean;

const GARBAGE = packetStyle('garbage');

export interface ItemPools {
  /** The packet pool's id (default `packets`; null: none). */
  packets?: string | null;
  /** The bead pool's id (default none). */
  beads?: string | null;
}

export function useItemPoses(sim: () => PoseSource, pools: ItemPools = {}): () => void {
  const packetsId = pools.packets === undefined ? 'packets' : pools.packets;
  const beadsId = pools.beads ?? null;
  const packets = useNode<PoolHandle>(packetsId ?? 'packets');
  const beads = useNode<PoolHandle>(beadsId ?? 'beads');
  // One callback per mount: no closure per frame.
  const [w] = useState(() => {
    let pk: PoolHandle | null = null;
    let bd: PoolHandle | null = null;
    let np = 0;
    let nb = 0;
    const warned = new Set<string>();
    const over = (what: string) => {
      if (__DEV__ && !warned.has(what)) {
        warned.add(what);
        console.warn(`[poses] ${what}: more items than the pool holds (or no pool for them); skipped`);
      }
    };
    const pose: PoseFn = (_i, item, x, y, z, yaw, pitch, roll, spend) => {
      if (item.kind === 'fluff') {
        if (!bd || nb >= bd.capacity) return over(bd?.id ?? 'beads');
        bd.pose(nb++, x, y, z, yaw, pitch, roll);
        return;
      }
      if (!pk || np >= pk.capacity) return over(pk?.id ?? 'packets');
      const i = np++;
      pk.pose(i, x, y, z, yaw, pitch, roll);
      pk.style(i, packetStyle(item.kind));
      pk.blend(i, GARBAGE, spend);
    };
    return {
      write(src: PoseSource, p: PoolHandle | null, b: PoolHandle | null) {
        pk = p;
        bd = b;
        np = 0;
        nb = 0;
        src.poses(pose);
        if (p) p.count = np;
        if (b) b.count = nb;
      },
    };
  });
  return () => w.write(sim(), packetsId ? packets() : null, beadsId ? beads() : null);
}

/** The packet pool `nodeId` only (every machine but the bead-carrying ones). */
export function usePacketPoses(nodeId: string, sim: () => PoseSource): () => void {
  return useItemPoses(sim, { packets: nodeId });
}
