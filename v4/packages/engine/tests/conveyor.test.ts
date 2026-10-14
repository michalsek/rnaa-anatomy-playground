import { describe, expect, it } from 'vitest';
import { createFactory } from '../src/sim/clock.ts';
import { createConveyor } from '../src/sim/conveyor.ts';
import { CENTRIFUGE_LAYOUT, LINE_LAYOUT, createConveyorPage, createLine } from '../src/sim/graphs.ts';
import { createLoop } from '../src/sim/loop.ts';
import { type Run, pathPoint, stadium } from '../src/sim/path.ts';
import type { Receiver, V3 } from '../src/sim/ports.ts';
import { createSink } from '../src/sim/sink.ts';
import { createSource } from '../src/sim/source.ts';
import { report } from './rig.ts';

const H = 1 / 120;
const ZERO: V3 = [0, 0, 0];

describe('factory clock', () => {
  it('advance clamps a long frame and drops the rest (no catch-up burst)', () => {
    const f = createFactory();
    let steps = 0;
    f.add({ id: 'count', step: () => steps++, alive: () => 0 });
    expect(f.advance(10)).toBe(4);
    expect(steps).toBe(4);
    expect(f.clock.t).toBeCloseTo(4 * H, 9);
    expect(f.advance(1 / 30, 4)).toBe(8);
    expect(f.clock.acc).toBe(0);
  });

  it('links only a sender that steps before its receiver', () => {
    const f = createFactory();
    const belt = createConveyor(f.clock, { id: 'b', origin: [0, 0, 0], axis: 'x', length: 60, top: 40 });
    const sink = f.add(createSink(f.clock, f.ledger, { id: 'sink', origin: [0, 0, 0] }));
    f.add(belt);
    expect(() => f.link(belt, 'out', sink)).toThrow(/step before/);
  });

  it('refuses a strict receiver behind a sender that does not ask (no hold, or a tipping hold)', () => {
    const f = createFactory();
    const strict = { ...createSink(f.clock, f.ledger, { id: 'strict', origin: [0, 0, 0] }), strict: true };
    const plain = f.add(createConveyor(f.clock, { id: 'plain', origin: [0, 0, 0], axis: 'x', length: 60, top: 40 }));
    const tipping = f.add(createConveyor(f.clock, { id: 'tipping', origin: [0, 0, 0], axis: 'x', length: 60, top: 40, hold: true }));
    const asking = f.add(createConveyor(f.clock, { id: 'asking', origin: [0, 0, 0], axis: 'x', length: 60, top: 40, hold: true, tip: false }));
    f.add(strict);
    expect(() => f.link(plain, 'out', strict)).toThrow(/strict receiver/);
    expect(() => f.link(tipping, 'out', strict)).toThrow(/strict receiver/);
    expect(() => f.link(asking, 'out', strict)).not.toThrow();
  });
});

