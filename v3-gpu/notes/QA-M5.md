# QA: M5 native instanced rotor, commit 8b99e77

Independent re-run on a frozen copy: `git archive 8b99e77 v3-gpu` → `out/tmp/qa-m5/v3-gpu/`, with `node_modules` and
`../v2-factory` symlinked. `node export/export.mjs && node tools/build.mjs` gives `out/gpu/live-light.html` and `gpu.js`
byte-identical to the committed files, and `bench/gpu-m5/live-light.html` equals the frozen build (no FIXA-D8-style
drift).

Scratch: QA scripts are in `out/tmp/qa-m5/scripts/`; shots, crops, sheets and JSON are in `out/tmp/qa-m5/out/`. Paths
below are relative to `out/tmp/qa-m5/`.

Machine: Apple M4 Pro, Chrome 155 headless, adapter apple / metal-3, shared with other load (load average 2.2–4.7,
`cpuIdle` 73–90 % during the perf runs). Treat timings as ±10 %. Every Chrome was started through `tools/chrome.mjs`.
`node tools/chrome-reap.mjs` at the end reported 0 orphans and 0 leaked profiles.

## Verdict per acceptance criterion

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Build fails unless exactly one site; live pages differ from v2's script by that line only | **PASS** | `tools/build.mjs:55-64` throws on ≠ 1 site. Diffing the module scripts of `out/svg/centrifuge*.html` against `out/gpu/live*.html` shows exactly 1 extra line (line 2159, the hook) in both themes; the rest is identical. The dev page carries the hook too. |
| 2 | Unit: mirror = kit over ≥ 3600 angles × both templates; template markup; paint keys | **PASS** (gaps under Tests) | `unit` row green (41 checks). The mirror is exact over 7200 angles × 3 rings. |
| 3 | Dev readback contract at the gate ticks | **PASS** | `native:contract` green (25 checks). QA did not extend the readback. Instead it checked pixels and v2 strings at 21 extra ticks (below). |
| 4 | `gates:full` green, no global threshold loosened, self-tests reject | **PASS** | All 21 rows green in **635 s** (`work/gates-full-1.log`). `git diff f32040d 8b99e77 -- tools/gates.config.mjs` only adds `NATIVE`. All 6 self-tests reject their defects. |
| 5 | Lockstep native vs markup vs SVG, DPR 1/2/4 × light/dark, crops ×1/×4, 60-frame sheet | **PASS** | See Visual: 154 three-way comparisons at QA-chosen ticks, plus two 60-frame sheets. Solid blob 0 everywhere. |
| 6 | Perf: 3 repeats, medians | **PASS** (numbers reproduced within noise) | See Perf. |
| 7 | tsc strict clean; zero allocations per frame in the model after warm-up (heap flat) | **PARTIAL / FAIL on the allocation claim** | tsc is clean (35 files), there are no `any`s, and the heap after GC is flat. The model is **not** allocation-free: see **D1**. |

## Defects

### D1 (Medium-Low): the CPU model allocates every frame, and the native page does more GC than the markup path

`classifyRing` calls `Math.hypot` once per ring edge: `src/native/kit-mirror.ts:91`, plus `rotor-model.ts:137` for released packets. V8's `Math.hypot` builtin allocates on every call.

- **Node (V8 14.1).** `scripts/model-alloc.mjs` runs `RotorModel.update` 100k times after warm-up, with 18 parts and a non-allocating `poseOf`.
  - As shipped: **157 scavenges**, about **6.6 KB per frame** (measured with a 1 GB semi-space and no GC: 129 MB over 20k frames).
  - With only `Math.hypot(dx, dy)` replaced by a sqrt: **1 scavenge**, about 70 B per frame, and update is 1.6× faster (2.3 vs 3.6 µs).
- **Chrome.** The heap sampling profile on `live-dev.html` (`scripts/heap.mjs`, includes collected objects, 400 ticks) puts the hook's largest allocations in `update < pack < classifyRing (< hypot)` at about 3.6 KB per tick (sampled). Smaller sources:
  - TypeGPU draw and dispatch bookkeeping;
  - `RotorPainter.prepare`: `new Uint32Array(host)`, `subarray` and the `{ endOffset }` object at `rotor-painter.ts:116-118`.
- **Page level** (`?native=0` vs native, 2000 turbo ticks after warm-up, all kinds injected, 3 runs each):
  - native page: 351 / 352 / 356 scavenges;
  - markup page: 326 / 326 / 328 scavenges;
  - the heap after GC is flat in both (5.95 → 6.16 MB).
