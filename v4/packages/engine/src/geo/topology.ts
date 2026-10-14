/**
 * Triangle adjacency and edge flags for the in-face line shader.
 *
 * Edge i of a triangle is the one opposite corner i: edge 0 = (v1, v2), edge 1 = (v2, v0),
 * edge 2 = (v0, v1). Vertices are welded by quantised position within one mesh, so the
 * duplicated vertices of a seam or a sharp knot still connect. Topology is built per prototype
 * mesh and concatenated with `mergeTopologies`, so separate meshes (even of one part) never weld.
 */
import { type Mesh, triangleCount } from './mesh.ts';

export const NO_NEIGHBOUR = 0xffffffff;

/** Triangle flag bits (shared with the shader). */
export const FLAG = {
  /** Bits 0-2: edge i is a crease (normals split, or a forced mark). */
  creaseBit: 0,
  /** Bits 3-5: edge i has no neighbour (an open mesh boundary). */
  boundaryBit: 3,
  /** Bit 6: the triangle lies on a curved surface (declared by the generator). */
  smoothBit: 6,
  /** Bits 8-15: UV line set id (1-based; 0 = none). */
  lineSetShift: 8,
  lineSetMask: 0xff,
  crease: (i: number) => 1 << i,
  boundary: (i: number) => 1 << (3 + i),
  smooth: 1 << 6,
} as const;

export interface Topology {
  /** Per triangle and edge: the triangle across that edge, or NO_NEIGHBOUR. */
  adj: Uint32Array;
  /** Per triangle: FLAG bits. */
  flags: Uint32Array;
  /** Per triangle: unit geometric normal (CCW from outside). */
  faceNormals: Float32Array;
}

const QUANTUM = 1e-4;
/** Vertex normals closer than this (cos 1°) count as one normal; a larger split is a crease. */
const COS_1DEG = Math.cos(Math.PI / 180);

