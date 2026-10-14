/**
 * The scanner, the platform audio callback (v2 `parts/scanner/scanner.mjs`, LIVE L148–334): a
 * hard-disk read arm on a pedestal beside the audio loop. Its head tracks one cleat of the top run
 * through a ±9 window, and when that cleat leaves the window the arm counts a read (one cleat gap
 * = one 128-frame render quantum) and flies back to the next cleat in a 0.16 s eased seek. Every
 * read flashes the status lamp and runs a mint pulse down the flex ribbon and the round cable to
 * the preamp; each pulse that lands fills one of the preamp's 4 buffer cells, and the 4th pushes
 * one mint audio packet out of the preamp's back face, across the lip and onto belt D.
 *
 * One source of reads: the loop's read point. The loop counts a quantum (`quanta().count`) and
 * greys the parcel on it when a cleat passes its read point; the scanner reads exactly then. The
 * loop's `readAt` is snapped (`scannerReadAt`) so that the cleat at the read point (bottom run) is
 * in phase with the cleat leaving the head's window (top run): the head, which follows the real
 * cleats (`phaseAt` at the window end), finishes a cleat at the instant of the read.
 * `createScanner` checks it.
 *
 * Plain TS, deterministic. Times are the loop's clock (travel / speed), so the head, pulses,
 * lamp and push are exact at t + acc whatever the step order. Local frame: v2's, shifted so the
 * origin is the foot of the arm's pivot axis on the floor (v2 design frame − [−30, 32, 0]); the
 * arm points along +y at rest, toward the loop.
 */
import { tubeCentreline } from '../geo/tube.ts';
import type { Clock, Machine } from './clock.ts';
import { type Item, type Ledger, type PoseSource } from './items.ts';
import type { Loop, LoopGeometry } from './loop.ts';
import { mod, smooth, wrapHalf } from './math.ts';
import { type Located, type OutPort, type V3, createOut } from './ports.ts';

/** v2's design frame → the scanner's local frame (pivot foot at the origin); the blocks use it too. */
export const scannerW = (x: number, y: number, z: number): V3 => [x + 30, y - 32, z];
const W = scannerW;

/** Segments of the flex ribbon: a cubic in plan from the arm's side to the bracket's +y face (v2 `ribbon`). */
export const RIBBON_N = 18;

/** v2 scanner.mjs dimensions (build L9–147), in the local frame; shared with the blocks. */
export const SC = {
  /** Arm plane (E-block) z, head reach from the pivot, track window ±, seek s (v2 GEOMETRY, LIVE). */
  armZ: [94.5, 96] as const,
  reach: 30.5,
  track: 9,
  seek: 0.16,
  /** |sin θ| limit of the arm (v2 clamps the head to ±0.6 reach). */
  maxSin: 0.6,
  /** Pulse speed along the ribbon and cable, units/s; reads per packet (4 quanta = 512 frames). */
  pulseSpeed: 140,
  perPacket: 4,
  /** The flex ribbon: its height band, the arm-side attach (arm frame: across, along) and the bracket end. */
  flexZ: [92.4, 95.6] as const,
  attach: [4.4, 1.5] as const,
  bracket: [W(-13.5, 37, 0)[0], W(-13.5, 37, 0)[1]] as const,
  /** Status lamp lens centre (on the VCM top plate) and radius. */
  lamp: (() => {
    const a = (24 * Math.PI) / 180;
    return [-11.5 * Math.sin(a), -11.5 * Math.cos(a), 103.8] as V3;
  })(),
  lampR: 1.7,
  /** Preamp box, its 4-cell window on the +x face, the output lip. */
  preamp: { x0: W(-116, 0, 0)[0], x1: W(-98, 0, 0)[0], y0: W(0, 39, 0)[1], y1: W(0, 53, 0)[1], z0: 16, z1: 30 },
  win: { y0: W(0, 40.4, 0)[1], y1: W(0, 48.4, 0)[1], z0: 22, z1: 27 },
  lip: { x0: W(-112.5, 0, 0)[0], x1: W(-101.5, 0, 0)[0], y0: W(0, 33, 0)[1], y1: W(0, 39, 0)[1], z0: 23, z1: 24 },
  /**
   * The push: a packet appears inside the box (its back edge 4 in from the window side), slides
   * out of the −y face across the lip, accelerating (y = from − (from − to)·u^power over T s), and
   * is handed on at the lip's end (centre over the edge) still moving.
   */
  push: { x: W(-107, 0, 0)[0], from: W(0, 44, 0)[1], to: W(0, 33, 0)[1], z: 24, T: 1.1, power: 2.4 },
  /** The round cable from the flex boss down to the floor and along to the preamp input (v2 route). */
  cable: {
    points: [W(-9.4, 32.5, 90), W(-6, 32.5, 90), W(-6, 32.5, 46), W(-6, 44, 46), W(-6, 44, 2.6), W(-88, 44, 2.6), W(-88, 51, 2.6), W(-88, 51, 24), W(-96, 51, 24)] as V3[],
    r: 0.9,
    bend: 4,
    /** Connector shells at both ends (v2 `pulseCable` SHELL). */
    shell: 1.98,
  },
  /** Where the head reads (v2 `ports.read`): over the loop's near margin at the belt top. */
  read: W(-30, 63, 92),
} as const;

