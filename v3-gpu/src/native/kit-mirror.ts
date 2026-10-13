// The anatomy kit's projection, rounded plan and prism shading (kit/iso-kit.mjs: cameraOf, iso, roundedPlan, extrude,
// ringSeam), restated operation for operation in f64. The classification computed here — which side faces of an
// extruded ring are drawn, the tone of each, which edges the seam runs along — is therefore bit-identical to what the
// kit decides for the same ring when it writes the SVG. tools/test-native.mjs checks it against the kit itself.

/** Tones of the side faces (kit SHADES): `.iso-shade[data-shade="0…3"]`. */
export const SHADES = 4;
const RADIANS = Math.PI / 180;
const UNIT = Math.sqrt(1.6);
/** kit extrude / ringSeam: a side faces the viewer when its normal · the view direction exceeds this. */
const FACING_EPSILON = 1e-9;

/** The kit's projection record (`P` of a scene). */
export interface Projection {
  origin: [number, number] | number[];
  scale: number;
  azimuth?: number;
  elevation?: number;
}

export interface Camera {
  sinA: number;
  cosA: number;
  sinE: number;
  cosE: number;
  k: number;
}

export function cameraOf({ scale, azimuth = 45, elevation = 30 }: Projection): Camera {
  const a = azimuth * RADIANS;
  const e = elevation * RADIANS;
  return { sinA: Math.sin(a), cosA: Math.cos(a), sinE: Math.sin(e), cosE: Math.cos(e), k: scale * UNIT };
}

/** kit iso(): world point → viewBox x. */
export const isoX = (x: number, y: number, origin: ArrayLike<number>, c: Camera) => origin[0] + (x * c.sinA - y * c.cosA) * c.k;
/** kit iso(): world point → viewBox y. */
export const isoY = (x: number, y: number, z: number, origin: ArrayLike<number>, c: Camera) => origin[1] + ((x * c.cosA + y * c.sinA) * c.sinE - z * c.cosE) * c.k;

/** kit roundedPlan(): the ring of a rounded rectangle, `steps` segments per corner arc. */
export function roundedPlan({ x, y, w, d, r }: { x: number; y: number; w: number; d: number; r: number }, steps = 8): [number, number][] {
  const radius = Math.max(0, Math.min(r, w / 2, d / 2));
  const corners = [
    [x + w - radius, y + radius, -90],
    [x + w - radius, y + d - radius, 0],
    [x + radius, y + d - radius, 90],
    [x + radius, y + radius, 180],
  ];
  const out: [number, number][] = [];
  for (const [cx, cy, start] of corners) {
    const count = radius > 0 ? steps : 0;
    for (let step = 0; step <= count; step++) {
      const angle = (start + (count ? (90 * step) / count : 45)) * RADIANS;
      out.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
    }
  }
  return out;
}

/**
 * V8's two-argument `Math.hypot`, bit for bit, without its per-call allocation (the builtin copies its arguments into a
 * fresh array). V8 normalizes by the larger magnitude and Kahan-sums the squares; with two terms the compensation is
 * exactly 0, so the sum is (x/max)² + (y/max)². Infinity wins over NaN, ±0 gives 0, NaN propagates through `scaled`.
 * One return expression: early returns of constants made TurboFan box the result (an allocation per call).
 * tools/test-native.mjs proves equality with `Math.hypot`; tools/native-gate.mjs contract does so in the browser.
 */
export function hypot2(x: number, y: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const max = ax > ay ? ax : ay;
  const nx = ax / max;
  const ny = ay / max;
  const scaled = Math.sqrt(nx * nx + ny * ny) * max;
  return ax === Infinity || ay === Infinity ? Infinity : ax === 0 && ay === 0 ? 0 : scaled;
}

