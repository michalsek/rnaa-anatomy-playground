# Fix loop C1 findings (core/web robustness)

Result: `npm test` 70 pass / 1 todo; `npm run gates:full` all rows green (736 s) incl. self-tests; after two small follow-up edits (renderer.ts comments, halo bounds computed once in static-geometry.ts) tsc + unit + quick gates (189 s) green. chrome-reap: 0 orphans.

## Changes per finding
- **QA-FIXA D1 (device lost during startup)**: device recorded at creation (before compile); per-start generation number — overtaken starts discard renderer + device; readiness tracked per device; `simulateDeviceLoss()` works during startup. Edge case `loss-during-init` (loss 0/2 ms after creation, "unknown" and external destroy()): ready on a 2nd device, = fresh page 0 px (HEAD: blank, 56,581 px, 0 re-inits).
- **QA-FIXA D2 (failed frame → stale cache)**: cache valid only after submit() returns; any throwing frame invalidates cache, partition and halo masks; WebGPU validation errors invalidate via public `Renderer.invalidate`. Edge `submit-failure`: next frames = fresh light page (HEAD: 1.8M px off).
- **QA-FIXA D3 (zero-size canvas)**: host ignores 0×0 resize entries; renderer/view ignore zero/unchanged sizes; `render()` returns whether it drew (nothing counted/ready before a size). Edge `zero-size` (display:none + hidden screenshot): 0 WebGPU errors (HEAD 13); = fresh page after re-show.
- **QA-FIXA D5 (external destroy freezes)**: own destroys clear the current device first → any observed loss is external (incl. `destroyed`) → bounded re-init. Edge `external-destroy`.
- **QA-FIXA D6 + CQ-FIXA S7**: reasons `no-adapter:`, `init-failed:`, `reinit-failed: <inner>`, `device-lost: lost again after 16 re-inits`, `render-error:` (3 consecutive throws); failed/overtaken starts dispose renderer + destroy device; guarded adapterInfo. Unit tests check each reason and 0 live devices.
- **CQ-FIXA S2**: `PaintTable.appearanceVersion` (colour, width, cap, blend, blur, translate, stops) + `geometryVersion` (paint class, width, cap) compared inside render(); `paintsChanged()` deleted.
- **CQ-FIXA S3**: slot extent leaving the envelope grid → off-grid → full frames while any slot off-grid (`stats.offGridFrames`); `covers()` + dev assertion that every redraw rect lies inside its slot's envelope.
- **CQ-FIXA S8**: new tools/test-core.mjs (node:test, no browser, 19 tests; in `npm test` and the `unit` row) running the real Renderer + frame loop on a fake TypeGPU device and clock: partition-exactness property test (40 seeds, random explode offsets, DPR 1–3, stepped growth), envelopes + off-grid, paint versions → invalidation, stroke ownership model, one frame per tick, every loss/failure/dispose path. D1, D2, D3, D4, D6, S2, S3 tests fail on HEAD.
- **QA-FIXA D4 (non-adjacent crossing double blend)**: strokes.ts — segments 2–3 apart that come closer than the intervening segments explain lower both crowd values → exact path; smooth curves keep fast path; `CHAIN_TOLERANCE` exported (C2 mirrors it in the rotor shader). Unit: no pixel blended by two non-adjacent segments over QA shapes + 200 random walks (turns ≤ 90°). Edge `stroke-crossing`: darkest crossing pixel 208.1 GPU vs 208.1 SVG (HEAD 191.2). Static/calib unchanged; exact-path share on centrifuge 10.5 % → 11.5 %.
- **Identity gate**: rows `identity`, `selftest:identity`, `selftest:identity:invalidate` — cached = `?cache=0` 0 px incl. AA at scanned envelope-growth ticks (t and t+1), after theme switch, after resize to 900 px @DPR 1.5, after device loss; dark + light native, dark `?native=0`. Hook `?cacheBug=skip-growth|skip-invalidate`: both caught (skip-invalidate 1.76M px at theme switch).
- **CQ-M2 S9 (teardown)**: `__gpu.dispose()` — observers/listeners off, view + painters + device disposed, native rotor deactivated, slots released to DOM, SVG shown, `html[data-gpu=disposed]`. Edge `dispose`: 39 GPU objects before → 0 alive; figure = SVG page and animates.
- **Nits**: steady frames allocation-free in renderer/halo/group layers; `!` removed (renderer 15→0, slot renderer 4→0, paint table 3→0); exact texture usage flags; atlas shrinks after 120 frames below half area; live opacities clamped; `isOpaqueAlpha` replaces literal 0.999; history comments removed.
- For C2: `LiveSlots.acquire` added, `release` frees slot buffers; C2's native gate rows wired into gates.mjs.

## Skipped (port-plan items)
- CQ-FIXA S4 explode move vectors (PORT-PLAN P1): DL has no per-item move → explode only reorders; offset paths exercised only by the property test.
- CQ-FIXA S6 shared device (PORT-PLAN P2): still one device per figure.
- Pre-existing, low impact: exact-path segment next to a fast-path neighbour can disagree in the outer wedge of their joint (AA level, not D4).
- Unchanged: allocations in the slot-markup parser; `debugRect` naming.

## Perf (1280 DPR2, medians of 3 vs frozen HEAD)
GPU pass 1.57 / 1.57 ms (×1 / ×4) both; steady clock 1.147 → 1.130 ms; encode 0.20 / 0.60 → 0.20 / 0.70 ms — no measurable change (timestamps quantized to 65.5 µs, CPU clock to 0.1 ms).

## Open for C2
C1-1: a native painter that encodes compute work into a frame that then fails to submit is never told → stale records until the model changes (maybe never under reduced motion). Proposed optional `SlotPainter.invalidate?()` called from `Renderer.invalidate`.
