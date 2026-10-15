/**
 * Anatomy four-tone shading as a lookup, not lighting.
 *
 * The kit (`lathe.mjs#toneOf`) scores a surface normal against a camera-fixed light and buckets
 * the score with thresholds [0, 0.2, 0.42, 0.62]: below 0 is shade 0 (darkest, facing away),
 * then shades 1, 2, 3, and from 0.62 up the top tone. These functions run per pixel on the GPU
 * (so smooth normals band a cylinder) and on the CPU in unit tests.
 */
import { d, std } from 'typegpu';

/** Score thresholds, from `lathe.mjs` (`BANDS`). */
export const BANDS = [0, 0.2, 0.42, 0.62] as const;
/**
 * Anti-aliased band weights: `w_k` is how far the score is past threshold k, measured in
 * screen pixels (`fw` = fwidth of the score), so band edges get a one-pixel ramp. Blend:
 * s0 → s1 (w.x) → s2 (w.y) → s3 (w.z) → top (w.w). With fw → 0 the count of weights at 1 is
 * the kit's band (0..3 shades, 4 the top tone).
 */
export const bandWeights = (score: number, fw: number) => {
  'use gpu';
  const inv = 1 / std.max(fw, 1e-6);
  return std.clamp(
    d.vec4f(
      (score - BANDS[0]) * inv + 0.5,
      (score - BANDS[1]) * inv + 0.5,
      (score - BANDS[2]) * inv + 0.5,
      (score - BANDS[3]) * inv + 0.5,
    ),
    d.vec4f(0),
    d.vec4f(1),
  );
};

/**
 * The kit's plan rule (`iso-kit.mjs#extrude`), for upright prisms: tops and bottoms by the
 * normal's z (the fill shader picks `top` above n.z 0.5), sides by the plan angle against the
 * light's plan direction, `lit = (n̂.xy · l̂.xy + 1) / 2`, binned into 4 equal shades by
 * `planWeights`. This is the side score in 0..1.
 */
export const planLit = (n: d.v3f, light: d.v3f) => {
  'use gpu';
  const h = n.xy;
  const l = light.xy;
  const hn = std.div(h, std.max(std.length(h), 1e-6));
  const ln = std.div(l, std.max(std.length(l), 1e-6));
  return (std.dot(hn, ln) + 1) * 0.5;
};

/** AA weights of the plan bins (edges at ¼, ½, ¾): s0 → s1 (x) → s2 (y) → s3 (z). */
export const planWeights = (lit: number, fw: number) => {
  'use gpu';
  const inv = 1 / std.max(fw, 1e-6);
  return std.clamp(
    d.vec3f((lit - 0.25) * inv + 0.5, (lit - 0.5) * inv + 0.5, (lit - 0.75) * inv + 0.5),
    d.vec3f(0),
    d.vec3f(1),
  );
};

/** Screen-space light of the kit's tube rule (`tube.mjs`), y down. */
export const TUBE_LIGHT = [-0.55 / Math.hypot(0.55, 0.835), -0.835 / Math.hypot(0.55, 0.835)] as const;

/**
 * The kit's tube stripes: across a tube, s runs from −1 to 1 (the normal's screen component
 * across the tube) and tw is how much that direction faces the light. Shine (`top`) centred at
 * .44·tw, half-width .24; shade (`s0`) centred at −.62·tw, half-width .2; the body is `s2`.
 * Returns AA'd weights (shine, shade); fw = fwidth(s).
 */
export const tubeStripes = (s: number, tw: number, fw: number) => {
  'use gpu';
  const inv = 1 / std.max(fw, 1e-6);
  const shine = std.clamp((0.24 - std.abs(s - 0.44 * tw)) * inv + 0.5, 0, 1);
  const shade = std.clamp((0.2 - std.abs(s + 0.62 * tw)) * inv + 0.5, 0, 1);
  return d.vec2f(shine, shade);
};
