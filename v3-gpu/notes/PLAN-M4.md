# M4 plan — packaging + deliverable comparison shots

## Deliverable pages
- `npm run build` (and `npm run package` = export + build) writes `v3-gpu/centrifuge-gpu.html` (dark) and
  `centrifuge-gpu-light.html` (light): byte copies of `out/gpu/live.html` / `live-light.html` (the build asserts the
  hashes match), so every gate that runs on the live pages runs on the deliverable bytes.
- Self-contained: inline minified bundle, inline DL JSON, inline DL binary in a compact lossless encoding
  (`export/dl-wire.mjs`: per-section column-major words, delta-coded, byte planes, gzip, base64; decoded in the page
  with `DecompressionStream`). Bit-exact round trip, so parity gates are unaffected by construction. Quantization
  (lossy) is not used.
- The decode is asynchronous: `src/web/main.ts` boots in two phases — synchronously everything the v2 module script
  must find in place (slot interception, native host, `FACTORY` hooks, palette ids from the DL JSON), then the
  GpuView once the binary is decoded. A failed decode falls back to the SVG figure (`dl-decode-failed: …`).
- Renderer indicator: no visible badge (the card must stay identical to v2). `html[data-renderer]` = `svg` while the
  vector figure is on screen (booting, fallback, disposed), `webgpu` once the canvas shows; one `console.info` line
  when the renderer is decided (renderer, adapter or fallback reason).
- Unchanged and still working: `?native=0`, `?cache=0`, SVG fallback (no `navigator.gpu` / no adapter) animated by
  v2's runtime, reduced motion (v2's own `prefers-reduced-motion` handling in the kept module script), canvas
  `role=img` + `aria-label`, the `[data-status]` aria-live text.

## Acceptance criteria
1. `centrifuge-gpu{,-light}.html` exist, single files, no external references; sizes raw / gzip recorded; DL part
   ≥ 5× smaller than the base64 binary of HEAD.
2. `sha256(centrifuge-gpu*.html) == sha256(out/gpu/live*.html)` (build assertion + gate row `package`).
3. Gate row `package` (quick + full): over `file://` and `http://127.0.0.1` both themes: ready, `data-renderer=webgpu`,
   native rotor active, clean console; `?native=0` (native null), `?cache=0` (0 cached frames); preload without
   `navigator.gpu` and a null adapter → `data-renderer=svg`, fallback reason, figure animates (slot DOM changes),
   aria-live status updates; reduced motion: the rotor stands still and the frame equals the SVG page at the same
   tick (0 solid blob, live limits); deliverable vs v2 SVG at one tick within the DPR-2 live limits; unit test: DL
   wire round trip bit-exact (Node, through the same `DecompressionStream` decoder).
4. `npm run gates:full` all green, no threshold changed.
5. `report/`: full card at DPR 2 and 4× crops (rendered at DPR 4) of rotor + packets, tach hairlines, belt stub
   edges, funnel gradient, halo edge, motor ribs, lamp glow — v2 vs GPU, light and dark, with diff heatmaps and
   pixel-diff numbers in `report/README.md`; a 12-frame motion strip SVG vs GPU.
6. `index.html`: static, light/dark aware, links to deliverables, v2 originals, REPORT.md, report thumbnails,
   notes, perf tables, stress pages.
7. `out/perf/final/rows.md`: 3-run medians — deliverable vs v2 SVG (desktop 1280 DPR 2; phone 390 DPR 3 4×), stress10
   iframe GPU (deliverable bundle) vs SVG (desktop + phone), plus bytes and load-to-ready / first GPU frame.

## Test plan
- `node --test tools/test-export.mjs` (wire round trip), `npm run build`, open both deliverables via file:// and
  http:// (gate row `package`), `npm run gates` while iterating, `npm run gates:full` at the end.
- Comparison shots: `drive.mjs` with a lockstep + tick-gate preload (turbo, rebased, waitReady), the same tick on v2
  and GPU pages, shots at `--scale 2` (full card) and `--scale 4` (crops, the canvas re-renders at DPR 4); diffs with
  pixelmatch (loose %, incl. AA %) and a heatmap per pair.
- v2 reference: the committed `../v2-factory/parts/centrifuge/centrifuge{,-light}.html` (its SVG equals the fresh
  build; only its runtime lacks the inert `frameOffset` hook) — verified 0 px vs `out/svg` at the shot ticks.
- Perf: `tools/perf.mjs` via a `bench/run-final-rows.mjs` driver (frozen copies under `bench/final/`), 3 runs, medians.
- `node tools/chrome-reap.mjs` at the end.
