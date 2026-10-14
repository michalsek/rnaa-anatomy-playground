import { describe, expect, it } from 'vitest';
import { FACTORY_LAYOUT, FACTORY_ORDER, createFactoryGraph } from '../src/assembly/factory.ts';
import { CF } from '../src/sim/centrifuge/index.ts';
import { createFactory } from '../src/sim/clock.ts';
import { createConveyor } from '../src/sim/conveyor.ts';
import { CR } from '../src/sim/crusher.ts';
import { createDispenser, dispenserGeometry, dispenserOutputs } from '../src/sim/dispenser.ts';
import { EL } from '../src/sim/elevator.ts';
import { LINE_LAYOUT, createLine } from '../src/sim/graphs.ts';
import { PK } from '../src/sim/packer.ts';
import type { V3 } from '../src/sim/ports.ts';
import { SC, SCANNER_OUT } from '../src/sim/scanner.ts';
import { report, snapshot } from './rig.ts';

const H = 1 / 120;
const w = (o: readonly number[], p: readonly number[]): V3 => [o[0]! + p[0]!, o[1]! + p[1]!, o[2]! + p[2]!];

describe('factory graph (createFactoryGraph)', () => {
  it('steps in FACTORY_ORDER; the line is the same graph with the bead source in place of the dispenser', () => {
    const g = createFactoryGraph();
    expect(g.factory.machines.map((m) => m.id)).toEqual([...FACTORY_ORDER]);
    const line = createLine(LINE_LAYOUT);
    expect(line.factory.machines.map((m) => m.id)).toEqual(FACTORY_ORDER.map((id) => (id === 'dispenser' ? 'beads' : id)));
    // A machine added after its receiver is refused.
    const f = createFactory();
    const geometry = dispenserGeometry(FACTORY_LAYOUT.phone);
    const a = f.add(createConveyor(f.clock, { id: 'beltA', origin: [-4, -190, 0], axis: 'x', length: 61, top: 232 }));
    const d = f.add(createDispenser(f.clock, f.ledger, { id: 'dispenser', origin: [0, 0, 0], at: [20, -190], geometry }));
    expect(() => f.link(d, 'out', a)).toThrow(/must step before/);
  });

  it('conserves items on every step for 300 s; the dispenser makes ≈ 0.8 beads/s; items are heard and crushed', () => {
    const g = createFactoryGraph();
    const f = g.factory;
    let maxQueue = 0;
    for (let i = 0; i < 300 * 120; i++) {
      f.run(H);
      expect(f.ledger.created).toBe(f.alive() + f.ledger.consumed);
      maxQueue = Math.max(maxQueue, g.dispenser.queued);
    }
    const rate = g.dispenser.made / 300;
    expect(rate).toBeGreaterThan(0.7);
    expect(rate).toBeLessThan(0.9);
    expect(g.speaker.stats.heard).toBeGreaterThan(30);
    expect(g.crusher.stats().count).toBeGreaterThan(30);
    expect(maxQueue).toBeLessThanOrEqual(8);
    // The dispenser's timing is the bead source's (the same hash streams): the line makes as many.
    const line = createLine(LINE_LAYOUT);
    line.factory.run(300);
    expect(Math.abs(g.dispenser.made - line.beadSource!.made)).toBeLessThanOrEqual(2);
    report(`factory 300 s: ${g.dispenser.made} beads (${rate.toFixed(2)}/s), ${g.packer.stats.packets} packets, ${g.crusher.stats().count} crushed, ${g.speaker.stats.heard} heard, queue ≤ ${maxQueue}\n`);
  });

  it('hands beads on at the tip, falling, and moves queued beads without overlap or pops', () => {
    const g = createFactoryGraph();
    const d = g.dispenser;
    const geo = d.geometry;
    const o = dispenserOutputs();
    let sent = 0;
    const send = d.outs.out.send.bind(d.outs.out);
    (d.outs.out as { send: typeof send }).send = (item, from, v) => {
      sent++;
      expect(from[2] + PK.bead * 2).toBeLessThan(geo.tipZ + 1e-9);
      expect(from[2] + PK.bead * 2).toBeGreaterThan(geo.tipZ - 3);
      expect(v[2]).toBeLessThan(-50);
      send(item, from, v);
    };
    const last = new Map<number, number>();
    let worst = 0;
    let closest = Infinity;
    let rotor = 0;
    for (let i = 0; i < 60 * 120; i++) {
      g.factory.run(H);
      const zs: number[] = [];
      d.beads((_, x, y, z, key) => {
        expect([x, y]).toEqual([...d.at]);
        const p = last.get(key);
        if (p !== undefined) worst = Math.max(worst, Math.abs(z - p));
        last.set(key, z);
        zs.push(z);
      });
      zs.sort((a, b) => a - b);
      for (let k = 1; k < zs.length; k++) closest = Math.min(closest, zs[k]! - zs[k - 1]!);
      d.outputs(o);
      expect(o.rotor).toBeGreaterThanOrEqual(rotor - 1e-12);
      rotor = o.rotor;
    }
    expect(sent).toBeGreaterThan(40);
    // A bead is 4.8 across: the queue's pitch keeps them apart (spout beads are further apart still).
    expect(closest).toBeGreaterThan(2 * PK.bead - 1e-6);
    // Fastest: a burst's bead falling down the neck onto the queue, ≈ 165 u/s (≈ 1.4 per step).
    expect(worst).toBeLessThan(1.5);
  });

  it('is deterministic (every machine status, the beads and the loop)', () => {
    const run = () => {
      const g = createFactoryGraph();
      g.factory.run(63.7);
      const beads: number[] = [];
      g.dispenser.beads((_, x, y, z, key) => beads.push(x, y, z, key));
      return snapshot(g.factory, { beads, out: g.dispenser.outputs(dispenserOutputs()), audio: g.audio.items, beltA: g.beltA.items });
    };
    expect(run()).toEqual(run());
  });
});

