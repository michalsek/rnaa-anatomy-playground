# QA: fix loop A (renderer architecture + GPU perf), commit 2e51703

This is an independent re-run on a frozen copy: `git archive 2e51703 v3-gpu` → `out/tmp/qa-fixa/v3-gpu/`, with `node_modules` and `../v2-factory` symlinked. `node export/export.mjs && node tools/build.mjs` gives a DL, `gpu.js`, `live.html` and `static.html` byte-identical to the committed files.

Scratch:
- QA scripts are in `out/tmp/qa-fixa/scripts/`, and shots, crops and JSON are in `out/tmp/qa-fixa/out/`. Paths below are relative to `out/tmp/qa-fixa/`.
- Comparison builds: `head/` is HEAD f2f9289 (M3 code). `instr/` is fix A with the stroke fast path disabled (every segment takes the exact ±3 loop).

Machine: Apple M4 Pro, Chrome 155 headless, adapter apple/metal-3. The machine was shared with the M5 agent and other load (cpuIdle 44–89 %, two perf runs at 1–9 %), so treat timings as ±10 %.

## Verdict per acceptance criterion

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Cached = `?cache=0` | **PASS** (not gated, see Tests) | Every compared tick is 0 px (exact, any channel). Ticks chosen by QA: every envelope-growth tick of a 2200-tick run (42 ticks, compared at t and t+1, 81 shots per config) at dark DPR 2 and light DPR 1. Also: packets injected 5 ways (30 ticks), theme switch and back (8), resize/DPR storm 900@1.5 → 1600@3 → 520@1 → 1280@2.625 during growth (13), two device losses (10), explode 0.3/0.71/0.72/1/0 (20). A slot sweep moved the lamp slot across and beyond the viewBox every tick, ×40 radius, teleport to 5000, empty, restored (39). The same sweep with 4 resizes and a share change mid-growth (15). Every shot was a cached frame (`cachedFrames` counted); growth never rebuilt the cache. **Exception: D2** (a failed frame leaves a stale cache). |
| 2 | GPU span ≥ 3× lower than HEAD (1280 DPR 2, 390 DPR 3); stress10 reported | **PARTIAL** | Real-time `ms.gpu`, 2 rounds, medians. 1280 DPR 2: HEAD 4.26–4.65 → fix A 1.51–1.57 ms, which is **2.7–3.1×**. 390 DPR 3: 4.52–4.65 → 1.51, which is 3.0–3.1×. p95 is 7.7–8.3 → 1.8–2.2 (≈ 4×). At a steady clock (`?gpuRepeat=4`) fix A is 1.11–1.21 ms, against FINDINGS' HEAD 1.64–1.90: **≈ 1.5×**. So the ≥ 3× holds only at idle clocks and p95, and only borderline at 1280 DPR 2. `?cache=0` is 4.0–5.0 ms at idle clock (≈ HEAD) and 1.38 ms at steady clock, so the stroke-shader change alone is worth ≈ 1.2×. Stress10 is reproduced (Perf). |
| 3 | Static / test-export / live gates, no regression | **PASS** | `npm run gates:full` is all green in 279 s, including all 6 self-tests. The static floors are unchanged. |
| 4 | Draws per runtime tick = 1.00 | **PASS** | Measured per display frame in real rAF with no lockstep (`scripts/sched.mjs`): 990 display frames each with exactly 1 tick and 1 GPU frame, and 0 display frames with two GPU frames. This held with the extras listed below the table. Under reduced motion GPU frames < ticks (3 of 180 when nothing changes). Stress10 phone (390 DPR 3, ×4): every instance had 109 ticks = 109 GPU frames = 109 top-level frames. |
| 5 | 10k ticks: no growth in GPU objects or heap; User Timing 0 | **PASS** (heap: Info) | 12k turbo ticks with a fade every 24 ticks, theme every 504, resize every 696 and device loss every 1488 (`scripts/longrun.mjs`). Live buffers stay at 34 (4.4 → 5.0 MB, grow-only slot buffers plateau). Textures stay at 9 (bytes follow DPR). Atlas allocations stay at 1–3, paints at 132, errors 0, User Timing at 4 constant entries (not ours), DOM nodes at 2430. The heap after GC goes 5.6 → 6.9 MB. Split by cause: no ops 5.52 → 5.83, theme only 5.24 → 5.73, losses only 5.51 → 6.10 (≈ 70 KB per re-init, bounded by `MAX_REINITS`). |
| 6 | Loss after ready + failing re-init → live SVG; dev `__gpu.error`; null adapter binds the runtime to the figure | **PASS** (but **D1**, D5) | Edge gate rows pass. QA covered: late-resolving null adapter, 17 genuine losses, and 3 frame failures (details in Fallbacks). |
| 7 | tsc strict, no `any` | **PASS** | `tsc -p src/tsconfig.json` (27 files) is clean, and there are 0 `any`s. 34 non-null `!` remain. |

