# Gates

`npm run gates` (= `node tools/gates.mjs --quick`, ≈ 1.5 min) or `npm run gates:full` (`--full`, ≈ 12 min (736 s at fix loop C1): every gate
in full, the self-tests and the perf smoke). `--only a,b` / `--skip a,b` pick rows. The runner prints a table and exits
1 when any gating row fails. Logs: `out/tmp/gates/logs/<row>.log`; reports: `out/tmp/gates/<gate>.json`; shots and diff
images: `out/tmp/gates/<gate>/`. Pages must be built first: `node export/export.mjs && node tools/build.mjs`.

Every threshold lives in `tools/gates.config.mjs`. The floors below were measured on HEAD `f2f9289` (code = `0b84fe6`)
on the reference machine (Apple M4 Pro, Chrome 155 headless, adapter apple / metal-3). A threshold is the floor plus a
margin of ≈ 1.3–2×, so a regression the size of QA-M2 D1 (+0.25 % at DPR 2) fails by a factor of ten, and noise does not.

## Measures

- **loose**: pixelmatch, threshold 0.1, anti-aliased pixels excluded (pixelmatch's own AA detector), in % of the frame.
- **incl. AA**: the same with AA pixels counted.
- **solid blob**: the largest 8-connected blob of loose differences that survives a 3 × 3 erosion, in device px. A
  missing, moved or popping area survives the erosion; AA noise and a hairline drawn a little lighter or heavier (a
  long 1 px wide line of differences, e.g. the `centrifuge.leg#3` edge at DPR 1, QA-M2 D9) do not. Every clean run
  measures 0, so the limit is 4 px. Without the erosion the largest blob is 123–253 px (that hairline), which would
  force a limit too loose to see a part go missing.
- **Δ>8**: any channel moved by more than 8 of 255. Reported, not gated: it counts every AA ramp (1.1–1.7 % on clean
  runs).
- Images of different sizes are refused (`tools/diff.mjs`), never cropped.

## Rows

| Row | Command | What it asserts | Thresholds (floor measured on HEAD) |
|---|---|---|---|
| `unit` | `node --test tools/test-export.mjs tools/test-live.mjs tools/test-native.mjs tools/test-core.mjs` (= `npm test`) | exporter / DL format / debug renderer (M1); live slot geometry vs the exporter on recorded markup, translucent / blend / invisible paints, group fade layers, caps, draw merging, fast-path parser ≡ general parser; **fix C1** `test-core`: static-cache partition exactness (property test with explode offsets and stroke widths), envelopes / off-grid, paint versions → cache invalidation, stroke ownership model (no pixel blended by two non-adjacent segments, QA-FIXA D4), the frame loop and renderer on a fake device (frames == ticks, device loss at every lifecycle point, failed frames, zero sizes, failure reasons, no device leak, dispose); **fix C2** `test-native`: kit mirror ≡ kit for 4- to 64-point rings (incl. exact edge-on angles); `hypot2` ≡ `Math.hypot` bit for bit (2·10⁶ inputs); v2's whole page script (kit + runtime + centrifuge LIVE + stubs) runs in Node with the hook injected as the build does (`tools/v2-page.mjs`): `RotorModel` ≡ v2's rotor strings at every one of 3000 ticks, all six packet kinds, and four mutated literals (20.4, 0.45, 0.6, 0.1) are caught; the build injection rejects a renamed v2 variable; native host with fakes (two machines per page, per-machine failure → markup path, painters at attach, late definitions, symmetric slot ownership) | all tests pass (`test.todo`: miter joins on live strokes, a known M3 gap) |
| `dl` | `node tools/gate.mjs` | M1 static DL: structure, page / slot order, determinism, freshness, palette + roles in Chrome, DL→SVG pixels vs the v2 frame | unchanged from M1 (Δ>8 ≤ 50 px and < 0.1 %, blobs ≤ 8 px, any change < 1 %) |
| `static` | `live-gate.mjs static` | M2 static GPU frame (`out/gpu/static*.html`) vs the v2 page without its script, DPR 1 / 2 / 4 × dark / light; the synthetic fixture vs its SVG page at DPR 1 / 2; clean console, no `__gpu.error` | DPR 1: loose ≤ 0.15 % (0.082 / 0.114), incl. AA ≤ 0.3 % (0.13 / 0.23). DPR 2: ≤ 0.02 % (0.010 / 0.011), ≤ 0.12 % (0.052 / 0.090). DPR 4: ≤ 0.012 % (0.0004 / 0.0071), ≤ 0.06 % (0.020 / 0.045). Fixture DPR 1: ≤ 0.06 % (0.038), ≤ 0.18 % (0.129); DPR 2: ≤ 0.01 % (0.0056), ≤ 0.09 % (0.063). Solid blob ≤ 4 px everywhere (0) |
| `live` | `live-gate.mjs live` | M3: SVG vs GPU page at the same runtime tick: 24 ticks on both sides of every phase boundary and at the QA-M3 event ticks; two overlapping fades injected (1234, 1236: group layers); reduced motion; DPR 4 at 700 / 971. At every tick the runtime state (readout, `[data-status]` aria-live text, `centrifuge.status()`, every slot's markup) is equal; console clean on both pages; `__gpu.ready`, no error | the static limits at the same DPR (the live frame must sit on the static floor). Floors: DPR 2 loose 0.0113 / 0.0146 %, incl. AA 0.056 / 0.091 %; DPR 4 0.0007 / 0.0077 %, 0.020 / 0.046 % |
| `motion` | `live-gate.mjs motion` | 60 consecutive ticks (dark 870–929: release / fall / hand-off; light 700–759: spin-up with rotor back/front swaps): frame-to-frame change GPU / SVG, A→B→A toggles GPU / SVG, GPU-only toggles as an area, state equal at every frame | change ratio in [0.9, 1.1] (0.996 / 1.022); toggle ratio ≤ 1.15 (0.963 / 1.025); GPU-only solid blob ≤ 4 px (0; the ≈ 200 GPU-only toggling px per frame are AA noise along moving edges) |
| `edge` | `node tools/live-edge.mjs` | theme switch mid-animation; resize storm (7 sizes / DPRs incl. 2.625 during ticks 600–628, ending at 520 px); stage out of view and back; two device losses after ready; device loss before ready; device loss after ready with no adapter on re-init; no WebGPU; null adapter; unsupported markup (dev / prod); one GPU frame per runtime tick in real display frames; User Timing bounded. **Fix C1**: `loss-during-init` (the first device lost 0 / 2 ms after creation while pipelines compile, reason `unknown` and an external `destroy()`), `external-destroy` (after ready), `submit-failure` (`queue.submit` throws on the theme-switch frame), `zero-size` (stage `display:none` + a `captureBeyondViewport` screenshot), `dispose` (`__gpu.dispose()`), `stroke-crossing` (non-adjacent segments crossing / touching at 90° turns, stroke-opacity .6, in the lamp slot). **Fix C2** `submit-failure-native`: reduced motion, the frame whose rotor changed fails at submit (its compute expansion never ran); after 5 quiet ticks one requested frame == a fresh page (`SlotPainter.invalidate`; without it 2859 px differ) | same page, same tick: 0 px loose (switched / stormed / lost / failed-submit / hidden vs a fresh load). Fallback vs SVG page: ≤ 0.001 % loose (0). Resize vs SVG at 520 px: loose ≤ 0.03 % (0.0215), incl. AA ≤ 0.15 % (0.075). Out of view: 0 ticks and 0 GPU frames over 30 delivered frames. User Timing ≤ 7,000 entries after 4,000 ticks (GPU page ≤ ≈ 6,000 by its 600-frame clearing). Draws: GPU frames == runtime ticks. Loss during init: ready, `reinits` 1, no error. Zero size: 0 WebGPU errors, clean console. Dispose: 0 GPU buffers / textures / query sets alive when the device is destroyed (39 before), the device destroyed, the SVG figure == the SVG page (≤ 0.001 %). Crossings: the darkest pixel within 3 px of each crossing at most `EDGE.crossingDarkerLevels` = 6 luminance levels darker than the SVG page's (measured 0; HEAD 17 at the k = 3 crossing) |
| `calib` | `live-gate.mjs calib` | hairline calibration sheet (`src/fixture/make-calib.mjs`, 232 cells: lines at 0–90° incl. the iso 2:1 slopes 26.565° / 153.435°, offset sweeps 0–0.8 for 0° / 90° / 2:1, zig-zag joins, ring, butt caps, short ticks, dots; widths 0.4 / 0.6 / 1.0 / 1.3; paper and graphite), GPU / SVG ink **per cell** | DPR 1: default [0.88, 1.15], lines 0.4 / 0.6 px [0.85, 1.25], ticks 0.4 px [0.9, 1.3], dots [0.8, 1.2]; DPR 2: [0.9, 1.15], ticks [0.9, 1.2]. Floors: DPR 1 0.874–1.168, DPR 2 0.954–1.102 |
| `determinism` | `live-gate.mjs determinism --ticks 3000` | per-tick runtime state hash (readout + status, `centrifuge.status()`, all slot markup serialized): SVG page twice, GPU page twice, SVG vs GPU over 3000 turbo ticks; SVG vs GPU and real vs turbo over 120 real-frame ticks | bit-identical (quick: 600 / 60 ticks) |
| `native:contract` | `native-gate.mjs contract` (dev page) | at every LIVE tick (quick: 5), with packets of every kind injected (`NATIVE_INJECT`: audio / garbage at 60, fluff + an unknown kind at 400, another unknown + audio at 1300), the GPU-expanded records equal the markup path's: polyline count, order, paint, **width, alpha, item, caps at both ends** (fix C2), layer order, every point; fill area per paint; faces + top cover the hull the native path omits; **joins, crowd and flags equal what `SegWriter` writes for the read-back polylines** (fix C2). In-run self-test: six mutations of the read-back records (crowd, join, width, tone, item, caps) must each be rejected at every tick. The browser's `Math.hypot` ≡ `hypot2` (10⁶ inputs) | points ≤ 0.08 viewBox units apart (the kit rounds to 0.1: ≤ 0.0707; measured max 0.0675); area Δ ≤ 0.08 × boundary length (measured ≤ 23 % of that bound); joins ± 1e-3, crowd ± 1e-3 below 10 viewBox units (`NATIVE_STROKES`: the GPU recomputes neighbour end points in f32, tilting joins by ≤ 2.5e-5) |
| `native:identity` | `native-gate.mjs identity` | native page cached == `?cache=0` at rotor ticks, both themes; after two device losses the native painter draws again and the frame == a fresh page == `?cache=0` | 0 px (incl. AA) |
| `native:compare` | `native-gate.mjs compare` (full) | lockstep native vs markup path (`?native=0`) vs SVG, 11 ticks × DPR 1 / 2 / 4 × both themes; runtime state equal on all three; crops of the rotor at ×1 / ×4; **fix C2**: `NATIVE_INJECT` packets on all three pages | native vs SVG: the live limits of the DPR. Native vs markup path: solid blob ≤ 4 px (0), loose ≤ half the live limit (measured max 0.004 % DPR 1, 0.0011 % DPR 2, 0.0014 % DPR 4) |
| `native:sheet` | `native-gate.mjs sheet` (full) | 60 consecutive native frames, light 700–759 (spin-up, rotor back / front swaps): contact sheet + no frame with a solid blob vs SVG | solid blob ≤ 4 px (0) |
| `native:fault` | `native-gate.mjs fault` (quick + full) | **fix C2** error containment: a packet kind the native rotor refuses (`"bad kind"`) reaches the rotor between ticks 300 and 600; the machine fails alone (`__gpu.errors`, `__gpu.error` null, host active), the frame equals the `?native=0` page from then on, runtime state == SVG page | 0 px incl. AA at 600 / 711 / 884 / 932 / 1100 |
| `selftest:native:identity` | `native-gate.mjs identity --quick --mutate patch` (full) | **fix C2** a 1 CSS px grey dot on the cached page: the 0 px identity must reject it | passes when the gate rejects it |
| `live:markup` | `live-gate.mjs live --quick --native 0` (full) | the live gate on the markup path (`?native=0`), which the default pages no longer exercise for the rotor | as `live` |
| `identity` | `live-gate.mjs identity` | **fix C1** static-cache identity: the cached page and its `?cache=0` twin, both lockstep, the same ticks and events: envelope-growth ticks t and t + 1 (found by a scan of the cached page over ticks 120–1099, 10 spread over the 33 found; quick: 4), then a theme switch (1150), a resize to 900 px DPR 1.5 (1170) and a device loss (1190, the envelopes re-grow afterwards); dark and light with the native rotor, dark `?native=0` (quick: dark native) | 0 px incl. AA at every shot; the cached page drew cached frames, `?cache=0` none; both re-initialised once, no error; consoles clean |
| `selftest:*` | each gate with `--mutate` | the gate must reject a deliberate defect: DL `drop-fill`; identity `skip-growth` (`?cacheBug=skip-growth`: the partition is not extended when an envelope grows; caught at every growth tick) and `selftest:identity:invalidate` `skip-invalidate` (`?cacheBug=skip-invalidate`: the cache texture is kept over invalidations; caught after the theme switch); static `patch` (5 × 5 CSS px of grey over the figure); live `drop-native` (the native rotor draws no pocketed packets — v2's state and its on-demand strings stay intact, so only the pixels can catch it) and live:markup `drop-slot` (rotorFront writes vanish, `?native=0`); motion `pop` (the patch on one frame); calib `contrast` (canvas `contrast(1.3)`); determinism `no-rebase` | the row passes when the gate exits 1 through a failed check (a crash does not count) |
| `package` | `node tools/package-gate.mjs` (quick: `--quick`) | **M4** the deliverables `centrifuge-gpu(-light).html`: byte-identical to `out/gpu/live(-light).html` (so every row above ran on the deliverable bytes), no external references; over `file://` and `http://127.0.0.1` both themes ready with `html[data-renderer=webgpu]`, native rotor active, one renderer console line, console clean; `?native=0` / `?cache=0`; fallbacks no WebGPU / null adapter / no `DecompressionStream` → `data-renderer=svg`, reason, figure animates; vs the committed v2 page at the same tick (light 711 + reduced 600; full: both themes 711 / 884 / reduced 600), runtime state equal | the live limits at DPR 2 (measured loose 0.0118 %, incl. AA 0.089–0.091 %, solid blob 0) |
| `perf` | `live-gate.mjs perf` | CPU per frame (live-js, parse, upload, encode) and GPU pass from `__gpu.frameStats()` (page opened with `?gpuTime`: timestamps are off by default since M5), 1280 px DPR 2, ×1 and ×4 CPU throttle, 300 frames | none (INFO row; `out/tmp/gates/perf.json`) |

Quick mode: `static` at DPR 2, `live` at 7 ticks + 2 fade ticks + 1 reduced tick per theme, `motion` 24 dark frames,
`edge` theme switch / hidden / loss after ready / loss during init / submit failure / zero size / no WebGPU /
unsupported, `calib` dark DPR 2, `determinism` 600 ticks, `identity` dark native with 4 growth ticks.

## M5: the native rotor

Default live pages draw rotorBack / rotorFront / spout / fall natively (notes/FINDINGS-M5.md). The runtime-state checks
still compare v2's slot strings: reading a native slot's `innerHTML` makes v2 build them for the current state. No
global threshold changed; the native path sits on the same floors (live DPR 2 loose 0.0109–0.0136 % vs 0.0103–0.0129 %
on the markup path).

Fix C2 added `NATIVE_STROKES`, `NATIVE_INJECT`, `NATIVE_FAULT` and `NATIVE_ROWS` (a separated block at the end of
`tools/gates.config.mjs`; `tools/gates.mjs` spreads the rows). The stroke tolerances are f32 noise bounds, not quality
limits: a flipped join, a halved crowd or a wrong width fails by orders of magnitude (the contract's in-run mutations).
`tools/test-native.mjs` reads `out/svg/centrifuge.html` (v2's page script and `__FACTORY_DATA__`): run
`node export/export.mjs` first, as for the gates.

## Why these numbers

- Static and live share limits: a live frame has no reason to be further from the SVG than the static frame is, and the
  M3 floors equal the M2 floors to within 0.005 %.
- DPR 1 is loose because Chrome's own SVG hairline weight depends on path structure (QA-M2 D9: the reference is
  inconsistent, the GPU follows exact coverage); the solid-blob limit still catches a missing area there.
- Same-page identities (theme switch, resize storm, device loss) are exact: QA-M3 measured 0 px and so does the gate.
- Calibration limits are per cell, so one phase or one angle drawing too light fails on its own (QA-M2: the old means
  hid 45° / 0.4 px at 0.65).
- The motion gate does not count GPU-only toggling pixels (≈ 200 per frame of AA noise at moving edges); it gates on
  their largest eroded area, which is 0 on clean runs and 64 px for a 5 × 5 CSS px patch popping for one frame.

## Lockstep (`tools/lockstep.js`)

One implementation, options via `window.__LOCKSTEP_OPTIONS` (`tools/harness.mjs lockstepPreload()`):
- `mode: "turbo"` (gates): one virtual frame per MessageChannel task, 3000 ticks in ≈ 5 s; `"real"` (default, and the
  draw-count case): one virtual frame per display frame, every callback in its own native rAF callback.
- `rebase: "first-intersection"`: virtual time restarts when the v2 runtime starts its loop (FINDINGS-M3 #1). Without
  it the SVG and GPU pages diverge from tick 2 (self-test `selftest:determinism`).
- `waitReady: true`: the runtime's start waits for `__gpu.ready || __gpu.error` (QA-M3 D1 workaround).
- `step(k)` resolves on idle pages (delivers empty frames); `cancelAnimationFrame` works; `realFrames(k)` presents.

## Maintenance

- Threshold changes go to `tools/gates.config.mjs` and this file together, with the new floor.
- `tools/fixtures/live-markup.json` is re-recorded with `node tools/live-gate.mjs record` when the v2 centrifuge LIVE
  changes (the unit tests read it).
- `src/fixture/make-calib.mjs` regenerates the calibration sheet; `tools/build.mjs` then rebuilds `calib-gpu*.html`.
- Gate commands used before fix loop B still work as aliases: `live-gate.mjs compare` → `live`, `baseline` → `static`,
  `cost` → `perf`.
