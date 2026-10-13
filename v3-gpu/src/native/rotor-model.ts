// CPU side of the native rotor: the state v2's drawRotor reads (rotor-contract.ts) → the prisms it would draw, in the
// slots and painter order it would draw them, packed as RotorPart records for one buffer write. Mirrors v2
// centrifugeLive (parts/centrifuge/centrifuge.mjs: drawRotor, vane, packet, at3, depth) expression for expression, so
// the depth sort and the rotor back / front split are bit-identical; face classification is the kit's (kit-mirror.ts).
// Allocation-free once warm: every scratch array is preallocated and grows only past its capacity.
import type { SlotExtent } from '../core/slots.ts';
import { cameraOf, classifyRing, isoX, isoY, roundedPlan, type Camera, type Projection, type RingClasses } from './kit-mirror.ts';
import type { RotorData, RotorPoseOf, RotorRelease, RotorItem } from './rotor-contract.ts';
import { PART_FLAG, PART_LAYER, PART_RECORD, segSlotsOf, vertexSlotsOf } from './rotor-schemas.ts';

/** The slots drawRotor writes, in the model's slot order. */
export const ROTOR_SLOTS = ['rotorBack', 'rotorFront', 'spout', 'fall'] as const;
const BACK = 0, FRONT = 1, SPOUT = 2, FALL = 3;

// v2 centrifugeLive literals (vane(), packet(), drawRotor())
/** vane(): half thickness of a vane's plan. */
const VANE_HALF_THICKNESS = 0.6;
/** drawRotor(): vanes sort at this radius. */
const VANE_DEPTH_RADIUS = 20.4;
/** drawRotor(): a packet sorts this much in front of its own radius (ahead of the vane at the same depth). */
const PACKET_DEPTH_BIAS = 0.1;
/** packet(): plan, corner steps, top bevel, strap half-length, band height and the height it needs to show. */
const PACKET_PLAN = { x: -5, y: -4, w: 10, d: 8, r: 0.6 };
const PACKET_CORNER_STEPS = 2;
const PACKET_BEVEL = 0.3;
const PACKET_STRAP_HALF = 5;
const BAND_BELOW_TOP = 0.45;
const BAND_MIN_HEIGHT = 0.55;

const VANE_RING_FIRST = 0;
const VANE_RING_COUNT = 4;
const PACKET_RING_FIRST = VANE_RING_FIRST + VANE_RING_COUNT;
const PACKET_RING_COUNT = 12;
const MAX_RING = PACKET_RING_COUNT;

/** Style index of the vane; packet styles follow (rotor-styles.ts). */
export const VANE_STYLE = 0;

export interface RotorFrameSlot {
  /** First part and part count. */
  first: number;
  count: number;
  /** Seg record range of the slot's parts. */
  segFirst: number;
  segCount: number;
  extent: SlotExtent;
  empty: boolean;
}

export class RotorModel {
  /** Part template rings (part-local x, y), the GPU's `ring` table. */
  readonly templates: Float32Array<ArrayBuffer>;
  readonly slots: RotorFrameSlot[] = ROTOR_SLOTS.map(() => ({ first: 0, count: 0, segFirst: 0, segCount: 0, extent: { box: { x0: 0, y0: 0, x1: 0, y1: 0 }, halfWidth: 0 }, empty: true }));
  /** Packed RotorPart records of the current frame (`partCount` of them). */
  records: Uint32Array<ArrayBuffer>;
  partCount = 0;
  segCount = 0;
  vertexCount = 0;
  /** Bumped whenever the packed frame changed. */
  version = 0;

  private readonly N: number;
  private readonly alpha: number;
  private readonly cx: number;
  private readonly cy: number;
  private readonly tx: number;
  private readonly ty: number;
  private readonly data: RotorData;
  private readonly origin: number[];
  private readonly camera: Camera;
  private readonly template64: Float64Array;
  // parts of the frame being built, in v2's push order
  private capacity = 0;
  private style!: Int32Array;
  private packet!: Uint8Array;
  private px!: Float64Array;
  private py!: Float64Array;
  private angle!: Float64Array;
  private z0!: Float64Array;
  private depth!: Float64Array;
  private slotOf!: Uint8Array;
  private order!: Int32Array;
  private collected = 0;
  /** The records being packed (swapped with `records` when they differ), and their f32 views. */
  private next: Uint32Array<ArrayBuffer>;
  private nextF32: Float32Array<ArrayBuffer>;
  private recordsF32: Float32Array<ArrayBuffer>;
  private readonly world = new Float64Array(MAX_RING * 2);
  private readonly classes: RingClasses = { counter: false, facing: 0, seamFacing: 0, shades: 0 };

