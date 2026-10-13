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
}

/**
 * Surface of revolution with smooth normals around the axis, and along the profile wherever a
 * knot is marked smooth (sharp knots split the normal, so rims and corners stay crisp).
 */
export function lathe({ profile, steps = 64, part }: LatheSpec): Mesh {
  const b = new MeshBuilder(part);
  const segCount = profile.length - 1;
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

  for (let seg = 0; seg < segCount; seg++) {
    const ends = [seg, seg + 1].map((knot) => ({ p: profile[knot]!, n: knotNormal(seg, knot) }));
    const rings = ends.map(({ p: [r, z], n: [nr, nz] }) => {
      const ring: number[] = [];
      for (let k = 0; k <= steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        ring.push(b.vertex([r * c, r * s, z], [nr * c, nr * s, nz]));
      }
      return ring;
    });
    const [lo, hi] = rings as [number[], number[]];
    for (let k = 0; k < steps; k++) b.quad(lo[k]!, lo[k + 1]!, hi[k + 1]!, hi[k]!);
  }
  return b.build();
}
