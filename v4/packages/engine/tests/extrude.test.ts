import { describe, expect, it } from 'vitest';
import { extrude } from '../src/geo/extrude.ts';
import { type Mesh, triangleCount } from '../src/geo/mesh.ts';
import { FLAG, type Topology, buildTopology } from '../src/geo/topology.ts';

/** Crease edges as endpoint pairs (each edge counted once). */
const creases = (mesh: Mesh, topo: Topology) => {
  const out: [number[], number[]][] = [];
  for (let t = 0; t < triangleCount(mesh); t++) {
    for (let i = 0; i < 3; i++) {
      if (!(topo.flags[t]! & FLAG.crease(i))) continue;
      const a = mesh.indices[t * 3 + ((i + 1) % 3)]!;
      const b = mesh.indices[t * 3 + ((i + 2) % 3)]!;
      out.push([[...mesh.positions.subarray(a * 3, a * 3 + 3)], [...mesh.positions.subarray(b * 3, b * 3 + 3)]]);
    }
  }
  return out;
};
const boundaries = (topo: Topology) =>
  topo.flags.reduce((n, f) => n + [0, 1, 2].filter((i) => f & FLAG.boundary(i)).length, 0);

describe('extrude', () => {
  it('a rect box has 12 creases', () => {
    const mesh = extrude({ plan: { rect: [4, 2] }, height: 3 });
    const topo = buildTopology(mesh);
    expect(creases(mesh, topo).length / 2).toBe(12);
    expect(boundaries(topo)).toBe(0);
  });

  it('rounded corners have no vertical creases', () => {
    const mesh = extrude({ plan: { rect: [4, 2], r: 0.5 }, height: 3 });
    const edges = creases(mesh, buildTopology(mesh));
    expect(edges.length).toBeGreaterThan(0);
    for (const [a, b] of edges) expect(a[2]).toBeCloseTo(b[2]!, 6); // only the rims
  });

  it('a sector is closed and manifold', () => {
    for (const r0 of [0, 1.5]) {
      const mesh = extrude({ plan: { sector: { r0, r1: 3, a0: 20, a1: 250 } }, height: 1 });
      const topo = buildTopology(mesh); // throws on non-manifold edges or bad winding
      expect(boundaries(topo)).toBe(0);
    }
  });

  it('seams add marked rings', () => {
    const steps = 40;
    const mesh = extrude({ plan: { circle: 2, steps }, height: 4, seams: [1, 3] });
    const atSeam = creases(mesh, buildTopology(mesh)).filter(([a, b]) => a[2] === 1 && b[2] === 1);
    expect(atSeam.length / 2).toBe(steps);
  });
});
