/**
 * The speaker (v2 `parts/screen/speaker.mjs`, LIVE L225–362): a bare driver, membrane up, with a
 * throat on its +x side. A mint audio packet handed on above the feed ledge falls onto its end
 * (keeping its velocity, bending to land), slides into the throat's mouth (hidden by the throat
 * by depth once inside), and as it reaches the back of the throat it is heard: the cone pumps up
 * along its axis (an impulse response per packet: damped, 4.6 Hz, out first; the dust cap moves
 * 1.35× as far) and the 6-LED level meter on the throat jumps, its peak LED holding before it
 * falls.
 *
 * Plain TS, deterministic: v2's random level kick (`0.6 + random·0.35`) comes from a hash of the
 * packet count. The cone is exact at t + acc (a sum over the kick times). Local frame: v2's
 * (origin = the centre of the stand's base plate, on the floor; the driver's axis is z).
 */
import type { Clock, Machine } from './clock.ts';
import { type Fall, createFall, fallAt } from './fall.ts';
import { type Item, type Ledger, PACKET_SIZE, type PoseSource } from './items.ts';
import { smooth } from './math.ts';
import type { Located, Receiver, V3 } from './ports.ts';

/** v2 speaker constants (build L11–224), in the local frame; `height` = the baffle's top. */
export const SPK = {
  /** Baffle half size (the stand's base plate), driver hole, ring outer radius. */
  HB: 46,
  hole: 29,
  ringOut: 34,
  /** Basket depth (dish top below the ring). */
  basket: 28,
  /** The cone's impulse: damping time, frequency, amplitude, clamp, and the cap's extra travel. */
  kick: { tau: 0.26, hz: 4.6, amp: 2.4, lo: -1.1, hi: 1.4, cap: 1.35, keep: 1.6 },
  /** The meter: LEDs, level decay, peak hold and its fall. */
  leds: 6,
  level: { tau: 0.5, hold: 0.7, fall: 0.9, show: 0.12 },
  /** A packet slides from the ledge's end into the throat in this long (v2: 0.3 → 1.0 s). */
  slide: 0.7,
} as const;

export interface SpeakerGeometry {
  height: number;
  /** The throat box (x0..x1, y ±, z0..z1) and its mouth on the +x face (y ±, z0..z1). */
  throat: { x0: number; x1: number; y: number; z0: number; z1: number };
  mouth: { y: number; z0: number; z1: number };
  /** The feed ledge (x0..x1, top z). */
  ledge: { x0: number; x1: number; z: number };
  /** A packet's centre where it lands (its front at the ledge's end) and where it ends inside the throat. */
  landX: number;
  endX: number;
  ports: { in: V3 };
}

export function speakerGeometry(o: { height?: number } = {}): SpeakerGeometry {
  const ZB = o.height ?? 220;
  if (!(ZB >= 40)) throw new Error(`speaker: height ${ZB} below 40`);
  const throat = { x0: 25, x1: SPK.HB + 6, y: 6.5, z0: ZB - 17, z1: ZB - 2 };
  const mouth = { y: 4.8, z0: throat.z0 + 2, z1: throat.z1 - 2.4 };
  const ledge = { x0: throat.x1, x1: throat.x1 + 12, z: mouth.z0 };
  const half = PACKET_SIZE.w / 2;
  return {
    height: ZB,
    throat,
    mouth,
    ledge,
    landX: ledge.x1 - half,
    // v2: the front ends 1.5 inside the mouth.
    endX: throat.x1 - 1.5 - half,
    ports: { in: [ledge.x1, 0, ledge.z] },
  };
}

export interface SpeakerOptions {
  id: string;
  origin: V3;
  height?: number;
}

export interface SpeakerOutputs {
  /** The cone's lift along +z, and the dust cap's. */
  cone: number;
  cap: number;
  /** LEDs lit (0..6) and the peak LED (−1: none). */
  lit: number;
  peak: number;
}

interface SpeakerItem {
  item: Item;
  fall: Fall | null;
  /** Slide start (sim time), once on the ledge. */
  t0: number;
  p: V3;
  d: V3;
  born: number;
}

export interface Speaker extends Machine, Located, Receiver, PoseSource {
  readonly geometry: SpeakerGeometry;
  /** Pool sizes the blocks need (read at mount). */
  readonly pools: { readonly packets: number };
  /** Packets heard (each pumped the cone). */
  readonly stats: { readonly heard: number };
  outputs(o: SpeakerOutputs): SpeakerOutputs;
}

