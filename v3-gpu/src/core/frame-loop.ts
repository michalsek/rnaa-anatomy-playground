// Lifecycle and frame scheduling of one GPU figure, independent of the platform: the host supplies the device, the
// surface, sizes, colours, a frame callback and the hooks that show / hide the fallback.
//
// Frames: a figure with a live runtime draws exactly once per runtime tick — the host reports the start of each tick
// (`beginRuntimeFrame`), every slot write inside the tick only marks the slot dirty, and the frame is drawn in a
// microtask right after the tick's callback. Anything else that needs a redraw (slot writes from timers, input or other
// animation callbacks, theme or explode changes) calls `request()`: it is folded into the next tick when the runtime is
// running, and drawn in an animation frame of its own otherwise (a canvas resize draws at once: the resized canvas is
// blank until then).
//
// Lifecycle: `root` is the device being initialised or drawn with, assigned as soon as it exists, so a loss at any
// point after its creation (also while pipelines compile) reaches `onDeviceLost`. Every start takes a generation
// number; an init that a loss, a fallback or `dispose` superseded discards its renderer and device instead of
// installing them. Devices the view destroys itself are no longer current when it does, so every loss the handler
// sees (reason `destroyed` included) comes from outside and is re-initialised (bounded) or falls back.
import type { TgpuRoot } from 'typegpu';
import type { PaintResolver, PaintTable, Rgba } from './paint.ts';
import { RollingTimings, TIMING, type Clock, type Profiler } from './profiler.ts';
import { Renderer, type CacheFault, type CacheMode, type RenderSurface } from './renderer.ts';
import type { GpuScene } from './scene.ts';
import type { SlotPainter, SlotPlacement } from './slots.ts';

/** A failed device re-init is retried this many times (with growing delays) before the figure falls back. */
const MAX_INIT_ATTEMPTS = 3;
const INIT_RETRY_DELAY_MS = 100;
/** Successful re-inits after device loss allowed per page before giving up on the GPU path. */
const MAX_REINITS = 16;
/** Consecutive frames that throw before the figure falls back. */
const MAX_FRAME_FAILURES = 3;
/** Errors kept in `errors` (oldest dropped). */
const ERROR_LOG_LIMIT = 20;
/** WebGPU validation errors echoed to the console per page. */
const GPU_ERRORS_LOGGED = 5;
/** A runtime tick within this many ms counts as "the runtime is running": out-of-tick redraws wait for its next tick. */
const RUNTIME_ACTIVE_MS = 100;

export interface DeviceSize {
  width: number;
  height: number;
  dpr: number;
}

/** What the platform provides. */
export interface GpuHost {
  readonly clock: Clock;
  readonly profiler: Profiler;
  readonly resolver: PaintResolver;
  /** Creates a device root (throws when there is no usable adapter). */
  createRoot(): Promise<TgpuRoot>;
  /** Configures the surface for a new root. */
  createSurface(root: TgpuRoot): RenderSurface;
  /** Schedules `callback` on the next display frame. */
  requestFrame(callback: () => void): void;
  /** Card colour behind the figure (the target is cleared to it). */
  background(): Rgba;
  /** The first frame has been presented (show the canvas). */
  onReady(): void;
  /** The GPU path gave up for good (show the vector fallback). */
  onFallback(reason: string): void;
}

/** A painter of live slots, with the counters the frame loop reports. */
export interface LivePainter extends SlotPainter {
  readonly activeGroups: number;
  readonly stats: Readonly<Record<string, number>>;
}

/** The live slot path as the frame loop drives it (src/live wires the slot source, builder and painter). */
export interface LiveParts {
  /** Whether a slot changed since the last flush. */
  readonly hasDirty: boolean;
  markAllDirty(): void;
  /** Creates the slot painter of a new renderer (first start or a re-init) and re-uploads every slot to it. */
  attach(root: TgpuRoot, renderer: Renderer): LivePainter;
  detach(): void;
  /** Parses and uploads the changed slots. */
  flush(): void;
  /** A slot was written outside a runtime tick (parsed at once, so problems surface at the write). */
  slotWrittenOutsideFrame(slot: number): void;
}

/**
 * Something that contributes slot painters to every renderer the view creates (first start and each re-init after
 * device loss), e.g. a native painter. `attach` runs before the renderer compiles its pipelines, after the live
 * painter was attached (a painter attached here may take slots from it with `renderer.setSlotPainter`).
 */
export interface PainterHost {
  attach(root: TgpuRoot, renderer: Renderer): void;
  /** The renderer is gone (device loss, fallback, dispose); it disposed the painters itself. */
  detach(): void;
}

