/**
 * Mesh format for generators: indexed triangles with per-vertex position, normal and uv, plus
 * per-triangle line-set tags, smoothness and quad partners, and forced line edges (`marks`).
 * A mesh is a prototype in its own model space; the scene store places copies of it (static
 * parts) or instances it (pools), so moving parts need no geometry rebuild.
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
  /** xyz per vertex: a tube's centreline direction (the tube tone rule's axis), else zero. */
  tangents: Float32Array;
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
  /**
   * Per triangle: 1 if the surface is curved there (its vertex normals interpolate across the
   * face), declared by the generator. The shader runs the smooth-contour term only on these.
   */
  smooth: Uint8Array;
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
  private tangents: number[] = [];
  private indices: number[] = [];
  private tags: number[] = [];
  private marks: number[] = [];
  private partners: number[] = [];
  private smoothFlags: number[] = [];
  private currentTag = 0;
  private currentSmooth = 0;

  vertex(p: Vec3, n: Vec3, uv: readonly [number, number] = [0, 0], tangent: Vec3 = [0, 0, 0]): number {
    this.positions.push(p[0], p[1], p[2]);
    this.tangents.push(tangent[0], tangent[1], tangent[2]);
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    this.normals.push(n[0] / len, n[1] / len, n[2] / len);
    this.uvs.push(uv[0], uv[1]);
    return this.positions.length / 3 - 1;
  }

  /** Line set applied to the triangles that follow (0 = none). */
  tag(set: number) {
    this.currentTag = set;
  }

  /** Whether the triangles that follow lie on a curved (smooth-shaded) surface. */
  smooth(on: boolean) {
    this.currentSmooth = on ? 1 : 0;
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
    this.smoothFlags.push(this.currentSmooth);
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
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      uvs: new Float32Array(this.uvs),
      tangents: new Float32Array(this.tangents),
      indices: new Uint32Array(this.indices),
      tags: new Uint32Array(this.tags),
      marks: new Uint32Array(this.marks),
      partners: new Int32Array(this.partners),
      smooth: new Uint8Array(this.smoothFlags),
    };
  }
}
