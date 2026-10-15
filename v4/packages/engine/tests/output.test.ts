import { describe, expect, it } from 'vitest';
import { createFactory } from '../src/sim/clock.ts';
import { createConveyor } from '../src/sim/conveyor.ts';
import { EL, createElevator, elevatorFlight, elevatorGeometry } from '../src/sim/elevator.ts';
import { LINE_LAYOUT, createLine, createOutputPage } from '../src/sim/graphs.ts';
import { PACKET_SIZE } from '../src/sim/items.ts';
import { verticalStadium } from '../src/sim/path.ts';
import type { V3 } from '../src/sim/ports.ts';
import { RATES } from '../src/sim/rates.ts';
import { SPK, type SpeakerOutputs, createSpeaker } from '../src/sim/speaker.ts';
import { report } from './rig.ts';

const H = 1 / 120;
const spk = (): SpeakerOutputs => ({ cone: 0, cap: 0, lit: 0, peak: -1 });
const { w: PW, d: PD, h: PH } = PACKET_SIZE;
/** The 8 corners of a level packet whose bottom centre is p. */
const corners = (p: V3): V3[] => {
  const out: V3[] = [];
  for (const x of [-PW / 2, PW / 2]) for (const y of [-PD / 2, PD / 2]) for (const z of [0, PH]) out.push([p[0] + x, p[1] + y, p[2] + z]);
  return out;
};

describe('vertical stadium (E4 on its side)', () => {
  it('runs up the front run, over the head toward −y, down the back, round the boot; continuous', () => {
    const L = verticalStadium({ z0: 26, z1: 241.5, R: 13.5, yc: 0 });
    const a = L.at(0);
    expect([a.y, a.z, a.ty, a.tz, a.roll]).toEqual([13.5, 26, 0, 1, 0]);
    const top = L.at(L.uHead + (Math.PI * 13.5) / 2);
    expect(top.y).toBeCloseTo(0, 9);
    expect(top.z).toBeCloseTo(241.5 + 13.5, 9);
    expect(top.ty).toBeCloseTo(-1, 9);
    const back = L.at(L.uHeadEnd + 10);
    expect([back.run, back.y, back.ty, back.tz]).toEqual(['bottom', -13.5, 0, -1]);
    expect(Math.abs(back.roll)).toBeCloseTo(Math.PI, 9);
    let prev = L.at(0);
    for (let u = 0.05; u < L.total + 1; u += 0.05) {
      const p = L.at(u);
      expect(Math.hypot(p.y - prev.y, p.z - prev.z)).toBeLessThan(0.0501);
      prev = p;
    }
  });
});

describe('elevator geometry (v2 A: lift 210, spout −y, reach 40)', () => {
  it('has a capacity of ≈ 0.8/s; the line places it and the speaker at v2 A', () => {
    const g = elevatorGeometry({ lift: 210, reach: 40 });
    const capacity = RATES.elevatorSpeed / g.spacing;
    expect(capacity).toBeGreaterThan(0.78);
    expect(capacity).toBeLessThan(0.84);
    // On the line: the elevator at [−47, −226], the speaker at [−109, −300] (v2 A).
    expect(LINE_LAYOUT.output!.elevator).toEqual([-47, -226, 0]);
    expect(LINE_LAYOUT.output!.speaker).toEqual([-109, -300, 0]);
  });

  it('flings from the seat, drops into the hopper inside its walls, and hides through duct and spout', () => {
    const g = elevatorGeometry({ lift: 210, reach: 40 });
    const fl = elevatorFlight(g);
    const F = EL.fling;
    const Hp = EL.hopper;
    const p: V3 = [0, 0, 0];
    // Launch: the seat at the head's front tangent.
    fl.at(0, p);
    expect(p).toEqual([0, EL.r + EL.seat.n, g.zh + EL.seat.t]);
    const inHopper = (c: V3) => Math.abs(c[0]) <= Hp.x1 && c[1] >= Hp.y0 && c[1] <= Hp.y1 && c[2] >= g.hopperZ0 && c[2] <= g.rim;
    const inDuct = (c: V3) => Math.abs(c[0]) <= EL.ductHalf && c[1] >= g.duct.y0 && c[1] <= Hp.y0 && c[2] >= g.duct.z0 && c[2] <= g.duct.z1;
    const inSpout = (c: V3) => Math.hypot(c[0] - g.spout[0], c[1] - g.spout[1]) <= EL.spoutR && c[2] >= g.ports.out[2] - 1e-9 && c[2] <= g.duct.z0 + 1e-9;
    let below = 0;
    let hidden = 0;
    for (let tau = 0; tau <= fl.life; tau += 1 / 960) {
      fl.at(tau, p);
      const cs = corners(p);
      if (tau < F.fly) {
        // Clear of the chain's wrap over the head; once behind the head and below the rim, the
        // whole packet is over the hopper (its top clips it).
        for (const c of cs) if (Math.abs(c[1]) < EL.chain.R) expect(c[2]).toBeGreaterThan(g.zh + Math.sqrt(EL.chain.R ** 2 - c[1] ** 2));
        if (p[1] < 0 && p[2] < g.rim) {
          below++;
          for (const c of cs) expect(Math.abs(c[0]) <= Hp.x1 && c[1] >= Hp.y0 && c[1] <= Hp.y1).toBe(true);
        }
      } else if (tau < F.fly + F.duct) {
        hidden++;
        for (const c of cs) expect(inHopper(c) || inDuct(c) || inSpout(c)).toBe(true);
      } else {
        // Out of the mouth: the part above it is inside the spout.
        for (const c of cs) if (c[2] > g.ports.out[2] + 1e-9) expect(inSpout(c)).toBe(true);
      }
    }
    expect(below).toBeGreaterThan(10);
    expect(hidden).toBeGreaterThan(400);
  });
});