/**
 * v2 A's port pairs (`assembly/qa/ports.json`, `build.mjs --ports`, L443–455): both ends of
 * every hand-off, world. v4's must be within 0.5 or be listed in DEVIATIONS with a reason.
 */
const V2_PORTS: Record<string, [V3, V3]> = {
  'dispenser-A': [[20, -190, 437], [20, -190, 232]],
  'A-packer': [[57, -190, 232], [72, -190, 232]],
  'packer-B': [[100, -164, 196], [100, -156, 192]],
  'B-centrifuge': [[100, 19.8, 192], [100, 36.8, 186]],
  'centrifuge-audio': [[95.5, 119.9, 100], [95.5, 119.9, 92]],
  'audio-C': [[-90, 119.9, 47.8], [-90, 119.9, 40]],
  'C-crusher': [[-90, 207.9, 40], [-90, 237.9, 37]],
  'scanner-D': [[-47, 86.9, 24], [-47, 70.9, 24]],
  'D-elevator': [[-47, -175, 24], [-47, -187, 24]],
  'elevator-speaker': [[-47, -300, 234], [-45, -300, 205]],
  'scanner-read': [[30, 112.9, 92], [30, 119.9, 62]],
};

/** Ports that differ from v2 on purpose (end 0 = the sender's, 1 = the receiver's). */
const DEVIATIONS: Record<string, string> = {
  'A-packer.1': "M9: beads are handed on at belt A's head over the transfer plate (v2 flung them 15 across the gap to the gutter's lip)",
  'packer-B.0': 'M9: the packet leaves at the end of the stroke, at rest, 8 over belt B (v2: mid-tip at the nose, 4 over it)',
  'packer-B.1': "M9: it lands on belt B's in point, 2 along it, at the belt's surface",
  'C-crusher.1': "M6: belt C ends at the crusher's own feed point (CR.drop); v2 A put the crusher 30 past belt C's end, 4 more than its drop",
  'scanner-D.0': "M7: the packet is handed on at the lip's end, still moving (v2's port is the lip's start)",
  'scanner-D.1': "M7: belt D's in point is derived from the push's speed and the fall (where the packet lands), not v2's tail − 4",
  'D-elevator.1': "M8: the elevator takes packets at its chute's in point (EL.in) at belt D's height",
  'scanner-read.1': "M7: the loop's read point is the scanner's (snapped to the head's window), at the bottom run's underside",
  'B-centrifuge.1': "M5: the throat's mouth (CF.in), where the packet falls in",
};

describe('ports line up with v2 A (assembly/qa/ports.json)', () => {
  it('every hand-off is within 0.5 of v2, or a recorded deviation', () => {
    const g = createFactoryGraph();
    const p = (m: { origin: V3 }, local: readonly number[]) => w(m.origin, local);
    const A = g.beltA.geometry.ports;
    const B = g.beltB.geometry.ports;
    const C = g.beltC.geometry.ports;
    const D = g.beltD.geometry.ports;
    const L = g.audio.geometry.ports;
    const dz = g.dispenser.geometry.tipZ;
    const v4: Record<string, [V3, V3]> = {
      'dispenser-A': [[g.dispenser.at[0], g.dispenser.at[1], dz], p(g.beltA, A.in)],
      'A-packer': [p(g.beltA, A.out), p(g.packer, PK.ports.in)],
      'packer-B': [p(g.packer, PK.ports.out), p(g.beltB, B.in)],
      'B-centrifuge': [p(g.beltB, B.out), p(g.centrifuge, CF.in)],
      'centrifuge-audio': [p(g.centrifuge, CF.spout.hand), p(g.audio, L.in)],
      'audio-C': [p(g.audio, L.drop), p(g.beltC, C.in)],
      'C-crusher': [p(g.beltC, C.out), p(g.crusher, CR.drop)],
      'scanner-D': [p(g.scanner, SCANNER_OUT.at), p(g.beltD, D.in)],
      'D-elevator': [p(g.beltD, D.out), p(g.elevator, EL.in)],
      'elevator-speaker': [p(g.elevator, g.elevator.geometry.ports.out), p(g.speaker, g.speaker.geometry.ports.in)],
      'scanner-read': [p(g.scanner, SC.read), p(g.audio, L.read)],
    };
    const lines: string[] = [];
    const bad: string[] = [];
    for (const [name, ends] of Object.entries(V2_PORTS)) {
      for (const k of [0, 1] as const) {
        const d = Math.hypot(...ends[k].map((v, i) => v - v4[name]![k][i]!));
        const key = `${name}.${k}`;
        lines.push(`${key}: v2 [${ends[k]}] v4 [${v4[name]![k].map((x) => +x.toFixed(2))}] Δ ${d.toFixed(2)}${DEVIATIONS[key] ? ' (deviation)' : ''}`);
        if (d > 0.5 && !DEVIATIONS[key]) bad.push(lines[lines.length - 1]!);
      }
    }
    report(`ports:\n${lines.join('\n')}\n`);
    expect(bad).toEqual([]);
    // The dispenser's tip is v2's 437 (the plan's 493 was wrong).
    expect(dz).toBe(437);
  });
});
