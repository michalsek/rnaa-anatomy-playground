// window.__gpu: the tool surface of a GPU figure (gates, perf harness, QA). Fields and methods are documented in
// notes/GPU-API.md; additions must stay backward compatible.

export interface GpuApi {
  /** The first GPU frame has been presented and the canvas replaced the vector preview. */
  ready: boolean;
  /** Why the GPU path stopped or misbehaves (fallback reason, dev markup error), else null. */
  error: string | null;
  /** Recent non-fatal errors (WebGPU validation, frame errors), newest last, at most 20. */
  errors: string[];
  adapter: Record<string, unknown> | null;
  /** GPU frames drawn so far (a plain data property: tools redefine it to observe increments). */
  frames: number;
  frameStats(): Record<string, unknown>;
  setShare(share: number): void;
  setTheme(theme: 'light' | 'dark'): void;
  redraw(): void;
  simulateDeviceLoss(): void;
  /**
   * Tears the GPU figure down: observers off, renderer / painters / device released, slots handed back to the DOM, the
   * SVG figure shown (`html[data-gpu=disposed]`).
   */
  dispose(): void;
  /**
   * Dev pages with the native rotor only (tools/native-gate.mjs): the native painter's GPU-expanded records of the
   * current frame, and the records the markup path builds from v2's strings for the same state.
   */
  nativeCheck?: () => Promise<unknown>;
}

declare global {
  interface Window {
    __gpu?: GpuApi;
    /** Set (e.g. by a bench preload) before the page loads: mirror the renderer's timing spans into User Timing. */
    __gpuProfile?: boolean;
    /** Set before the page loads: GPU timestamp queries every frame (as `?gpuTime`). */
    __gpuTimestamps?: boolean;
  }
}

export function createApi(): GpuApi {
  const api: GpuApi = {
    ready: false,
    error: null,
    errors: [],
    adapter: null,
    frames: 0,
    frameStats: () => ({}),
    setShare: () => {},
    setTheme: () => {},
    redraw: () => {},
    simulateDeviceLoss: () => {},
    dispose: () => {},
  };
  // an assignment (not defineProperty): tools may observe it through a window setter
  window.__gpu = api;
  return window.__gpu ?? api;
}
