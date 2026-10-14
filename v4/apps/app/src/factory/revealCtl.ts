/**
 * The factory's reveal as played in the app (notes/M10-plan.md §3, the user's redesign): the
 * plan (`revealPlan`), the reveal clock running forward (the phone opens) or backward (it
 * conceals), and the sim's hold. The sim waits while the phone is not fully open; a reveal from
 * the closed phone restarts it at t = 0 (nothing in flight, under the closed lid). The frame
 * hook in `RevealDriver.tsx` writes the poses, the lid and the clip volume; the dev hook
 * `__v4.reveal` and the `reveal`/`conceal` chip drive it. Plain module.
 */
import { FACTORY_LAYOUT, revealPlan } from '@anatomy/engine';
import { factoryLive } from './live.ts';

export const REVEAL_PLAN = revealPlan(FACTORY_LAYOUT);

type Listener = () => void;

const state = {
  /** Reveal time (s): 0 closed, `end` open and assembled. */
  t: 0,
  /** +1 revealing, −1 concealing, 0 still. */
  dir: 0 as -1 | 0 | 1,
  /** Poses must be (re)written: a seek, a skip or a restart while still. */
  dirty: true,
};
const listeners = new Set<Listener>();
const notify = () => {
  for (const cb of listeners) cb();
};

const hold = (on: boolean) => {
  factoryLive.ctl.hold = on;
};

export const revealCtl = {
  plan: REVEAL_PLAN,
  get t() {
    return state.t;
  },
  get playing() {
    return state.dir !== 0;
  },
  /** Open (fully assembled) or heading there. */
  get opening() {
    return state.dir > 0 || (state.dir === 0 && state.t >= REVEAL_PLAN.end);
  },
  /** Whether anything moves or must be written this frame. */
  get active() {
    return state.dir !== 0 || state.dirty;
  },
  /** Advance by dt (scene seconds); returns the time to pose at. */
  advance(dt: number): number {
    if (state.dir === 0) return state.t;
    state.t = Math.min(REVEAL_PLAN.end, Math.max(0, state.t + state.dir * dt));
    if (state.t >= REVEAL_PLAN.end && state.dir > 0) {
      state.dir = 0;
      hold(false);
      notify();
    } else if (state.t <= 0 && state.dir < 0) {
      state.dir = 0;
      notify();
    }
    return state.t;
  },
  /** The driver wrote the poses for a still state. */
  written() {
    state.dirty = false;
  },
  /** Open the phone (from wherever it is; from closed the sim restarts at 0). */
  reveal() {
    if (state.t <= 0) factoryLive.restart(0);
    state.dir = 1;
    state.dirty = true;
    hold(true);
    notify();
  },
  /** Close it again: the reveal played backwards (the sim waits). */
  conceal() {
    state.dir = -1;
    state.dirty = true;
    hold(true);
    notify();
  },
  /** From the closed phone, revealing. */
  restart() {
    state.t = 0;
    revealCtl.reveal();
  },
  play() {
    if (state.t >= REVEAL_PLAN.end) revealCtl.restart();
    else revealCtl.reveal();
  },
  /** Jump to open and assembled (the sim runs). */
  skip() {
    state.t = REVEAL_PLAN.end;
    state.dir = 0;
    state.dirty = true;
    hold(false);
    notify();
  },
  /** Scrub: pose at s (0..1 of the plan: 0 closed, 1 assembled), still there; the sim waits until 1. */
  seek(s: number) {
    if (!(s >= 0 && s <= 1)) throw new Error(`reveal.seek ${s}: use 0–1`);
    state.t = s * REVEAL_PLAN.end;
    state.dir = 0;
    state.dirty = true;
    hold(s < 1);
    notify();
  },
  state: () => ({ t: Number(state.t.toFixed(3)), end: Number(REVEAL_PLAN.end.toFixed(3)), dir: state.dir, lid: REVEAL_PLAN.lid.t2, order: REVEAL_PLAN.order }),
  subscribe(cb: Listener) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  getSnapshot: () => `${state.dir}|${state.t >= REVEAL_PLAN.end}`,
};