The extras for criterion 4:
- an out-of-tick slot write in an rAF callback registered *before* the runtime's;
- a timer writing two slots every 3 ms;
- a 300-event mouse storm driving `__gpu.setShare`;
- a 2 s hidden tab (0 frames while hidden, no burst on return).

The **~1.03 explanation is confirmed as a counting artefact**:
- frames/ticks is exactly 1.000;
- `FACTORY` is assigned twice, both times to the same object (runtime.js `window.FACTORY = api`, then the page boot `window.FACTORY = FACTORY`);
- perf.mjs reports 1.006/instance, a window-alignment effect.

## Defects

**D1: Medium. Device loss during boot compile leaves a dead, blank figure that counts as "ready".**
- **Code:** `src/core/frame-loop.ts`.
  - `init()` registers `device.lost` at :240 but assigns `this.root` only at :260, after `await renderer.compile()`.
  - `onDeviceLost` returns at :269 when `root !== this.root`.
  - A loss in that window is therefore dropped. `compile()` then resolves on the lost device, frames "draw" as no-ops, `onSubmittedWorkDone` resolves, and `onReady()` hides the SVG.
- **Repro:** `scripts/fallback.mjs` (the `LOSS` preload resolves `lost` with reason `unknown` 0 / 2 / 10 ms after `requestDevice`). Result: `ready: true, error: null, reinits: 0, devices: 1`, 94 "frames", and the canvas has 1 distinct colour (blank card) for good. At 30 and 80 ms it re-inits correctly.
- **Why the gates miss it:** the edge row `loss-before-ready` uses `simulateDeviceLoss()`, which needs `this.root`, so it never hits this window.
- **Shot:** `out/fallback/loss-before-0.png`.
- **Fix:** set `this.root` (or a pending-root field) before awaiting, or check `device.lost` with `Promise.race` after `compile()`.

**D2: Medium. A failed frame leaves state flags set for GPU work that never ran, and a stale static cache is shown indefinitely.**
- **Code:**
  - `renderer.ts:593` sets `cacheValid = true` while encoding `renderCache`, before `encoder.submit()` (:318).
  - `frame-loop.ts:338-341` catches the throw but does not invalidate anything.
  - `halo.ts` `renderMasks` clears `maskDirty` the same way.
- **Repro:** `node scripts/identity.mjs submitfail --theme dark --dpr 1`. `GPUQueue.submit` throws once on the theme-switch frame, the frame that re-renders the cache. From tick 702 to 720, 451 k px differ from `?cache=0`: the old/garbage static frame is shown with live slot rectangles pasted in. It recovers only at the next invalidation (`setShare`), at 721.
- **Shot:** `out/identity/submitfail-dark-dpr1/cache-710.png`.
- **Why it matters:** the 3-strike policy exists so that 1–2 failures recover, and with this bug they do not.
- **Fix:** mark the cache and halo valid after a successful submit, or call `invalidateCache` and `halo.invalidate` in the catch.

**D3: Medium-Low, regression vs HEAD. A zero-size canvas creates 0×0 textures, which raises WebGPU validation errors.**
- **Code:** `src/web/main.ts:187-200`. `applySize` has no zero guard: the `devicePx` branch returns 0 when the observer reports 0×0. `renderer.ts:254-258` then creates the 0×0 MSAA, depth and cache targets.
- **Repro:** `scripts/hidden-stage.mjs` sets `display:none` on the stage for 600 ms. Fix A logs 18 errors in `__gpu.errors` and 5 on the console. HEAD logs 0. Fix A recovers when the stage is shown again.
- **Other triggers:**
  - Any CDP `captureScreenshot` with `captureBeyondViewport` produces a transient 0×0 entry: `scripts/zero-tex.mjs` gives 13 errors.
  - Real pages with hidden tabs or accordions trigger it too.
- **Gate gap:** the gates' console-clean checks do not cover the moment of their own screenshots.

