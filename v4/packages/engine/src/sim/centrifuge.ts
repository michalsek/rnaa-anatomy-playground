/**
 * The centrifuge simulation, ported from v2 (`v2-factory/parts/centrifuge/centrifuge.mjs`
 * `centrifugeLive`, and the stub feeder and audio belt from `build.mjs`), with the user's spin-up
 * correction (notes/M4-plan.md §A and its addendum):
 *
 * - fill (`index`): packets drop from the throat into free pockets;
 * - intake closes when the spin starts: no pocket entries, no throat entries, the feeder backs up;
 * - spin up: the whole tray turns, every held packet rides in its pocket;
 * - release: one packet per belt quantum leaves through the gate, its angle moving forward only;
 * - spin down once empty, index onto a pocket, reopen the intake.
 *
 * Plain TS: no React, no randomness, no wall clock. A fixed step (H = 1/120 s); the state is a pure
 * function of the seed and the dt sequence. Coordinates are the machine's local frame (v2's
 * `L(x, y, z)`, origin [100, 66, 0]); the stubs share that origin. Angles in radians.
 */

export type Kind = 0 | 1 | 2;
export type PhaseWord = 'idle' | 'filling' | 'spinning up' | 'in sync' | 'spinning down';
export type SimMode = 'index' | 'spin' | 'down';
type V3 = [number, number, number];
interface Spring {
  x: number;
  v: number;
}
interface Item {
  id: number;
  kind: Kind;
}
interface FeedItem extends Item {
  y: number;
  /** Where the bed lets it go this step (the roller, or 11 behind the one ahead). */
  lim: number;
}
interface Queued extends Item {
  z: number;
  vz: number;
  arc: { from: V3; t0: number; dur: number } | null;
  ready: number;
  /** The pocket it is aimed at (−1 = none yet). */
  want: number;
}
interface Falling extends Item {
  k: number;
  t0: number;
  z0: number;
  fall: number;
}
interface Releasing extends Item {
  k: number;
  t0: number;
  a0: number;
  /** a0 + wrapπ(GATE − a0): the gate angle just ahead of the pocket. */
  aGate: number;
}
interface OnBelt extends Item {
  p: V3;
  v: V3;
  yaw: number;
  stage: 'fall' | 'ride' | 'tip';
}

export interface SimState {
  t: number;
  /** Unstepped time below one step (render extrapolation). */
  acc: number;
  seed: number;
  nextId: number;
  feedNext: number;
  feedN: number;
  fed: number;
  gone: number;
  mode: SimMode;
  A: number;
  w: number;
  target: number;
  ang: Spring;
  spd: Spring;
  inSync: boolean;
  syncFor: number;
  prevRel: number | null;
  /** The belt's quantum phase, unwrapped. */
  S: number;
  prevP: number | null;
  emptyFor: number;
  lastLanding: number;
  lastDrop: number;
  releaseAt: number;
  motorA: number;
  lamp: Spring;
  needle: Spring;
  phase: PhaseWord;
  log: { t: number; phase: PhaseWord }[];
  pockets: (Item | null)[];
  reserved: boolean[];
  /** Pockets in the order they were filled. */
  order: number[];
  feed: FeedItem[];
  queue: Queued[];
  falling: Falling[];
  releasing: Releasing[];
  belt: OnBelt[];
  beltClock: number;
}

export interface Status {
  t: number;
  held: number;
  rpm: number;
  phase: PhaseWord;
  queued: number;
  inSync: boolean;
  mode: SimMode;
}

export interface Outputs {
  /** Rotor angle (unwrapped; the rest angle is SPOUT − α/2). */
  rotor: number;
  motor: number;
  /** Gate opening 0..1 (lift = CF.gateLift · open, crank kick = 60° · open). */
  open: number;
  /** Needle share: w / sync speed (the dial reads 0.7 · share of its sweep). */
  share: number;
  lamp: number;
}

