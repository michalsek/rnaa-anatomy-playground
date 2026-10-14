/**
 * The packer (v2 `parts/packer/packer.mjs`, `rig.mjs`, `live.src.js` L41–428): boxes loose fluff,
 * three beads per packet, into post-style packets on belt B.
 *
 * - **Feed and gutter:** a bead handed on at belt A's head rolls over the transfer plate into a
 *   three-pocket gutter. Photo-eyes light the pocket LEDs as beads settle; the pockets fill
 *   from the far end, and two more beads may queue behind them.
 * - **Lane:** a walking beam (pitch 11) indexes cartons through S0 (erect), S1 (fill) and S2
 *   (fold and tape). At S0 the pusher slides the bottom blank out of the magazine. The erector
 *   pad pulls it up into a carton, whose flaps then spring open (ω 14, ζ 0.7, starting at rest,
 *   once the pad clears their arc). Kinds go round-robin: control, graph, data (the magazine's
 *   stack shows the coming ones).
 * - **Picker:** lift, traverse at a gate height, lower; it never crosses the gutter walls. It
 *   takes all three beads with its vacuum bar and drops them into the open carton at S1.
 * - **Folder:** at S2 it closes the minor flaps, then the major ones, and runs the tape head
 *   from the +x end. Taped, the carton is a packet. The beam's next stroke pushes it off the lane
 *   nose; it is handed on at the end of the stroke, at rest (v2 REVIEW 6).
 * - **Interlock:** the picker doesn't go down into S1 while the folder is in its tape stroke, and
 *   the folder holds above the closed carton while the picker is down. The beam moves only when
 *   both arms are clear.
 *
 * Every timed move runs on a progress clock scaled by the tempo (v2 `T()`, faster while beads wait),
 * so a tempo change never makes a pose jump. Plain TS, no randomness. Local frame: v2's (origin =
 * the floor point under the lane axis on the gutter line; v2 plan − ANCHOR [100, −118, 0]).
 */
import { type ArmSpec } from './arm.ts';
import type { Clock, Machine } from './clock.ts';
import type { Item, ItemKind, Ledger, PoseSource } from './items.ts';
import { clamp01, smoother } from './math.ts';
import { type Located, type OutPort, type Receiver, type V3, createOut } from './ports.ts';
import { RATES } from './rates.ts';

/** The three stations along the lane (y), S0 erect, S1 fill, S2 fold + tape. */
const ST = [-6, 5, 16] as const;
const LANE_Z = 200;
/** Carton: length (x), depth (y), wall and flap thickness, the open flap angle, the closed height. */
const CW = 10;
const CD = 8;
const WALL = 0.5;
const FLAP = 0.4;
const OPEN = 1.95;
const CH = 7;
/** Carton top when erected. */
const TOP = LANE_Z + CH;
/** Bead radius (v2: 2.4, one radius everywhere). */
const BEAD = 2.4;

