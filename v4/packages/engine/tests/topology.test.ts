import { describe, expect, it } from 'vitest';
import { KIT_ELEVATION, KIT_YAW, basisOf } from '../src/camera/camera.ts';
import { box } from '../src/geo/box.ts';
import { lathe } from '../src/geo/lathe.ts';
import { type Mesh, triangleCount } from '../src/geo/mesh.ts';
import { FLAG, NO_NEIGHBOUR, type Topology, buildTopology } from '../src/geo/topology.ts';
import { tube } from '../src/geo/tube.ts';
import { ROTOR_PROFILE } from '../src/scene/m1.ts';
import { EDGE_OUTLINE, edgeMode } from '../src/shading/lines.ts';

const countBits = (topo: Topology, bit: (i: number) => number) => {
  let n = 0;
  for (const f of topo.flags) for (let i = 0; i < 3; i++) if (f & bit(i)) n++;
  return n;
};

const signedVolume = (mesh: Mesh) => {
  const P = mesh.positions;
  let v = 0;
  for (let t = 0; t < triangleCount(mesh); t++) {
    const [a, b, c] = [0, 1, 2].map((k) => mesh.indices[t * 3 + k]! * 3);
    const p = (o: number, k: number) => P[o! + k]!;
    v +=
      p(a!, 0) * (p(b!, 1) * p(c!, 2) - p(b!, 2) * p(c!, 1)) -
      p(a!, 1) * (p(b!, 0) * p(c!, 2) - p(b!, 2) * p(c!, 0)) +
      p(a!, 2) * (p(b!, 0) * p(c!, 1) - p(b!, 1) * p(c!, 0));
  }
  return v / 6;
};

/** Outline edges at the kit view, as welded endpoint pairs (CPU run of the shader's edgeMode). */
const outlineEdges = (mesh: Mesh, topo: Topology) => {
  const toward = basisOf(KIT_YAW, KIT_ELEVATION).toward;
  const N = topo.faceNormals;
  const facing = (t: number) =>
    N[t * 3]! * toward[0] + N[t * 3 + 1]! * toward[1] + N[t * 3 + 2]! * toward[2];
  const key = (v: number) =>
    [0, 1, 2].map((k) => Math.round(mesh.positions[v * 3 + k]! * 1e4)).join(',');
  const edges: [string, string][] = [];
  for (let t = 0; t < triangleCount(mesh); t++) {
    for (let i = 0; i < 3; i++) {
      const adj = topo.adj[t * 3 + i]!;
      const mode = edgeMode(facing(t), adj === NO_NEIGHBOUR ? -1 : facing(adj), topo.flags[t]!, i);
      if (mode !== EDGE_OUTLINE) continue;
      const a = mesh.indices[t * 3 + ((i + 1) % 3)]!;
      const b = mesh.indices[t * 3 + ((i + 2) % 3)]!;
      edges.push([key(a), key(b)]);
    }
  }
  return edges;
};

const degrees = (edges: [string, string][]) => {
  const degree = new Map<string, number>();
  for (const [a, b] of edges) {
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }
  return degree;
};

describe('topology', () => {
  it('box: 12 triangles, 18 edges, 12 creases, symmetric adjacency', () => {
    const mesh = box({ size: [2, 3, 4] });
    const topo = buildTopology(mesh);
    expect(triangleCount(mesh)).toBe(12);
    let halfEdges = 0;
    for (let t = 0; t < 12; t++) {
      for (let i = 0; i < 3; i++) {
        const u = topo.adj[t * 3 + i]!;
        expect(u).not.toBe(NO_NEIGHBOUR);
        expect([0, 1, 2].map((k) => topo.adj[u * 3 + k])).toContain(t);
        halfEdges++;
      }
    }
    expect(halfEdges / 2).toBe(18);
    expect(countBits(topo, FLAG.crease) / 2).toBe(12);
    expect(countBits(topo, FLAG.boundary)).toBe(0);
  });

  it('lathe: no degenerate triangles at the axis, closed, volume matches the solid', () => {
    const rotor = lathe({ profile: ROTOR_PROFILE, steps: 64 });
    const topo = buildTopology(rotor);
    expect(countBits(topo, FLAG.boundary)).toBe(0);
    for (let t = 0; t < triangleCount(rotor); t++) {
      const n = topo.faceNormals.subarray(t * 3, t * 3 + 3);
      expect(Math.hypot(n[0]!, n[1]!, n[2]!)).toBeCloseTo(1, 5);
    }
    // A cylinder of n facets is a prism: V = n/2 · sin(2π/n) · r² · h, exactly.
    const n = 48;
    const cylinder = lathe({ profile: [[0, 0], [2, 0], [2, 3], [0, 3]], steps: n });
    expect(countBits(buildTopology(cylinder), FLAG.boundary)).toBe(0);
    expect(signedVolume(cylinder)).toBeCloseTo((n / 2) * Math.sin((2 * Math.PI) / n) * 4 * 3, 4);
  });

  it('tube: closed with caps, open rims without', () => {
    const path: [number, number, number][] = [[0, 0, 0], [6, 0, 0], [6, 0, 6], [6, 6, 6]];
    const closed = tube({ path, radius: 0.9, sides: 16 });
    expect(countBits(buildTopology(closed), FLAG.boundary)).toBe(0);
    expect(signedVolume(closed)).toBeGreaterThan(0);
    const open = tube({ path, radius: 0.9, sides: 16, caps: [false, false] });
    expect(countBits(buildTopology(open), FLAG.boundary)).toBe(2 * 16);
  });

  it('smoothness is declared by the generator, at any step count', () => {
    // A 1° normal-vs-face guess misses this: at 256 steps the facets turn by only 1.4°.
    const cylinder = lathe({ profile: [[0, 0], [2, 0], [2, 3], [0, 3]], steps: 256 });
    const topo = buildTopology(cylinder);
    const smooth = topo.flags.filter((f) => f & FLAG.smooth).length;
    expect(smooth).toBe(2 * 256); // the side; the flat caps are not smooth
  });

  it('rejects a reversed lathe profile', () => {
    expect(() => lathe({ profile: [...ROTOR_PROFILE].reverse() })).toThrow(/reversed/);
  });
});

describe('silhouette (CPU run of the shader edgeMode)', () => {
  it('box at the kit view: 6 outline edges forming one closed hexagon', () => {
    const mesh = box({ size: [12, 12, 10] });
    const edges = outlineEdges(mesh, buildTopology(mesh));
    expect(edges).toHaveLength(6);
    const degree = degrees(edges);
    expect(degree.size).toBe(6);
    for (const n of degree.values()) expect(n).toBe(2);
  });

  it('lathe at the kit view: outline edges form closed loops', () => {
    const rotor = lathe({ profile: ROTOR_PROFILE, steps: 64 });
    const edges = outlineEdges(rotor, buildTopology(rotor));
    expect(edges.length).toBeGreaterThan(64);
    for (const n of degrees(edges).values()) expect(n % 2).toBe(0);
  });

  it('classifies edges: none, crease, boundary, silhouette, back face', () => {
    expect(edgeMode(0.5, 0.5, 0, 0)).toBe(0);
    expect(edgeMode(0.5, 0.5, FLAG.crease(1), 1)).toBe(1);
    expect(edgeMode(0.5, 0.5, FLAG.boundary(2), 2)).toBe(2);
    expect(edgeMode(0.5, -0.1, FLAG.crease(0), 0)).toBe(2);
    expect(edgeMode(-0.5, 0.5, FLAG.crease(0), 0)).toBe(0);
  });
});