**D4: Low (latent). The stroke fast path double-blends where non-adjacent segments (±2..3) of one polyline touch or cross with turns ≤ 90°.**
- **Code:** `strokes.ts:141-192` derives `crowd` only from join-line pinch points and the far ends at sharp (>90°) turns. A square spiral, or a path whose 4th segment crosses its 1st, keeps `crowd` large, so both segments take the half-plane path (`shaders.ts:211`) and both claim the pixels.
- **Repro:** `scripts/inject-shapes.mjs` injects the shapes into the lamp slot at stroke-opacity .6. The darkest pixel at the crossings is R 191–196 on fix A vs 208 for both the exact loop and SVG (DPR 2 and 3).
- **Shot:** `out/inject/sheet-fixa-vs-loop-0.6-a-dpr2.png`.
- **Centrifuge impact:** none visible. Static fix A vs forced loop differs at 15–70 single pixels (DPR 1–4), at curve joins, in both directions:
  - fix A fills some HEAD pinholes, e.g. `out/parity/crops/vsloop-light-1280-4-1418-2749.png`;
  - fix A opens a few new 1-px fringe gaps, e.g. `out/parity/big/light-1280-4-1619-1053-less.png`.
- **Fix:** also lower `crowd` by the distance to segments i±2 and i±3 when computing on the CPU (cheap), or document it.

**D5: Low. An external `device.destroy()` (reason `destroyed`, not via `simulateDeviceLoss`) freezes the figure for good.**
- **Code:** `frame-loop.ts:275` returns after disposing. The result is no re-init, no fallback and `error: null`; the frame count stops (`scripts/fallback.mjs` external-destroy).
- **Fix:** treat it as a loss, or fall back.

**D6: Low / docs. Failure reasons are mislabelled.**
- `start()` swallows every init error and reports `no-adapter: …`. That covers compile and validation failures, and re-init failures after loss.
- The `.catch(... 'reinit-failed')` at `frame-loop.ts:281` is unreachable, yet GPU-API.md documents `reinit-failed`.
- The 17-loss run reports `reinits: 17` alongside the message "re-initialized 16 times".

**D7: Info / claims.**
- **Fragment-shader storage reads.** PLAN-FIXA and FINDINGS say "fragment shader reads no storage in the common path". It does read storage:
  - `strokeFrag` reads `paints[segs[seg].paint].color` and `segs[seg].alpha`;
  - `strokeCoverage` reads `segs[seg].flags`, `joinStart` and `joinEnd` (`shaders.ts:247-315`).
  - The design item "colour, flags, join data → flat varyings" was not implemented.
- **Cache coverage.** `?cache=overlay` works and is readable (`out/overlay/overlay-light-935.png`). At tick 935 a cached frame still redraws **13 937 of 21 060 static segments (66 %)** and 521 of 818 entries. Long conveyor legs whose box touches an envelope are per-frame in full. The savings come from the stencil rejecting fragments, not from culling, which leaves vertex and early-stencil cost on the table.

**D8: Info.** The committed `bench/gpu-fixa/live-light.html` bundle (433 041 B) is not the committed source's build (433 034 B). FINDINGS' perf rows were measured on that slightly different bundle. My numbers come from the frozen build and agree.

## Stroke shader (item 3)

