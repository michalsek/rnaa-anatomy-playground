import { circleSteps } from './extrude.ts';
import { type Mesh, MeshBuilder } from './mesh.ts';

/** A profile knot: radius, height, and whether the surface is smooth through it. */
export type ProfilePoint = readonly [r: number, z: number, smooth?: boolean];

export interface LatheSpec {
  /**
   * Meridian profile in (r, z), revolved about the model z axis. Ordered so that the outside
   * is on the right of the direction of travel (e.g. bottom centre → rim → up → top centre).
   */
  profile: readonly ProfilePoint[];
  /** Segments around the axis (default: about 8 per unit of the largest radius, 32..128). */
  steps?: number;
  /** UV line sets: profile segment `segment` (knot i → i+1) gets line set `set` (1-based). */
  lineSets?: readonly { segment: number; set: number }[];
  /** Knot indices whose ring is forced as a line even where the surface is smooth or flat. */
  marks?: readonly number[];
  /**
   * Heights where every profile segment crossing them gets a knot whose ring is drawn as a
   * seam line. The knot is placed on the chord, so a seam on a curved span bends it slightly.
   */
  seams?: readonly number[];
  /**
   * Pieces per profile segment that touches a smooth knot. The curve through smooth knots is
   * real geometry (a Catmull-Rom spline), so the faceted silhouette follows the smooth-shaded
   * contour instead of jumping between a few coarse rings.
   */
  subdivisions?: number;
}

type Knot = readonly [number, number, boolean];

/** A sphere's meridian (bottom pole to top pole), smooth everywhere but the poles. */
export function sphereProfile(r: number, n = 12): ProfilePoint[] {
  return Array.from({ length: n + 1 }, (_, k) => {
    const a = (Math.PI * k) / n;
    return [k === 0 || k === n ? 0 : r * Math.sin(a), -r * Math.cos(a), k > 0 && k < n] as const;
  });
}

/**
 * Insert seam knots into the input profile. Returns the new profile and maps from the input's
 * segments and knots to the new ones, plus the seam knots to mark.
 */
function insertSeams(profile: readonly ProfilePoint[], seams: readonly number[]) {
  const out: ProfilePoint[] = [profile[0]!];
  const knotOf = [0];
  const segmentsOf: number[][] = [];
  const seamKnots: number[] = [];
  for (let i = 0; i + 1 < profile.length; i++) {
    const a = profile[i]!;
    const b = profile[i + 1]!;
    const cuts = seams
      .map((z) => (z - a[1]) / (b[1] - a[1]))
      .filter((t) => Number.isFinite(t) && t > 1e-6 && t < 1 - 1e-6)
      .sort((p, q) => p - q);
    const segs: number[] = [];
    for (const t of cuts) {
      segs.push(out.length - 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] === true || b[2] === true]);
      seamKnots.push(out.length - 1);
    }
    segs.push(out.length - 1);
    out.push(b);
    knotOf.push(out.length - 1);
    segmentsOf.push(segs);
  }
  return { profile: out, knotOf, segmentsOf, seamKnots };
}

/**
 * Subdivide the spans next to smooth knots along a Hermite spline (Catmull-Rom tangents at
 * smooth knots, the chord at sharp ones). Returns the refined knots and index maps from the
 * input's segments and knots to the refined ones.
 */
function refineProfile(profile: readonly ProfilePoint[], subdivisions: number) {
  const P = profile.map(([r, z, smooth]) => [r, z, smooth === true] as Knot);
  const tangent = (i: number, outgoing: boolean): [number, number] => {
    const k = P[i]!;
    const prev = P[i - 1];
    const next = P[i + 1];
    if (k[2] && prev && next) return [(next[0] - prev[0]) / 2, (next[1] - prev[1]) / 2];
    const other = outgoing ? next : prev;
    if (!other) return [0, 0];
    return outgoing ? [other[0] - k[0], other[1] - k[1]] : [k[0] - other[0], k[1] - other[1]];
  };
  const knots: Knot[] = [P[0]!];
  const knotIndex = [0];
  const segments: number[][] = [];
  for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i]!;
    const b = P[i + 1]!;
    const pieces = a[2] || b[2] ? subdivisions : 1;
    const t0 = tangent(i, true);
    const t1 = tangent(i + 1, false);
    const refined: number[] = [];
    for (let s = 1; s <= pieces; s++) {
      const t = s / pieces;
      if (s === pieces) {
        knots.push(b);
      } else {
        const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
        const h10 = t ** 3 - 2 * t ** 2 + t;
        const h01 = -2 * t ** 3 + 3 * t ** 2;
        const h11 = t ** 3 - t ** 2;
        knots.push([
          h00 * a[0] + h10 * t0[0] + h01 * b[0] + h11 * t1[0],
          h00 * a[1] + h10 * t0[1] + h01 * b[1] + h11 * t1[1],
          true,
        ]);
      }
      refined.push(knots.length - 2);
    }
    segments.push(refined);
    knotIndex.push(knots.length - 1);
  }
  return { knots, segments, knotIndex };
}

/**
 * Surface of revolution with smooth normals around the axis, and along the profile wherever a
 * knot is marked smooth (sharp knots split the normal, so rims and corners stay crisp).
 * uv: u = k/steps around the axis, v = profile length from the first knot.
 */
export function lathe({
  profile: original,
  steps: requestedSteps,
  lineSets: inputSets = [],
  marks: inputMarks = [],
  seams = [],
  subdivisions = 8,
}: LatheSpec): Mesh {
  const seamed = insertSeams(original, seams);
  const input = seamed.profile;
  const steps =
    requestedSteps ?? circleSteps(Math.max(...original.map(([r]) => Math.abs(r))));
  const { knots: profile, segments, knotIndex } = refineProfile(input, subdivisions);
  const lineSets = inputSets.flatMap(({ segment, set }) => {
    const seg = seamed.segmentsOf[segment];
    if (!seg) {
      throw new Error(`lathe: line set on unknown segment ${segment} (0..${original.length - 2})`);
    }
    return seg.flatMap((s) => segments[s]!.map((index) => ({ segment: index, set })));
  });
  const knots = inputMarks.map((knot) => {
    const index = seamed.knotOf[knot];
    if (index === undefined) {
      throw new Error(`lathe: mark on unknown knot ${knot} (0..${original.length - 1})`);
    }
    return index;
  });
  const marks = [...knots, ...seamed.seamKnots].map((knot) => knotIndex[knot]!);
  const b = new MeshBuilder();
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
    // A knot on the axis (a pole) is a single point: its normal is the axis, or the fan around
    // it would carry a ring of different normals and draw creases like a star.
    if (Math.abs(profile[knot]![0]) < 1e-9) return [0, own[1] >= 0 ? 1 : -1] as const;
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
    // Curved unless it is a flat annulus (both rings' normals point along the axis).
    b.smooth(Math.abs(knotNormal(seg, seg)[0]) > 1e-9 || Math.abs(knotNormal(seg, seg + 1)[0]) > 1e-9);
    for (let k = 0; k < steps; k++) b.quad(lo[k]!, lo[k + 1]!, hi[k + 1]!, hi[k]!);
    // A forced ring is recorded once, on the segment that ends at the marked knot (or starts
    // at it for the first knot).
    const ringToMark = marked.has(seg + 1) ? hi : seg === 0 && marked.has(0) ? lo : null;
    if (ringToMark) for (let k = 0; k < steps; k++) b.mark(ringToMark[k]!, ringToMark[k + 1]!);
  }
  return b.build();
}
