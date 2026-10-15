/**
 * The bucket elevator, output to the device (v2 `parts/scanner/elevator.mjs`, LIVE L296–484): mint
 * audio packets slide off belt D down the in-feed chute into the boot, wait there for an empty
 * cradle, ride the front run up on cradles fixed to a twin roller chain (14 at lift 210, 30 u/s),
 * and at the head sprocket are flung over it into the discharge hopper behind the head; after the
 * duct's transit they drop out of the down-spout (onto the speaker's ledge). Empty cradles return
 * down the back run.
 *
 * The cradles ride a vertical stadium (`verticalStadium`): front run at y = R going up, over the
 * head sprocket toward −y, back run down, round the boot sprocket (inside the boot housing). A
 * cradle is a rigid body in the chain's frame (x across, n outward, t along the travel), so it
 * rounds the sprocket by turning about x (`roll`), with no seam between the runs and the wraps.
 *
 * A packet is drawn wherever it is: on the chute, inside the boot while it waits, on its cradle,
 * in flight, then inside the hopper, along the duct and down the spout (hidden there by depth:
 * every pose of the transit is inside those parts), and out of the spout's mouth. A cradle takes
 * a waiting packet as it passes the boot's tangent (u = 0, inside the boot); a loaded cradle
 * launches its packet at the head's front tangent (u = the front run's length), from its exact
 * pose on the cradle.
 *
 * Plain TS, deterministic. Local frame: v2's design frame minus its column centre (REF
 * [−107, −123, 0]): origin = the centre of the tower's column on the floor. Only v2 A's variant
 * is built: the spout on the −y side (`outDir: "-y"`), at `reach` past the hopper.
 */
import type { Clock, Machine } from './clock.ts';
import type { Item, Ledger, PoseSource } from './items.ts';
import { ease, mod } from './math.ts';
import { type Lift, type LiftPoint, liftPoint, verticalStadium } from './path.ts';
import { type Located, type OutPort, type Receiver, type V3, createOut } from './ports.ts';
import { RATES } from './rates.ts';

/** v2 elevator GEOMETRY and build constants, in the local frame (lift-independent). */
export const EL = {
  /** Boot sprocket axis height, chain pitch radius, the axes' y, the boot housing's top. */
  zb: 26,
  r: 13.5,
  yc: 0,
  zBootTop: 42,
  /** Tower posts (centres) and their half size. */
  posts: { x: [-9.7, 9.7] as const, y: [-9.7, 9.7] as const, half: 1.3 },
  /** The twin chain strands' x, the chain pin pitch (the band's line spacing). */
  strands: [-5, 5] as const,
  pitch: 4,
  /** The in port: the chute's mouth (belt D ends ≈ 11 past it). */
  in: [0, 39, 24] as V3,
  /** A cradle across x (v2 `wrapCradle`). */
  cradle: { x0: -5.5, x1: 5.5 },
  /**
   * The cradle's five plates in its chain frame: [x0, x1, n0, n1, t0, t1] (n out, t along the
   * travel); the base plate is the packet's seat.
   */
  plates: [
    { id: 'back', p: [-5.5, 5.5, 0.7, 1.9, 1.2, 10] },
    { id: 'cheekL', p: [-5.5, -4.7, 1.9, 9, 1.2, 4] },
    { id: 'base', p: [-5.5, 5.5, 0.7, 11.2, 0, 1.2] },
    { id: 'cheekR', p: [4.7, 5.5, 1.9, 9, 1.2, 4] },
    { id: 'lip', p: [-5.5, 5.5, 10, 11.2, 1.2, 3] },
  ] as const,
  /** The packet's seat on the cradle: the base plate's middle (n) and top (t). */
  seat: { n: (0.7 + 11.2) / 2, t: 1.2 },
  /** The chain band: pitch radius ± half its depth (its outer radius `r + depth / 2`), width across. */
  chain: { R: 13.5 + 0.7, depth: 1.4, across: 1.2 },
  /** The boot housing (its +y face is the feed's face, under the flange at 40). */
  boot: { x0: -7.5, x1: 7.5, y0: -26, y1: 26, z1: 40 },
  /** The duct's half width (x). */
  ductHalf: 6,
  /**
   * The in-feed chute (floor at z, mouth to the boot's +y face), the slide's speed and the
   * time constant it eases to it; a packet is inside the boot once its centre is `inside` past
   * the face.
   */
  feed: { mouth: 40, face: 26, z: 24, speed: 22, tau: 0.15, inside: 4.2 },
  /** The discharge hopper (plan; z relative to the head shaft). */
  hopper: { x0: -11, x1: 11, y0: -41, y1: -25, z0: 2, z1: 14 },
  /**
   * The fling (v2 FLY, DUCT, EMERGE) and the drop out of the spout. The flight is a cubic: its
   * first control point `c1` (y, z above the shaft) over the head, its second `c2` above the
   * landing point, so the packet clears the chain's wrap and drops into the hopper from above
   * (v2's quadratic through [1, 40] grazed the wrap and dipped below the rim in front of the
   * hopper's near wall).
   */
  fling: { fly: 0.75, duct: 0.5, emerge: 0.3, c1: [6, 40] as const, c2: 30, drop: 7 },
  /** The down-spout's radius (the packet's half diagonal is 6.4: it fits). */
  spoutR: 6.5,
} as const;

