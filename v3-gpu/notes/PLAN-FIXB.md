# PLAN — fix loop B: gates and test tooling

Owner: fix loop B. Owns `tools/{live-gate,live-edge,test-live,lockstep,diff,gate,gate-page,test-export}.*`, the new
`tools/{gates.mjs,gates.config.mjs,harness.mjs}`, `tools/fixtures/`, `src/fixture/*`, `package.json` scripts, this
file, `notes/FINDINGS-FIXB.md`, `notes/GATES.md`. Fix loop A owns `src/`, `export/`, `tools/build.mjs`, `out/gpu/*`
pages and refactors the renderer in parallel; `window.__gpu` stays backward compatible (additions in
`notes/GPU-API.md`). B never edits `src/` (except `src/fixture/`); renderer defects found by the gates go to A with a
repro command.

Inputs: QA-M2 (test-value review, D11), QA-M3 (D1 readiness race, D5, D8, test-value review), CQ-M2 S11/S12/N11,
CQ-M3 S3/S10/N9, FINDINGS-M3 #1/#2/#8.

## Work items

1. **One lockstep** (`tools/lockstep.js`). Options through `window.__LOCKSTEP_OPTIONS` set before the script:
   `mode: "real" | "turbo"` (FINDINGS-M3 #2: one virtual frame per macrotask), `rebase: "first-intersection"`
   (FINDINGS-M3 #1: virtual time restarts when the v2 runtime starts its loop, so two pages that boot in a different
   number of frames get bit-identical `dt`s), `waitReady` (QA-M3 D1 workaround: hold the runtime's start until
   `__gpu.ready || __gpu.error`). `step(k)` delivers empty frames, so it resolves on idle pages (CQ-M2 S12); unique
   rAF ids and a working `cancelAnimationFrame` in both modes; `realFrames(k)`; no growing `cancelled` set.
   `TURBO_LOCKSTEP` and `TICK_HOOK` leave `live-gate.mjs`; the CDP page helpers move to `tools/harness.mjs`.
2. **Gates that gate.** Every gate exits non-zero on failure; thresholds live in `tools/gates.config.mjs` and are
   explained in `notes/GATES.md`. Gates: `unit` (node:test), `dl` (M1, unchanged), `static` (M2 GPU static frame vs
   SVG, DPR 1/2/4 × light/dark, loose and incl-AA), `live` (M3 ticks incl. phase boundaries, fade injection, reduced
   motion; readout + aria-live equality; clean console), `motion` (consecutive-frame flicker vs SVG), `edge` (theme
   switch, resize storm, hidden/visible, device loss before/after ready, null adapter / no WebGPU fallback animating
   with a clean console, device loss followed by a failed re-init, unsupported markup dev throw / prod warn +
   `__gpu.error`), `calib` (hairline ink ratios per cell incl. the 2:1 iso slope and sub-pixel offset sweeps, no
   averaging over angles), `perf` (optional smoke, records numbers, never fails the run).
   `diff.mjs` refuses size mismatches and parses positionals after boolean flags.
3. **`test-live` on node:test, browser-free**, reading committed fixtures in `tools/fixtures/` (real markup recorded
   once from the SVG page, plus a recorded injected-fade intake), with a palette stub covering translucent,
   invisible and blend paints; group fade, caps / joins, draw merging, `kitPathData` ≡ `parsePathData`. Cache-hit
   numbers are not printed as a perf claim.
4. **Runner** `node tools/gates.mjs [--quick|--full] [--only a,b]` / `npm run gates`: summary table, non-zero exit
   on any gating failure, quick < ~2 min.
5. **Cleanup**: remove or merge low-value / orphaned tooling (low-value-test-dictionary), delete committed artifacts
   that cannot be regenerated or point at ignored files (QA-M3 D8), fix the timeline off-by-one.
6. **Run on HEAD** (`git archive HEAD` tree in `out/tmp/fixb/tree`, built with its own `tools/build.mjs`); renderer
   defects → FINDINGS-FIXB for A with repro commands.

## Acceptance criteria

- A1 Determinism: SVG page vs GPU page runtime state (`FACTORY` clock, centrifuge `status()`, readout, all slot
  markup hash) bit-identical at every tick over 3000 ticks; two runs of the same page identical. Proven by
  `node tools/live-gate.mjs determinism --ticks 3000` (part of `--full`).
- A2 Every gate: a failing check → exit 1; thresholds only in `gates.config.mjs`; each threshold documented.
- A3 Self-test: each pixel gate has a mutation that must make it fail (`--mutate`), run in `--full`.
- A4 `node --test tools/test-live.mjs` passes on a clean checkout without Chrome.
- A5 `npm run gates` (quick) < ~2 min on the M4 Pro; `--full` runs everything incl. self-tests.
- A6 No duplicate lockstep / image-diff code; no committed report that points at files the repo does not have.

## Test plan

- Lockstep: idle page `step(3)` resolves; same page twice → identical state hashes; SVG vs GPU over 3000 ticks
  (turbo, waitReady) → identical; real mode spot check (200 ticks).
- Gate self-tests: break each gate deliberately (drop a slot's draw via a preload, shift the canvas a pixel, force a
  readout mismatch, thicken hairlines) and check exit 1.
- Run quick and full on HEAD; record results and timings in FINDINGS-FIXB.