export type PacketCallback = (i: number, kind: Kind, x: number, y: number, z: number, yaw: number) => void;

export interface CentrifugeSim {
  readonly state: Readonly<SimState>;
  reset(seed?: number): void;
  /** One frame: dt clamped to 1/30 s, times speed, at most 8 steps; the rest is dropped. */
  advance(dt: number, speed?: number): number;
  /** Uncapped (seek, tests). */
  run(seconds: number): void;
  /** Pass `out` to reuse an object (per-frame callers). */
  status(out?: Status): Status;
  outputs(out: Outputs): Outputs;
  /** Every live packet's pose (bottom centre, yaw); returns the count. */
  packets(cb: PacketCallback): number;
  /** The belt slats' x; returns the count. */
  slats(cb: (j: number, x: number) => void): number;
  /** Receiver backpressure (v2 `releaseWhen`): false keeps the packet in its pocket. */
  canRelease: ((lead: number) => boolean) | null;
}

// ---- constants (v2 centrifuge.mjs L7–58, L300–331, L695–706; build.mjs L21–54) ------------------

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

const HOLD = 6;
const QMAX = 2;
const IDX_TAU = 0.22;
const TA = 0.28;
const DECEL = (SPOUT_V[0] ** 2 - SPOUT_V[1] ** 2) / (2 * SPOUT_LEN);
const TS = (SPOUT_V[0] - SPOUT_V[1]) / DECEL;
const LEAD = TA + TS + T_FALL;
const SLAT_PERIOD = 0.42;

const FEED = { x: 0, y0: -100, y1: -42, top: 191.4, speed: 30, gap: 11, every: 0.9, delay: 0.5, max: 6 };
const BELT = { x0: -78, x1: 10, y: HAND[1], top: 92, pitch: 12, period: SLAT_PERIOD, slats: 7 };
const BELT_SPEED = BELT.pitch / BELT.period;
const BELT_WRAP = BELT.slats * BELT.pitch;
/** v2 build.mjs `kinds`: 8 packets then 5 empty ticks (control 0, graph 1, data 2). */
const KINDS: readonly Kind[] = [0, 0, 1, 2, 0, 1, 0, 2];
const FEED_TICKS = KINDS.length + 5;

/** The kinematic constants (one source for the app's spout and belt geometry). */
export const CF = {
  POCKETS,
  ALPHA,
  SPOUT,
  GATE,
  HOLD,
  QMAX,
  TA,
  TS,
  LEAD,
  gateLift: 8.3,
  restAngle: SPOUT - ALPHA / 2,
  pocket: { r: R_POCKET, z: Z_POCKET },
  spout: { start: S0, dir: SD, lip: LIP, hand: HAND, tFall: T_FALL },
  feed: FEED,
  belt: BELT,
  slatPeriod: SLAT_PERIOD,
  capacity: 40,
} as const;

const H = 1 / 120;
const MAX_STEPS = 8;

const mod = (a: number, n: number) => ((a % n) + n) % n;
const wrapHalf = (x: number) => x - Math.round(x);
/** Wrap into [−π, π). */
const wrapPi = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const burst = (age: number, rise: number, fall: number) =>
  age < 0 ? 0 : age < rise ? ease(age / rise) : Math.exp(-(age - rise) / fall);
/** Critically damped spring toward `target` (v2 `settle`, 4 substeps). */
function settle(s: Spring, target: number, dt: number, tau: number) {
  const w = 1 / tau;
  const h = dt / 4;
  for (let i = 0; i < 4; i++) {
    s.v += (w * w * (target - s.x) - 2 * w * s.v) * h;
    s.x += s.v * h;
  }
}

