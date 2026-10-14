/**
 * The "top" conveyor: a single-sided belt (v2 `parts/conveyor/conveyor.mjs` conveyorTop, L641–748).
 * Items fall onto the belt at `inAt` (keeping the sender's velocity, bending to land), ease up to
 * belt speed with a little hop, ride to `outAt` and are handed on with the belt's velocity, or
 * (`tip`, out at the head drum) slide round the drum and drop 16 below the belt first. With
 * `hold`, the front item waits short of the out point while the receiver can't take it, and the
 * ones behind queue an item length apart (v2's `self.hold`, belt B ← the centrifuge's intake).
 *
 * Coordinates: the machine's local frame (origin = the belt centreline at s = 0, on the floor),
 * mapped from the belt frame (s, c, z) by `beltFrame(axis)`. Plain TS, no randomness.
 */
import type { Clock, Machine } from './clock.ts';
import { type Fall, createFall, fallAt } from './fall.ts';
import { type Item, type ItemKind, PACKET_SIZE, type PoseSource, sizeOf } from './items.ts';
import { clampOpt, relaxYaw } from './math.ts';
import { type BeltAxis, type BeltFrame, beltFrame } from './path.ts';
import { type OutPort, type Located, type Receiver, type V3, createOut } from './ports.ts';
import { RATES } from './rates.ts';

export interface TopOptions {
  id: string;
  origin: V3;
  axis: BeltAxis;
  /** Travel of the top run along the axis. */
  dir?: 1 | -1;
  /** Drum centre to drum centre (≥ 30). */
  length: number;
  /** Belt surface height above the origin (≥ 20). */
  top: number;
  /** Belt width (≥ the parcel lane + 4). */
  width?: number;
  speed?: number;
  /** Slat spacing. */
  pitch?: number;
  /** Distance along the belt where items land, and where they leave. */
  inAt?: number;
  outAt?: number;
  /** Off the end: when out is at the head drum, slide round it and drop 16 first (default true). */
  tip?: boolean;
  /** Hold the front item while the receiver can't take it (required to feed a strict receiver). */
  hold?: boolean;
}

/** The belt's build data (the blocks draw from it). */
export interface TopGeometry {
  axis: BeltAxis;
  dir: 1 | -1;
  L: number;
  T: number;
  W: number;
  /** Drum core radius, belt thickness, outer wrap radius, drum axis height. */
  RD: number;
  BT: number;
  RW: number;
  zc: number;
  pitch: number;
  speed: number;
  inS: number;
  outS: number;
  tip: boolean;
  /** The belt's loop length on its outer surface (slats wrap round it). */
  total: number;
  /** Queue spacing of packets at rest (centre to centre; `Conveyor.spacing` for any kind). */
  spacing: number;
  ports: { in: V3; out: V3 };
}

type Phase = 'fall' | 'ride' | 'tip';
export interface TopItem {
  item: Item;
  phase: Phase;
  fall: Fall | null;
  s: number;
  v: number;
  bounce: number;
  z: number;
  vz: number;
  lim: number;
  /** Pose this step, and its change over the last step (render extrapolation). */
  p: V3;
  d: V3;
  /** Sim time it was handed on: it does not move in that step (the sender already moved it). */
  born: number;
}

export interface Conveyor extends Machine, Located, Receiver, PoseSource {
  readonly geometry: TopGeometry;
  readonly frame: BeltFrame;
  readonly outs: { out: OutPort };
  readonly items: readonly TopItem[];
  /** Belt travel so far. */
  readonly travel: number;
  /** Whether the front item is held (backpressure). */
  held(): boolean;
  /** Queue spacing (centre to centre) of items of this kind at rest. */
  spacing(kind: ItemKind): number;
  /** The slats' scroll as a fraction of the belt loop (the band's u shift), at t + acc. */
  uShift(): number;
}

