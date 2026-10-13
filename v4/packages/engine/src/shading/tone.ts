/**
 * Anatomy four-tone shading as a lookup, not lighting.
 *
 * The kit (`lathe.mjs#toneOf`) scores a surface normal against a camera-fixed light and buckets
 * the score with thresholds [0, 0.2, 0.42, 0.62]: below 0 is shade 0 (darkest, facing away),
 * then shades 1, 2, 3, and from 0.62 up the top tone. These functions run per pixel on the GPU
 * (so smooth normals band a cylinder) and on the CPU in unit tests.
 */
import { d, std } from 'typegpu';
import { SLOT } from '../palette/tokens.ts';

/** Score thresholds, from `lathe.mjs` (`BANDS`). */
export const BANDS = [0, 0.2, 0.42, 0.62] as const;
/** Tone index of the top tone; 0..3 are shades s0..s3. */
export const TONE_TOP = 4;

/** Facing class 0..4 of a normal against a unit light direction. */
export const toneOf = (normal: d.v3f, light: d.v3f) => {
  'use gpu';
  const score = std.dot(std.normalize(normal), light);
  const count =
    std.step(BANDS[0], score) +
    std.step(BANDS[1], score) +
    std.step(BANDS[2], score) +
    std.step(BANDS[3], score);
  return d.u32(count);
};

/** Palette slot for a tone: shades map to s0..s3, the top class to `top`. */
export const toneSlot = (tone: number) => {
  'use gpu';
  return std.select(d.u32(SLOT.s0) + d.u32(tone), d.u32(SLOT.top), d.u32(tone) >= TONE_TOP);
};
