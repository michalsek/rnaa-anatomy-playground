// Native machines on a page: the machine-agnostic half of every native painter (PORT-PLAN P3). A machine kind
// (`NativeKind`, e.g. the centrifuge rotor) turns a v2 machine into a `NativeMachine` when FACTORY.define creates it;
// the host gives each machine a painter on every renderer the view creates (a PainterHost), activates them together
// once the GPU figure is on screen, and keeps v2 safe from them.
//
// Lifecycle of one machine:
//   idle     v2 draws its slots (strings → markup path). The first hook call while the host is active takes the
//            slots: the slot source keeps v2's strings only on demand, the renderer gives the slots to the painter.
//   owning   the hook returns true: the native painter draws the machine's slots.
//   failed   any throw in the hook path (model, styles, painter creation, pipeline compile) lands here for good:
//            the error is recorded (`__gpu.errors`), the slots go back to the markup path (their v2 strings are
//            refreshed and parsed again) and the hook returns false, so v2 draws that very frame itself. Other
//            machines are not affected; nothing propagates into v2's tick.
//
// Painters are built at `attach` (before Renderer.compile, so their pipelines are compiled ahead of the first frame,
// never inside v2's tick); a machine created after attach builds its painter right away and takes its slots only
// once that painter's pipelines compiled.
import type { TgpuRoot } from 'typegpu';
import type { PainterHost } from '../core/frame-loop.ts';
import { compilePipelines } from '../core/pipelines.ts';
import type { Renderer } from '../core/renderer.ts';
import type { SlotPainter } from '../core/slots.ts';

/** Where the native slots' markup lives (the DOM slot source). */
export interface NativeSlotOwner {
  /** `slots` are drawn natively: writes are kept for readers only; reading them first calls `refresh`. */
  ownNatively(slots: readonly number[], refresh: () => void): void;
  /** `slots` go back to the markup path: their current strings are parsed and drawn again. */
  disownNatively(slots: readonly number[]): void;
}

export interface NativeHostOptions {
  owner: NativeSlotOwner;
  /** Something a native painter draws changed: draw a frame (folded into the runtime's tick). */
  onChange(): void;
  /** A native machine failed (it fell back to the markup path; the figure keeps running). */
  onError(error: Error): void;
}

/** Turns a v2 machine (`FACTORY.define(id, make)`'s api) into a native machine, or declines (undefined). */
export interface NativeKind<Api> {
  create(id: string, api: Api, host: NativeHost): NativeMachine | undefined;
}

type MachineState = 'idle' | 'owning' | 'failed';

export abstract class NativeMachine {
  /** The fields this machine adds to the v2 machine's `api.gpu` (the injected hook calls them). */
  abstract readonly gpu: object;
  state: MachineState = 'idle';
  error: string | null = null;
  protected painter: SlotPainter | null = null;
  private renderer: Renderer | null = null;
  /** Who drew the slots before this machine took them (the markup path's painter): they go back there on failure. */
  private markupPainter: SlotPainter | null = null;
  /** The painter's pipelines are compiled (built at attach: the renderer compiles them before its first frame). */
  private painterReady = false;
  /** The current renderer gave the slots to this machine's painter. */
  private drawing = false;

  constructor(
    readonly id: string,
    /** Renderer slot indices this machine draws. */
    readonly slots: readonly number[],
    protected readonly host: NativeHost,
  ) {}

  /** This machine's painter for a new renderer. */
  protected abstract createPainter(root: TgpuRoot, renderer: Renderer): SlotPainter;

  /** Writes v2's markup for the state the painter draws into the slots (a reader or the fallback needs strings). */
  abstract refreshMarkup(): void;

  /** Per-machine counters for `frameStats().native.machines`. */
  abstract get stats(): Record<string, unknown>;

  get isDrawing() {
    return this.drawing;
  }

  /**
   * Whether a hook call may draw natively (else v2 draws). A hook's body is guarded as
   * `if (!this.canDraw) return false; try { …; return true; } catch (error) { this.fail(error); return false; }`
   * (written out in each hook: a callback per call would allocate a closure every frame).
   */
  protected get canDraw() {
    return this.state !== 'failed' && this.host.isActive;
  }

  /** Takes the slots on the first native frame; then hands them to the painter whenever it can draw them. */
  protected own(): boolean {
    if (this.state === 'idle') {
      this.state = 'owning';
      this.host.options.owner.ownNatively(this.slots, () => this.refreshMarkup());
    }
    return this.takeSlots();
  }

