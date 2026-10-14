import { describe, expect, it } from 'vitest';
import { edgeCoverage, tickCoverage, wire } from '../src/shading/lines.ts';

// Widths in device px: 0.6 CSS px at DPR 1, 2, 3, and a zoomed 2.4.
const WIDTHS = [0.6, 1.2, 1.8, 2.4];
const OFFSETS = [0, 0.13, 0.37, 0.5, 0.81];
/** Pixel centres around a line. */
const PIXELS = Array.from({ length: 13 }, (_, i) => i - 6);
/** Fraction of a pixel's samples on the face side of an edge `dist` px away. */
const share = (dist: number) => Math.min(1, Math.max(0, dist + 0.5));

describe("'use gpu' line coverage on the CPU", () => {
  it('a tick line puts exactly its width of ink down at any sub-pixel offset', () => {
    for (const w of WIDTHS) {
      const [drawn, alpha] = [...wire(w)] as [number, number];
      for (const o of OFFSETS) {
        const ink = PIXELS.reduce((sum, p) => sum + tickCoverage(p - o, drawn, alpha), 0);
        expect(ink).toBeCloseTo(w, 5);
      }
    }
  });

  it('the two halves of a crease resolve to one full line', () => {
    for (const w of WIDTHS) {
      const [drawn, alpha] = [...wire(w)] as [number, number];
      for (const o of OFFSETS) {
        // Each face covers the samples on its side; MSAA resolve weights by that share.
        const ink = PIXELS.reduce((sum, p) => {
          const a = p - o; // distance into face A
          const b = -a; // distance into face B
          return (
            sum +
            share(a) * (a > -0.5 ? edgeCoverage(a, drawn / 2, alpha) : 0) +
            share(b) * (b > -0.5 ? edgeCoverage(b, drawn / 2, alpha) : 0)
          );
        }, 0);
        expect(ink).toBeCloseTo(w, 2);
      }
    }
  });
});