export interface ElevatorGeometry {
  lift: number;
  reach: number;
  /** Head shaft height, the straight runs' length, the loop length, cradles and their spacing. */
  zh: number;
  Lf: number;
  total: number;
  count: number;
  spacing: number;
  /** Hopper: bottom, top, rim (flange top); where a flung packet lands (bottom centre). */
  hopperZ0: number;
  hopperZ1: number;
  rim: number;
  land: V3;
  /** The duct (plan y range, z range). */
  duct: { y0: number; y1: number; z0: number; z1: number };
  /** The spout's centre (x, y); `out` = its mouth (the flange's underside), where a packet leaves. */
  spout: [number, number];
  ports: { in: V3; out: V3 };
}

/** Geometry for a lift (in port to out port, v2 default 210) and a spout `reach` past the hopper (v2 A: 40). */
export function elevatorGeometry(o: { lift?: number; reach?: number } = {}): ElevatorGeometry {
  const lift = o.lift ?? 210;
  const reach = o.reach ?? 40;
  if (!(lift >= 120)) throw new Error(`elevator: lift ${lift} below 120`);
  if (!(reach >= 12)) throw new Error(`elevator: reach ${reach} below 12 (no duct)`);
  const zh = EL.in[2] + lift + 7.5;
  const Lf = zh - EL.zb;
  const total = 2 * Lf + 2 * Math.PI * EL.r;
  const count = Math.max(8, Math.round(total / 38));
  const H = EL.hopper;
  const spout: [number, number] = [0, H.y0 - reach + 7];
  return {
    lift,
    reach,
    zh,
    Lf,
    total,
    count,
    spacing: total / count,
    hopperZ0: zh + H.z0,
    hopperZ1: zh + H.z1,
    rim: zh + H.z1 + 1.2,
    land: [0, (H.y0 + H.y1) / 2, zh + H.z1 - 6],
    duct: { y0: H.y0 - reach, y1: H.y0 - 1, z0: zh + H.z0, z1: zh + H.z0 + 8 },
    spout,
    ports: { in: [...EL.in], out: [spout[0], spout[1], zh - 7.5] },
  };
}


/**
 * A flung packet's pose (bottom centre, level) `tau` s after launch: from its seat at the head's
 * front tangent over the head into the hopper (a cubic, `EL.fling`, on v2's eased parameter); then, hidden, down to the duct's floor, along the duct and down
 * the spout to its mouth (at constant speed); then out of the mouth, easing in, `drop` below it.
 */
