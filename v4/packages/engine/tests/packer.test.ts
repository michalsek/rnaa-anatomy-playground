import { describe, expect, it } from 'vitest';
import { type ArmSpec, armPose, solveArm } from '../src/sim/arm.ts';
import { createFactory } from '../src/sim/clock.ts';
import { createConveyor } from '../src/sim/conveyor.ts';
import { LINE_LAYOUT, createLine, createPackerPage } from '../src/sim/graphs.ts';
import type { Item, ItemKind } from '../src/sim/items.ts';
import { PK, type Packer, createPacker } from '../src/sim/packer.ts';
import { wrapPi } from '../src/sim/math.ts';
import { createSink } from '../src/sim/sink.ts';
import { createSource } from '../src/sim/source.ts';
import type { V3 } from '../src/sim/ports.ts';
import { report, snapshot } from './rig.ts';

const H = 1 / 120;
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const len = (a: readonly number[]) => Math.hypot(a[0]!, a[1]!, a[2]!);
const dist = (a: readonly number[], b: readonly number[]) => len(sub(a, b));

/** Closest distance between segments ab and cd (sampled finely; plenty for clearance checks). */
function segDist(a: V3, b: V3, c: V3, d: V3) {
  let best = Infinity;
  const p: V3 = [0, 0, 0];
  const q: V3 = [0, 0, 0];
  for (let i = 0; i <= 24; i++) {
    const s = i / 24;
    for (let k = 0; k < 3; k++) p[k] = a[k]! + (b[k]! - a[k]!) * s;
    for (let j = 0; j <= 24; j++) {
      const t = j / 24;
      for (let k = 0; k < 3; k++) q[k] = c[k]! + (d[k]! - c[k]!) * t;
      best = Math.min(best, dist(p, q));
    }
  }
  return best;
}

/** An arm's centreline segments in pose (shoulder → elbow → wrist → tool point → tool bottom). */
function armSegments(spec: ArmSpec, W: V3, tool: number): [V3, V3][] {
  const q = solveArm(spec, W[0], W[1], W[2]);
  const S: V3 = [...spec.S];
  const E: V3 = [...q.E];
  const Wp: V3 = [...q.Wp];
  const Wt: V3 = [...q.W];
  const bottom: V3 = [Wt[0], Wt[1], Wt[2] - tool];
  return [
    [S, E],
    [E, Wp],
    [Wp, Wt],
    [Wt, bottom],
  ];
}

const out = () => ({
  pusher: 0,
  pad: 0,
  rise: 0,
  shift: 0,
  leds: [false, false, false] as [boolean, boolean, boolean],
  vacuum: false,
  squeeze: 0,
  stackDrop: 0,
  stackLifted: false,
  picker: [0, 0, 0] as V3,
  folder: [0, 0, 0] as V3,
});

