// Lifecycle and frame scheduling of one GPU figure, independent of the platform: the host supplies the device, the
// surface, sizes, colours, a frame callback and the hooks that show / hide the fallback.
//
// Frames: a figure with a live runtime draws exactly once per runtime tick — the host reports the start of each tick
// (`beginRuntimeFrame`), every slot write inside the tick only marks the slot dirty, and the frame is drawn in a
// microtask right after the tick's callback. Anything else that needs a redraw (slot writes from timers, input or other
// animation callbacks, theme or explode changes) calls `request()`: it is folded into the next tick when the runtime is
// running, and drawn in an animation frame of its own otherwise (a canvas resize draws at once: the resized canvas is
// blank until then).
import type { TgpuRoot } from 'typegpu';
import type { PaintResolver, PaintTable, Rgba } from './paint.ts';
import { RollingTimings, TIMING, type Clock, type Profiler } from './profiler.ts';
import { Renderer, type CacheMode, type RenderSurface } from './renderer.ts';
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

export interface GpuViewOptions {
  scene: GpuScene;
  slots: SlotPlacement[];
  paints: PaintTable;
  cache: CacheMode;
  live: LiveParts | null;
  /** Renderer measurement aid (RendererOptions.measureRepeat). */
  measureRepeat?: number;
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
  private root: TgpuRoot | null = null;
  private renderer: Renderer | null = null;
  private painter: LivePainter | null = null;
  private disposed = false;
  private fellBack = false;
  private intentionalLoss = false;
  private frameFailures = 0;
  private gpuErrorsLogged = 0;
  private readyPending = false;
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
  async start(): Promise<boolean> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.init();
        return true;
      } catch (error) {
        if (this.disposed || this.fellBack) return false;
        if (attempt >= MAX_INIT_ATTEMPTS) {
          this.fallback(`no-adapter: ${(error as Error).message}`);
          return false;
        }
        await new Promise((resolve) => setTimeout(resolve, INIT_RETRY_DELAY_MS * 2 ** (attempt - 1)));
      }
    }
  }

  /** The live runtime started a tick: its slot writes belong to this frame, drawn right after the tick's callback. */
  beginRuntimeFrame() {
    this.runtimeTicks++;
    this.inRuntimeFrame = true;
    this.tickStartedAt = this.host.clock.now();
    this.lastTickAt = this.tickStartedAt;
    this.host.profiler.begin(TIMING.liveJs);
    queueMicrotask(() => this.endRuntimeFrame());
  }

  /** A slot changed: inside a tick it is drawn with the tick, otherwise like any other redraw request. */
  slotChanged(slot: number) {
    if (this.inRuntimeFrame) return;
    if (this.renderer) this.options.live?.slotWrittenOutsideFrame(slot);
    this.request();
  }

  /** Something visible changed: draw once, on the next runtime tick or display frame. */
  request() {
    this.needsDraw = true;
    if (this.inRuntimeFrame) return;
    this.scheduleOwnFrame();
  }

  /** The canvas was resized (backing already set by the host): reallocate and redraw at once. */
  resize(size: DeviceSize) {
    this.size = size;
    if (!this.renderer) return;
    this.renderer.resize(size.width, size.height, size.dpr);
    this.draw();
  }

  setShare(share: number) {
    this.share = share;
    this.request();
  }

  /** Re-resolves every colour (theme change); slots are rebuilt with the new paint classes. */
  repaint() {
    if (!this.renderer) return;
    try {
      this.options.paints.resolveAll(this.host.resolver);
      this.renderer.setBackground(this.host.background());
      this.renderer.paintsChanged();
      this.options.live?.markAllDirty();
    } catch (error) {
      this.recordError(error, false);
    }
    this.request();
  }

  simulateDeviceLoss() {
    if (!this.root) return;
    this.intentionalLoss = true;
    this.root.device.destroy();
  }

  /** Records an error (`fatal` also sets `error`, the reason the figure stopped or misbehaves). */
  recordError(error: unknown, fatal: boolean) {
    const message = error instanceof Error ? error.message : String(error);
    this.errors.push(message);
    if (this.errors.length > ERROR_LOG_LIMIT) this.errors.shift();
    if (fatal) this.error = message;
  }

  dispose() {
    this.disposed = true;
    this.options.live?.detach();
    this.renderer?.dispose();
    this.renderer = null;
    this.painter = null;
    this.root?.destroy();
    this.root = null;
  }

  // ---- internals ------------------------------------------------------------------------------------------------------

  private async init() {
    const root = await this.host.createRoot();
    if (this.disposed || this.fellBack) {
      root.destroy();
      return;
    }
    const info = root.device.adapterInfo;
    this.adapterInfo = { vendor: info.vendor, architecture: info.architecture, description: info.description, features: [...root.enabledFeatures] };
    root.device.addEventListener('uncapturederror', (event) => {
      const { message } = (event as GPUUncapturedErrorEvent).error;
      // WebGPU validation errors are bugs: reported on the console (the first few) and kept in `errors`
      if (this.gpuErrorsLogged++ < GPU_ERRORS_LOGGED) console.error(`WebGPU: ${message}`);
      this.recordError(message, false);
    });
    root.device.lost.then((lost) => this.onDeviceLost(root, lost));
    const { scene, slots, paints, cache, live } = this.options;
    paints.resolveAll(this.host.resolver);
    const renderer = new Renderer(root, {
      surface: this.host.createSurface(root),
      scene,
      slots: live ? slots : [],
      paints,
      cache,
      clock: this.host.clock,
      profiler: this.host.profiler,
      measureRepeat: this.options.measureRepeat,
      onGpuTime: (ms, rebuilt) => (rebuilt ? this.timings.gpuCacheRebuild : this.timings.gpu).push(ms),
    });
    await renderer.compile();
    if (this.disposed || this.fellBack) {
      renderer.dispose();
      root.destroy();
      return;
    }
    this.root = root;
    this.renderer = renderer;
    this.painter = live ? live.attach(root, renderer) : null;
    renderer.setBackground(this.host.background());
    if (this.size.width) renderer.resize(this.size.width, this.size.height, this.size.dpr);
    this.draw();
  }

  private onDeviceLost(root: TgpuRoot, lost: GPUDeviceLostInfo) {
    if (root !== this.root || this.disposed) return;
    this.renderer?.dispose();
    this.renderer = null;
    this.painter = null;
    this.root = null;
    this.options.live?.detach();
    if (lost.reason === 'destroyed' && !this.intentionalLoss) return;
    this.intentionalLoss = false;
    if (++this.reinits > MAX_REINITS) {
      this.fallback(`device-lost: re-initialized ${MAX_REINITS} times`);
      return;
    }
    this.start().catch((error) => this.fallback(`reinit-failed: ${(error as Error).message}`));
  }

  private fallback(reason: string) {
    if (this.fellBack) return;
    this.fellBack = true;
    this.error = reason;
    this.renderer?.dispose();
    this.renderer = null;
    this.options.live?.detach();
    this.root?.destroy();
    this.root = null;
    this.host.onFallback(reason);
  }

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
    if (!renderer) return;
    try {
      this.options.live?.flush();
      renderer.render(this.share);
      this.frameFailures = 0;
    } catch (error) {
      this.recordError(error, false);
      if (++this.frameFailures >= MAX_FRAME_FAILURES) this.fallback(`render-error: ${(error as Error).message}`);
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
    if (this.readyPending || !root) return;
    this.readyPending = true;
    root.device.queue.onSubmittedWorkDone().then(
      () => {
        this.readyPending = false;
        if (this.ready || root !== this.root || this.fellBack) return;
        this.ready = true;
        this.host.onReady();
      },
      () => {
        this.readyPending = false;
      },
    );
  }
}