/** v2 packer constants in the local frame (plan − [100, −118, 0]). */
export const PK = {
  deck: { x0: -30, x1: 30, y0: -32, y1: 14, z: 176, top: 182, tab: { TX: -12, TY: 20.5, RX: 12, RY: 24.5 } },
  /** Stand legs (plan [73|127, −147|−107]). */
  legs: [[-27, -29], [27, -29], [-27, 11], [27, 11]] as const,
  lane: { x: 0, x0: -7, x1: 7, y0: -22, y1: 22.7, z: LANE_Z, stations: ST, pitch: 11, slot: [-13.6, 22] as const },
  /** Gutter (x0..x1 at y, floor top z); pockets fill from the far end (+x); the queue slots behind. */
  gutter: { x0: -25.4, x1: -8, y: 0, z: 228, pockets: [-11.2, -16, -20.8] as const, pitch: 4.8 },
  /**
   * The transfer plate from belt A's head drum to the gutter (v4: v2 flung beads across the gap in
   * 0.34 s): its lip over the drum and its end at the gutter's floor; beads roll over it easing to
   * `speed`.
   */
  transfer: { lip: [-41, 231.6] as const, end: [-25.4, 228] as const, from: [-43, 232] as const, speed: 30, tau: 0.3 },
  /** Beads the packer takes in at once (three pockets, two waiting). */
  nestMax: 5,
  magazine: { x: 0, y: -17, z: LANE_Z, hopperZ: 207, gateZ: 201.4 },
  pusher: { glandY: -22.4, z: 200.5, rest: -21, out: -10 },
  erector: { x: 0, y: ST[0], glandZ: 213.3, rest: 212 },
  carton: { w: CW, d: CD, wall: WALL, flap: FLAP, open: OPEN, h: CH, top: TOP },
  bead: BEAD,
  /** Picker: tool length (W to the cup tips), the cup spacing along x; the beads' gate height. */
  picker: {
    arm: { S: [-22, 14.5, 230], yokeZ: 224.5, yokeR: 4.6, L1: 17, L2: 16, off: 3.1, side: 1, r1: 2.1, r2: 1.8 } as ArmSpec,
    tool: 12.6,
    cups: 4.8,
  },
  /**
   * Folder: on the front-right tab, level with S2; tool length; its home, raised over the lane's
   * +x edge at S2 (v4: v2's home [23, 14, 229] sat over the turret's axis, so the approach and
   * the return slewed the turret 138° in 0.3 s, up to 29 rad/s; from here it turns ≈ 20°; tucked
   * upright over [16, 17] it stood across S1 on screen).
   */
  folder: {
    arm: { S: [21, 18.5, 211.5], yokeZ: 206, yokeR: 4.6, L1: 16, L2: 15, off: 3.1, side: -1, r1: 2, r2: 1.8 } as ArmSpec,
    tool: 9,
    home: [12, 17, 228] as V3,
  },
  /** Ports: beads arrive at belt A's head; packets leave at the end of the stroke (bottom centre). */
  ports: { in: [-28, 0, 232] as V3, out: [0, ST[2] + 11, LANE_Z] as V3 },
} as const;

const KINDS: readonly ItemKind[] = ['control', 'graph', 'data'];
/** Where three beads rest in a carton (two on the floor, one on top that settles as the lid closes). */
const CLUSTER: readonly V3[] = [
  [-2.3, -0.9, 0],
  [2.3, -0.9, 0],
  [0, 0.9, 3.6],
];

export type CartonStage = 'blank' | 'erecting' | 'open' | 'filling' | 'filled' | 'folding' | 'closed' | 'taping' | 'taped';

/** A carton's pose for the blocks: bottom centre, height, flap angles (−x, +x, −y, +y), tape 0..1. */
export interface CartonView {
  kind: ItemKind;
  x: number;
  y: number;
  z: number;
  H: number;
  flaps: readonly number[];
  tape: number;
  stage: CartonStage;
}

interface CartonBead {
  item: Item | null;
  o: V3;
  /** Fall progress (0..1) from `from`; null = at rest from the start (prefill). */
  u: number;
  from: V3 | null;
}

interface Carton extends CartonView {
  flaps: number[];
  fv: number[];
  beads: CartonBead[];
  /** Stage time (tempo seconds). */
  el: number;
  home: number;
  /** The packet, once taped. */
  item: Item | null;
  dy: number;
}

interface Bead {
  item: Item;
  /** Along the feed (x), its speed; on the transfer plate until it reaches the gutter's slots. */
  x: number;
  v: number;
  feed: boolean;
  /** Sim time it was handed on: it does not move in that step (the sender already moved it). */
  born: number;
}

/** A timed sequence: its phase and the tempo time spent in it. */
interface Seq<P extends string> {
  phase: P;
  el: number;
}

type FeederPhase = 'idle' | 'push' | 'back' | 'drop';
type ErectorPhase = 'idle' | 'down' | 'lift' | 'up';
type BeamPhase = 'idle' | 'rise' | 'push' | 'sink';
export type PickerPhase = 'home' | 'descend' | 'grip' | 'lift' | 'traverse' | 'wait' | 'lower' | 'release' | 'rise' | 'back';
export type FolderPhase = 'home' | 'approach' | 'minor' | 'major' | 'holdS1' | 'toStart' | 'tape' | 'return';

/** Live poses the blocks need besides the items (written by `outputs`). */
export interface PackerOutputs {
  /** The pusher's plate (its −y face, y) and the erector pad's underside (z). */
  pusher: number;
  pad: number;
  /** Walking beam: finger rise 0..1, the stroke's shift along y. */
  rise: number;
  shift: number;
  /** Pocket LEDs (photo-eyes see a settled bead). */
  leds: [boolean, boolean, boolean];
  /** The picker's vacuum holds (the bar's lamp and the cabinet lamp), the cups' squeeze 0..1. */
  vacuum: boolean;
  squeeze: number;
  /** The magazine stack's drop (0..1: the stack settles one blank after a push). */
  stackDrop: number;
  stackLifted: boolean;
  /** Tool points (extrapolated to t + acc). */
  picker: V3;
  folder: V3;
}

