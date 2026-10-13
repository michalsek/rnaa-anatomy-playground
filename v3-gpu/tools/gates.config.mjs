// Every gate threshold in one place. notes/GATES.md explains each value: where it comes from (the measured floor on
// the M4 Pro / Chrome 155 / apple metal-3 reference machine) and what margin it leaves.
// Pixel measures (tools/diff.mjs compareImages): loosePct = pixelmatch 0.1 with AA pixels excluded, withAAPct = AA
// pixels counted, solidCluster = largest blob of loose differences that survives a 3 × 3 erosion, in device px.

/** M2: static GPU frame vs the v2 static SVG frame (no live slots), per DPR. */
export const STATIC = {
  dprs: [1, 2, 4],
  quickDprs: [2],
  themes: ["dark", "light"],
  limits: {
    1: { loosePct: 0.15, withAAPct: 0.3, solidCluster: 4 },
    2: { loosePct: 0.02, withAAPct: 0.12, solidCluster: 4 },
    4: { loosePct: 0.012, withAAPct: 0.06, solidCluster: 4 },
  },
  /** The synthetic fixture (src/fixture/make-fixture.mjs) vs its own SVG page. */
  fixture: { dprs: [1, 2], limits: { 1: { loosePct: 0.06, withAAPct: 0.18, solidCluster: 4 }, 2: { loosePct: 0.01, withAAPct: 0.09, solidCluster: 4 } } },
};

/** M3: live GPU page vs the v2 SVG page at the same runtime tick (lockstep). */
export const LIVE = {
  dpr: 2,
  themes: ["dark", "light"],
  // Both sides of every phase boundary (node tools/live-gate.mjs timeline: idle → filling 148, spinning up 593, in sync
  // 837, spinning down 1550, filling 1646, spinning up 2058) and the QA-M3 event ticks: pocket entry 236/237, rotor
  // back/front swap 711, tach maximum 762, lamp on 840, release 883/884, fall 913–932, lamp maximum 971, lamp off 1635.
  ticks: [100, 147, 148, 236, 237, 592, 593, 711, 762, 836, 837, 840, 883, 884, 913, 932, 971, 1100, 1549, 1550, 1635, 1645, 1646, 2058],
  quickTicks: [148, 237, 593, 837, 884, 971, 1550],
  /** Two overlapping intake fades (group opacity: multi-drawable groups in offscreen layers). */
  fade: { injectAt: [1234, 1236], ticks: [1236, 1238, 1242, 1250] },
  reduced: { ticks: [60, 600, 1200] },
  /** --full also runs these ticks at DPR 4. */
  highDpr: { dpr: 4, ticks: [700, 971] },
  /** The live frame must sit on the static frame's floor: same limits as STATIC at the same DPR. */
  limits: STATIC.limits,
};

/** Consecutive lockstep frames: popping / z-fighting show up as pixels that flicker on the GPU page only. */
export const MOTION = {
  dpr: 2,
  runs: [
    { theme: "dark", from: 870, count: 60 },
    { theme: "light", from: 700, count: 60 },
  ],
  quickRuns: [{ theme: "dark", from: 870, count: 24 }],
  /** GPU frame-to-frame change / SVG frame-to-frame change (Δ>8 pixels summed over the run). */
  changeRatio: [0.9, 1.1],
  /** Largest area (px, after a 3 × 3 erosion) toggling A→B→A on the GPU page but not on the SVG page, any frame. */
  gpuOnlySolidBlob: 4,
  /** GPU toggles / SVG toggles. */
  flickerRatio: 1.15,
};

/** Edge cases (tools/live-edge.mjs). */
export const EDGE = {
  /** Same page, same tick, same size: a theme switch, a resize storm or a device loss must leave no trace. */
  identicalLoosePct: 0,
  /** Fallback SVG vs the SVG page at the same tick: the same DOM, so equal up to compositing noise. */
  fallbackLoosePct: 0.001,
  /** Lockstep frames delivered while the stage is out of view: the runtime must not tick. */
  hiddenFrames: 30,
  /**
   * User Timing entries allowed after `userTimingTicks` runtime ticks. The GPU page clears its entries every 600 GPU
   * frames (≈ 10 entries per frame, so ≤ ≈ 6,000); a page that never clears passes the limit after ≈ 3,500 ticks.
   */
  userTimingTicks: 4000,
  userTimingEntries: 7000,
  /** A 520 px wide page (resize storm) vs the SVG page: a smaller frame, so AA is a larger share of it. */
  narrowLimits: { loosePct: 0.03, withAAPct: 0.15, solidCluster: 4 },
};

/**
 * Hairline calibration (src/fixture/make-calib.mjs cells): GPU ink / SVG ink per cell, never averaged over angles or
 * offsets. Ink = Σ |luminance − background| over the cell.
 */
export const CALIB = {
  dprs: [1, 2],
  themes: ["dark", "light"],
  quick: { dprs: [2], themes: ["dark"] },
  /**
   * [min, max] GPU / SVG ink per DPR: `default`, overridden by cell kind, optionally by stroke width (dots: radius).
   * Measured on HEAD: DPR 1 lines 0.93–1.17 (widest spread at 0.4 / 0.6 px, 45° and the 2:1 slope), ticks 0.4 px 1.15,
   * dots 0.87–1.06; DPR 2 everything 0.95–1.10.
   */
  limits: {
    1: { default: [0.88, 1.15], line: { 0.4: [0.85, 1.25], 0.6: [0.85, 1.25] }, ticks: { 0.4: [0.9, 1.3] }, dots: { default: [0.8, 1.2] } },
    2: { default: [0.9, 1.15], ticks: { default: [0.9, 1.2] } },
  },
  /** Cells whose SVG ink is below minInk × DPR² (luminance units) are too faint for a stable ratio (3 of 232 at DPR 1). */
  minInk: 200,
};

/** Optional perf smoke: numbers only, never fails the run. */
export const PERF = { width: 1280, dpr: 2, throttles: [1, 4], frames: 300, warmupSeconds: 3 };