const RD = 3.6;
const BT = 1.2;
/** Below the belt top, the frame is clear (a tipped item is handed on here). */
const DROP = 16;
const G = 420;
/** Clear space between queued items. */
const QUEUE_GAP = 1.5;
/** An item's half length along a belt on `axis` (items lie with their long side along x). */
const halfAlong = (axis: BeltAxis, kind: ItemKind) => {
  const z = sizeOf(kind);
  return (axis === 'y' ? z.d : z.w) / 2;
};

export function topGeometry(o: TopOptions): TopGeometry {
  const axis = o.axis;
  const dir = o.dir ?? 1;
  const L = clampOpt(o.id, 'length', o.length, 30);
  const T = clampOpt(o.id, 'top', o.top, 20);
  const W = clampOpt(o.id, 'width', o.width ?? 16, (axis === 'y' ? PACKET_SIZE.w : PACKET_SIZE.d) + 4);
  const RW = RD + BT;
  const zc = T - RW;
  const inS = o.inAt ?? (dir > 0 ? 8 : L - 8);
  const outS = o.outAt ?? (dir > 0 ? L : 0);
  const tip = (o.tip ?? true) && (dir > 0 ? outS >= L - 0.01 : outS <= 0.01);
  const f = beltFrame(axis);
  return {
    axis,
    dir,
    L,
    T,
    W,
    RD,
    BT,
    RW,
    zc,
    pitch: o.pitch ?? 4,
    speed: o.speed ?? RATES.beltSpeed,
    inS,
    outS,
    tip,
    total: 2 * L + 2 * Math.PI * RW,
    spacing: 2 * halfAlong(axis, 'control') + QUEUE_GAP,
    ports: { in: f.w(inS, 0, T), out: tip ? f.w(outS + dir * (RW + 6), 0, T - DROP) : f.w(outS, 0, T) },
  };
}

