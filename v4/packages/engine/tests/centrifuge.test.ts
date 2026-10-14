import { describe, expect, it } from 'vitest';
import type { Factory } from '../src/sim/clock.ts';
import { CF, type Centrifuge } from '../src/sim/centrifuge/index.ts';
import type { TrayState } from '../src/sim/centrifuge/packets.ts';
import { snapshot, topRig } from './rig.ts';

const H = 1 / 120;
const TAU = Math.PI * 2;
const mod = (a: number, n: number) => ((a % n) + n) % n;
/** Signed angle difference in (−π, π]. */
const diff = (a: number, b: number) => mod(a - b + Math.PI, TAU) - Math.PI;
const held = (s: Readonly<TrayState>) => s.pockets.filter(Boolean).length;

interface Prev {
  mode: string;
  A: number;
  held: number;
}
const prevOf = (c: Centrifuge): Prev => ({ mode: c.controller.mode, A: c.controller.A, held: held(c.tray.state) });

/** Step a factory one fixed step at a time, calling `check(prev)` after each. */
function walk(f: Factory, c: Centrifuge, seconds: number, check: (prev: Prev) => void) {
  for (let i = 0; i < Math.round(seconds / H); i++) {
    const prev = prevOf(c);
    f.run(H);
    check(prev);
  }
}

const state = (r: ReturnType<typeof topRig>) =>
  snapshot(r.f, {
    beltB: r.beltB.items,
    travelB: r.beltB.travel,
    c: r.centrifuge.state,
    audio: r.audio.items,
    sink: r.sink.falling,
  });

