import { describe, expect, it } from 'vitest';
import { LINE_LAYOUT, createLine, createScannerPage } from '../src/sim/graphs.ts';
import { PACKET_SIZE } from '../src/sim/items.ts';
import { SC, type ScannerOutputs } from '../src/sim/scanner.ts';
import { report, snapshot } from './rig.ts';

const H = 1 / 120;
const outputs = (): ScannerOutputs => ({ head: 0, theta: 0, lamp: 0, cells: [0, 0, 0, 0] });

describe('scanner on the line (loop → scanner → belt D → elevator)', () => {
  it('reads once per quantum, and makes one packet per 4 landed pulses; conserves items (120 s)', () => {
    const g = createLine(LINE_LAYOUT);
    const f = g.factory;
    const sc = g.scanner!;
    const q0 = g.audio.quanta().count;
    let maxInFlight = 0;
    for (let i = 0; i < 120 * 120; i++) {
      f.run(H);
      expect(f.ledger.created).toBe(f.alive() + f.ledger.consumed);
      const s = sc.stats;
      expect(s.made).toBe(Math.floor(s.delivered / SC.perPacket));
      expect(s.sent === s.made || s.sent === s.made - 1).toBe(true);
      maxInFlight = Math.max(maxInFlight, s.reads - s.delivered);
    }
    const s = sc.stats;
    // The scanner steps before the loop: it has read every quantum the loop counted up to the last step.
    const quanta = g.audio.quanta().count - q0;
    expect(s.reads === quanta || s.reads === quanta - 1).toBe(true);
    expect(s.reads).toBeGreaterThan(200);
    // A pulse takes ≈ 1.8 s to land: at most 4 in flight at 0.57 s a quantum.
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(s.sent).toBeGreaterThan(45);
    expect(g.elevator!.stats.taken).toBeGreaterThan(40);
    report(`scanner: ${s.reads} reads, ${s.delivered} landed, ${s.made} made, ${s.sent} sent, ${g.elevator!.stats.taken} reached the elevator\n`);
  });

  it('greys a parcel at the instant of a read (one source: the loop read point)', () => {
    const g = createLine(LINE_LAYOUT);
    const spending = new Set<number>();
    let greyed = 0;
    for (let i = 0; i < 90 * 120; i++) {
      g.factory.run(H);
      // A parcel starts greying in the loop's step; the scanner counts that read in the next step.
      let started = false;
      for (const it of g.audio.items) {
        if (it.spending && !spending.has(it.item.id)) {
          spending.add(it.item.id);
          started = true;
        }
      }
      if (started) {
        greyed++;
        const was = g.scanner!.stats.reads;
        g.factory.run(H);
        expect(g.scanner!.stats.reads).toBe(was + 1);
      }
    }
    expect(greyed).toBeGreaterThan(10);
  });

  it('keeps the head over a cleat while it tracks, inside its window, clear of the parcels', () => {
    const g = createLine(LINE_LAYOUT);
    const sc = g.scanner!;
    const a = g.audio;
    const o = outputs();
    const period = a.geometry.cleatGap / a.geometry.speed;
    const parcelEdge = a.origin[1] - PACKET_SIZE.d / 2;
    let tracked = 0;
    for (let i = 0; i < 30 * 120; i++) {
      g.factory.run(H);
      sc.outputs(o);
      expect(Math.abs(o.head)).toBeLessThanOrEqual(SC.track + 1e-9);
      // The head's slider (±0.9 across) stays outside the parcels' lane on the belt.
      expect(sc.origin[1] + SC.reach * Math.cos(o.theta) + 0.9).toBeLessThan(parcelEdge);
      const q = a.quanta();
      if (q.phase * period < SC.seek + 1e-6) continue;
      const hx = sc.origin[0] + o.head;
      let best = Infinity;
      a.cleats((_, x, __, z) => {
        if (z > a.geometry.T - 0.5) best = Math.min(best, Math.abs(a.origin[0] + x - hx));
      });
      // Tracking (or waiting at the window's start for the next cleat, ≤ 0.27 away).
      if (Math.abs(o.head) < SC.track - 1e-6) {
        expect(best).toBeLessThan(1e-6);
        tracked++;
      } else expect(best).toBeLessThan(a.geometry.cleatGap - 2 * SC.track + 1e-6);
    }
    expect(tracked).toBeGreaterThan(2000);
  });

  it('hands packets from the preamp lip onto belt D without a pop', () => {
    const g = createLine(LINE_LAYOUT);
    const last = new Map<number, [string, number, number, number]>();
    const seen = new Map<number, [string, number, number, number]>();
    let handOffs = 0;
    let worstHand = 0;
    let worst = 0;
    for (let i = 0; i < 60 * 120; i++) {
      g.factory.run(H);
      seen.clear();
      for (const [m, src] of [['scanner', g.scanner!], ['beltD', g.beltD!]] as const) {
        src.poses((_, item, x, y, z) => seen.set(item.id, [m, x + src.origin[0], y + src.origin[1], z + src.origin[2]]));
      }
      for (const [id, p] of seen) {
        const q = last.get(id);
        if (q) {
          const d = Math.hypot(p[1] - q[1], p[2] - q[2], p[3] - q[3]);
          worst = Math.max(worst, d);
          if (q[0] === 'scanner' && p[0] === 'beltD') {
            handOffs++;
            worstHand = Math.max(worstHand, d);
          }
        }
        last.set(id, p);
      }
    }
    expect(handOffs).toBeGreaterThan(20);
    // Under 0.5 per step (the push leaves the lip at 24 u/s, belt D runs at 28).
    expect(worst).toBeLessThan(0.5);
    expect(worstHand).toBeLessThan(0.5);
    report(`scanner → belt D: ${handOffs} hand-offs, worst step ${worst.toFixed(3)}, at a hand-off ${worstHand.toFixed(3)}\n`);
  });

  it('is deterministic', () => {
    const run = () => {
      const g = createLine(LINE_LAYOUT);
      g.factory.run(47.3);
      const o = g.scanner!.outputs(outputs());
      return snapshot(g.factory, { scanner: g.scanner!.status!(), o, beltD: g.beltD!.items, audio: g.audio.items });
    };
    expect(run()).toEqual(run());
  });
});

describe('scanner page (v2: source → loop, scanner, belt D)', () => {
  it('runs 90 s: reads, fills, packets reach the end of belt D; conserves items', () => {
    const g = createScannerPage();
    for (let i = 0; i < 90 * 120; i++) {
      g.factory.run(H);
      expect(g.factory.ledger.created).toBe(g.factory.alive() + g.factory.ledger.consumed);
    }
    expect(g.scanner.stats.reads).toBeGreaterThan(150);
    expect(g.sinkD.taken).toBeGreaterThan(30);
    expect(g.audio.stats.spent).toBeGreaterThan(10);
  });
});
