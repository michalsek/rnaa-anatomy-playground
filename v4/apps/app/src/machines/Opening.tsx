/**
 * An opening in a face (no polygon holes: a thin inset on the face, shaded by the void gradient,
 * with a lo outline): v2's dark-filled slots, mouths and feed holes. A packet that goes in passes
 * through the face and is hidden behind it by depth.
 */
import { Box } from '../blocks/blocks.tsx';
import type { V3 } from './kit.ts';

/**
 * `lo`/`hi`: the inset's corners (0.05 thick along the face's normal); the gradient runs from
 * `from` (lightest: the far side, seen through the opening) to `to` (darkest, under the near edge).
 */
export function Opening({ id, lo, hi, from, to }: { id: string; lo: V3; hi: V3; from: V3; to: V3 }) {
  return (
    <Box
      id={id}
      material="steel"
      outline="lo"
      tone="gradient"
      gradient={{ from, to, stops: ['void0', 'void1', 'void2'], mid: 0.55 }}
      size={[hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]]}
      center={[(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]}
      r={Math.min(0.4, (hi[0] - lo[0]) / 4, (hi[1] - lo[1]) / 4)}
    />
  );
}

/** An opening in a top face at z (plan x0..x1, y0..y1): far (−x −y) light, near (+x +y) dark. */
export function TopOpening({ id, x0, x1, y0, y1, z }: { id: string; x0: number; x1: number; y0: number; y1: number; z: number }) {
  return <Opening id={id} lo={[x0, y0, z - 0.05]} hi={[x1, y1, z + 0.02]} from={[x0, y0, z]} to={[x1, y1, z]} />;
}
