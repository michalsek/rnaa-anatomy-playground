/**
 * Prisms: a plan outline in the xy plane extruded along z (the kit's `extrude` / `slabOf`).
 *
 * Plan arcs (circles, rounded corners, sector arcs) get smooth normals, so the plan tone rule
 * steps along them; polygon corners and sector ends are sharp (creases). Caps are flat: a quad
 * for 3-4 corners, a fan from the centroid for other convex plans, a fan from the apex for a
 * pie, a quad strip between the arcs of an annular sector, and ear clipping otherwise.
 * uv: u = perimeter fraction, v = height (z).
 */
import { MeshBuilder, type Mesh } from './mesh.ts';

type V2 = readonly [number, number];

export type Plan =
  | { rect: readonly [number, number]; r?: number; steps?: number }
  | { circle: number; steps?: number }
  | { polygon: readonly V2[] }
  /** Angles in degrees, counter-clockwise from +x; r0 = 0 is a pie. */
  | { sector: { r0: number; r1: number; a0: number; a1: number }; steps?: number };

export interface ExtrudeSpec {
  plan: Plan;
  /** Bottom of the prism. */
  z?: number;
  height: number;
  /** Heights (absolute z) where the sides are split and the ring is drawn as a seam line. */
  seams?: readonly number[];
  /** Plan offset in xy (used by the box wrapper). */
  offset?: V2;
  /** Line-set tag of the side faces (1-based; 0 = none). */
  sideTag?: number;
}

/** One side edge of the outline: endpoints with their vertex normals (counter-clockwise). */
interface Edge {
  a: V2;
  b: V2;
  na: V2;
  nb: V2;
  smooth: boolean;
}

const DEG = Math.PI / 180;
/**
 * E9 LOD: segments of a full circle of radius r, so a chord sags at most LOD_SAG units from the
 * circle (a fraction of a pixel at the fit zoom, under one in the machine close-ups); 12..128.
 * Was 8 per unit of radius within [32, 128].
 */
export const LOD_SAG = 0.02;
export const circleSteps = (r: number) =>
  Math.min(128, Math.max(12, Math.ceil(Math.PI / Math.acos(1 - Math.min(1, LOD_SAG / Math.max(r, 1e-6))))));
/** Segments for a requested count, capped by the LOD (a hex nut's 6 stays 6): the blocks' rule. */
export const lodSteps = (r: number, requested?: number) => (requested === undefined ? circleSteps(r) : Math.min(requested, circleSteps(r)));
const polar = (r: number, a: number): V2 => [r * Math.cos(a), r * Math.sin(a)];
const flatNormal = (a: V2, b: V2): V2 => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [dy / len, -dx / len];
};
const flat = (a: V2, b: V2): Edge => {
  const n = flatNormal(a, b);
  return { a, b, na: n, nb: n, smooth: false };
};
const signedArea = (ring: readonly V2[]) =>
  ring.reduce((sum, [x, y], i) => {
    const [nx, ny] = ring[(i + 1) % ring.length]!;
    return sum + x * ny - nx * y;
  }, 0) / 2;

/** Arc from angle a0 to a1 (radians) about c: smooth edges with radial normals (`sign` = +1
 * outward, −1 toward the centre). */
function arc(c: V2, r: number, a0: number, a1: number, steps: number, sign: 1 | -1): Edge[] {
  const out: Edge[] = [];
  for (let k = 0; k < steps; k++) {
    const t0 = a0 + ((a1 - a0) * k) / steps;
    const t1 = a0 + ((a1 - a0) * (k + 1)) / steps;
    const p0 = polar(r, t0);
    const p1 = polar(r, t1);
    out.push({
      a: [c[0] + p0[0], c[1] + p0[1]],
      b: [c[0] + p1[0], c[1] + p1[1]],
      na: [Math.cos(t0) * sign, Math.sin(t0) * sign],
      nb: [Math.cos(t1) * sign, Math.sin(t1) * sign],
      smooth: true,
    });
  }
  return out;
}

interface Outline {
  edges: Edge[];
  cap: 'quad' | 'fan' | 'pie' | 'strip' | 'clip';
  /** For 'strip': edge index ranges of the outer and inner arcs. */
  outer?: [number, number];
  inner?: [number, number];
}