/** The push's speed when the packet leaves the lip (units/s, along −y). */
const PUSH_V = ((SC.push.from - SC.push.to) * SC.push.power) / SC.push.T;
/** Where (local, the packet's bottom centre) and how fast a packet is handed on: belt D starts under it. */
export const SCANNER_OUT = { at: [SC.push.x, SC.push.to, SC.push.z] as V3, v: [0, -PUSH_V, 0] as V3 };

/**
 * The ribbon's plan curve for an arm angle θ (rad, + turns the head toward +x): RIBBON_N + 1
 * points into `out` (x, y pairs), cumulative lengths into `len`; returns the length.
 */
export function ribbonCurve(theta: number, out: Float64Array, len: Float64Array): number {
  const ax = Math.sin(theta);
  const ay = Math.cos(theta);
  const cx = Math.cos(theta);
  const cy = -Math.sin(theta);
  const [c0, s0] = SC.attach;
  const A0x = ax * s0 + cx * c0;
  const A0y = ay * s0 + cy * c0;
  const P1x = A0x + ax * 7;
  const P1y = A0y + ay * 7;
  const [Bx, By] = SC.bracket;
  const P2x = Bx;
  const P2y = By + 7;
  let total = 0;
  for (let i = 0; i <= RIBBON_N; i++) {
    const t = i / RIBBON_N;
    const u = 1 - t;
    const x = u * u * u * A0x + 3 * u * u * t * P1x + 3 * u * t * t * P2x + t * t * t * Bx;
    const y = u * u * u * A0y + 3 * u * u * t * P1y + 3 * u * t * t * P2y + t * t * t * By;
    if (i > 0) total += Math.hypot(x - out[2 * i - 2]!, y - out[2 * i - 1]!);
    out[2 * i] = x;
    out[2 * i + 1] = y;
    len[i] = total;
  }
  return total;
}

/** The cable's filleted centreline (the Tube block's own) and its length. */
export const SCANNER_CABLE = tubeCentreline(SC.cable.points, SC.cable.bend);

/** The ribbon's length at rest (θ = 0): the pulse timing uses it (v2 measured it per frame). */
const RIBBON_LEN = ribbonCurve(0, new Float64Array(2 * RIBBON_N + 2), new Float64Array(RIBBON_N + 1));
/** A pulse lands at the preamp this long after its read (v2: + 4 units). */
const PULSE_T = (RIBBON_LEN + SCANNER_CABLE.total + 4) / SC.pulseSpeed;

