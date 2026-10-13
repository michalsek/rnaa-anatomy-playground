# Fix loop A findings (renderer architecture + GPU perf)

Verification: `npm run gates:full` all green (282 s; unit 37, dl 19, static 20, live 214, motion 10, edge 43 incl. A1–A5, calib 8, determinism 11; 6/6 self-tests caught). Cached vs `?cache=0`: 0 px at 83 ticks (DPR 1/2, both themes, fades, explode share 0.4). 10k-tick run: 33 buffers (4.36 MB) and 6 textures stable from tick 1000, heap 5.5–6.2 MB flat, frames = ticks + 1, cache built once, 0 User Timing entries, 0 errors. tsc strict + noUnused clean, no `any`. Exported DL byte-identical.

## Where the GPU time went (HEAD 0b84fe6: 4.1–4.4 / 7.2–7.9 ms median/p95 @1280 DPR2)
Stroke fragment work ≈ 75 % of the frame, then MSAA blending of stroke quads; the 6-neighbour loop ≈ 0.4 ms at a steady clock; `discard` cost nothing. Cost barely scales with resolution because hairlines stay ≈ 1 device px wide (fragments grow with DPR, not DPR²), every segment pays a ≥ 3.2×3.2 px padded quad, and DVFS makes idle-clock timings overstate cost. `?gpuRepeat=4` measures at a steady clock.

## Changes
- **Static layer cache** (src/core/static-cache.ts): resolved static frame cached as a texture; per frame: stencil-mark slot extents, copy cached colour outside them, redraw inside only slots + static entries/segments/opaque triangles reaching slot envelopes. Envelopes = sets of 8-unit cells grown by one cell, grow-only, incremental partition extension (0.2–2 ms) without cache re-render. Each slot reserves a fixed depth range (256, doubling). Rebuild on resize/DPR/theme/paint/layout/background/frame-uniform/slot-painter change/device loss; explode drags = full redraw until share stable 2 frames. Rejected: copying 4× MSAA buffers + transitive closure (copy alone 0.6 ms; closure pulled in 60–70 % of segments). Debug: `?cache=0`, `?cache=overlay`.
- **Stroke shader**: join bisectors + "crowd" distance precomputed on CPU per segment (computing in VS lost the gain); exact ±3 neighbour loop only when `crowd × scale < 2.5 × halfWidth + 1.5 px` (17 % of segments, was 80 %); otherwise two half-plane tests; no `discard`; common path reads no storage. Hairlines within 32 px (0.0016 %) of HEAD at DPR 2.
- **Frame scheduling**: frame starts at the runtime tick (`FACTORY.onFrame`), drawn in a microtask after it; writes outside a tick coalesce into one own-rAF draw that defers to a running runtime → frames = ticks.
- **Module split**: `src/core` (DOM-free: schemas, paint table, scene, DL loader, strokes, fills, static geometry, draw list, static cache, halo, bindings, shaders, pipelines, renderer, frame loop, profiler), `src/live` (slot source contract, geometry builder, adapter, slot renderer), `src/web` (boot, DOM slots, palette resolver, API). Schemas drive packing (`d.memoryLayoutOf` offsets), flags are `tgpu.const`, host mirrors written with `write(…, {startOffset, endOffset})`, transient MSAA attachments where supported, every resource owned with `dispose()`. Bug fixed en route: partial order-buffer write copied from source byte 0.
- **Paints**: fill alpha per vertex (u16), paints keyed by CSS chain only; new live paints resolved once per flush (one probe tree); `classVersion` bumped only when an already-resolved paint changes class. Shared `export/palette-key.mjs` (`paintKeyOf`, `probeNode`) → live keys = exporter keys.
- **Parsing**: slice-free number parser in `export/svgsub.mjs` `parsePathData`; `export/polylines.mjs` (`ringOfCircle`, `polylinesOf`) reused by live builder. Node replay 0.60–0.65 ms/tick (was 0.86–1.66); in-page parse 0.8 / 1.2 ms (×1 / ×4) vs 1.1 / 1.6. Style cache per ancestor context: 99.7 % hits; per-element template cache (7 % hits) removed.
- **Errors/fallbacks**: bounded `__gpu.errors`; 3 consecutive frame failures → live SVG fallback; device loss → reinit (3 attempts with backoff, ≤ 16 per page) else fallback; null/missing adapter or no WebGPU → fallback with `__gpu.error`; uncapturederror recorded (first 5 logged); dev sets `__gpu.error` on undrawable markup.
- **Live SVG stays in the DOM**: overlays hidden canvas while booting (accessible image), `display:none` + `aria-hidden` after ready, takes the canvas's place on fallback; slot interception on the real figure's slot groups → runtime and `api.el/els` bind to it in every mode; `release()` restores native innerHTML.
- **Group layers**: one shared atlas (shelf packing, one pass, one resolve), shrinks after 120 idle frames.
- Translucent gradient stops classify as blended (QA-M2 D4). dl-loader reads `export/dl-format.mjs` tables.
- **build.mjs**: normalized full-script drift check against a fresh v2 page() (both themes); asserts DL slots ⊆ figure slots (`overlay` the only kit-only slot); `--dev` builds only live-dev.html; dead fixture-share1 variants removed.
- **Profiling**: User Timing only with `window.__gpuProfile` / `?profile`, entries cleared immediately.

