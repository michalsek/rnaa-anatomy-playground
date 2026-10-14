/**
 * A scene's live state: its sim graph (rebuilt on seek), playback controls, the card readout and
 * the dev hook (`__v4.sim`). Module singletons (plain module, the Fast Refresh boundary rule):
 * switching view, scene or theme resumes the sim where it was; an edit of this module or of the
 * engine sim restarts it at t = 0.
 *
 * Every machine block's frame hook calls `step(f)` first: the first call in a frame advances the
 * graph (and publishes the readout), the others see the same frame and return, so each block
 * then writes poses from the same instant.
 */
import {
  type Centrifuge,
  type ConveyorPageGraph,
  type Factory,
  type FrameInfo,
  type LineGraph,
  CENTRIFUGE_LAYOUT,
  LINE_LAYOUT,
  createConveyorPage,
  createLine,
} from '@anatomy/engine';
import { type Readout, createReadout } from '../overlay/readout.ts';

/** What machine blocks need from a live scene. */
export interface LiveHandle {
  /** Advance the sim for this frame (idempotent per frame). */
  step(f: FrameInfo): void;
}

export interface Live<G> extends LiveHandle {
  graph(): G;
  ctl: { paused: boolean; speed: number };
  readout: Readout<G>;
  dev: object;
}

interface Graph {
  factory: Factory;
  centrifuge?: Centrifuge;
}

function createLive<G extends Graph>(
  build: (seed: number) => G,
  format: (g: G) => string,
  describe: (g: G, id: string) => unknown,
  /** The phase word (announced at once; the rest of the readout at most 10 times a second). */
  phase: (g: G) => string = (g) => g.centrifuge?.controller.phase ?? '',
): Live<G> {
  let seed = 0;
  let g = build(seed);
  /** The last frame stepped (FrameInfo.frame counts the store's ticks). */
  let lastFrame = -1;
  const ctl = { paused: false, speed: 1 };
  const readout = createReadout<G>(100, format, phase, g);
  const now = () => performance.now();
  const restart = (t: number) => {
    g = build(seed);
    if (t > 0) g.factory.run(t);
    readout.flush(g);
  };
  return {
    graph: () => g,
    ctl,
    readout,
    step(f) {
      if (f.frame === lastFrame) return;
      lastFrame = f.frame;
      g.factory.advance(ctl.paused ? 0 : f.dt, ctl.speed);
      readout.publish(g, now());
    },
    dev: {
      /** Restart, run to t seconds (uncapped), pause there. */
      seek(t: number) {
        if (!(t >= 0 && t <= 3600)) throw new Error(`seek ${t}: use 0–3600 s`);
        restart(t);
        ctl.paused = true;
        return describe(g, g.centrifuge ? 'centrifuge' : 'audio');
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
        if (!Number.isInteger(n) || n < 0 || n > 1e6) throw new Error(`seed ${n}: use an integer 0–1000000`);
        seed = n;
        restart(0);
      },
      /** A machine's state summary (default: the centrifuge); ids: `machines()`. */
      status: (id = g.centrifuge ? 'centrifuge' : 'audio') => describe(g, id),
      machines: () => g.factory.machines.map((m) => m.id),
      t: () => g.factory.clock.t,
      log: () => g.centrifuge?.state.log.map((x) => `${x.t.toFixed(2)} ${x.phase}`).join('\n') ?? '',
      /** false = the centrifuge's receiver refuses releases (backpressure test); true = normal. */
      release(on: boolean) {
        if (!g.centrifuge) throw new Error('no centrifuge in this scene');
        g.centrifuge.releaseOverride = on ? null : false;
      },
      /** Items created, alive, consumed (conservation). */
      ledger: () => ({ created: g.factory.ledger.created, alive: g.factory.alive(), consumed: g.factory.ledger.consumed }),
    },
  };
}

function describeAny(g: Partial<LineGraph & ConveyorPageGraph> & { factory: Factory }, id: string): unknown {
  switch (id) {
    case 'centrifuge':
      if (g.centrifuge) return g.centrifuge.status();
      break;
    case 'beltB':
    case 'beltC': {
      const b = g[id];
      if (b) return { t: g.factory.clock.t, items: b.items.length, held: b.held() };
      break;
    }
    case 'audio':
      if (g.audio) {
        const q = g.audio.quanta();
        const hanging = g.audio.items.filter((x) => x.hook > 3).length;
        return { t: g.factory.clock.t, quanta: q.count, phase: q.phase, period: q.period, items: g.audio.items.length, hanging, ...g.audio.stats };
      }
      break;
    case 'source':
      if (g.source) return { made: g.source.made };
      break;
    case 'sink':
      if (g.sink) return { taken: g.sink.taken, falling: g.sink.falling.length };
      break;
  }
  throw new Error(`unknown machine ${JSON.stringify(id)}; known: ${g.factory.machines.map((m) => m.id).join(', ')}`);
}

const centrifugeText = (g: LineGraph) => {
  const s = g.centrifuge;
  const rpm = (Math.max(0, s.controller.w) * 60) / (2 * Math.PI);
  return `held ${s.tray.held()}/10 · ${rpm.toFixed(1)} rpm · ${s.controller.phase}`;
};

/** The centrifuge scene: the M4 readout. */
export const centrifugeLive = createLive((seed) => createLine(CENTRIFUGE_LAYOUT, { seed }), centrifugeText, describeAny);

/** The line scene: the centrifuge and the render loop's quanta (v2 conveyor page readout). */
export const lineLive = createLive(
  (seed) => createLine(LINE_LAYOUT, { seed }),
  (g) => {
    const q = g.audio.quanta();
    return `held ${g.centrifuge.tray.held()}/10 · ${g.centrifuge.controller.phase} · q ${q.count} · ${(1 / q.period).toFixed(2)}/s · ${g.audio.stats.dropped} out`;
  },
  describeAny,
);

/** v2's conveyor page: the readout as v2's (`q 56 · 1.77/s · 2 top · 3 hung · 1 out`). */
export const conveyorLive = createLive(
  (seed) => createConveyorPage({ seed }),
  (g) => {
    const q = g.audio.quanta();
    let top = 0;
    let hung = 0;
    for (const it of g.audio.items) {
      if (it.phase !== 'ride') continue;
      if (it.hook > 3) hung++;
      else if (it.p[2] > g.audio.geometry.zc) top++;
    }
    return `q ${q.count} · ${(1 / q.period).toFixed(2)}/s · ${top} top · ${hung} hung · ${g.audio.stats.dropped} out`;
  },
  describeAny,
  () => 'running',
);