export interface GpuViewOptions {
  scene: GpuScene;
  slots: SlotPlacement[];
  paints: PaintTable;
  cache: CacheMode;
  live: LiveParts | null;
  /** Painter hosts attached to every renderer after the live path (native slot painters). */
  painters?: PainterHost[];
  /** GPU timestamp queries (RendererOptions.timestamps). */
  timestamps?: boolean;
  /** Renderer measurement aid (RendererOptions.measureRepeat). */
  measureRepeat?: number;
  /** Test hook: a static-cache defect for the identity gate's self-test (RendererOptions.cacheFault). */
  cacheFault?: CacheFault;
}

/** Why an init attempt failed: no device (`no-adapter`) or the renderer / pipelines on a device (`init-failed`). */
class InitFailure extends Error {
  constructor(readonly kind: 'no-adapter' | 'init-failed', cause: unknown) {
    super(`${kind}: ${messageOf(cause)}`);
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `device.adapterInfo` is missing on older Dawn builds (react-native-webgpu). */
function adapterInfoOf(root: TgpuRoot): Record<string, unknown> {
  const info: GPUAdapterInfo | undefined = root.device.adapterInfo;
  return { vendor: info?.vendor ?? 'unknown', architecture: info?.architecture ?? 'unknown', description: info?.description ?? '', features: [...root.enabledFeatures] };
}

export class GpuView {
  ready = false;
  error: string | null = null;
  readonly errors: string[] = [];
  frames = 0;
  reinits = 0;
  share = 0;
  size: DeviceSize = { width: 0, height: 0, dpr: 1 };
  adapterInfo: Record<string, unknown> | null = null;
  readonly timings = { liveJs: new RollingTimings(), encode: new RollingTimings(), encodeWithGroups: new RollingTimings(), gpu: new RollingTimings(), gpuCacheRebuild: new RollingTimings() };
  /** Called after every drawn frame (the web host counts `__gpu.frames` through it). */
  onFrame: () => void = () => {};
  /** The device being initialised or drawn with (null between a loss and the next device). */
  private root: TgpuRoot | null = null;
  private renderer: Renderer | null = null;
  private painter: LivePainter | null = null;
  /** Bumped by every start, loss, fallback and dispose: an init of an older generation discards what it built. */
  private generation = 0;
  private disposed = false;
  private fellBack = false;
  private frameFailures = 0;
  private gpuErrorsLogged = 0;
  /** The device whose first presented frame is awaited (one wait per device). */
  private presentingRoot: TgpuRoot | null = null;
  // scheduling
  private needsDraw = false;
  private inRuntimeFrame = false;
  private runtimeTicks = 0;
  private lastTickAt = -Infinity;
  private tickStartedAt = 0;
  private ownFramePending = false;
  private ownFrameDeferred = false;
  private ticksAtOwnRequest = 0;

  constructor(private readonly host: GpuHost, private readonly options: GpuViewOptions) {}

  get rendererStats() {
    return this.renderer?.stats ?? null;
  }

  /** Slot envelopes of the static cache (null without a renderer). */
  get envelopes() {
    return this.renderer?.envelopes() ?? null;
  }

  get painterStats() {
    return this.painter?.stats ?? null;
  }

  /** Creates the device, renderer and pipelines and draws the first frame; false when the GPU path is unavailable. */
  start(): Promise<boolean> {
    return this.initialize('');
  }

  /** The live runtime started a tick: its slot writes belong to this frame, drawn right after the tick's callback. */
  beginRuntimeFrame() {
    if (this.stopped) return;
    this.runtimeTicks++;
    this.inRuntimeFrame = true;
    this.tickStartedAt = this.host.clock.now();
    this.lastTickAt = this.tickStartedAt;
    this.host.profiler.begin(TIMING.liveJs);
    queueMicrotask(() => this.endRuntimeFrame());
  }

  /** A slot changed: inside a tick it is drawn with the tick, otherwise like any other redraw request. */
  slotChanged(slot: number) {
    if (this.inRuntimeFrame || this.stopped) return;
    if (this.renderer) this.options.live?.slotWrittenOutsideFrame(slot);
    this.request();
  }

  /** Something visible changed: draw once, on the next runtime tick or display frame. */
  request() {
    if (this.stopped) return;
    this.needsDraw = true;
    if (this.inRuntimeFrame) return;
    this.scheduleOwnFrame();
  }

  /**
   * The canvas was resized (backing already set by the host): reallocate and redraw at once. A zero size (a hidden
   * canvas) is ignored: the targets keep the last size until a real one arrives; an unchanged size needs no redraw.
   */
  resize(size: DeviceSize) {
    if (!(size.width >= 1 && size.height >= 1)) return;
    const unchanged = size.width === this.size.width && size.height === this.size.height && size.dpr === this.size.dpr;
    this.size = size;
    if (!this.renderer || unchanged) return;
    this.renderer.resize(size.width, size.height, size.dpr);
    this.draw();
  }

  setShare(share: number) {
    this.share = share;
    this.request();
  }

  /** Re-resolves every colour (theme change); the renderer sees the changed paints, slots are rebuilt with them. */
  repaint() {
    if (!this.renderer) return;
    try {
      this.options.paints.resolveAll(this.host.resolver);
      this.renderer.setBackground(this.host.background());
      this.options.live?.markAllDirty();
    } catch (error) {
      this.recordError(error, false);
    }
    this.request();
  }

  /** Destroys the current device (also while it is being initialised): the view reacts as to any device loss. */
  simulateDeviceLoss() {
    this.root?.device.destroy();
  }

  /** Records an error (`fatal` also sets `error`, the reason the figure stopped or misbehaves). */
  recordError(error: unknown, fatal: boolean) {
    const message = messageOf(error);
    this.errors.push(message);
    if (this.errors.length > ERROR_LOG_LIMIT) this.errors.shift();
    if (fatal) this.error = message;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.detachPainters();
    this.releaseDevice();
  }

  // ---- lifecycle ------------------------------------------------------------------------------------------------------

  private get stopped() {
    return this.disposed || this.fellBack;
  }

  private superseded(generation: number) {
    return generation !== this.generation || this.stopped;
  }

  /** Initialises a device, retrying with growing delays; falls back with `reasonPrefix` + the last failure. */
  private async initialize(reasonPrefix: string): Promise<boolean> {
    const generation = ++this.generation;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.init(generation);
      } catch (error) {
        if (this.superseded(generation)) return false;
        if (attempt >= MAX_INIT_ATTEMPTS) {
          this.fallback(`${reasonPrefix}${error instanceof InitFailure ? error.message : `init-failed: ${messageOf(error)}`}`);
          return false;
        }
        await delay(INIT_RETRY_DELAY_MS * 2 ** (attempt - 1));
        if (this.superseded(generation)) return false;
      }
    }
  }

