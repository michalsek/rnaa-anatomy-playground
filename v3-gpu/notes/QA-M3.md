# QA: M3 live adapter (commit 4231c6d)

This is an independent re-run. I exported the code under test with `git archive 4231c6d v3-gpu` to `out/tmp/qa-m3/tree/`, with `node_modules` and `../v2-factory` symlinked read-only and the ignored `out/gate/*.html` copied in.

`tools/build.mjs` rebuilt from that tree gives `gpu.js`, `live.html` and `live-light.html` **byte-identical** to the committed files. So the build is reproducible, and the verbatim-script assertion holds.

Scratch scripts are in `out/tmp/qa-m3/scripts/`, and shots, crops, viewer sheets, reports and perf JSON are under `out/tmp/qa-m3/{shots,crops,view,reports,perf}`. Paths below are relative to `out/tmp/qa-m3/`. Machine: Apple M4 Pro, Chrome 155, adapter apple/metal-3. The machine was shared with other agents (cpuIdle 53–89 %), so treat timings as ±10 %.

## Verdict per acceptance criterion

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Live pages run the v2 script verbatim, animate like v2, and the readout and aria-live text equal the SVG page | **PASS** | Byte-identical rebuild, and the build asserts runtime.js and LIVE. Readout and `[data-status]` are equal at all 30 + 8 + 4 + 6 QA-chosen ticks (DPR 1/2/3/4, both themes, reduced motion, fades) and at all 60 + 60 + 60 + 40 consecutive motion ticks. The accessibility tree is identical to the SVG page (below). |
| 2 | Lockstep diffs ≤ 0.5 % (pixelmatch 0.1) at DPR 2, light + dark, through fill, spin, release and fade; strict Δ>8 reported | **PASS** | I reproduced the implementer's gate exactly: every number in `gate-dpr2.json` matches to 4 decimals. My own 30 ticks (phase boundaries, pocket entry, release, fall, lamp on/max/off, tach extremes, back/front swaps, random) give pixelmatch 0.0099–0.014 % with Δ>8 at 1.16–1.66 %. The static floor at the same DPR is 0.010/0.011 % with Δ>8 at 1.11/1.49 %. DPR 1 is 0.082–0.125 % (floor 0.082/0.114), DPR 3 is 0.005–0.007 %, DPR 4 is ≤ 0.008 %. Fades injected at tick 1234 (two overlapping packets, 28–30 group layers composited) stay on the floor. |
| 3 | Crops of rotor, pockets and packets at 1× and 4×, inspected | **PASS** (note) | I rendered at DPR 1 and DPR 4 rather than magnifying: `view/d1-rotor-light-t913.png`, `view/d4-spout-light-t913.png`, `view/d4-lamp-dark-t971.png`, `view/pocket-dark-t237.png`, `view/fade-light-t1239.png`. These cover the rotor, packets in pockets and in the spout, the lamp screen-blend glow at its brightest, the tach and the faded packets. I see no seams, fringes, ordering differences or inner edges in faded groups, and the ×4-amplified diffs are AA ramps only. Note: the implementer's crops are in `out/gpu/live-crops/`, which is gitignored, so they are not part of the commit and the committed reports point at files nobody else has. |
| 4 | 60 consecutive lockstep frames: no popping, no z-fighting, correct rotor back/front split | **PASS** | `scripts/motion.mjs` diffs 60 consecutive frames per page and counts pixels that toggle A→B→A. I ran it on dark 870–929 (release/fall/hand-off), light 700–759 (spin-up with back/front swaps at 711/734/757), dark 200–259 (drop → pocket at 237) and light reduced 1100–1139. GPU-vs-SVG difference per frame is flat (1073–1213 px, 2471–2573 px light), and the GPU/SVG frame-to-frame change ratio is 0.96–1.03. GPU flicker is never above the SVG's (e.g. 131 k vs 140 k toggles). Pixels that flicker only on the GPU page total 157–670 per 60 frames, which is AA noise at moving edges (`view/*-gpu-only-flicker.png`, `view/strip-*.png`). The packet is correctly behind the static post and the vane in the strip. Reduced motion: 0 flicker. |
| 5 | CPU cost per frame (median / p95, 600 frames) at 1280 DPR 2 and 390 DPR 3, 4× throttle | **PASS** (reproduced) | Re-run of `live-gate cost`. At 1280 DPR 2 4×: live-js 3.2/4.0, parse 3.6/4.6, upload 0.0/0.7, encode 0.6/1.1, GPU pass 4.1/7.0. At 390 DPR 3 4×: 3.1/3.9, 3.5/4.4, 0.0/0.6, 0.5/1.0, GPU pass 4.5/7.3. At 1280 1×: 0.9/1.7, 1.0/1.8, 0.0/0.1, 0.1/0.2, GPU pass 4.1/6.8. These are within ±10 % of FINDINGS. Caveat: User Timing is coarsened to 0.1 ms on this non-isolated page, so "upload 0.0" and "encode 0.1" are at the resolution limit. |

