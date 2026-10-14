/**
 * The crusher, the Disposer thread (v2 `parts/crusher/crusher.mjs`, LIVE L486+): a double-roll
 * crusher that destroys the garbage packets belt C brings. A packet handed on at the end of belt C
 * slides over the hopper's back lip, tips nose-down over its edge, drops onto the back roller,
 * tumbles into the nip and is squashed while it sinks (consumed when the crush ends). A
 * photo-eye sees it and the drive speeds up (critically damped), the front bearing block kicks
 * back on its spring (underdamped), the lamp lights (attack/decay) and the step counter's needle
 * steps one of 20 divisions per packet. Seven flakes per packet slide out under the housing in
 * seven lanes down the chute and drop into the drawer bin; at 10 packets' worth the chute gate
 * closes (flakes queue behind it), the drawer rolls out over the floor grate, dumps through its
 * bottom, rolls back, and the gate lets the queue go one flake at a time.
 *
 * Plain TS, deterministic (v2's `Math.random` flake seeds are a hash of the packet id). Local
 * frame: v2's (origin = machine centre on the floor; roller axes along x, the feed from −y, the
 * bin in front at +y). Flakes and the pile are not ledger items: a packet is consumed when its
 * crush ends.
 */
import type { Clock, Machine } from './clock.ts';
import { type Item, type Ledger, PACKET_SIZE, type PoseSource } from './items.ts';
import { type Spring, TAU, settle, smooth, springStep } from './math.ts';
import type { Located, Receiver, V3 } from './ports.ts';
import { RATES } from './rates.ts';

/** v2 crusher.mjs constants (build L7–17): the machine's dimensions, shared with the blocks. */
export const CR = {
  ROLLER: { r: 5.5, axisZ: 23, ys: [-6, 6] as const, x0: -13, x1: 13, rings: 7, ringW: 2.6, gapW: 1.0, endR: 4.2, rootR: 4.8 },
  HOPPER: { z0: 30, backTop: 37, frontTop: 34, flare: 4 },
  FLY: { x: 21.6, r: 10, w: 4, hub: 2.4, holes: 6, holeR: 1.5, holeAt: 5.9 },
  MOTOR: { y: -24, z: 9.6, x: 26, pulleyR: 3.5 },
  BELT_R: 0.7,
  BIN: { x0: -12, x1: 12, y0: 20, y1: 40, floorZ: 2.6, rimZ: 10, wall: 1.2, travel: 16 },
  CHUTE: { x0: -11, x1: 11, y0: -13, y1: 28, z0: 17, z1: 11.6 },
  SPRING: { x: 18.8, z: 23, y0: 10, y1: 19, r: 1.75, turns: 5.5 },
  DIAL: { x: -32, y: 11.6, z: 26.5, r: 3.6, face: 0.9 },
  LAMP: { x: -32, y: 5, z: 32 },
  PILE_MAX: 5.4,
  /** Flakes per packet, lanes on the chute. */
  PER: 7,
  LANES: 7,
  /** Where belt C should release a packet (v2 `local.drop`), and the hopper mouth (`local.in`). */
  drop: [0, -26, 40] as V3,
  in: [0, 0, 37] as V3,
} as const;

/** The packet's phases, seconds: slide onto the lip, tip and drop, tumble into the nip, crush. */
export const CRUSH_T = { TA: 0.5, TB: 0.5, TT: 0.45, TC: 1.0 } as const;
const { TA, TB, TT, TC } = CRUSH_T;
const T_NIP = TA + TB + TT;
const T_END = T_NIP + TC;

export type BinMode = 'home' | 'full' | 'out' | 'dump' | 'back';

export interface CrusherOutputs {
  /** Roller angle (rad; the back roller turns −, the front +, toward the nip), and the flywheel's. */
  phase: number;
  /** V-belt travel (lacing marks), units. */
  belt: number;
  /** Drive speed, rad/s (1.4 idle, 4.6 crushing). */
  spin: number;
  /** Front bearing block (and roller) kick-back along +y, units; the spring's compressed length. */
  kick: number;
  /** Lamp level 0..1. */
  lamp: number;
  /** Counter needle angle, rad (one division = 2π/20 per packet). */
  needle: number;
  /** Chute gate lift, units (2.9 open). */
  gate: number;
  /** Drawer travel along +y, units. */
  bin: number;
  /** Pile height in the bin, units. */
  pile: number;
}

