/**
 * Film mode (M12, notes/M12-plan.md): the scripted shots of the inception loop video, DEV only
 * and off by default. Plain module (the Fast Refresh boundary rule).
 *
 * - Part 1 (web, frame-stepped over CDP): the open factory at F held, the M11 tour without its
 *   reveal, the conceal, a move to the top-down camera C1 over the closed glass, a hold.
 * - Part 2 (the iOS simulator, real time): armed at C0 (the glass covers the screen, the rendered
 *   island under the simulator's Dynamic Island, the logo at Part 1's last angle), then the splash,
 *   the pull-out (a phone inside the phone), the tilt to F, the reveal (the sim held at 0) and the
 *   settle.
 *
 * The timeline advances on the scene's dt in `FilmDriver`'s frame hook and writes the camera
 * through the shell; the eases read the film clock (`setClock`) and lines are drawn in
 * proportion to the 16:9 band (`setLines`). The app reads `snapshot()` (bare, chrome off,
 * light, the film frame; the screen art draws the iOS status bar and the Dynamic Island,
 * `SCREEN_STATUS_BAR`). The simulator's own status bar can't be hidden on iOS 27 with scenes, so
 * it stays and the rendered one continues into it. Every `__v4.film` call is synchronous except
 * `step()` (Hermes' `debugger-evaluate` does not await).
 */
import {
  type CameraState,
  FACTORY_LAYOUT,
  FILM,
  type FrameSpec,
  type Glass,
  cameraLerp,
  filmFrame,
  filmGeometry,
  filmLineScale,
  lidPose,
  revealPlan,
  screenCamera,
  simCamera,
  smootherstep,
} from '@anatomy/engine';
import type { Shell, ShellSize } from '../shell/createShell.ts';
import { factoryLive } from '../factory/live.ts';
import { revealCtl } from '../factory/revealCtl.ts';
import { tourCtl } from '../factory/tour.ts';
import { PHONE, displayDims } from '../machines/phone/dims.ts';

type Platform = 'web' | 'sim';
type Shot =
  | 'idle'
  | 'p1.open'
  | 'p1.tour'
  | 'p1.conceal'
  | 'p1.path'
  | 'p1.hold'
  | 'p1.done'
  | 'p2.armed'
  | 'p2.splash'
  | 'p2.pull'
  | 'p2.tilt'
  | 'p2.reveal'
  | 'p2.settle'
  | 'p2.done';

/** Shot lengths (s), plan §1. */
export const SHOTS = {
  open: 2.0,
  path: 2.5,
  hold: 0.5,
  splash: 1.0,
  pull: 1.4,
  tilt: 2.0,
  /** The settle after the reveal: 0.5 still, then the compositor's zoom (Z). */
  settle: 0.5 + 2.0,
  /** The pull-out's zoom, times C0's. */
  pullZoom: 0.6,
} as const;

/**
 * The logo's turn (rad/s, the dispenser's `SPIN`). In film mode it turns on the film clock, held
 * sim or not: from 0 in Part 1, from Part 1's last angle (φ1) in Part 2. At F the floating display's
 * logo is outside the band (checkpoint B), so the loop seam needs no particular angle.
 */
const SPIN = 0.32;
/** The lamps' fade at the conceal (s). */
const LAMP_FADE = 1.0;

/** The closed phone's glass in world units (the display's glass at the lid's closed offset). */
function closedGlass(): Glass {
  const D = displayDims(PHONE);
  const off = lidPose(revealPlan(FACTORY_LAYOUT), 0, [0, 0, 0]);
  const cx = D.sx + off[0];
  const cy = D.sy + off[1];
  if (Math.abs(cx) > 1e-6 || Math.abs(cy) > 1e-6) throw new Error(`film: the closed glass is not centred (${cx}, ${cy})`);
  return { w: D.c.w - 1.6, d: D.c.d - 1.6, r: D.c.r - 0.8, z: D.Z2 + off[2] };
}

export interface FilmSnapshot {
  platform: Platform;
  frame: FrameSpec;
}

type Listener = () => void;
const listeners = new Set<Listener>();
let snap: FilmSnapshot | null = null;
const publish = (next: FilmSnapshot | null) => {
  snap = next;
  for (const cb of listeners) cb();
};

const copy = (c: CameraState): CameraState => ({ ...c, target: [...c.target] });
const r = (x: number, n = 4) => Number(x.toFixed(n));
const DEG = 180 / Math.PI;