## Before / after
| | HEAD (M3) | Fix A cached | Fix A `?cache=0` |
|---|---|---|---|
| GPU pass idle clock 1280 DPR2 med/p95 (ms) | 4.1–4.4 / 7.2–7.9 | ≈ 1.5 / 1.8 | 4.3 / 5.5 |
| GPU pass steady clock `?gpuRepeat=4` (ms) | 1.64–1.90 | 1.02–1.11 | 1.33–1.36 |

| Row (median of 2, out/perf/fixa) | Fix A | M3 | SVG |
|---|---|---|---|
| Desktop single: main task / GPU pass (ms) | 2.15 / 1.54 | 2.28 / 3.60 | 3.19 / – |
| Phone single: main task / GPU pass (ms) | 8.39 / 1.77 | 8.49 / 4.10 | 11.40 / – |
| Stress10 desktop: fps (dropped) | 57.9 (3.4 %) | 42.3 (29.6 %) | 43.1 (28.1 %) |
| Stress10 desktop: GPU pass Σ / GPU-proc wait / util | 8.68 ms / 0.25 ms / 84 % | 172.88 / 21.07 / 99 % | – |
| Stress10 phone: fps / main / parse / encode / GPU Σ | 13.5 / 74.4 / 31.6 / 6.4 / 23.1 | 13.4 / 75.0 / 34.7 / 5.1 / 41.1 | 11.0 / 91.8 / – |
Static floors unchanged (DPR1 0.0824 / 0.1137 %, DPR2 0.010 / 0.0112 %, DPR4 0.0003 / 0.007 %); 228–229 calib cells in limits.

## Skipped / documented
- QA-M2 D2 browser-zoom softness: at DPR 1.25 / 1.75 the canvas left edge lands on a half device px (x = 392.5 / 549.5) → compositor resample (incl.-AA 1.42 % / 1.22 % vs 0.18 % @1.5, 0.09 % @2; same on HEAD). Fix needs sub-pixel CSS translate + view offset + scroll handling + real-display check.
- QA-M2 D5: opaque canvas hides the page backdrop (blend modes don't see it). QA-M2 D3 (CSS zoom on parent) not addressed. Kit `overlay` slot not drawn. Miter joins: small gap remains. Startup: static geometry build ≈ 11 ms (×1), first partition ≈ 1.4 ms — not optimized.
- Phone stress still 1.03 GPU frames per top-level frame per instance (ticks vs frames alignment); `FACTORY` assigned twice → naive counters double.

## M5 hook
Implement `SlotPainter` (src/core/slots.ts), register via `renderer.setSlotPainter` (later registration replaces earlier for the named slots). Per frame: `prepare` (offscreen), `drawOpaque`, `drawSlot` at the slot's painter position; report `layersOf(slot)` (≤ reserved depth range) and `extentOf(slot)` (bounds the cache redraw region). FrameContext gives pipelines, shared bind groups (`layoutGroup`), view transform, explode offset, depth bases. Paints: `PaintResolver` table can be resolved at export time; src/core is DOM-free.