  /**
   * @param slotItems slot pseudo-item of rotorBack, rotorFront, spout, fall
   * @param styleOf style index of a packet kind (registers it on first sight)
   * @param halfWidthOf widest stroke half-width (CSS px) of the rotor's lines, for the slot extents
   */
  constructor(data: RotorData, projection: Projection, private readonly slotItems: readonly number[], private readonly styleOf: (kind: string) => number, private readonly halfWidthOf: () => number) {
    this.data = data;
    this.N = data.pockets;
    this.alpha = (Math.PI * 2) / this.N;
    [this.cx, this.cy] = data.centre;
    [this.tx, this.ty] = data.toward;
    this.origin = [...projection.origin];
    this.camera = cameraOf(projection);
    const t = VANE_HALF_THICKNESS;
    const vane = [[data.r.vaneIn, -t], [data.r.vaneOut, -t], [data.r.vaneOut, t], [data.r.vaneIn, t]];
    const packet = roundedPlan(PACKET_PLAN, PACKET_CORNER_STEPS);
    if (packet.length !== PACKET_RING_COUNT) throw new Error(`native rotor: packet ring has ${packet.length} points`);
    this.template64 = new Float64Array([...vane, ...packet].flat());
    this.templates = new Float32Array(this.template64);
    this.grow(2 * this.N + 4);
    this.records = new Uint32Array(this.capacity * PART_RECORD.words);
    this.recordsF32 = new Float32Array(this.records.buffer);
    this.next = new Uint32Array(this.capacity * PART_RECORD.words);
    this.nextF32 = new Float32Array(this.next.buffer);
  }

  /** Rebuilds the frame from v2's rotor state; returns whether it differs from the previous frame. */
  update(drawnAngle: number, pockets: readonly (RotorItem | null)[], releasing: readonly RotorRelease[], now: number, poseOf: RotorPoseOf): boolean {
    const D = this.data;
    const { cx, cy, N } = this;
    const ALPHA = this.alpha;
    const PK = D.z.packet;
    this.grow(2 * N + releasing.length);
    this.collected = 0;
    for (let i = 0; i < N; i++) {
      const a = drawnAngle + i * ALPHA;
      this.push(BACK, VANE_STYLE, false, cx, cy, a, D.z.pocket, this.depthAt(VANE_DEPTH_RADIUS, a));
      const item = pockets[i];
      if (item) {
        const pa = drawnAngle + (i + 0.5) * ALPHA;
        this.push(BACK, this.styleOf(item.kind), true, cx + D.r.pocket * Math.cos(pa), cy + D.r.pocket * Math.sin(pa), pa, D.z.pocket, this.depthAt(D.r.pocket, pa) + PACKET_DEPTH_BIAS);
      }
    }
    for (const r of releasing) {
      const q = poseOf(r, now - r.t0);
      const style = this.styleOf(r.item.kind);
      if (q.stage === 'rotor') this.push(BACK, style, true, q.pos[0], q.pos[1], q.a, q.z, this.depthAt(Math.hypot(q.pos[0] - cx, q.pos[1] - cy), q.a) + PACKET_DEPTH_BIAS);
      else this.push(q.stage === 'spout' ? SPOUT : FALL, style, true, q.pos[0], q.pos[1], q.a, q.z, 0);
    }
    const n = this.collected;
    // drawRotor: parts.sort((p, q) => p.d − q.d) (stable), then d < 0 → rotorBack, d ≥ 0 → rotorFront; spout and fall
    // keep the releasing order
    const order = this.order;
    let rotorParts = 0;
    for (let i = 0; i < n; i++) if (this.slotOf[i] === BACK) order[rotorParts++] = i;
    for (let i = 1; i < rotorParts; i++) {
      const key = order[i];
      let j = i - 1;
      while (j >= 0 && this.depth[order[j]] - this.depth[key] > 0) {
        order[j + 1] = order[j];
        j--;
      }
      order[j + 1] = key;
    }
    for (let i = 0; i < rotorParts; i++) if (this.depth[order[i]] >= 0) this.slotOf[order[i]] = FRONT;
    let total = rotorParts;
    for (let i = 0; i < n; i++) if (this.slotOf[i] === SPOUT) order[total++] = i;
    for (let i = 0; i < n; i++) if (this.slotOf[i] === FALL) order[total++] = i;
    return this.pack(total, PK);
  }

  private push(slot: number, style: number, packet: boolean, x: number, y: number, a: number, z0: number, depth: number) {
    const n = this.collected++;
    this.style[n] = style;
    this.packet[n] = packet ? 1 : 0;
    this.px[n] = x;
    this.py[n] = y;
    this.angle[n] = a;
    this.z0[n] = z0;
    this.depth[n] = depth;
    this.slotOf[n] = slot;
  }

  /** v2 depth(r, a): how far toward the viewer a point at radius r, angle a sits. */
  private depthAt(r: number, a: number) {
    return r * (Math.cos(a) * this.tx + Math.sin(a) * this.ty);
  }

