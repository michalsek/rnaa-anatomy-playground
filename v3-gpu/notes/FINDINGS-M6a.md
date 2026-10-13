# M6a findings (SVG baselines; see out/perf/baselines.md)

1. **SVG cost is nearly all the per-frame slot rewrite.** Freezing slots removes 66 % of main-thread time and 91 % of GPU raster; the static drawing costs almost nothing once rastered.
2. **Over half of page script is simulation + SVG string building** (0.77 of 1.41 ms/frame desktop). The M3 adapter keeps that and removes only DOM→raster (≈2.1 ms/frame desktop, ≈9 ms phone); only native drawing (M5) removes the string cost.
3. **GPU raster is mostly whole-tile replay**: paint-op decoding is 12.8 of 20 ms/frame on stress — each tile a slot touches replays all static paths beneath (whole SVG = one paint layer).
4. **Halo blur hypothesis rejected.** Slots frozen → raster ≈ 0 despite the blur. Interleaved A/B filter:none: centrifuge GPU raster −0.13 ± 0.23 ms (n.s.), stress +0.05 ± 1.31. GPU pre-blurred halo is for parity, not speed.
5. **Dirty-check is a small win**: 44 % of slot writes identical but only 27 % of bytes (6 % in factory); script −0–8 %, style+layout −5–13 %; raster and frame rate unchanged.
6. **SVG layering (will-change on slot `<g>`) is the cheapest real SVG win, GPU-side only**: Chrome 154 composites them (25 layers vs 4); GPU raster −40–54 %, worker raster −60–65 %, main paint +15–25 %; frame rate unchanged (stress/factory are main-thread bound). Static check: painter order intact, but 2.3 % px differ (max 140/255) from pixel-snapped layers (≈½ px line shifts). Not yet checked in motion.
7. **Assembled factory is main-thread bound on desktop already** (18.6 ms/frame) and ≈12 fps in phone config — SVG-only cannot reach 60 fps on phones.

## v2/kit issues (owners: v2)
- Loop runs at display rate: at 144 Hz it costs 2.4× the CPU of 60 Hz for no visible gain → cap tick() ≈ 60 Hz.
- Every slot rewritten each frame allocates nodes: CDP Nodes swings 3k↔250k (live DOM 2.7k), GC 0.2–0.6 ms/frame. Transforming rigid parts (pulleys, crank, needle, packets) beats dirty-checking.
- Factory explode `place()` re-appends every wrapper on any order change: style+layout 3.0 → 7.0 ms/frame during the opening tour → re-insert only moved wrappers.
- dt capped at 1/30 s → at 10–12 fps the simulation runs at ≈⅓ speed.
- runtime.js is a page singleton (binds first .fx-stage / readout / status) → two figures per page collide.
- Fixed SVG id `centrifuge-void` clashes with two figures per page.

## Measurement notes
- Headless vs headed: same Metal/Graphite path; per-frame costs within ≈10 %; headless 60 Hz vs headed 144 Hz external display → headed per-second cost 2.4×.
- Shared, busy machine during runs: expect 10–20 % drift between rows taken at different times; small effects checked via interleaved A/B (bench/ab.mjs).
- Not done: layered variant in motion, quiet-machine re-run (`node bench/run-baselines.mjs --force`), GPU rows (`node bench/stress.mjs <gpu page> --mode iframe`).
