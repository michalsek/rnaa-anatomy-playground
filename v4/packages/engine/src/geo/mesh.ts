/**
 * Mesh format for generators: indexed triangles with per-vertex position, normal and part id.
 * The part id indexes the renderer's part table (transform + material), so moving parts need
 * no geometry rebuild and the whole scene can be one merged buffer.
 */
export interface Mesh {
  /** xyz per vertex. */
  positions: Float32Array;
  /** xyz per vertex, unit length. */
  normals: Float32Array;
  /** Part id per vertex. */
  parts: Uint32Array;
  indices: Uint32Array;
}

export const vertexCount = (mesh: Mesh) => mesh.positions.length / 3;

/** Builder used by the generators. */
export class MeshBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private indices: number[] = [];

  readonly part: number;

  constructor(part: number) {
    this.part = part;
  }

  vertex(p: readonly [number, number, number], n: readonly [number, number, number]): number {
    this.positions.push(p[0], p[1], p[2]);
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    this.normals.push(n[0] / len, n[1] / len, n[2] / len);
    return this.positions.length / 3 - 1;
  }

  triangle(a: number, b: number, c: number) {
    this.indices.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number) {
    this.indices.push(a, b, c, a, c, d);
  }

  build(): Mesh {
    const count = this.positions.length / 3;
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      parts: new Uint32Array(count).fill(this.part),
      indices: new Uint32Array(this.indices),
    };
  }
}

/** Concatenate meshes into one (indices rebased). */
export function mergeMeshes(meshes: readonly Mesh[]): Mesh {
  const vCount = meshes.reduce((sum, m) => sum + vertexCount(m), 0);
  const iCount = meshes.reduce((sum, m) => sum + m.indices.length, 0);
  const out: Mesh = {
    positions: new Float32Array(vCount * 3),
    normals: new Float32Array(vCount * 3),
    parts: new Uint32Array(vCount),
    indices: new Uint32Array(iCount),
  };
  let v = 0;
  let i = 0;
  for (const m of meshes) {
    out.positions.set(m.positions, v * 3);
    out.normals.set(m.normals, v * 3);
    out.parts.set(m.parts, v);
    for (let k = 0; k < m.indices.length; k++) out.indices[i + k] = m.indices[k]! + v;
    v += vertexCount(m);
    i += m.indices.length;
  }
  return out;
}