describe('output path on the line (belt D → elevator → speaker)', () => {
  it('keeps the boot queue ≤ 1 at 0.44/s, hears every packet lifted, conserves items (300 s)', () => {
    const g = createLine(LINE_LAYOUT);
    const f = g.factory;
    const el = g.elevator!;
    const sp = g.speaker!;
    for (let i = 0; i < 300 * 120; i++) {
      f.run(H);
      expect(f.ledger.created).toBe(f.alive() + f.ledger.consumed);
      // Heard = lifted: every packet out of the spout is in the speaker or heard.
      expect(sp.stats.heard + sp.alive()).toBe(el.stats.lifted);
    }
    expect(el.stats.maxQueue).toBeLessThanOrEqual(1);
    expect(el.stats.taken).toBeGreaterThan(110);
    expect(el.stats.lifted).toBeGreaterThan(110);
    // 0.44/s in, and nothing piles up: what came in is up the tower or out.
    expect(el.stats.taken - el.stats.lifted).toBeLessThan(10);
    report(`output (line, 300 s): ${el.stats.taken} into the boot, ${el.stats.lifted} lifted, ${sp.stats.heard} heard, queue ≤ ${el.stats.maxQueue}\n`);
  });
});

describe('output page (source → belt D → elevator → speaker)', () => {
  it('moves cradles and packets without pops; jumps only while hidden in the boot (120 s)', () => {
    const g = createOutputPage();
    const f = g.factory;
    const el = g.elevator;
    const geo = el.geometry;
    const R = EL.r;
    // Cradles: a step of the chain point and of its roll at most the chain's (half-step frames).
    const lastC: [number, number, number][] = [];
    // Packets (world), and whether a pose is inside the boot housing (hidden by depth).
    const lastP = new Map<number, V3>();
    const seen = new Map<number, V3>();
    const inBoot = (m: { origin: V3 }, p: V3) => {
      const y = p[1] - m.origin[1];
      const B = EL.boot;
      return m === el && Math.abs(p[0] - m.origin[0]) <= B.x1 && y >= B.y0 && y + PD / 2 <= B.y1 + 1e-9 && p[2] + PH <= EL.zBootTop;
    };
    const hiddenAt = new Map<number, boolean>();
    let worstCradle = 0;
    let worstRoll = 0;
    let worstPacket = 0;
    let jumps = 0;
    const dt = 1 / 240;
    for (let i = 0; i < 120 * 240; i++) {
      f.advance(dt);
      el.cradles((k, y, z, roll) => {
        const q = lastC[k];
        if (q) {
          worstCradle = Math.max(worstCradle, Math.hypot(y - q[0], z - q[1]));
          const dr = Math.abs(Math.atan2(Math.sin(roll - q[2]), Math.cos(roll - q[2])));
          worstRoll = Math.max(worstRoll, dr);
        }
        lastC[k] = [y, z, roll];
      });
      seen.clear();
      const hidden = new Map<number, boolean>();
      for (const m of [g.beltD, el, g.speaker] as const) {
        m.poses((_, item, x, y, z) => {
          const p: V3 = [x + m.origin[0], y + m.origin[1], z + m.origin[2]];
          seen.set(item.id, p);
          hidden.set(item.id, inBoot(m, p));
        });
      }
      for (const [id, p] of seen) {
        const q = lastP.get(id);
        if (q) {
          const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
          if (hidden.get(id) && hiddenAt.get(id)) {
            if (d > 1) jumps++;
          } else worstPacket = Math.max(worstPacket, d);
        }
        lastP.set(id, p);
        hiddenAt.set(id, hidden.get(id)!);
      }
    }
    // The chain moves 30/240 = 0.125 per frame; the roll 0.125 / R round the sprockets.
    expect(worstCradle).toBeLessThan(0.126);
    expect(worstRoll).toBeLessThan(0.126 / R + 1e-9);
    // Visible packets: the fastest are the fling off the cradle (≈ 110 u/s, plus the cradle's
    // extrapolated step in the launch frame) and the landing on the speaker's ledge (≈ 145 u/s).
    expect(worstPacket).toBeLessThan(0.8);
    expect(jumps).toBeGreaterThan(20);
    expect(el.stats.lifted).toBeGreaterThan(40);
    expect(el.stats.maxQueue).toBeLessThanOrEqual(1);
    report(`output page: cradle step ${worstCradle.toFixed(4)}, roll ${worstRoll.toFixed(5)}, visible packet step ${worstPacket.toFixed(3)}, ${jumps} jumps inside the boot, lifted ${el.stats.lifted} (cradles ${geo.count})\n`);
  });

  it('pumps the cone on every packet heard (damped 4.6 Hz, out first, cap ×1.35) and lights the meter', () => {
    const g = createOutputPage();
    const f = g.factory;
    const sp = g.speaker;
    const o = spk();
    let heard = sp.stats.heard;
    let kicks = 0;
    while (kicks < 5) {
      f.run(H);
      if (sp.stats.heard === heard) continue;
      heard = sp.stats.heard;
      kicks++;
      sp.outputs(o);
      expect(o.lit).toBeGreaterThanOrEqual(4);
      // A quarter period later (≈ 54 ms) the cone is out (up), near its amplitude.
      let max = 0;
      let first = 0;
      for (let k = 0; k < 14; k++) {
        f.run(H);
        sp.outputs(o);
        expect(o.cap).toBeCloseTo(o.cone * SPK.kick.cap, 9);
        max = Math.max(max, o.cone);
        if (k === 0) first = o.cone;
      }
      expect(first).toBeGreaterThan(0);
      expect(max).toBeGreaterThan(1.2);
      expect(max).toBeLessThanOrEqual(SPK.kick.amp * SPK.kick.hi + 1e-9);
    }
    // Quiet again: two seconds after the last packet the cone rests and the meter is dark.
    g.source.outs.out.connect({ id: 'void', origin: [0, 0, 0], canAccept: () => false, accept() {} });
    f.run(30);
    sp.outputs(o);
    expect(Math.abs(o.cone)).toBeLessThan(1e-9);
    expect(o.lit).toBe(0);
    expect(o.peak).toBe(-1);
  });
});

describe('output links', () => {
  it('steps belt D, the elevator, the speaker in order', () => {
    const f = createFactory();
    const beltD = f.add(createConveyor(f.clock, { id: 'beltD', origin: [0, 51, 0], axis: 'y', dir: -1, length: 60, top: 24, inAt: 52, outAt: 0, tip: false }));
    const speaker = createSpeaker(f.clock, f.ledger, { id: 'speaker', origin: [-62, -74, 0] });
    const elevator = createElevator(f.clock, f.ledger, { id: 'elevator', origin: [0, 0, 0] });
    f.add(speaker);
    f.add(elevator);
    expect(() => f.link(elevator, 'out', speaker)).toThrow(/step before/);
    f.link(beltD, 'out', elevator);
  });
});