QA-M2 fixes:
- **D1 is fixed.** The canvas backing equals the snapped displayed box: 652 × 774.25 CSS → 1304 × 1548. The static floor at DPR 2 dropped from 0.26–0.32 % to 0.010 %. After a resize storm ending at 391 px DPR 3, the backing is 1005 × 1194 for a 397.81 px box, and that frame is 0 px different from a fresh load and 0.015 % from the SVG.
- **D7 is fixed.** The preview SVG is inserted before first paint (`scripts/fp.mjs`: preview at 47–61 ms, first paint at 44–84 ms, preview always first). Across 5 loads I sampled 0 blank frames and no frame with both preview and canvas visible. Ready takes 109–128 ms warm and 203 ms cold.

## Manual test plan (PLAN-M3)

| Case | Result |
|---|---|
| Fill → spin → release cycles | PASS. 30 QA ticks plus the implementer's 8, both themes. |
| Packets entering and leaving pockets | PASS: drop → pocket at 236/237 and 896, release at 883/884, fall 913–932, belt hand-off at 932. Packets are in the same slot and the same order against static parts. |
| Lamp, strobe, tach, gate, crank, pulleys, belt stubs | PASS: lamp on at 840, maximum at 971 (screen blend in dark, multiply in light), off at 1635; tach extremes at 202 and 762. |
| Empty slot strings | PASS: spout, fall, drop and lamp transitions to "" (e.g. 1116, 932, 237, 1635) leave nothing stale. |
| Unsupported markup | PASS with a deviation (D5). Dev throws at the write; prod draws the slot empty and warns once. |
| Theme switch mid-animation | PASS. `__gpu.setTheme` at 690 equals a fresh light load at 700 (0 px). A raw `body.dataset.theme` flip equals the fresh light GPU page and also the switched SVG page. Three CDP `Emulation.setEmulatedMedia prefers-color-scheme` flips during animation give 0 px against fresh dark, with no paint-count growth. Kit pages ignore the media query, so 0 px is the correct result. |
| Resize mid-animation | PASS: implementer's 1280→520 at 0.022 %. A 14-step storm (widths 360–1600, DPR 1/1.5/2/2.625/3) during ticks 600–650 is 0 px against a fresh load at both 900 px and 391 px DPR 3. |
| Tab hidden / IntersectionObserver | PASS. Scrolled out of view, ticks and frames freeze and resume (re-run). With a real background tab (another tab activated), frames stop while hidden and resume on return. `Page.setWebLifecycleState frozen→active` leaves **both** pages hidden with rAF stopped in headless Chrome. That is the same on both pages, so it is a tooling artifact and not a defect. |
| Reduced motion | PASS. Lockstep compare at 30/333/777/1501 sits on the floor with readouts equal (rpm 0.0, "passing packets"). In real time the GPU page draws about 2 frames/s, with 1.3 slots changed per drawn frame, because the dirty check skips unchanged slots. v2 still rewrites all 15 slots at 60 Hz (out of scope). |
| Packet fade group opacity | PASS: implementer's tick 400 reproduced, plus my injection of two overlapping packets at 1234 (DPR 1 and 2). |
| Device loss | PASS. In lockstep: two `simulateDeviceLoss()` calls at ticks 690 and 693, then tick 700 is 0 px against fresh. In real time: 3 losses 30–700 ms apart give reinits 3, frames continue and the console is clean. Note: `tools/live-edge.mjs` has no device-loss case, although FINDINGS lists it. |
| No WebGPU / null adapter | PASS. In both cases the SVG fallback animates (rotor markup and readout change), `data-gpu=fallback`, and the console is clean. Inconsistent internals: D4. |
| Long run | PASS. 10 000 turbo ticks: JS heap stays 4.8–5.6 MB after GC, nodes stay 4870, User Timing entries are bounded (≤ 4017, cleared every 600 GPU frames), GPU buffers settle at 46 created / 15 destroyed (2.40 MB live, no growth after the first 1000 ticks), textures stay at 4, and paints stay at 58. Encode is 0.1/0.2 ms and parse 0.7–1.2/1.0–1.7 ms with no drift. With a fade every 24 ticks over 6000 ticks, the buffers creep 2.56 → 2.76 MB (grow-only slot buffers following a fuller queue) and plateau. |