export interface PackerOptions {
  id: string;
  origin: V3;
  /** v2 A's steady state at load: a filled carton at S2, open ones at S1 and S0. */
  prefill?: boolean;
  /** Rotates the first kind. */
  seed?: number;
}

export interface Packer extends Machine, Located, Receiver, PoseSource {
  readonly outs: { out: OutPort };
  /** Pool sizes the blocks need (read at mount). */
  readonly pools: { readonly beads: number; readonly cartons: number; readonly stack: number; readonly packets: number };
  readonly stats: { readonly beads: number; readonly packets: number };
  /** The kind being packed next (v2 readout `next`). */
  next(): ItemKind;
  /**
   * Bead poses (bottom centre), local, at t + acc; `key` is the bead's item id (negative for a
   * prefilled carton's beads, which are not items); returns the count.
   */
  beads(cb: (i: number, x: number, y: number, z: number, key: number) => void): number;
  /** Cartons not yet taped; returns the count. */
  cartons(cb: (i: number, c: CartonView) => void): number;
  /** The magazine's stack, bottom first: kinds; returns the count. */
  stack(cb: (i: number, kind: ItemKind) => void): number;
  outputs(o: PackerOutputs): PackerOutputs;
  /** Phases (tests, status). */
  readonly phases: { readonly picker: PickerPhase; readonly folder: FolderPhase; readonly beam: BeamPhase };
  /** Interlock flags (tests). */
  readonly flags: { readonly pickerClearOfLane: boolean; readonly folderClearOfS1: boolean; readonly folderFree: boolean };
}

export function packerOutputs(): PackerOutputs {
  return { pusher: PK.pusher.rest, pad: PK.erector.rest, rise: 0, shift: 0, leds: [false, false, false], vacuum: false, squeeze: 0, stackDrop: 0, stackLifted: false, picker: [0, 0, 0], folder: [0, 0, 0] };
}