  /** One init attempt: true when its renderer drew (or will draw once sized), false when superseded. */
  private async init(generation: number): Promise<boolean> {
    let root: TgpuRoot;
    try {
      root = await this.host.createRoot();
    } catch (error) {
      throw new InitFailure('no-adapter', error);
    }
    if (this.superseded(generation)) {
      root.destroy();
      return false;
    }
    this.root = root;
    this.adapterInfo = adapterInfoOf(root);
    root.device.addEventListener('uncapturederror', (event) => this.onGpuError(root, (event as GPUUncapturedErrorEvent).error.message));
    root.device.lost.then((lost) => this.onDeviceLost(root, lost));
    const { scene, slots, paints, cache, live, painters = [] } = this.options;
    let renderer: Renderer | null = null;
    let painter: LivePainter | null = null;
    try {
      paints.resolveAll(this.host.resolver);
      renderer = new Renderer(root, {
        surface: this.host.createSurface(root),
        scene,
        slots: live ? slots : [],
        paints,
        cache,
        clock: this.host.clock,
        profiler: this.host.profiler,
        measureRepeat: this.options.measureRepeat,
        timestamps: this.options.timestamps,
        cacheFault: this.options.cacheFault,
        onGpuTime: (ms, rebuilt) => (rebuilt ? this.timings.gpuCacheRebuild : this.timings.gpu).push(ms),
      });
      // every painter is attached before compile(), so its pipelines are compiled ahead of the first frame too
      painter = live ? live.attach(root, renderer) : null;
      for (const host of painters) host.attach(root, renderer);
      await renderer.compile();
    } catch (error) {
      // lost meanwhile: the loss handler already detached the painters and started the next init
      const lost = this.superseded(generation) || this.root !== root;
      this.discard(root, renderer, !lost);
      if (lost) return false;
      throw new InitFailure('init-failed', error);
    }
    if (this.superseded(generation) || this.root !== root) {
      this.discard(root, renderer, false);
      return false;
    }
    this.renderer = renderer;
    this.painter = painter;
    renderer.setBackground(this.host.background());
    if (this.size.width) renderer.resize(this.size.width, this.size.height, this.size.dpr);
    this.draw();
    return true;
  }