Real-time (non-lockstep) run: `drive.mjs` contact sheets of 60 frames on both pages in sync (`view/rt-sheet-{gpu,svg}.png`). There are no blank or stale frames and the readouts are equal frame for frame. rAF intervals over 400 frames: median 16.7 ms, p95 16.8 ms, on both pages; the only gaps are the capture stalls (max 100 ms GPU vs 83 ms SVG).

## Defects

**D1 (Medium for the gates, Low for the product). The GPU page never draws once a lockstep freeze lands before the renderer is ready.**
- **Code:** `src/main.ts:177` defers the flush as `queueMicrotask(() => renderer && draw())`. While `renderer` is null this drops the flush without clearing `DomSlotSource.pending` (`src/live/dom-slots.ts:70-75`). `attach()` → `markAllDirty()` (`adapter.ts:84-88`, `dom-slots.ts:51-54`) then never calls `onChange`. The only recovery left is `request()`'s rAF, which a frozen lockstep never delivers.
- **Repro:** `node scripts/probe-ready.mjs 30` gives `frames: 0, ready: false` indefinitely. In my first stock `live-gate.mjs compare --ticks 100,…` run, `settle` timed out after 60 s on a loaded machine. Whether `--ticks 100` (gate) or `60` (reduced) work depends on adapter init time.
- **Product impact:** none visible, because real rAF recovers one frame later.
- **Fix:** reset `pending` when the flush is dropped, or have `attach()` call `onChange()` unconditionally.
- **QA workaround:** `scripts/gpu-ready-gate.js` holds the runtime's IntersectionObserver callback until `__gpu.ready`. Rebase keeps it deterministic: the implementer's numbers reproduce exactly.

**D2 (Medium). Unbounded User Timing entries on the SVG fallback path; large batches under reduced motion.**
- **Code:** `src/main.ts:77-86` wraps every page rAF callback with `performance.mark` + `measure` whenever the page is live. The entries are cleared only inside `draw()` every 600 GPU frames (`:162-165`).
- With no WebGPU or a null adapter, `draw()` never runs, so marks and measures grow by 60/s each, forever (`scripts/leak.mjs`: 120 → 720 in 10 s, `gpuFrames: 0`). That is about 430 k entries per hour on exactly the devices that fall back.
- Under reduced motion GPU frames run at about 1.5/s, so roughly 24 k entries pile up between clears (about 400 s).
- **Fix:** install the wrapper only after the renderer exists, clear on a time or callback count, or remove the wrapper on fallback.

**D3 (Low, perf claim). The tessellation memo almost never hits.**
- `geometry.ts:360-371` keys meshes by the exact `d` string and clears at 4096 entries (`:17`). Rotating vanes and packets and translating slats produce a new `d` every frame.
- **Measured:** 2.8 % hit rate over 10 000 ticks (39 922 hits / 1 405 892 misses), with the cache cleared about every 30 ticks. The implementer's own `cost-*.json` agree: 3 800–3 933 hits vs 165 k misses (2.3 %); fades reach 23 %.
- `test-live.mjs` prints "mesh cache 56602 281" because it rebuilds the same 15 strings 200 times, which misrepresents the effect.
- **Impact:** parse is still the largest CPU item (3.5–4.0 ms at 4×). "Memoized tessellation" should not be credited in FINDINGS or the commit message. A translation-invariant key (belt, feed, intake) or a convex fast path would be the real win.

**D4 (Low). The two fallback paths bind the v2 runtime to different SVGs.**
- With `navigator.gpu` missing, the fallback is synchronous (`main.ts:134`). `canvas.replaceWith(preview)` happens before the module script runs, so `FACTORY.svg` is the real figure and `api.el`/`els` work.
- With a null adapter or an `init` failure (`main.ts:186-191`), the fallback happens after the runtime bound to the hidden skeleton. In that case:
  - `FACTORY.svg` is `svg.fx-live-slots` and `api.el`/`els` return null.
  - Every write goes through the interceptor and is forwarded.
- `scripts/fallback.mjs` shows `factorySvg: "iso-svg", apiEl: true` vs `"fx-live-slots", apiEl: false`.
- The centrifuge does not call `api.el`, but crusher and assembly do (`v2-factory/parts/crusher`, `assembly/build*.mjs`).