export function elevatorFlight(g: ElevatorGeometry) {
  const F = EL.fling;
  const from: V3 = [0, EL.yc + EL.r + EL.seat.n, g.zh + EL.seat.t];
  const C1: V3 = [0, EL.yc + F.c1[0], g.zh + F.c1[1]];
  const P2 = g.land;
  const C2: V3 = [0, P2[1], g.zh + F.c2];
  const floorZ = g.duct.z0 + 0.5;
  const transit: V3[] = [P2, [0, P2[1], floorZ], [0, g.spout[1], floorZ], [0, g.spout[1], g.ports.out[2]]];
  const legs = transit.slice(1).map((b, i) => Math.hypot(b[1] - transit[i]![1], b[2] - transit[i]![2]));
  const transitLen = legs.reduce((a, b) => a + b, 0);
  return {
    life: F.fly + F.duct + F.emerge,
    at(tau: number, p: V3): V3 {
      if (tau < F.fly) {
        const s = Math.max(0, tau) / F.fly;
        const e = ease(s) * 0.35 + s * 0.65;
        const u = 1 - e;
        for (let k = 0; k < 3; k++) p[k] = u * u * u * from[k]! + 3 * u * u * e * C1[k]! + 3 * u * e * e * C2[k]! + e * e * e * P2[k]!;
        return p;
      }
      if (tau < F.fly + F.duct) {
        let d = ((tau - F.fly) / F.duct) * transitLen;
        for (let k = 0; k < legs.length; k++) {
          if (d <= legs[k]! || k === legs.length - 1) {
            const a = transit[k]!;
            const b = transit[k + 1]!;
            const f = Math.min(1, d / legs[k]!);
            p[0] = a[0] + (b[0] - a[0]) * f;
            p[1] = a[1] + (b[1] - a[1]) * f;
            p[2] = a[2] + (b[2] - a[2]) * f;
            return p;
          }
          d -= legs[k]!;
        }
      }
      const k = Math.min(1, (tau - F.fly - F.duct) / F.emerge);
      p[0] = g.ports.out[0];
      p[1] = g.ports.out[1];
      p[2] = g.ports.out[2] - F.drop * k * k;
      return p;
    },
  };
}

export interface ElevatorOptions {
  id: string;
  origin: V3;
  lift?: number;
  reach?: number;
  /** v2's steady state at load: every other cradle on the front run already carries a packet. */
  prefill?: boolean;
}

interface FeedItem {
  item: Item;
  x: number;
  y: number;
  z: number;
  vy: number;
  /** Change over the last step (render extrapolation). */
  dx: number;
  dy: number;
  dz: number;
  born: number;
}

interface Flight {
  item: Item;
  /** Launch time (sim clock, exact: when the cradle passed the head's tangent). */
  t0: number;
}

export interface Elevator extends Machine, Located, Receiver, PoseSource {
  readonly geometry: ElevatorGeometry;
  readonly path: Lift;
  readonly outs: { out: OutPort };
  /**
   * Pool sizes the blocks need (read at mount): every cradle loaded, plus the chute and the boot
   * (`canAccept` advises ≤ 3) and the flights in the air (one per cradle passing the head during
   * a flight's life).
   */
  readonly pools: { readonly packets: number; readonly cradles: number };
  /** Packets taken in (from belt D), handed out of the spout; waiting in the boot now; the most that ever waited. */
  readonly stats: { readonly taken: number; readonly lifted: number; readonly queue: number; readonly maxQueue: number };
  /** Chain travel at t + acc (the bands' u shift, the sprockets' turn). */
  travel(): number;
  /** Cradle poses at t + acc: the chain point (y, z; x = 0) and the roll about x; returns the count. */
  cradles(cb: (i: number, y: number, z: number, roll: number) => void): number;
}

