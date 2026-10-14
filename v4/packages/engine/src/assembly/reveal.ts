/**
 * The factory's reveal (the user's redesign, notes/M10-plan.md §3): the phone opens.
 *
 * 1. **Closed:** the display sits on the case's band as its lid; the machines lie packed low in
 *    the tray under it (tall ones laid down), hidden.
 * 2. **The lid lifts:** straight up first (so it keeps covering what the clip cuts under it), then
 *    on to its floating pose (z 560, shift [−80, −24]).
 * 3. **The machines expand,** one after another: each rises off the packed layer, turns upright
 *    while it flies over to its place at a height clear of whatever it passes, and comes down
 *    onto its spot (the later member of a docking pair lands after the earlier one). The
 *    dispenser goes last, up under the display.
 * 4. **Conceal** is the same plan played backwards.
 *
 * Rigid only: every machine's pose is T·R (no scale, no morph). The clip volume (the case's
 * inside up to the lid's underside, `clipAt`) masks machine fragments; it does not deform.
 * Plain TS, pure; a machine's pose is `revealPose` (a translation and Euler angles for its root
 * group: motion = T(d)·Rz·Ry·Rx), exactly identity once landed.
 */
import { dispenserGeometry } from '../sim/dispenser.ts';
import type { V3 } from '../sim/ports.ts';
import { type FactoryLayout, PHONE, type PhoneLayout } from './factory.ts';
import { type Box3, machineOrigins } from './origins.ts';

/** The moving parts: every machine and the dispenser (the case stays; the display is the lid). */
export const REVEAL_IDS = ['beltA', 'packer', 'beltB', 'centrifuge', 'audio', 'beltC', 'crusher', 'scanner', 'beltD', 'elevator', 'speaker', 'dispenser'] as const;
export type RevealId = (typeof REVEAL_IDS)[number];

/** The dispenser's box (world = its frame, the phone's): plate, motor on +x, sight glass on +y, tip. */
function dispenserBox(p: PhoneLayout): Box3 {
  const g = dispenserGeometry(p);
  const [dx, dy] = p.dispenser;
  return [[dx - 12, dy - 12, g.tipZ], [dx + 18.5, dy + 12, p.displayZ]];
}

/**
 * Local rest AABBs (with `FACTORY_STANDS`), from `store.groupBounds` minus the origins, rounded
 * outward to 0.5 (the item pools ride inside); the dispenser's in the phone's frame.
 */
export const MACHINE_BOX: Record<RevealId, Box3> = {
  beltA: [[-7, -16, 219], [68, 21.5, 236.5]],
  packer: [[-41.5, -33, 0], [55.5, 26, 233]],
  beltB: [[-15, -7, 179], [20.5, 185, 196.5]],
  centrifuge: [[-40, -37, 0], [63.5, 47, 186]],
  audio: [[-17.5, -17, 59], [215, 27.5, 94.5]],
  beltC: [[-14, -7, 0], [19.5, 117, 44.5]],
  crusher: [[-38, -36, 0], [40, 60, 38]],
  scanner: [[-86, -26, 0], [25, 31.5, 106]],
  beltD: [[-15, -7, 0], [20.5, 262, 28.5]],
  elevator: [[-14, -82, 0], [22, 40, 264]],
  speaker: [[-46, -46, 0], [64, 46, 226.5]],
  dispenser: dispenserBox(PHONE),
};

/**
 * A packed pose: the machine turned by Euler angles (degrees: about x, then y, then z: tall
 * machines laid down) and resting on the tray's floor with its turned box centred at `at`.
 */
export interface PackedPose {
  id: RevealId;
  at: readonly [number, number];
  rot: readonly [number, number, number];
}

/**
 * The packed layout (hand-authored): rows across the tray, back (−y) to front, every machine on
 * the floor, the tall ones laid down (most then stand ≤ 36; the speaker, packer, centrifuge and
 * scanner lie 92, 59, 84 and 58 high and the clip cuts them under the closed lid). Rows: the
 * speaker and the crusher; the elevator; the packer and belt A; the scanner; the loop; belt D;
 * belts B and C; the centrifuge and the dispenser.
 */
