/**
 * The centrifuge's live state: the sim, playback controls, the card readout and the dev hook.
 * A module singleton (plain module, Fast Refresh boundary rule): switching view, scene or theme
 * resumes the sim where it was; an edit of this module or of the sim restarts it at t = 0.
 */
import { type Status, createCentrifugeSim } from '@anatomy/engine';
import { createReadout } from '../../overlay/readout.ts';

export const sim = createCentrifugeSim();

/** Playback: the frame loop advances the sim by dt · speed unless paused. */
export const ctl = { paused: false, speed: 1 };

const format = (s: Status) => `held ${s.held}/10 · ${s.rpm.toFixed(1)} rpm · ${s.phase}`;
export const readout = createReadout<Status>(100, format, (s) => s.phase, sim.status());

/** `__v4.sim` in dev builds: deterministic time control (immune to rAF throttling). */
export const dev = {
  /** Restart, run to t seconds (uncapped), pause there. */
  seek(t: number) {
    sim.reset();
    sim.run(t);
    ctl.paused = true;
    readout.flush(sim.status());
    return sim.status();
  },
  pause() {
    ctl.paused = true;
  },
  play() {
    ctl.paused = false;
  },
  speed(x: number) {
    if (!(x >= 0.25 && x <= 4)) throw new Error(`speed ${x}: use 0.25–4`);
    ctl.speed = x;
  },
  /** Restart with another seed (the kinds rotate; the timing is the same). */
  seed(n: number) {
    sim.reset(n);
    readout.flush(sim.status());
  },
  status: () => sim.status(),
  log: () => sim.state.log.map((x) => `${x.t.toFixed(2)} ${x.phase}`).join('\n'),
  /** false = the belt refuses releases (backpressure test); true = normal. */
  release(on: boolean) {
    sim.canRelease = on ? null : () => false;
  },
};
