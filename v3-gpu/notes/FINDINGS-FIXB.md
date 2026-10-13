# Fix loop B findings (gates + tooling)

See notes/GATES.md for every gate, threshold, measured floor and margin. Runner: `npm run gates` (quick, ≈ 92 s) / `npm run gates:full` (≈ 271 s, incl. self-tests).

## Results on HEAD f2f9289 (git archive build)
unit PASS (28 export + 8 live) · dl PASS · static PASS (DPR2 loose 0.010/0.011 %, no solid blobs) · live PASS (214 checks; runtime state, readout, aria-live equal) · motion PASS (change ratio 0.996/1.022) · edge FAIL (6/43, A1–A5) · calib PASS (per-cell 0.874–1.168 DPR1, 0.954–1.102 DPR2) · determinism PASS (bit-identical 3000 ticks SVG×2, GPU×2, SVG vs GPU; real vs turbo 120 ticks) · 6 self-tests PASS · perf (record only) GPU pass 4.3/7.1 ms, parse 1.0/1.5 ms @1280 DPR2.

## Defects for fix loop A (repro: `node export/export.mjs && node tools/build.mjs && node tools/live-edge.mjs --only <case>`)
- A1 (Medium) loss-no-adapter: device lost after ready + reinit finds no adapter → SVG fallback frozen (rotor slot empty; 0.78 % off). reveal() stops forwarding; showFallback never restarts it (CQ-M3 S2).
- A2 (Low) null-adapter: runtime binds the hidden skeleton → api.el/els null (QA-M3 D4), visible when requestAdapter resolves late.
- A3 (Low) unsupported: dev throws but __gpu.error stays null (QA-M3 D5).
- A4 (Medium, perf) draw-count: real frames draw one GPU frame per slot-write burst — 240 GPU frames for 60 ticks (extra rAF callback + two timers) (CQ-M3 S3).
- A5 (Medium) user-timing: no-WebGPU fallback never clears User Timing — 8000 entries after 4000 ticks (QA-M3 D2).

## Changes
- tools/lockstep.js is the only lockstep: turbo, real (one native rAF per callback), rebase at runtime loop start (FINDINGS-M3 #1), waitReady, step() resolves on idle pages, cancelAnimationFrame works.
- tools/harness.mjs (CDP helpers, tick gate, args); tools/diff.mjs shared image lib, refuses size mismatch, arg parsing fixed.
- live-gate.mjs: gating static/live/motion/determinism/calib + perf/timeline/record/sheet (old names aliased). live-edge.mjs rewritten as a gate (same-run references, condition waits, new cases).
- test-live.mjs on node:test, browser-free, fixture tools/fixtures/live-markup.json (incl. packet fade); covers translucent/blended/invisible paints, group layers, caps, inline width, draw merging, fast-path parser vs exporter parser (9 edge forms + 200 random); 4 seeded bugs each caught.
- Calibration sheet: 232 cells incl. 2:1 iso slopes and sub-pixel offset sweeps; per-cell thresholds (needs `node tools/build.mjs` to refresh calib-gpu pages).
- Timeline off-by-one fixed; phase starts: filling 148, spinning up 593, in sync 837, spinning down 1550.

## Removed (low-value-test dictionary)
Duplicate lockstep + tick hook in live-gate; duplicated image helpers; non-asserting compare/baseline/old live-edge; src/fixture/measure-calib.mjs (averages, no pass/fail); misleading cache-hit line; out/gpu/live-gate/* reports pointing at uncommitted files; stale timeline.json; slot-markup.json browser artifact (→ tools/fixtures); out/gpu/crops/dev/*.

## Limitations
- Turbo runs a frame's callbacks in one task; per-callback behaviour only covered by real-mode rows (120 determinism ticks, draw-count).
- "Hidden" covers the IntersectionObserver path, not a background tab.
- Static `patch` self-test caught at DPR 2/4 only (erodes away at DPR 1).
- Fixture/calib pages still import the unpinned anatomy kit and ../v2-factory CSS.
- svg2scene.mjs duplicates exporter parsing (left to A: touches renderer input format).