describe('arm IK (2-link planar, turret yaw, level wrist)', () => {
  it('reaches its target: links keep their lengths, the tool hangs off along n, the elbow is up', () => {
    const targets: [ArmSpec, V3[]][] = [
      // Picker: the pick, its gate, the place, its gate.
      [PK.picker.arm, [[PK.gutter.pockets[1], 0, 245.4], [PK.gutter.pockets[1], 0, 251.4], [0, 5, 226.4], [0, 5, 251.4]]],
      // Folder: hover, tape start and end, home.
      [PK.folder.arm, [[0, 16, 221], [7.4, 16, 216], [-2.6, 16, 216], [...PK.folder.home]]],
    ];
    for (const [spec, list] of targets) {
      const q = armPose();
      for (const W of list) {
        solveArm(spec, W[0], W[1], W[2], q);
        expect(q.clamped).toBe(false);
        expect(dist(q.E, spec.S)).toBeCloseTo(spec.L1, 6);
        expect(dist(q.Wp, q.E)).toBeCloseTo(spec.L2, 6);
        expect(dist(q.W, W)).toBeLessThan(1e-6);
        // n ⟂ the plane's direction, horizontal; W = Wp + n·off.
        expect(q.n[0] * q.dir[0] + q.n[1] * q.dir[1]).toBeCloseTo(0, 9);
        expect(dist(sub(q.W, q.Wp), [q.n[0] * spec.off, q.n[1] * spec.off, 0])).toBeLessThan(1e-9);
        // Elbow up: above the shoulder → wrist line.
        const t = (q.E[0] - spec.S[0]) * q.dir[0] + (q.E[1] - spec.S[1]) * q.dir[1];
        const r = (q.Wp[0] - spec.S[0]) * q.dir[0] + (q.Wp[1] - spec.S[1]) * q.dir[1];
        expect(q.E[2]).toBeGreaterThan(spec.S[2] + ((q.Wp[2] - spec.S[2]) * t) / r - 1e-9);
        // The link angles: e1 at a1, e2 at a2.
        expect(Math.atan2(q.E[2] - spec.S[2], t)).toBeCloseTo(q.a1, 9);
      }
    }
  });

  it('runs both arms through 3 full packets without a pop, out-of-reach target or clash (240 Hz)', () => {
    const g = createPackerPage();
    const f = g.factory;
    const o = out();
    const qp = armPose();
    const qf = armPose();
    let prevP: number[] | null = null;
    let prevF: number[] | null = null;
    let worstJoint = 0;
    let worstTool = 0;
    let closest = Infinity;
    let carryClear = Infinity;
    const H4 = 1 / 240;
    for (let i = 0; i < 70 * 240 && g.packer.stats.packets < 6; i++) {
      f.advance(H4);
      g.packer.outputs(o);
      solveArm(PK.picker.arm, o.picker[0], o.picker[1], o.picker[2], qp);
      solveArm(PK.folder.arm, o.folder[0], o.folder[1], o.folder[2], qf);
      expect(qp.clamped).toBe(false);
      expect(qf.clamped).toBe(false);
      const jp = [qp.yaw, qp.a1, qp.a2];
      const jf = [qf.yaw, qf.a1, qf.a2];
      if (prevP && prevF) {
        for (let k = 0; k < 3; k++) worstJoint = Math.max(worstJoint, Math.abs(wrapPi(jp[k]! - prevP[k]!)), Math.abs(wrapPi(jf[k]! - prevF[k]!)));
      }
      prevP = jp;
      prevF = jf;
      // Clearance between the two arms' centrelines (links, wrists, tools).
      const a = armSegments(PK.picker.arm, o.picker, PK.picker.tool);
      const b = armSegments(PK.folder.arm, o.folder, PK.folder.tool);
      if (i % 4 === 0) for (const [p0, p1] of a) for (const [q0, q1] of b) closest = Math.min(closest, segDist(p0, p1, q0, q1));
      // Carried beads stay over the gutter walls (or inside its pockets while picking).
      const ph = g.packer.phases.picker;
      if (ph === 'traverse' || ph === 'wait' || ph === 'back') {
        const beadBottom = o.picker[2] - PK.picker.tool - 2 * PK.bead;
        carryClear = Math.min(carryClear, beadBottom - (PK.gutter.z + 3.6));
      }
    }
    expect(g.packer.stats.packets).toBeGreaterThanOrEqual(6);
    // 240 Hz frames: no joint turns more than 0.06 rad (3.4°, 14 rad/s) per frame.
    expect(worstJoint).toBeLessThan(0.06);
    // The centrelines stay further apart than the two links' half widths and caps.
    expect(closest).toBeGreaterThan(6);
    expect(carryClear).toBeGreaterThan(0.5);
    void worstTool;
    report(`arms: worst joint step ${worstJoint.toFixed(4)} rad at 240 Hz, closest centrelines ${closest.toFixed(2)}, carry clearance ${carryClear.toFixed(2)}\n`);
  });
});

/** The packer page with every step watched. */
function watch(seconds: number, each: (p: Packer, t: number) => void) {
  const g = createPackerPage();
  const kinds: ItemKind[] = [];
  const beadsPer: number[] = [];
  let consumedBeads = 0;
  const consume = g.factory.ledger.consume;
  g.factory.ledger.consume = (item: Item) => {
    if (item.kind === 'fluff') consumedBeads++;
    consume(item);
  };
  const accept = g.beltB.accept.bind(g.beltB);
  g.beltB.accept = (item, from, v) => {
    kinds.push(item.kind);
    beadsPer.push(consumedBeads);
    accept(item, from, v);
  };
  for (let i = 0; i < Math.round(seconds / H); i++) {
    g.factory.run(H);
    each(g.packer, g.factory.clock.t);
  }
  return { g, kinds, beadsPer, consumedBeads };
}