function initial(seed: number): SimState {
  const A = SPOUT - 0.5 * ALPHA;
  return {
    t: 0,
    acc: 0,
    seed,
    nextId: 1,
    feedNext: FEED.delay,
    feedN: 0,
    fed: 0,
    gone: 0,
    mode: 'index',
    A,
    w: 0,
    target: A,
    ang: { x: A, v: 0 },
    spd: { x: 0, v: 0 },
    inSync: false,
    syncFor: 0,
    prevRel: null,
    S: 0,
    prevP: null,
    emptyFor: 0,
    lastLanding: -10,
    lastDrop: -10,
    releaseAt: -10,
    motorA: 0,
    lamp: { x: 0, v: 0 },
    needle: { x: 0, v: 0 },
    phase: 'idle',
    log: [{ t: 0, phase: 'idle' }],
    pockets: Array.from({ length: POCKETS }, () => null),
    reserved: Array.from({ length: POCKETS }, () => false),
    order: [],
    feed: [],
    queue: [],
    falling: [],
    releasing: [],
    belt: [],
    beltClock: 0,
  };
}

export function createCentrifugeSim(o: { seed?: number } = {}): CentrifugeSim {
  let s = initial(o.seed ?? 0);

  // ---- helpers over the state ----------------------------------------------------------------
  const pocketAngle = (k: number, A = s.A) => A + (k + 0.5) * ALPHA;
  const atSpout = () => mod(Math.round((SPOUT - s.A) / ALPHA - 0.5), POCKETS);
  const held = () => {
    let n = 0;
    for (const p of s.pockets) if (p) n++;
    return n;
  };
  const busy = () => s.falling.length > 0;
  const anyReserved = () => s.reserved.some(Boolean);
  const restZ = (i: number) => Z_HEAD + PK * i;
  const freePocket = () => {
    for (let k = 0; k < POCKETS; k++) if (!s.pockets[k] && !s.reserved[k]) return k;
    return -1;
  };
  const put = (k: number, item: Item) => {
    // §A: pockets take packets only while indexing (intake closed from spin-up to spin-down).
    if (s.mode !== 'index') throw new Error(`centrifuge: put into pocket ${k} in mode ${s.mode}`);
    if (k < 0 || s.pockets[k]) throw new Error(`centrifuge: pocket ${k} is not free`);
    s.pockets[k] = item;
    s.order.push(k);
  };
  const take = (k: number): Item => {
    const item = s.pockets[k]!;
    s.pockets[k] = null;
    const i = s.order.indexOf(k);
    if (i >= 0) s.order.splice(i, 1);
    return item;
  };
  const fallOf = (q: Queued) => Math.sqrt((2 * Math.max(0, q.z - Z_POCKET)) / GRAVITY);
  const resting = (q: Queued | undefined): q is Queued =>
    !!q && !q.arc && Math.abs(q.z - restZ(0)) < 0.3 && q.vz === 0;
  /** §A addendum: the throat takes packets only while indexing, and holds at most QMAX. */
  const canAccept = () => s.mode === 'index' && s.queue.length < QMAX;
  const setPhase = (word: PhaseWord) => {
    if (word === s.phase) return;
    s.phase = word;
    s.log.push({ t: s.t, phase: word });
  };

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
    const h = SPOUT_V[1] * Math.hypot(SD[0], SD[1]);
    const vz = SPOUT_V[1] * SD[2];
    rel.stage = 2;
    rel.x = LIP[0] + Math.cos(GATE) * h * t;
    rel.y = LIP[1] + Math.sin(GATE) * h * t;
    rel.z = LIP[2] + vz * t - 0.5 * GRAVITY * t * t;
    rel.a = GATE;
    rel.vz = vz - GRAVITY * t;
    return rel;
  }

  // ---- the stubs -------------------------------------------------------------------------------
  /** v2 stubBelt.quanta(): the slat phase at the hand-over point. */
  const beltPhase = () => mod((s.beltClock * BELT_SPEED - (BELT.x1 - HAND[0])) / BELT.pitch + 0.5, 1);

  function feedTimer() {
    if (s.t < s.feedNext) return;
    // FEED_MAX: the timer holds while the bed is full (deterministic, bounded backpressure).
    if (s.feed.length >= FEED.max) return;
    s.feedNext = s.t + FEED.every;
    // The seed rotates the kinds only, so every seed has the same timing (seed 0 = v2).
    const tick = s.feedN++ % FEED_TICKS;
    if (tick >= KINDS.length) return;
    const kind = KINDS[(s.seed + s.fed) % KINDS.length]!;
    s.feed.push({ id: s.nextId++, kind, y: FEED.y0, lim: FEED.y1 });
    s.fed++;
  }

  function feederTick(dt: number) {
    let limit: number = FEED.y1;
    for (const it of s.feed) {
      it.lim = limit;
      it.y = Math.min(it.y + FEED.speed * dt, limit);
      limit = it.y - FEED.gap;
    }
    const front = s.feed[0];
    if (front && front.y >= FEED.y1 && canAccept()) {
      s.feed.shift();
      accept(front, [FEED.x, FEED.y1, FEED.top]);
    }
  }

  function accept(item: Item, from: V3) {
    s.queue.push({
      id: item.id,
      kind: item.kind,
      z: Z_MOUTH + 1,
      vz: 0,
      arc: { from, t0: s.t, dur: 0.32 },
      ready: Infinity,
      want: -1,
    });
  }

  function beltAccept(item: Item, p: V3, v: V3) {
    s.belt.push({ id: item.id, kind: item.kind, p, v, yaw: GATE, stage: 'fall' });
  }

  function beltTick(dt: number) {
    s.beltClock += dt;
    for (let i = s.belt.length - 1; i >= 0; i--) {
      const it = s.belt[i]!;
      if (it.stage === 'fall') {
        it.v[2] -= GRAVITY * dt;
        for (let a = 0; a < 3; a++) it.p[a] = it.p[a]! + it.v[a]! * dt;
        if (it.p[2] <= BELT.top) {
          it.p[2] = BELT.top;
          it.stage = 'ride';
          it.v[0] = -BELT_SPEED;
          it.v[1] = 0;
          it.v[2] = 0;
        }
      } else if (it.stage === 'ride' && it.p[0] > BELT.x0 - 1) {
        it.p[0] -= BELT_SPEED * dt;
        it.p[1] += (BELT.y - it.p[1]) * Math.min(1, dt * 8);
        // Square up on the belt (v2 snaps to 0 at the hand-over).
        const square = Math.round(it.yaw / (Math.PI / 2)) * (Math.PI / 2);
        it.yaw += (square - it.yaw) * Math.min(1, dt * 8);
      } else {
        it.stage = 'tip';
        it.v[2] -= GRAVITY * dt;
        it.p[0] += it.v[0] * dt;
        it.p[2] += it.v[2] * dt;
        if (it.p[2] < BELT.top - 16) {
          s.belt.splice(i, 1);
          s.gone++;
        }
      }
    }
  }

  // ---- the centrifuge (v2 centrifugeLive.tick) -------------------------------------------------
  function dropInto(k: number) {
    const q = s.queue.shift()!;
    s.reserved[k] = true;
    s.falling.push({ id: q.id, kind: q.kind, k, t0: s.t, z0: q.z, fall: Math.sqrt((2 * (q.z - Z_POCKET)) / GRAVITY) });
    s.lastDrop = s.t;
  }

  function release(k: number) {
    const item = take(k);
    const a0 = pocketAngle(k);
    s.releasing.push({ id: item.id, kind: item.kind, k, t0: s.t, a0, aGate: a0 + wrapPi(GATE - a0) });
    s.releaseAt = s.t;
  }

  function centrifugeTick(dt: number) {
    const now = s.t;
    // The belt's quantum phase, unwrapped into S (the period is known, so the rate is exact).
    const ph = beltPhase();
    let dp = s.prevP === null ? 0 : ph - s.prevP;
    if (dp < -0.5) dp += 1;
    if (dp > 0.5) dp -= 1;
    s.prevP = ph;
    s.S += dp;
    const rate = 1 / BELT.period;
    const period = BELT.period;

    // The queue: arcs end in the mouth, parcels fall to rest (head at the throat, the next on top).
    s.queue.forEach((q, i) => {
      if (q.arc && now - q.arc.t0 >= q.arc.dur) {
        q.arc = null;
        q.vz = 0;
        q.ready = now + 0.1;
      }
      if (q.arc) return;
      const rest = restZ(i);
      if (q.z > rest + 1e-3) {
        q.vz -= GRAVITY * dt;
        q.z += q.vz * dt;
        if (q.z <= rest) {
          q.z = rest;
          q.vz = 0;
        }
      } else {
        q.z = rest;
        q.vz = 0;
      }
    });

    // Falling packets land in their pocket.
    for (let i = s.falling.length - 1; i >= 0; i--) {
      const f = s.falling[i]!;
      if (now - f.t0 < f.fall) continue;
      s.falling.splice(i, 1);
      let k = f.k;
      const lead = wrapHalf((SPOUT - pocketAngle(k)) / TAU) * POCKETS;
      if (Math.abs(lead) > 0.5 || s.pockets[k]) {
        const near = atSpout();
        if (!s.pockets[near]) k = near;
      }
      s.reserved[f.k] = false;
      // Addendum: if both are taken, the first free pocket (v2 could overwrite one).
      if (s.pockets[k]) k = freePocket();
      put(k, { id: f.id, kind: f.kind });
      s.lastLanding = now;
    }

    // Released packets are handed to the belt as they fall past z 100 below the lip.
    for (let i = s.releasing.length - 1; i >= 0; i--) {
      const r = s.releasing[i]!;
      const q = releasePose(r, now - r.t0, s.A);
      if (q.stage === 2 && q.z <= HAND[2]) {
        s.releasing.splice(i, 1);
        const h = SPOUT_V[1] * Math.hypot(SD[0], SD[1]);
        beltAccept(r, [q.x, q.y, q.z], [Math.cos(GATE) * h, Math.sin(GATE) * h, q.vz]);
      }
    }

    const syncW = ALPHA * rate;
    // The release starts with the pocket a little before the gate, so it is centred as it leaves.
    const delta = (s.w * TA) / 2;
    const uRel = (s.A - (GATE - delta)) / ALPHA + 0.5;
    const e = wrapHalf(s.S + LEAD / period - uRel);
    const A0 = s.A;
    if (s.mode === 'index') {
      const q0 = s.queue[0];
      const head = resting(q0) && q0.ready <= now ? q0 : null;
      if (head && head.want < 0 && !busy()) {
        let bestK = -1;
        let bestNeed = 0;
        for (let k = 0; k < POCKETS; k++) {
          if (s.pockets[k] || s.reserved[k]) continue;
          const ahead = mod(SPOUT - pocketAngle(k), TAU);
          const need = ahead > TAU - 0.02 ? 0 : ahead;
          if (bestK < 0 || need < bestNeed) {
            bestK = k;
            bestNeed = need;
          }
        }
        if (bestK >= 0) {
          head.want = bestK;
          s.target = s.A + bestNeed;
        }
      }
      if (head && head.want >= 0 && !busy()) {
        const FALL = fallOf(head);
        const e0 = s.A - s.target;
        const eLand = (e0 + (s.ang.v + e0 / IDX_TAU) * FALL) * Math.exp(-FALL / IDX_TAU);
        if (Math.abs(eLand) < 0.02) dropInto(head.want);
      }
      const idle = !s.queue.length && !busy() && !anyReserved();
      if (idle) s.target += 0.12 * dt;
      s.ang.x = s.A;
      settle(s.ang, s.target, dt, IDX_TAU);
      s.A = s.ang.x;
      s.w = s.ang.v;
      const quiet = now - s.lastLanding > 4;
      const n = held();
      if (!busy() && !anyReserved() && (n >= HOLD || (n > 0 && quiet && !s.queue.length))) {
        s.mode = 'spin';
        s.spd.x = s.w;
        s.spd.v = 0;
      }
      setPhase(n || s.queue.length ? 'filling' : 'idle');
    } else if (s.mode === 'spin') {
      const relErr = Math.abs(s.w - syncW) / syncW;
      const lock = ease((0.18 - relErr) / 0.12);
      settle(s.spd, syncW + ALPHA * 1.4 * e * lock, dt, 0.4);
      s.w = s.spd.x;
      s.A += s.w * dt;
      s.syncFor = relErr < 0.04 && Math.abs(e) < 0.05 ? s.syncFor + dt : 0;
      if (!s.inSync && s.syncFor > 0.35) s.inSync = true;
      if (s.inSync && (Math.abs(e) > 0.15 || relErr > 0.12)) s.inSync = false;
      const uNow = (s.A - (GATE - (s.w * TA) / 2)) / ALPHA + 0.5;
      if (s.inSync && s.prevRel !== null && Math.floor(uNow) > Math.floor(s.prevRel)) {
        const k = mod(-Math.round(uNow), POCKETS);
        // Backpressure from the receiver: the packet stays in its pocket and comes round again.
        if (s.pockets[k] && (!sim.canRelease || sim.canRelease(LEAD))) release(k);
      }
      s.prevRel = uNow;
      // §A: no drops into passing pockets while spinning (v2 L1130–1143 removed).
      setPhase(s.inSync ? 'in sync' : 'spinning up');
      // Addendum: the throat may still hold packets (intake closed), so it is not part of "empty".
      s.emptyFor = !held() && !busy() && !s.releasing.length ? s.emptyFor + dt : 0;
      if (s.inSync && s.emptyFor > 0.6) {
        s.mode = 'down';
        s.inSync = false;
        s.prevRel = null;
      }
    } else {
      settle(s.spd, 0, dt, 0.7);
      s.w = s.spd.x;
      s.A += s.w * dt;
      setPhase('spinning down');
      if (s.w < 0.5) {
        s.mode = 'index';
        s.ang.x = s.A;
        s.ang.v = s.w;
        const coast = s.A + s.w * IDX_TAU;
        const base = SPOUT - 0.5 * ALPHA;
        s.target = base + Math.ceil((coast - base) / ALPHA) * ALPHA;
        setPhase(held() || s.queue.length ? 'filling' : 'idle');
      }
    }
    // One direction (addendum): the tray never turns back.
    if (s.A < A0) {
      s.A = A0;
      s.ang.x = A0;
      if (s.ang.v < 0) s.ang.v = 0;
      if (s.w < 0) s.w = 0;
    }

    s.motorA += s.w * (5.5 / 4) * dt;
    settle(s.lamp, s.inSync ? 0.45 : 0, dt, 0.25);
    settle(s.needle, s.w / (ALPHA * rate), dt, 0.25);
  }

  function step() {
    s.t += H;
    feedTimer();
    centrifugeTick(H);
    feederTick(H);
    beltTick(H);
  }

  const openAt = (age: number) =>
    age < 0 ? 0 : age < 0.08 ? ease(age / 0.08) : age < TA + 0.12 ? 1 : 1 - ease((age - TA - 0.12) / 0.25);

  const sim: CentrifugeSim = {
    get state() {
      return s;
    },
    canRelease: null,
    reset(seed = s.seed) {
      s = initial(seed);
    },
    advance(dt, speed = 1) {
      const d = Math.min(Math.max(0, dt), 1 / 30) * Math.max(0, speed);
      s.acc += d;
      let n = Math.floor(s.acc / H + 1e-9);
      if (n > MAX_STEPS) {
        n = MAX_STEPS;
        s.acc = 0;
      } else {
        s.acc = Math.max(0, s.acc - n * H);
      }
      for (let i = 0; i < n; i++) step();
      return n;
    },
    run(seconds) {
      const n = Math.round(seconds / H);
      for (let i = 0; i < n; i++) step();
    },
    status(out) {
      const o = out ?? ({} as Status);
      o.t = s.t;
      o.held = held();
      o.rpm = (Math.max(0, s.w) * 60) / TAU;
      o.phase = s.phase;
      o.queued = s.queue.length;
      o.inSync = s.inSync;
      o.mode = s.mode;
      return o;
    },
    outputs(out) {
      const w = Math.max(0, s.w);
      out.rotor = s.A + w * s.acc;
      out.motor = s.motorA + w * (5.5 / 4) * s.acc;
      out.open = openAt(s.t + s.acc - s.releaseAt);
      out.share = s.needle.x;
      out.lamp = Math.min(1.2, s.lamp.x + 0.5 * burst(s.t + s.acc - s.releaseAt, 0.05, 0.2));
      return out;
    },
    packets(cb) {
      const acc = s.acc;
      const now = s.t + acc;
      const A = s.A + Math.max(0, s.w) * acc;
      let i = 0;
      // Feeder bed (yaw 0: v2 packetSvg's long axis on x).
      for (const it of s.feed) cb(i++, it.kind, FEED.x, Math.min(it.y + FEED.speed * acc, it.lim), FEED.top, 0);
      // Arcing in, then the throat.
      for (const q of s.queue) {
        if (q.arc) {
          const u = Math.min(1, (now - q.arc.t0) / q.arc.dur);
          const f = q.arc.from;
          const x = f[0] + (FUNNEL[0] - f[0]) * u;
          const y = f[1] + (FUNNEL[1] - f[1]) * u;
          const z = f[2] + (Z_MOUTH + 1 - f[2]) * u + 6 * Math.sin(Math.PI * u);
          cb(i++, q.kind, x, y, z, ease(u) * SPOUT);
        } else {
          const z = q.vz !== 0 ? Math.max(restZ(s.queue.indexOf(q)), q.z + q.vz * acc) : q.z;
          cb(i++, q.kind, FUNNEL[0], FUNNEL[1], z, SPOUT);
        }
      }
      // Dropping into a pocket.
      for (const f of s.falling) {
        const age = now - f.t0;
        cb(i++, f.kind, FUNNEL[0], FUNNEL[1], Math.max(Z_POCKET, f.z0 - 0.5 * GRAVITY * age * age), SPOUT);
      }
      // Riding the tray (§A: the live angle, so every held packet turns with it).
      for (let k = 0; k < POCKETS; k++) {
        const it = s.pockets[k];
        if (!it) continue;
        const a = pocketAngle(k, A);
        cb(i++, it.kind, R_POCKET * Math.cos(a), R_POCKET * Math.sin(a), Z_POCKET, mod(a, TAU));
      }
      // Out through the gate, down the spout, off the lip.
      for (const r of s.releasing) {
        const q = releasePose(r, now - r.t0, A);
        cb(i++, r.kind, q.x, q.y, q.z, mod(q.a, TAU));
      }
      // The audio belt.
      for (const it of s.belt) {
        const vz = it.stage === 'ride' ? 0 : it.v[2];
        cb(i++, it.kind, it.p[0] + it.v[0] * acc, it.p[1] + it.v[1] * acc, it.p[2] + vz * acc, it.yaw);
      }
      return i;
    },
    slats(cb) {
      const along = (s.beltClock + s.acc) * BELT_SPEED;
      for (let j = 0; j < BELT.slats; j++) cb(j, BELT.x1 - 1 - mod(along + j * BELT.pitch, BELT_WRAP));
      return BELT.slats;
    },
  };
  return sim;
}