function outlineOf(plan: Plan): Outline {
  if ('rect' in plan) {
    const [w, h] = plan.rect;
    const r = Math.min(plan.r ?? 0, w / 2, h / 2);
    if (r <= 0) {
      const p: V2[] = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
      return { edges: p.map((a, i) => flat(a, p[(i + 1) % 4]!)), cap: 'quad' };
    }
    const steps = plan.steps ?? 8;
    const hx = w / 2 - r;
    const hy = h / 2 - r;
    const corners: [V2, number][] = [
      [[hx, -hy], -90], [[hx, hy], 0], [[-hx, hy], 90], [[-hx, -hy], 180],
    ];
    const edges: Edge[] = [];
    corners.forEach(([c, start], i) => {
      edges.push(...arc(c, r, start * DEG, (start + 90) * DEG, steps, 1));
      const [nc, nstart] = corners[(i + 1) % 4]!;
      const from = edges[edges.length - 1]!.b;
      const to: V2 = [nc[0] + r * Math.cos(nstart * DEG), nc[1] + r * Math.sin(nstart * DEG)];
      if (Math.hypot(to[0] - from[0], to[1] - from[1]) > 1e-9) edges.push(flat(from, to));
    });
    return { edges, cap: 'fan' };
  }
  if ('circle' in plan) {
    const steps = plan.steps ?? circleSteps(plan.circle);
    return { edges: arc([0, 0], plan.circle, 0, 2 * Math.PI, steps, 1), cap: 'fan' };
  }
  if ('polygon' in plan) {
    let p = [...plan.polygon];
    if (p.length < 3) throw new Error('extrude: polygon needs at least 3 points');
    if (signedArea(p) < 0) p = p.reverse();
    const edges = p.map((a, i) => flat(a, p[(i + 1) % p.length]!));
    const convex = p.every((b, i) => {
      const a = p[(i + p.length - 1) % p.length]!;
      const c = p[(i + 1) % p.length]!;
      return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) >= -1e-12;
    });
    return { edges, cap: !convex ? 'clip' : p.length <= 4 ? 'quad' : 'fan' };
  }
  const { r0, r1, a0, a1 } = plan.sector;
  if (!(a1 > a0 && a1 - a0 < 360)) throw new Error('extrude: sector needs a0 < a1 < a0 + 360');
  if (!(r1 > r0 && r0 >= 0)) throw new Error('extrude: sector needs 0 <= r0 < r1');
  const steps = plan.steps ?? Math.max(2, Math.ceil((circleSteps(r1) * (a1 - a0)) / 360));
  const outerArc = arc([0, 0], r1, a0 * DEG, a1 * DEG, steps, 1);
  if (r0 === 0) {
    const edges = [
      flat([0, 0], outerArc[0]!.a),
      ...outerArc,
      flat(outerArc[outerArc.length - 1]!.b, [0, 0]),
    ];
    return { edges, cap: 'pie' };
  }
  const innerArc = arc([0, 0], r0, a1 * DEG, a0 * DEG, steps, -1);
  const edges = [
    ...outerArc,
    flat(outerArc[steps - 1]!.b, innerArc[0]!.a),
    ...innerArc,
    flat(innerArc[steps - 1]!.b, outerArc[0]!.a),
  ];
  return { edges, cap: 'strip', outer: [0, steps], inner: [steps + 1, 2 * steps + 1] };
}

/** Ear clipping of a counter-clockwise simple polygon; returns index triples. */
function earClip(p: readonly V2[]): [number, number, number][] {
  const idx = p.map((_, i) => i);
  const out: [number, number, number][] = [];
  const cross = (a: V2, b: V2, c: V2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length]!;
      const i1 = idx[k]!;
      const i2 = idx[(k + 1) % idx.length]!;
      const [a, b, c] = [p[i0]!, p[i1]!, p[i2]!];
      if (cross(a, b, c) <= 1e-12) continue;
      const inside = idx.some((j) => {
        if (j === i0 || j === i1 || j === i2) return false;
        const q = p[j]!;
        return cross(a, b, q) >= 0 && cross(b, c, q) >= 0 && cross(c, a, q) >= 0;
      });
      if (inside) continue;
      out.push([i0, i1, i2]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) throw new Error('extrude: polygon is not simple');
  }
  out.push([idx[0]!, idx[1]!, idx[2]!]);
  return out;
}