export const PACKED: readonly PackedPose[] = [
  { id: 'speaker', at: [54.2, -8], rot: [90, 0, 90] },
  { id: 'crusher', at: [-79, 264], rot: [0, 0, 90] },
  { id: 'elevator', at: [22, -227], rot: [0, 90, 90] },
  { id: 'packer', at: [-114.5, -98.5], rot: [90, 0, 0] },
  { id: 'beltA', at: [111.8, -177.5], rot: [0, 0, 90] },
  { id: 'scanner', at: [32.5, 314], rot: [90, 0, 0] },
  { id: 'audio', at: [53.2, 123.2], rot: [0, 0, 0] },
  { id: 'beltD', at: [-16.5, 67.2], rot: [0, 90, 90] },
  { id: 'beltB', at: [73, -78.2], rot: [0, 90, 90] },
  { id: 'beltC', at: [-92.8, 155], rot: [0, 90, 0] },
  { id: 'centrifuge', at: [70, 204.8], rot: [90, 0, 90] },
  { id: 'dispenser', at: [109, -289.5], rot: [0, 90, 90] },
];

/**
 * The start order: back to front where the docking pairs allow (the speaker before the
 * elevator, belts A and B before the packer, the elevator before belt D, belt C before the loop
 * and the crusher, the loop and belt D before the scanner and the centrifuge), every machine off
 * the floor before another lands on its packed spot, the dispenser last.
 */
export const REVEAL_ORDER: readonly RevealId[] = ['speaker', 'elevator', 'beltD', 'beltC', 'audio', 'scanner', 'centrifuge', 'crusher', 'beltA', 'beltB', 'packer', 'dispenser'];

/** Docking pairs [earlier, later]: the later one comes down over the earlier one. */
export const DOCKING: readonly (readonly [RevealId, RevealId])[] = [
  ['beltA', 'packer'],
  ['beltB', 'packer'],
  ['audio', 'centrifuge'],
  ['audio', 'scanner'],
  ['beltD', 'scanner'],
  ['beltC', 'crusher'],
  ['beltC', 'audio'],
  ['speaker', 'elevator'],
  ['elevator', 'beltD'],
];

/** The case's inside (world): the clip volume's plan (rounded corners) and its floor. */
export const CASE_INSIDE = { x: PHONE.case.w / 2 - PHONE.case.t, y: PHONE.case.d / 2 - PHONE.case.t, r: PHONE.case.r - PHONE.case.t, floor: -0.5 } as const;

/** The scheduler's patience: at most this many 0.1 s delays per machine. */
const MAX_TRIES = 100;

/** Timing (s) and speeds (units/s). */
export const REVEAL = {
  /** The lid: straight up by `rise` (clear of the laid-down machines' cut tops), then to its pose. */
  lid: { rise: 90, up: 0.8, open: 1.4 },
  /** Gap between the machines' starts, the flight, the rise and descent speed and their floor. */
  stagger: 0.35,
  move: 1.3,
  speed: 360,
  minLift: 0.4,
  /** Clearance over whatever a flight passes. */
  clear: 8,
  /** The packed layer's top (the laid-down machines, cut or not). */
  layer: 92,
} as const;

export interface RevealEntry {
  id: RevealId;
  /** The machine's frame origin (world), its local box centre. */
  origin: V3;
  centre: V3;
  /** Packed box centre (world) and turn (radians, Euler x, y, z). */
  from: V3;
  rot: V3;
  /** Final box centre (world), the flight's centre height. */
  to: V3;
  air: number;
  /** Phase times: rise, flight, descent, landed. */
  t0: number;
  t1: number;
  t2: number;
  t3: number;
}

export interface RevealPlan {
  entries: Record<RevealId, RevealEntry>;
  order: readonly RevealId[];
  /** The lid's phases (absolute): rising, opening, open; its closed offset from the floating pose. */
  lid: { t0: number; t1: number; t2: number; closed: V3 };
  end: number;
}

const DEG = Math.PI / 180;
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** Quintic ease (no velocity or acceleration jump at the ends). */
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10));

/** R = Rz(c)·Ry(b)·Rx(a) applied to v (writes out). */
export function rotateXYZ(a: number, b: number, c: number, v: readonly number[], out: V3): V3 {
  const x = v[0]!;
  const y = v[1]!;
  const z = v[2]!;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const y1 = y * ca - z * sa;
  const z1 = y * sa + z * ca;
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const x2 = x * cb + z1 * sb;
  const z2 = -x * sb + z1 * cb;
  const cc = Math.cos(c);
  const sc = Math.sin(c);
  out[0] = x2 * cc - y1 * sc;
  out[1] = x2 * sc + y1 * cc;
  out[2] = z2;
  return out;
}