const s = {
  shell: null as Shell | null,
  size: null as (() => ShellSize | null) | null,
  platform: 'web' as Platform,
  shot: 'idle' as Shot,
  /** Film time (s) and the time the current shot began. */
  t: 0,
  t0: 0,
  frame: 0,
  dy: 0,
  glass: null as Glass | null,
  geo: null as ReturnType<typeof filmGeometry> | null,
  /** Cameras: F (the fit in the band), C1 (web, top-down), C0 / C0′ (sim). */
  F: null as CameraState | null,
  C: null as CameraState | null,
  C2: null as CameraState | null,
  from: null as CameraState | null,
  cam: { target: [0, 0, 0], yaw: 0, elevation: 0, zoom: 1 } as CameraState,
  refFit: 1,
  lineScale: 1,
  /** The logo: its angle now, Part 1's last angle (φ1, the arm value on the sim). */
  logo: 0,
  phi1: 0,
  /** The sim's hold began at film time (the nucleus's tap pulse keeps decaying meanwhile). */
  heldAt: -1,
  marks: {} as Record<string, number>,
  done: false,
};

const need = () => {
  if (!s.shell || !s.size) throw new Error('film: no stage (open the factory scene)');
  const size = s.size();
  if (!size) throw new Error('film: no layout yet');
  return { shell: s.shell, size };
};

function enter(shot: Shot) {
  s.shot = shot;
  s.t0 = s.t;
  s.marks[shot] = s.frame;
}


/** Called from `FilmDriver`'s frame hook (first in the factory scene's hooks). */
function frame(dt: number) {
  if (s.shot === 'idle' || s.shot === 'p1.done' || s.shot === 'p2.armed' || s.shot === 'p2.done') return;
  const shell = s.shell;
  if (!shell) return;
  s.t += dt;
  s.frame++;
  const el = s.t - s.t0;
  switch (s.shot) {
    case 'p1.open':
      if (el >= SHOTS.open - 1e-9) {
        enter('p1.tour');
        factoryLive.ctl.hold = false;
        tourCtl.play({ from: 1, reveal: false });
      }
      break;
    case 'p1.tour':
      if (!tourCtl.active) {
        enter('p1.conceal');
        revealCtl.conceal();
        s.heldAt = s.t;
      }
      break;
    case 'p1.conceal':
      if (!revealCtl.playing && revealCtl.t <= 0) {
        enter('p1.path');
        s.from = shell.camera();
      }
      break;
    case 'p1.path': {
      const u = Math.min(1, el / SHOTS.path);
      shell.setCamera(cameraLerp(s.from!, s.C!, smootherstep(u), s.cam));
      if (u >= 1) enter('p1.hold');
      break;
    }
    case 'p1.hold':
      if (el >= SHOTS.hold - 1e-9) {
        enter('p1.done');
        s.done = true;
      }
      break;
    case 'p2.splash':
      if (el >= SHOTS.splash) enter('p2.pull');
      break;
    case 'p2.pull': {
      const u = Math.min(1, el / SHOTS.pull);
      shell.setCamera(cameraLerp(s.C!, s.C2!, smootherstep(u), s.cam));
      if (u >= 1) enter('p2.tilt');
      break;
    }
    case 'p2.tilt': {
      const u = Math.min(1, el / SHOTS.tilt);
      shell.setCamera(cameraLerp(s.C2!, s.F!, smootherstep(u), s.cam));
      if (u >= 1) {
        enter('p2.reveal');
        revealCtl.reveal({ holdAfter: true });
      }
      break;
    }
    case 'p2.reveal':
      if (!revealCtl.playing && revealCtl.t >= revealCtl.plan.end) enter('p2.settle');
      break;
    case 'p2.settle':
      if (el >= SHOTS.settle) {
        enter('p2.done');
        s.done = true;
      }
      break;
    default:
      break;
  }
  s.logo = s.phi1 + SPIN * s.t;
}

/** The view setter the tour uses in film mode: straight to the shell, eased on the film clock. */
const tourView = (name: string) => s.shell?.setView(name, { ease: true });

