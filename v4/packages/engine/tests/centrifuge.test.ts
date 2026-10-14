import { describe, expect, it } from 'vitest';
import { CF, type CentrifugeSim, type SimState, createCentrifugeSim } from '../src/sim/centrifuge.ts';

const H = 1 / 120;
const TAU = Math.PI * 2;
const mod = (a: number, n: number) => ((a % n) + n) % n;
/** Signed angle difference in (−π, π]. */
const diff = (a: number, b: number) => mod(a - b + Math.PI, TAU) - Math.PI;
const held = (s: Readonly<SimState>) => s.pockets.filter(Boolean).length;
const alive = (s: Readonly<SimState>) =>
  s.feed.length + s.queue.length + s.falling.length + held(s) + s.releasing.length + s.belt.length;

/** Step a sim one fixed step at a time, calling `check(prev, sim)` after each. */
function walk(sim: CentrifugeSim, seconds: number, check: (prev: SimState, sim: CentrifugeSim) => void) {
  for (let i = 0; i < Math.round(seconds / H); i++) {
    const prev = structuredClone(sim.state) as SimState;
    sim.run(H);
    check(prev, sim);
  }
}

describe('centrifuge sim', () => {
  it('is deterministic: same dt sequence, same state; seeds rotate kinds only', () => {
    const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const a = createCentrifugeSim();
    const b = createCentrifugeSim();
    const ra = lcg(7);
    const rb = lcg(7);
    for (let t = 0; t < 45; ) {
      const dt = (1 / 30) * ra();
      expect(rb()).toBeCloseTo(dt * 30, 12);
      a.advance(dt);
      b.advance(dt);
      t += dt;
    }
    expect(b.state).toEqual(a.state);
    const seek = (seed = 0) => {
      const s = createCentrifugeSim({ seed });
      s.run(30);
      return s;
    };
    expect(seek().state).toEqual(seek().state);
    const s0 = seek(0);
    const s1 = seek(1);
    expect(s1.state.log).toEqual(s0.state.log);
    const kinds = (s: CentrifugeSim) => [...s.state.feed, ...s.state.queue].map((x) => x.kind).join('');
    expect(kinds(s1)).not.toEqual(kinds(s0));
  });

  it('runs the cycle: idle → filling → spinning up → in sync → spinning down → filling', () => {
    const sim = createCentrifugeSim();
    let reachedBelt = false;
    walk(sim, 45, (_, s) => {
      if (s.state.belt.length) reachedBelt = true;
    });
    const log = sim.state.log;
    const words = log.map((x) => x.phase);
    expect(words.slice(0, 6)).toEqual(['idle', 'filling', 'spinning up', 'in sync', 'spinning down', 'filling']);
    const allowed: Record<string, string[]> = {
      idle: ['filling'],
      filling: ['idle', 'spinning up'],
      'spinning up': ['in sync'],
      'in sync': ['spinning up', 'spinning down'],
      'spinning down': ['filling', 'idle'],
    };
    for (let i = 1; i < words.length; i++) expect(allowed[words[i - 1]!]).toContain(words[i]);
    expect(reachedBelt).toBe(true);
    // The timeline for notes/M4.md.
    console.log(log.map((x) => `${x.t.toFixed(2)} ${x.phase}`).join('\n'));
  });

  it('conserves packets: fed = alive + gone, held ≤ 10, alive ≤ 40', () => {
    const sim = createCentrifugeSim();
    walk(sim, 90, (_, { state: s }) => {
      expect(s.fed).toBe(alive(s) + s.gone);
      expect(held(s)).toBeLessThanOrEqual(10);
      expect(alive(s)).toBeLessThanOrEqual(CF.capacity);
    });
    expect(sim.state.gone).toBeGreaterThan(0);
  });

  it('backs up: throat ≤ 2, the feeder hands over only into an open intake; receiver backpressure', () => {
    const sim = createCentrifugeSim();
    walk(sim, 60, (prev, { state: s }) => {
      expect(s.queue.length).toBeLessThanOrEqual(CF.QMAX);
      expect(s.feed.length).toBeLessThanOrEqual(CF.feed.max);
      const handed = prev.feed.length > 0 && s.feed[0]?.id !== prev.feed[0]!.id;
      if (handed) expect(s.mode).toBe('index');
      for (const f of s.feed) expect(f.y).toBeLessThanOrEqual(CF.feed.y1);
    });

    // Hold the receiver for 6 s from the first "in sync": nothing lost, nothing released.
    const b = createCentrifugeSim();
    while (!b.state.inSync) b.run(H);
    b.canRelease = () => false;
    const h0 = held(b.state);
    const belt0 = b.state.belt.length;
    walk(b, 6, (_, { state: s }) => {
      expect(held(s)).toBe(h0);
      expect(s.releasing.length).toBe(0);
      expect(s.belt.length).toBe(belt0);
      expect(s.fed).toBe(alive(s) + s.gone);
    });
    b.canRelease = null;
    b.run(8);
    expect(held(b.state)).toBe(0);

    const [x, y, z] = CF.spout.hand;
    expect(x).toBeCloseTo(-4.47, 2);
    expect(y).toBeCloseTo(51.14, 2);
    expect(z).toBe(100);
  });

  it('§A: no pocket entry while not indexing', () => {
    const sim = createCentrifugeSim();
    let puts = 0;
    walk(sim, 90, (prev, { state: s }) => {
      if (held(s) > held(prev)) {
        puts++;
        // Landings come before the mode logic in a step, so the step started indexing.
        expect(prev.mode).toBe('index');
      }
    });
    expect(puts).toBeGreaterThan(10);
  });

  it('§A: from spin-up, held only falls, to 0, before the next entry; the tray never turns back', () => {
    const sim = createCentrifugeSim();
    let draining = false;
    let cycles = 0;
    walk(sim, 90, (prev, { state: s }) => {
      expect(s.A).toBeGreaterThanOrEqual(prev.A);
      if (prev.mode === 'index' && s.mode === 'spin') {
        // The last landing may share the step with the switch.
        draining = true;
        return;
      }
      if (draining) {
        expect(held(s)).toBeLessThanOrEqual(held(prev));
        if (held(s) === 0 && s.mode !== 'spin') {
          draining = false;
          cycles++;
        }
      } else if (held(s) > held(prev)) {
        expect(held(prev)).toBeLessThan(CF.HOLD);
      }
      // No entry while draining: an entry means the last drain had reached 0.
      if (held(s) > held(prev)) expect(draining).toBe(false);
    });
    expect(cycles).toBeGreaterThanOrEqual(3);
  });

  it('§A: held packets ride the tray; released packets move forward only', () => {
    const sim = createCentrifugeSim();
    const lastAngle = new Map<number, number>();
    let checkedSpin = 0;
    let checkedRelease = 0;
    walk(sim, 60, (_, sim) => {
      const s = sim.state;
      const poses: { x: number; y: number; z: number; yaw: number }[] = [];
      sim.packets((_, __, x, y, z, yaw) => poses.push({ x, y, z, yaw }));
      let i = s.feed.length + s.queue.length + s.falling.length;
      const seen = new Set<number>();
      for (let k = 0; k < CF.POCKETS; k++) {
        const it = s.pockets[k];
        if (!it) continue;
        const p = poses[i++]!;
        const want = s.A + (k + 0.5) * CF.ALPHA;
        if (s.mode === 'spin') {
          expect(Math.abs(diff(Math.atan2(p.y, p.x), want))).toBeLessThan(1e-4);
          expect(Math.abs(diff(p.yaw, want))).toBeLessThan(1e-4);
          checkedSpin++;
        }
        const prev = lastAngle.get(it.id);
        if (prev !== undefined) expect(diff(want, prev)).toBeGreaterThanOrEqual(-1e-9);
        lastAngle.set(it.id, want);
        seen.add(it.id);
      }
      for (const r of s.releasing) {
        const p = poses[i++]!;
        const a = Math.atan2(p.y, p.x);
        const prev = lastAngle.get(r.id);
        if (prev !== undefined && s.t - r.t0 < CF.TA) {
          // Forward: never back, and never a whole turn either way.
          expect(diff(a, prev)).toBeGreaterThanOrEqual(-1e-6);
          expect(diff(a, prev)).toBeLessThan(0.1);
          checkedRelease++;
        }
        lastAngle.set(r.id, a);
        seen.add(r.id);
      }
      for (const id of lastAngle.keys()) if (!seen.has(id)) lastAngle.delete(id);
    });
    expect(checkedSpin).toBeGreaterThan(1000);
    expect(checkedRelease).toBeGreaterThan(100);
  });

  it('advance clamps a long frame and drops the rest (no catch-up burst)', () => {
    const sim = createCentrifugeSim();
    expect(sim.advance(10)).toBe(4);
    expect(sim.state.t).toBeCloseTo(4 * H, 9);
    expect(sim.advance(1 / 30, 4)).toBe(8);
    expect(sim.state.acc).toBe(0);
  });

  it('belt slats are a pitch apart and step one pitch per period', () => {
    const sim = createCentrifugeSim();
    const xs = (): number[] => {
      const out: number[] = [];
      sim.slats((_, x) => out.push(x));
      return out.sort((a, b) => a - b);
    };
    const a = xs();
    expect(a).toHaveLength(7);
    for (let j = 1; j < a.length; j++) expect(a[j]! - a[j - 1]!).toBeCloseTo(12, 6);
    // A whole number of steps short of one period: the slats move by speed · time.
    const steps = Math.floor(CF.slatPeriod / H);
    sim.run(steps * H);
    const shift = (steps * H * CF.belt.pitch) / CF.slatPeriod;
    const b = xs();
    const key = (x: number) => Math.round(mod(x, 12) * 1e3);
    expect(b.map(key).sort()).toEqual(a.map((x) => key(x - shift)).sort());
  });
});