  /** Packs the ordered parts into `next`; swaps it in when it differs from the current records. */
  private pack(total: number, PK: number): boolean {
    const D = this.data;
    const u32 = this.next;
    const f32 = this.nextF32;
    const R = PART_RECORD;
    const { origin, camera, world, classes } = this;
    let segs = 0, vertices = 0, part = 0;
    for (let slot = 0; slot < ROTOR_SLOTS.length; slot++) {
      const out = this.slots[slot];
      out.first = part;
      out.segFirst = segs;
      const box = out.extent.box;
      box.x0 = box.y0 = Infinity;
      box.x1 = box.y1 = -Infinity;
      let inSlot = 0;
      for (let k = 0; k < total; k++) {
        const i = this.order[k];
        if (this.slotOf[i] !== slot) continue;
        const packet = this.packet[i] === 1;
        const ringFirst = packet ? PACKET_RING_FIRST : VANE_RING_FIRST;
        const ringCount = packet ? PACKET_RING_COUNT : VANE_RING_COUNT;
        const height = packet ? PK : D.z.vane;
        const z0 = this.z0[i];
        const x = this.px[i], y = this.py[i];
        const ca = Math.cos(this.angle[i]);
        const sa = Math.sin(this.angle[i]);
        // the ring as v2 builds it: [c0 + u·ca − v·sa, c1 + u·sa + v·ca]
        for (let p = 0; p < ringCount; p++) {
          const u = this.template64[(ringFirst + p) * 2];
          const v = this.template64[(ringFirst + p) * 2 + 1];
          const wx = x + u * ca - v * sa;
          const wy = y + u * sa + v * ca;
          world[p * 2] = wx;
          world[p * 2 + 1] = wy;
          const sx = isoX(wx, wy, origin, camera);
          const top = isoY(wx, wy, z0 + height, origin, camera);
          const bottom = isoY(wx, wy, z0, origin, camera);
          if (sx < box.x0) box.x0 = sx;
          if (sx > box.x1) box.x1 = sx;
          if (top < box.y0) box.y0 = top;
          if (bottom > box.y1) box.y1 = bottom;
        }
        classifyRing(world, ringCount, camera, classes);
        const band = packet && height > PK * BAND_MIN_HEIGHT;
        const o = part * R.words;
        f32[o + R.centre] = x;
        f32[o + R.centre + 1] = y;
        f32[o + R.rotation] = ca;
        f32[o + R.rotation + 1] = sa;
        f32[o + R.z0] = z0;
        f32[o + R.height] = height;
        f32[o + R.bandZ] = z0 + height - PK * BAND_BELOW_TOP;
        f32[o + R.bevel] = packet ? PACKET_BEVEL : 0;
        f32[o + R.strap] = packet ? PACKET_STRAP_HALF : 0;
        u32[o + R.ringFirst] = ringFirst;
        u32[o + R.ringCount] = ringCount;
        u32[o + R.flags] = (classes.counter ? PART_FLAG.counter : 0) | (band ? PART_FLAG.band : 0);
        u32[o + R.facing] = classes.facing;
        u32[o + R.seamFacing] = classes.seamFacing;
        u32[o + R.shades] = classes.shades;
        u32[o + R.style] = this.style[i];
        u32[o + R.item] = this.slotItems[slot];
        u32[o + R.layer] = inSlot * PART_LAYER.count;
        u32[o + R.segFirst] = segs;
        u32[o + R.vertexFirst] = vertices;
        segs += segSlotsOf(ringCount);
        vertices += vertexSlotsOf(ringCount);
        part++;
        inSlot++;
      }
      out.count = inSlot;
      out.segCount = segs - out.segFirst;
      out.empty = inSlot === 0;
      out.extent.halfWidth = this.halfWidthOf();
    }
    let changed = part !== this.partCount;
    const words = part * R.words;
    for (let w = 0; !changed && w < words; w++) changed = u32[w] !== this.records[w];
    if (!changed) return false;
    const previous = this.records;
    const previousF32 = this.recordsF32;
    this.records = this.next;
    this.recordsF32 = this.nextF32;
    this.next = previous;
    this.nextF32 = previousF32;
    this.partCount = part;
    this.segCount = segs;
    this.vertexCount = vertices;
    this.version++;
    return true;
  }

  /** Room for `parts` parts (grows the scratch and record arrays past their capacity only). */
  private grow(parts: number) {
    if (parts <= this.capacity) return;
    const capacity = Math.max(parts, Math.ceil(this.capacity * 1.5));
    this.style = new Int32Array(capacity);
    this.packet = new Uint8Array(capacity);
    this.px = new Float64Array(capacity);
    this.py = new Float64Array(capacity);
    this.angle = new Float64Array(capacity);
    this.z0 = new Float64Array(capacity);
    this.depth = new Float64Array(capacity);
    this.slotOf = new Uint8Array(capacity);
    this.order = new Int32Array(capacity);
    if (this.capacity) {
      const records = new Uint32Array(capacity * PART_RECORD.words);
      records.set(this.records);
      this.records = records;
      this.recordsF32 = new Float32Array(records.buffer);
      this.next = new Uint32Array(capacity * PART_RECORD.words);
      this.nextF32 = new Float32Array(this.next.buffer);
    }
    this.capacity = capacity;
  }
}
