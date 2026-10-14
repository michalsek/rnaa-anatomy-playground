/**
 * The phone's fluff dispenser (v2 `parts/screen/phone.mjs` L231–274, LIVE L333–447): it hangs
 * under the floating display on a drop pipe. A "tap" on the screen sends a burst of 2–3 beads
 * down the neck into the sight cage, where they fall onto each other at a bead pitch; the star
 * valve takes the bottom one (its rotor turns a sixth), lets it go after 0.28 s, and it falls
 * through the knurled nozzle. The moment it clears the tip it is handed on, still falling with
 * the speed it has gained (belt A takes it from there).
 *
 * The timing is the bead source's (`RATES.beads`, the same hash streams as `createBeadSource`,
 * so the line and the factory feed belt A alike). Queued beads are not items yet (v2: an item is
 * made at the valve); a bead is an item from the valve to the hand-on. Plain TS, no randomness.
 * Local frame: the phone's (the case floor's centre; z up), so `origin` is normally [0, 0, 0].
 */
import type { Clock } from './clock.ts';
import { FALL_G } from './fall.ts';
import { type Item, type Ledger, sizeOf } from './items.ts';
import { hash01 } from './math.ts';
import { type OutPort, type V3, createOut } from './ports.ts';
import { RATES } from './rates.ts';
import type { BeadSource } from './source.ts';

/** Bead radius, the queue pitch (a bead plus 0.3: v2's BEAD·2 + 0.3 with v4's bead). */
const R = sizeOf('fluff').w / 2;
const PITCH = 2 * R + 0.3;
/** The valve holds a released bead this long before it drops (v2: 0.28 s). */
const WAIT = 0.28;
/** The rotor eases to its target with this time constant (v2: 0.1 s). */
const ROTOR_TAU = 0.1;
/** The screen's logo turns this fast (rad/s, v2: 0.32). */
const SPIN = 0.32;

/** The dispenser's parts along z, from the display's underside and the neck (v2 phone.mjs). */
export interface DispenserGeometry {
  /** Mounting plate z0..z1 (24 × 24, r 2), neck z0..z1 (r 3.4). */
  plate: [number, number];
  neck: [number, number];
  /** Collars (r 5.4) above and below the sight cage. */
  collarTop: [number, number];
  collarBottom: [number, number];
  /** The sight cage (r 3.8) the queued beads show through. */
  tube: [number, number];
  /** The valve box (±7 × ±6 about the axis), its centre (sight glass on +y, motor on +x). */
  valve: [number, number];
  valveMid: number;
  /** Where a released bead starts (the valve's floor + 1) and the nozzle's tip (the hand-on). */
  valveZ: number;
  tipZ: number;
}

export function dispenserGeometry(o: { displayZ: number; neck: number }): DispenserGeometry {
  const DZ = o.displayZ;
  const plate0 = DZ - 2.4;
  const neck0 = plate0 - o.neck;
  const tube: [number, number] = [neck0 - 23.6, neck0 - 3];
  const valve: [number, number] = [tube[0] - 14, tube[0] - 3];
  return {
    plate: [plate0, DZ],
    neck: [neck0, plate0],
    collarTop: [tube[1], neck0],
    collarBottom: [tube[0] - 3, tube[0]],
    tube,
    valve,
    valveMid: (valve[0] + valve[1]) / 2,
    valveZ: valve[0] + 1,
    tipZ: valve[0] - 11,
  };
}

export interface DispenserOptions {
  id: string;
  /** The phone's frame in world (normally [0, 0, 0]). */
  origin: V3;
  /** The dispenser's axis (plan, local). */
  at: readonly [number, number];
  geometry: DispenserGeometry;
  /** Offsets the hash streams (the timing changes with the seed; the defaults are seed 0). */
  seed?: number;
  /** Beads the tube and the neck hold (a burst only fills the room left; M9's bead source: 8). */
  tube?: number;
}

/** Live poses the blocks need besides the beads. */
export interface DispenserOutputs {
  /** The valve's rotor angle (rad), the screen logo's turn (rad), seconds since the last tap. */
  rotor: number;
  spin: number;
  tap: number;
}

export interface Dispenser extends BeadSource {
  readonly geometry: DispenserGeometry;
  readonly at: readonly [number, number];
  /** Bead pool size the blocks need: the queue plus the beads between the valve and the tip. */
  readonly pools: { readonly beads: number };
  /** Beads (bottom centre, local) at t + acc; `key` is stable per bead; returns the count. */
  beads(cb: (i: number, x: number, y: number, z: number, key: number) => void): number;
  outputs(o: DispenserOutputs): DispenserOutputs;
}

export function dispenserOutputs(): DispenserOutputs {
  return { rotor: 0, spin: 0, tap: 9 };
}

interface Bead {
  key: number;
  /** Bottom z, vertical speed (down +), its change last step (extrapolation). */
  z: number;
  v: number;
  dz: number;
  /** Below the valve: the item, and the time it still waits in the valve. */
  item: Item | null;
  wait: number;
}