  /** Stops drawing natively for good: the slots go back to the markup path with v2's strings for the current state. */
  fail(error: unknown) {
    if (this.state === 'failed') return;
    const wasOwning = this.state === 'owning';
    this.state = 'failed';
    const failure = error instanceof Error ? error : new Error(String(error));
    this.error = failure.message;
    this.host.options.onError(new Error(`native ${this.id}: ${failure.message}`));
    if (!wasOwning) return;
    if (this.drawing && this.renderer && this.markupPainter) this.renderer.setSlotPainter(this.markupPainter, this.slots);
    this.drawing = false;
    this.host.options.owner.disownNatively(this.slots);
    this.host.options.onChange();
  }

  /** @internal NativeHost: a new renderer (first start or re-init after device loss). */
  attachTo(root: TgpuRoot, renderer: Renderer, compiledByRenderer: boolean) {
    this.renderer = renderer;
    this.drawing = false;
    this.painterReady = false;
    this.markupPainter = renderer.painterOf(this.slots[0]);
    if (this.state === 'failed') return;
    try {
      const painter = this.createPainter(root, renderer);
      this.painter = painter;
      renderer.addPainter(painter);
      if (compiledByRenderer) this.painterReady = true;
      else compilePipelines(painter.pipelines()).then(() => this.painterCompiled(painter), (error) => this.fail(error));
    } catch (error) {
      this.fail(error);
      return;
    }
    // a machine that already draws natively keeps its slots across device loss: before the first frame of the new
    // renderer, so the markup painter never draws their (stale) strings
    if (this.state === 'owning') this.takeSlots();
  }

  /** @internal NativeHost: the renderer is gone (it disposed the painters itself). */
  detach() {
    this.renderer = null;
    this.painter = null;
    this.markupPainter = null;
    this.painterReady = false;
    this.drawing = false;
  }

  private painterCompiled(painter: SlotPainter) {
    if (painter !== this.painter) return;
    this.painterReady = true;
    if (this.state === 'owning' && this.takeSlots()) this.host.options.onChange();
  }

  /** Gives the slots to the painter of the current renderer; returns whether it just did. */
  private takeSlots(): boolean {
    const { renderer, painter } = this;
    if (this.drawing || !renderer || !painter || !this.painterReady) return false;
    renderer.setSlotPainter(painter, this.slots);
    this.drawing = true;
    return true;
  }
}

export class NativeHost implements PainterHost {
  readonly machines: NativeMachine[] = [];
  private active = false;
  private attached: { root: TgpuRoot; renderer: Renderer } | null = null;

  constructor(
    readonly options: NativeHostOptions,
    private readonly kinds: readonly NativeKind<never>[],
  ) {}

  get isActive() {
    return this.active;
  }

  /**
   * `api.gpu` for v2 machine `id` (every kind that recognizes the machine adds its fields), or undefined. Errors while
   * creating a machine are recorded, and that machine stays on the markup path.
   */
  machineGpu<Api>(id: string, api: Api): object | undefined {
    let gpu: object | undefined;
    for (const kind of this.kinds as readonly NativeKind<Api>[]) {
      let machine: NativeMachine | undefined;
      try {
        machine = kind.create(id, api, this);
      } catch (error) {
        this.options.onError(new Error(`native ${id}: ${error instanceof Error ? error.message : String(error)}`));
        continue;
      }
      if (!machine) continue;
      this.machines.push(machine);
      if (this.attached) machine.attachTo(this.attached.root, this.attached.renderer, false);
      gpu = { ...gpu, ...machine.gpu };
    }
    return gpu;
  }

  /** The GPU figure is on screen: the next hook call of each machine takes its slots. */
  activate() {
    this.active = true;
  }

  /** The GPU path is gone (fallback, dispose): v2 draws every later frame. */
  deactivate() {
    this.active = false;
  }

  attach(root: TgpuRoot, renderer: Renderer) {
    this.attached = { root, renderer };
    for (const machine of this.machines) machine.attachTo(root, renderer, true);
  }

  detach() {
    this.attached = null;
    for (const machine of this.machines) machine.detach();
  }

  /** `frameStats().native`: totals plus one entry per machine. */
  get stats() {
    const machines = this.machines.map((machine) => ({ id: machine.id, state: machine.state, drawing: machine.isDrawing, error: machine.error, ...machine.stats }));
    return {
      // one machine (every page so far): its counters at the top level too, as before multi-machine hosts
      ...(machines.length === 1 ? machines[0] : {}),
      active: this.active,
      drawing: machines.length > 0 && machines.every((machine) => machine.drawing),
      failed: machines.filter((machine) => machine.state === 'failed').length,
      machines,
    };
  }
}