- **What this contradicts:** PLAN §2 and FINDINGS say "allocation-free after warm-up". Criterion 7 says "zero allocations per frame".
- **Fix:** the classification must stay bit-identical to the kit, so the sqrt shortcut is not valid as-is. Either:
  - use an allocation-free JS replica of V8's two-argument hypot (max-scaling and compensated sum);
  - or cache rotation-invariant edge lengths: template edge lengths are invariant up to rounding, but bit-exactness needs proof.

  Then let `test-native.mjs` prove the result equals `Math.hypot` over the 7200-angle set. Also hoist the per-frame typed-array views in `prepare`.

### D2 (Low, test gap): the contract gate ignores stroke width, alpha, item and join data, and has no self-test

- `native-gate.mjs:121-129` compares only these: polyline count, paint, caps of the first segment, points, and the sign of layer order.
- A wrong `width` (e.g. crease and edge widths swapped in `RotorStyles`), a wrong `crowd` or join vector, or a wrong `item` (explode offset or depth base) passes it. Those would fall to the loose pixel limits.
- No `selftest:*` row mutates the contract or identity gates. `selftest:live drop-native` exercises only the pixel path.
- The cap check `line.flagsFirst !== other.flagsFirst && (line.flagsFirst & 48) !== …` has a redundant first clause and a magic `48`. It should use the `SEG` flags.

### D3 (Low, docs/tests)

- `native-gate.mjs:11-12` says `sheet` writes "the frame-to-frame diff strip". It does not.
- The `native:sheet` row checks solid blob vs SVG on light 700–759. That is the same range and the same check as the `motion` gate's light run, which now draws natively. The row only adds the contact-sheet artifact (dictionary category 6).
- GATES.md still says `gates:full` takes ≈ 5 min; it took 635 s here (FINDINGS: 623 s).

### D4 (Info): gate coverage of packet kinds

- The standalone page feeds only `control`, `graph` and `data` (`scenes/centrifuge.scene.mjs:147`). So no gate ever renders `audio`, `garbage` or `fluff` packets.
- The palette unit test registers 5 kinds and omits `fluff`.
- QA covered all six kinds, plus three unknown ones that grow the 8-entry style buffer (see Visual): no defect.
- Recommendation: put an injected-kinds tick set into `native:compare` and `native:contract`.

### D5 (Info): small behaviour notes

- **Writes from outside drawRotor.** A write to a native-owned slot from anything other than `drawRotor` is never drawn (`scripts/robust.mjs junk`: 0 px, 0 frames). It is kept for readers, and it is handed to the fallback if no rotor change made the strings stale since. That is outside v2's contract.
- **Dev validation skipped.** In dev builds the slot `validate` no longer runs for rotor writes: `dom-slots.ts:92-95` returns before `validate`.
- **Stale adapter geometry.** `LiveAdapter.geometry[slot]` keeps the rotor geometry from the boot frames after the native painter takes the slots. It is memory only and is never uploaded or drawn.
- **Counters reset on loss.** `frameStats().native.gpu` counts only the current painter, so its counters reset on device loss.
- **Untested growth path.** `RotorPainter.ensureBuffers` growth beyond `MIN_PARTS = 32` is unreachable on this scene (≈ 26 parts at most).
- **Change detection, theoretical gap.** It compares f32 records while v2 rounds f64 coordinates. A sub-f32 angle step could change v2's strings without marking them stale. This is not reachable: the smallest per-tick `|ΔAd|` over 3000 ticks is 2.4e-5 rad, and every non-reduced tick changed the records.

### Known defects (QA-FIXA)

D1–D6 are unchanged by M5, with one note on D3. QA-FIXA D3 (0×0 textures) still reproduces when the stage is hidden: 13 WebGPU errors. It also appeared once from the screenshot resize in `sheet` dark 590. The native path adds no new trigger.

## Visual (adversarial; `scripts/visual.mjs`, `scripts/sheet.mjs`)

SVG vs markup path vs native, under lockstep. All three pages got the same injections: every kind injected at ticks 60 and 400. Ticks the implementer did not use:

- **Edge-on vanes (face visibility flips):** 88/89, 113/114, 161/162, and tone flip 51.
- **All six kinds pocketed:** 520, 560, 640, 665.
- **Back/front swaps:** 598, 599, 600.
- **Mid-release (`releasePose`):**
  - garbage at 674 (rotor stage), 697 (spout) and 722 (fall);
  - fluff at 800;
  - audio at 925 (spout) and 950 (fall);
  - also 900.
- **Fades near the rotor:** injected at 140 / 142 and 668 / 670.
- **Unknown kinds:** 10 styles.

Results (154 three-way comparisons; `out/visual-*.json`):

| DPR | native vs SVG max loose | markup vs SVG max | native vs markup max | solid blob | runtime state / v2 strings |
|---|---|---|---|---|---|
| 1 | 0.1324 % (limit 0.15) | 0.1326 % | 0.0034 % | 0 | equal at every tick |
| 2 | 0.0153 % (limit 0.02) | 0.0143 % | 0.0011 % | 0 | equal |
| 4 | 0.0100 % (limit 0.012) | 0.0089 % | 0.0022 % | 0 | equal |