  /** Throws away an init's renderer and device (`detach`: the painter hosts were attached to that renderer). */
  private discard(root: TgpuRoot, renderer: Renderer | null, detach: boolean) {
    if (detach) this.detachPainters();
    renderer?.dispose();
    if (this.root === root) this.root = null;
    root.destroy();
  }

  private onDeviceLost(root: TgpuRoot, lost: GPUDeviceLostInfo) {
    if (root !== this.root || this.stopped) return;
    this.recordError(`device lost (${lost.reason}): ${lost.message}`, false);
    this.generation++;
    this.detachPainters();
    this.releaseDevice();
    if (this.reinits >= MAX_REINITS) {
      this.fallback(`device-lost: lost again after ${MAX_REINITS} re-inits`);
      return;
    }
    this.reinits++;
    void this.initialize('reinit-failed: ');
  }

  /** A WebGPU validation error: reported, and the static cache (whose content is now unknown) is redone. */
  private onGpuError(root: TgpuRoot, message: string) {
    if (root !== this.root) return;
    // validation errors are bugs: reported on the console (the first few) and kept in `errors`
    if (this.gpuErrorsLogged++ < GPU_ERRORS_LOGGED) console.error(`WebGPU: ${message}`);
    this.recordError(message, false);
    this.renderer?.invalidate('gpu error');
  }

  private fallback(reason: string) {
    if (this.fellBack) return;
    this.fellBack = true;
    this.generation++;
    this.error = reason;
    this.detachPainters();
    this.releaseDevice();
    this.host.onFallback(reason);
  }

  /** Disposes the renderer and destroys the device; the device is no longer current when it is destroyed. */
  private releaseDevice() {
    this.renderer?.dispose();
    this.renderer = null;
    this.painter = null;
    const root = this.root;
    this.root = null;
    root?.destroy();
  }

  private detachPainters() {
    this.options.live?.detach();
    for (const host of this.options.painters ?? []) host.detach();
  }

  // ---- scheduling -----------------------------------------------------------------------------------------------------

  private endRuntimeFrame() {
    this.inRuntimeFrame = false;
    this.timings.liveJs.push(this.host.clock.now() - this.tickStartedAt);
    this.host.profiler.end(TIMING.liveJs);
    if (this.needsDraw || this.options.live?.hasDirty) this.draw();
  }

  private scheduleOwnFrame() {
    if (this.ownFramePending) return;
    this.ownFramePending = true;
    this.ownFrameDeferred = false;
    this.ticksAtOwnRequest = this.runtimeTicks;
    this.host.requestFrame(() => this.onOwnFrame());
  }

  private onOwnFrame() {
    this.ownFramePending = false;
    if (!this.needsDraw && !this.options.live?.hasDirty) return;
    if (this.runtimeTicks !== this.ticksAtOwnRequest) {
      // the runtime ticked meanwhile and drew everything that was pending at the end of its tick
      if (this.needsDraw || this.options.live?.hasDirty) this.scheduleOwnFrame();
      return;
    }
    const runtimeRunning = this.host.clock.now() - this.lastTickAt < RUNTIME_ACTIVE_MS;
    if (runtimeRunning && !this.ownFrameDeferred) {
      // its callback may still come later in this display frame: give it one frame before drawing here
      this.ownFramePending = true;
      this.ownFrameDeferred = true;
      this.host.requestFrame(() => this.onOwnFrame());
      return;
    }
    this.draw();
  }

  private draw() {
    this.needsDraw = false;
    const renderer = this.renderer;
    if (!renderer || this.stopped) return;
    let drew: boolean;
    try {
      this.options.live?.flush();
      drew = renderer.render(this.share);
      this.frameFailures = 0;
    } catch (error) {
      this.recordError(error, false);
      if (++this.frameFailures >= MAX_FRAME_FAILURES) this.fallback(`render-error: ${messageOf(error)}`);
      return;
    }
    if (!drew) {
      // no size yet: drawn once the host reports one
      this.needsDraw = true;
      return;
    }
    const stats = renderer.stats;
    this.timings.encode.push(stats.lastEncodeMs);
    if (this.painter?.activeGroups) this.timings.encodeWithGroups.push(stats.lastEncodeMs);
    this.frames++;
    this.onFrame();
    if (!this.ready) this.awaitPresented();
  }

  private awaitPresented() {
    const root = this.root;
    if (!root || this.presentingRoot === root) return;
    this.presentingRoot = root;
    const settled = () => {
      if (this.presentingRoot === root) this.presentingRoot = null;
    };
    root.device.queue.onSubmittedWorkDone().then(
      () => {
        settled();
        if (this.ready || root !== this.root || this.stopped) return;
        this.ready = true;
        this.host.onReady();
      },
      settled,
    );
  }
}
