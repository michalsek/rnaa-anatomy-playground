// GPU live pages: sum the adapter's User Timing measures (src/main.ts, src/live/adapter.ts, src/renderer.ts) into
// window.__benchStats, so tools/perf.mjs reports them as measurement-window deltas, summed over every frame (iframe).
//   live-js        page rAF callback (runtime tick: simulation + slot innerHTML writes into the skeleton)
//   adapter-parse  slot markup → geometry (strict tokenizer, tessellation, packing)
//   adapter-upload writeBuffer of changed slots
//   gpu-encode     command encoding + submit (renderer.render)
// ms keys are totals (perf.mjs divides the window delta by frames); *N keys count entries.
// Harmless on pages without these measures (counters stay 0).
(() => {
  const stats = (window.__benchStats ??= {});
  const KEYS = { "live-js": "gpuLiveJs", "adapter-parse": "gpuParse", "adapter-upload": "gpuUpload", "gpu-encode": "gpuEncode" };
  for (const key of Object.values(KEYS)) {
    stats[`${key}Ms`] = 0;
    stats[`${key}N`] = 0;
  }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const key = KEYS[e.name];
        if (!key) continue;
        stats[`${key}Ms`] += e.duration;
        stats[`${key}N`]++;
      }
    }).observe({ type: "measure" });
  } catch {}
})();