const UNIT: readonly V3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const tv: V3 = [0, 0, 0];
/** The world AABB of a local box turned by R(rot) about its centre, centred at p (writes out). */
export function turnedBox(b: Box3, p: readonly number[], rot: readonly number[], out?: [V3, V3]): [V3, V3] {
  const o = out ?? [[0, 0, 0], [0, 0, 0]];
  const h0 = (b[1][0] - b[0][0]) / 2;
  const h1 = (b[1][1] - b[0][1]) / 2;
  const h2 = (b[1][2] - b[0][2]) / 2;
  let e0 = 0;
  let e1 = 0;
  let e2 = 0;
  for (let j = 0; j < 3; j++) {
    rotateXYZ(rot[0]!, rot[1]!, rot[2]!, UNIT[j]!, tv);
    const h = j === 0 ? h0 : j === 1 ? h1 : h2;
    e0 += Math.abs(tv[0]) * h;
    e1 += Math.abs(tv[1]) * h;
    e2 += Math.abs(tv[2]) * h;
  }
  o[0][0] = p[0]! - e0;
  o[0][1] = p[1]! - e1;
  o[0][2] = p[2]! - e2;
  o[1][0] = p[0]! + e0;
  o[1][1] = p[1]! + e1;
  o[1][2] = p[2]! + e2;
  return o;
}

/** Strict AABB overlap, both shrunk by `eps`. */
export function boxesOverlap(a: readonly (readonly number[])[], b: readonly (readonly number[])[], eps = 1e-6) {
  for (let k = 0; k < 3; k++) if (a[0]![k]! + eps >= b[1]![k]! || b[0]![k]! + eps >= a[1]![k]!) return false;
  return true;
}

const centreOf = (b: Box3): V3 => [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2, (b[0][2] + b[1][2]) / 2];
const halfDiag = (b: Box3) => Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1], b[1][2] - b[0][2]) / 2;

/** Where a machine's box centre is at t, and its turn (writes p, r). */
function placeAt(e: RevealEntry, t: number, p: V3, r: V3) {
  if (t >= e.t3) {
    p[0] = e.to[0];
    p[1] = e.to[1];
    p[2] = e.to[2];
    r[0] = r[1] = r[2] = 0;
    return;
  }
  if (t <= e.t0) {
    p[0] = e.from[0];
    p[1] = e.from[1];
    p[2] = e.from[2];
    r[0] = e.rot[0];
    r[1] = e.rot[1];
    r[2] = e.rot[2];
    return;
  }
  if (t < e.t1) {
    const u = smooth((t - e.t0) / (e.t1 - e.t0));
    p[0] = e.from[0];
    p[1] = e.from[1];
    p[2] = e.from[2] + (e.air - e.from[2]) * u;
    r[0] = e.rot[0];
    r[1] = e.rot[1];
    r[2] = e.rot[2];
    return;
  }
  if (t < e.t2) {
    const u = ease((t - e.t1) / (e.t2 - e.t1));
    p[0] = e.from[0] + (e.to[0] - e.from[0]) * u;
    p[1] = e.from[1] + (e.to[1] - e.from[1]) * u;
    p[2] = e.air;
    r[0] = e.rot[0] * (1 - u);
    r[1] = e.rot[1] * (1 - u);
    r[2] = e.rot[2] * (1 - u);
    return;
  }
  const u = smooth((t - e.t2) / (e.t3 - e.t2));
  p[0] = e.to[0];
  p[1] = e.to[1];
  p[2] = e.air + (e.to[2] - e.air) * u;
  r[0] = r[1] = r[2] = 0;
}

/** A machine's pose offset: motion = T(d)·Rz(rot[2])·Ry(rot[1])·Rx(rot[0]) on its root (radians). */
export interface RevealPose {
  d: V3;
  rot: V3;
}

