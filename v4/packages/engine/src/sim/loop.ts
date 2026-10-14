/**
 * The "loop" conveyor: the audio belt, the render loop (v2 `parts/conveyor/conveyor.mjs`
 * conveyorLoop, L752–939). A double-sided belt that never stops. Cleats every `cleatEvery` slats;
 * one cleat gap is one 128-frame render quantum. A parcel lands on a free cleat, rides the top
 * run, goes round the head drum and hangs under the bottom run from its cleat's bail, turns grey
 * (`spend` 0 → 1 over 0.6 s) once it passes the read point, rides round the tail, and on its next
 * pass under the head drum drops off as garbage (with the belt's velocity); its bail folds back
 * over 0.3 s.
 *
 * `quanta()` is the phase at the read point (the scanner); `phaseAt(u, ahead)` the phase of the
 * cleats at any point (the centrifuge syncs to the in point); `canTake(after)` answers whether a
 * free cleat will be under the in point for a parcel arriving `after` s from now (a sender that
 * asks first is never refused).
 *
 * Coordinates: the machine's local frame (origin = the belt centreline at s = 0, on the floor).
 */
import { log } from '#platform/env.ts';
import type { Clock, Machine } from './clock.ts';
import { PARCEL } from './conveyor.ts';
import { type Fall, createFall, fallAt } from './fall.ts';
import type { Item } from './items.ts';
import { type BeltAxis, type BeltFrame, type PathPoint, type Stadium, beltFrame, pathPoint, stadium, tilt } from './path.ts';
import { type Located, type OutPort, type Receiver, type V3, createOut } from './ports.ts';
import { RATES } from './rates.ts';

export interface LoopOptions {
  id: string;
  origin: V3;
  axis: BeltAxis;
  /** Travel of the top run (default −1). */
  dir?: 1 | -1;
  /** Drum centre to drum centre (≥ 110). */
  length: number;
  /** Belt surface height (≥ 2·drum + 22.2: hanging parcels clear the floor by 8). */
  top: number;
  /** Outer drum (wrap) radius (≥ 10, default 15). */
  drum?: number;
  width?: number;
  speed?: number;
  /** Slat spacing and slats per cleat. */
  pitch?: number;
  cleatEvery?: number;
  /** Distances along the belt: where parcels land, and the read point (lamp). */
  inAt?: number;
  readAt?: number;
  /** Drop spent parcels at the head drum (default true); grey them at the read point (true). */
  drop?: boolean;
  autoSpend?: boolean;
}

export interface LoopGeometry {
  axis: BeltAxis;
  dir: 1 | -1;
  L: number;
  T: number;
  W: number;
  BT: number;
  RW: number;
  RD: number;
  zc: number;
  speed: number;
  pitch: number;
  cleatEvery: number;
  nCleats: number;
  cleatGap: number;
  total: number;
  /** Cleat height, a hanging parcel's drop below its cleat. */
  CH: number;
  HOOK: number;
  inS: number;
  readS: number;
  /** Arc lengths of the in point, the bottom run's start (the drop) and the read point. */
  uIn: number;
  uHeadEnd: number;
  uRead: number;
  ports: { in: V3; drop: V3; read: V3 };
}

export interface LoopItem {
  item: Item;
  cleat: number;
  phase: 'fall' | 'ride';
  fall: Fall | null;
  lastU: number;
  /** 0 → 1: greyed (garbage) by the read. */
  spend: number;
  spending: boolean;
  /** Pose this step (origin = bottom centre in the item's frame, tilt about the cross axis), and its change. */
  p: V3;
  d: V3;
  tilt: number;
  dTilt: number;
  /** The bail's reach below the cleat (0 on the top run). */
  hook: number;
}

export interface Bail {
  cleat: number;
  t: number;
}

export interface Quanta {
  phase: number;
  period: number;
  count: number;
}

