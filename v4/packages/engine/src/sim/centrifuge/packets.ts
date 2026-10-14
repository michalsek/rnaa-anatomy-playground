/**
 * The centrifuge's packet side (M4's sim, unchanged in behaviour): the throat queue (arcs in,
 * gravity to rest), drops into pockets, landings, the release path (gate, spout, lip) and the
 * hand-on below the lip. It never decides when the tray moves: the spin controller
 * (`controller.ts`) reads it through `TrayView` and commands `drop` and `release`.
 *
 * §A (notes/M4-plan.md): pockets take packets only while the controller indexes, and the throat
 * only then too (`canAccept`); `put` and `accept` throw otherwise.
 *
 * Coordinates: the machine's local frame (v2 `L(x, y, z)`); angles in radians.
 */
import type { Clock } from '../clock.ts';
import type { Item, PoseFn } from '../items.ts';
import { ease, mod, wrapHalf, wrapPi } from '../math.ts';
import type { Out, V3 } from '../ports.ts';
import { RATES } from '../rates.ts';

export type SpinMode = 'index' | 'spin' | 'down';

// ---- constants (v2 centrifuge.mjs L7–58, L300–331, L695–706) -----------------------------------

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const POCKETS = 10;
const ALPHA = TAU / POCKETS;
const SPOUT = -90 * DEG;
const GATE = 95 * DEG;
const SLOPE = 15 * DEG;
const SPOUT_LEN = 15;
const SPOUT_V = [42, 18] as const;
const GRAVITY = 400;
const R_POCKET = 23;
const R_RIM_OUT = 31.4;
const Z_POCKET = 125;
const PK = 7;
const Z_MOUTH = 186;
const Z_HEAD = Z_MOUTH - 5;
const HAND_Z = 100;
const FUNNEL: [number, number] = [0, -R_POCKET];

const S0: V3 = [R_RIM_OUT * Math.cos(GATE), R_RIM_OUT * Math.sin(GATE), Z_POCKET];
const SD: V3 = [Math.cos(GATE) * Math.cos(SLOPE), Math.sin(GATE) * Math.cos(SLOPE), -Math.sin(SLOPE)];
const LIP: V3 = [S0[0] + SD[0] * SPOUT_LEN, S0[1] + SD[1] * SPOUT_LEN, S0[2] + SD[2] * SPOUT_LEN];
const T_FALL = (() => {
  const vz0 = SPOUT_V[1] * Math.sin(SLOPE);
  return (-vz0 + Math.sqrt(vz0 * vz0 + 2 * GRAVITY * (LIP[2] - HAND_Z))) / GRAVITY;
})();
const HAND: V3 = [
  LIP[0] + Math.cos(GATE) * SPOUT_V[1] * Math.cos(SLOPE) * T_FALL,
  LIP[1] + Math.sin(GATE) * SPOUT_V[1] * Math.cos(SLOPE) * T_FALL,
  HAND_Z,
];
/** Horizontal speed off the lip, and the vertical speed at the hand-on point. */
const LIP_H = SPOUT_V[1] * Math.hypot(SD[0], SD[1]);
const HAND_VZ = SPOUT_V[1] * SD[2] - GRAVITY * T_FALL;

const QMAX = 2;
const IDX_TAU = 0.22;
const TA = 0.28;
const DECEL = (SPOUT_V[0] ** 2 - SPOUT_V[1] ** 2) / (2 * SPOUT_LEN);
const TS = (SPOUT_V[0] - SPOUT_V[1]) / DECEL;
const LEAD = TA + TS + T_FALL;

