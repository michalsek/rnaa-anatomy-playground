// Fill tessellation (nonzero rule, the SVG default and the only rule the kit uses) and an independent exact
// nonzero area for the gate. Isomorphic: earcut + libtess are plain JS.
import earcut, { deviation } from "earcut";
import libtess from "libtess";

export const EPS = 1e-9;
const EARCUT_MAX_DEVIATION = 1e-6; // earcut's relative area error above which the ring goes to libtess instead

export const samePoint = (p, q) => Math.abs(p[0] - q[0]) <= EPS && Math.abs(p[1] - q[1]) <= EPS;
export const withoutRepeats = (points) => points.filter((p, i) => i === 0 || !samePoint(p, points[i - 1]));

// cleanRing(points) → the ring without repeated consecutive points or a closing duplicate of the first point
export function cleanRing(points) {
  const ring = withoutRepeats(points);
  while (ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])) ring.pop();
  return ring;
}

export const signedArea = (ring) => {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    area += ax * by - bx * ay;
  }
  return area / 2;
};

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const onSegment = (p, a, b) => Math.min(a[0], b[0]) - EPS <= p[0] && p[0] <= Math.max(a[0], b[0]) + EPS && Math.min(a[1], b[1]) - EPS <= p[1] && p[1] <= Math.max(a[1], b[1]) + EPS;
function segmentsTouch(a, b, c, d) {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) return true;
  return (Math.abs(d1) <= EPS && onSegment(a, c, d)) || (Math.abs(d2) <= EPS && onSegment(b, c, d)) || (Math.abs(d3) <= EPS && onSegment(c, a, b)) || (Math.abs(d4) <= EPS && onSegment(d, a, b));
}

// isSimpleRing(ring): no two non-adjacent edges touch (O(n²); kit rings are small)
export function isSimpleRing(ring) {
  const n = ring.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsTouch(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return false;
    }
  return true;
}

function earcutRing(ring) {
  const flat = ring.flat();
  const indices = earcut(flat);
  if (deviation(flat, undefined, 2, indices) > EARCUT_MAX_DEVIATION) return null;
  return { positions: ring, indices };
}

function libtessRings(rings) {
  const { GluTesselator, gluEnum, windingRule, primitiveType } = libtess;
  const tess = new GluTesselator();
  const flat = [];
  tess.gluTessProperty(gluEnum.GLU_TESS_WINDING_RULE, windingRule.GLU_TESS_WINDING_NONZERO);
  tess.gluTessCallback(gluEnum.GLU_TESS_VERTEX_DATA, (data, out) => out.push(data[0], data[1]));
  tess.gluTessCallback(gluEnum.GLU_TESS_BEGIN, (type) => {
    if (type !== primitiveType.GL_TRIANGLES) throw new Error(`tess: unexpected primitive ${type}`);
  });
  tess.gluTessCallback(gluEnum.GLU_TESS_ERROR, (error) => {
    throw new Error(`tess: libtess error ${error}`);
  });
  tess.gluTessCallback(gluEnum.GLU_TESS_COMBINE, (coords) => [coords[0], coords[1], coords[2]]);
  tess.gluTessCallback(gluEnum.GLU_TESS_EDGE_FLAG, () => {}); // forces plain GL_TRIANGLES (no fans / strips)
  tess.gluTessNormal(0, 0, 1);
  tess.gluTessBeginPolygon(flat);
  for (const ring of rings) {
    tess.gluTessBeginContour();
    for (const [x, y] of ring) tess.gluTessVertex([x, y, 0], [x, y, 0]);
    tess.gluTessEndContour();
  }
  tess.gluTessEndPolygon();
  // weld the non-indexed output into an indexed mesh
  const positions = [];
  const indices = [];
  const seen = new Map();
  for (let i = 0; i < flat.length; i += 2) {
    const key = `${flat[i]},${flat[i + 1]}`;
    if (!seen.has(key)) seen.set(key, positions.push([flat[i], flat[i + 1]]) - 1);
    indices.push(seen.get(key));
  }
  return { positions, indices };
}