export function createElevator(clock: Readonly<Clock>, ledger: Ledger, o: ElevatorOptions): Elevator {
  const g = elevatorGeometry(o);
  const path = verticalStadium({ z0: EL.zb, z1: g.zh, R: EL.r, yc: EL.yc });
  const speed = RATES.elevatorSpeed;
  const { Lf, total, spacing } = g;
  const FD = EL.feed;
  const out = createOut(o, 'out', { asks: false });
  const cradle: (Item | null)[] = Array.from({ length: g.count }, () => null);
  const feed: FeedItem[] = [];
  const waiting: Item[] = [];
  const flights: Flight[] = [];
  const stats = { taken: 0, lifted: 0, queue: 0, maxQueue: 0 };
  let travel = 0;
  const pt: LiftPoint = liftPoint();
  const uOf = (i: number, tr: number) => mod(tr + i * spacing, total);
  const flight = elevatorFlight(g);
  const life = flight.life;
  const F = EL.fling;
  const outAt: V3 = [g.ports.out[0], g.ports.out[1], g.ports.out[2] - F.drop];
  const outV: V3 = [0, 0, (-2 * F.drop) / F.emerge];
  const fp: V3 = [0, 0, 0];
  const queueZ = FD.z;
  const queueY = FD.face - FD.inside;

  if (o.prefill) {
    for (let i = 0; i < g.count; i++) {
      const u = uOf(i, 0);
      if (u > 20 && u < Lf - 10 && i % 2 === 0) cradle[i] = ledger.make('audio');
    }
  }

  const elevator: Elevator = {
    id: o.id,
    origin: o.origin,
    geometry: g,
    path,
    outs: { out },
    pools: { packets: g.count + 3 + Math.ceil((life * speed) / spacing) + 1, cradles: g.count },
    stats,
    canAccept: () => waiting.length + feed.length < 3,
    accept(item, p, v) {
      stats.taken++;
      feed.push({ item, x: p[0], y: p[1], z: p[2], vy: v[1], dx: 0, dy: v[1] * clock.H, dz: 0, born: clock.t });
    },
    step(h) {
      const t = clock.t;
      const step = speed * h;
      for (let i = 0; i < g.count; i++) {
        const before = uOf(i, travel);
        const after = before + step;
        // Past the boot's tangent (inside the boot): an empty cradle takes the first waiting packet.
        if (after >= total && waiting.length > 0 && cradle[i] === null) cradle[i] = waiting.shift()!;
        // Past the head's front tangent: the packet leaves the cradle at its exact time.
        const it = cradle[i];
        if (it && before < Lf && after >= Lf) {
          flights.push({ item: it, t0: t - (after - Lf) / speed });
          cradle[i] = null;
        }
      }
      travel += step;
      // The chute: keeps the belt's speed, easing to the chute's; centred over the chute.
      const k = 1 - Math.exp(-h / FD.tau);
      for (let i = feed.length - 1; i >= 0; i--) {
        const f = feed[i]!;
        if (f.born === t) continue;
        f.vy += (-FD.speed - f.vy) * k;
        const x = f.x + (0 - f.x) * k;
        const y = f.y + f.vy * h;
        const z = f.z + (FD.z - f.z) * k;
        f.dx = x - f.x;
        f.dy = y - f.y;
        f.dz = z - f.z;
        f.x = x;
        f.y = y;
        f.z = z;
        if (f.y < queueY) {
          feed.splice(i, 1);
          waiting.push(f.item);
        }
      }
      stats.queue = waiting.length;
      stats.maxQueue = Math.max(stats.maxQueue, waiting.length);
      // Out of the spout's mouth: handed on (moving down) when it is a drop below the flange.
      while (flights.length > 0 && t - flights[0]!.t0 >= life) {
        const f = flights.shift()!;
        stats.lifted++;
        out.send(f.item, outAt, outV);
      }
    },
    alive() {
      let n = feed.length + waiting.length + flights.length;
      for (const c of cradle) if (c) n++;
      return n;
    },
    status: () => ({ taken: stats.taken, lifted: stats.lifted, queue: waiting.length, maxQueue: stats.maxQueue, chute: feed.length, loaded: cradle.filter(Boolean).length, flights: flights.length }),
    travel: () => travel + speed * clock.acc,
    cradles(cb) {
      const tr = travel + speed * clock.acc;
      for (let i = 0; i < g.count; i++) {
        path.at(uOf(i, tr), EL.r, pt);
        cb(i, pt.y, pt.z, pt.roll);
      }
      return g.count;
    },
    poses(cb) {
      const a = clock.acc;
      const kk = a / clock.H;
      let n = 0;
      for (const f of feed) cb(n++, f.item, f.x + f.dx * kk, f.y + f.dy * kk, f.z + f.dz * kk, f.item.yaw, 0, 0, 0);
      // Inside the boot (hidden by its housing), at the chute's end.
      for (const it of waiting) cb(n++, it, 0, queueY, queueZ, it.yaw, 0, 0, 0);
      const tr = travel + speed * a;
      const { n: sn, t: st } = EL.seat;
      for (let i = 0; i < g.count; i++) {
        const it = cradle[i];
        if (!it) continue;
        path.at(uOf(i, tr), EL.r, pt);
        cb(n++, it, 0, pt.y + pt.ny * sn + pt.ty * st, pt.z + pt.nz * sn + pt.tz * st, it.yaw, 0, pt.roll, 0);
      }
      const now = clock.t + a;
      for (const f of flights) {
        flight.at(Math.min(life, now - f.t0), fp);
        cb(n++, f.item, fp[0], fp[1], fp[2], f.item.yaw, 0, 0, 0);
      }
      return n;
    },
  };
  return elevator;
}
