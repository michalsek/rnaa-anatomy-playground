import { type Mesh, MeshBuilder, type Vec3 } from './mesh.ts';

export interface TubeSpec {
  /** Centreline corners; each interior corner is filleted with an arc of radius `bend`. */
  path: readonly Vec3[];
  radius: number;
  sides?: number;
  /** Fillet radius at the corners (default 3 × radius). */
  bend?: number;
  /** Close the start / end with flat caps (ignored for a closed loop). */
  caps?: readonly [boolean, boolean];
  /**
   * The path is a loop (the last point connects back to the first, every corner is filleted)
   * with no caps and no seam. Planar loops only, so the frames close up without a twist.
   */
  closed?: boolean;
}

type V = [number, number, number];
const sub = (a: Vec3, b: Vec3): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): V => scale(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));

/** Samples per 90° of fillet arc (8 left visible kinks in the bands and contour). */
const ARC_SAMPLES = 16;

/**
 * The filleted centreline: points with unit tangents. With `bend` 0 every path point is kept
 * as it is, with the mean of its two segment directions as tangent (for densely sampled
 * curves such as a belt).
 */
function centreline(path: readonly Vec3[], bend: number, closed: boolean) {
  const out: { p: V; t: V }[] = [];
  const n = path.length;
  if (!closed) out.push({ p: [...path[0]!], t: unit(sub(path[1]!, path[0]!)) });
  const first = closed ? 0 : 1;
  const last = closed ? n : n - 1;
  for (let i = first; i < last; i++) {
    const a = path[(i + n - 1) % n]!;
    const p = path[i]!;
    const b = path[(i + 1) % n]!;
    const d1 = unit(sub(p, a));
    const d2 = unit(sub(b, p));
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(d1, d2))));
    if (bend <= 0 || angle < 1e-6) {
      if (closed || angle >= 1e-6 || bend <= 0) out.push({ p: [...p], t: unit(add(d1, d2)) });
      continue;
    }
    // Tangent length of the fillet, clamped so neighbouring fillets cannot overlap.
    const room = Math.min(Math.hypot(...sub(p, a)), Math.hypot(...sub(b, p))) / 2;
    const tangentLength = Math.min(bend * Math.tan(angle / 2), room);
    const radius = tangentLength / Math.tan(angle / 2);
    const n1 = unit(sub(d2, scale(d1, dot(d1, d2)))); // toward the inside of the turn
    const start = sub(p, scale(d1, tangentLength));
    const centre = add(start, scale(n1, radius));
    const samples = Math.max(1, Math.ceil((ARC_SAMPLES * angle) / (Math.PI / 2)));
    for (let s = 0; s <= samples; s++) {
      const phi = (s / samples) * angle;
      const c = Math.cos(phi);
      const n = Math.sin(phi);
      out.push({
        p: add(centre, scale(add(scale(n1, -c), scale(d1, n)), radius)),
        t: unit(add(scale(d1, c), scale(n1, n))),
      });
    }
  }
  if (!closed) {
    const end = path[n - 1]!;
    out.push({ p: [...end], t: unit(sub(end, path[n - 2]!)) });
  }
  return out;
}

/** Unit normal of a closed path's plane; throws if the path is not planar. */
function planeOf(path: readonly Vec3[]): V {
  // Newell's method: robust for any simple polygon.
  let nrm: V = [0, 0, 0];
  for (let i = 0; i < path.length; i++) {
    const a = path[i]!;
    const b = path[(i + 1) % path.length]!;
    nrm = add(nrm, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
  }
  const normal = unit(nrm);
  const span = Math.max(...path.map((p) => Math.hypot(...sub(p, path[0]!)))) || 1;
  for (const p of path) {
    if (Math.abs(dot(sub(p, path[0]!), normal)) > 1e-6 * span) {
      throw new Error('tube: a closed path must be planar');
    }
  }
  return normal;
}

/**
 * A round tube swept along a filleted polyline, with parallel-transport frames, smooth radial
 * normals, and flat caps. uv: u = j/sides around, v = arc length along the centreline.
 */
export function tube({
  path,
  radius,
  sides = 32,
  bend = 3 * radius,
  caps = [true, true],
  closed = false,
}: TubeSpec): Mesh {
  if (path.length < (closed ? 3 : 2)) throw new Error('tube: path is too short');
  const b = new MeshBuilder();
  const line = centreline(path, bend, closed);
  // A closed loop repeats its first ring at the end (same positions, so topology welds it;
  // v runs on to the full length so the tube tone rule sees no jump).
  if (closed) line.push(line[0]!);

  // Parallel transport: carry the first normal along, re-orthogonalised against each tangent.
  // For a planar loop that is the plane normal throughout.
  const t0 = line[0]!.t;
  const helper: V = Math.abs(t0[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  let u = closed ? planeOf(path) : unit(cross(helper, t0));
  let length = 0;
  const rings: number[][] = [];
  const frames: { u: V; v: V }[] = [];
  line.forEach(({ p, t }, k) => {
    if (k > 0) {
      length += Math.hypot(...sub(p, line[k - 1]!.p));
      u = unit(sub(u, scale(t, dot(u, t))));
    }
    const v = cross(t, u);
    frames.push({ u, v });
    const ring: number[] = [];
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const radial = add(scale(u, Math.cos(a)), scale(v, Math.sin(a)));
      ring.push(b.vertex(add(p, scale(radial, radius)), radial, [j / sides, length]));
    }
    rings.push(ring);
  });
  b.smooth(true);
  for (let k = 0; k + 1 < rings.length; k++) {
    const r0 = rings[k]!;
    const r1 = rings[k + 1]!;
    for (let j = 0; j < sides; j++) b.quad(r0[j]!, r0[j + 1]!, r1[j + 1]!, r1[j]!);
  }

  const cap = (k: number, sign: 1 | -1) => {
    const { p, t } = line[k]!;
    const { u: cu, v: cv } = frames[k]!;
    const n = scale(t, sign);
    const centre = b.vertex(p, n);
    const ring: number[] = [];
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const radial = add(scale(cu, Math.cos(a)), scale(cv, Math.sin(a)));
      ring.push(b.vertex(add(p, scale(radial, radius)), n));
    }
    for (let j = 0; j < sides; j++) {
      if (sign > 0) b.triangle(centre, ring[j]!, ring[j + 1]!);
      else b.triangle(centre, ring[j + 1]!, ring[j]!);
    }
  };
  b.smooth(false);
  if (!closed && caps[0]) cap(0, -1);
  if (!closed && caps[1]) cap(line.length - 1, 1);
  return b.build();
}