// triangulate(subpaths) → { positions: [[x, y]…], indices: [i…], method: "earcut" | "libtess" | "empty", rings,
// simpleRings }. A triangle is dropped when its area is zero in f64 or after rounding to f32 (what the binary stores);
// the kept ones are oriented so their f32 cross product is positive in SVG coordinates. Positions no kept triangle
// uses are dropped. rings are the
// cleaned input rings (≥ 3 points) and simpleRings[i] tells whether ring i has no touching non-adjacent edges.
export function triangulate(subpaths) {
  const rings = subpaths.map((s) => cleanRing(s.points ?? s)).filter((ring) => ring.length >= 3);
  const simpleRings = rings.map(isSimpleRing);
  if (!rings.length) return { positions: [], indices: [], method: "empty", rings, simpleRings };
  let mesh = null;
  let method = "earcut";
  if (rings.length === 1 && simpleRings[0]) mesh = earcutRing(rings[0]);
  if (!mesh) {
    mesh = libtessRings(rings);
    method = "libtess";
  }
  const stored = mesh.positions.map(([x, y]) => [Math.fround(x), Math.fround(y)]);
  const kept = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    let [a, b, c] = mesh.indices.slice(t, t + 3);
    const storedArea = cross(stored[a], stored[b], stored[c]);
    if (Math.abs(cross(mesh.positions[a], mesh.positions[b], mesh.positions[c])) <= EPS || Math.abs(storedArea) <= EPS) continue;
    if (storedArea < 0) [b, c] = [c, b];
    kept.push(a, b, c);
  }
  // drop the positions no kept triangle uses (collinear or zero-area leftovers), keeping the original order
  const isUsed = new Array(mesh.positions.length).fill(false);
  for (const i of kept) isUsed[i] = true;
  const positions = [];
  const compactedIndex = isUsed.map((used, i) => (used ? positions.push(mesh.positions[i]) - 1 : -1));
  const indices = kept.map((i) => compactedIndex[i]);
  return { positions, indices, method, rings, simpleRings };
}

export const triangleArea = (positions, indices) => {
  let sum = 0;
  for (let t = 0; t < indices.length; t += 3) sum += cross(positions[indices[t]], positions[indices[t + 1]], positions[indices[t + 2]]) / 2;
  return sum;
};

// nonzeroArea(subpaths): exact area of the nonzero-filled region. Independent of the tessellators: cut the plane into
// horizontal slabs at every vertex and edge-crossing y; inside a slab edges do not cross, so sort them by x, walk
// the winding number and add the trapezoids where it is non-zero.
export function nonzeroArea(subpaths) {
  const edges = [];
  for (const ring of subpaths.map((s) => cleanRing(s.points ?? s)).filter((r) => r.length >= 3))
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (Math.abs(a[1] - b[1]) > EPS) edges.push(a[1] < b[1] ? { a, b, dir: 1 } : { a: b, b: a, dir: -1 });
    }
  const ys = new Set(edges.flatMap((e) => [e.a[1], e.b[1]]));
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const y = crossingY(edges[i], edges[j]);
      if (y !== null) ys.add(y);
    }
  const sorted = [...ys].sort((p, q) => p - q);
  const xAt = (e, y) => e.a[0] + ((e.b[0] - e.a[0]) * (y - e.a[1])) / (e.b[1] - e.a[1]);
  let area = 0;
  for (let s = 0; s + 1 < sorted.length; s++) {
    const y0 = sorted[s];
    const y1 = sorted[s + 1];
    if (y1 - y0 <= EPS) continue;
    const ym = (y0 + y1) / 2;
    const span = edges.filter((e) => e.a[1] <= ym && e.b[1] >= ym).map((e) => ({ x0: xAt(e, y0), x1: xAt(e, y1), xm: xAt(e, ym), dir: e.dir }));
    span.sort((p, q) => p.xm - q.xm);
    let winding = 0;
    let open = null;
    for (const e of span) {
      const before = winding;
      winding += e.dir;
      if (before === 0 && winding !== 0) open = e;
      else if (before !== 0 && winding === 0) area += ((e.x0 - open.x0 + (e.x1 - open.x1)) / 2) * (y1 - y0);
    }
  }
  return area;
}

function crossingY(e, f) {
  const r = [e.b[0] - e.a[0], e.b[1] - e.a[1]];
  const s = [f.b[0] - f.a[0], f.b[1] - f.a[1]];
  const denominator = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denominator) <= EPS) return null;
  const qp = [f.a[0] - e.a[0], f.a[1] - e.a[1]];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / denominator;
  const u = (qp[0] * r[1] - qp[1] * r[0]) / denominator;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return e.a[1] + t * r[1];
}
