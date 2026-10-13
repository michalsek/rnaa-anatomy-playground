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
  /**
   * Stroke crossings at stroke-opacity .6: the darkest pixel near a crossing may be at most this many luminance levels
   * darker on the GPU page than on the SVG page. A double blend there is 12–17 levels darker (QA-FIXA D4).
   */
  crossingDarkerLevels: 6,
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

/**
 * M5 native rotor (tools/native-gate.mjs). The native path draws the rotor from unrounded coordinates where the kit
 * writes 0.1-unit rounded path data, so it may move edges by ≤ 0.07 viewBox units against the markup path: AA-level
 * differences only, never a solid blob.
 */
export const NATIVE = {
  /**
   * Native records vs the markup path's for the same state. The kit rounds every point to 0.1 (≤ 0.0707 away), so
   * polylines may be 0.08 apart and a fill's area may differ by 0.08 × its boundary length (one face drawn in the
   * wrong tone moves its whole area, far beyond that).
   */
  contract: { pointTolerance: 0.08, quickTicks: [148, 237, 711, 884, 913] },
  identity: { ticks: [237, 711, 884, 913, 932, 971], quickTicks: [711, 884], loss: [690, 700] },
  compare: {
    ticks: [148, 237, 593, 711, 762, 837, 884, 913, 932, 971, 1550],
    quickTicks: [237, 884],
    dprs: [1, 2, 4],
    cropTicks: [237, 711, 884, 913],
    /** vs SVG: the live (= static) limits per DPR; vs the markup path: no solid blob, loose ≤ half the DPR's live limit. */
    limits: Object.fromEntries(STATIC.dprs.map((dpr) => [dpr, { vsSvg: STATIC.limits[dpr], vsMarkup: { loosePct: STATIC.limits[dpr].loosePct / 2, solidCluster: 4 } }])),
  },
  sheet: { theme: "light", from: 700, count: 60 },
};

/**
 * Static-cache identity (live-gate.mjs identity): a cached frame must equal the page's uncached frame (?cache=0)
 * exactly, 0 px incl. AA. Both pages run the same ticks and the same events in lockstep.
 */
export const IDENTITY = {
  dpr: 2,
  /** Envelope growth ticks are found by a scan of the cached page over [from, to); `growthTicks` of them are compared (t, t + 1). */
  scan: { from: 120, to: 1100 },
  growthTicks: 10,
  quickGrowthTicks: 4,
  /** Applied to both pages while frozen at `tick`; `shots` follow. A device loss restarts the envelopes (re-growth). */
  events: [
    { tick: 1150, kind: "theme", shots: [1151, 1152] },
    { tick: 1170, kind: "resize", width: 900, dpr: 1.5, shots: [1171, 1172] },
    { tick: 1190, kind: "loss", shots: [1191, 1192, 1200, 1230] },
  ],
  configs: [{ theme: "dark", native: "1" }, { theme: "light", native: "1" }, { theme: "dark", native: "0" }],
  quickConfigs: [{ theme: "dark", native: "1" }],
};

/** Optional perf smoke: numbers only, never fails the run. */
export const PERF = { width: 1280, dpr: 2, throttles: [1, 4], frames: 300, warmupSeconds: 3 };

// ---- fix loop C2 (native path): kept in its own block, appended by C2 --------------------------------------------------

/**
 * Native contract, stroke fields (tools/native-gate.mjs contract): the GPU writes joins and crowd in f32, the reference
 * is SegWriter (f64 arithmetic, f32 records) run on the read-back polylines. The GPU recomputes a neighbour's end points
 * per invocation, so they may differ from the stored ones by an f32 ulp (≈ 3e-5 at x ≈ 300); on the packets' 1.3-unit
 * corner segments that tilts a join normal (a sum of two unit vectors) by up to ≈ 2.5e-5 (measured). A tilt of 1e-3
 * moves the ownership boundary by 1e-3 × the half-width (≤ 0.002 device px at DPR 4); a flipped or missing join is
 * ≥ 1. A crowd matters only below the ownership reach (shaders.ts CROWD_REACH_*: ≤ ≈ 2.25 device px at DPR 1, a few
 * viewBox units), so crowds above `crowdIrrelevant` both count as "no crowding".
 */
export const NATIVE_STROKES = { joinTolerance: 1e-3, crowdTolerance: 1e-3, crowdIrrelevant: 10 };

/** Packets of every v2 kind (and two unknown kinds: the style table grows) injected into the native gates' runs. */
export const NATIVE_INJECT = [
  { tick: 60, kinds: ["audio", "garbage"] },
  { tick: 400, kinds: ["fluff", "mystery"] },
  { tick: 1300, kinds: ["unknown-b", "audio"] },
];

/**
 * Error containment: a packet kind the native rotor refuses (not a plain name) fails the machine, not the page. Injected
 * at `injectAt`, it waits in the intake queue (drawn by v2's funnel code) and reaches the rotor between `before` and the
 * first of `ticks`; from then on the page must equal the ?native=0 page.
 */
export const NATIVE_FAULT = { theme: "dark", dpr: 2, injectAt: 200, kind: "bad kind", before: 300, ticks: [600, 711, 884, 932, 1100] };

/**
 * Native gate rows added by fix loop C2 (tools/gates.mjs spreads them: notes/FIXC-COORD.md R2). The contract gate
 * mutates its own read-back records at every tick (crowd, join, width, tone, item, caps) and requires each mutation to
 * be rejected, so it needs no separate self-test row; the identity gate gets one (a 1 CSS px patch).
 */
export const NATIVE_ROWS = [
  { name: "native:fault", modes: ["quick", "full"], args: ["tools/native-gate.mjs", "fault"] },
  { name: "selftest:native:identity", modes: ["full"], expect: "fail", args: ["tools/native-gate.mjs", "identity", "--quick", "--mutate", "patch"] },
];
