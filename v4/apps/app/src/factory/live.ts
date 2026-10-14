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
  type Crusher,
  type CrusherPageGraph,
  type Factory,
  type FrameInfo,
  type LineGraph,
  type OutputPageGraph,
  type PackerPageGraph,
  type ScannerPageGraph,
  CENTRIFUGE_LAYOUT,
  LINE_LAYOUT,
  SC,
  createConveyorPage,
  createCrusherPage,
  createLine,
  createOutputPage,
  createPackerPage,
  createScannerPage,
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
  centrifuge?: Centrifuge | null;
}

function createLive<G extends Graph>(
  build: (seed: number) => G,
  format: (g: G) => string,
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
        return describe(g, mainOf(g));
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
      /** A machine's state summary (default: the scene's main machine); ids: `machines()`. */
      status: (id = mainOf(g)) => describe(g, id),
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

const mainOf = (g: Graph & { crusher?: Crusher | null; scanner?: unknown; elevator?: unknown; packer?: unknown }) =>
  g.centrifuge ? 'centrifuge' : g.scanner ? 'scanner' : g.crusher ? 'crusher' : g.elevator ? 'elevator' : g.packer ? 'packer' : 'audio';

/** A machine's dev summary (`Machine.status`), with the sim time. */
function describe(g: Graph, id: string): unknown {
  const m = g.factory.get(id);
  return { t: g.factory.clock.t, ...m.status() };
}

const disposed = (c: Crusher) => {
  const s = c.stats();
  return `${s.count} disposed · bin ${Math.round(s.fill * 100)}%${s.bin === 'home' ? '' : ' · emptying'}`;
};

const centrifugeText = (g: LineGraph) => {
  const s = g.centrifuge;
  const rpm = (Math.max(0, s.controller.w) * 60) / (2 * Math.PI);
  return `held ${s.tray.held()}/10 · ${rpm.toFixed(1)} rpm · ${s.controller.phase}`;
};

/** The centrifuge scene: the M4 readout. */
export const centrifugeLive = createLive((seed) => createLine(CENTRIFUGE_LAYOUT, { seed }), centrifugeText);

/** The line scene: the centrifuge and the render loop's quanta (v2 conveyor page readout). */
export const lineLive = createLive(
  (seed) => createLine(LINE_LAYOUT, { seed }),
  (g) => {
    const q = g.audio.quanta();
    const out = g.crusher ? `${g.crusher.stats().count} disposed` : `${g.audio.stats.dropped} out`;
    const audio = g.scanner ? ` · ${g.scanner.stats.sent} audio` : '';
    const heard = g.speaker ? ` · ${g.speaker.stats.heard} heard` : '';
    const packed = g.packer ? `${g.packer.stats.packets} packed · ` : '';
    return `${packed}held ${g.centrifuge.tray.held()}/10 · ${g.centrifuge.controller.phase} · q ${q.count}${audio}${heard} · ${out}`;
  },
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
  () => 'running',
);

/** v2's crusher page: the readout as v2's (`disposed 0 · bin 0%`). */
export const crusherLive = createLive(
  (seed) => createCrusherPage({ seed }),
  (g: CrusherPageGraph) => disposed(g.crusher),
  (g) => g.crusher.stats().bin,
);

/** v2's scanner page: the readout as v2's (`quanta read 0 · packets lifted 0`; no elevator yet). */
export const scannerLive = createLive(
  (seed) => createScannerPage({ seed }),
  (g: ScannerPageGraph) => `quanta read ${g.scanner.stats.reads} · buffer ${g.scanner.stats.delivered % SC.perPacket}/${SC.perPacket} · ${g.scanner.stats.sent} packets out`,
  () => 'running',
);

/** The output path: v2's elevator readout (`packets lifted 3`) and the speaker's. */
export const outputLive = createLive(
  (seed) => createOutputPage({ seed }),
  (g: OutputPageGraph) => `packets lifted ${g.elevator.stats.lifted} · ${g.speaker.stats.heard} heard · boot ${g.elevator.stats.queue}`,
  () => 'running',
);

/** v2's packer page: the readout as v2's (`beads 3 · packets 0 · next graph`). */
export const packerLive = createLive(
  (seed) => createPackerPage({ seed }),
  (g: PackerPageGraph) => `beads ${g.packer.stats.beads} · packets ${g.packer.stats.packets} · next ${g.packer.next()}`,
  () => 'running',
);