/** The kinematic constants (one source for the app's spout geometry). */
export const CF = {
  POCKETS,
  ALPHA,
  SPOUT,
  GATE,
  HOLD: RATES.HOLD,
  QMAX,
  IDX_TAU,
  TA,
  TS,
  LEAD,
  gateLift: 8.3,
  restAngle: SPOUT - ALPHA / 2,
  pocket: { r: R_POCKET, z: Z_POCKET },
  mouth: Z_MOUTH,
  /** Where a packet enters the throat (v2 `ports.in`). */
  in: [0, -32, Z_MOUTH] as V3,
  spout: { start: S0, dir: SD, lip: LIP, hand: HAND, tFall: T_FALL, v: [Math.cos(GATE) * LIP_H, Math.sin(GATE) * LIP_H, HAND_VZ] as V3 },
  /** Packets the tray pool must hold (throat 2, one falling, 10 pockets, releases in flight). */
  capacity: 16,
} as const;

// ---- state -----------------------------------------------------------------------------------

export interface Queued {
  item: Item;
  z: number;
  vz: number;
  arc: { from: V3; t0: number; dur: number } | null;
  ready: number;
  /** The pocket it is aimed at (−1 = none yet). */
  want: number;
}
export interface Falling {
  item: Item;
  k: number;
  t0: number;
  z0: number;
  fall: number;
}
export interface Releasing {
  item: Item;
  k: number;
  t0: number;
  /** a0 + wrapπ(GATE − a0), a0 = the pocket angle at release: the gate angle just ahead. */
  aGate: number;
}

export interface TrayState {
  queue: Queued[];
  falling: Falling[];
  pockets: (Item | null)[];
  reserved: boolean[];
  releasing: Releasing[];
  lastLanding: number;
  releaseAt: number;
}

/** What the spin controller reads and commands. */
export interface TrayView {
  held(): number;
  occupied(k: number): boolean;
  reserved(k: number): boolean;
  /** A packet is falling into a pocket. */
  busy(): boolean;
  anyReserved(): boolean;
  queued(): number;
  releasing(): number;
  lastLanding(): number;
  /** The throat's head packet, resting and ready to drop (or null). */
  head(): Queued | null;
  /** Fall time from the head's height into a pocket. */
  fallOf(q: Queued): number;
  drop(k: number): void;
  release(k: number): void;
  /** Forget every queued packet's aimed pocket (the spin moves the tray under them). */
  clearTargets(): void;
}

export const pocketAngle = (k: number, A: number) => A + (k + 0.5) * ALPHA;


export interface Tray extends TrayView {
  readonly state: TrayState;
  canAccept(): boolean;
  accept(item: Item, from: V3): void;
  /** One step: the throat, landings, hand-ons (A = the rotor angle at this step). */
  step(h: number, A: number, out: Out): void;
  alive(): number;
  /** Every packet's pose (bottom centre, yaw) at `now` with the rotor at `A`. */
  poses(cb: PoseFn, now: number, A: number): number;
}