export interface Flake {
  mode: 'slide' | 'fall' | 'land';
  lane: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Tumble angle (about x) while falling; size factor. */
  th: number;
  s: number;
  /** Landing time; the earliest time it may slide (released from the gate queue). */
  tl: number;
  wait: number;
}

export interface Chip {
  x: number;
  y: number;
  a: number;
  s: number;
  born: number;
}

interface Fed {
  item: Item;
  t0: number;
  from: V3;
  flaked: boolean;
}

export interface CrusherOptions {
  id: string;
  origin: V3;
}

export interface Crusher extends Machine, Located, Receiver, PoseSource {
  /** Packets crushed, the bin fill 0..1, the drawer's state. */
  stats(): { count: number; fill: number; bin: BinMode };
  outputs(o: CrusherOutputs): CrusherOutputs;
  /** The packets' squash (axis scale about the bottom centre), in `poses` order. */
  scales(cb: (i: number, sx: number, sy: number, sz: number) => void): number;
  /** Flakes: the bottom centre (crusher frame), tumble about x, size factor and flattening 0..1. */
  flakes(cb: (i: number, x: number, y: number, z: number, roll: number, s: number, flat: number) => void): number;
  /** Chips on the pile top (bin frame = crusher frame before the drawer's travel): fade-in 0..1. */
  chips(cb: (i: number, x: number, y: number, z: number, yaw: number, s: number, grow: number) => void): number;
  /** The bin's inner floor (pile plan), crusher frame: x0, x1, y0, y1 and the floor top z. */
  readonly pilePlan: { x0: number; x1: number; y0: number; y1: number; z: number };
}

const PK = PACKET_SIZE;
const CAP = RATES.binDump;
const PER = CR.PER;
const LANES = CR.LANES;
/** Flake slide speed, fall gravity (v2 VS, GRAV), per-lane speed factors. */
const VS = 12;
const GRAV = 160;
const LANE_V = [1.0, 0.86, 1.12, 0.93, 1.06, 0.82, 0.97];
const CHIPS_MAX = 70;

