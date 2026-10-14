/**
 * The factory tour (M10 §5): an event-gated camera script for the 16:9 recording. Each step eases
 * to a view and stays there for at least `min` seconds, until its event (`until`) has happened, or
 * at most `max`; the sim runs at the step's speed meanwhile. It opens the phone first. Any user
 * view, scene or orbit input stops it. The frame hook in `TourDriver` (inside the factory scene)
 * advances it; the app registers the view setter. Plain module.
 */
import type { FactoryGraph } from '@anatomy/engine';
import { factoryLive } from './live.ts';
import { revealCtl } from './revealCtl.ts';

export interface TourStep {
  view: string;
  /** Sim speed while here (default 1). */
  speed?: number;
  /** The event that ends the step (after `min`). */
  until?: (g: FactoryGraph) => boolean;
  min: number;
  max: number;
}

/** First events come late at 1× (the centrifuge fills for ≈ 24 s): the waits run faster. */
export const TOUR: readonly TourStep[] = [
  // The phone opens; then the assembled factory.
  { view: 'fit', until: () => !revealCtl.playing && revealCtl.t >= revealCtl.plan.end, min: 2, max: 30 },
  { view: 'phone', min: 3, max: 3 },
  { view: 'dispenser-A', speed: 2, until: (g) => g.beltA.items.length > 0, min: 3, max: 10 },
  { view: 'A-packer', speed: 2, until: (g) => g.packer.stats.packets >= 1, min: 4, max: 14 },
  { view: 'packer-B', min: 3, max: 3 },
  { view: 'B-centrifuge', speed: 3, until: (g) => g.centrifuge.controller.mode === 'spin', min: 3, max: 30 },
  { view: 'centrifuge-audio', speed: 1, until: (g) => g.audio.items.length > 0, min: 3, max: 15 },
  { view: 'scanner-read', min: 3, max: 3 },
  { view: 'audio-C', speed: 2, until: (g) => g.audio.stats.dropped >= 1, min: 3, max: 20 },
  { view: 'C-crusher', speed: 2, until: (g) => g.crusher.stats().count >= 1, min: 3, max: 15 },
  { view: 'scanner-D', min: 3, max: 3 },
  { view: 'D-elevator', min: 3, max: 3 },
  { view: 'elevator-speaker', until: (g) => g.speaker.stats.heard >= 1, min: 4, max: 10 },
  { view: 'fit', min: 3, max: 3 },
];

type ViewSetter = (view: string) => void;

const state = { step: -1, el: 0, active: false };
let setView: ViewSetter | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const cb of listeners) cb();
};

function enter(i: number) {
  state.step = i;
  state.el = 0;
  const s = TOUR[i];
  if (!s) {
    state.active = false;
    factoryLive.ctl.speed = 1;
    notify();
    return;
  }
  factoryLive.ctl.speed = s.speed ?? 1;
  setView?.(s.view);
  notify();
}

export const tourCtl = {
  /** The app's view setter (eases; must not stop the tour). */
  register(fn: ViewSetter | null) {
    setView = fn;
  },
  get active() {
    return state.active;
  },
  play() {
    state.active = true;
    revealCtl.restart();
    enter(0);
  },
  stop() {
    if (!state.active) return;
    state.active = false;
    factoryLive.ctl.speed = 1;
    notify();
  },
  /** Advance by dt (scene seconds). */
  advance(dt: number) {
    if (!state.active) return;
    const s = TOUR[state.step];
    if (!s) return;
    state.el += dt;
    const done = !s.until || s.until(factoryLive.graph());
    if ((state.el >= s.min && done) || state.el >= s.max) enter(state.step + 1);
  },
  state: () => ({ active: state.active, step: state.step, view: TOUR[state.step]?.view ?? null, el: Number(state.el.toFixed(2)) }),
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  getSnapshot: () => `${state.active}|${state.step}`,
};
