/**
 * The centrifuge's spin model: when the tray turns, how fast, and when packets drop in or leave.
 * A controller has state `{ mode, A, w, … }` and one `step(h, io)`; the packet side (`packets.ts`)
 * is the same for every controller, and so are the tests, so a different spin model (after the
 * final-scene review) is a new controller here.
 *
 * The default (`createSpinController`) is M4's: v2's index/spin/down with the user's §A lock
 * (notes/M4-plan.md):
 * - index: aim the nearest free pocket under the throat, drop when the predicted landing error is
 *   small, creep while idle; spin at HOLD held (or 4 s quiet with packets held);
 * - spin: phase-locked to the receiver's quanta (`sync`), one release per gate crossing while in
 *   sync and the receiver can take it (`canRelease`); the intake stays closed;
 * - down: once empty for 0.6 s, settle to rest on a pocket, then index again.
 * The tray never turns back.
 */
import { CF, type SpinMode, type TrayView, ease, pocketAngle } from './packets.ts';

export type PhaseWord = 'idle' | 'filling' | 'spinning up' | 'in sync' | 'spinning down';

/** The receiver's quanta: `phase` wraps 0 → 1 once per `period` seconds. */
export interface SyncInfo {
  phase: number;
  period: number;
}

export interface SpinIO {
  readonly now: number;
  sync(): SyncInfo;
  /** Whether the receiver can take a packet that reaches it `lead` s after the gate opens. */
  canRelease(lead: number): boolean;
  readonly tray: TrayView;
}

interface Spring {
  x: number;
  v: number;
}

/** The default controller's state (plain data). */
export interface SpinState {
  mode: SpinMode;
  A: number;
  w: number;
  target: number;
  ang: Spring;
  spd: Spring;
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

export interface SpinController {
  readonly state: SpinState;
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

const TAU = Math.PI * 2;
const { POCKETS, ALPHA, SPOUT, GATE, TA, IDX_TAU, LEAD } = CF;
const mod = (a: number, n: number) => ((a % n) + n) % n;
const wrapHalf = (x: number) => x - Math.round(x);

/** Critically damped spring toward `target` (v2 `settle`, 4 substeps). */
export function settle(s: Spring, target: number, dt: number, tau: number) {
  const w = 1 / tau;
  const h = dt / 4;
  for (let i = 0; i < 4; i++) {
    s.v += (w * w * (target - s.x) - 2 * w * s.v) * h;
    s.x += s.v * h;
  }
}

export function createSpinController(o: { hold?: number } = {}): SpinController {
  const HOLD = o.hold ?? CF.HOLD;
  const A0 = SPOUT - 0.5 * ALPHA;
  const s: SpinState = {
    mode: 'index',
    A: A0,
    w: 0,
    target: A0,
    ang: { x: A0, v: 0 },
    spd: { x: 0, v: 0 },
    inSync: false,
    syncFor: 0,
    prevRel: null,
    S: 0,
    prevP: null,
    rate: 0,
    emptyFor: 0,
    phase: 'idle',
  };
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
    step(dt, io) {
      const now = io.now;
      const tray = io.tray;
      // The receiver's quantum phase, unwrapped into S (the period is known, so the rate is exact).
      // S starts at the phase itself (v2 started it at 0, so its lock aimed at an arbitrary offset).
      const q = io.sync();
      if (s.prevP === null) s.S = q.phase;
      let dp = s.prevP === null ? 0 : q.phase - s.prevP;
      if (dp < -0.5) dp += 1;
      if (dp > 0.5) dp -= 1;
      s.prevP = q.phase;
      s.S += dp;
      s.rate = 1 / q.period;
      const period = q.period;

      const syncW = ALPHA * s.rate;
      // The release starts with the pocket a little before the gate, so it is centred as it leaves.
      const delta = (s.w * TA) / 2;
      const uRel = (s.A - (GATE - delta)) / ALPHA + 0.5;
      const e = wrapHalf(s.S + LEAD / period - uRel);
      const Aprev = s.A;
      if (s.mode === 'index') {
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
        const quiet = now - tray.lastLanding() > 4;
        const n = tray.held();
        if (!tray.busy() && !tray.anyReserved() && (n >= HOLD || (n > 0 && quiet && !tray.queued()))) {
          s.mode = 'spin';
          s.spd.x = s.w;
          s.spd.v = 0;
          // The tray moves under the throat now: a pocket aimed before the spin means nothing after.
          tray.clearTargets();
        }
        // A packet falling into a pocket counts as filling (M4 blinked to idle when the throat
        // emptied before it landed).
        s.phase = n || tray.queued() || tray.busy() ? 'filling' : 'idle';
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
      } else {
        settle(s.spd, 0, dt, 0.7);
        s.w = s.spd.x;
        s.A += s.w * dt;
        s.phase = 'spinning down';
        if (s.w < 0.5) {
          s.mode = 'index';
          s.ang.x = s.A;
          s.ang.v = s.w;
          const coast = s.A + s.w * IDX_TAU;
          const base = SPOUT - 0.5 * ALPHA;
          s.target = base + Math.ceil((coast - base) / ALPHA) * ALPHA;
          s.phase = tray.held() || tray.queued() || tray.busy() ? 'filling' : 'idle';
        }
      }
      // One direction (addendum): the tray never turns back.
      if (s.A < Aprev) {
        s.A = Aprev;
        s.ang.x = Aprev;
        if (s.ang.v < 0) s.ang.v = 0;
        if (s.w < 0) s.w = 0;
      }
    },
  };
}
