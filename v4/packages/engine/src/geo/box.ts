import { type Mesh, MeshBuilder } from './mesh.ts';

export interface BoxSpec {
  /** Centre of the box (model space). */
  center?: [number, number, number];
  /** Full extents along x, y, z. */
  size: [number, number, number];
  part: number;
}

/** Axis-aligned box with flat normals: 6 faces × 4 vertices, CCW seen from outside. */
export function box({ center = [0, 0, 0], size, part }: BoxSpec): Mesh {
  const b = new MeshBuilder(part);
  const h = size.map((s) => s / 2) as [number, number, number];
  // For each axis and sign: normal n and two in-face axes (u, v) with u × v = n.
  const faces: [number, 1 | -1][] = [
    [0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1],
  ];
  for (const [axis, sign] of faces) {
    const n: [number, number, number] = [0, 0, 0];
    n[axis] = sign;
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const corner = (su: number, sv: number): [number, number, number] => {
      const p: [number, number, number] = [...center];
      p[axis] += sign * h[axis];
      p[u] += su * h[u] * sign;
      p[v] += sv * h[v];
      return p;
    };
    const i0 = b.vertex(corner(-1, -1), n);
    const i1 = b.vertex(corner(1, -1), n);
    const i2 = b.vertex(corner(1, 1), n);
    const i3 = b.vertex(corner(-1, 1), n);
    b.quad(i0, i1, i2, i3);
  }
  return b.build();
}
