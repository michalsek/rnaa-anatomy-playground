# Gates

`npm run gates` (= `node tools/gates.mjs --quick`, ≈ 1.5 min) or `npm run gates:full` (`--full`, ≈ 5 min: every gate
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
| `unit` | `node --test tools/test-export.mjs tools/test-live.mjs` | exporter / DL format / debug renderer (M1); live slot geometry vs the exporter on recorded markup, translucent / blend / invisible paints, group fade layers, caps, draw merging, fast-path parser ≡ general parser | all tests pass (`test.todo`: miter joins on live strokes, a known M3 gap) |
| `dl` | `node tools/gate.mjs` | M1 static DL: structure, page / slot order, determinism, freshness, palette + roles in Chrome, DL→SVG pixels vs the v2 frame | unchanged from M1 (Δ>8 ≤ 50 px and < 0.1 %, blobs ≤ 8 px, any change < 1 %) |
| `static` | `live-gate.mjs static` | M2 static GPU frame (`out/gpu/static*.html`) vs the v2 page without its script, DPR 1 / 2 / 4 × dark / light; the synthetic fixture vs its SVG page at DPR 1 / 2; clean console, no `__gpu.error` | DPR 1: loose ≤ 0.15 % (0.082 / 0.114), incl. AA ≤ 0.3 % (0.13 / 0.23). DPR 2: ≤ 0.02 % (0.010 / 0.011), ≤ 0.12 % (0.052 / 0.090). DPR 4: ≤ 0.012 % (0.0004 / 0.0071), ≤ 0.06 % (0.020 / 0.045). Fixture DPR 1: ≤ 0.06 % (0.038), ≤ 0.18 % (0.129); DPR 2: ≤ 0.01 % (0.0056), ≤ 0.09 % (0.063). Solid blob ≤ 4 px everywhere (0) |
| `live` | `live-gate.mjs live` | M3: SVG vs GPU page at the same runtime tick: 24 ticks on both sides of every phase boundary and at the QA-M3 event ticks; two overlapping fades injected (1234, 1236: group layers); reduced motion; DPR 4 at 700 / 971. At every tick the runtime state (readout, `[data-status]` aria-live text, `centrifuge.status()`, every slot's markup) is equal; console clean on both pages; `__gpu.ready`, no error | the static limits at the same DPR (the live frame must sit on the static floor). Floors: DPR 2 loose 0.0113 / 0.0146 %, incl. AA 0.056 / 0.091 %; DPR 4 0.0007 / 0.0077 %, 0.020 / 0.046 % |
| `motion` | `live-gate.mjs motion` | 60 consecutive ticks (dark 870–929: release / fall / hand-off; light 700–759: spin-up with rotor back/front swaps): frame-to-frame change GPU / SVG, A→B→A toggles GPU / SVG, GPU-only toggles as an area, state equal at every frame | change ratio in [0.9, 1.1] (0.996 / 1.022); toggle ratio ≤ 1.15 (0.963 / 1.025); GPU-only solid blob ≤ 4 px (0; the ≈ 200 GPU-only toggling px per frame are AA noise along moving edges) |
| `edge` | `node tools/live-edge.mjs` | theme switch mid-animation; resize storm (7 sizes / DPRs incl. 2.625 during ticks 600–628, ending at 520 px); stage out of view and back; two device losses after ready; device loss before ready; device loss after ready with no adapter on re-init; no WebGPU; null adapter; unsupported markup (dev / prod); one GPU frame per runtime tick in real display frames; User Timing bounded | same page, same tick: 0 px loose (switched / stormed / lost vs a fresh load). Fallback vs SVG page: ≤ 0.001 % loose (0). Resize vs SVG at 520 px: loose ≤ 0.03 % (0.0215), incl. AA ≤ 0.15 % (0.075). Out of view: 0 ticks and 0 GPU frames over 30 delivered frames. User Timing ≤ 7,000 entries after 4,000 ticks (GPU page ≤ ≈ 6,000 by its 600-frame clearing). Draws: GPU frames == runtime ticks |
| `calib` | `live-gate.mjs calib` | hairline calibration sheet (`src/fixture/make-calib.mjs`, 232 cells: lines at 0–90° incl. the iso 2:1 slopes 26.565° / 153.435°, offset sweeps 0–0.8 for 0° / 90° / 2:1, zig-zag joins, ring, butt caps, short ticks, dots; widths 0.4 / 0.6 / 1.0 / 1.3; paper and graphite), GPU / SVG ink **per cell** | DPR 1: default [0.88, 1.15], lines 0.4 / 0.6 px [0.85, 1.25], ticks 0.4 px [0.9, 1.3], dots [0.8, 1.2]; DPR 2: [0.9, 1.15], ticks [0.9, 1.2]. Floors: DPR 1 0.874–1.168, DPR 2 0.954–1.102 |
| `determinism` | `live-gate.mjs determinism --ticks 3000` | per-tick runtime state hash (readout + status, `centrifuge.status()`, all slot markup serialized): SVG page twice, GPU page twice, SVG vs GPU over 3000 turbo ticks; SVG vs GPU and real vs turbo over 120 real-frame ticks | bit-identical (quick: 600 / 60 ticks) |
| `selftest:*` | each gate with `--mutate` | the gate must reject a deliberate defect: DL `drop-fill`; static `patch` (5 × 5 CSS px of grey over the figure); live `drop-slot` (rotorFront writes vanish on the GPU page); motion `pop` (the patch on one frame); calib `contrast` (canvas `contrast(1.3)`); determinism `no-rebase` | the row passes when the gate exits 1 through a failed check (a crash does not count) |
| `perf` | `live-gate.mjs perf` | CPU per frame (live-js, parse, upload, encode) and GPU pass from `__gpu.frameStats()`, 1280 px DPR 2, ×1 and ×4 CPU throttle, 300 frames | none (INFO row; `out/tmp/gates/perf.json`) |

Quick mode: `static` at DPR 2, `live` at 7 ticks + 2 fade ticks + 1 reduced tick per theme, `motion` 24 dark frames,
`edge` theme switch / hidden / loss after ready / no WebGPU / unsupported, `calib` dark DPR 2, `determinism` 600 ticks.

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