**D5 (Low). Unsupported markup in dev does not set `__gpu.error`.**
- PLAN-M3 says it should, but the re-run of `live-edge.mjs` shows `after: {errors: 0, error: null}`.
- The setter throws, so the runtime's tick aborts and the animation stops. Nothing on the page or in `__gpu` records why.

**D6 (Low, a11y). The figure has no accessible image during boot.**
- `showPreview` sets the canvas to `visibility:hidden` and gives the preview `aria-hidden` (`main.ts:99-101`). For the first ~110–200 ms the AX tree has neither `image:Centrifuge` nor the SVG.
- **Fix:** keep the preview's role and label until `reveal()`, or label the canvas without hiding it from AT.

**D7 (Info). Docs and comments have drifted.**
- `main.ts:213-218` contains two comment blocks about device pixels; the first ("trust it only when it agrees…") is stale.
- PLAN-M3 §3 names `src/live/slots.ts` (the file is `dom-slots.ts`).
- PLAN §6 lists `slotWrites`, `meshCache {hits, misses}`, `groups` and `ms.{liveJs,…}`. The actual `frameStats().live` is `{frames, slotsChanged, bytesUploaded, paints, errors, mesh:{meshHits,meshMisses,fills,segments}, gpu:{uploads,bytesUploaded,groups,layerPixels}, ms:{liveJs,parse,upload,encode,encodeWithGroups,gpu}}`.

**D8 (Info). Committed artifacts are stale or dangling.**
- `out/gpu/live-gate/timeline.json` (1700 ticks, filling at 148) is not what the committed tool produces: three runs give 1800 ticks with filling at 149 and identical output each time.
- `live-gate/*.json` crop paths and `edge.json` references point at gitignored or uncommitted files (`out/gpu/live-crops/`, `live-gate/gate-dpr2/*.png`).
- `tools/live-edge.mjs` cannot run until a `compare --tag gate-dpr2` run has produced those shots.

## Perf sanity (tools/perf.mjs, committed version, 3 runs each, medians, warmup 10 s)

| Page | 390 px DPR 3, 4× | 1280 px DPR 2, 1× |
|---|---|---|
| live.html | task **9.00** (7.91–9.12), script 8.15, style 0.02, layout 0.07, gpuMain 0.77, dropped 0 % | task **2.48** (2.32–2.91), script 2.15, gpuMain 0.73 |
| live-light.html | 8.65 (8.61–9.33), script 7.78 | 2.53 (2.28–2.89) |
| svg centrifuge-light | **13.65** (11.88–14.61), script 6.21, style 2.03, layout 1.03, gpuMain 3.32, dropped 0.6–1.9 % | **3.38** (3.20–3.63), style 0.47, layout 0.24, gpuMain 3.44 |
| svg centrifuge (dark) | 12.04 (11.96–12.63), dropped 0.8–1.3 % | 3.37 (3.26–3.66) |

FINDINGS-M3 numbers:
- **Phone (390 DPR 3, 4×):** confirmed. FINDINGS says GPU 8.8 vs SVG 12.1–13.2 ms; I measured 8.65–9.0 vs 12.0–13.7.
- **Desktop (1280 DPR 2, 1×):** slightly optimistic. FINDINGS says GPU 2.2 vs SVG 3.1–3.7 ms; I measured 2.48–2.53 vs 3.37–3.38.

How to read these numbers:
- The GPU page spends **more** main-thread script time than the SVG page (8.2 vs 5.5–6.2 ms at 4×). Its savings come from style, layout and the GPU process (gpuMain 0.75 vs 3.3–3.5 ms).
- `task` does not include the WebGPU pass itself: 4.1–4.5 ms median, p95 about 7 ms, from timestamp queries.

## Test-value review (low-value-test-dictionary; all three files are new on this branch)

**`tools/test-live.mjs`: keep and fix.** It is a contract test between `geometry.ts` and the M1 exporter on real markup, which is valuable because `geometry.ts` re-implements the exporter's rules. Gaps:
- The mock `paintOf` always returns opaque/normal (`:12`). Translucent fills, blend pipelines, draw-list merging and **group layering** (`<g opacity>`) are never exercised, because the recorded markup contains no fade (category 6 inverted: the group path has no unit coverage at all).
- It checks area totals, not per-primitive order or layer assignment.
- The "warm build … mesh cache" line is unasserted and misleading (D3), category 10.
- The kit-path fast path's equality claim ("equal on 2,114 paths") is not committed as a test. QA re-check (`scripts/kitpath.mjs`): 2 104/2 116 paths take the fast path, 0 differences, and edge forms ("M1e2…", "M1 2 L3 4") correctly fall back.
- Recommendation: add the injected-fade intake markup to `slot-markup.json`, assert group count, alpha and frontLayer, and assert `kitPathData == parsePathData`.