export interface Loop extends Machine, Located, Receiver {
  readonly geometry: LoopGeometry;
  readonly frame: BeltFrame;
  readonly path: Stadium;
  readonly outs: { drop: OutPort };
  readonly items: readonly LoopItem[];
  readonly bails: readonly Bail[];
  readonly travel: number;
  /** Parcels dropped, greyed, and taken without a free cleat in reach (a long bend). */
  readonly stats: { dropped: number; spent: number; late: number };
  /** Phase at the read point: 0 when a cleat is there, rising to 1 as the next arrives. */
  quanta(): Quanta;
  /** Phase of the cleats at arc length u, `ahead` seconds from now (0 = a cleat there). */
  phaseAt(u: number, ahead?: number): number;
  /** Will a free cleat be under the in point for a parcel arriving `after` s from now (+0.2 s fall)? */
  canTake(after?: number): boolean;
  /** Grey a parcel now (the scanner, with `autoSpend: false`). */
  spend(id: number): void;
  /** The slats' scroll as a fraction of the loop (the band's u shift), at t + acc. */
  uShift(): number;
  /** Cleat poses (base on the belt surface, tilt) at t + acc; returns the count. */
  cleats(cb: (j: number, x: number, y: number, z: number, tilt: number) => void): number;
  /** Parcel poses at t + acc (spend = the grey blend); returns the count. */
  poses(cb: (i: number, item: Item, spend: number, x: number, y: number, z: number, yaw: number, tilt: number) => void): number;
  /** Bail straps (two per hanging parcel, plus folding empty bails): base, tilt and length. */
  straps(cb: (i: number, x: number, y: number, z: number, tilt: number, len: number) => void): number;
}

const BT = 1.2;
const CH = 1.2;
const HOOK = 6;

const clampOpt = (id: string, name: string, value: number, least: number) => {
  if (value >= least) return value;
  log(`[sim] ${id}: ${name} ${value} raised to ${least}`);
  return least;
};
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function loopGeometry(o: LoopOptions): LoopGeometry {
  const axis = o.axis;
  const dir = o.dir ?? -1;
  const L = clampOpt(o.id, 'length', o.length, 110);
  const RW = clampOpt(o.id, 'drum', o.drum ?? 15, 10);
  const RD = RW - BT;
  const T = clampOpt(o.id, 'top', o.top, 2 * RW + CH + HOOK + PARCEL.h + 8);
  const W = clampOpt(o.id, 'width', o.width ?? 18, (axis === 'y' ? PARCEL.w : PARCEL.d) + 4);
  const zc = T - RW;
  const pitch = o.pitch ?? 3;
  const cleatEvery = o.cleatEvery ?? 6;
  const total = 2 * L + 2 * Math.PI * RW;
  const nCleats = Math.floor(total / (pitch * cleatEvery));
  const inS = o.inAt ?? (dir > 0 ? 12 : L - 12);
  const readS = o.readAt ?? L / 2;
  const sHead = dir > 0 ? L : 0;
  const uHeadEnd = L + Math.PI * RW;
  const f = beltFrame(axis);
  return {
    axis,
    dir,
    L,
    T,
    W,
    BT,
    RW,
    RD,
    zc,
    speed: o.speed ?? RATES.loopSpeed,
    pitch,
    cleatEvery,
    nCleats,
    cleatGap: total / nCleats,
    total,
    CH,
    HOOK,
    inS,
    readS,
    uIn: dir > 0 ? inS : L - inS,
    uHeadEnd,
    uRead: uHeadEnd + Math.abs(readS - sHead),
    ports: { in: f.w(inS, 0, T), drop: f.w(sHead, 0, zc - RW - CH - HOOK - PARCEL.h), read: f.w(readS, 0, zc - RW) },
  };
}