- **Strings.** At every tick, the GPU pages' `innerHTML` of all four rotor slots `===` the raw string v2 wrote on the SVG page. Both native and `?native=0` pass this exact check, which is stricter than the gates' DOM-normalized comparison.
- **DPR 4 dark, native vs SVG.** It reaches up to 4× the markup path's distance (0.0037 % vs 0.0009 % at t900). Crop `out/crop-dark4-900-spout.png` shows that the excess sits on the outline of a data packet in the spout, where the edge moves by sub-pixel amounts. This is the intended loss of the 0.1 rounding: no tone change, gap or ordering error.
- **Crops looked at:**
  - `out/visual/kinds/crops/*-x1.png` and `*-x4[LR].png` (all kinds, both themes);
  - `out/crop-light2-t8[89]-frontvane.png` (edge-on vane at ×6).

  No tone mismatch, missing edge, wrong order or band/strap error.
- **60-frame sheets around swaps:**
  - `out/sheet/dark-590-dpr2-{native,svg,diff-vs-svg}.png`: all kinds pocketed, swaps at 599 / 613 / 626 / 639. Change ratio GPU/SVG is 0.987.
  - `out/sheet/light-1040-dpr2-*`: garbage and audio releases plus swaps. Ratio 1.032.

  On both sheets: worst solid blob vs SVG 0, vs markup 0, and GPU-only A→B→A toggle blob 0. No popping.

## Contract robustness (`scripts/robust.mjs`)

- **Reduced motion:**
  - the hook is called every tick;
  - only 31 of 600 ticks change the model, with exactly one GPU frame each, so there are no frames while still;
  - injected packets are put in place;
  - pixels ≤ 0.0114 %, solid 0;
  - state and v2 strings equal at 9 ticks.
- **innerHTML read at the start of every tick** (`FACTORY.onFrame`, before v2 updates anything), for 1040 ticks:
  - every read equals the strings v2 wrote on the SVG page at the end of the previous tick;
  - state at 1100 is equal;
  - 1041 refreshes, no extra GPU work.
- **Reading twice.** A second read in the same tick does not re-run drawRotor (`markupRefreshes` counts once per stale state).
- **Hidden stage** (`display:none` mid-spin):
  - 0 ticks while hidden;
  - reads while hidden equal v2's strings (`scripts/dbg-hidden.mjs`, with and without hiding);
  - after showing, ticks 601–640 match the SVG page (≤ 0.0114 %, state and strings equal);
  - QA-FIXA D3 errors as noted above.
- **Device loss, then reads during the re-init window:**
  - strings equal at 671 / 672 / 680 / 700;
  - after re-init the painter draws again: `drawing: true`, `reinits: 1`, pixels on the floor.
- **Fallback (loss with no adapter) at tick 670, without reading the slots first:**
  - `release()` refreshed v2's strings (`markupRefreshes` 0 → 1);
  - the DOM of all four slots == the SVG page at 670, 671, 700, 760 and 900;
  - pixels 0 %, state equal;
  - the figure animates;
  - the hook goes inactive (`calls` frozen at 670), and v2 writes the DOM directly;
  - `error: no-adapter: …`.
- **Slow fallback** (adapter denial resolves after 3 s): 20 ticks run while the renderer is gone and the strings are stale (`drawing: false`, hook active). At fallback the DOM equals the SVG page at 690, and then at 700 / 760 / 900.
- **Theme switch mid-spin** with kinds whose paints the hook registered at runtime: switched page == fresh light page, **0 px** at 601 / 610 / 674 / 700.

## Painter ownership (CQ-FIXA S1)

- **Cache identity.** Cached == `?cache=0`, **0 px exact**, at 12 QA ticks (edge-on, kinds, swaps, releases) in dark DPR 1 and in light DPR 2. 925 cached frames, 1 cache rebuild.
- **Device loss.** Two losses at 597, right before a swap; at 598 / 600 / 674 the frame == a fresh page == `?cache=0`, **0 px**.
- **`?native` toggled by reloading one tab** (native → `?native=0` → native): each lands at 0 px vs a fresh tab.
  - `?native=0` reports `native: null`.
  - Adapter counters confirm that the rotor slots leave the markup path: `slotsChanged` 3437 vs 4632 and mesh elements 61,875 vs 113,565 at tick 600.
- **Envelopes.** After loss, the envelopes are rebuilt from the new painter's extents. No stale geometry is drawn.

## Perf (`bench/run-m5-rows.mjs --force` in the frozen copy, 3 runs each, medians; `v3-gpu/out/perf/m5/rows.md` there)