const api = {
  /** Film mode on: bare, chrome off, light, the film frame, lines by the band; the camera at F. */
  enable(o: { platform: Platform }) {
    const { shell, size } = need();
    s.platform = o.platform;
    s.glass = closedGlass();
    s.geo = filmGeometry(s.glass, { width: Math.round(size.width * size.dpr), height: Math.round(size.height * size.dpr), dpr: size.dpr });
    s.dy = o.platform === 'sim' ? s.geo.dy : 0;
    const vp = { width: size.width, height: size.height };
    const frame = filmFrame(vp, { dy: s.dy });
    s.lineScale = filmLineScale(vp);
    publish({ platform: o.platform, frame });
    shell.setTheme('light');
    shell.setFrame(frame);
    shell.setClock(() => s.t * 1000);
    shell.setView('fit');
    s.F = shell.camera();
    s.refFit = shell.refZoom();
    shell.setLines({ scale: s.lineScale, ref: s.refFit });
    tourCtl.overrideView(tourView);
    s.shot = 'idle';
    s.done = false;
    return api.state();
  },
  /** Back to the normal app (the camera eases back to the shell's view). */
  disable() {
    tourCtl.overrideView(null);
    tourCtl.stop();
    const shell = s.shell;
    if (shell) {
      shell.setManual(false);
      shell.setClock(null);
      shell.setLines(null);
      shell.resetView();
    }
    s.shot = 'idle';
    publish(null);
    return true;
  },
  /** Part 1 from its first frame: the sim at 0, open and held, the camera at F, manual on web. */
  part1() {
    const { shell, size } = need();
    if (!snap) throw new Error('film: enable() first');
    factoryLive.restart(0);
    factoryLive.ctl.paused = false;
    factoryLive.ctl.speed = 1;
    revealCtl.skip({ hold: true });
    tourCtl.stop();
    shell.setView('fit');
    s.F = shell.camera();
    s.C = screenCamera(s.glass!, { fill: 'height', size: size.height - 2 * 40 * (size.height / FILM.outH) });
    s.t = 0;
    s.frame = 0;
    s.marks = {};
    s.heldAt = -1;
    s.done = false;
    s.phi1 = 0;
    s.logo = 0;
    enter('p1.open');
    if (s.platform === 'web') shell.setManual(true);
    return api.state();
  },
  /** Web: one frame of 1/60 s; resolves when the GPU has drawn it. */
  step() {
    const { shell } = need();
    return shell.step(1 / FILM.fps);
  },
  /** Part 2 armed: closed, the sim at 0 and held, the camera at C0, the logo still at `logo`. */
  arm(o: { logo: number }) {
    const { shell, size } = need();
    if (!snap) throw new Error('film: enable() first');
    tourCtl.stop();
    factoryLive.restart(0);
    factoryLive.ctl.paused = false;
    factoryLive.ctl.speed = 1;
    revealCtl.seek(0);
    s.phi1 = o.logo;
    s.logo = o.logo;
    s.C = simCamera(s.glass!, size);
    s.C2 = { ...copy(s.C), zoom: s.C.zoom * SHOTS.pullZoom };
    s.F = shell.cameraFor('fit');
    shell.setCamera(s.C);
    s.t = 0;
    s.frame = 0;
    s.marks = {};
    s.heldAt = -1;
    s.done = false;
    s.shot = 'p2.armed';
    return api.state();
  },
  /** Part 2 runs (the splash, the pull-out, the tilt, the reveal, the settle). */
  go() {
    if (s.shot !== 'p2.armed') throw new Error('film: arm() first');
    s.F = s.shell!.cameraFor('fit');
    enter('p2.splash');
    return true;
  },
  /** Where everything is (JSON). */
  state() {
    const c = s.shell?.camera();
    const sizes = s.size?.();
    return {
      shot: s.shot,
      t: r(s.t, 5),
      frame: s.frame,
      logo: s.logo,
      camera: c ? { target: c.target.map((x) => r(x)), yaw: r(c.yaw * DEG), elevation: r(c.elevation * DEG), zoom: r(c.zoom, 6) } : null,
      reveal: revealCtl.state(),
      tour: tourCtl.state(),
      simT: r(factoryLive.graph().factory.clock.t, 4),
      ledger: { created: factoryLive.graph().factory.ledger.created, alive: factoryLive.graph().factory.alive() },
      done: s.done,
      marks: s.marks,
      platform: s.platform,
      size: sizes ?? null,
      refFit: r(s.refFit, 6),
      dy: r(s.dy, 6),
      glass: s.glass,
      lineScale: r(s.lineScale, 6),
      geo: s.geo && { G: s.geo.G, screen: s.geo.screen, scale: s.geo.scale, bandOut: s.geo.bandOut, S: s.geo.S, glassR: s.geo.glassR },
      F: s.F && { target: s.F.target.map((x) => r(x)), yaw: r(s.F.yaw * DEG), elevation: r(s.F.elevation * DEG), zoom: r(s.F.zoom, 6) },
    };
  },
  /** The simulator's screen in the output (px) at the splash (C0). */
  screenRect: () => s.geo?.screen ?? null,
};

export const filmCtl = {
  api,
  frame,
  /** The stage's shell and its layout (Stage.tsx); null on cleanup. */
  attach(shell: Shell | null, size: (() => ShellSize | null) | null) {
    s.shell = shell;
    s.size = size;
    if (!shell && snap) {
      s.shot = 'idle';
      publish(null);
    }
  },
  /** The logo's angle in film mode (null: the dispenser's own). */
  logo: (): number | null => (snap ? s.logo : null),
  /** The nucleus's tap age: in film mode it keeps growing while the sim is held after the tour. */
  tap: (simTap: number): number => (snap && s.heldAt >= 0 ? simTap + (s.t - s.heldAt) : simTap),
  /**
   * A lamp's glow level (the centrifuge's, the scanner's, the crusher's): in film mode it fades out over the first
   * second of the conceal (the factory powers down), so a glow sprite (depth-biased toward the
   * viewer) never shows through the closed lid where Part 2 starts from a sim at t = 0, lamps off.
   */
  lamp: (level: number): number => (snap && s.heldAt >= 0 ? level * Math.max(0, 1 - (s.t - s.heldAt) / LAMP_FADE) : level),
  subscribe(cb: Listener) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  snapshot: (): FilmSnapshot | null => snap,
};