describe('packer sim (v2 live.src.js L41–428)', () => {
  it('packs 3 beads per packet, kinds round-robin control → graph → data, conserving items', () => {
    const { g, kinds, beadsPer } = watch(180, () => {});
    const f = g.factory;
    expect(f.ledger.created).toBe(f.alive() + f.ledger.consumed);
    expect(kinds.length).toBeGreaterThan(30);
    kinds.forEach((k, i) => expect(k).toBe(['control', 'graph', 'data'][i % 3]));
    // The first packet is v2 A's prefilled carton (beads that were never items); every later one
    // used up three beads by the time it left.
    expect(beadsPer[0]).toBe(0);
    for (let i = 1; i < beadsPer.length; i++) expect(beadsPer[i]).toBe(3 * i);
  });

  it('never violates the interlock', () => {
    let lows = 0;
    let tapes = 0;
    let strokes = 0;
    watch(180, (p) => {
      const ph = p.phases;
      const pickerDown = ph.picker === 'lower' || ph.picker === 'release' || ph.picker === 'rise';
      const folderTaping = ph.folder === 'toStart' || ph.folder === 'tape';
      if (pickerDown) lows++;
      if (folderTaping) tapes++;
      expect(pickerDown && folderTaping).toBe(false);
      expect(p.flags.pickerClearOfLane).toBe(!pickerDown);
      // The beam moves only with the picker up and the folder home (or leaving).
      if (ph.beam !== 'idle') {
        strokes++;
        expect(pickerDown).toBe(false);
        expect(ph.folder === 'home' || ph.folder === 'return').toBe(true);
      }
    });
    expect(lows).toBeGreaterThan(100);
    expect(tapes).toBeGreaterThan(100);
    expect(strokes).toBeGreaterThan(100);
  });

  it('keeps up with one bead per 0.9 s for 60 s (v2 NOTES: 66 beads, 20 packets, nest back to 3)', () => {
    // As v2's check: beads straight into the packer at belt A's head.
    const f = createFactory();
    const { clock, ledger } = f;
    const src = f.add(createSource(clock, ledger, { id: 'beads', origin: [0, 0, 0], from: [PK.transfer.from[0], 0, PK.transfer.from[1]], every: 0.9, delay: 0, burst: 1, rest: 0, kinds: ['fluff'] }));
    const packer = f.add(createPacker(clock, ledger, { id: 'packer', origin: [0, 0, 0], prefill: true }));
    const beltB = f.add(createConveyor(clock, { id: 'beltB', origin: [0, 32, 0], axis: 'y', dir: 1, length: 60, top: 192, width: 18, inAt: 2 }));
    const sink = f.add(createSink(clock, ledger, { id: 'sink', origin: [0, 32, 0], floorZ: 0 }));
    f.link(src, 'out', packer);
    f.link(packer, 'out', beltB);
    f.link(beltB, 'out', sink);
    let maxNest = 0;
    for (let i = 0; i < 60 * 120; i++) {
      f.run(H);
      maxNest = Math.max(maxNest, (packer.status() as { nest: number }).nest);
    }
    const s = packer.status() as { nest: number };
    report(`packer 60 s at 0.9 s/bead: ${src.made} made, ${packer.stats.beads} in, ${packer.stats.packets} packets, nest ${s.nest} (max ${maxNest})\n`);
    // The source never waited: 67 ticks in 60 s (one at 0).
    expect(src.made).toBe(67);
    expect(packer.stats.packets).toBeGreaterThanOrEqual(20);
    // Balanced: at most one bead waits behind the pockets (the one just in), the feed never fills.
    expect(s.nest).toBeLessThanOrEqual(4);
    expect(maxNest).toBeLessThan(PK.nestMax);
  });

  it('moves beads and packets without pops, through belt A → packer → belt B (120 s)', () => {
    const g = createPackerPage();
    const f = g.factory;
    const last = new Map<number, [number, number, number]>();
    const owner = new Map<number, string>();
    const seen = new Map<number, [string, number, number, number]>();
    let worst = 0;
    let worstHand = 0;
    let hands = 0;
    let closest = Infinity;
    const P = g.packer.origin;
    for (let i = 0; i < 120 * 120; i++) {
      f.run(H);
      expect(f.ledger.created).toBe(f.alive() + f.ledger.consumed);
      seen.clear();
      g.beltA.poses((_, item, x, y, z) => seen.set(item.id, ['beltA', x + g.beltA.origin[0], y + g.beltA.origin[1], z]));
      const nest: V3[] = [];
      g.packer.beads((_, x, y, z, key) => {
        if (key > 0) seen.set(key, ['packer', x + P[0], y + P[1], z]);
        // On the feed, in the gutter or on the cups (a carton's three settle into each other).
        if (Math.abs(y - PK.gutter.y) < 0.5) nest.push([x, y, z]);
      });
      g.packer.poses((_, item, x, y, z) => seen.set(item.id, ['packer', x + P[0], y + P[1], z]));
      g.beltB.poses((_, item, x, y, z) => seen.set(item.id, ['beltB', x + g.beltB.origin[0], y + g.beltB.origin[1], z]));
      for (let a = 0; a < nest.length; a++) for (let b = a + 1; b < nest.length; b++) closest = Math.min(closest, dist(nest[a]!, nest[b]!));
      for (const [id, [m, x, y, z]] of seen) {
        const p = last.get(id);
        if (p) {
          const d = Math.hypot(x - p[0], y - p[1], z - p[2]);
          if (owner.get(id) !== m) {
            hands++;
            worstHand = Math.max(worstHand, d);
          }
          worst = Math.max(worst, d);
        }
        last.set(id, [x, y, z]);
        owner.set(id, m);
      }
    }
    expect(hands).toBeGreaterThan(60);
    // 1.5 units per step is 180 u/s: the picker's plunge peaks at 130 u/s (v2: 25 down in 0.36 s).
    expect(worst).toBeLessThan(1.5);
    expect(worstHand).toBeLessThan(1);
    // Beads in the feed and gutter never overlap (diameter 4.8).
    expect(closest).toBeGreaterThan(4.5);
    report(`packer page: ${hands} hand-offs, worst step ${worst.toFixed(3)}, at a hand-off ${worstHand.toFixed(3)}, closest beads ${closest.toFixed(2)}\n`);
  });

  it('is deterministic', () => {
    const run = () => {
      const g = createPackerPage();
      g.factory.run(75);
      return snapshot(g.factory, { packer: g.packer.status(), a: g.beltA.status(), b: g.beltB.items.map((it) => [it.item.id, it.p]) });
    };
    expect(run()).toEqual(run());
  });
});