const sp: V3 = [0, 0, 0];
const sr: V3 = [0, 0, 0];
const sv: V3 = [0, 0, 0];
/** The pose offset at t (writes out): exactly identity once landed. */
export function revealPose(plan: RevealPlan, id: RevealId, t: number, out: RevealPose): RevealPose {
  const e = plan.entries[id];
  if (t >= e.t3) {
    out.d[0] = out.d[1] = out.d[2] = 0;
    out.rot[0] = out.rot[1] = out.rot[2] = 0;
    return out;
  }
  placeAt(e, t, sp, sr);
  // world = T(o)·M and world = T(p)·R·T(−c) ⇒ M = T(p − o − R·c)·R.
  rotateXYZ(sr[0], sr[1], sr[2], e.centre, sv);
  out.d[0] = sp[0] - e.origin[0] - sv[0];
  out.d[1] = sp[1] - e.origin[1] - sv[1];
  out.d[2] = sp[2] - e.origin[2] - sv[2];
  out.rot[0] = sr[0];
  out.rot[1] = sr[1];
  out.rot[2] = sr[2];
  return out;
}

/** The world AABB of a machine at t. */
export function revealBox(plan: RevealPlan, id: RevealId, t: number, boxes: Record<RevealId, Box3> = MACHINE_BOX, out?: [V3, V3]): [V3, V3] {
  const p: V3 = [0, 0, 0];
  const r: V3 = [0, 0, 0];
  placeAt(plan.entries[id], t, p, r);
  return turnedBox(boxes[id], p, r, out);
}

/** Whether a machine is at rest in its place at t (its halo shows). */
export const revealLanded = (plan: RevealPlan, id: RevealId, t: number) => t >= plan.entries[id].t3;

/** The lid's offset from its floating pose at t (writes out): closed at 0, identity from `lid.t2`. */
export function lidPose(plan: RevealPlan, t: number, out: V3): V3 {
  const { t0, t1, t2, closed } = plan.lid;
  if (t >= t2) {
    out[0] = out[1] = out[2] = 0;
    return out;
  }
  if (t < t1) {
    const u = smooth((t - t0) / (t1 - t0));
    out[0] = closed[0];
    out[1] = closed[1];
    out[2] = closed[2] + REVEAL.lid.rise * u;
    return out;
  }
  const u = ease((t - t1) / (t2 - t1));
  out[0] = closed[0] * (1 - u);
  out[1] = closed[1] * (1 - u);
  out[2] = (closed[2] + REVEAL.lid.rise) * (1 - u);
  return out;
}

export interface ClipVolume {
  lo: V3;
  hi: V3;
  r: number;
  /** The plan applies below this height (the band's top: above it there is no wall to poke through). */
  band: number;
}

const lidScratch: V3 = [0, 0, 0];
/**
 * The clip volume at t (world): from the case's floor up to the lid's underside, inside the
 * case's plan below its band's top.
 */
export function clipAt(plan: RevealPlan, t: number, layout: FactoryLayout, out: ClipVolume = { lo: [0, 0, 0], hi: [0, 0, 0], r: 0, band: 0 }): ClipVolume {
  lidPose(plan, t, lidScratch);
  out.lo[0] = -CASE_INSIDE.x;
  out.lo[1] = -CASE_INSIDE.y;
  out.lo[2] = CASE_INSIDE.floor;
  out.hi[0] = CASE_INSIDE.x;
  out.hi[1] = CASE_INSIDE.y;
  out.hi[2] = layout.phone.displayZ + lidScratch[2];
  out.r = CASE_INSIDE.r;
  out.band = layout.phone.case.cut;
  return out;
}

/**
 * Plan the reveal: the lid's two phases, then each machine (in `order`, at least `REVEAL.stagger`
 * after the previous one, later if its motion would clash with one already planned or with one
 * still packed) rises off the packed layer, flies turning upright at a height clear of every
 * machine planned before it under its sweep, and comes down.
 */