describe('centrifuge between real belts (checkpoint A rig)', () => {
  it('is deterministic: same dt sequence, same state; seeds rotate kinds only', () => {
    const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const a = topRig();
    const b = topRig();
    const ra = lcg(7);
    for (let t = 0; t < 45; ) {
      const dt = (1 / 30) * ra();
      a.f.advance(dt);
      b.f.advance(dt);
      t += dt;
    }
    expect(state(b)).toEqual(state(a));
    const seek = (seed = 0) => {
      const r = topRig({ seed });
      r.f.run(30);
      return r;
    };
    expect(state(seek())).toEqual(state(seek()));
    const s0 = seek(0);
    const s1 = seek(1);
    expect(s1.centrifuge.state.log).toEqual(s0.centrifuge.state.log);
    const kinds = (r: ReturnType<typeof topRig>) =>
      [...r.beltB.items.map((x) => x.item), ...r.centrifuge.tray.state.queue.map((x) => x.item)].map((x) => x.kind).join(',');
    expect(kinds(s1)).not.toEqual(kinds(s0));
  });

  it('runs the cycle: idle → filling → spinning up → in sync → spinning down → filling', () => {
    const r = topRig();
    walk(r.f, r.centrifuge, 60, () => {});
    const log = r.centrifuge.state.log;
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
    // Releases reach the receiver and leave it.
    expect(r.sink.taken).toBeGreaterThan(0);
    // The timeline for notes/M5.md.
    process.stdout.write(`${log.map((x) => `${x.t.toFixed(2)} ${x.phase}`).join("\n")}\n`);
  });

  it('conserves packets: created = alive + consumed, held ≤ 10, tray ≤ its pool', () => {
    const r = topRig();
    walk(r.f, r.centrifuge, 90, () => {
      expect(r.f.ledger.created).toBe(r.f.alive() + r.f.ledger.consumed);
      expect(held(r.centrifuge.tray.state)).toBeLessThanOrEqual(10);
      expect(r.centrifuge.alive()).toBeLessThanOrEqual(CF.capacity);
    });
    expect(r.f.ledger.consumed).toBeGreaterThan(0);
  });

  it('backs up: throat ≤ 2, belt B hands on only into an open intake and holds; receiver backpressure', () => {
    const r = topRig();
    const c = r.centrifuge;
    let handed = 0;
    const accept = c.accept.bind(c);
    c.accept = (item, from, v) => {
      // The belt asked first: the intake is open (accept throws otherwise).
      expect(c.canAccept()).toBe(true);
      expect(c.controller.mode).toBe('index');
      handed++;
      accept(item, from, v);
    };
    // Re-link so belt B sends to the wrapped accept.
    r.beltB.outs.out.connect(c);
    let heldSeen = 0;
    const { outS, dir } = r.beltB.geometry;
    walk(r.f, c, 60, () => {
      expect(c.tray.state.queue.length).toBeLessThanOrEqual(CF.QMAX);
      if (r.beltB.held()) {
        heldSeen++;
        for (const it of r.beltB.items) if (it.phase === 'ride') expect((it.s - outS) * dir).toBeLessThan(0);
      }
    });
    expect(handed).toBeGreaterThan(10);
    expect(heldSeen).toBeGreaterThan(120);
    // The source holds while belt B is backed up to its in point: belt B stays bounded.
    expect(r.beltB.items.length).toBeLessThanOrEqual(7);

    // Hold the receiver for 6 s from the first "in sync": nothing lost, nothing released.
    const b = topRig();
    for (let t = 0; !b.centrifuge.controller.inSync && t < 30; t += H) b.f.run(H);
    expect(b.centrifuge.controller.inSync).toBe(true);
    b.centrifuge.releaseOverride = false;
    const h0 = held(b.centrifuge.tray.state);
    const onBelt = b.audio.items.length + b.sink.taken;
    walk(b.f, b.centrifuge, 6, () => {
      expect(held(b.centrifuge.tray.state)).toBe(h0);
      expect(b.centrifuge.tray.state.releasing.length).toBe(0);
      expect(b.audio.items.length + b.sink.taken).toBe(onBelt);
      expect(b.f.ledger.created).toBe(b.f.alive() + b.f.ledger.consumed);
    });
    b.centrifuge.releaseOverride = null;
    b.f.run(8);
    expect(held(b.centrifuge.tray.state)).toBe(0);

    const [x, y, z] = CF.spout.hand;
    expect(x).toBeCloseTo(-4.47, 2);
    expect(y).toBeCloseTo(51.14, 2);
    expect(z).toBe(100);
  });

  it('§A: no pocket entry while not indexing', () => {
    const r = topRig();
    let puts = 0;
    walk(r.f, r.centrifuge, 90, (prev) => {
      if (held(r.centrifuge.tray.state) > prev.held) {
        puts++;
        // Landings come before the controller in a step, so the step started indexing.
        expect(prev.mode).toBe('index');
      }
    });
    expect(puts).toBeGreaterThan(10);
  });

  it('§A: from spin-up, held only falls, to 0, before the next entry; the tray never turns back', () => {
    const r = topRig();
    const c = r.centrifuge;
    let draining = false;
    let cycles = 0;
    walk(r.f, c, 90, (prev) => {
      const now = held(c.tray.state);
      expect(c.controller.A).toBeGreaterThanOrEqual(prev.A);
      if (prev.mode === 'index' && c.controller.mode === 'spin') {
        // The last landing may share the step with the switch.
        draining = true;
        return;
      }
      if (draining) {
        expect(now).toBeLessThanOrEqual(prev.held);
        if (now === 0 && c.controller.mode !== 'spin') {
          draining = false;
          cycles++;
        }
      } else if (now > prev.held) {
        expect(prev.held).toBeLessThan(CF.HOLD);
      }
      // No entry while draining: an entry means the last drain had reached 0.
      if (now > prev.held) expect(draining).toBe(false);
    });
    expect(cycles).toBeGreaterThanOrEqual(3);
  });

  it('§A: held packets ride the tray; released packets move forward only', () => {
    const r = topRig();
    const c = r.centrifuge;
    const lastAngle = new Map<number, number>();
    let checkedSpin = 0;
    let checkedRelease = 0;
    walk(r.f, c, 60, () => {
      const s = c.tray.state;
      const A = c.controller.A;
      const poses: { x: number; y: number; z: number; yaw: number }[] = [];
      c.poses((_, __, x, y, z, yaw) => poses.push({ x, y, z, yaw }));
      let i = s.queue.length + s.falling.length;
      const seen = new Set<number>();
      for (let k = 0; k < CF.POCKETS; k++) {
        const it = s.pockets[k];
        if (!it) continue;
        const p = poses[i++]!;
        const want = A + (k + 0.5) * CF.ALPHA;
        if (c.controller.mode === 'spin') {
          expect(Math.abs(diff(Math.atan2(p.y, p.x), want))).toBeLessThan(1e-4);
          expect(Math.abs(diff(p.yaw, want))).toBeLessThan(1e-4);
          checkedSpin++;
        }
        const prev = lastAngle.get(it.id);
        if (prev !== undefined) expect(diff(want, prev)).toBeGreaterThanOrEqual(-1e-9);
        lastAngle.set(it.id, want);
        seen.add(it.id);
      }
      for (const rel of s.releasing) {
        const p = poses[i++]!;
        const a = Math.atan2(p.y, p.x);
        const prev = lastAngle.get(rel.item.id);
        if (prev !== undefined && r.f.clock.t - rel.t0 < CF.TA) {
          // Forward: never back, and never a whole turn either way.
          expect(diff(a, prev)).toBeGreaterThanOrEqual(-1e-6);
          expect(diff(a, prev)).toBeLessThan(0.1);
          checkedRelease++;
        }
        lastAngle.set(rel.item.id, a);
        seen.add(rel.item.id);
      }
      for (const id of lastAngle.keys()) if (!seen.has(id)) lastAngle.delete(id);
    });
    expect(checkedSpin).toBeGreaterThan(1000);
    expect(checkedRelease).toBeGreaterThan(100);
  });

  it('caps the phase log; queued packets forget their pocket when the spin starts', () => {
    const r = topRig();
    const c = r.centrifuge;
    walk(r.f, c, 40, (prev) => {
      if (prev.mode === 'index' && c.controller.mode === 'spin') {
        for (const q of c.tray.state.queue) expect(q.want).toBe(-1);
      }
    });
    r.f.run(1200);
    expect(c.state.log.length).toBeLessThanOrEqual(200);
    expect(c.state.log.at(-1)!.t).toBeGreaterThan(1200);
  });

  it('advance clamps a long frame and drops the rest (no catch-up burst)', () => {
    const { f } = topRig();
    expect(f.advance(10)).toBe(4);
    expect(f.clock.t).toBeCloseTo(4 * H, 9);
    expect(f.advance(1 / 30, 4)).toBe(8);
    expect(f.clock.acc).toBe(0);
  });
});