describe('input path on the line (bead source → belt A → packer → belt B)', () => {
  it('links in step order; belt A and the packer each have one sender that asks', () => {
    const g = createLine(LINE_LAYOUT);
    const ids = g.factory.machines.map((m) => m.id);
    expect(ids.slice(0, 5)).toEqual(['beads', 'beltA', 'packer', 'beltB', 'centrifuge']);
    expect(g.source).toBe(null);
    expect(g.beadSource!.outs.out.asks).toBe(true);
    expect(g.beltA!.outs.out.asks).toBe(true);
    expect(g.packer!.outs.out.asks).toBe(true);
    // The world ports line up with v2 A: belt A's head at x 57, the packet out at [100, −163, 200].
    expect(g.beltA!.origin).toEqual([-4, -190, 0]);
    expect(g.beltA!.geometry.L).toBe(61);
    expect(g.packer!.origin).toEqual([100, -190, 0]);
    // A second asking sender into belt B is refused.
    const f = createFactory();
    const p = f.add(createPacker(f.clock, f.ledger, { id: 'p', origin: [0, 0, 0] }));
    const q = f.add(createSource(f.clock, f.ledger, { id: 'q', origin: [0, 0, 0], from: [0, 0, 0] }));
    const b = f.add(createConveyor(f.clock, { id: 'b', origin: [0, 32, 0], axis: 'y', length: 60, top: 192 }));
    f.link(p, 'out', b);
    expect(() => f.link(q, 'out', b)).toThrow(/already has a sender that asks/);
    // A packer added after its receiver is refused.
    const g2 = createFactory();
    const b2 = g2.add(createConveyor(g2.clock, { id: 'b', origin: [0, 32, 0], axis: 'y', length: 60, top: 192 }));
    const p2 = g2.add(createPacker(g2.clock, g2.ledger, { id: 'p', origin: [0, 0, 0] }));
    expect(() => g2.link(p2, 'out', b2)).toThrow(/must step before/);
  });

  it('is deterministic, every machine on the line (status, poses, outputs)', () => {
    const run = () => {
      const g = createLine(LINE_LAYOUT);
      g.factory.run(63.7);
      const beads: number[] = [];
      g.packer!.beads((_, x, y, z) => beads.push(x, y, z));
      return snapshot(g.factory, {
        beads,
        packer: g.packer!.outputs(out()),
        scanner: g.scanner!.outputs({ head: 0, theta: 0, lamp: 0, cells: [0, 0, 0, 0] }),
        speaker: g.speaker!.outputs({ cone: 0, cap: 0, lit: 0, peak: -1 }),
        travel: g.elevator!.travel(),
        beltD: g.beltD!.items,
        audio: g.audio.items,
      });
    };
    expect(run()).toEqual(run());
  });

  it('feeds the centrifuge: conservation on every step, every machine busy (300 s)', () => {
    const g = createLine(LINE_LAYOUT);
    const f = g.factory;
    for (let i = 0; i < 300 * 120; i++) {
      f.run(H);
      expect(f.ledger.created).toBe(f.alive() + f.ledger.consumed);
    }
    expect(g.packer!.stats.packets).toBeGreaterThan(60);
    expect(g.crusher!.stats().count).toBeGreaterThan(30);
    expect(g.speaker!.stats.heard).toBeGreaterThan(30);
    const words = g.centrifuge.state.log.map((x) => x.phase);
    expect(words.filter((w) => w === 'in sync').length).toBeGreaterThanOrEqual(5);
    report(`line 300 s: ${g.beadSource!.made} beads, ${g.packer!.stats.packets} packets, ${g.crusher!.stats().count} crushed, ${g.speaker!.stats.heard} heard; log\n${g.centrifuge.state.log.map((x) => `${x.t.toFixed(2)} ${x.phase}`).join('\n')}\n`);
  });
});