describe('top conveyor', () => {
  it('scrolls its slats with the parcels on a −1 belt', () => {
    const f = createFactory();
    const belt = f.add(createConveyor(f.clock, { id: 'b', origin: [0, 0, 0], axis: 'x', dir: -1, length: 60, top: 40 }));
    belt.outs.out.connect({ id: 'r', origin: [0, 0, 0], canAccept: () => true, accept: (item) => f.ledger.consume(item) });
    belt.accept(f.ledger.make('control'), [52, 0, 41], ZERO);
    const g = belt.geometry;
    // The band's u is the stadium arc length along the travel; slat 0 sits at u = uShift.
    const path = stadium({ L: g.L, R: g.RW, zc: g.zc, dir: g.dir });
    const p = pathPoint();
    f.run(1);
    const s0 = belt.items[0]!.s;
    // A slat on the top run (shift it by whole slat pitches until it is on the top run).
    const slatS = () => {
      for (let k = 0; k < 200; k++) {
        path.at(belt.uShift() * g.total + k * g.pitch, g.RW, p);
        if (p.run === 'top' && p.s > 10 && p.s < g.L - 10) return { k, s: p.s };
      }
      throw new Error('no slat on the top run');
    };
    const a = slatS();
    f.run(0.25);
    path.at(belt.uShift() * g.total + a.k * g.pitch, g.RW, p);
    const slatMove = p.s - a.s;
    const parcelMove = belt.items[0]!.s - s0;
    expect(parcelMove).toBeLessThan(-1);
    expect(Math.sign(slatMove)).toBe(Math.sign(parcelMove));
    expect(slatMove).toBeCloseTo(g.speed * 0.25 * g.dir, 1);
  });

  it('holds: the front waits short of the out point, the rest queue an item length apart', () => {
    const f = createFactory();
    const belt = f.add(createConveyor(f.clock, { id: 'b', origin: [0, 0, 0], axis: 'y', length: 120, top: 60, tip: false, hold: true }));
    const source = f.add(createSource(f.clock, f.ledger, { id: 's', origin: [0, 0, 0], from: [0, 8, 84], every: 0.6, rest: 0 }));
    let open = false;
    const receiver: Receiver & { id: string; origin: V3 } = {
      id: 'r',
      origin: [0, 0, 0],
      canAccept: () => open,
      accept: (item) => {
        expect(open).toBe(true);
        f.ledger.consume(item);
      },
    };
    source.outs.out.connect(belt);
    belt.outs.out.connect(receiver);
    const { outS, dir } = belt.geometry;
    for (let i = 0; i < 40 * 120; i++) {
      f.run(H);
      const riding = belt.items.filter((x) => x.phase === 'ride').sort((a, b) => (b.s - a.s) * dir);
      for (const it of riding) expect((it.s - outS) * dir).toBeLessThan(0);
      // Once the queue has settled (items at rest), they sit 2·4 + 1.5 apart.
      for (let k = 1; k < riding.length; k++) {
        const gap = (riding[k - 1]!.s - riding[k]!.s) * dir;
        if (riding[k]!.v === 0) expect(gap).toBeGreaterThanOrEqual(9.5 - 1e-6);
      }
    }
    // Backed up to the in point: the source holds, the belt is full but bounded.
    expect(belt.items.length).toBeGreaterThanOrEqual(10);
    expect(belt.items.length).toBeLessThanOrEqual(13);
    const queued = belt.items.length;
    open = true;
    f.run(20);
    expect(f.ledger.consumed).toBeGreaterThan(queued);
    expect(f.ledger.created).toBe(f.alive() + f.ledger.consumed);
  });

  it('tips off the head drum and hands on 16 below the belt, with its velocity', () => {
    const f = createFactory();
    const belt = f.add(createConveyor(f.clock, { id: 'b', origin: [0, 0, 0], axis: 'x', length: 60, top: 40 }));
    const got: { from: V3; v: V3 }[] = [];
    belt.outs.out.connect({ id: 'r', origin: [0, 0, 0], canAccept: () => true, accept: (_, from, v) => got.push({ from, v }) });
    belt.accept(f.ledger.make('control'), [8, 0, 64], ZERO);
    f.run(10);
    expect(got).toHaveLength(1);
    expect(got[0]!.from[2]).toBeCloseTo(40 - 16, 0);
    expect(got[0]!.v[0]).toBeGreaterThan(10);
    expect(got[0]!.v[2]).toBeLessThan(0);
  });
});