**`tools/live-gate.mjs compare`: category 10.**
- No threshold is asserted. The ≤ 0.5 % criterion, `readoutMatch` and `problems` are computed or printed, and the process always exits 0.
- `diffImages` (`:219-226`) silently crops images of different sizes, the same QA-M2 note that hid the original D1.
- It hangs on the readiness race (D1).
- `timeline` samples `status()` in `onFrame` at the **start** of a tick, so each row shows the previous tick's state (off by one; `scripts/recon.mjs` samples after the writes).
- `sheet` produces an image only (fine as a tool, not a gate). `cost`, `record` and `baseline` are measurement tools; keep them.

**`tools/live-edge.mjs`: category 10.**
- Every case only logs, including booleans such as `stoppedWhileHidden` and `resumed`, and it exits 0.
- It reads the reference shots of a previous run by fixed path.
- Missing cases that FINDINGS claims or that PLAN needs: device loss, null adapter, `__gpu.error` in dev.
- Keep it, but add assertions and make the references self-contained.

**Orphaned-tooling sweep:**
- `tools/lockstep.js` is now reachable only through `REAL_LOCKSTEP=1`. That path lacks `rebase` (non-deterministic across pages, FINDINGS #1) and `realFrames`.
- `TURBO_LOCKSTEP` duplicates its contract. Port the rebase into `lockstep.js` or retire the env path.
- `live-dev.html` (6.4 MB) is built on every build only for `live-edge` d).
- No unused exports found in `src/live/*`.

## Out-of-scope findings (v2 / kit / tooling)
- v2 LIVE rewrites all 15 slots every frame even under reduced motion (`centrifuge.mjs:1174-1182`, STUB_LIVE). The SVG page re-parses about 40 KB of markup at 60 Hz while the figure stands still; the GPU page's dirty check shows only 1.3 slots per drawn frame actually change.
- `runtime.js:11` binds `stage.querySelector("svg")`, the first SVG of the stage. That implicit coupling is why the GPU skeleton must stay first, and it causes D4.
- `api.el`/`els` are used by crusher and assembly; the known M3 gap (null on GPU pages) will break those pages.
- In headless Chrome, `Page.setWebLifecycleState frozen → active` leaves `visibilityState` hidden and rAF stopped. This affects any page, SVG included, so lifecycle tooling must not rely on it.
- `drive.mjs` `sheet` spacing is the capture time (~250 ms per frame on these pages), too coarse to see single-frame hitches. Lockstep motion analysis is the reliable way.
- The stage's focus ring is `:focus-visible` only. Programmatic focus shows no outline on either page (same on both).

## Reproduce (from `out/tmp/qa-m3/scripts`, tree at `../tree/v3-gpu`)
- Gate at the implementer's ticks: `node gate.mjs --ticks 100,300,520,700,900,1100,1300,1600 --tag gate-dpr2 --crops "$(cat ../../m3/crops.txt)"`.
- QA ticks: `node gate.mjs --ticks 149,202,236,237,320,461,593,594,711,762,779,780,837,838,840,883,884,896,901,913,932,971,1022,1293,1550,1551,1635,1646,2065,2141 --tag qa-dpr2`, then `--dpr 1|3|4` and `--reduced` variants.
- Fades: `node gate.mjs … --inject '1234:…accept(…)' --tag qa-fade`.
- Motion: `node motion.mjs --from 870|700|200|1100 …`.
- Edge cases: `node edge-lock.mjs`, `node edge-storm391.mjs storm`, `node edge-rt.mjs`, `node lifecycle.mjs`, `node fallback.mjs`.
- Readiness hang: `node probe-ready.mjs 30`.
- User Timing leak: `node leak.mjs`.
- Long runs: `node longrun.mjs 10000`, `node longrun.mjs 6000 --fades`.
- Boot: `node boot.mjs`, `node fp.mjs`.
- Fast-path parser: `node kitpath.mjs`.
- Event ticks: `node recon.mjs` + `node events.mjs`.
- Perf: `sh perf-batch.sh` + `node perf-sum.mjs`.
- Stock tools from `../tree/v3-gpu`: `node tools/live-gate.mjs timeline|record|baseline [--dpr 1|2|3]|cost …`, `node tools/test-live.mjs`, `node tools/live-edge.mjs`.