const set3 = (o: V3, x: number, y: number, z: number) => {
  o[0] = x;
  o[1] = y;
  o[2] = z;
};
/** o = mix(A, B, smoother(t)) (v2 `mix`). */
const mixTo = (o: V3, A: readonly number[], B: readonly number[], t: number) => {
  const e = smoother(t);
  set3(o, A[0]! + (B[0]! - A[0]!) * e, A[1]! + (B[1]! - A[1]!) * e, A[2]! + (B[2]! - A[2]!) * e);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function createPacker(clock: Readonly<Clock>, ledger: Ledger, o: PackerOptions): Packer {
  const GT = PK.gutter;
  const TR = PK.transfer;
  const N = PK.nestMax;
  const tempoK = RATES.packerTempo;
  let nextKind = o.seed ?? 0;
  const kindNext = () => KINDS[nextKind++ % KINDS.length]!;
  const stats = { beads: 0, packets: 0 };

  // ---- gutter -------------------------------------------------------------------------------------
  const nest: Bead[] = [];
  const slotX = (i: number) => (i < 3 ? GT.pockets[i]! : GT.pockets[2] - (i - 2) * GT.pitch);
  /** The feed's floor height at x: over the drum lip, down the transfer plate, then the gutter floor. */
  const floorAt = (x: number) => {
    if (x >= TR.end[0]) return GT.z;
    if (x >= TR.lip[0]) return lerp(TR.lip[1], TR.end[1], (x - TR.lip[0]) / (TR.end[0] - TR.lip[0]));
    return lerp(TR.from[1], TR.lip[1], clamp01((x - TR.from[0]) / (TR.lip[0] - TR.from[0])));
  };
  const settledAt = (i: number) => {
    const b = nest[i];
    return !!b && !b.feed && Math.abs(b.x - slotX(i)) < 0.15 && Math.abs(b.v) < 0.5;
  };
  const tempo = () => 1 + Math.min(tempoK.max, tempoK.per * Math.max(0, nest.length - 3));

  function stepGutter(h: number) {
    // While the picker lifts the three beads clear, the ones behind keep their slots.
    const wait = picker.phase === 'lift' && picker.el < 0.14 ? 3 : 0;
    for (let i = 0; i < nest.length; i++) {
      const b = nest[i]!;
      if (b.born === clock.t) continue;
      const target = slotX(i + wait);
      if (b.feed) {
        // Rolls over the plate easing to the plate's speed, until it nears its slot.
        b.v += (TR.speed - b.v) * (1 - Math.exp(-h / TR.tau));
        b.x += b.v * h;
        if (b.x >= target - 2) b.feed = false;
        continue;
      }
      const w = 9;
      for (let s = 0; s < 4; s++) {
        const q = h / 4;
        b.v += (w * w * (target - b.x) - 2 * w * b.v) * q;
        b.v = Math.max(-26, Math.min(26, b.v));
        b.x += b.v * q;
      }
    }
  }

  // ---- lane: cartons, walking beam, magazine, erector ----------------------------------------------
  const cartons: Carton[] = [];
  const stack: ItemKind[] = [];
  for (let i = 0; i < 10; i++) stack.push(kindNext());
  const at0 = (y: number) => {
    for (const c of cartons) if (Math.abs(c.y - y) < 0.5) return c;
    return undefined;
  };
  const feeder: Seq<FeederPhase> & { plate: number } = { phase: 'idle', el: 0, plate: PK.pusher.rest };
  const erector: Seq<ErectorPhase> & { pad: number; carton: Carton | null; flaps: number } = { phase: 'idle', el: 0, pad: PK.erector.rest, carton: null, flaps: -1 };
  const beam: Seq<BeamPhase> & { shift: number; rise: number } = { phase: 'idle', el: 0, shift: 0, rise: 0 };
  let stackDrop = 0;
  const go = <P extends string>(s: Seq<P>, phase: P) => {
    s.phase = phase;
    s.el = 0;
  };

  function makeCarton(kind: ItemKind, y: number, stage: CartonStage, H: number): Carton {
    const open = stage === 'open' || stage === 'filled';
    const f = open ? OPEN : 0;
    return { kind, x: PK.lane.x, y, z: LANE_Z, H, stage, flaps: [f, f, f, f], fv: [0, 0, 0, 0], beads: [], tape: 0, el: 0, home: y, item: null, dy: 0 };
  }
  if (o.prefill) {
    const c2 = makeCarton(stack.shift()!, ST[2], 'filled', CH);
    c2.beads = CLUSTER.map((off) => ({ item: null, o: off, u: 1, from: null }));
    cartons.push(c2, makeCarton(stack.shift()!, ST[1], 'open', CH), makeCarton(stack.shift()!, ST[0], 'open', CH));
    for (let i = 0; i < 3; i++) stack.push(kindNext());
  }

  function stepFeeder(dt: number) {
    const P0 = PK.pusher;
    feeder.el += dt;
    if (feeder.phase === 'idle') {
      if (beam.phase === 'idle' && !at0(ST[0]) && !cartons.some((c) => c.stage === 'blank')) {
        const kind = stack.shift()!;
        stack.push(kindNext());
        cartons.push(makeCarton(kind, PK.magazine.y, 'blank', 1));
        go(feeder, 'push');
      }
    } else if (feeder.phase === 'push') {
      const t = feeder.el / 0.55;
      feeder.plate = lerp(P0.rest, P0.out, smoother(t));
      const c = cartons.find((x) => x.stage === 'blank');
      if (c) c.y = feeder.plate + 4;
      if (t >= 1) {
        if (c) {
          c.y = ST[0];
          c.stage = 'erecting';
          erector.carton = c;
          go(erector, 'down');
        }
        go(feeder, 'back');
      }
    } else if (feeder.phase === 'back') {
      const t = feeder.el / 0.45;
      feeder.plate = lerp(P0.out, P0.rest, smoother(t));
      if (t >= 1) {
        stackDrop = 1;
        go(feeder, 'drop');
      }
    } else {
      const t = Math.min(1, feeder.el / 0.18);
      stackDrop = 1 - t * t;
      if (t >= 1) {
        stackDrop = 0;
        go(feeder, 'idle');
      }
    }
  }

  /** Flaps open on a damped spring from rest (ω 14, ζ 0.7), one after another; false once settled. */
  function springFlaps(c: Carton, dt: number, since: number) {
    const w = 14;
    let moving = false;
    for (let i = 0; i < 4; i++) {
      if (since < i * 0.05) {
        moving = true;
        continue;
      }
      for (let s = 0; s < 4; s++) {
        const q = dt / 4;
        c.fv[i]! += (w * w * (OPEN - c.flaps[i]!) - 2 * 0.7 * w * c.fv[i]!) * q;
        c.flaps[i]! += c.fv[i]! * q;
      }
      if (Math.abs(c.flaps[i]! - OPEN) > 0.004 || Math.abs(c.fv[i]!) > 0.03) moving = true;
    }
    return moving;
  }

  function stepErector(dt: number) {
    const E = PK.erector;
    const c = erector.carton;
    erector.el += dt;
    if (erector.phase === 'down') {
      const t = erector.el / 0.24;
      erector.pad = lerp(E.rest, LANE_Z + 1, smoother(t));
      if (t >= 1) go(erector, 'lift');
    } else if (erector.phase === 'lift') {
      const t = erector.el / 0.36;
      c!.H = lerp(1, CH, smoother(t));
      erector.pad = LANE_Z + c!.H;
      if (t >= 1) go(erector, 'up');
    } else if (erector.phase === 'up') {
      const t = erector.el / 0.3;
      erector.pad = lerp(TOP, E.rest, smoother(t));
      // The flaps swing only once the pad is clear of the major flaps' arc.
      if (erector.pad > TOP + 3.9) {
        if (erector.flaps < 0) erector.flaps = 0;
        erector.flaps += dt;
        const moving = springFlaps(c!, dt, erector.flaps);
        if (!moving && t >= 1) {
          c!.flaps.fill(OPEN);
          c!.stage = 'open';
          erector.carton = null;
          erector.flaps = -1;
          go(erector, 'idle');
        }
      }
    }
  }

  function stepBeam(dt: number) {
    beam.el += dt;
    if (beam.phase === 'idle') {
      const s0 = at0(ST[0]);
      const s1 = at0(ST[1]);
      const s2 = at0(ST[2]);
      const ready =
        !!s0 &&
        s0.stage === 'open' &&
        (!s1 || s1.stage === 'filled') &&
        (!s2 || s2.stage === 'taped') &&
        feeder.phase !== 'push' &&
        folder.free &&
        picker.clearOfLane &&
        // The taped packet leaves at the end of this stroke: ask belt B now (one sender).
        (!s2 || out.ready(0.12 + 0.55));
      if (ready) {
        for (const c of cartons) c.home = c.y;
        go(beam, 'rise');
      }
      return;
    }
    if (beam.phase === 'rise') {
      beam.rise = smoother(beam.el / 0.12);
      if (beam.el >= 0.12) go(beam, 'push');
    } else if (beam.phase === 'push') {
      const t = beam.el / 0.55;
      beam.shift = PK.lane.pitch * smoother(t);
      for (const c of cartons) if (c.stage !== 'blank' && c.stage !== 'erecting') c.y = c.home + beam.shift;
      if (t >= 1) {
        // Handed on at the end of the stroke: clear of the nose and at rest (v2 REVIEW 6).
        for (let i = cartons.length - 1; i >= 0; i--) {
          const c = cartons[i]!;
          if (c.y > ST[2] + 1) emit(c, i);
        }
        go(beam, 'sink');
      }
    } else {
      beam.rise = 1 - smoother(beam.el / 0.12);
      if (beam.el >= 0.12) {
        beam.rise = 0;
        beam.shift = 0;
        for (const c of cartons) c.y = Math.round(c.y * 100) / 100;
        go(beam, 'idle');
      }
    }
  }

  const zero: V3 = [0, 0, 0];
  const at: V3 = [0, 0, 0];
  function emit(c: Carton, i: number) {
    cartons.splice(i, 1);
    stats.packets++;
    set3(at, c.x, c.y, c.z);
    out.send(c.item!, at, zero);
  }

  /** Taped: the carton becomes a packet (made now); its beads are used up. */
  function tape(c: Carton) {
    c.stage = 'taped';
    c.el = 0;
    c.item = ledger.make(c.kind);
    for (const b of c.beads) if (b.item) ledger.consume(b.item);
    c.beads.length = 0;
  }

  // ---- picker: lift → traverse → lower, never across the gutter walls -------------------------------
  const PT = PK.picker.tool;
  const GATE = GT.z + 23.4;
  const PICK: V3 = [GT.pockets[1], GT.y, GT.z + 2 * BEAD + PT];
  const PHOME: V3 = [PICK[0], PICK[1], GATE];
  const PLACE: V3 = [PK.lane.x, ST[1], TOP + 2 + 2 * BEAD + PT];
  const PGATE: V3 = [PLACE[0], PLACE[1], GATE];
  const picker = {
    phase: 'home' as PickerPhase,
    el: 0,
    W: [...PHOME] as V3,
    dW: [0, 0, 0] as V3,
    carried: [] as Item[],
    squeeze: 0,
    vacuum: false,
    clearOfLane: true,
  };
  /** Cup i's x offset (bead i sat in pocket i: pockets fill from +x). */
  const cupDx = (i: number) => (1 - i) * PK.picker.cups;

  function stepPicker(dt: number) {
    const p = picker;
    p.el += dt;
    const s1 = at0(ST[1]);
    const move = (dur: number, A: V3, B: V3) => {
      const t = p.el / dur;
      mixTo(p.W, A, B, t);
      return t >= 1;
    };
    switch (p.phase) {
      case 'home':
        set3(p.W, PHOME[0], PHOME[1], PHOME[2]);
        if (nest.length >= 3 && settledAt(0) && settledAt(1) && settledAt(2)) go(p, 'descend');
        break;
      case 'descend':
        if (move(0.28, PHOME, PICK)) go(p, 'grip');
        break;
      case 'grip': {
        const t = p.el / 0.18;
        p.squeeze = smoother(t);
        p.vacuum = t > 0.3;
        if (t >= 1) {
          p.carried = nest.splice(0, 3).map((b) => b.item);
          go(p, 'lift');
        }
        break;
      }
      case 'lift':
        if (move(0.28, PICK, PHOME)) go(p, 'traverse');
        break;
      case 'traverse':
        if (move(0.5, PHOME, PGATE)) go(p, 'wait');
        break;
      case 'wait':
        set3(p.W, PGATE[0], PGATE[1], PGATE[2]);
        if (s1 && s1.stage === 'open' && s1.beads.length === 0 && beam.phase === 'idle' && folder.clearOfS1) go(p, 'lower');
        break;
      case 'lower':
        if (move(0.36, PGATE, PLACE)) go(p, 'release');
        break;
      case 'release': {
        const t = p.el / 0.1;
        p.vacuum = false;
        p.squeeze = 1 - smoother(t);
        if (t >= 1) {
          const c = at0(ST[1]);
          if (!c) throw new Error('packer: no carton at S1 to fill');
          c.beads = p.carried.map((item, i) => ({ item, o: CLUSTER[i]!, u: 0, from: [PLACE[0] + cupDx(i), PLACE[1], PLACE[2] - PT - 2 * BEAD] as V3 }));
          c.stage = 'filling';
          c.el = 0;
          p.carried = [];
          go(p, 'rise');
        }
        break;
      }
      case 'rise':
        if (move(0.28, PLACE, PGATE)) go(p, 'back');
        break;
      case 'back':
        if (move(0.45, PGATE, PHOME)) go(p, 'home');
        break;
    }
    p.clearOfLane = p.phase !== 'lower' && p.phase !== 'release' && p.phase !== 'rise';
  }

  // ---- folder: closes the flaps from above, then tapes from the +x end -----------------------------
  const FT = PK.folder.tool;
  const FHOME = PK.folder.home;
  const FHOVER: V3 = [PK.lane.x, ST[2], TOP + FT + 5];
  const folder = {
    phase: 'home' as FolderPhase,
    el: 0,
    W: [...FHOME] as V3,
    dW: [0, 0, 0] as V3,
    free: true,
    clearOfS1: true,
    carton: null as Carton | null,
  };
  const from3: V3 = [0, 0, 0];

  function stepFolder(dt: number) {
    const f = folder;
    f.el += dt;
    if (f.phase === 'home') {
      set3(f.W, FHOME[0], FHOME[1], FHOME[2]);
      const c = at0(ST[2]);
      if (c && c.stage === 'filled' && beam.phase === 'idle') {
        c.stage = 'folding';
        f.carton = c;
        go(f, 'approach');
      }
    } else {
      const cc = f.carton!;
      const X1 = cc.x + CW / 2;
      const X0 = cc.x - CW / 2;
      if (f.phase === 'approach') {
        const t = f.el / 0.32;
        mixTo(f.W, FHOME, FHOVER, t);
        if (t >= 1) go(f, 'minor');
      } else if (f.phase === 'minor') {
        const t = f.el / 0.26;
        cc.flaps[0] = cc.flaps[1] = OPEN * (1 - smoother(t));
        if (t >= 1) go(f, 'major');
      } else if (f.phase === 'major') {
        const t = f.el / 0.3;
        cc.flaps[2] = OPEN * (1 - smoother(t * 1.12));
        cc.flaps[3] = OPEN * (1 - smoother(t * 1.12 - 0.12));
        if (t >= 1) {
          cc.flaps.fill(0);
          cc.stage = 'closed';
          go(f, 'holdS1');
        }
      } else if (f.phase === 'holdS1') {
        // Waits above the closed carton while the picker is down in S1.
        if (picker.clearOfLane) go(f, 'toStart');
      } else if (f.phase === 'toStart') {
        const t = f.el / 0.26;
        set3(f.W, lerp(FHOVER[0], X1 + 2.4, smoother(t)), cc.y, lerp(FHOVER[2], TOP + FT, smoother(t * 1.3 - 0.3)));
        if (t >= 1) {
          cc.stage = 'taping';
          go(f, 'tape');
        }
      } else if (f.phase === 'tape') {
        const t = f.el / 0.5;
        const e = smoother(t);
        set3(f.W, X1 + 2.4 - CW * e, cc.y, TOP + FT);
        cc.tape = e;
        if (t >= 1) {
          tape(cc);
          go(f, 'return');
        }
      } else {
        // Return with a small hop (v2 `hop`, lift 3).
        const t = f.el / 0.42;
        set3(from3, X0 + 2.4, cc.y, TOP + FT);
        mixTo(f.W, from3, FHOME, t);
        f.W[2] += 3 * Math.sin(Math.PI * clamp01(t));
        if (t >= 1) {
          f.carton = null;
          go(f, 'home');
        }
      }
    }
    f.free = f.phase === 'home' || (f.phase === 'return' && f.el > 0.12);
    // While the folder runs its tape stroke its elbow stands beside S1: the picker stays up.
    f.clearOfS1 = f.phase !== 'toStart' && f.phase !== 'tape';
  }

  // ---- poses ---------------------------------------------------------------------------------------
  const prevP: V3 = [0, 0, 0];
  const prevF: V3 = [0, 0, 0];
  /** Bead poses this step (nest, carried, in cartons) and their change over the step. */
  const beadP: V3[] = [];
  const beadD: V3[] = [];
  let beadN = 0;
  const cartonDy = new Map<Carton, number>();
  const putBead = (x: number, y: number, z: number, key: number) => {
    const i = beadN++;
    if (!beadP[i]) {
      beadP[i] = [0, 0, 0];
      beadD[i] = [0, 0, 0];
    }
    const p = beadP[i]!;
    const d = beadD[i]!;
    // The change is kept only for the same bead in the same slot (keys are item ids).
    if (beadKey[i] === key) set3(d, x - p[0], y - p[1], z - p[2]);
    else set3(d, 0, 0, 0);
    beadKey[i] = key;
    set3(p, x, y, z);
  };
  const beadKey: number[] = [];

  function poseBeads() {
    beadN = 0;
    for (const b of nest) putBead(b.x, GT.y, floorAt(b.x), b.item.id);
    const W = picker.W;
    for (let i = 0; i < picker.carried.length; i++) putBead(W[0] + cupDx(i), W[1], W[2] - PT - 2 * BEAD, picker.carried[i]!.id);
    for (const c of cartons) {
      const lid = 1 - clamp01((OPEN - c.flaps[3]!) / OPEN);
      for (let k = 0; k < c.beads.length; k++) {
        const b = c.beads[k]!;
        const ex = c.x + b.o[0];
        const ey = c.y + b.o[1];
        // The top bead settles as the lid closes (soft fluff), under the flaps.
        const ez = c.z + WALL + b.o[2] * (0.35 + 0.65 * lid);
        const key = b.item ? b.item.id : -1 - k;
        if (!b.from) putBead(ex, ey, ez, key);
        else {
          const e = smoother(b.u);
          putBead(lerp(b.from[0], ex, e), lerp(b.from[1], ey, e), lerp(b.from[2], ez, b.u * b.u), key);
        }
      }
    }
  }

  // ---- the machine --------------------------------------------------------------------------------
  const out = createOut(o, 'out', { asks: true });
  const packer: Packer = {
    id: o.id,
    origin: o.origin,
    outs: { out },
    // Beads: the nest, three carried, three each in S1 and S2; cartons: blank + S0..S2 + one more.
    pools: { beads: N + 3 + 6, cartons: 5, stack: 9, packets: 2 },
    stats,
    phases: {
      get picker() {
        return picker.phase;
      },
      get folder() {
        return folder.phase;
      },
      get beam() {
        return beam.phase;
      },
    },
    flags: {
      get pickerClearOfLane() {
        return picker.clearOfLane;
      },
      get folderClearOfS1() {
        return folder.clearOfS1;
      },
      get folderFree() {
        return folder.free;
      },
    },
    next() {
      const s1 = at0(ST[1]);
      return s1 && s1.stage !== 'filled' ? s1.kind : stack[0]!;
    },
    canAccept: () => nest.length < N,
    accept(item, from, v) {
      stats.beads++;
      const x = Math.min(from[0], TR.lip[0]);
      nest.push({ item, x, v: Math.max(0, v[0]), feed: true, born: clock.t });
    },
    step(h) {
      const dt = h * tempo();
      set3(prevP, picker.W[0], picker.W[1], picker.W[2]);
      set3(prevF, folder.W[0], folder.W[1], folder.W[2]);
      for (const c of cartons) cartonDy.set(c, c.y);
      stepGutter(h);
      stepFeeder(dt);
      stepErector(dt);
      stepPicker(dt);
      stepFolder(dt);
      stepBeam(dt);
      for (const c of cartons) {
        c.el += dt;
        if (c.stage === 'filling' && c.el > 0.4) c.stage = 'filled';
        for (const b of c.beads) if (b.from && b.u < 1) b.u = Math.min(1, b.u + dt / 0.32);
        const y0 = cartonDy.get(c);
        c.dy = y0 === undefined ? 0 : c.y - y0;
      }
      cartonDy.clear();
      set3(picker.dW, picker.W[0] - prevP[0], picker.W[1] - prevP[1], picker.W[2] - prevP[2]);
      set3(folder.dW, folder.W[0] - prevF[0], folder.W[1] - prevF[1], folder.W[2] - prevF[2]);
      poseBeads();
    },
    alive() {
      let n = nest.length + picker.carried.length;
      for (const c of cartons) {
        if (c.item) n++;
        for (const b of c.beads) if (b.item) n++;
      }
      return n;
    },
    status: () => ({
      beads: stats.beads,
      packets: stats.packets,
      next: packer.next(),
      nest: nest.length,
      tempo: Number(tempo().toFixed(2)),
      picker: picker.phase,
      folder: folder.phase,
      beam: beam.phase,
      cartons: cartons.map((c) => `${c.kind} ${c.stage} y ${c.y.toFixed(1)}`),
    }),
    poses(cb) {
      const k = clock.acc / clock.H;
      let n = 0;
      for (const c of cartons) if (c.item) cb(n++, c.item, c.x, c.y + c.dy * k, c.z, 0, 0, 0, 0);
      return n;
    },
    beads(cb) {
      const k = clock.acc / clock.H;
      for (let i = 0; i < beadN; i++) {
        const p = beadP[i]!;
        const d = beadD[i]!;
        cb(i, p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k, beadKey[i]!);
      }
      return beadN;
    },
    cartons(cb) {
      const k = clock.acc / clock.H;
      let n = 0;
      for (const c of cartons) {
        if (c.item) continue;
        const y = c.y;
        c.y = y + c.dy * k;
        cb(n++, c);
        c.y = y;
      }
      return n;
    },
    stack(cb) {
      const n = Math.min(stack.length, 9);
      for (let i = 0; i < n; i++) cb(i, stack[i]!);
      return n;
    },
    outputs(r) {
      const k = clock.acc / clock.H;
      r.pusher = feeder.plate;
      r.pad = erector.pad;
      r.rise = beam.rise;
      r.shift = beam.shift;
      for (let i = 0; i < 3; i++) r.leds[i] = settledAt(i);
      r.vacuum = picker.vacuum;
      r.squeeze = picker.squeeze;
      r.stackDrop = stackDrop;
      r.stackLifted = feeder.phase === 'push' || feeder.phase === 'back';
      set3(r.picker, picker.W[0] + picker.dW[0] * k, picker.W[1] + picker.dW[1] * k, picker.W[2] + picker.dW[2] * k);
      set3(r.folder, folder.W[0] + folder.dW[0] * k, folder.W[1] + folder.dW[1] * k, folder.W[2] + folder.dW[2] * k);
      return r;
    },
  };
  poseBeads();
  return packer;
}