/**
 * The loop's `readAt` for a scanner at `scannerOrigin` (world): the bottom-run point in phase
 * with the head's window end on the top run (so a read greys the parcel there at the same
 * instant), nearest the pivot. `g` from `loopGeometry` (any readAt).
 */
export function scannerReadAt(g: LoopGeometry, loopOrigin: V3, scannerOrigin: V3): number {
  const uLeave = windowEnd(g, loopOrigin, scannerOrigin);
  const r0 = mod(uLeave - g.uHeadEnd, g.cleatGap);
  const sHead = g.dir > 0 ? g.L : 0;
  const sPivot = scannerOrigin[0] - loopOrigin[0];
  let best = NaN;
  for (let dist = r0; dist < g.L; dist += g.cleatGap) {
    const s = sHead - g.dir * dist;
    if (s > 0 && s < g.L && !(Math.abs(s - sPivot) >= Math.abs(best - sPivot))) best = s;
  }
  if (Number.isNaN(best)) throw new Error('scannerReadAt: no read point on the bottom run');
  return best;
}

/** Arc length (loop u) of the head's window end on the top run. */
function windowEnd(g: LoopGeometry, loopOrigin: V3, scannerOrigin: V3) {
  if (g.axis !== 'x') throw new Error('scanner: reads a loop along x only (v2 too)');
  const sTail = g.dir > 0 ? 0 : g.L;
  const s = scannerOrigin[0] + g.dir * SC.track - loopOrigin[0];
  const u = g.dir * (s - sTail);
  if (!(u > 0 && u < g.L)) throw new Error(`scanner: the head's window (s ${s.toFixed(1)}) is off the loop's top run`);
  return u;
}

export interface ScannerOptions {
  id: string;
  origin: V3;
  /** The belt being read (its read point at `scannerReadAt`). */
  loop: Loop;
}

export interface ScannerOutputs {
  /** The head's x offset from the pivot (local), and the arm angle (rad; head x = reach·sin θ). */
  head: number;
  theta: number;
  /** Lamp glow 0..1 (a burst per read). */
  lamp: number;
  /** The 4 buffer cells' fill 0..1. */
  cells: number[];
}

export interface Scanner extends Machine, Located, PoseSource {
  readonly outs: { out: OutPort };
  /** Reads (= the loop's quanta since start), pulses landed, packets made and handed on. */
  readonly stats: { readonly reads: number; readonly delivered: number; readonly made: number; readonly sent: number };
  /** Pulses in flight: how far each has run from the arm along the ribbon, then the cable (units). */
  pulses(cb: (i: number, s: number) => void): number;
  outputs(o: ScannerOutputs): ScannerOutputs;
  /** The ribbon's length the pulse timing uses (at rest). */
  readonly ribbonLength: number;
  /**
   * Pool sizes the blocks need (read at mount), from the loop's quantum: packets on their way out
   * of the preamp (one per 4 quanta while a push takes 1.1 s) and pulses in flight (one per
   * quantum while a pulse takes ≈ 1.8 s), each plus one of slack.
   */
  readonly pools: { readonly packets: number; readonly pulses: number };
}

