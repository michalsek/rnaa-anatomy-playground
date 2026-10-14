import { describe, expect, it } from 'vitest';
import { band } from '../src/geo/band.ts';
import { buildGeo } from '../src/geo/spec.ts';
import { FLAG } from '../src/geo/topology.ts';
import { stadium } from '../src/sim/path.ts';

const spec = { axis: 'x', dir: -1, L: 120, R: 15, thickness: 1.2, across: 18, zc: 77 } as const;
const lines = { count: 163, phase: 0, first: 0, last: 162, majorEvery: 0, minor: 'lo', major: 'lo', width: 0.5, majorWidth: 0.5, fade: [0, 0] } as const;

describe('band (belt loop geometry)', () => {
  it('is closed, and its outer u is the sim path arc length', () => {
    const proto = buildGeo({ kind: 'band', ...spec, lines: { outer: lines } });
    const boundary = FLAG.boundary(0) | FLAG.boundary(1) | FLAG.boundary(2);
    expect(proto.topology.flags.some((f) => (f & boundary) !== 0)).toBe(false);
    expect(proto.lineSets).toHaveLength(1);
    const path = stadium({ L: spec.L, R: spec.R, zc: spec.zc, dir: spec.dir });
    const mesh = band(spec);
    const P = mesh.positions;
    const U = mesh.uvs;
    let checked = 0;
    for (let v = 0; v < P.length / 3; v++) {
      const x = P[v * 3]!;
      const z = P[v * 3 + 2]!;
      const r = Math.hypot(x - (x < spec.L / 2 ? 0 : spec.L), z - spec.zc);
      const onOuter = Math.abs(r - spec.R) < 1e-4 || (Math.abs(z - spec.zc) > spec.R - 1e-4 && Math.abs(Math.abs(z - spec.zc) - spec.R) < 1e-4);
      if (!onOuter) continue;
      const q = path.at(U[v * 2]! * path.total);
      expect(q.s).toBeCloseTo(x, 3);
      expect(q.z).toBeCloseTo(z, 3);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('winds outward on a y belt too (a reflected frame)', () => {
    const mesh = band({ ...spec, axis: 'y' });
    const P = mesh.positions;
    const N = mesh.normals;
    const I = mesh.indices;
    for (let t = 0; t < I.length / 3; t++) {
      const [a, b, c] = [I[t * 3]!, I[t * 3 + 1]!, I[t * 3 + 2]!];
      const e1 = [P[b * 3]! - P[a * 3]!, P[b * 3 + 1]! - P[a * 3 + 1]!, P[b * 3 + 2]! - P[a * 3 + 2]!];
      const e2 = [P[c * 3]! - P[a * 3]!, P[c * 3 + 1]! - P[a * 3 + 1]!, P[c * 3 + 2]! - P[a * 3 + 2]!];
      const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const vn = [N[a * 3]! + N[b * 3]! + N[c * 3]!, N[a * 3 + 1]! + N[b * 3 + 1]! + N[c * 3 + 1]!, N[a * 3 + 2]! + N[b * 3 + 2]! + N[c * 3 + 2]!];
      expect(n[0]! * vn[0]! + n[1]! * vn[1]! + n[2]! * vn[2]!).toBeGreaterThan(0);
    }
  });
});