export function createTray(clock: Readonly<Clock>, ctl: { readonly mode: SpinMode; readonly A: number }): Tray {
  const s: TrayState = {
    queue: [],
    falling: [],
    pockets: Array.from({ length: POCKETS }, () => null),
    reserved: Array.from({ length: POCKETS }, () => false),
    releasing: [],
    lastLanding: -10,
    releaseAt: -10,
  };
  const restZ = (i: number) => Z_HEAD + PK * i;
  const atSpout = (A: number) => mod(Math.round((SPOUT - A) / ALPHA - 0.5), POCKETS);
  const freePocket = () => {
    for (let k = 0; k < POCKETS; k++) if (!s.pockets[k] && !s.reserved[k]) return k;
    return -1;
  };
  const put = (k: number, item: Item) => {
    // §A: pockets take packets only while indexing (intake closed from spin-up to spin-down).
    if (ctl.mode !== 'index') throw new Error(`centrifuge: put into pocket ${k} in mode ${ctl.mode}`);
    if (k < 0 || s.pockets[k]) throw new Error(`centrifuge: pocket ${k} is not free`);
    s.pockets[k] = item;
  };
  const resting = (q: Queued | undefined): q is Queued =>
    !!q && !q.arc && Math.abs(q.z - restZ(0)) < 0.3 && q.vz === 0;

  /** Where a released packet is, `age` s after its release began, with the rotor at `A`. */
  const rel = { stage: 0 as 0 | 1 | 2, x: 0, y: 0, z: 0, a: 0, vz: 0 };
  function releasePose(r: Releasing, age: number, A: number) {
    if (age < TA) {
      const rr = age < 0.08 ? R_POCKET : R_POCKET + (R_RIM_OUT - R_POCKET) * ((age - 0.08) / (TA - 0.08));
      // §A: ride the pocket (live A), then ease onto the gate just ahead; forward only. The
      // pocket reaches the gate half way through TA (the release starts w·TA/2 before it), so
      // the ease spans that half; `min` keeps the ride from passing the gate.
      const ride = Math.min(pocketAngle(r.k, A), r.aGate);
      const a = ride + (r.aGate - ride) * ease(age / (TA / 2));
      rel.stage = 0;
      rel.x = rr * Math.cos(a);
      rel.y = rr * Math.sin(a);
      rel.z = Z_POCKET;
      rel.a = a;
      return rel;
    }
    if (age < TA + TS) {
      const t = age - TA;
      const d = SPOUT_V[0] * t - 0.5 * DECEL * t * t;
      rel.stage = 1;
      rel.x = S0[0] + SD[0] * d;
      rel.y = S0[1] + SD[1] * d;
      rel.z = S0[2] + SD[2] * d;
      rel.a = GATE;
      return rel;
    }
    const t = age - TA - TS;
    const vz = SPOUT_V[1] * SD[2];
    rel.stage = 2;
    rel.x = LIP[0] + Math.cos(GATE) * LIP_H * t;
    rel.y = LIP[1] + Math.sin(GATE) * LIP_H * t;
    rel.z = LIP[2] + vz * t - 0.5 * GRAVITY * t * t;
    rel.a = GATE;
    rel.vz = vz - GRAVITY * t;
    return rel;
  }

  const tray: Tray = {
    state: s,
    held() {
      let n = 0;
      for (const p of s.pockets) if (p) n++;
      return n;
    },
    occupied: (k) => s.pockets[k] !== null,
    reserved: (k) => s.reserved[k] === true,
    busy: () => s.falling.length > 0,
    anyReserved: () => s.reserved.some(Boolean),
    queued: () => s.queue.length,
    releasing: () => s.releasing.length,
    lastLanding: () => s.lastLanding,
    head() {
      const q0 = s.queue[0];
      return resting(q0) && q0.ready <= clock.t ? q0 : null;
    },
    fallOf: (q) => Math.sqrt((2 * Math.max(0, q.z - Z_POCKET)) / GRAVITY),
    drop(k) {
      const q = s.queue.shift()!;
      s.reserved[k] = true;
      s.falling.push({ item: q.item, k, t0: clock.t, z0: q.z, fall: Math.sqrt((2 * (q.z - Z_POCKET)) / GRAVITY) });
    },
    release(k) {
      const item = s.pockets[k]!;
      s.pockets[k] = null;
      const a0 = pocketAngle(k, ctl.A);
      s.releasing.push({ item, k, t0: clock.t, aGate: a0 + wrapPi(GATE - a0) });
      s.releaseAt = clock.t;
    },
    clearTargets() {
      for (const q of s.queue) q.want = -1;
    },
    /** §A addendum: the throat takes packets only while indexing, and holds at most QMAX. */
    canAccept: () => ctl.mode === 'index' && s.queue.length < QMAX,
    accept(item, from) {
      if (!tray.canAccept()) throw new Error(`centrifuge: packet ${item.id} handed on with the intake closed`);
      s.queue.push({ item, z: Z_MOUTH + 1, vz: 0, arc: { from: [from[0], from[1], from[2]], t0: clock.t, dur: 0.32 }, ready: Infinity, want: -1 });
    },
    step(h, A, out) {
      const now = clock.t;
      // The queue: arcs end in the mouth, parcels fall to rest (head at the throat, the next on top).
      for (let i = 0; i < s.queue.length; i++) {
        const q = s.queue[i]!;
        if (q.arc && now - q.arc.t0 >= q.arc.dur) {
          q.arc = null;
          q.vz = 0;
          q.ready = now + 0.1;
        }
        if (q.arc) continue;
        const rest = restZ(i);
        if (q.z > rest + 1e-3) {
          q.vz -= GRAVITY * h;
          q.z += q.vz * h;
          if (q.z <= rest) {
            q.z = rest;
            q.vz = 0;
          }
        } else {
          q.z = rest;
          q.vz = 0;
        }
      }

      // Falling packets land in their pocket.
      for (let i = s.falling.length - 1; i >= 0; i--) {
        const f = s.falling[i]!;
        if (now - f.t0 < f.fall) continue;
        s.falling.splice(i, 1);
        let k = f.k;
        const lead = wrapHalf((SPOUT - pocketAngle(k, A)) / TAU) * POCKETS;
        if (Math.abs(lead) > 0.5 || s.pockets[k]) {
          const near = atSpout(A);
          if (!s.pockets[near]) k = near;
        }
        s.reserved[f.k] = false;
        // Addendum: if both are taken, the first free pocket (v2 could overwrite one).
        if (s.pockets[k]) k = freePocket();
        put(k, f.item);
        s.lastLanding = now;
      }

      // Released packets are handed on as they fall past z 100 below the lip, with their velocity.
      for (let i = s.releasing.length - 1; i >= 0; i--) {
        const r = s.releasing[i]!;
        const q = releasePose(r, now - r.t0, A);
        if (q.stage === 2 && q.z <= HAND[2]) {
          s.releasing.splice(i, 1);
          r.item.yaw = GATE;
          out.send(r.item, [q.x, q.y, q.z], [Math.cos(GATE) * LIP_H, Math.sin(GATE) * LIP_H, q.vz]);
        }
      }
    },
    alive: () => s.queue.length + s.falling.length + tray.held() + s.releasing.length,
    poses(cb, now, A) {
      let i = 0;
      // Arcing in, then the throat.
      for (let j = 0; j < s.queue.length; j++) {
        const q = s.queue[j]!;
        if (q.arc) {
          const u = Math.min(1, (now - q.arc.t0) / q.arc.dur);
          const f = q.arc.from;
          const x = f[0] + (FUNNEL[0] - f[0]) * u;
          const y = f[1] + (FUNNEL[1] - f[1]) * u;
          const z = f[2] + (Z_MOUTH + 1 - f[2]) * u + 6 * Math.sin(Math.PI * u);
          // Ease the yaw onto the throat's (the box is symmetric: the nearer of SPOUT and SPOUT + π).
          const yaw = q.item.yaw;
          const to = SPOUT + Math.PI * Math.round((yaw - SPOUT) / Math.PI);
          cb(i++, q.item, x, y, z, yaw + (to - yaw) * ease(u), 0, 0, 0);
        } else {
          const z = q.vz !== 0 ? Math.max(restZ(j), q.z + q.vz * (now - clock.t)) : q.z;
          cb(i++, q.item, FUNNEL[0], FUNNEL[1], z, SPOUT, 0, 0, 0);
        }
      }
      // Dropping into a pocket.
      for (const f of s.falling) {
        const age = now - f.t0;
        cb(i++, f.item, FUNNEL[0], FUNNEL[1], Math.max(Z_POCKET, f.z0 - 0.5 * GRAVITY * age * age), SPOUT, 0, 0, 0);
      }
      // Riding the tray (§A: the live angle, so every held packet turns with it).
      for (let k = 0; k < POCKETS; k++) {
        const it = s.pockets[k];
        if (!it) continue;
        const a = pocketAngle(k, A);
        cb(i++, it, R_POCKET * Math.cos(a), R_POCKET * Math.sin(a), Z_POCKET, mod(a, TAU), 0, 0, 0);
      }
      // Out through the gate, down the spout, off the lip.
      for (const r of s.releasing) {
        const q = releasePose(r, now - r.t0, A);
        cb(i++, r.item, q.x, q.y, q.z, mod(q.a, TAU), 0, 0, 0);
      }
      return i;
    },
  };
  return tray;
}