export function createDispenser(clock: Readonly<Clock>, ledger: Ledger, o: DispenserOptions): Dispenser {
  const B = RATES.beads;
  const g = o.geometry;
  const tube = o.tube ?? 8;
  const seed = o.seed ?? 0;
  const [ax, ay] = o.at;
  const pick = (range: readonly [number, number], k: number) => range[0] + (range[1] - range[0]) * hash01(k);
  let nextBurst = B.firstBurst;
  let nextRelease = B.firstRelease;
  let bursts = 0;
  let releases = 0;
  let made = 0;
  let keys = 0;
  let rotor = 0;
  let rotorTarget = 0;
  let lastTap = -9;
  /** Beads above the valve (bottom first) and between the valve and the tip. */
  const queue: Bead[] = [];
  const spout: Bead[] = [];
  const out = createOut(o, 'out', { asks: true });
  /** The lead to ask with: the valve's wait plus the drop through the nozzle. */
  const drop = g.valveZ - (g.tipZ - 2 * R);
  const lead = WAIT + Math.sqrt((2 * drop) / FALL_G);
  const from: V3 = [ax, ay, g.tipZ];
  const at: V3 = [0, 0, 0];
  const v: V3 = [0, 0, 0];
  const fall = (b: Bead, h: number, rest: number) => {
    const z0 = b.z;
    b.v += FALL_G * h;
    b.z = Math.max(rest, b.z - b.v * h);
    if (b.z === rest) b.v = 0;
    b.dz = b.z - z0;
  };

  const d: Dispenser = {
    id: o.id,
    origin: o.origin,
    outs: { out },
    from,
    geometry: g,
    at: o.at,
    pools: { beads: tube + 2 },
    get made() {
      return made;
    },
    get queued() {
      return queue.length;
    },
    step(h) {
      const t = clock.t;
      // A tap sends a burst down the neck (it spawns inside the neck, out of sight, above the queue).
      if (t >= nextBurst) {
        const k = 1000 * seed + 2 * bursts++;
        nextBurst = t + pick(B.burstEvery, k);
        const n = Math.min(tube - queue.length, B.burst[0] + Math.floor(hash01(k + 1) * (B.burst[1] - B.burst[0] + 1)));
        if (n > 0) {
          lastTap = t;
          const top = Math.max(g.neck[0] + 2 * PITCH, g.tube[0] + queue.length * PITCH);
          for (let i = 0; i < n; i++) queue.push({ key: ++keys, z: top + i * PITCH, v: 0, dz: 0, item: null, wait: 0 });
        }
      }
      // Beads fall onto the one below (or the valve), never closer than a pitch above it.
      for (let i = 0; i < queue.length; i++) {
        const b = queue[i]!;
        const z0 = b.z;
        fall(b, h, g.tube[0] + i * PITCH);
        const below = queue[i - 1];
        if (below && b.z < below.z + PITCH) {
          b.z = below.z + PITCH;
          b.v = below.v;
          b.dz = b.z - z0;
        }
      }
      // The star valve takes the bottom bead once it rests on it (one pocket per bead).
      const bottom = queue[0];
      if (bottom && t >= nextRelease && bottom.z <= g.tube[0] + 0.01 && out.ready(lead)) {
        nextRelease = t + pick(B.release, 1000 * seed + 500 + releases++);
        queue.shift();
        rotorTarget += Math.PI / 3;
        made++;
        // It moves into the valve box out of sight (a new key: the jump is hidden).
        spout.push({ key: ++keys, z: g.valveZ, v: 0, dz: 0, item: ledger.make('fluff'), wait: WAIT });
      }
      rotor += (rotorTarget - rotor) * (1 - Math.exp(-h / ROTOR_TAU));
      // Then it drops through the nozzle; the moment it clears the tip it is handed on, still falling.
      for (let i = spout.length - 1; i >= 0; i--) {
        const b = spout[i]!;
        if (b.wait > 0) {
          b.wait -= h;
          b.dz = 0;
          continue;
        }
        fall(b, h, -Infinity);
        if (b.z + 2 * R < g.tipZ) {
          spout.splice(i, 1);
          at[0] = ax;
          at[1] = ay;
          at[2] = b.z;
          v[2] = -b.v;
          out.send(b.item!, at, v);
        }
      }
    },
    alive: () => spout.length,
    status: () => ({ made, queued: queue.length, spout: spout.length, rotor: Number(rotor.toFixed(3)) }),
    beads(cb) {
      const k = clock.acc / clock.H;
      let n = 0;
      for (const b of queue) cb(n++, ax, ay, b.z + b.dz * k, b.key);
      for (const b of spout) cb(n++, ax, ay, b.z + b.dz * k, b.key);
      return n;
    },
    outputs(r) {
      r.rotor = rotor;
      r.spin = SPIN * (clock.t + clock.acc);
      r.tap = clock.t - lastTap;
      return r;
    },
  };
  return d;
}