- **Parity with HEAD:** fix A vs HEAD f2f9289 (static, both themes, DPR 1 / 1.25 / 2 / 3 / 4) differs at 15–72 px per frame (DPR 2: 28/32 px, matching FINDINGS' "32 px"). Forced-loop vs HEAD differs at 0–3 px, so all of it is the fast path.
- **Crowded parallel lines:** crops vs SVG and vs HEAD for the tach ticks, belt, motor ribs, conveyor slats and a rail, at DPR 1 and 4 in both themes (`out/crops/*`). Fix A vs SVG is identical to HEAD vs SVG (loose 0–40 px per 48² crop, all pre-existing AA). No new artefacts.
- **Acute angles and closed polylines:** the injected zig-zag (100° turns) and the thin closed rectangle match the exact loop. The only divergence is D4.

## Fallbacks (item 5, `scripts/fallback.mjs`, real time)

- **Boot a11y:** the AX tree shows `image "Centrifuge"` before ready and after (QA-M3 D6 fixed). The console is clean in every scenario.
- **Late null adapter** (1.2 s per call; 3 calls with back-off): during boot the SVG is visible and animating, the runtime is bound to the figure, and `api.el` works. It then falls back with `no-adapter`, keeps animating and stays bound.
- **17 genuine losses** (reason `unknown`): 16 re-inits, then fallback `device-lost: re-initialized 16 times`. The SVG animates, is bound, and the AX image is present.
- **Frame failures:**
  - 2 failures recover, with `errors` holding 2 entries (but see D2).
  - 3 consecutive failures, and a permanent failure, both fall back with `render-error`. The SVG animates, is bound, and the AX image is present.
- **Device loss before ready:** only at ≥ 30 ms after `requestDevice`; earlier is D1.

## Perf (item 7)

Settings: `tools/perf.mjs` with the `gpu-timing` preload, 3 runs each, A/B/A order alternating, medians. fix A is the frozen `out/gpu/live-light.html`, M3 is `bench/gpu/live-light.html` (= HEAD's), and SVG is `bench/v2/centrifuge-light.html`. The stress pages point at the same files (`bench/stress10-*.html`).

| Row | fix A | M3 | SVG | FINDINGS (fix A / M3 / SVG) |
|---|---|---|---|---|
| Desktop single: task / GPU pass (ms) | 2.15 / 1.51 | 2.15 / 4.06 | 2.86 / – | 2.15 / 1.54; 2.28 / 3.60; 3.19 |
| Phone single: task / GPU pass (ms) | 8.30 / 1.57 | 8.42 / 4.52 | 10.97 / – | 8.39 / 1.77; 8.49 / 4.10; 11.40 |
| Stress10 desktop: fps (dropped) | 58.1 (3.1 %) | 45.5 (24.1 %) | 45.1 (24.9 %) | 57.9 (3.4 %); 42.3; 43.1 |
| Stress10 desktop: GPU pass Σ / GPU-proc wait / util | 9.18 / 0.24 / 80 % | 166.3 / 19.6 / 99 % | – / 4.24 / 68 % | 8.68 / 0.25 / 84 %; 172.9 / 21.1 / 99 % |

All fix A numbers are reproduced. Desktop CPU task is unchanged vs M3 (2.15 vs 2.15); the gain is on the GPU side.

## Browser zoom (item 8, QA-M2 D2)

The half-pixel analysis is **confirmed as the dominant cause, but not the only one** (`scripts/zoom.mjs`, static GPU vs static SVG, loose):

| DPR | Canvas left edge (device px) | Loose diff as-is | Loose diff with the page nudged so the canvas lands on a whole px |
|---|---|---|---|
| 1.25 | 392.5 | 0.84 % | 0.22 % |
| 1.75 | 549.5 | 0.63 % | 0.16 % |
| 1.5 | 471 | 0.017 % | – |
| 2 | 628 | 0.010 % | – |

Snapping removes ≈ 75 % of the difference. The remaining ≈ 10× above DPR 1.5 is unexplained (possibly the fractional backing height). Crops: `out/zoom/sheet-1.25.png`, `out/zoom/sheet-1.75.png`.

## Verification of claimed CQ / QA fixes

| Item | Status |
|---|---|
| QA-M2 D1 backing size | fixed (since M3) |
| QA-M2 D2 zoom | documented, analysis confirmed (above) |
| QA-M2 D3 CSS zoom | open (as stated) |
| QA-M2 D4 gradient translucent stops | fixed in code (`paint.ts:83-86`); not pixel-tested |
| QA-M2 D5 overflow | open (as stated) |
| QA-M2 D6 halo leaks | fixed: `HaloEffect.dispose`, stable buffer/texture counts |
| QA-M2 D8 double probe | fixed: one observer on `data-theme` |
| QA-M3 D1 readiness latch | fixed: no latch, `hasDirty` |
| QA-M3 D2 User Timing growth | fixed: 0 own entries |
| QA-M3 D3 mesh memo | removed, honest stats |
| QA-M3 D4 fallback binds the figure | fixed in every mode tested |
| QA-M3 D5 dev `__gpu.error` | fixed |
| QA-M3 D6 boot a11y | fixed |
| CQ-M2 S1 halo leaks | fixed |
| CQ-M2 S2 `any` handles | fixed |
| CQ-M2 S3 hand packing | fixed: `SEG_RECORD` / `FILL_VERTEX_RECORD` from `memoryLayoutOf`, u16 asserts |
| CQ-M2 S4 flag constants | fixed: `tgpu.const` |
| CQ-M2 S5 dl-loader duplicates dl-format | fixed |
| CQ-M2 S6 two palette probes | fixed: shared probe, batched |
| CQ-M2 S8 reinit / GPU errors | mostly fixed (D6 labels, D1 window) |
| CQ-M2 S9 host split | partial: surface + present hook + `dispose` exist, but the web host never disconnects its observers or calls `GpuView.dispose` |
| CQ-M2 S10 Renderer split | fixed |
| CQ-M2 S13 `initAsync` | fixed |
| CQ-M2 N3 depth formula | one TS + one WGSL copy, named |
| CQ-M2 N4 `warn.disable` | now scoped with `warn.reset()` (`pipelines.ts:74-78`) |
| CQ-M2 N6 `dpr` Infinity | fixed |
| CQ-M2 N7 `render(share)` | fixed |
| CQ-M2 N9 closed 2-point polylines | fixed |
| CQ-M2 N9 square cap | still treated as round in strokes |
| CQ-M3 S1 fill alpha per vertex, batched resolve | fixed |
| CQ-M3 S2 error handling | fixed, but see D2 |
| CQ-M3 S3 scheduling | fixed (criterion 4) |
| CQ-M3 S4 atlas | fixed: one atlas, idle release |
| CQ-M3 S5 shared export rules | fixed: palette-key, polylines, parsePathData fast path |
| CQ-M3 S6 raw `writeBuffer` | none left |
| CQ-M3 S7 encapsulation, classifier | fixed, except one literal `0.999` left at `live/geometry.ts:300` (use `isOpaqueAlpha`) |
| CQ-M3 S8 profiler injected, no rAF patch | fixed |
| CQ-M3 S11 build drift check | fixed: full normalized compare, slot assert |
| CQ-M3 S12 `slotsByAnchor` | fixed; `relayout` still joins `frameOrder` strings twice per share change |
| CQ-M3 N5 warnings keyed | fixed |
| CQ-M3 N7 innerHTML-only interception | open |

## Tests (item 9, low-value-test-dictionary)

- **`tools/test-live.mjs`: keep.** The fix-A diff only follows API moves (`PaintTable`, `SEG_RECORD` offsets, per-vertex alpha). The changed assertion ("fill-opacity does not make a paint of its own … alpha 0.5 per vertex") is a real contract test of CQ-M3 S1. No low-value additions.
- **Gap (dictionary category 10, no assertion):** the static cache's central invariant, cached ≡ `?cache=0`, has **no committed check**. FINDINGS' 83-tick identity run lives in `out/tmp/fixa/identity.mjs`, which is gitignored. `gates:full` has no cache-identity row and no self-test mutation for it, such as `PARTITION_MARGIN_PX = 0` or skipping envelope growth.
  - The live gate compares against SVG with loose limits, so a few stale pixels would pass.
  - Recommend a `cache` gate row: the ticks of `scripts/identity.mjs natural` + `sweep`, exact 0 px, plus a mutation self-test.
- **Gap (pure CPU modules with no unit tests):** `SlotEnvelopes`, `OccupancyGrid`, `CachePartition` (static-cache.ts), `strokes.ts` `crowd` and `GpuView` scheduling and error paths. All are testable in Node:
  - a JS model of fast vs exact ownership over sampled points would have caught D4;
  - a fake host for `GpuView` would have caught D1 and D2.
- **Test-only code paths:** `?cache=overlay` and `?gpuRepeat` are debug and measurement hooks with no test consumer. That is fine as tools; they are not tests.

## Out of scope (v2 / kit / tooling)

- v2 page script assigns `window.FACTORY` twice (runtime.js `window.FACTORY = api`, then the page boot `window.FACTORY = FACTORY`). Hook-based tools must de-duplicate.
- `centrifuge.accept(port, item, from)` ignores `from` while the machine is calm, so the injected packets are stacked at the funnel rather than arcing.
- Tooling: `tools/harness.mjs shot()` uses `captureBeyondViewport: true`, which resizes the page (transient 0×0 ResizeObserver entry). It is what surfaces D3 in screenshot-based tests, and it can mask or create console problems around shots.
- Timestamp queries without `--enable-webgpu-developer-features` are quantized to 65.5 µs (every `ms.gpu` is a multiple of it). Sub-0.1 ms deltas in gpuRepeat comparisons are at the resolution limit.

## Reproduce (from `out/tmp/qa-fixa/scripts`)

- `node identity.mjs all|sweep|sweepresize|submitfail --theme dark|light --dpr N`
- `node stroke-parity.mjs && node parity-classify.mjs && node parity-holes.mjs`
- `node inject-shapes.mjs`
- `node sched.mjs`
- `node stress-count.mjs phone`
- `node fallback.mjs`
- `node hidden-stage.mjs`
- `node zero-tex.mjs`
- `node longrun.mjs 12000 [ops]`
- `node gputime.mjs 2`
- `sh perf-batch.sh && node perf-sum.mjs`
- `node zoom.mjs`
- `node crops.mjs`
- `node overlay.mjs`

No Chrome left running: all launched instances were closed. The headless Chrome processes still running at the end belong to other agents.