export function createScanner(clock: Readonly<Clock>, ledger: Ledger, o: ScannerOptions): Scanner {
  const loop = o.loop;
  const g = loop.geometry;
  const d = g.dir;
  const uLeave = windowEnd(g, loop.origin, o.origin);
  if (Math.abs(wrapHalf((g.uRead - uLeave) / g.cleatGap)) > 1e-6) {
    throw new Error(`${o.id}: the loop's read point is out of phase with the head (readAt ${g.readS}; use scannerReadAt → ${scannerReadAt(g, loop.origin, o.origin).toFixed(3)})`);
  }
  const period = g.cleatGap / g.speed;
  const out = createOut(o, 'out', { asks: false });
  /** Read times (loop clock) of the pulses in flight, oldest first. */
  const pulses: number[] = [];
  /** Packets on their way out: item and push start (loop clock). */
  const outgoing: { item: Item; t0: number }[] = [];
  const levels = [0, 0, 0, 0];
  const stats = { reads: 0, delivered: 0, made: 0, sent: 0 };
  let buffered = 0;
  let lastRead = -1e9;
  let count = loop.quanta().count;
  const { at: from, v } = SCANNER_OUT;
  /** The loop's clock: its travel over its speed, at t + `ahead`. */
  const now = (ahead = 0) => loop.travel / g.speed + ahead;
  const pushY = (u: number) => SC.push.from - (SC.push.from - SC.push.to) * Math.pow(Math.min(1, Math.max(0, u)), SC.push.power);

  const scanner: Scanner = {
    id: o.id,
    origin: o.origin,
    outs: { out },
    stats,
    ribbonLength: RIBBON_LEN,
    pools: { packets: Math.ceil(SC.push.T / (SC.perPacket * period)) + 1, pulses: Math.ceil(PULSE_T / period) + 1 },
    step(h) {
      const q = loop.quanta();
      if (q.count !== count) {
        // A cleat passed the read point: one quantum read (and its parcel greyed by the loop).
        count = q.count;
        stats.reads++;
        lastRead = now() - q.phase * period;
        pulses.push(lastRead);
      }
      const t = now();
      while (pulses.length > 0 && t - pulses[0]! >= PULSE_T) {
        const landed = pulses.shift()! + PULSE_T;
        stats.delivered++;
        buffered++;
        if (buffered >= SC.perPacket) {
          buffered = 0;
          stats.made++;
          outgoing.push({ item: ledger.make('audio'), t0: landed });
        }
      }
      for (let i = 0; i < SC.perPacket; i++) {
        const want = i < buffered ? 1 : 0;
        levels[i]! += (want - levels[i]!) * (1 - Math.exp(-h / (want > levels[i]! ? 0.05 : 0.1)));
      }
      while (outgoing.length > 0 && t - outgoing[0]!.t0 >= SC.push.T) {
        const it = outgoing.shift()!;
        stats.sent++;
        out.send(it.item, from, v);
      }
    },
    alive: () => outgoing.length,
    status: () => ({ ...stats, buffered, pulses: pulses.length, pushing: outgoing.length }),
    pulses(cb) {
      const t = now(clock.acc);
      for (let i = 0; i < pulses.length; i++) cb(i, (t - pulses[i]!) * SC.pulseSpeed);
      return pulses.length;
    },
    outputs(r) {
      // The cleat that will next reach the window end is (1 − phase) gaps upstream of it.
      const ph = loop.phaseAt(uLeave, clock.acc);
      const target = Math.min(SC.track, Math.max(-SC.track, d * (SC.track - (1 - ph) * g.cleatGap)));
      const age = ph * period;
      // Seeking back from the window end since the read (the seek ends long before the next).
      const head = age < SC.seek ? d * SC.track + (target - d * SC.track) * smooth(0, SC.seek, age) : target;
      r.head = head;
      r.theta = Math.asin(Math.min(SC.maxSin, Math.max(-SC.maxSin, head / SC.reach)));
      const la = now(clock.acc) - lastRead;
      r.lamp = smooth(0, 0.05, la) * Math.exp(-Math.max(0, la - 0.05) / 0.16);
      for (let i = 0; i < SC.perPacket; i++) r.cells[i] = levels[i]!;
      return r;
    },
    poses(cb) {
      const t = now(clock.acc);
      for (let i = 0; i < outgoing.length; i++) {
        const it = outgoing[i]!;
        cb(i, it.item, SC.push.x, pushY((t - it.t0) / SC.push.T), SC.push.z, it.item.yaw, 0, 0, 0);
      }
      return outgoing.length;
    },
  };
  return scanner;
}
