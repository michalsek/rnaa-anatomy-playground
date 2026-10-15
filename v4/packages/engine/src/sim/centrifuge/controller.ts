/**
 * The centrifuge's spin model: when the tray turns, how fast, and when packets drop in or leave.
 * A controller exposes `{ mode, A, w, inSync, phase, syncW }` and one `step(h, io)`; its `state`
 * is opaque plain data (snapshots only). The packet side (`packets.ts`) is the same for every
 * controller, and so are the contract tests (§A, conservation, backpressure, determinism), so a
 * different spin model (after the final-scene review) is a new controller here.
 *
 * Shared by every controller here (the §A rules, notes/M4-plan.md):
 * - index: aim the nearest free pocket under the throat, drop when the predicted landing error is
 *   small, creep while idle; spin at HOLD held (or 4 s quiet with packets held);
 * - spin: phase-locked to the receiver's quanta (`sync`), one release per gate crossing while in
 *   sync and the receiver can take it (`canRelease`); the intake stays closed;
 * - down: once empty for 0.6 s, slow to rest on a pocket, then index again;
 * - the tray never turns back.
 *
 * Controllers:
 * - `createSpinController` (the default): M4's, v2's critically damped speed spring (τ .4 up,
 *   .7 down) with the lock term;
 * - `createRampController`: constant angular acceleration up and down, the same lock as a
 *   rate-limited first-order correction.
 */
import { type Spring, TAU, ease, mod, settle, wrapHalf } from '../math.ts';
import type { SyncInfo } from '../ports.ts';
import { CF, type SpinMode, type TrayView, pocketAngle } from './packets.ts';

export type PhaseWord = 'idle' | 'filling' | 'spinning up' | 'in sync' | 'spinning down';


export interface SpinIO {
  readonly now: number;
  sync(): SyncInfo;
  /** Whether the receiver can take a packet that reaches it `lead` s after the gate opens. */
  canRelease(lead: number): boolean;
  readonly tray: TrayView;
}

export interface SpinController {
  /** The controller's own state, plain data (determinism snapshots); its shape is private. */
  readonly state: unknown;
  readonly mode: SpinMode;
  /** Rotor angle (unwrapped, never decreasing) and speed, rad/s. */
  readonly A: number;
  readonly w: number;
  readonly inSync: boolean;
  readonly phase: PhaseWord;
  /** The in-sync speed (rad/s) for the current quantum period. */
  readonly syncW: number;
  step(h: number, io: SpinIO): void;
}

export interface ControllerOptions {
  /** Packets held before the spin (default RATES.HOLD). */
  hold?: number;
}

const { POCKETS, ALPHA, SPOUT, GATE, TA, IDX_TAU, LEAD } = CF;
/** Rest angle: a pocket centred under the throat. */
const A0 = SPOUT - 0.5 * ALPHA;

/** What every controller here keeps (each adds its own speed state). */
interface Base {
  mode: SpinMode;
  A: number;
  w: number;
  /** Index target angle and the index spring. */
  target: number;
  ang: Spring;
  inSync: boolean;
  syncFor: number;
  prevRel: number | null;
  /** The receiver's quantum phase, unwrapped. */
  S: number;
  prevP: number | null;
  rate: number;
  emptyFor: number;
  phase: PhaseWord;
}

const base = (): Base => ({
  mode: 'index',
  A: A0,
  w: 0,
  target: A0,
  ang: { x: A0, v: 0 },
  inSync: false,
  syncFor: 0,
  prevRel: null,
  S: 0,
  prevP: null,
  rate: 0,
  emptyFor: 0,
  phase: 'idle',
});

/**
 * Read the receiver's phase, unwrapped into S (the period is known, so the rate is exact); S
 * starts at the phase itself. Returns the lock error e (in pockets, wrapped to ±½): how far the
 * next release is from landing on the receiver's quantum.
 */
