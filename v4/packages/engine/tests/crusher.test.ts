import { describe, expect, it } from 'vitest';
import { type BinMode, CR, CRUSH_GAP, type CrusherOutputs } from '../src/sim/crusher.ts';
import { LINE_LAYOUT, createCrusherPage, createLine } from '../src/sim/graphs.ts';
import { RATES } from '../src/sim/rates.ts';
import { snapshot } from './rig.ts';

const H = 1 / 120;
const out = (): CrusherOutputs => ({ phase: 0, belt: 0, spin: 0, kick: 0, lamp: 0, needle: 0, gate: 0, bin: 0, pile: 0, fill: 0 });

describe('crusher (v2 crusher page: source → belt C → crusher)', () => {
  it('conserves packets and keeps its lanes apart (180 s)', () => {
    const g = createCrusherPage();
    const f = g.factory;
    let flakesSeen = 0;
    for (let i = 0; i < 180 * 120; i++) {
      f.run(H);
      expect(f.ledger.created).toBe(f.alive() + f.ledger.consumed);
      // Sliding flakes never pass through one another (v2 REVIEW 12): 1.9 apart in a lane.
      const lanes = new Map<number, number[]>();
      g.crusher.flakes((_, __, y, ___, ____, _____, flat, lane) => {
        flakesSeen++;
        if (flat > 0) return;
        if (y <= CR.CHUTE.y1) (lanes.get(lane) ?? lanes.set(lane, []).get(lane)!).push(y);
      });
      for (const ys of lanes.values()) {
        ys.sort((a, b) => a - b);
        for (let k = 1; k < ys.length; k++) expect(ys[k]! - ys[k - 1]!).toBeGreaterThan(1.9 - 0.25);
      }
    }
    expect(g.crusher.stats().count).toBeGreaterThan(60);
    expect(flakesSeen).toBeGreaterThan(1000);
  });

  it('dumps the bin at 10 packets: gate shut → out → dump → back → home, and the queue drains', () => {
    const g = createCrusherPage();
    const f = g.factory;
    const o = out();
    const modes: BinMode[] = ['home'];
    let atFull = -1;
    let maxBin = 0;
    let fallingWhileAway = 0;
    let prevMode: BinMode = 'home';
    for (let i = 0; i < 70 * 120; i++) {
      f.run(H);
      const s = g.crusher.stats();
      g.crusher.outputs(o);
      if (s.bin !== prevMode) {
        modes.push(s.bin);
        if (s.bin === 'full' && atFull < 0) atFull = s.count;
        if (prevMode === 'dump') expect(s.fill).toBe(0);
        prevMode = s.bin;
      }
      if (s.bin === 'out' || s.bin === 'dump' || s.bin === 'back') {
        expect(o.gate).toBeLessThan(0.2);
        let falling = 0;
        g.crusher.flakes((_, __, y, ___, ____, _____, flat) => {
          if (flat === 0 && y > CR.CHUTE.y1 + 0.4) falling++;
        });
        fallingWhileAway += falling;
      }
      if (s.bin === 'dump') expect(o.bin).toBeCloseTo(CR.BIN.travel, 6);
      maxBin = Math.max(maxBin, o.bin);
    }
    expect(modes.slice(0, 6)).toEqual(['home', 'full', 'out', 'dump', 'back', 'home']);
    // The 10th packet's last flakes fill it.
    expect(atFull).toBeGreaterThanOrEqual(RATES.binDump);
    expect(atFull).toBeLessThanOrEqual(RATES.binDump + 2);
    expect(maxBin).toBeCloseTo(CR.BIN.travel, 6);
    expect(fallingWhileAway).toBe(0);
    // Back home, the queue behind the gate went into the bin.
    expect(g.crusher.stats().fill).toBeGreaterThan(0);
  });

  it('speeds up for a packet and settles between them; the lamp pulses; the needle steps', () => {
    const g = createCrusherPage();
    const f = g.factory;
    const o = out();
    let maxSpin = 0;
    let minSpinLate = Infinity;
    let lampOn = 0;
    let lampOff = 0;
    for (let i = 0; i < 30 * 120; i++) {
      f.run(H);
      g.crusher.outputs(o);
      maxSpin = Math.max(maxSpin, o.spin);
      if (f.clock.t > 10) minSpinLate = Math.min(minSpinLate, o.spin);
      if (f.clock.t > 10 && o.lamp > 0.9) lampOn++;
      if (f.clock.t > 10 && o.lamp < 0.2) lampOff++;
    }
    expect(maxSpin).toBeGreaterThan(4.2);
    expect(minSpinLate).toBeLessThan(1.8);
    expect(lampOn).toBeGreaterThan(60);
    expect(lampOff).toBeGreaterThan(20);
    // Let the needle settle with no new packets: one 20th of a turn per packet.
    g.source.outs.out.connect({ id: 'none', origin: [0, 0, 0], canAccept: () => false, accept: () => {} });
    f.run(12);
    g.crusher.outputs(o);
    expect(o.needle).toBeCloseTo((g.crusher.stats().count * 2 * Math.PI) / 20, 2);
  });

  it('is deterministic', () => {
    const run = () => {
      const g = createCrusherPage();
      g.factory.run(40);
      const fl: number[] = [];
      g.crusher.flakes((_, x, y, z) => fl.push(x, y, z));
      return snapshot(g.factory, { stats: g.crusher.stats(), fl });
    };
    expect(run()).toEqual(run());
  });

  it('on the line, takes garbage bursts one packet at a time (belt C holds)', () => {
    const g = createLine(LINE_LAYOUT);
    const c = g.crusher!;
    const accepted: number[] = [];
    const accept = c.accept.bind(c);
    c.accept = (item, from, v) => {
      accepted.push(g.factory.clock.t);
      accept(item, from, v);
    };
    let held = 0;
    for (let i = 0; i < 150 * 120; i++) {
      g.factory.run(H);
      if (g.beltC!.held()) held++;
      expect(g.factory.ledger.created).toBe(g.factory.alive() + g.factory.ledger.consumed);
    }
    expect(accepted.length).toBeGreaterThan(10);
    for (let k = 1; k < accepted.length; k++) expect(accepted[k]! - accepted[k - 1]!).toBeGreaterThanOrEqual(CRUSH_GAP - 1e-6);
    // The loop drops a burst one per quantum (0.57 s): belt C queues them.
    expect(held).toBeGreaterThan(0);
  });
});