export function buildTopology(mesh: Mesh): Topology {
  const { positions: P, normals: N, indices, tags, marks, smooth } = mesh;
  const triCount = triangleCount(mesh);

  // ---- weld ------------------------------------------------------------------------------
  const weldIds = new Map<string, number>();
  const weld = new Uint32Array(P.length / 3);
  for (let v = 0; v < weld.length; v++) {
    const q = (k: number) => Math.round(P[v * 3 + k]! / QUANTUM);
    const key = `${q(0)},${q(1)},${q(2)}`;
    let id = weldIds.get(key);
    if (id === undefined) {
      id = weldIds.size;
      weldIds.set(key, id);
    }
    weld[v] = id;
  }
  const edgeKey = (a: number, b: number) => {
    const wa = weld[a]!;
    const wb = weld[b]!;
    return wa < wb ? `${wa}_${wb}` : `${wb}_${wa}`;
  };
  const marked = new Set<string>();
  for (let k = 0; k < marks.length; k += 2) marked.add(edgeKey(marks[k]!, marks[k + 1]!));

  // ---- face normals ----------------------------------------------------------------------
  const faceNormals = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const [a, b, c] = [indices[t * 3]!, indices[t * 3 + 1]!, indices[t * 3 + 2]!];
    const e1 = [0, 1, 2].map((k) => P[b * 3 + k]! - P[a * 3 + k]!);
    const e2 = [0, 1, 2].map((k) => P[c * 3 + k]! - P[a * 3 + k]!);
    const n = [
      e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      e1[0]! * e2[1]! - e1[1]! * e2[0]!,
    ];
    const len = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    faceNormals.set([n[0]! / len, n[1]! / len, n[2]! / len], t * 3);
  }

  // ---- adjacency -------------------------------------------------------------------------
  // Each undirected edge collects its (triangle, edge index, from-vertex) uses.
  const uses = new Map<string, { t: number; i: number; from: number }[]>();
  const corner = (t: number, k: number) => indices[t * 3 + (k % 3)]!;
  for (let t = 0; t < triCount; t++) {
    for (let i = 0; i < 3; i++) {
      const from = corner(t, i + 1);
      const to = corner(t, i + 2);
      const key = edgeKey(from, to);
      const list = uses.get(key);
      if (list) list.push({ t, i, from });
      else uses.set(key, [{ t, i, from }]);
    }
  }

  const adj = new Uint32Array(triCount * 3).fill(NO_NEIGHBOUR);
  const flags = new Uint32Array(triCount);
  const sameNormal = (a: number, b: number) =>
    N[a * 3]! * N[b * 3]! + N[a * 3 + 1]! * N[b * 3 + 1]! + N[a * 3 + 2]! * N[b * 3 + 2]! >=
    COS_1DEG;

  for (const [key, list] of uses) {
    if (list.length > 2) throw new Error(`non-manifold edge ${key}: ${list.length} triangles`);
    const [x, y] = list;
    if (!x) continue;
    if (!y) {
      flags[x.t]! |= FLAG.boundary(x.i);
      continue;
    }
    if (weld[x.from] === weld[y.from]) {
      throw new Error(`inconsistent winding at edge ${key} (triangles ${x.t}, ${y.t})`);
    }
    adj[x.t * 3 + x.i] = y.t;
    adj[y.t * 3 + y.i] = x.t;
    // Endpoints pair up by weld id: x's `from` is y's `to` and the other way around.
    const xFrom = x.from;
    const xTo = corner(x.t, x.i + 2);
    const yFrom = y.from;
    const yTo = corner(y.t, y.i + 2);
    const crease = marked.has(key) || !sameNormal(xFrom, yTo) || !sameNormal(xTo, yFrom);
    if (crease) {
      flags[x.t]! |= FLAG.crease(x.i);
      flags[y.t]! |= FLAG.crease(y.i);
    }
  }

  for (let t = 0; t < triCount; t++) {
    if (smooth[t]) flags[t]! |= FLAG.smooth;
    const tag = tags[t]!;
    if (tag > FLAG.lineSetMask) throw new Error(`line set tag ${tag} out of range (max 255)`);
    flags[t]! |= tag << FLAG.lineSetShift;
  }

  return { adj, flags, faceNormals };
}

export const triangleCountOf = (topo: Topology) => topo.flags.length;

/**
 * Concatenate per-mesh topologies in the order their meshes were merged. Adjacency indices are
 * rebased; nothing is welded across meshes. `lineSetOffsets[k]`, if given, is added to mesh k's
 * non-zero line-set tags (local tags → a merged line-set table).
 */
export function mergeTopologies(
  topologies: readonly Topology[],
  lineSetOffsets?: readonly number[],
): Topology {
  const total = topologies.reduce((sum, topo) => sum + triangleCountOf(topo), 0);
  const out: Topology = {
    adj: new Uint32Array(total * 3),
    flags: new Uint32Array(total),
    faceNormals: new Float32Array(total * 3),
  };
  let t = 0;
  topologies.forEach((topo, k) => {
    const count = triangleCountOf(topo);
    for (let j = 0; j < count * 3; j++) {
      const a = topo.adj[j]!;
      out.adj[t * 3 + j] = a === NO_NEIGHBOUR ? NO_NEIGHBOUR : a + t;
    }
    const shift = lineSetOffsets?.[k] ?? 0;
    for (let j = 0; j < count; j++) {
      const f = topo.flags[j]!;
      const tag = (f >>> FLAG.lineSetShift) & FLAG.lineSetMask;
      if (tag === 0 || shift === 0) {
        out.flags[t + j] = f;
        continue;
      }
      const next = tag + shift;
      if (next > FLAG.lineSetMask) throw new Error(`line set ${next} out of range (max 255)`);
      out.flags[t + j] = (f & ~(FLAG.lineSetMask << FLAG.lineSetShift)) | (next << FLAG.lineSetShift);
    }
    out.faceNormals.set(topo.faceNormals, t * 3);
    t += count;
  });
  return out;
}
