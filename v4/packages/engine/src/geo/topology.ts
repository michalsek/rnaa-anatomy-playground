/**
 * Triangle adjacency and edge flags for the in-face line shader.
 *
 * Edge i of a triangle is the one opposite corner i: edge 0 = (v1, v2), edge 1 = (v2, v0),
 * edge 2 = (v0, v1). Vertices are welded by quantised position within one mesh, so the
 * duplicated vertices of a seam or a sharp knot still connect. Topology is built per prototype
 * mesh; the scene store concatenates prototypes (rebasing indices), so separate meshes (even of
 * one part) never weld.
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
  // Quantised positions hash into numeric buckets (string keys are slow on Hermes); each bucket
  // lists weld ids, checked against their quantised coordinates.
  const vertexTotal = P.length / 3;
  const weld = new Uint32Array(vertexTotal);
  const qs = new Int32Array(vertexTotal * 3);
  const buckets = new Map<number, number[]>();
  let welds = 0;
  for (let v = 0; v < vertexTotal; v++) {
    const q0 = Math.round(P[v * 3]! / QUANTUM);
    const q1 = Math.round(P[v * 3 + 1]! / QUANTUM);
    const q2 = Math.round(P[v * 3 + 2]! / QUANTUM);
    const h = Math.imul(q0, 73856093) ^ Math.imul(q1, 19349663) ^ Math.imul(q2, 83492791);
    let list = buckets.get(h);
    let id = -1;
    if (list) {
      for (const w of list) {
        if (qs[w * 3] === q0 && qs[w * 3 + 1] === q1 && qs[w * 3 + 2] === q2) {
          id = w;
          break;
        }
      }
    } else {
      list = [];
      buckets.set(h, list);
    }
    if (id < 0) {
      id = welds++;
      qs[id * 3] = q0;
      qs[id * 3 + 1] = q1;
      qs[id * 3 + 2] = q2;
      list.push(id);
    }
    weld[v] = id;
  }
  /** Undirected edge key: both weld ids in one exact number (ids stay far below 2^26). */
  const edgeKey = (a: number, b: number) => {
    const wa = weld[a]!;
    const wb = weld[b]!;
    return wa < wb ? wa * 67108864 + wb : wb * 67108864 + wa;
  };
  const marked = new Set<number>();
  for (let k = 0; k < marks.length; k += 2) marked.add(edgeKey(marks[k]!, marks[k + 1]!));

  // ---- face normals ----------------------------------------------------------------------
  const faceNormals = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3]! * 3;
    const b = indices[t * 3 + 1]! * 3;
    const c = indices[t * 3 + 2]! * 3;
    const e1x = P[b]! - P[a]!;
    const e1y = P[b + 1]! - P[a + 1]!;
    const e1z = P[b + 2]! - P[a + 2]!;
    const e2x = P[c]! - P[a]!;
    const e2y = P[c + 1]! - P[a + 1]!;
    const e2z = P[c + 2]! - P[a + 2]!;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    faceNormals[t * 3] = nx / len;
    faceNormals[t * 3 + 1] = ny / len;
    faceNormals[t * 3 + 2] = nz / len;
  }

  // ---- adjacency -------------------------------------------------------------------------
  // Half-edge h = 3t + i is edge i of triangle t (from corner i+1 to corner i+2). Each
  // undirected edge remembers its first half-edge; the second one pairs with it.
  const corner = (t: number, k: number) => indices[t * 3 + (k % 3)]!;
  const firstUse = new Map<number, number>();
  const twin = new Int32Array(triCount * 3).fill(-1);
  const edgeName = (key: number) => `${Math.floor(key / 67108864)}_${key % 67108864}`;
  for (let h = 0; h < triCount * 3; h++) {
    const t = (h / 3) | 0;
    const i = h - t * 3;
    const key = edgeKey(corner(t, i + 1), corner(t, i + 2));
    const other = firstUse.get(key);
    if (other === undefined) {
      firstUse.set(key, h);
    } else if (twin[other] === -1) {
      twin[other] = h;
      twin[h] = other;
    } else {
      throw new Error(`non-manifold edge ${edgeName(key)}: 3+ triangles`);
    }
  }

  const adj = new Uint32Array(triCount * 3).fill(NO_NEIGHBOUR);
  const flags = new Uint32Array(triCount);
  const sameNormal = (a: number, b: number) =>
    N[a * 3]! * N[b * 3]! + N[a * 3 + 1]! * N[b * 3 + 1]! + N[a * 3 + 2]! * N[b * 3 + 2]! >=
    COS_1DEG;

  for (let h = 0; h < triCount * 3; h++) {
    const xt = (h / 3) | 0;
    const xi = h - xt * 3;
    const g = twin[h]!;
    if (g < 0) {
      flags[xt]! |= FLAG.boundary(xi);
      continue;
    }
    if (g < h) continue; // each pair once
    const yt = (g / 3) | 0;
    const yi = g - yt * 3;
    const xFrom = corner(xt, xi + 1);
    const xTo = corner(xt, xi + 2);
    const yFrom = corner(yt, yi + 1);
    const yTo = corner(yt, yi + 2);
    if (weld[xFrom] === weld[yFrom]) {
      throw new Error(`inconsistent winding at edge ${edgeName(edgeKey(xFrom, xTo))} (triangles ${xt}, ${yt})`);
    }
    adj[h] = yt;
    adj[g] = xt;
    // Endpoints pair up by weld id: x's `from` is y's `to` and the other way around.
    const crease = (marked.size > 0 && marked.has(edgeKey(xFrom, xTo))) || !sameNormal(xFrom, yTo) || !sameNormal(xTo, yFrom);
    if (crease) {
      flags[xt]! |= FLAG.crease(xi);
      flags[yt]! |= FLAG.crease(yi);
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
