/**
 * Line coverage for in-face lines: the fill shader knows each fragment's device-pixel distance
 * to its triangle's edges (barycentrics × screen altitudes) and mixes line tones with box-filter
 * coverage, so the ink of a line equals its width (v3 lesson) and the depth test ends lines
 * exactly where their faces end. These functions run per pixel and on the CPU in tests.
 */
import { d, std } from 'typegpu';
import { FLAG } from '../geo/topology.ts';

/** Bit `bit` of a flags word (std.extractBits has no CPU implementation for tests). */
export const flagBit = (flags: number, bit: number) => {
  'use gpu';
  return (d.u32(flags) >>> d.u32(bit)) & 1;
};

/** Edge modes, per triangle edge, decided per frame in the vertex stage. */
export const EDGE_NONE = 0;
export const EDGE_CREASE = 1;
export const EDGE_OUTLINE = 2;

/** Length of [lo, hi] ∩ [x − ½, x + ½]: box-filtered coverage of a 1-px pixel at x. */
export const overlap = (x: number, lo: number, hi: number) => {
  'use gpu';
  return std.clamp(std.min(hi, x + 0.5) - std.max(lo, x - 0.5), 0, 1);
};

/**
 * Phone-wire rule: a line thinner than one device pixel is drawn one pixel wide at reduced
 * alpha, so its ink stays proportional to its width. Returns (drawn width, alpha).
 */
export const wire = (w: number) => {
  'use gpu';
  const drawn = std.max(w, 1);
  return d.vec2f(drawn, w / drawn);
};

/**
 * Coverage of a line lying inside a face along one of its edges, `extent` px deep, for a
 * pixel centred `dist` px from the edge. MSAA writes only the samples this face covers
 * (about dist + ½ of the pixel near the edge), so the colour is boosted by that share to keep
 * the resolved ink equal to the line's coverage.
 */
export const edgeCoverage = (dist: number, extent: number, alpha: number) => {
  'use gpu';
  const share = std.clamp(dist + 0.5, 0.125, 1);
  return std.min(1, (alpha * overlap(dist, d.f32(0), extent)) / share);
};

/** Coverage of a line centred on a UV-space line, `dist` px away, `drawn` px wide. */
export const tickCoverage = (dist: number, drawn: number, alpha: number) => {
  'use gpu';
  return alpha * overlap(dist, -drawn / 2, drawn / 2);
};

/**
 * Mode of edge `i` of a triangle: outline where it borders a back face or nothing, crease
 * where flagged, else none. Facing = face normal · direction toward the viewer; back faces
 * draw nothing (they are culled anyway).
 */
export const edgeMode = (ownFacing: number, adjFacing: number, flags: number, i: number) => {
  'use gpu';
  let mode = d.u32(EDGE_NONE);
  if (ownFacing > 0) {
    if (flagBit(flags, d.u32(FLAG.boundaryBit) + d.u32(i)) === 1 || adjFacing <= 0) {
      mode = d.u32(EDGE_OUTLINE);
    } else if (flagBit(flags, d.u32(FLAG.creaseBit) + d.u32(i)) === 1) {
      mode = d.u32(EDGE_CREASE);
    }
  }
  return mode;
};