describe('audio loop', () => {
  const loopOf = () => {
    const f = createFactory();
    const loop = f.add(createLoop(f.clock, { id: 'audio', origin: [0, 0, 0], axis: 'x', length: 197.5, top: 92, inAt: 185.5, readAt: 120 }));
    const sink = f.add(createSink(f.clock, f.ledger, { id: 'sink', origin: [0, 0, 0] }));
    loop.outs.drop.connect(sink);
    return { f, loop, sink };
  };

  it('has v2 A geometry: 27 cleats, a quantum of about 0.57 s', () => {
    const { loop } = loopOf();
    const g = loop.geometry;
    expect(g.nCleats).toBe(27);
    expect(g.cleatGap / g.speed).toBeCloseTo(0.566, 2);
    expect(g.ports.drop[2]).toBeCloseTo(47.8, 6);
  });

  it('quanta().phase wraps once per cleat gap, and count steps by one', () => {
    const { f, loop } = loopOf();
    const period = loop.quanta().period;
    let wraps = 0;
    let prev = loop.quanta();
    const steps = Math.round((10 * period) / H);
    for (let i = 0; i < steps; i++) {
      f.run(H);
      const q = loop.quanta();
      if (q.phase < prev.phase) {
        wraps++;
        expect(q.count).toBe(prev.count + 1);
      } else expect(q.count).toBe(prev.count);
      prev = q;
    }
    expect(wraps).toBeGreaterThanOrEqual(9);
    expect(wraps).toBeLessThanOrEqual(10);
  });

  it('canTake never refuses a sender that asked first (one ask per quantum, like the centrifuge)', () => {
    const { f, loop } = loopOf();
    const pending: number[] = [];
    let sent = 0;
    let refusedAsks = 0;
    let prevPhase = loop.phaseAt(loop.geometry.uIn);
    // A sender that wants to send at most once per quantum (a gate crossing), 3 quanta in 4,
    // asking with the centrifuge's lead (1.09 s) and sending after it.
    let crossing = 0;
    for (let i = 0; i < 180 * 120; i++) {
      f.run(H);
      const t = f.clock.t;
      const ph = loop.phaseAt(loop.geometry.uIn, 1.3);
      if (ph < prevPhase && crossing++ % 4 !== 3) {
        if (loop.canTake(1.09)) pending.push(t + 1.09);
        else refusedAsks++;
      }
      prevPhase = ph;
      while (pending.length && pending[0]! <= t) {
        pending.shift();
        // accept throws when no free cleat is in reach.
        loop.accept(f.ledger.make('control', Math.PI / 2), [loop.geometry.inS, 0, 100], [0, 17, -60]);
        sent++;
      }
    }
    expect(sent).toBeGreaterThan(150);
    // Every parcel found a free cleat in reach.
    expect(loop.stats.late).toBe(0);
    // The belt fills (each parcel rides 1.5 laps), so some asks are answered "not now".
    expect(refusedAsks).toBeGreaterThan(0);
    expect(f.ledger.created).toBe(f.alive() + f.ledger.consumed);
  });

  it('a parcel rides top → head → bottom → greyed → tail → top → drop', () => {
    const { f, loop, sink } = loopOf();
    loop.accept(f.ledger.make('graph'), [loop.geometry.inS, 0, 100], [0, 0, -40]);
    const p = pathPoint();
    const seen: string[] = [];
    let greyedOn: Run | null = null;
    let last = '';
    for (let i = 0; i < 40 * 120 && sink.taken === 0; i++) {
      f.run(H);
      const it = loop.items[0];
      if (!it || it.phase !== 'ride') continue;
      const u = (it.cleat * loop.geometry.cleatGap + loop.travel) % loop.path.total;
      loop.path.at(u, undefined, p);
      if (p.run !== last) seen.push((last = p.run));
      if (it.spend >= 1 && greyedOn === null) {
        greyedOn = p.run;
        seen.push('greyed');
      }
    }
    expect(seen).toEqual(['top', 'head', 'bottom', 'greyed', 'tail', 'top', 'head']);
    expect(greyedOn).toBe('bottom');
    expect(sink.taken).toBe(1);
    expect(loop.stats.dropped).toBe(1);
    expect(loop.items).toHaveLength(0);
  });
});

