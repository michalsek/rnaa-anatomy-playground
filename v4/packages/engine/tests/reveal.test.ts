import { describe, expect, it } from 'vitest';
import { mat4 } from 'wgpu-matrix';
import { FACTORY_LAYOUT } from '../src/assembly/factory.ts';
import {
  CASE_INSIDE,
  DOCKING,
  MACHINE_BOX,
  PACKED,
  REVEAL_IDS,
  type RevealId,
  type RevealPose,
  boxesOverlap,
  clipAt,
  lidPose,
  revealBox,
  revealPlan,
  revealPose,
  rotateXYZ,
  turnedBox,
} from '../src/assembly/reveal.ts';
import type { V3 } from '../src/sim/ports.ts';
import { report } from './rig.ts';

const plan = revealPlan(FACTORY_LAYOUT);
const DT = 1 / 240;
const DEG = Math.PI / 180;
const insidePlan = (b: readonly (readonly number[])[], tol = 0) =>
  b[0]![0]! >= -CASE_INSIDE.x - tol && b[1]![0]! <= CASE_INSIDE.x + tol && b[0]![1]! >= -CASE_INSIDE.y - tol && b[1]![1]! <= CASE_INSIDE.y + tol;

describe('the reveal: the phone opens (closed → lid up → machines expand)', () => {
  it('starts closed: the lid on the band, every machine packed on the floor inside the case, none overlapping', () => {
    const lid: V3 = [0, 0, 0];
    lidPose(plan, 0, lid);
    expect(FACTORY_LAYOUT.phone.displayZ + lid[2]).toBe(FACTORY_LAYOUT.phone.case.cut);
    expect([lid[0], lid[1]]).toEqual([-FACTORY_LAYOUT.phone.shift[0], -FACTORY_LAYOUT.phone.shift[1]]);
    lidPose(plan, plan.lid.t2, lid);
    expect([...lid]).toEqual([0, 0, 0]);
    const boxes = REVEAL_IDS.map((id) => [id, revealBox(plan, id, 0)] as const);
    const clip = clipAt(plan, 0, FACTORY_LAYOUT);
    let cut = 0;
    for (const [id, b] of boxes) {
      expect(insidePlan(b), id).toBe(true);
      expect(b[0][2], id).toBeCloseTo(0, 6);
      // Above the lid's underside the clip cuts it (hidden under the closed lid).
      cut = Math.max(cut, b[1][2] - clip.hi[2]);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(boxesOverlap(boxes[i]![1], boxes[j]![1]), `${boxes[i]![0]} × ${boxes[j]![0]}`).toBe(false);
    report(`reveal closed: the clip cuts up to ${cut.toFixed(1)} above the closed lid's underside\n`);
  });

  it('moves every machine rigidly: T·R only, packed at 0, exactly the assembled layout at the end, small steps', () => {
    const pose: RevealPose = { d: [0, 0, 0], rot: [0, 0, 0] };
    const m = mat4.create();
    let worstStep = 0;
    let worstTurn = 0;
    const c: V3 = [0, 0, 0];
    for (const id of REVEAL_IDS) {
      const pk = PACKED.find((x) => x.id === id)!;
      revealPose(plan, id, 0, pose);
      expect([...pose.rot]).toEqual(pk.rot.map((r) => r * DEG));
      revealPose(plan, id, plan.end, pose);
      expect([...pose.d, ...pose.rot]).toEqual([0, 0, 0, 0, 0, 0]);
      // The box centre at 0 is the packed one (pose ∘ origin).
      revealPose(plan, id, 0, pose);
      const e = plan.entries[id];
      rotateXYZ(pose.rot[0], pose.rot[1], pose.rot[2], e.centre, c);
      expect(e.origin[0] + pose.d[0] + c[0]).toBeCloseTo(pk.at[0], 6);
      expect(e.origin[1] + pose.d[1] + c[1]).toBeCloseTo(pk.at[1], 6);
      let last: number[] | null = null;
      for (let t = 0; t <= plan.end + DT; t += DT) {
        revealPose(plan, id, t, pose);
        mat4.translation(pose.d, m);
        mat4.rotateZ(m, pose.rot[2], m);
        mat4.rotateY(m, pose.rot[1], m);
        mat4.rotateX(m, pose.rot[0], m);
        for (let k = 0; k < 3; k++) expect(Math.hypot(m[4 * k]!, m[4 * k + 1]!, m[4 * k + 2]!)).toBeCloseTo(1, 5);
        expect(mat4.determinant(m)).toBeCloseTo(1, 5);
        // A point's step (the box centre), and the turn.
        rotateXYZ(pose.rot[0], pose.rot[1], pose.rot[2], e.centre, c);
        const now = [pose.d[0] + c[0], pose.d[1] + c[1], pose.d[2] + c[2], ...pose.rot];
        if (last) {
          worstStep = Math.max(worstStep, Math.hypot(now[0]! - last[0]!, now[1]! - last[1]!, now[2]! - last[2]!));
          worstTurn = Math.max(worstTurn, Math.abs(now[3]! - last[3]!), Math.abs(now[4]! - last[4]!), Math.abs(now[5]! - last[5]!));
        }
        last = now;
      }
    }
    report(`reveal: end ${plan.end.toFixed(2)} s, worst step ${worstStep.toFixed(2)} per 1/240 s, worst turn ${worstTurn.toFixed(4)} rad\n`);
    expect(worstStep).toBeLessThan(3);
    expect(worstTurn).toBeLessThan(0.03);
  });

  it('never passes a machine through another, stays inside the case under the lid once it is up', () => {
    const later = new Map<string, RevealId>();
    for (const [x, y] of DOCKING) later.set(`${x}|${y}`, y).set(`${y}|${x}`, y);
    const hits = new Map<string, [number, number]>();
    const out = new Map<string, number>();
    const clip = clipAt(plan, 0, FACTORY_LAYOUT);
    for (let t = 0; t <= plan.end + DT; t += DT) {
      clipAt(plan, t, FACTORY_LAYOUT, clip);
      const bs = REVEAL_IDS.map((id) => revealBox(plan, id, t));
      for (let i = 0; i < bs.length; i++) {
        // Once the lid is up: under it, and inside the case's plan wherever it is below the band's top.
        if (t >= plan.lid.t2 && ((!insidePlan(bs[i]!, 0.5) && bs[i]![0][2] < clip.band) || bs[i]![1][2] > clip.hi[2] + 3)) out.set(REVEAL_IDS[i]!, t);
        for (let j = i + 1; j < bs.length; j++) {
          if (!boxesOverlap(bs[i]!, bs[j]!, 0.25)) continue;
          const l = later.get(`${REVEAL_IDS[i]}|${REVEAL_IDS[j]}`);
          if (l && t >= plan.entries[l].t2) continue;
          const k = `${REVEAL_IDS[i]} × ${REVEAL_IDS[j]}`;
          hits.set(k, [hits.get(k)?.[0] ?? t, t]);
        }
      }
    }
    const list = [...hits].map(([k, [a, b]]) => `${k} ${a.toFixed(2)}..${b.toFixed(2)}`);
    report(`reveal hits:\n${list.join('\n')}\noutside: ${[...out].map(([k, t]) => `${k}@${t.toFixed(2)}`).join(', ')}\n`);
    expect(list).toEqual([]);
    expect([...out.keys()]).toEqual([]);
  });

  it('turnedBox: a quarter turn swaps the extents', () => {
    const b = turnedBox([[0, 0, 0], [2, 4, 8]], [0, 0, 0], [90 * DEG, 0, 0]);
    expect(b[1].map((v) => +v.toFixed(9))).toEqual([1, 4, 2]);
    expect(MACHINE_BOX.elevator[1][2]).toBe(264);
  });
});