/** Words of a ring's class record: facing bits, seam bits (⌈n / 32⌉ words each), 2-bit shades (⌈n / 16⌉ words). */
export const classWordsOf = (ringCount: number) => 2 * Math.ceil(ringCount / 32) + Math.ceil(ringCount / 16);
/** Word offset of the seam bits inside a class record. */
export const seamWordOf = (ringCount: number) => Math.ceil(ringCount / 32);
/** Word offset of the shades inside a class record. */
export const shadeWordOf = (ringCount: number) => 2 * Math.ceil(ringCount / 32);

/** Reads face i's bit of the mask that starts at `words[at]`. */
export const bitOf = (words: ArrayLike<number>, at: number, i: number) => (words[at + (i >>> 5)] >>> (i & 31)) & 1;
/** Reads face i's tone from the shades that start at `words[at]`. */
export const shadeOf = (words: ArrayLike<number>, at: number, i: number) => (words[at + (i >>> 4)] >>> (2 * (i & 15))) & 3;

/** How the kit draws an extruded ring, besides the per-face bits `classifyRing` writes. */
export interface RingClasses {
  /** kit `signedArea(ring) > 0`: outward normals are (dy, −dx) / length. */
  counter: boolean;
  /** kit runsOf: the first face whose facing flag differs from its predecessor's (0 when all faces agree). */
  facingRun: number;
  /** The same for the seam flags. */
  seamRun: number;
}

/**
 * Classifies the ring `xy[0 … 2·count)` (world x, y pairs) as kit extrude and ringSeam do. Writes the class record
 * (classWordsOf(count) words) at `words[at]`:
 * - facing bit i: extrude draws side face i (edge i → i + 1), shaded; its top edge is a crease, its bottom edge outline;
 * - seam bit i: ringSeam runs along edge i (the same test on the un-normalized normal);
 * - shade i: extrude's tone index of face i (meaningful for facing faces).
 */
export function classifyRing(xy: ArrayLike<number>, count: number, camera: Camera, words: Uint32Array, at: number, out: RingClasses): RingClasses {
  let area = 0;
  for (let index = 0; index < count; index++) {
    const next = (index + 1) % count;
    area += xy[index * 2] * xy[next * 2 + 1] - xy[next * 2] * xy[index * 2 + 1];
  }
  const counter = area / 2 > 0;
  // towardViewer(P) = [cosA, sinA]; extrude's light direction = [−sinA, cosA]
  const vx = camera.cosA, vy = camera.sinA;
  const lx = -camera.sinA, ly = camera.cosA;
  const seamAt = at + seamWordOf(count);
  const shadeAt = at + shadeWordOf(count);
  words.fill(0, at, at + classWordsOf(count));
  for (let index = 0; index < count; index++) {
    const next = (index + 1) % count;
    const dx = xy[next * 2] - xy[index * 2];
    const dy = xy[next * 2 + 1] - xy[index * 2 + 1];
    const length = hypot2(dx, dy) || 1;
    const nx = counter ? dy / length : -dy / length;
    const ny = counter ? -dx / length : dx / length;
    if (nx * vx + ny * vy > FACING_EPSILON) {
      words[at + (index >>> 5)] |= 1 << (index & 31);
      const lit = (nx * lx + ny * ly + 1) / 2;
      const shade = Math.min(SHADES - 1, Math.max(0, Math.floor(lit * SHADES)));
      words[shadeAt + (index >>> 4)] |= shade << (2 * (index & 15));
    }
    const sx = counter ? dy : -dy;
    const sy = counter ? -dx : dx;
    if (sx * vx + sy * vy > FACING_EPSILON) words[seamAt + (index >>> 5)] |= 1 << (index & 31);
  }
  out.counter = counter;
  out.facingRun = runStartOf(words, at, count);
  out.seamRun = runStartOf(words, seamAt, count);
  return out;
}

/** kit runsOf's start: the first index whose bit differs from its predecessor's; 0 when every bit is the same. */
function runStartOf(words: ArrayLike<number>, at: number, count: number) {
  for (let i = 0; i < count; i++) if (bitOf(words, at, i) !== bitOf(words, at, (i + count - 1) % count)) return i;
  return 0;
}
