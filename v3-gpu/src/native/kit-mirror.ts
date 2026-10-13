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

/** How the kit draws an extruded ring: one bit per side face i (edge i → i + 1) and a 2-bit tone per face. */
export interface RingClasses {
  /** kit `signedArea(ring) > 0`: outward normals are (dy, −dx) / length. */
  counter: boolean;
  /** extrude: bit i set when face i faces the viewer (drawn, shaded; its top edge is a crease, its bottom edge outline). */
  facing: number;
  /** ringSeam: bit i set when the seam runs along edge i (the same test on the un-normalized normal). */
  seamFacing: number;
  /** extrude: tone index of face i in bits 2i…2i+1 (meaningful for facing faces). */
  shades: number;
}

/**
 * Classifies the ring `xy[0 … 2·count)` (world x, y pairs) as kit extrude and ringSeam do, into `out`. Rings of up to
 * 16 points (the shades fit 32 bits).
 */
export function classifyRing(xy: ArrayLike<number>, count: number, camera: Camera, out: RingClasses): RingClasses {
  let area = 0;
  for (let index = 0; index < count; index++) {
    const next = (index + 1) % count;
    area += xy[index * 2] * xy[next * 2 + 1] - xy[next * 2] * xy[index * 2 + 1];
  }
  const counter = area / 2 > 0;
  // towardViewer(P) = [cosA, sinA]; extrude's light direction = [−sinA, cosA]
  const vx = camera.cosA, vy = camera.sinA;
  const lx = -camera.sinA, ly = camera.cosA;
  let facing = 0, seamFacing = 0, shades = 0;
  for (let index = 0; index < count; index++) {
    const next = (index + 1) % count;
    const dx = xy[next * 2] - xy[index * 2];
    const dy = xy[next * 2 + 1] - xy[index * 2 + 1];
    const length = Math.hypot(dx, dy) || 1;
    const nx = counter ? dy / length : -dy / length;
    const ny = counter ? -dx / length : dx / length;
    if (nx * vx + ny * vy > FACING_EPSILON) {
      facing |= 1 << index;
      const lit = (nx * lx + ny * ly + 1) / 2;
      const shade = Math.min(SHADES - 1, Math.max(0, Math.floor(lit * SHADES)));
      shades |= shade << (2 * index);
    }
    const sx = counter ? dy : -dy;
    const sy = counter ? -dx : dx;
    if (sx * vx + sy * vy > FACING_EPSILON) seamFacing |= 1 << index;
  }
  out.counter = counter;
  out.facing = facing;
  out.seamFacing = seamFacing;
  out.shades = shades >>> 0;
  return out;
}