describe('line graph', () => {
  it('conserves items, lands releases on free cleats in phase, hands off without pops (120 s)', () => {
    const g = createLine(LINE_LAYOUT);
    const { factory: f, audio, centrifuge } = g;
    let landed = 0;
    let worstBend = 0;
    const seenRide = new Set<number>();
    const seenFall = new Set<number>();
    // Continuity: every item's world position per step, across machines.
    const last = new Map<number, [number, number, number]>();
    const owner = new Map<number, string>();
    let worst = 0;
    let handOffs = 0;
    let worstHand = 0;
    const seen = new Map<number, [string, number, number, number]>();
    const at = (m: string, o: readonly number[]) => (id: number, x: number, y: number, z: number) => seen.set(id, [m, x + o[0]!, y + o[1]!, z + o[2]!]);
    const b = at('beltB', g.beltB.origin);
    const c = at('centrifuge', g.centrifuge.origin);
    const a = at('audio', g.audio.origin);
    const cc = at('beltC', g.beltC!.origin);
    const cr = at('crusher', g.crusher!.origin);
    for (let i = 0; i < 120 * 120; i++) {
      f.run(H);
      expect(f.ledger.created).toBe(f.alive() + f.ledger.consumed);
      for (const it of audio.items) {
        if (it.phase === 'ride' && !seenRide.has(it.item.id)) {
          seenRide.add(it.item.id);
          landed++;
        }
        // The fall's bend: how far the landing cleat was from the in point when the parcel was handed on.
        if (it.phase === 'fall' && !seenFall.has(it.item.id)) {
          seenFall.add(it.item.id);
          const u = (it.cleat * audio.geometry.cleatGap + audio.travel + audio.geometry.speed * it.fall!.dur * (1 - it.fall!.tau)) % audio.path.total;
          worstBend = Math.max(worstBend, Math.abs(u - audio.geometry.uIn));
        }
      }
      seen.clear();
      g.beltB.poses((_, item, x, y, z) => b(item.id, x, y, z));
      g.centrifuge.poses((_, item, x, y, z) => c(item.id, x, y, z));
      g.audio.poses((_, item, x, y, z) => a(item.id, x, y, z));
      g.beltC!.poses((_, item, x, y, z) => cc(item.id, x, y, z));
      g.crusher!.poses((_, item, x, y, z) => cr(item.id, x, y, z));
      for (const [id, [m, x, y, z]] of seen) {
        const p = last.get(id);
        if (p) {
          // A hanging parcel's pose origin is its top (upside down); belt C's is its bottom.
          const flip = owner.get(id) === 'audio' && m === 'beltC' ? 7 : 0;
          const d = Math.hypot(x - p[0], y - p[1], z + flip - p[2]);
          if (owner.get(id) !== m) {
            handOffs++;
            worstHand = Math.max(worstHand, d);
          }
          worst = Math.max(worst, d);
        }
        last.set(id, [x, y, z]);
        owner.set(id, m);
      }
    }
    expect(landed).toBeGreaterThan(10);
    expect(audio.stats.dropped).toBeGreaterThan(5);
    expect(g.crusher!.stats().count).toBeGreaterThan(3);
    expect(centrifuge.state.log.map((x) => x.phase)).toContain('in sync');
    // In sync, the lock lands parcels within a few units of their cleat (no long bends).
    expect(worstBend).toBeLessThan(4);
    expect(audio.stats.late).toBe(0);
    // 3 units per 1/120 s step is 360 units/s: faster than anything moves here; at a hand-off
    // the step is no bigger than the motion either side of it.
    expect(handOffs).toBeGreaterThan(20);
    expect(worst).toBeLessThan(3);
    expect(worstHand).toBeLessThan(2.5);
    report(`line: ${landed} landed, ${g.crusher!.stats().count} crushed, worst bend ${worstBend.toFixed(2)}; hand-offs ${handOffs}, worst step ${worst.toFixed(2)}, at a hand-off ${worstHand.toFixed(2)}; log\n${centrifuge.state.log.map((x) => `${x.t.toFixed(2)} ${x.phase}`).join("\n")}\n`);
  });

  it('the centrifuge scene layout runs the cycle', () => {
    const g = createLine(CENTRIFUGE_LAYOUT);
    g.factory.run(60);
    const words = g.centrifuge.state.log.map((x) => x.phase);
    expect(words.slice(0, 6)).toEqual(['idle', 'filling', 'spinning up', 'in sync', 'spinning down', 'filling']);
    expect(g.factory.ledger.created).toBe(g.factory.alive() + g.factory.ledger.consumed);
  });
});

describe('v2 conveyor page graph', () => {
  it('runs 120 s: parcels ride round, grey, drop onto belt C and into the bin', () => {
    const g = createConveyorPage();
    for (let i = 0; i < 120 * 120; i++) {
      g.factory.run(H);
      expect(g.factory.ledger.created).toBe(g.factory.alive() + g.factory.ledger.consumed);
    }
    expect(g.audio.stats.dropped).toBeGreaterThan(5);
    expect(g.sink.taken).toBeGreaterThan(5);
  });
});
