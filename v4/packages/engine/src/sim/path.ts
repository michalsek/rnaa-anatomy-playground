/**
 * Paths for things that ride belts (E4): the belt frame (s along the belt, c across it, z up)
 * and the stadium loop a belt surface follows round its two drums (v2
 * `parts/conveyor/conveyor.mjs` CONVEYOR.frame / CONVEYOR.path). Plain TS, no allocation in the
 * per-step calls (they write into an `out` object).
 */
import type { V3 } from './ports.ts';

export type BeltAxis = 'x' | 'y';

/**
 * A belt frame in a machine's local space: s along `axis`, c across (+c toward the viewer: +y
 * for an x belt, +x for a y belt), z up. Note the y frame is a reflection of the x frame (as in
 * v2), so turned parts are placed by direction vectors, not by one rotation.
 */
export interface BeltFrame {
  readonly axis: BeltAxis;
  readonly sV: V3;
  readonly cV: V3;
  /** The local point at (s, c, z); writes `out` when given. */
  w(s: number, c: number, z: number, out?: V3): V3;
}

export function beltFrame(axis: BeltAxis): BeltFrame {
  const y = axis === 'y';
  return {
    axis,
    sV: y ? [0, 1, 0] : [1, 0, 0],
    cV: y ? [1, 0, 0] : [0, 1, 0],
    w(s, c, z, out = [0, 0, 0]) {
      out[0] = y ? c : s;
      out[1] = y ? s : c;
      out[2] = z;
      return out;
    },
  };
}

export type Run = 'top' | 'head' | 'bottom' | 'tail';

/** A point on the loop: belt coordinates, the outward normal and the travel tangent (in s, z). */
export interface PathPoint {
  run: Run;
  s: number;
  z: number;
  ns: number;
  nz: number;
  ts: number;
  tz: number;
}

export interface Stadium {
  /** Loop length at radius R. */
  readonly total: number;
  readonly L: number;
  readonly R: number;
  readonly zc: number;
  readonly dir: 1 | -1;
  /** s of the head drum (where the top run goes round), and of the tail drum. */
  readonly sHead: number;
  readonly sTail: number;
  /** Arc length at which the top run ends (the head wrap starts). */
  readonly uHead: number;
  /** Arc length at which the bottom run starts. */
  readonly uHeadEnd: number;
  /**
   * The point at arc length u (wrapped), measured from the tail tangent on the top run along the
   * travel, at radius r (default R) from the drum axes: v2 `CONVEYOR.path(D).at`.
   */
  at(u: number, r?: number, out?: PathPoint): PathPoint;
}

export const pathPoint = (): PathPoint => ({ run: 'top', s: 0, z: 0, ns: 0, nz: 1, ts: 1, tz: 0 });

/** The loop round two drums `L` apart (s = 0 and s = L), radius R, axes at height zc. */
export function stadium(o: { L: number; R: number; zc: number; dir: 1 | -1 }): Stadium {
  const { L, R, zc, dir } = o;
  const total = 2 * L + 2 * Math.PI * R;
  const sHead = dir > 0 ? L : 0;
  const sTail = dir > 0 ? 0 : L;
  return {
    total,
    L,
    R,
    zc,
    dir,
    sHead,
    sTail,
    uHead: L,
    uHeadEnd: L + Math.PI * R,
    at(u0, r = R, out = pathPoint()) {
      let u = ((u0 % total) + total) % total;
      if (u < L) {
        out.run = 'top';
        out.s = sTail + dir * u;
        out.z = zc + r;
        out.ns = 0;
        out.nz = 1;
        out.ts = dir;
        out.tz = 0;
        return out;
      }
      u -= L;
      if (u < Math.PI * R) {
        const th = Math.PI / 2 - dir * (u / R);
        out.run = 'head';
        out.s = sHead + r * Math.cos(th);
        out.z = zc + r * Math.sin(th);
        out.ns = Math.cos(th);
        out.nz = Math.sin(th);
        out.ts = dir * Math.sin(th);
        out.tz = -dir * Math.cos(th);
        return out;
      }
      u -= Math.PI * R;
      if (u < L) {
        out.run = 'bottom';
        out.s = sHead - dir * u;
        out.z = zc - r;
        out.ns = 0;
        out.nz = -1;
        out.ts = -dir;
        out.tz = 0;
        return out;
      }
      u -= L;
      const th = -Math.PI / 2 - dir * (u / R);
      out.run = 'tail';
      out.s = sTail + r * Math.cos(th);
      out.z = zc + r * Math.sin(th);
      out.ns = Math.cos(th);
      out.nz = Math.sin(th);
      out.ts = dir * Math.sin(th);
      out.tz = -dir * Math.cos(th);
      return out;
    },
  };
}

/**
 * The angle that turns a part's local z onto the outward normal (ns, nz) of a belt frame: the
 * pool's pitch on an x belt (about y), its roll on a y belt (about x). A part turned end for end
 * (yaw ≈ π) needs the opposite angle: pass `yawSign` = sign(cos yaw).
 */
export function tilt(axis: BeltAxis, ns: number, nz: number, yawSign = 1): number {
  return yawSign * (axis === 'x' ? Math.atan2(ns, nz) : Math.atan2(-ns, nz));
}