export function createLoop(clock: Readonly<Clock>, o: LoopOptions): Loop {
  const D = loopGeometry(o);
  const F = beltFrame(D.axis);
  const B = stadium({ L: D.L, R: D.RW, zc: D.zc, dir: D.dir });
  const { nCleats, cleatGap, speed, uIn, uRead, uHeadEnd } = D;
  const drop = o.drop ?? true;
  const autoSpend = o.autoSpend ?? true;
  const items: LoopItem[] = [];
  const bails: Bail[] = [];
  const taken: boolean[] = Array.from({ length: nCleats }, () => false);
  const stats = { dropped: 0, spent: 0, late: 0 };
  let travel = 0;
  const out = createOut(o, 'drop');

  const wrap = (u: number) => ((u % B.total) + B.total) % B.total;
  const cleatU = (k: number, tr = travel) => wrap(k * cleatGap + tr);
  // Scratch (no allocation per step).
  const q: PathPoint = pathPoint();
  const at: V3 = [0, 0, 0];
  const target: V3 = [0, 0, 0];
  /** Where something riding at u sits, `lift + h` out from the belt surface along the normal. */
  const place = (u: number, lift: number, h: number, outP: V3, point = q) => {
    B.at(u, B.R, point);
    F.w(point.s, 0, point.z, outP);
    const n = lift + h;
    outP[0] += F.sV[0] * point.ns * n;
    outP[1] += F.sV[1] * point.ns * n;
    outP[2] += point.nz * n;
    return outP;
  };
  const hookOf = (point: PathPoint) => HOOK * smooth(0.05, 0.95, -point.nz);
  const yawSign = (yaw: number) => (Math.cos(yaw) >= 0 ? 1 : -1);
  const wrapPi = (a: number) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));

  const loop: Loop = {
    id: o.id,
    origin: o.origin,
    geometry: D,
    frame: F,
    path: B,
    outs: { drop: out },
    items,
    bails,
    get travel() {
      return travel;
    },
    stats,
    canAccept: (lead = 0) => loop.canTake(lead),
    canTake(after = 0) {
      const t = travel + speed * (after + 0.2);
      for (let k = 0; k < nCleats; k++) {
        if (taken[k]) continue;
        const dd = uIn - cleatU(k, t);
        if (dd > -cleatGap * 0.5 && dd < cleatGap * 2.5) return true;
      }
      return false;
    },
    accept(item, from, v) {
      F.w(D.inS, 0, D.T + CH, target);
      const fall = createFall(from, v, target[2]);
      // The free cleat that will be nearest the landing point when the item gets there.
      let best = -1;
      let bestD = 1e9;
      for (let k = 0; k < nCleats; k++) {
        if (taken[k]) continue;
        const dd = uIn - cleatU(k, travel + speed * fall.dur);
        if (dd > -cleatGap * 0.5 && dd < cleatGap * 2.5 && Math.abs(dd) < bestD) {
          best = k;
          bestD = Math.abs(dd);
        }
      }
      if (best < 0) {
        // Nothing in reach (the sender didn't ask, or asked too early): the nearest free cleat
        // upstream; the fall bends further to it.
        for (let k = 0; k < nCleats; k++) {
          if (taken[k]) continue;
          const dd = wrap(uIn - cleatU(k, travel + speed * fall.dur));
          if (dd < bestD) {
            best = k;
            bestD = dd;
          }
        }
        if (best < 0) throw new Error(`${o.id}: belt full, parcel ${item.id} refused`);
        stats.late++;
      }
      taken[best] = true;
      items.push({
        item,
        cleat: best,
        phase: 'fall',
        fall,
        lastU: cleatU(best),
        spend: item.kind === 'garbage' ? 1 : 0,
        spending: false,
        p: [from[0], from[1], from[2]],
        d: [v[0] * clock.H, v[1] * clock.H, v[2] * clock.H],
        tilt: 0,
        dTilt: 0,
        hook: 0,
      });
    },
    step(h) {
      travel += speed * h;
      for (let i = bails.length - 1; i >= 0; i--) {
        const b = bails[i]!;
        b.t += h / 0.3;
        if (b.t >= 1) bails.splice(i, 1);
      }
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i]!;
        const u = cleatU(it.cleat);
        if (it.phase === 'fall') {
          const f = it.fall!;
          f.tau += h / f.dur;
          place(u, CH, 0, target);
          fallAt(f, target, at);
          it.d[0] = at[0] - it.p[0];
          it.d[1] = at[1] - it.p[1];
          it.d[2] = at[2] - it.p[2];
          it.p[0] = at[0];
          it.p[1] = at[1];
          it.p[2] = at[2];
          relaxYaw(it.item, h);
          if (f.tau >= 1) {
            it.phase = 'ride';
            it.fall = null;
            it.lastU = u;
          }
          continue;
        }
        // Station bookkeeping (u only grows, modulo the loop).
        const prev = it.lastU;
        B.at(u, B.R, q);
        const hook = hookOf(q);
        if (drop && it.spend >= 1 && passed(prev, u, uHeadEnd)) {
          // Released at the bottom of the head drum with the belt's velocity; the bail folds back.
          items.splice(i, 1);
          taken[it.cleat] = false;
          bails.push({ cleat: it.cleat, t: 0 });
          stats.dropped++;
          // The parcel's bottom (it hangs upside down in its frame: base + n·(CH + hook) − its height).
          place(u, CH, hook, at);
          const nz = q.nz;
          const from: V3 = [at[0], at[1], at[2] + (nz < 0 ? -PARCEL.h : 0)];
          const v: V3 = [F.sV[0] * q.ts * speed, F.sV[1] * q.ts * speed, q.tz * speed];
          it.item.was = it.item.kind;
          it.item.kind = 'garbage';
          out.send(it.item, from, v);
          continue;
        }
        if (autoSpend && !it.spending && it.spend < 1 && passed(prev, u, uRead)) it.spending = true;
        if (it.spending) {
          it.spend = Math.min(1, it.spend + h / 0.6);
          if (it.spend >= 1) {
            it.spending = false;
            stats.spent++;
          }
        }
        it.lastU = u;
        it.hook = hook;
        relaxYaw(it.item, h);
        place(u, CH, hook, at);
        const tl = tilt(D.axis, q.ns, q.nz, yawSign(it.item.yaw));
        it.d[0] = at[0] - it.p[0];
        it.d[1] = at[1] - it.p[1];
        it.d[2] = at[2] - it.p[2];
        it.dTilt = wrapPi(tl - it.tilt);
        it.p[0] = at[0];
        it.p[1] = at[1];
        it.p[2] = at[2];
        it.tilt = tl;
      }
    },
    alive: () => items.length,
    quanta() {
      const rel = (((travel - uRead) % cleatGap) + cleatGap) % cleatGap;
      return { phase: rel / cleatGap, period: cleatGap / speed, count: Math.floor((travel - uRead) / cleatGap) + nCleats };
    },
    phaseAt(u, ahead = 0) {
      const rel = (((travel + speed * ahead - u) % cleatGap) + cleatGap) % cleatGap;
      return rel / cleatGap;
    },
    spend(id) {
      const it = items.find((x) => x.item.id === id);
      if (it && it.spend < 1) it.spending = true;
    },
    uShift() {
      const u = (travel + speed * clock.acc) / B.total;
      return u - Math.floor(u);
    },
    cleats(cb) {
      const tr = travel + speed * clock.acc;
      for (let k = 0; k < nCleats; k++) {
        const u = cleatU(k, tr);
        place(u, 0, 0, at);
        cb(k, at[0], at[1], at[2], tilt(D.axis, q.ns, q.nz));
      }
      return nCleats;
    },
    poses(cb) {
      const k = clock.acc / clock.H;
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        const spend = it.spending ? Math.min(1, it.spend + clock.acc / 0.6) : it.spend;
        cb(i, it.item, spend, it.p[0] + it.d[0] * k, it.p[1] + it.d[1] * k, it.p[2] + it.d[2] * k, it.item.yaw, it.tilt + it.dTilt * k);
      }
      return items.length;
    },
    straps(cb) {
      const tr = travel + speed * clock.acc;
      const across = (D.axis === 'y' ? PARCEL.w : PARCEL.d) / 2 + 0.45;
      let n = 0;
      const strap = (u: number, fold: number) => {
        B.at(u, B.R, q);
        const len = (hookOf(q) / HOOK) * (HOOK + PARCEL.h / 2) * fold;
        if (len < 0.3) return;
        place(u, CH, 0, at);
        const tl = tilt(D.axis, q.ns, q.nz);
        cb(n++, at[0] - F.cV[0] * across, at[1] - F.cV[1] * across, at[2], tl, len);
        cb(n++, at[0] + F.cV[0] * across, at[1] + F.cV[1] * across, at[2], tl, len);
      };
      for (const it of items) if (it.phase === 'ride') strap(cleatU(it.cleat, tr), 1);
      for (const b of bails) strap(cleatU(b.cleat, tr), 1 - smooth(0, 1, b.t + clock.acc / 0.3));
      return n;
    },
  };
  return loop;
}

/** Whether arc length `mark` lies in (prev, u] (u only grows, modulo the loop). */
function passed(prev: number, u: number, mark: number) {
  return prev <= u ? prev < mark && u >= mark : prev < mark || u >= mark;
}

/** Turn to lie along the belt (the box is symmetric: the nearer of 0 and π), at 8/s. */
function relaxYaw(item: Item, h: number) {
  const square = Math.round(item.yaw / Math.PI) * Math.PI;
  item.yaw += (square - item.yaw) * Math.min(1, h * 8);
}
