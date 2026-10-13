// The native centrifuge rotor: a native machine kind (native-host.ts) for every v2 machine whose slots include
// rotorBack, rotorFront, spout and fall. Its hook is the line tools/build.mjs injects into v2's drawRotor
// (rotor-contract.ts); its CPU model mirrors drawRotor (rotor-model.ts) and its painter expands the model on the GPU
// (rotor-painter.ts). The machine-agnostic lifecycle — activation, slot ownership, error containment, painters per
// renderer — lives in NativeMachine.
import type { TgpuRoot } from 'typegpu';
import type { ChainNode, PaintResolver, PaintTable } from '../core/paint.ts';
import { RollingTimings, type Clock } from '../core/profiler.ts';
import type { Renderer } from '../core/renderer.ts';
import type { Projection } from './kit-mirror.ts';
import { NativeMachine, type NativeHost, type NativeKind } from './native-host.ts';
import { V2_PACKET_KINDS, type MachineGpu, type RotorData, type RotorItem, type RotorPoseOf, type RotorRelease } from './rotor-contract.ts';
import { ROTOR_SLOTS, RotorModel } from './rotor-model.ts';
import { RotorPainter, type RotorExpansion } from './rotor-painter.ts';
import { RotorStyles } from './rotor-styles.ts';

export interface RotorKindOptions {
  paints: PaintTable;
  resolver: PaintResolver;
  /** Probe ancestors of slot content (the live builder's chain): paint keys equal the markup path's. */
  slotChain: ChainNode[];
  /** Renderer slot names (`machine:slot`), in renderer slot order. */
  slotNames: readonly string[];
  /** Item index of slot 0's pseudo-item (the scene's item count). */
  itemBase: number;
  clock: Clock;
  /** Where parts become records (RotorPainter): the compute pass, or the CPU (`?native=cpu`, evaluation). */
  expansion?: RotorExpansion;
}

/** The machine api fields the native rotor reads (FACTORY.define's api). */
export interface MachineApi {
  data: unknown;
  P: Projection;
}

/** The rotor kind: one RotorMachine per v2 machine that has the four rotor slots. */
export const rotorKind = (options: RotorKindOptions): NativeKind<MachineApi> => ({
  create(id, api, host) {
    const slots = ROTOR_SLOTS.map((name) => options.slotNames.indexOf(`${id}:${name}`));
    if (slots.some((slot) => slot < 0)) return undefined;
    return new RotorMachine(id, slots, host, api, options);
  },
});

/** The guards drawRotor's data must pass (a renamed v2 field fails at define time, not as NaN geometry). */
function assertRotorData(data: unknown): asserts data is RotorData {
  const d = data as Partial<RotorData> | null;
  const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
  const ok = !!d && Number.isInteger(d.pockets) && (d.pockets ?? 0) > 0
    && Array.isArray(d.centre) && finite(d.centre[0]) && finite(d.centre[1])
    && Array.isArray(d.toward) && finite(d.toward[0]) && finite(d.toward[1])
    && !!d.r && finite(d.r.vaneIn) && finite(d.r.vaneOut) && finite(d.r.pocket)
    && !!d.z && finite(d.z.pocket) && finite(d.z.vane) && finite(d.z.packet);
  if (!ok) throw new Error('api.data lacks the fields drawRotor reads (pockets, centre, toward, r.vaneIn/vaneOut/pocket, z.pocket/vane/packet)');
}

export class RotorMachine extends NativeMachine {
  readonly gpu: MachineGpu;
  readonly counters = { calls: 0, changedFrames: 0, markupRefreshes: 0 };
  readonly timings = { model: new RollingTimings() };
  private readonly styles: RotorStyles;
  private readonly model: RotorModel;
  private readonly projection: Projection;
  private rotorPainter: RotorPainter | null = null;
  private bypass = false;
  private redraw: ((now: number) => void) | null = null;
  private lastNow = 0;
  private markupStale = false;

  constructor(id: string, slots: readonly number[], host: NativeHost, api: MachineApi, private readonly options: RotorKindOptions) {
    super(id, slots, host);
    assertRotorData(api.data);
    this.projection = api.P;
    // v2's packet kinds are registered now: a template that does not match its markup fails here, at define time
    this.styles = new RotorStyles(options.paints, options.slotChain, V2_PACKET_KINDS);
    this.model = new RotorModel(api.data, api.P, slots.map((slot) => options.itemBase + slot), (kind) => this.styles.styleOf(kind), () => this.styles.maxHalfWidth);
    this.gpu = { rotor: (angle, pockets, releasing, now, poseOf, redraw) => this.rotor(angle, pockets, releasing, now, poseOf, redraw) };
  }

  get stats() {
    return {
      parts: this.model.partCount,
      ...this.counters,
      gpu: this.rotorPainter ? { ...this.rotorPainter.stats } : null,
      ms: { model: this.timings.model.summary() },
    };
  }

  /** Debug / tooling: this frame's GPU-expanded records, the model's slot ranges and the rotor's hull paints. */
  async readback() {
    const painter = this.rotorPainter;
    if (!painter || !this.isDrawing) return null;
    const records = await painter.readback();
    if (!records) return null;
    const { itemBase } = this.options;
    return { ...records, slots: this.model.slots.map((s, i) => ({ slot: this.slots[i], item: itemBase + this.slots[i], ...s, extent: undefined })), hullPaints: this.styles.hullPaints };
  }

  /** v2's slot markup for the state the native painter draws (drawRotor re-run with the hook bypassed). */
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

  protected createPainter(root: TgpuRoot, renderer: Renderer) {
    this.rotorPainter = new RotorPainter(root, renderer.bindings, this.slots, this.model, this.styles, this.projection, this.options.expansion, this.options.clock);
    return this.rotorPainter;
  }

  /** The hook (rotor-contract.ts): true when the native painter draws this frame; never throws into v2's tick. */
  private rotor(angle: number, pockets: readonly (RotorItem | null)[], releasing: readonly RotorRelease[], now: number, poseOf: RotorPoseOf, redraw: (now: number) => void): boolean {
    if (this.bypass || !this.canDraw) return false;
    try {
      this.drawFrame(angle, pockets, releasing, now, poseOf, redraw);
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    }
  }

  private drawFrame(angle: number, pockets: readonly (RotorItem | null)[], releasing: readonly RotorRelease[], now: number, poseOf: RotorPoseOf, redraw: (now: number) => void) {
    const { clock, paints, resolver } = this.options;
    const t0 = clock.now();
    this.counters.calls++;
    this.redraw = redraw;
    this.lastNow = now;
    const changed = this.model.update(angle, pockets, releasing, now, poseOf);
    // a packet kind seen for the first time registered its paints
    if (paints.hasPending) paints.resolvePending(resolver);
    const took = this.own();
    if (changed) {
      this.markupStale = true;
      this.counters.changedFrames++;
      this.rotorPainter?.modelChanged();
    }
    if (changed || took) this.host.options.onChange();
    this.timings.model.push(clock.now() - t0);
  }
}
