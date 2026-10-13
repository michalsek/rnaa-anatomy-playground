// The native rotor as the web host wires it: the hook v2's drawRotor calls (rotor-contract.ts), the CPU model, and a
// RotorPainter for every renderer the view creates (a PainterHost, so device-loss re-inits get one too).
//
// Lifecycle: inactive until `activate()` (the host calls it once the GPU figure is ready, so the vector preview shown
// while WebGPU boots keeps getting v2's strings). The first hook call after that takes over the four slots for good:
// the renderer gives them to the RotorPainter (the live painter releases them) and the slot source keeps v2's strings
// only on demand (`refreshMarkup`: drawRotor re-run with the hook bypassed). `deactivate()` (fallback) hands every
// later frame back to v2.
import type { TgpuRoot } from 'typegpu';
import type { PainterHost } from '../core/frame-loop.ts';
import type { ChainNode, PaintResolver, PaintTable } from '../core/paint.ts';
import { RollingTimings, type Clock } from '../core/profiler.ts';
import type { Renderer } from '../core/renderer.ts';
import type { Projection } from './kit-mirror.ts';
import type { MachineGpu, RotorData, RotorItem, RotorPoseOf, RotorRelease } from './rotor-contract.ts';
import { ROTOR_SLOTS, RotorModel } from './rotor-model.ts';
import { RotorPainter } from './rotor-painter.ts';
import { RotorStyles } from './rotor-styles.ts';

/** Where the native slots' markup lives (the DOM slot source). */
export interface NativeSlotOwner {
  ownNatively(slots: readonly number[], refresh: () => void): void;
}

export interface NativeRotorOptions {
  paints: PaintTable;
  resolver: PaintResolver;
  /** Probe ancestors of slot content (the live builder's chain): paint keys equal the markup path's. */
  slotChain: ChainNode[];
  /** Renderer slot names (`machine:slot`), in renderer slot order. */
  slotNames: readonly string[];
  /** Item index of slot 0's pseudo-item (the scene's item count). */
  itemBase: number;
  owner: NativeSlotOwner;
  clock: Clock;
  /** Something the native painter draws changed: draw a frame (folded into the runtime's tick). */
  onChange(): void;
}

/** The machine api fields the native rotor reads (FACTORY.define's api). */
export interface MachineApi {
  data: unknown;
  P: Projection;
}

export class NativeRotor implements PainterHost {
  readonly counters = { calls: 0, changedFrames: 0, markupRefreshes: 0 };
  readonly timings = { model: new RollingTimings() };
  private readonly styles: RotorStyles;
  private model: RotorModel | null = null;
  private projection: Projection | null = null;
  private slots: number[] = [];
  private renderer: Renderer | null = null;
  private root: TgpuRoot | null = null;
  private painter: RotorPainter | null = null;
  private registered = false;
  private active = false;
  private owning = false;
  private bypass = false;
  private redraw: ((now: number) => void) | null = null;
  private lastNow = 0;
  private markupStale = false;

  constructor(private readonly options: NativeRotorOptions) {
    this.styles = new RotorStyles(options.paints, options.slotChain);
  }

  /** `api.gpu` for machine `id`, or undefined when the figure has no rotor slots of that machine. */
  machineGpu(id: string, api: MachineApi): MachineGpu | undefined {
    const slots = ROTOR_SLOTS.map((name) => this.options.slotNames.indexOf(`${id}:${name}`));
    if (this.model || slots.some((slot) => slot < 0)) return undefined;
    this.slots = slots;
    this.projection = api.P;
    this.model = new RotorModel(api.data as RotorData, api.P, slots.map((slot) => this.options.itemBase + slot), (kind) => this.styles.styleOf(kind), () => this.styles.maxHalfWidth);
    return { rotor: (angle, pockets, releasing, now, poseOf, redraw) => this.rotor(angle, pockets, releasing, now, poseOf, redraw) };
  }

  get isActive() {
    return this.active;
  }

  get stats() {
    return {
      active: this.active,
      drawing: this.registered,
      parts: this.model?.partCount ?? 0,
      ...this.counters,
      gpu: this.painter ? { ...this.painter.stats } : null,
      ms: { model: this.timings.model.summary() },
    };
  }

  /** The GPU figure is on screen: the next hook call takes the rotor slots. */
  activate() {
    this.active = true;
  }

  /** The GPU path is gone (fallback): v2 draws every later frame. */
  deactivate() {
    this.active = false;
  }

  attach(root: TgpuRoot, renderer: Renderer) {
    this.root = root;
    this.renderer = renderer;
    this.registered = false;
    if (this.owning) this.takeSlots();
  }

  detach() {
    this.root = null;
    this.renderer = null;
    this.painter = null;
    this.registered = false;
  }

  /** Debug / tooling: this frame's GPU-expanded records, the model's slot ranges and the rotor's hull paints. */
  async readback() {
    const painter = this.painter;
    const model = this.model;
    if (!painter || !model) return null;
    const records = await painter.readback();
    if (!records) return null;
    return { ...records, slots: model.slots.map((s, i) => ({ slot: this.slots[i], item: this.options.itemBase + this.slots[i], ...s, extent: undefined })), hullPaints: this.styles.hullPaints };
  }

  /** v2's slot markup for the state the native painter draws (written through the slots' setters). */
  refreshMarkup() {
    if (!this.markupStale || !this.redraw) return;
    this.markupStale = false;
    this.counters.markupRefreshes++;
    this.bypass = true;
    try {
      this.redraw(this.lastNow);
    } finally {
      this.bypass = false;
    }
  }

  private rotor(angle: number, pockets: readonly (RotorItem | null)[], releasing: readonly RotorRelease[], now: number, poseOf: RotorPoseOf, redraw: (now: number) => void): boolean {
    if (this.bypass || !this.active || !this.model) return false;
    const { clock, paints, resolver } = this.options;
    const t0 = clock.now();
    this.counters.calls++;
    this.redraw = redraw;
    this.lastNow = now;
    const changed = this.model.update(angle, pockets, releasing, now, poseOf);
    // a packet kind seen for the first time registered its paints
    if (paints.hasPending) paints.resolvePending(resolver);
    if (!this.owning) {
      this.owning = true;
      this.options.owner.ownNatively(this.slots, () => this.refreshMarkup());
    }
    const took = this.takeSlots();
    if (changed) {
      this.markupStale = true;
      this.counters.changedFrames++;
      this.painter?.modelChanged();
    }
    if (changed || took) this.options.onChange();
    this.timings.model.push(clock.now() - t0);
    return true;
  }

  /** Creates this renderer's painter and gives it the rotor slots; returns whether it just did. */
  private takeSlots(): boolean {
    const { renderer, root, model, projection } = this;
    if (this.registered || !renderer || !root || !model || !projection) return false;
    this.painter ??= new RotorPainter(root, renderer.bindings, this.slots, model, this.styles, projection);
    renderer.setSlotPainter(this.painter);
    this.registered = true;
    return true;
  }
}