| page · config | renderer | fps | main task | live-js | parse | GPU pass Σ | FINDINGS (main task) |
|---|---|---:|---:|---:|---:|---:|---|
| centrifuge · desktop | SVG / markup / native | 60 / 60 / 60 | 3.19 / 2.45 / 2.22 | – / 0.97 / 0.85 | – / 0.91 / 0.76 | – / 1.57 / 1.57 | 3.05 / 2.38 / 2.00 |
| centrifuge · phone 4× | SVG / markup / native | 59.6 / 60 / 60 | 10.21 / 7.66 / 6.13 | – / 2.90 / 2.23 | – / 2.91 / 2.17 | – / 1.57 / 1.70 | 10.61 / 8.19 / 6.89 |
| stress10 · desktop | SVG / markup / native | 44.4 / 59.4 / 59.9 (dropped 26 / 1.0 / 0.2 %) | 22.6 / 16.1 / 13.5 | – / 7.02 / 5.81 | – / 6.75 / 5.27 | – | 22.8 / 16.9 / 13.6 (fps 43.5 / 58.0 / 60.0) |
| stress10 · phone 4× | SVG / markup / native | 11.1 / 13.8 / 15.4 | 91.1 / 73.0 / 65.2 | – / 30.2 / 26.2 | – / 30.7 / 27.0 | – | 94.6 / 69.3 / 68.7 |

- **Single figure, main task, native vs markup:** −9 % on desktop and −20 % on phone. FINDINGS says −16 % on both; that is within noise.
- **Stress10 desktop:** clean, as claimed, but the margin over the markup path is smaller here: 0.2 % vs 1.0 % dropped, against FINDINGS' 0 % vs 3.3 %.
- **FINDINGS' own rows:** two FINDINGS rows have only 2 usable runs because noisy runs were dropped: `centrifuge-gputime/native` desktop and `stress10-gputime/*` desktop. FINDINGS presents its perf numbers as "medians of 3".
- **Heap after GC:** flat over 2000 ticks (≈ +0.2 MB, the same as the markup path). The per-frame allocation claim fails (D1).

## Tests (`~/.claude/references/low-value-test-dictionary.md`)

- **`tools/test-native.mjs`: keep all four tests.**
  - The 7200-angle mirror test is a strong pure-logic contract test against the kit.
  - The template structure test and the palette-key test are boundary contract tests.
  - Gaps:
    - no test of `RotorModel` itself (ring build, depth sort and back/front split, change detection, `grow`). These are covered only in the browser.
    - no allocation test for the claim (D1);
    - the angle set never targets exact edge-on angles;
    - `fluff` is absent from the palette test.
- **`tools/native-gate.mjs`:**
  - `contract`, `identity` and `compare`: keep (see D2 for the contract's gaps).
  - `sheet` duplicates the motion gate's light run (category 6). Its stale header comment is D3.
  - No row covers injected kinds (D4).
- **`selftest:live` drop-native:** keep. It is the only mutation that touches the native path.

## Out of scope (v2 / kit / tooling)

- **v2 `KINDS` includes `fluff`.** `factory.css` has no `.pk[data-kind="fluff"]` palette, so fluff packets draw in the generic anatomy tones. That may be intentional, but it is undocumented.
- **v2 `centrifuge.accept(port, item, from)`** ignores `from` while calm (repeat of a QA-FIXA note).
- **The kit's `Math.hypot`** in `extrude` / `ringSeam` is the root of D1. Any native mirror of the kit inherits it.
- **Tooling:**
  - `HeapProfiler.stopSampling` with `includeObjectsCollectedBy*` hangs on these pages at sampling intervals ≤ 16 KB or over more than a few hundred turbo ticks. QA used 32 KB / 400 ticks.
  - `harness.mjs shot()` (`captureBeyondViewport`) still surfaces QA-FIXA D3.

## Reproduce (from `out/tmp/qa-m5/scripts`)

- `node timeline.mjs 3000 && node analyze.mjs kinds`
- `node visual.mjs kinds`, `node visual.mjs fade --dprs 1,2`, `node visual.mjs unknown --themes dark --dprs 2`
- `node sheet.mjs dark 590 60 2`, `node sheet.mjs light 1040 60 2`
- `node robust.mjs reduced|onframe|hidden|lossread|fallback|slowfallback|identity|toggle|theme|junk`
- `node --expose-gc --trace-gc model-alloc.mjs 100000 [as-is|hypot]`
- `INTERVAL=32768 TICKS=400 node heap.mjs dev`, `NOCOLL=1 INTERVAL=1048576 TICKS=2000 node heap.mjs gpu ["?native=0"]`
- Perf: in `out/tmp/qa-m5/v3-gpu`, `node bench/run-m5-rows.mjs --only centrifuge- --force` and `--only stress10-iframe- --force`. The committed JSONs were moved aside to `out/perf/m5-committed`.
