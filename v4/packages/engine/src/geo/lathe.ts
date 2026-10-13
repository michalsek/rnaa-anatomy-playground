import { type Mesh, MeshBuilder } from './mesh.ts';

/** A profile knot: radius, height, and whether the surface is smooth through it. */
export type ProfilePoint = readonly [r: number, z: number, smooth?: boolean];

export interface LatheSpec {
  /**
   * Meridian profile in (r, z), revolved about the model z axis. Ordered so that the outside
   * is on the right of the direction of travel (e.g. bottom centre → rim → up → top centre).
   */
  profile: readonly ProfilePoint[];
  /** Segments around the axis. */
  steps?: number;
  part: number;
  /** UV line sets: profile segment `segment` (knot i → i+1) gets line set `set` (1-based). */
  lineSets?: readonly { segment: number; set: number }[];
  /** Knot indices whose ring is forced as a line even where the surface is smooth or flat. */
  marks?: readonly number[];
}

/**
 * Surface of revolution with smooth normals around the axis, and along the profile wherever a
 * knot is marked smooth (sharp knots split the normal, so rims and corners stay crisp).
 * uv: u = k/steps around the axis, v = profile length from the first knot.
 */
export function lathe({ profile, steps = 128, part, lineSets = [], marks = [] }: LatheSpec): Mesh {
  const b = new MeshBuilder(part);
  const segCount = profile.length - 1;
  // Swept volume ∫ r² dz along the profile: positive when the outside is on the right of the
  // direction of travel. A reversed profile would build an inside-out (back-face-culled) solid.
  let swept = 0;
  for (let i = 0; i < segCount; i++) {
    const [r0, z0] = profile[i]!;
    const [r1, z1] = profile[i + 1]!;
    swept += ((r0 * r0 + r0 * r1 + r1 * r1) / 3) * (z1 - z0);
  }
  if (swept < -1e-9) throw new Error('lathe: profile is reversed (outside must be on the right)');
  // Outward normal of each profile segment in (r, z): the tangent rotated by −90°.
  const segNormal = Array.from({ length: segCount }, (_, i) => {
    const [r0, z0] = profile[i]!;
    const [r1, z1] = profile[i + 1]!;
    const dr = r1 - r0;
    const dz = z1 - z0;
    const len = Math.hypot(dr, dz) || 1;
    return [dz / len, -dr / len] as const;
  });
  const knotNormal = (seg: number, knot: number) => {
    const own = segNormal[seg]!;
    const other = knot === seg ? segNormal[seg - 1] : segNormal[seg + 1];
    if (!profile[knot]![2] || !other) return own;
    return [own[0] + other[0], own[1] + other[1]] as const;
  };
  const lengthAt: number[] = [0];
  for (let i = 1; i < profile.length; i++) {
    const [r0, z0] = profile[i - 1]!;
    const [r1, z1] = profile[i]!;
    lengthAt.push(lengthAt[i - 1]! + Math.hypot(r1 - r0, z1 - z0));
  }
  const setOf = new Map(lineSets.map(({ segment, set }) => [segment, set]));
  const marked = new Set(marks);

  for (let seg = 0; seg < segCount; seg++) {
    const rings = [seg, seg + 1].map((knot) => {
      const [r, z] = profile[knot]!;
      const [nr, nz] = knotNormal(seg, knot);
      const ring: number[] = [];
      for (let k = 0; k <= steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        ring.push(b.vertex([r * c, r * s, z], [nr * c, nr * s, nz], [k / steps, lengthAt[knot]!]));
      }
      return ring;
    });
    const [lo, hi] = rings as [number[], number[]];
    b.tag(setOf.get(seg) ?? 0);
    for (let k = 0; k < steps; k++) b.quad(lo[k]!, lo[k + 1]!, hi[k + 1]!, hi[k]!);
    // A forced ring is recorded once, on the segment that ends at the marked knot (or starts
    // at it for the first knot).
    const ringToMark = marked.has(seg + 1) ? hi : seg === 0 && marked.has(0) ? lo : null;
    if (ringToMark) for (let k = 0; k < steps; k++) b.mark(ringToMark[k]!, ringToMark[k + 1]!);
  }
  return b.build();
}