export function createConveyor(clock: Readonly<Clock>, o: TopOptions): Conveyor {
  const D = topGeometry(o);
  const F = beltFrame(D.axis);
  const { dir, T, outS, inS, tip, speed, zc } = D;
  const R = D.RW;
  const halfOf = (kind: ItemKind) => halfAlong(D.axis, kind);
  const items: TopItem[] = [];
  const order: TopItem[] = [];
  const front = (a: TopItem, b: TopItem) => (b.s - a.s) * dir;
  const landing: V3 = [0, 0, 0];
  let travel = 0;
  let heldNow = false;

  const out = createOut(o, 'out', { asks: o.hold === true });
  const blocked = () => o.hold === true && !out.ready();
  const set = (it: TopItem, x: number, y: number, z: number) => {
    it.d[0] = x - it.p[0];
    it.d[1] = y - it.p[1];
    it.d[2] = z - it.p[2];
    it.p[0] = x;
    it.p[1] = y;
    it.p[2] = z;
  };
  const emit = (it: TopItem, i: number, at: V3, v: V3) => {
    items.splice(i, 1);
    out.send(it.item, at, v);
  };

  const conveyor: Conveyor = {
    id: o.id,
    origin: o.origin,
    geometry: D,
    frame: F,
    outs: { out },
    items,
    get travel() {
      return travel;
    },
    held: () => heldNow,
    spacing: (kind) => 2 * halfOf(kind) + QUEUE_GAP,
    canAccept() {
      // The in point is clear by a queue spacing (falling items count as at the in point).
      for (const it of items) {
        const gap = 2 * halfOf(it.item.kind) + QUEUE_GAP;
        const s = it.phase === 'fall' ? inS : it.s;
        if (Math.abs(s - inS) < gap) return false;
      }
      return true;
    },
    accept(item, from, v) {
      const start = from;
      items.push({
        item,
        phase: 'fall',
        fall: createFall(start, v, T),
        s: inS,
        v: 0,
        bounce: 0,
        z: T,
        vz: 0,
        lim: Infinity,
        p: [start[0], start[1], start[2]],
        d: [v[0] * clock.H, v[1] * clock.H, v[2] * clock.H],
        born: clock.t,
      });
    },
    step(h) {
      travel += speed * h;
      heldNow = blocked();
      // Queue limits: the front item waits short of the out point while held, the ones behind
      // queue an item length (plus 1.5) apart.
      order.length = 0;
      for (const it of items) if (it.phase === 'ride') order.push(it);
      order.sort(front);
      let lim = Infinity;
      for (let i = 0; i < order.length; i++) {
        const it = order[i]!;
        const half = halfOf(it.item.kind);
        if (i === 0 && heldNow) lim = outS * dir + (tip ? half : 0) - 0.01;
        it.lim = lim;
        if (Number.isFinite(lim)) lim = Math.min(lim, it.s * dir) - (2 * half + QUEUE_GAP);
      }
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i]!;
        // Handed on this step by a machine that steps first: it has already moved this step.
        if (it.born === clock.t) continue;
        const half = halfOf(it.item.kind);
        if (it.phase === 'fall') {
          const f = it.fall!;
          f.tau += h / f.dur;
          fallAt(f, F.w(it.s, 0, T, landing), landing);
          set(it, landing[0], landing[1], landing[2]);
          if (f.tau >= 1) {
            it.phase = 'ride';
            it.bounce = 0;
            it.fall = null;
          }
        } else if (it.phase === 'ride') {
          it.bounce += h;
          it.v += (speed - it.v) * (1 - Math.exp(-h * 5));
          const was = it.s;
          it.s += dir * it.v * h;
          if (it.s * dir > it.lim) {
            // Stop at the queue limit, but never move back: items dropped closer than the queue
            // spacing (a sender that doesn't ask) stay where they are until the queue moves on.
            it.s = dir * Math.max(it.lim, was * dir);
            it.v = 0;
          }
          relaxYaw(it.item, h);
          const hop = 0.9 * Math.exp(-it.bounce * 9) * Math.abs(Math.sin(it.bounce * 22));
          F.w(it.s, 0, T + hop, landing);
          set(it, landing[0], landing[1], landing[2]);
          const past = (it.s - outS) * dir;
          if (tip && past >= half) {
            it.phase = 'tip';
            it.z = T;
            it.vz = 0;
          } else if (!tip && past >= 0) {
            if (blocked()) {
              // The receiver closed this very step: wait at the out point.
              it.s = outS - dir * 0.01;
              it.v = 0;
              continue;
            }
            emit(it, i, F.w(outS, 0, T), [F.sV[0] * dir * it.v, F.sV[1] * dir * it.v, 0]);
            continue;
          }
        } else {
          // Tip: the rear edge slides down the drum until the slope is 45°, then it falls free.
          it.s += dir * it.v * h;
          const dx = (it.s - outS) * dir - half;
          if (dx < R * Math.SQRT1_2 && it.vz === 0) it.z = zc + Math.sqrt(Math.max(0, R * R - dx * dx));
          else {
            if (it.vz === 0) it.vz = -it.v;
            it.vz -= G * h;
            it.z += it.vz * h;
          }
          F.w(it.s, 0, it.z, landing);
          set(it, landing[0], landing[1], landing[2]);
          if (it.z <= T - DROP) {
            emit(it, i, [it.p[0], it.p[1], it.p[2]], [F.sV[0] * dir * it.v, F.sV[1] * dir * it.v, it.vz]);
          }
        }
      }
    },
    alive: () => items.length,
    uShift() {
      // The band's u runs along the travel (either dir), so the slats move with the parcels.
      const u = (travel + speed * clock.acc) / D.total;
      return u - Math.floor(u);
    },
    poses(cb) {
      const k = clock.acc / clock.H;
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        cb(i, it.item, it.p[0] + it.d[0] * k, it.p[1] + it.d[1] * k, it.p[2] + it.d[2] * k, it.item.yaw, 0, 0, 0);
      }
      return items.length;
    },
  };
  return conveyor;
}
