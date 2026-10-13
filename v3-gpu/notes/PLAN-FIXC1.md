# Fix loop C1: core / web robustness (QA-FIXA D1–D6, CQ-FIXA S2/S3/S7/S8/S9 + nits)

Scope (C1): `src/core/*` except `slots.ts` and the slot-ownership code of `renderer.ts`, `src/web/*` except
`dom-slots.ts` (and the native wiring C2 touches in `main.ts`), `src/live/*`, `tools/{live-edge,live-gate,gates,
gates.config,test-core}.mjs`, `notes/{GATES,GPU-API,PLAN-FIXC1,FINDINGS-FIXC1}.md`. Requests to C2 go to
`notes/FIXC-COORD.md`. Not done here (port-plan items P1/P2, documented in FINDINGS-FIXC1): CQ-FIXA S4 (explode move
vectors) and S6 (one shared device).

## Design

### Lifecycle (`frame-loop.ts`): D1, D5, D6, S7
- `this.root` is the device being initialised **or** drawn: assigned as soon as `createRoot()` resolves, before the
  `lost` handler is registered, so a loss during `compile()` reaches `onDeviceLost` (D1) and `simulateDeviceLoss()`
  works in that window too.
- Every `start()` takes a generation number; `init()` re-checks it after each `await`. A superseded or failed init
  disposes its renderer and destroys its root (only devices that never became current) — no leak (S7), never "ready"
  on a lost device (D1).
- Own destroys (dispose, fallback, superseded init) clear `this.root` first, so `onDeviceLost` sees only external
  losses: reason `destroyed` from outside is a loss like any other (re-init, bounded) — no freeze (D5).
- Reasons (D6): `no-adapter: …` (no root on the first start), `init-failed: …` (renderer / pipelines on the first
  start), `reinit-failed: <reason>` (any failure of a re-init after loss), `device-lost: lost again after 16 re-inits`
  (checked before counting: `reinits` stays 16), `render-error: …`. `adapterInfo` read with a guard.
- `GpuViewOptions.createRenderer` (default `new Renderer`) so Node tests run the real `Renderer` on a fake root.

### Frame validity (`renderer.ts`, `halo.ts`): D2, D3
- `render()` returns whether it drew. The cache and the halo masks become valid only after `encoder.submit()`
  returned; a throw anywhere in the frame invalidates both (and the region / partition bookkeeping that depends on
  the frame) and rethrows. A WebGPU validation error (`uncapturederror`) also invalidates the cache (its content is
  unknown).
- Zero size (D3): the renderer ignores `resize(0, …)` (keeps its targets) and draws nothing without targets; the
  frame loop does not count such frames; the web host never sets a 0 canvas backing and skips 0×0 observer entries;
  an unchanged size does not redraw. Resumes on the next non-zero size.

### Cache inputs: S2, S3
- `PaintTable.appearanceVersion`: bumped when a settled entry's rgba, width, cap, blend, blur, translate or stops
  change; `geometryVersion`: class, width or cap changed (both baked into static geometry). `render()` compares both
  (like the frame uniform): appearance → `invalidateCache('paints')` + halo masks; geometry → rebuild.
  `Renderer.paintsChanged()` is deleted.
- `SlotEnvelopes`: an extent reaching beyond the envelope grid marks its slot off-grid; while any slot is off-grid the
  frame is a full redraw (`lastRebuildReason` / `offGridFrames` stat). Dev assertion (`__GPU_DEV__`): every region
  rect's extent lies inside its envelope cells.
- Test hook `?cacheBug=skip-invalidate|skip-growth` (renderer option `cacheFault`): the gate self-test's stale-cache
  defects.

### D4 (`strokes.ts`)
Segments i and j = i ± 2, i ± 3 of one polyline (the shader's ownership window) whose distance is smaller than the gap
between the chain ends joining them lower both `crowd`s to that distance: a crossing or touching non-adjacent segment
then sends both to the exact loop. Smooth curves (closest points are the chain ends) keep the fast path.

### Web host teardown: S9
`__gpu.dispose()`: disconnects the resize / theme / resolution observers (AbortController), `GpuView.dispose()`
(renderer, painters, root), `DomSlotSource.release()` (slots get real DOM), deactivates the native rotor, shows the
SVG figure (`data-gpu=disposed`). Runtime hooks become no-ops.

### Nits
Hot-path allocations (frame uniform compare, view translate, halo prepare, region version, relayout order compare,
LiveSlots prepare / atlas packing), fewer `!`, texture usage flags without the default `COPY_*`, atlas shrink after
120 frames below half, opacity clamped to [0, 1] in live slots, history comments, `isOpaqueAlpha` in
`live/geometry.ts`, `LiveSlots.acquire` (C2 R1), native self-test rows (C2 R2).

## Acceptance criteria
1. A device lost (any reason, incl. external `destroy()`) at any point after `createRoot` re-initialises or falls back;
   never `ready` with a blank canvas. Fake-device unit tests at every await point + an edge-gate case.
2. A frame that throws (encode or submit) leaves no stale cache: the next successful frame == `?cache=0` (unit test
   with a throwing fake submit; edge case: submit throws on the theme-switch frame, the frame afterwards == a fresh
   page, 0 px).
3. `display:none` and screenshot-induced 0×0 sizes: 0 WebGPU errors, clean console, the frame after showing == a
   fresh page (0 px).
4. Precise reasons; a failed init destroys its device (unit test counts live fake devices).
5. Appearance / geometry changes invalidate the cache inside `render()` (unit test without `paintsChanged`); an
   off-grid extent gives full frames (unit test).
6. `tools/test-core.mjs` (node:test, no browser) in `npm test` and the `unit` row: envelopes, partition exactness
   (property test), paint versions, stroke crowd / ownership model incl. D4 shapes, frame loop scheduling and error
   paths with a fake device / clock.
7. D4: the ownership model shows no double claim on the D4 shapes after the fix (fails before); injected crossing
   shapes in a slot match SVG at the crossings (edge case); calib + static gates unchanged within thresholds.
8. Identity gate row `identity`: cached ≡ `?cache=0` (0 px incl. AA) over envelope-growth ticks, a theme switch, a
   resize, a device loss, native on and `?native=0`; `selftest:identity` (`skip-growth`) and
   `selftest:identity:invalidate` (`skip-invalidate`) are rejected.
9. `__gpu.dispose()` leaves 0 live GPU buffers / textures / query sets created by the page and the SVG figure
   animating (edge case).
10. `npm test`, `npm run gates:full` green; GPU pass / main-thread numbers (3-run medians) for perf-relevant changes.

## Test plan
- Iterate with `node --test tools/test-core.mjs`; `tsc -p src/tsconfig.json`; `node tools/build.mjs`.
- Show the new tests fail on the old code (D1, D2, D4, S2, S3) before applying the fix.
- Edge cases one by one: `node tools/live-edge.mjs --only <case>`; identity: `node tools/live-gate.mjs identity --quick`
  then full, plus both mutations.
- Perf: `node tools/live-gate.mjs perf` × 3 before / after (GPU pass, main thread).
- Final: `npm test`, `npm run gates:full`, `node tools/chrome-reap.mjs`.
