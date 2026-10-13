/**
 * Triangle adjacency and edge flags for the in-face line shader.
 *
 * Edge i of a triangle is the one opposite corner i: edge 0 = (v1, v2), edge 1 = (v2, v0),
 * edge 2 = (v0, v1). Vertices are welded by part and quantised position, so the duplicated
 * vertices of a seam or a sharp knot still connect, while touching parts never do.
 */
import { type Mesh, triangleCount } from './mesh.ts';

export const NO_NEIGHBOUR = 0xffffffff;

/** Triangle flag bits (shared with the shader). */
export const FLAG = {
  /** Bits 0-2: edge i is a crease (normals split, or a forced mark). */
  crease: (i: number) => 1 << i,
  /** Bits 3-5: edge i has no neighbour (an open mesh boundary). */
  boundary: (i: number) => 1 << (3 + i),
  /** Bit 6: the vertex normals are not the face normal (a curved surface). */
  smooth: 1 << 6,
  /** Bits 8-15: UV line set id (1-based; 0 = none). */
  lineSetShift: 8,
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
const COS_1DEG = Math.cos(Math.PI / 180);

export function buildTopology(mesh: Mesh): Topology {
  const { positions: P, normals: N, indices, parts, tags, marks } = mesh;
  const triCount = triangleCount(mesh);

  // ---- weld ------------------------------------------------------------------------------
  const weldIds = new Map<string, number>();
  const weld = new Uint32Array(P.length / 3);
  for (let v = 0; v < weld.length; v++) {
    const q = (k: number) => Math.round(P[v * 3 + k]! / QUANTUM);
    const key = `${parts[v]}:${q(0)},${q(1)},${q(2)}`;
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
    const fx = faceNormals[t * 3]!;
    const fy = faceNormals[t * 3 + 1]!;
    const fz = faceNormals[t * 3 + 2]!;
    for (let k = 0; k < 3; k++) {
      const v = corner(t, k);
      if (N[v * 3]! * fx + N[v * 3 + 1]! * fy + N[v * 3 + 2]! * fz < COS_1DEG) {
        flags[t]! |= FLAG.smooth;
        break;
      }
    }
    flags[t]! |= (tags[t]! & 0xff) << FLAG.lineSetShift;
  }

  return { adj, flags, faceNormals };
}

export const triangleCountOf = (topo: Topology) => topo.flags.length;
