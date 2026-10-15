/**
 * The centrifuge machine (v2 `parts/centrifuge/centrifuge.mjs` centrifugeLive, with the user's
 * §A correction, notes/M4-plan.md): the packet side (`packets.ts`) plus a swappable spin model
 * (`controller.ts`), between a real feeder belt (its `in`) and a real receiver (its `out`).
 *
 * Injected: `sync` (the receiver's quanta: phase and period), `canRelease` (default: the out
 * port's `canAccept(lead)`, i.e. the loop's `canTake`) and HOLD (via the controller).
 */
import type { Clock, Machine } from '../clock.ts';
import type { PoseSource } from '../items.ts';
import { type Spring, TAU, ease, settle } from '../math.ts';
import { type OutPort, type Located, type Receiver, type SyncInfo, type V3, createOut } from '../ports.ts';
import { type PhaseWord, type SpinController, type SpinIO, createSpinController } from './controller.ts';
import { CF, type SpinMode, type Tray, type TrayState, createTray } from './packets.ts';

export { CF, type SpinMode } from './packets.ts';
export {
  type ControllerOptions,
  type PhaseWord,
  type SpinController,
  type SpinIO,
  createRampController,
  createSpinController,
} from './controller.ts';

/** Phase log entries kept (the oldest drop off). */
const LOG_MAX = 200;

export interface Status {
  t: number;
  held: number;
  rpm: number;
  phase: PhaseWord;
  queued: number;
  inSync: boolean;
  mode: SpinMode;
}

export interface Outputs {
  /** Rotor angle (unwrapped; the rest angle is CF.restAngle). */
  rotor: number;
  motor: number;
  /** Gate opening 0..1 (lift = CF.gateLift · open, crank kick = 60° · open). */
  open: number;
  /** Needle share: w / sync speed (the dial reads 0.7 · share of its sweep). */
  share: number;
  lamp: number;
}

/** The machine's own state (the controller keeps its own: `controller.state`). */
export interface CentrifugeState {
  tray: TrayState;
  log: { t: number; phase: PhaseWord }[];
  motorA: number;
  lamp: Spring;
  needle: Spring;
}

export interface CentrifugeOptions {
  id: string;
  origin: V3;
  /** The receiver's quanta (the loop's `phaseAt` the in point; a fixed clock in tests). */
  sync: () => SyncInfo;
  /** Default: `outs.out.ready(lead)`. */
  canRelease?: (lead: number) => boolean;
  /** Packets held before the spin (default RATES.HOLD). */
  hold?: number;
  /** Another spin model (default: M4's index/spin/down; `hold` is then the controller's). */
  controller?: SpinController;
}

export interface Centrifuge extends Machine, Located, Receiver, PoseSource {
  /** Pool sizes the blocks need (read at mount). */
  readonly pools: { readonly packets: number };
  readonly state: CentrifugeState;
  readonly tray: Tray;
  readonly controller: SpinController;
  readonly outs: { out: OutPort };
  /** Dev/test override of the receiver's answer: false holds every release; null = the receiver. */
  releaseOverride: boolean | null;
  status(out?: Status): Status;
  /** Rotor and motor extrapolated by w · acc (smooth at any display rate). */
  outputs(out: Outputs): Outputs;
}

const burst = (age: number, rise: number, fall: number) =>
  age < 0 ? 0 : age < rise ? ease(age / rise) : Math.exp(-(age - rise) / fall);
const openAt = (age: number) =>
  age < 0 ? 0 : age < 0.08 ? ease(age / 0.08) : age < CF.TA + 0.12 ? 1 : 1 - ease((age - CF.TA - 0.12) / 0.25);

export function createCentrifuge(clock: Readonly<Clock>, o: CentrifugeOptions): Centrifuge {
  if (o.controller && o.hold !== undefined) throw new Error(`${o.id}: pass hold to the controller, not with one`);
  const ctl = o.controller ?? createSpinController(o.hold !== undefined ? { hold: o.hold } : {});
  const tray = createTray(clock, ctl);
  // Asks first: a release waits for the receiver's `canAccept(lead)` (via canRelease).
  const out = createOut(o, 'out', { asks: true });
  const state: CentrifugeState = {
    tray: tray.state,
    log: [{ t: 0, phase: ctl.phase }],
    motorA: 0,
    lamp: { x: 0, v: 0 },
    needle: { x: 0, v: 0 },
  };
  const canRelease = o.canRelease ?? ((lead: number) => out.ready(lead));
  const io: SpinIO = {
    get now() {
      return clock.t;
    },
    sync: o.sync,
    canRelease: (lead) => (c.releaseOverride === null ? canRelease(lead) : c.releaseOverride),
    tray,
  };
  const c: Centrifuge = {
    pools: { packets: CF.capacity },
    id: o.id,
    origin: o.origin,
    state,
    tray,
    controller: ctl,
    outs: { out },
    releaseOverride: null,
    // §A: the intake throws when closed, so belt B must hold (ask) before handing on.
    strict: true,
    canAccept: () => tray.canAccept(),
    accept: (item, from) => tray.accept(item, from),
    step(h) {
      tray.step(h, ctl.A, out);
      const before = ctl.phase;
      ctl.step(h, io);
      if (ctl.phase !== before) {
        state.log.push({ t: clock.t, phase: ctl.phase });
        if (state.log.length > LOG_MAX) state.log.splice(0, state.log.length - LOG_MAX);
      }
      state.motorA += ctl.w * (5.5 / 4) * h;
      settle(state.lamp, ctl.inSync ? 0.45 : 0, h, 0.25);
      settle(state.needle, ctl.syncW > 0 ? ctl.w / ctl.syncW : 0, h, 0.25);
    },
    alive: () => tray.alive(),
    status(o2) {
      const s = o2 ?? ({} as Status);
      s.t = clock.t;
      s.held = tray.held();
      s.rpm = (Math.max(0, ctl.w) * 60) / TAU;
      s.phase = ctl.phase;
      s.queued = tray.queued();
      s.inSync = ctl.inSync;
      s.mode = ctl.mode;
      return s;
    },
    outputs(r) {
      const w = Math.max(0, ctl.w);
      const acc = clock.acc;
      const age = clock.t + acc - tray.state.releaseAt;
      r.rotor = ctl.A + w * acc;
      r.motor = state.motorA + w * (5.5 / 4) * acc;
      r.open = openAt(age);
      r.share = state.needle.x;
      r.lamp = Math.min(1.2, state.lamp.x + 0.5 * burst(age, 0.05, 0.2));
      return r;
    },
    poses(cb) {
      const acc = clock.acc;
      return tray.poses(cb, clock.t + acc, ctl.A + Math.max(0, ctl.w) * acc);
    },
  };
  return c;
}
