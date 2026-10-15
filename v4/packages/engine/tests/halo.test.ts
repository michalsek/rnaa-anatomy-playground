import { describe, expect, it } from 'vitest';
import { haloCoverage } from '../src/render/shaders.ts';

/** Numerical recipes erfc (|error| < 1.2e-7). */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
        t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

describe('halo coverage', () => {
  it('is within 0.02 of ½·erfc(d / (σ√2)), 0.5 at the edge, and monotone', () => {
    for (const s of [1, 5, 20]) {
      expect(haloCoverage(0, s)).toBeCloseTo(0.5, 6);
      let prev = Infinity;
      for (let k = -40; k <= 40; k++) {
        const dist = (k / 10) * s;
        const got = haloCoverage(dist, s);
        expect(Math.abs(got - 0.5 * erfc(dist / (s * Math.SQRT2)))).toBeLessThan(0.02);
        expect(got).toBeLessThan(prev);
        prev = got;
      }
    }
  });
});
