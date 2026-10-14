/**
 * A conveyor belt band: a closed loop of thickness `thickness` round two drums `L` apart (the
 * stadium of `sim/path.ts`), `across` wide. u runs along the travel exactly as the sim's arc
 * length (u = arc / total, from the tail tangent on the top run), so a UV line set on it are the
 * belt's slats, and a per-instance u shift (E1) scrolls them with the belt.
 *
 * Built in the machine's local frame from belt coordinates (s, c, z): an `x` belt maps s → x,
 * c → y; a `y` belt s → y, c → x (a reflection, as v2's frame; windings are fixed per face).
 */
import { type Vec3, MeshBuilder } from './mesh.ts';
import type { Mesh } from './mesh.ts';

export interface BandSpec {
  axis: 'x' | 'y';
  dir: 1 | -1;
  /** Drum centre to drum centre (drums at s = 0 and s = L). */
  L: number;
  /** Outer radius at the drums, belt thickness, and the belt's width (across the travel). */
  R: number;
  thickness: number;
  across: number;
  /** Height of the drum axes. */
  zc: number;
  /** Segments per half turn on each wrap (default ≈ one per 1.2 units of arc). */
  steps?: number;
}

const sub = (a: Vec3, b: Vec3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** `tags`: the line-set tag (1-based, 0 = none) of the outer face and of the inner face. */
export function band(spec: BandSpec, tags: { outer: number; inner: number } = { outer: 0, inner: 0 }): Mesh {
  const { axis, dir, L, R, thickness, across, zc } = spec;
  const r = R - thickness;
  if (!(r > 0)) throw new Error('band: thickness must be below the radius');
  const n = spec.steps ?? Math.max(8, Math.ceil((Math.PI * R) / 1.2));
  const total = 2 * L + 2 * Math.PI * R;
  const sHead = dir > 0 ? L : 0;
  const sTail = dir > 0 ? 0 : L;
  const w = (s: number, c: number, z: number): Vec3 => (axis === 'y' ? [c, s, z] : [s, c, z]);
  const sV: Vec3 = axis === 'y' ? [0, 1, 0] : [1, 0, 0];
  const cV: Vec3 = axis === 'y' ? [1, 0, 0] : [0, 1, 0];

  // Samples along the loop: arc length u, (s, z) on the drum-axis circle direction, the normal,
  // and whether the segment that starts here is curved.
  interface Sample {
    u: number;
    s: number;
    ns: number;
    nz: number;
    wrap: boolean;
    /** Circle centre s (on runs: the point's own s). */
    sc: number;
  }
  const samples: Sample[] = [];
  const run = (u: number, s: number, nz: number) => samples.push({ u, s, ns: 0, nz, wrap: false, sc: s });
  const wrapAt = (u0: number, sCentre: number, th0: number) => {
    for (let j = 0; j < n; j++) {
      const th = th0 - dir * Math.PI * (j / n);
      samples.push({ u: u0 + (Math.PI * R * j) / n, s: sCentre, ns: Math.cos(th), nz: Math.sin(th), wrap: true, sc: sCentre });
    }
  };
  run(0, sTail, 1);
  wrapAt(L, sHead, Math.PI / 2);
  run(L + Math.PI * R, sHead, -1);
  wrapAt(2 * L + Math.PI * R, sTail, -Math.PI / 2);
  // Close the loop with u = total at the start point (separate vertices: u must not wrap mid-quad).
  samples.push({ ...samples[0]!, u: total });

  const point = (smp: Sample, rad: number, c: number): Vec3 => w(smp.sc + smp.ns * rad, c, zc + smp.nz * rad);
  const normalOf = (smp: Sample, sign: number): Vec3 => [
    sign * sV[0] * smp.ns,
    sign * sV[1] * smp.ns,
    sign * smp.nz,
  ];

  const b = new MeshBuilder();
  const half = across / 2;
  /** A quad a-b-c-d whose winding is made CCW seen from the side `out` points to. */
  const quad = (pa: Vec3, pb: Vec3, pc: Vec3, pd: Vec3, na: Vec3[], uvs: [number, number][], out: Vec3) => {
    const ok = dot(cross(sub(pb, pa), sub(pc, pa)), out) >= 0;
    const v = [
      b.vertex(pa, na[0]!, uvs[0]),
      b.vertex(pb, na[1]!, uvs[1]),
      b.vertex(pc, na[2]!, uvs[2]),
      b.vertex(pd, na[3]!, uvs[3]),
    ];
    if (ok) b.quad(v[0]!, v[1]!, v[2]!, v[3]!);
    else b.quad(v[0]!, v[3]!, v[2]!, v[1]!);
  };

  for (let i = 0; i + 1 < samples.length; i++) {
    const A = samples[i]!;
    const Bs = samples[i + 1]!;
    const ua = A.u / total;
    const ub = Bs.u / total;
    b.smooth(A.wrap);
    // Outer face.
    b.tag(tags.outer);
    const nA = normalOf(A, 1);
    const nB = normalOf(Bs, 1);
    const mid: Vec3 = [(nA[0] + nB[0]) / 2, (nA[1] + nB[1]) / 2, (nA[2] + nB[2]) / 2];
    quad(point(A, R, half), point(A, R, -half), point(Bs, R, -half), point(Bs, R, half), [nA, nA, nB, nB], [[ua, 1], [ua, 0], [ub, 0], [ub, 1]], mid);
    // Inner face.
    b.tag(tags.inner);
    const iA = normalOf(A, -1);
    const iB = normalOf(Bs, -1);
    const imid: Vec3 = [-mid[0], -mid[1], -mid[2]];
    quad(point(A, r, half), point(A, r, -half), point(Bs, r, -half), point(Bs, r, half), [iA, iA, iB, iB], [[ua, 1], [ua, 0], [ub, 0], [ub, 1]], imid);
    // Side faces (flat).
    b.tag(0);
    b.smooth(false);
    for (const side of [-1, 1]) {
      const sn: Vec3 = [cV[0] * side, cV[1] * side, cV[2] * side];
      const c = side * half;
      quad(point(A, R, c), point(A, r, c), point(Bs, r, c), point(Bs, R, c), [sn, sn, sn, sn], [[ua, 0], [ua, 0], [ub, 0], [ub, 0]], sn);
    }
  }
  return b.build();
}