export function extrude({ plan, z = 0, height, seams = [], offset = [0, 0], sideTag = 0 }: ExtrudeSpec): Mesh {
  if (!(height > 0)) throw new Error('extrude: height must be positive');
  const outline = outlineOf(plan);
  const edges = outline.edges.map((e) => ({
    ...e,
    a: [e.a[0] + offset[0], e.a[1] + offset[1]] as V2,
    b: [e.b[0] + offset[0], e.b[1] + offset[1]] as V2,
  }));
  const b = new MeshBuilder();
  const top = z + height;
  const levels = [z, ...[...seams].filter((s) => s > z + 1e-9 && s < top - 1e-9).sort((p, q) => p - q), top];

  // ---- sides -----------------------------------------------------------------------------
  b.tag(sideTag);
  const lengths = edges.map((e) => Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]));
  const perimeter = lengths.reduce((sum, l) => sum + l, 0) || 1;
  let along = 0;
  edges.forEach((e, i) => {
    const u0 = along / perimeter;
    along += lengths[i]!;
    const u1 = along / perimeter;
    const ring = levels.map((h) => [
      b.vertex([e.a[0], e.a[1], h], [e.na[0], e.na[1], 0], [u0, h]),
      b.vertex([e.b[0], e.b[1], h], [e.nb[0], e.nb[1], 0], [u1, h]),
    ]);
    b.smooth(e.smooth);
    for (let k = 0; k + 1 < ring.length; k++) {
      const [a0, b0] = ring[k]!;
      const [a1, b1] = ring[k + 1]!;
      b.quad(a0!, b0!, b1!, a1!);
      if (k > 0) b.mark(a0!, b0!);
    }
  });
  b.smooth(false);
  b.tag(0);

  // ---- caps ------------------------------------------------------------------------------
  const ring = edges.map((e) => e.a);
  for (const [h, up] of [[top, 1], [z, -1]] as const) {
    const n: [number, number, number] = [0, 0, up];
    const vtx = (p: V2) => b.vertex([p[0], p[1], h], n, [0, h]);
    const tri = (i: number, j: number, k: number) =>
      up > 0 ? b.triangle(i, j, k) : b.triangle(i, k, j);
    const quad = (i: number, j: number, k: number, l: number) =>
      up > 0 ? b.quad(i, j, k, l) : b.quad(l, k, j, i);
    const ids = ring.map(vtx);
    if (outline.cap === 'quad') {
      if (ids.length === 3) tri(ids[0]!, ids[1]!, ids[2]!);
      else quad(ids[0]!, ids[1]!, ids[2]!, ids[3]!);
    } else if (outline.cap === 'fan') {
      const c = ring.reduce<[number, number]>((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length], [0, 0]);
      const centre = vtx(c);
      for (let i = 0; i < ids.length; i++) tri(centre, ids[i]!, ids[(i + 1) % ids.length]!);
    } else if (outline.cap === 'pie') {
      // ring[0] is the apex.
      for (let i = 1; i + 1 < ids.length; i++) tri(ids[0]!, ids[i]!, ids[i + 1]!);
    } else if (outline.cap === 'strip') {
      const [o0, o1] = outline.outer!;
      const [i0] = outline.inner!;
      const steps = o1 - o0;
      // Outer arc points 0..steps run counter-clockwise from a0 (point `steps` starts the end
      // edge); the inner arc runs back from a1, so its point at a0 starts the closing edge.
      const outer = (k: number) => ids[o0 + k]!;
      const inner = (k: number) => ids[i0 + steps - k]!;
      for (let k = 0; k < steps; k++) quad(inner(k), outer(k), outer(k + 1), inner(k + 1));
    } else {
      for (const [i, j, k] of earClip(ring)) tri(ids[i]!, ids[j]!, ids[k]!);
    }
  }
  return b.build();
}
