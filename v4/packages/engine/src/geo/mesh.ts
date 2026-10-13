/**
 * Mesh format for generators: indexed triangles with per-vertex position, normal, uv and part
 * id, plus per-triangle line-set tags and forced line edges (`marks`). The part id indexes the
 * renderer's part table (transform + material + line tones), so moving parts need no geometry
 * rebuild and the whole scene can be one merged buffer.
 *
 * Winding: counter-clockwise seen from outside (the kit's mirrored projection shows it CW).
 */
export interface Mesh {
  /** xyz per vertex. */
  positions: Float32Array;
  /** xyz per vertex, unit length. */
  normals: Float32Array;
  /** uv per vertex: generators put the around-the-axis coordinate in u (0..1). */
  uvs: Float32Array;
  /** Part id per vertex. */
  parts: Uint32Array;
  indices: Uint32Array;
  /** UV line-set id per triangle (1-based; 0 = none). */
  tags: Uint32Array;
  /** Vertex-index pairs of edges that must be drawn as lines (e.g. a ring on a smooth face). */
  marks: Uint32Array;
  /**
   * Per triangle: the other half of its quad (−1 = none). In-face lines are drawn across the
   * whole quad, or a long thin quad's diagonal would cut notches into its edge lines.
   */
  partners: Int32Array;
}

export type Vec3 = readonly [number, number, number];

export const vertexCount = (mesh: Mesh) => mesh.positions.length / 3;
export const triangleCount = (mesh: Mesh) => mesh.indices.length / 3;

/** Triangles with a smaller area are dropped (e.g. the collapsed ring at a lathe's axis). */
const MIN_AREA = 1e-12;

/** Builder used by the generators. */
export class MeshBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private indices: number[] = [];
  private tags: number[] = [];
  private marks: number[] = [];
  private partners: number[] = [];
  private currentTag = 0;

  readonly part: number;

  constructor(part: number) {
    this.part = part;
  }

  vertex(p: Vec3, n: Vec3, uv: readonly [number, number] = [0, 0]): number {
    this.positions.push(p[0], p[1], p[2]);
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    this.normals.push(n[0] / len, n[1] / len, n[2] / len);
    this.uvs.push(uv[0], uv[1]);
    return this.positions.length / 3 - 1;
  }

  /** Line set applied to the triangles that follow (0 = none). */
  tag(set: number) {
    this.currentTag = set;
  }

  /** Force the edge (a, b) to be drawn as a crease-style line. */
  mark(a: number, b: number) {
    this.marks.push(a, b);
  }

  /** Adds a triangle and returns its index, or −1 if it was too small to keep. */
  triangle(a: number, b: number, c: number): number {
    const P = this.positions;
    const e1 = [P[b * 3]! - P[a * 3]!, P[b * 3 + 1]! - P[a * 3 + 1]!, P[b * 3 + 2]! - P[a * 3 + 2]!];
    const e2 = [P[c * 3]! - P[a * 3]!, P[c * 3 + 1]! - P[a * 3 + 1]!, P[c * 3 + 2]! - P[a * 3 + 2]!];
    const area =
      Math.hypot(
        e1[1]! * e2[2]! - e1[2]! * e2[1]!,
        e1[2]! * e2[0]! - e1[0]! * e2[2]!,
        e1[0]! * e2[1]! - e1[1]! * e2[0]!,
      ) / 2;
    if (area < MIN_AREA) return -1;
    this.indices.push(a, b, c);
    this.tags.push(this.currentTag);
    this.partners.push(-1);
    return this.tags.length - 1;
  }

  quad(a: number, b: number, c: number, d: number) {
    const first = this.triangle(a, b, c);
    const second = this.triangle(a, c, d);
    if (first >= 0 && second >= 0) {
      this.partners[first] = second;
      this.partners[second] = first;
    }
  }

  build(): Mesh {
    const count = this.positions.length / 3;
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      uvs: new Float32Array(this.uvs),
      parts: new Uint32Array(count).fill(this.part),
      indices: new Uint32Array(this.indices),
      tags: new Uint32Array(this.tags),
      marks: new Uint32Array(this.marks),
      partners: new Int32Array(this.partners),
    };
  }
}

/** Concatenate meshes into one (indices and marks rebased). */
export function mergeMeshes(meshes: readonly Mesh[]): Mesh {
  const sum = (f: (m: Mesh) => number) => meshes.reduce((total, m) => total + f(m), 0);
  const out: Mesh = {
    positions: new Float32Array(sum((m) => m.positions.length)),
    normals: new Float32Array(sum((m) => m.normals.length)),
    uvs: new Float32Array(sum((m) => m.uvs.length)),
    parts: new Uint32Array(sum((m) => m.parts.length)),
    indices: new Uint32Array(sum((m) => m.indices.length)),
    tags: new Uint32Array(sum((m) => m.tags.length)),
    marks: new Uint32Array(sum((m) => m.marks.length)),
    partners: new Int32Array(sum((m) => m.partners.length)),
  };
  let v = 0;
  let i = 0;
  let t = 0;
  let k = 0;
  for (const m of meshes) {
    out.positions.set(m.positions, v * 3);
    out.normals.set(m.normals, v * 3);
    out.uvs.set(m.uvs, v * 2);
    out.parts.set(m.parts, v);
    for (let j = 0; j < m.indices.length; j++) out.indices[i + j] = m.indices[j]! + v;
    out.tags.set(m.tags, t);
    for (let j = 0; j < m.marks.length; j++) out.marks[k + j] = m.marks[j]! + v;
    for (let j = 0; j < m.partners.length; j++) {
      const partner = m.partners[j]!;
      out.partners[t + j] = partner < 0 ? -1 : partner + t;
    }
    v += vertexCount(m);
    i += m.indices.length;
    t += m.tags.length;
    k += m.marks.length;
  }
  return out;
}