/** v2's random kick, deterministic: a hash of n in [0, 1). */
const hash01 = (n: number) => (Math.imul(n + 1, 2654435761) >>> 0) / 4294967296;

export function createSpeaker(clock: Readonly<Clock>, ledger: Ledger, o: SpeakerOptions): Speaker {
  const g = speakerGeometry(o);
  const K = SPK.kick;
  const LV = SPK.level;
  const items: SpeakerItem[] = [];
  /** Kick times (sim clock), oldest first. */
  const kicks: number[] = [];
  const stats = { heard: 0 };
  let level = 0;
  let peak = 0;
  let peakAt = -9;
  const to: V3 = [g.landX, 0, g.ledge.z];
  const at: V3 = [0, 0, 0];
  const set = (s: SpeakerItem, x: number, y: number, z: number) => {
    s.d[0] = x - s.p[0];
    s.d[1] = y - s.p[1];
    s.d[2] = z - s.p[2];
    s.p[0] = x;
    s.p[1] = y;
    s.p[2] = z;
  };
  const heardAt = (t: number) => {
    stats.heard++;
    kicks.push(t);
    level = Math.min(1, level * 0.5 + 0.6 + hash01(stats.heard) * 0.35);
    if (level >= peak) {
      peak = level;
      peakAt = t;
    }
  };

  const speaker: Speaker = {
    id: o.id,
    origin: o.origin,
    geometry: g,
    // A packet spends ≈ 1 s here; packets come ≥ 1 s apart (one per cradle at the elevator's
    // ≈ 0.8/s): two, plus one of slack.
    pools: { packets: 3 },
    stats,
    canAccept: () => true,
    accept(item, from, v) {
      const onLedge = from[2] <= g.ledge.z + 0.01;
      items.push({
        item,
        fall: onLedge ? null : createFall(from, v, g.ledge.z),
        t0: onLedge ? clock.t : Infinity,
        p: [from[0], from[1], from[2]],
        d: [v[0] * clock.H, v[1] * clock.H, v[2] * clock.H],
        born: clock.t,
      });
    },
    step(h) {
      const t = clock.t;
      for (let i = items.length - 1; i >= 0; i--) {
        const s = items[i]!;
        if (s.born === t) continue;
        if (s.fall) {
          const f = s.fall;
          f.tau += h / f.dur;
          fallAt(f, to, at);
          set(s, at[0], at[1], at[2]);
          if (f.tau >= 1) {
            s.fall = null;
            // Landed during this step: the slide starts at the landing instant.
            s.t0 = t - ((f.tau - 1) * f.dur);
          }
          continue;
        }
        const age = t - s.t0;
        set(s, g.landX + (g.endX - g.landX) * smooth(0, SPK.slide, age), 0, g.ledge.z);
        if (age >= SPK.slide) {
          items.splice(i, 1);
          ledger.consume(s.item);
          heardAt(s.t0 + SPK.slide);
        }
      }
      while (kicks.length > 0 && t - kicks[0]! > K.keep) kicks.shift();
      level *= Math.exp(-h / LV.tau);
      if (t - peakAt > LV.hold) peak *= Math.exp(-h / LV.fall);
    },
    alive: () => items.length,
    status: () => ({ heard: stats.heard, inbound: items.length, level: Number(level.toFixed(3)), peak: Number(peak.toFixed(3)) }),
    outputs(r) {
      const now = clock.t + clock.acc;
      let d = 0;
      for (const k0 of kicks) {
        const s = now - k0;
        if (s >= 0) d += Math.exp(-s / K.tau) * Math.sin(2 * Math.PI * K.hz * s);
      }
      d = Math.min(K.hi, Math.max(K.lo, d)) * K.amp;
      r.cone = d;
      r.cap = d * K.cap;
      const lit = Math.round(level * SPK.leds);
      r.lit = lit;
      r.peak = peak > LV.show ? Math.min(SPK.leds - 1, Math.max(lit, Math.round(peak * SPK.leds) - 1)) : -1;
      return r;
    },
    poses(cb) {
      const k = clock.acc / clock.H;
      for (let i = 0; i < items.length; i++) {
        const s = items[i]!;
        cb(i, s.item, s.p[0] + s.d[0] * k, s.p[1] + s.d[1] * k, s.p[2] + s.d[2] * k, s.item.yaw, 0, 0, 0);
      }
      return items.length;
    },
  };
  return speaker;
}