function track(s: Base, io: SpinIO): number {
  const q = io.sync();
  if (s.prevP === null) s.S = q.phase;
  let dp = s.prevP === null ? 0 : q.phase - s.prevP;
  if (dp < -0.5) dp += 1;
  if (dp > 0.5) dp -= 1;
  s.prevP = q.phase;
  s.S += dp;
  s.rate = 1 / q.period;
  // The release starts with the pocket a little before the gate, so it is centred as it leaves.
  const uRel = (s.A - (GATE - (s.w * TA) / 2)) / ALPHA + 0.5;
  return wrapHalf(s.S + LEAD / q.period - uRel);
}

/** The index phase (every controller): aim, drop, creep; returns true when the spin starts. */
function index(s: Base, dt: number, io: SpinIO, HOLD: number): boolean {
  const tray = io.tray;
  const head = tray.head();
  if (head && head.want < 0 && !tray.busy()) {
    let bestK = -1;
    let bestNeed = 0;
    for (let k = 0; k < POCKETS; k++) {
      if (tray.occupied(k) || tray.reserved(k)) continue;
      const ahead = mod(SPOUT - pocketAngle(k, s.A), TAU);
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
  if (head && head.want >= 0 && !tray.busy()) {
    const FALL = tray.fallOf(head);
    const e0 = s.A - s.target;
    const eLand = (e0 + (s.ang.v + e0 / IDX_TAU) * FALL) * Math.exp(-FALL / IDX_TAU);
    if (Math.abs(eLand) < 0.02) tray.drop(head.want);
  }
  const idle = !tray.queued() && !tray.busy() && !tray.anyReserved();
  if (idle) s.target += 0.12 * dt;
  s.ang.x = s.A;
  settle(s.ang, s.target, dt, IDX_TAU);
  s.A = s.ang.x;
  s.w = s.ang.v;
  const quiet = io.now - tray.lastLanding() > 4;
  const n = tray.held();
  let start = false;
  if (!tray.busy() && !tray.anyReserved() && (n >= HOLD || (n > 0 && quiet && !tray.queued()))) {
    s.mode = 'spin';
    start = true;
    // The tray moves under the throat now: a pocket aimed before the spin means nothing after.
    tray.clearTargets();
  }
  // A packet falling into a pocket counts as filling (M4 blinked to idle when the throat
  // emptied before it landed).
  s.phase = n || tray.queued() || tray.busy() ? 'filling' : 'idle';
  return start;
}

/**
 * After the spin's speed update (A already advanced): sync bookkeeping (relErr and e from before
 * the update), one release per gate crossing while in sync, and the switch to spin-down once the
 * tray has been empty for 0.6 s.
 */
function spinTail(s: Base, dt: number, io: SpinIO, relErr: number, e: number) {
  const tray = io.tray;
  s.syncFor = relErr < 0.04 && Math.abs(e) < 0.05 ? s.syncFor + dt : 0;
  if (!s.inSync && s.syncFor > 0.35) s.inSync = true;
  if (s.inSync && (Math.abs(e) > 0.15 || relErr > 0.12)) s.inSync = false;
  const uNow = (s.A - (GATE - (s.w * TA) / 2)) / ALPHA + 0.5;
  if (s.inSync && s.prevRel !== null && Math.floor(uNow) > Math.floor(s.prevRel)) {
    const k = mod(-Math.round(uNow), POCKETS);
    // Backpressure from the receiver: the packet stays in its pocket and comes round again.
    if (tray.occupied(k) && io.canRelease(LEAD)) tray.release(k);
  }
  s.prevRel = uNow;
  // §A: no drops into passing pockets while spinning (v2 L1130–1143 removed).
  s.phase = s.inSync ? 'in sync' : 'spinning up';
  // Addendum: the throat may still hold packets (intake closed), so it is not part of "empty".
  s.emptyFor = !tray.held() && !tray.busy() && !tray.releasing() ? s.emptyFor + dt : 0;
  if (s.inSync && s.emptyFor > 0.6) {
    s.mode = 'down';
    s.inSync = false;
    s.prevRel = null;
  }
}

/** During spin-down, below 0.5 rad/s: index again, coasting onto the next pocket at rest. */
function downTail(s: Base, io: SpinIO) {
  s.phase = 'spinning down';
  if (s.w >= 0.5) return;
  const tray = io.tray;
  s.mode = 'index';
  s.ang.x = s.A;
  s.ang.v = s.w;
  const coast = s.A + s.w * IDX_TAU;
  s.target = A0 + Math.ceil((coast - A0) / ALPHA) * ALPHA;
  s.phase = tray.held() || tray.queued() || tray.busy() ? 'filling' : 'idle';
}

/** One direction (addendum): the tray never turns back. */
function forward(s: Base, Aprev: number) {
  if (s.A >= Aprev) return;
  s.A = Aprev;
  s.ang.x = Aprev;
  if (s.ang.v < 0) s.ang.v = 0;
  if (s.w < 0) s.w = 0;
}

function view<S extends Base>(s: S, step: (dt: number, io: SpinIO) => void): SpinController {
  return {
    state: s,
    get mode() {
      return s.mode;
    },
    get A() {
      return s.A;
    },
    get w() {
      return s.w;
    },
    get inSync() {
      return s.inSync;
    },
    get phase() {
      return s.phase;
    },
    get syncW() {
      return ALPHA * s.rate;
    },
    step,
  };
}

/** The default: M4's spin model (v2's speed spring and lock). */
export function createSpinController(o: ControllerOptions = {}): SpinController {
  const HOLD = o.hold ?? CF.HOLD;
  const s = { ...base(), spd: { x: 0, v: 0 } as Spring };
  return view(s, (dt, io) => {
    const e = track(s, io);
    const syncW = ALPHA * s.rate;
    const Aprev = s.A;
    if (s.mode === 'index') {
      if (index(s, dt, io, HOLD)) {
        s.spd.x = s.w;
        s.spd.v = 0;
      }
    } else if (s.mode === 'spin') {
      const relErr = Math.abs(s.w - syncW) / syncW;
      const lock = ease((0.18 - relErr) / 0.12);
      settle(s.spd, syncW + ALPHA * 1.4 * e * lock, dt, 0.4);
      s.w = s.spd.x;
      s.A += s.w * dt;
      spinTail(s, dt, io, relErr, e);
    } else {
      settle(s.spd, 0, dt, 0.7);
      s.w = s.spd.x;
      s.A += s.w * dt;
      downTail(s, io);
    }
    forward(s, Aprev);
  });
}

/**
 * A second spin model: the motor ramps at a constant angular acceleration (up in `up` s, down in
 * `down` s at the in-sync speed), and the lock is a rate-limited first-order correction of the
 * speed toward syncW + 1.4·α·e. Same index and release rules (and tests) as the default.
 */
export function createRampController(o: ControllerOptions & { up?: number; down?: number } = {}): SpinController {
  const HOLD = o.hold ?? CF.HOLD;
  const up = o.up ?? 2.4;
  const down = o.down ?? 1.2;
  const s = base();
  return view(s, (dt, io) => {
    const e = track(s, io);
    const syncW = ALPHA * s.rate;
    const Aprev = s.A;
    if (s.mode === 'index') {
      index(s, dt, io, HOLD);
    } else if (s.mode === 'spin') {
      const relErr = Math.abs(s.w - syncW) / syncW;
      const lock = ease((0.18 - relErr) / 0.12);
      const want = syncW + ALPHA * 1.4 * e * lock;
      const acc = (syncW / up) * dt;
      s.w = Math.max(0, s.w + Math.max(-acc, Math.min(acc, want - s.w)));
      s.A += s.w * dt;
      spinTail(s, dt, io, relErr, e);
    } else {
      s.w = Math.max(0, s.w - (syncW / down) * dt);
      s.A += s.w * dt;
      downTail(s, io);
    }
    forward(s, Aprev);
  });
}
