# M6a plan: measurement tooling + SVG baselines

Owner files: `tools/perf.mjs`, `tools/perf-lib.mjs`, `bench/**`, `out/perf/**`, `notes/PLAN-M6a.md`, `notes/FINDINGS-M6a.md`.
Read-only inputs: `../v2-factory/**`, `~/.claude/skills/anatomy/scripts/**` (`chrome-port.mjs` is imported: it has no side effects).

## Deliverables
1. `tools/perf.mjs <page.html> [opts]`: Node CDP harness, fresh Chrome per run (headless `--headless=new` by default, `--headed` for a real window).
   Options: `--width --height --dpr --throttle --seconds --warmup --label --out --preload (repeatable) --eval --select --trace-seconds --no-trace --raw`.
   Collects in the measurement window (warmup excluded):
   - rAF series from a preload recorder: our own rAF-to-rAF interval loop (unwrapped rAF) + per-frame page-callback time (wrapped rAF callbacks, timed with performance.now; callbacks of one frame share the rAF timestamp). Page-frame ratio proves the IntersectionObserver gate let the page loop run.
   - vsync calibrated on about:blank before navigation; dropped frames = Σ(round(interval / vsync) − 1).
   - Long Animation Frames (PerformanceObserver `long-animation-frame`): count, duration, blocking, split into pre-render tasks / rAF / style+layout+paint.
   - CDP `Performance.getMetrics` deltas (ScriptDuration, LayoutDuration, RecalcStyleDuration, TaskDuration, LayoutCount, RecalcStyleCount) per frame, plus end Nodes / JSHeapUsedSize and DOM element count.
   - A trailing trace window (separate, so tracing overhead never touches the main numbers): devtools.timeline + cc + gpu + viz categories, summarised per frame: renderer main thread self-time by event (script / style / layout / prepaint / paint / layerize / commit), compositor, raster workers and GPU-process busy time.
   - Emulation: `setDeviceMetricsOverride` (width, height, DPR, mobile < 600 px), `setCPUThrottlingRate`; stage scrolled to the viewport centre.
   - Meta: Chrome version, GPU feature status (`SystemInfo.getInfo`), headless/headed, page sha1, load average, layer count.
   Output: JSON file + one-line summary on stdout.
2. `bench/`:
   - `v2/` frozen copies of the measured v2 pages (sha1 recorded) so baselines stay reproducible while v2 keeps changing.
   - `stress.mjs`: replicates any single-instance factory page N times on one page. `inline` mode: one shared stylesheet, N stages, N module scripts each scoped to its own cell (the runtime's three `document.querySelector` calls are re-targeted); `iframe` mode: N iframes of the page (works for any page, e.g. a future GPU page). Cells are laid out in a grid sized so every instance is fully on screen at any viewport (otherwise the IO gate would stop the off-screen ones). The stage renderer is whatever the source page uses → the GPU stress page is the same command on the GPU page.
   - `preload/`: `dirty-check.js` (skip slot innerHTML writes whose string is unchanged; counts writes/skips), `halo-off.js` (`.iso-halo{filter:none}`), `layered.js` (`will-change:transform` on slot groups).
   - `run-baselines.mjs`: the matrix, 3 repeats each, medians + spread → `out/perf/*.json`, `out/perf/baselines.md`.

## Acceptance criteria
- A1 `node tools/perf.mjs bench/v2/centrifuge-light.html --width 390 --dpr 3 --throttle 4 --seconds 8 --warmup 2 --label x --out out/perf/x.json` exits 0, prints one summary line, JSON has all sections above with finite numbers.
- A2 page-frame ratio ≥ 0.95 for every baseline run (the measured page actually animated during the window).
- A3 The recorder does not perturb: a run with the recorder alone vs. the same page's CDP metrics is consistent (ScriptDuration/frame ≥ recorder callback ms/frame); own loop cost < 0.05 ms/frame.
- A4 Stress page: 10 independent running centrifuges (10 readouts change, 10 × slot writes per frame), no console errors; screenshot check.
- A5 Dirty-check variant renders identically (screenshot diff vs plain at the same lockstep-free moment is not possible → check slot innerHTML equality at end + visual sanity) and reports skipped-write fraction.
- A6 Baselines: centrifuge, stress×10, stress×10 dirty-check, single dirty-check, assembled factory (latest = `factory-light.html`) at (1280 px, DPR 2, throttle 1) and (390 px, DPR 3, throttle 4); each 3× with median + min/max in `baselines.md`.
- A7 Halo finding: paint/raster per frame with and without `filter:none` on the halo, recorded in FINDINGS.
- A8 Headless vs headed: at least the centrifuge + stress pages at the desktop config measured headed too; differences reported.

## Test plan
1. Smoke perf.mjs on centrifuge (both configs), inspect JSON sanity (vsync 16.67, ratio ≈ 1, metrics > 0, trace threads found).
2. Recorder overhead: compare own-loop-only interval stats on about:blank and on a page with / without the callback wrapper (spot check).
3. Build stress page, drive.mjs screenshot at 1280 and 390, verify 10 animating instances (readouts differ after a few seconds, console clean).
4. Dirty-check: eval write/skip counters, compare final DOM of slots to an unpatched run's string generation (skip only when identical by construction).
5. Run matrix, check spread; re-run outliers; note machine load (other agents run in parallel).
6. Halo A/B at the desktop config with trace; also stress page.
7. Headed spot runs.