/** A deterministic fraction in [0, 1) from two integers (v2 used Math.random). */
const hash01 = (a: number, b: number) => {
  let h = (Math.imul(a, 0x9e3779b1) ^ Math.imul(b + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 2 ** 32;
};

export function createCrusher(clock: Readonly<Clock>, ledger: Ledger, o: CrusherOptions): Crusher {
  const { ROLLER, HOPPER, BIN: B, CHUTE } = CR;
  const [yB, yF] = ROLLER.ys;
  const zA = ROLLER.axisZ;
  const R = ROLLER.r;
  const nipY = (yB + yF) / 2;
  const rollTop = (y: number) => zA + Math.sqrt(Math.max(0, R * R - Math.min((y - yB) ** 2, (y - yF) ** 2)));
  const land: V3 = [0, yB + 1.2, rollTop(yB + 1.2) + 0.1];
  const nipRest = zA + Math.sqrt(Math.max(0, R * R - ((yF - yB) / 2 - PK.d / 2) ** 2));
  // The back lip's inner edge and top (v2 data.lip).
  const lipInner = -13 - HOPPER.flare + 0.4;
  const lipTop = HOPPER.backTop + 0.9;
  const yTip = lipInner + 0.6;
  const yHold = -9.5;
  const zHold = lipTop + 0.35;
  // Chute and bin (v2 data.chute, binLocal).
  const CH = { x0: CHUTE.x0 + 1, x1: CHUTE.x1 - 1, y0: CHUTE.y0, y1: CHUTE.y1, z0: CHUTE.z0, z1: CHUTE.z1, start: 11 };
  const chuteZ = (y: number) => CH.z0 + ((y - CH.y0) / (CH.y1 - CH.y0)) * (CH.z1 - CH.z0);
  const gateY = CH.y1 + 0.1;
  const pilePlan = { x0: B.x0 + B.wall + 0.1, x1: B.x1 - B.wall - 0.1, y0: B.y0 + B.wall + 0.1, y1: B.y1 - B.wall - 0.1, z: B.floorZ + 1.4 };
  const laneX = (lane: number) => CH.x0 + 1.2 + lane * ((CH.x1 - CH.x0 - 2.4) / (LANES - 1));

  const items: Fed[] = [];
  const flakes: Flake[] = [];
  const pending: { due: number; seed: number }[] = [];
  const chips: Chip[] = [];
  const spin: Spring = { x: 1.4, v: 0 };
  const kick: Spring = { x: 0, v: 0 };
  const lamp: Spring = { x: 0, v: 0 };
  const needle: Spring = { x: 0, v: 0 };
  const gate: Spring = { x: 1, v: 0 };
  const bin = { pos: 0, mode: 'home' as BinMode, t: 0 };
  let phase = 0;
  let belt = 0;
  let count = 0;
  let fill = 0;
  let laneNext = 0;
  let nextRelease = 0;

  const pileH = () => fill * CR.PILE_MAX;
  const laneTail = (lane: number) => {
    let m = Infinity;
    for (const f of flakes) if (f.mode === 'slide' && f.lane === lane) m = Math.min(m, f.y);
    return m;
  };
  /** A flake comes out from under the housing wall in its own lane (false: the lane is full). */
  const startFlake = (seed: number) => {
    const lane = laneNext % LANES;
    if (laneTail(lane) < CH.start + 1.9) return false;
    laneNext++;
    const r = seed;
    flakes.push({
      mode: 'slide',
      lane,
      x: laneX(lane) + (r - 0.5) * 0.4,
      y: CH.start,
      z: chuteZ(CH.start),
      vx: (r - 0.5) * 2,
      vy: VS * (0.55 + ((r * 5.7) % 1) * 0.75),
      vz: 0,
      th: r * 3,
      s: 0.8 + ((r * 13.1) % 1) * 0.3,
      tl: 0,
      wait: 0,
    });
    return true;
  };

  // Scratch for poses (no allocation per call).
  const pose = { x: 0, y: 0, z: 0, roll: 0, w: PK.w, d: PK.d, h: PK.h };
  /** v2 `drawItem`: the packet's pose `age` s after it was handed on, at time t (the jitter). */
  const poseOf = (it: Fed, age: number, t: number) => {
    const from = it.from;
    const xAt = (f: number) => from[0] + (0 - from[0]) * smooth(0, 1, f);
    let bx: number;
    let by: number;
    let bz: number;
    let th = 0;
    let w: number = PK.w;
    let d: number = PK.d;
    let h: number = PK.h;
    if (age < TA) {
      // Pushed off the belt end it slides across onto the back lip and over its edge, above the lip.
      const f = age / TA;
      bx = xAt(f * 0.5);
      by = from[1] + (yTip - from[1]) * f;
      bz = from[2] + (zHold - from[2]) * smooth(0, 1, f);
      th = -0.06 * f;
    } else if (age < TA + TB) {
      // It tips nose-down over the lip edge, holds height until its tail is clear, then drops.
      const g = (age - TA) / TB;
      const gh = (yHold - yTip) / (land[1] - yTip);
      const zf = Math.max(0, (g - gh) / (1 - gh));
      bx = xAt(0.5 + g * 0.5);
      by = yTip + (land[1] - yTip) * g;
      bz = zHold + (land[2] - zHold) * zf * zf;
      th = -0.06 - 0.34 * smooth(0, 0.6, g) + 0.14 * smooth(0.6, 1, g);
    } else if (age < T_NIP) {
      // Tumbles off the back roller into the nip.
      const g = (age - TA - TB) / TT;
      const e = smooth(0, 1, g);
      bx = 0;
      by = land[1] + (nipY - land[1]) * e;
      bz = land[2] + (nipRest - land[2]) * e + Math.sin(Math.PI * g) * 1.0 * (1 - g);
      th = -0.26 * (1 - g) * (1 - g) + 0.16 * Math.sin(Math.PI * 2 * g) * (1 - g);
    } else {
      // Squashed while it sinks between the rollers.
      const c = Math.min(1, (age - T_NIP) / TC);
      const e = smooth(0, 1, c);
      d = PK.d + (1.2 - PK.d) * e;
      h = PK.h + (2.2 - PK.h) * e;
      w = PK.w + 0.8 * e;
      bx = Math.sin(t * 61) * 0.18 * Math.sin(Math.PI * c);
      by = nipY;
      bz = nipRest + (zA - 2.6 - nipRest) * e;
    }
    // v2 pitches the box about x round its centre; the pool turns it round its bottom centre.
    pose.x = bx;
    pose.y = by + (h / 2) * Math.sin(th);
    pose.z = bz + h / 2 - (h / 2) * Math.cos(th);
    pose.roll = th;
    pose.w = w;
    pose.d = d;
    pose.h = h;
    return pose;
  };

  const crusher: Crusher = {
    id: o.id,
    origin: o.origin,
    pilePlan,
    canAccept: () => true,
    accept(item, from) {
      // Lie square across the feed (the box is symmetric).
      item.yaw = Math.round(item.yaw / Math.PI) * Math.PI;
      items.push({ item, t0: clock.t, from: [from[0], from[1], from[2]], flaked: false });
    },
    step(h) {
      const t = clock.t;
      let crushing = false;
      let seen = false;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i]!;
        const age = t - it.t0;
        if (age < T_NIP) seen = true;
        if (age > T_NIP - 0.15 && age < T_END) crushing = true;
        if (!it.flaked && age > T_NIP + 0.35) {
          it.flaked = true;
          for (let k = 0; k < PER; k++) pending.push({ due: t + k * 0.085, seed: hash01(it.item.id, k) });
        }
        if (age >= T_END) {
          items.splice(i, 1);
          count++;
          ledger.consume(it.item);
        }
      }
      settle(spin, crushing ? 4.6 : 1.4, h, 0.32);
      springStep(kick, crushing ? 1 : 0, h, 70, 7.5);
      settle(lamp, seen ? 1 : 0, h, seen ? 0.06 : 0.25);
      springStep(needle, (count * TAU) / 20, h, 180, 15);
      settle(gate, bin.mode === 'home' ? 1 : 0, h, 0.12);
      phase += spin.x * h;
      belt += spin.x * (CR.FLY.r + CR.BELT_R) * h;

      // Bin: when full the chute gate closes, the drawer rolls out over the grate, dumps through
      // its bottom, rolls back; then the queue leaves one flake at a time, front first.
      const falling = flakes.some((f) => f.mode !== 'slide');
      if (bin.mode === 'home' && fill >= 1 - 1e-6) bin.mode = 'full';
      if (bin.mode === 'full' && !falling && gate.x < 0.05) {
        bin.mode = 'out';
        bin.t = t;
      }
      if (bin.mode === 'out') {
        bin.pos = smooth(0, 1, (t - bin.t) / 1.5);
        if (t - bin.t >= 1.5) {
          bin.mode = 'dump';
          bin.t = t;
        }
      } else if (bin.mode === 'dump') {
        const f = Math.min(1, (t - bin.t) / 1.2);
        fill = Math.max(0, 1 - smooth(0, 1, f));
        if (f >= 1) {
          fill = 0;
          chips.length = 0;
          bin.mode = 'back';
          bin.t = t;
        }
      } else if (bin.mode === 'back') {
        bin.pos = 1 - smooth(0, 1, (t - bin.t) / 1.5);
        if (t - bin.t >= 1.5) {
          bin.pos = 0;
          bin.mode = 'home';
          const queue = flakes.filter((f) => f.mode === 'slide').sort((a, b) => b.y - a.y || a.lane - b.lane);
          queue.forEach((f, k) => (f.wait = t + 0.25 + k * 0.07));
        }
      }

      // Flakes: released one at a time into lanes; they queue behind the gate while it is shut.
      pending.sort((a, b) => a.due - b.due);
      while (pending.length && t >= pending[0]!.due && t >= nextRelease && startFlake(pending[0]!.seed)) {
        pending.shift();
        nextRelease = t + 0.085;
      }
      const shut = bin.mode !== 'home' || gate.x < 0.8;
      for (let lane = 0; lane < LANES; lane++) {
        let limit = Infinity;
        // Front of the lane first (largest y).
        const inLane = flakes.filter((f) => f.mode === 'slide' && f.lane === lane).sort((a, b) => b.y - a.y);
        for (const f of inLane) {
          const stop = shut && f.y <= gateY - 0.9 ? Math.min(limit, gateY - 0.9) : limit;
          if (t >= f.wait) f.y = Math.max(f.y, Math.min(f.y + VS * LANE_V[f.lane]! * h, stop));
          f.z = chuteZ(Math.min(f.y, CH.y1));
          limit = f.y - 1.9;
          if (f.y >= CH.y1 + 0.4) {
            f.mode = 'fall';
            f.vz = 0;
          }
        }
      }
      const zPile = pilePlan.z + pileH();
      for (let i = flakes.length - 1; i >= 0; i--) {
        const f = flakes[i]!;
        if (f.mode === 'fall') {
          f.x += f.vx * h;
          f.y += f.vy * h;
          f.vz -= GRAV * h;
          f.z += f.vz * h;
          f.th += 9 * h;
          if (f.z <= zPile) {
            f.z = zPile;
            f.mode = 'land';
            f.tl = t;
            fill = Math.min(1, fill + 1 / (CAP * PER));
            chips.push({ x: f.x, y: f.y, a: f.th, s: f.s * 0.9, born: t });
            if (chips.length > CHIPS_MAX) chips.shift();
          }
        } else if (f.mode === 'land' && t - f.tl > 0.3) flakes.splice(i, 1);
      }
    },
    alive: () => items.length,
    stats: () => ({ count, fill, bin: bin.mode }),
    outputs(r) {
      const a = clock.acc;
      r.phase = phase + spin.x * a;
      r.belt = belt + spin.x * (CR.FLY.r + CR.BELT_R) * a;
      r.spin = spin.x;
      r.kick = kick.x * 0.9;
      r.lamp = Math.max(0, Math.min(1, lamp.x));
      r.needle = needle.x;
      r.gate = Math.max(0, gate.x) * 2.9;
      r.bin = bin.pos * B.travel;
      r.pile = pileH();
      return r;
    },
    poses(cb) {
      const t = clock.t + clock.acc;
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        const p = poseOf(it, t - it.t0, t);
        // A packet turned end for end (yaw π) rolls the other way about its own x.
        const sign = Math.cos(it.item.yaw) >= 0 ? 1 : -1;
        cb(i, it.item, p.x, p.y, p.z, it.item.yaw, 0, sign * p.roll, 0);
      }
      return items.length;
    },
    scales(cb) {
      const t = clock.t + clock.acc;
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        const p = poseOf(it, t - it.t0, t);
        cb(i, p.w / PK.w, p.d / PK.d, p.h / PK.h);
      }
      return items.length;
    },
    flakes(cb) {
      const a = clock.acc;
      const t = clock.t + a;
      let n = 0;
      for (const f of flakes) {
        if (f.mode === 'slide') cb(n++, f.x, f.y, f.z, 0, f.s, 0);
        else if (f.mode === 'fall') cb(n++, f.x + f.vx * a, f.y + f.vy * a, f.z + f.vz * a - 0.5 * GRAV * a * a, f.th + 9 * a, f.s, 0);
        else cb(n++, f.x, f.y, f.z, 0, f.s, Math.min(1, (t - f.tl) / 0.3));
      }
      return n;
    },
    chips(cb) {
      const t = clock.t + clock.acc;
      const z = pilePlan.z + pileH();
      for (let i = 0; i < chips.length; i++) {
        const c = chips[i]!;
        cb(i, c.x, c.y, z, c.a, c.s, smooth(0, 0.3, t - c.born));
      }
      return chips.length;
    },
  };
  return crusher;
}