export function revealPlan(layout: FactoryLayout, packed: readonly PackedPose[] = PACKED, boxes: Record<RevealId, Box3> = MACHINE_BOX, order: readonly RevealId[] = REVEAL_ORDER): RevealPlan {
  const origins: Record<RevealId, V3> = { ...machineOrigins(layout), dispenser: [0, 0, 0] };
  const p = layout.phone;
  const lidT1 = REVEAL.lid.up;
  const lidT2 = lidT1 + REVEAL.lid.open;
  const lid = { t0: 0, t1: lidT1, t2: lidT2, closed: [-p.shift[0], -p.shift[1], p.case.cut - p.displayZ] as V3 };
  const byId = new Map(packed.map((x) => [x.id, x]));
  const entries = {} as Record<RevealId, RevealEntry>;
  const landed: [V3, V3][] = [];
  const box: [V3, V3] = [[0, 0, 0], [0, 0, 0]];
  const later = new Map<string, RevealId>();
  for (const [x, y] of DOCKING) later.set(`${x}|${y}`, y).set(`${y}|${x}`, y);
  const scheduled: RevealEntry[] = [];
  const a: [V3, V3] = [[0, 0, 0], [0, 0, 0]];
  const q: [V3, V3] = [[0, 0, 0], [0, 0, 0]];
  const pos: V3 = [0, 0, 0];
  const rr: V3 = [0, 0, 0];
  const clashes = (e: RevealEntry) => {
    for (let t = e.t0; t <= e.t3 + 1e-9; t += 1 / 120) {
      placeAt(e, t, pos, rr);
      turnedBox(boxes[e.id], pos, rr, a);
      for (const other of order) {
        if (other === e.id) continue;
        const o = entries[other];
        const l = later.get(`${e.id}|${other}`);
        if (o) {
          placeAt(o, t, pos, rr);
          turnedBox(boxes[other], pos, rr, q);
        } else {
          // Not scheduled yet: still packed on the floor.
          const pk = byId.get(other)!;
          const r: V3 = [pk.rot[0] * DEG, pk.rot[1] * DEG, pk.rot[2] * DEG];
          turnedBox(boxes[other], [0, 0, 0], r, q);
          turnedBox(boxes[other], [pk.at[0], pk.at[1], -q[0][2]], r, q);
        }
        if (!boxesOverlap(a, q, -1)) continue;
        // A docking pair may touch while the later one comes down.
        if (l && t >= (l === e.id ? e.t2 : (o?.t2 ?? Infinity))) continue;
        return true;
      }
    }
    return false;
  };
  order.forEach((id, k) => {
    const pk = byId.get(id);
    if (!pk) throw new Error(`revealPlan: no packed pose for ${id}`);
    const b = boxes[id];
    const o = origins[id];
    const c = centreOf(b);
    const rot: V3 = [pk.rot[0] * DEG, pk.rot[1] * DEG, pk.rot[2] * DEG];
    turnedBox(b, [0, 0, 0], rot, box);
    const from: V3 = [pk.at[0], pk.at[1], -box[0][2]];
    const to: V3 = [o[0] + c[0], o[1] + c[1], o[2] + c[2]];
    // The flight's plan sweep (both ends, any turn's extent): what it passes over.
    const hd = halfDiag(b);
    const lo0 = Math.min(from[0], to[0]) - hd;
    const lo1 = Math.min(from[1], to[1]) - hd;
    const hi0 = Math.max(from[0], to[0]) + hd;
    const hi1 = Math.max(from[1], to[1]) + hd;
    let top: number = REVEAL.layer;
    for (const l of landed) if (l[0][0] < hi0 && l[1][0] > lo0 && l[0][1] < hi1 && l[1][1] > lo1) top = Math.max(top, l[1][2]);
    const air = Math.max(top + REVEAL.clear + hd, to[2], from[2]);
    const rise = Math.max(REVEAL.minLift, (air - from[2]) / REVEAL.speed);
    const fall = Math.max(REVEAL.minLift, (air - to[2]) / REVEAL.speed);
    // The earliest start (a stagger after the previous one) whose whole motion is clear.
    const prev = scheduled.length ? scheduled[scheduled.length - 1]!.t0 + REVEAL.stagger : lidT2;
    const e: RevealEntry = { id, origin: [o[0], o[1], o[2]], centre: c, from, rot, to, air, t0: prev, t1: 0, t2: 0, t3: 0 };
    for (let tries = 0; ; tries++) {
      e.t1 = e.t0 + rise;
      e.t2 = e.t1 + REVEAL.move;
      e.t3 = e.t2 + fall;
      if (!clashes(e) || tries > MAX_TRIES) break;
      e.t0 += 0.1;
    }
    void k;
    entries[id] = e;
    scheduled.push(e);
    landed.push([
      [o[0] + b[0][0], o[1] + b[0][1], o[2] + b[0][2]],
      [o[0] + b[1][0], o[1] + b[1][1], o[2] + b[1][2]],
    ]);
  });
  let end = lidT2;
  for (const id of order) end = Math.max(end, entries[id].t3);
  return { entries, order, lid, end };
}
