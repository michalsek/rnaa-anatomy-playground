// Timing without platform globals: the host injects a Clock (web: the event clock, which tools/lockstep.js does not
// virtualize) and, only when profiling is enabled, a Profiler that mirrors spans into User Timing for bench tooling.

/** Milliseconds on a monotonic real-time clock. */
export interface Clock {
  now(): number;
}

/** Named spans for external tooling; the default records nothing. */
export interface Profiler {
  begin(span: TimingSpan): void;
  end(span: TimingSpan): void;
}

/**
 * The spans the renderer reports (bench/preload/gpu-timing.js sums the User Timing measures of these names):
 * live-js = the runtime's tick (simulation + slot writes), adapter-parse = slot markup → geometry,
 * adapter-upload = slot buffer writes, gpu-encode = frame encoding + submit.
 */
export const TIMING = { liveJs: 'live-js', parse: 'adapter-parse', upload: 'adapter-upload', encode: 'gpu-encode' } as const;
export type TimingSpan = (typeof TIMING)[keyof typeof TIMING];

export const NO_PROFILER: Profiler = { begin() {}, end() {} };

/** Rolling window of the last `size` samples (ms). */
export class RollingTimings {
  private readonly values: Float64Array;
  private readonly sorted: Float64Array;
  private count = 0;

  constructor(size = 600) {
    this.values = new Float64Array(size);
    this.sorted = new Float64Array(size);
  }

  push(value: number) {
    this.values[this.count % this.values.length] = value;
    this.count++;
  }

  summary() {
    const n = Math.min(this.count, this.values.length);
    if (!n) return { n: 0, last: 0, median: 0, p95: 0, mean: 0 };
    const sorted = this.sorted.subarray(0, n);
    sorted.set(this.values.subarray(0, n));
    sorted.sort();
    let sum = 0;
    for (let i = 0; i < n; i++) sum += sorted[i];
    const at = (q: number) => sorted[Math.min(n - 1, Math.floor(q * n))];
    return { n, last: this.values[(this.count - 1) % this.values.length], median: at(0.5), p95: at(0.95), mean: sum / n };
  }
}
