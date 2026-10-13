# Fix loop A: renderer architecture and GPU cost

Scope: `src/**`, `export/**` (shared rule modules), `tools/build.mjs`, `out/gpu/*` pages, `notes/PLAN-FIXA.md`,
`notes/FINDINGS-FIXA.md`, `notes/GPU-API.md`. Fix loop B owns the gate tooling (`tools/{live-gate,live-edge,test-live,
lockstep,diff,gate,gate-page,test-export}.*`); loop A only runs those tools read-only, or its own scratch harness in
`out/tmp/fixa/` when they are mid-edit. `window.__gpu` stays backward compatible; additions go to `notes/GPU-API.md`.

## Step 0 measurements (HEAD 0b84fe6, before any change)

Real-time live page, 1280 px DPR 2, timestamp span of the main pass (median / p95, `out/tmp/fixa/gputime.mjs`):
4.3 / 7.2 ms; 390 px DPR 3: 4.3 / 7.3 ms. Targeted experiments on a scratch copy (`out/tmp/fixa/exp/`, URL toggles):

| variant | main pass median ms |
|---|---|
| full frame | 3.6–4.6 |
| strokes skipped | 0.98 |
| opaque fills skipped | 4.1 (no gain: opaque fills are cheap, early-Z) |
| empty pass (clear + resolve only) | 0.13 |
| stroke fragment shader = constant colour | 1.9 |
| stroke quads collapsed to zero area (vertex work only) | 0.66 |
| no neighbour loop | 3.5–3.6 (p95 7.3 → 4.8) |
| no `discard` | 4.4 (no gain) |
| 1× instead of 4× MSAA | 1.3 |
| 4 passes per frame, time per pass | 1.7 (GPU clocks up: DVFS halves the per-pass time) |
| 4 passes/frame: no loop / strokes skipped | 1.28 / 0.82 |
| transient (memoryless) MSAA colour + depth | ±0 |
| MSAA colour + depth full copy + `load` (empty scene) | +0.6 ms over a cleared pass at 1304 × 1548 |

Reading: the cost is the stroke **fragment** work (≈ 2.2 ms of a 4 ms frame at idle clocks), then MSAA blending of
the stroke quads, then the per-fragment neighbour loop (≈ 0.4 ms at raised clocks). It does not scale with resolution
because hairlines stay ≈ 1 device px wide (stroke fragments grow with DPR, not DPR²), every segment pays a minimum
3.2 × 3.2 px padded quad, and the GPU runs at lower clocks when the frame is lighter (DVFS). A prototype that
computed the join data in the vertex shader from neighbour reads lost the whole gain to vertex work → join data must
be precomputed.

## Design

### Module layout (core = no DOM; web host = everything DOM)
```
src/core/schemas.ts        d.struct layouts (Frame, Item, Paint, Gradient, Stop, Seg, FillVertex, GroupParams, …),
                           derived byte sizes / word offsets (d.memoryLayoutOf), GPU flag constants. typegpu/data only.
src/core/paint.ts          BlendMode, ResolvedPaint, PaintDesc, PaintClass, classifyPaint(), PaintTable (keys, descs,
                           resolved, classes; append + resolve-once batching)
src/core/scene.ts          GpuScene (renderer-facing scene), orderOf
src/core/dl-loader.ts      DL → GpuScene via export/dl-format.mjs (sectionsOf, FIELD_WORD, flags, gradient ids)
src/core/strokes.ts        polyline → Seg records (caps, joins, join bisectors, crowding distance): shared by static
                           geometry and live slots
src/core/static-geometry.ts GpuScene + paint classes → packed typed arrays, per-item draw entries, entry bounds
src/core/draw-list.ts      painter order (items + slot pseudo-items) → draws, stroke order indices, depth bases
src/core/static-cache.ts   slot envelopes + cached / per-frame partition
src/core/halo.ts           HaloEffect (owns its textures, buffers, bind groups; dispose)
src/core/pipelines.ts      typed pipeline set
src/core/shaders.ts        WGSL functions; flags as tgpu.const from schemas.ts
src/core/renderer.ts       GPU resources + frame encoding; takes a RenderSurface (context, format, present hook)
src/core/frame-loop.ts     lifecycle: init, device-loss reinit (bounded), frame scheduling, error policy, stats
src/core/profiler.ts       Clock + Profiler (User Timing only when enabled)
src/live/*                 SlotSource contract, LiveAdapter, SlotGeometryBuilder (export/ rules), SlotRenderer
src/web/*                  boot, DOM slot source, DOM palette resolver (export/palette-probe.mjs), sizing, theme,
                           preview / fallback / a11y, window.__gpu
```
A native slot renderer (M5 rotor) registers through `SlotPainter` (draw opaque / blended at the slot's painter
position, report its depth-slot count and envelope); the DOM slot path is one implementation of it.

### Static layer cache (priority 1a)
Revised during implementation (the first design below was built and measured; FINDINGS-FIXA has the numbers):
- First design (as recommended): persistent 4× MSAA colour + depth of the cached prims, full copy each frame, per-frame
  set P = slot envelopes closed transitively over "static blended prim in front of a member of P with overlapping
  bounds". Rejected: the copy + load alone costs 0.6 ms at 1304 × 1548, and the closure cascades through connected
  outlines to ≈ 60–70 % of all segments.
- Implemented: region redraw. The cache is the resolved static frame (single sample). A cached frame clears, marks
  the slots' current extents in the stencil, writes the cached colour into every sample outside them and redraws
  inside them (stencil test) the slots and every static entry / segment / opaque triangle reaching the slot
  envelopes (cell sets, grown adaptively; growth extends the partition incrementally, no cache re-render).
- Depth: every slot reserves a depth range (256, doubling), so static depth values do not move with slot content.
- Cache texture re-rendered on resize / DPR / theme / layout (order, explode share, depth ranges) / device loss;
  explode drags draw full frames until the share is stable for 2 frames.
- Debug: `?cache=0` (always full redraw), `?cache=overlay` (envelope cells and per-frame entries drawn on top).

### Stroke shader (priority 1b)
- Seg gains precomputed join bisectors (start / end) and a crowding distance (where a segment's join lines meet, the
  far ends of the adjacent segments at turns sharper than 90°, 0 at hairpins), computed on the CPU per polyline
  (static: once; live: per changed slot, ≈ 530 segments / frame).
- Vertex shader: colour, flags, join data → flat varyings; a segment uses the exact ±3 neighbour loop only when its
  crowding distance is within reach at the current scale (both segments of a join decide alike), otherwise two
  half-plane tests (ownership = nearest segment for adjacent pairs; ties go to the lower index as before).
- No `discard`: no-coverage fragments return transparent (identity for OVER, multiply and screen).
- Fragment shader reads no storage in the common path.

### Draw counting (priority 1c)
Frames are owned by the runtime's tick (FACTORY.onFrame starts a frame, a microtask after the tick's rAF callback
draws it); out-of-frame writes and host redraw requests coalesce into one own-rAF draw that defers to a running
runtime → exactly one draw per runtime tick (`__gpu.frames` == ticks in steady state).

### Correctness / robustness (priority 2)
- Fill alpha per vertex (u16 in FillVertex.ids.y), paints keyed by chain only; new live paints resolved in one batch
  per flush (one probe tree, one style recalc), one upload.
- Palette keys: `paintKeyOf(prop, ancestors, el)` exported from export/build-dl.mjs (exporter and live use it).
- Live builder reuses export/ (probeNode, ringOfCircle, polylinesOf, opacity / style parsing); kit path fast path moved
  into export/svgsub.mjs `parsePathData`.
- Errors: frame errors caught (bounded log in `__gpu.errors`, `__gpu.error` set in dev and on fatal), N consecutive
  failures → live SVG fallback; device loss → bounded reinit (3 attempts, backoff) else live SVG fallback (slot
  forwarding resumes); `uncapturederror` recorded; dev validation = the builder's own checks (halos included).
- Group layers: one atlas (shelf packing), one pass, one resolve; atlas shrinks after idle frames and on resize.
- Mesh / element cache: per-element template cache keyed by context + element markup, translation-invariant fill
  mesh cache; scratch buffers pooled.
- TypeGPU: typed handles (no `any`), schemas drive packing (word offsets from d.memoryLayoutOf) and WGSL, flags via
  tgpu.const, `buffer.write(…, { startOffset, endOffset })` instead of raw writeBuffer; remaining escapes asserted.
- Host boundary: Renderer gets {root, surface (context, format, present), scene, slots, palette, clock/profiler};
  web host owns canvas sizing, observers, preview / fallback; dispose path for everything.
- dl-loader reads export/dl-format.mjs tables and validates the header.
- Web: the live figure SVG stays in the DOM (hidden under the canvas once ready) and the slot interceptors sit on its
  own slot groups → the runtime always binds to the real figure (QA-M3 D4, `api.el/els` work), the SVG is the
  accessible image during boot (D6) and the live fallback after a failure. Gradient translucent stops (QA-M2 D4).
  D2 browser-zoom softness, D5 overflow: investigate, fix if cheap, else document.
- build.mjs: drift check = normalized full comparison of the module script against a fresh v2 page() script, slot
  count asserted; `--dev` builds only dev outputs.

## Acceptance criteria
1. Cached frames pixel-identical to `?cache=0` (≤ 0.001 % differing pixels) at ≥ 20 lockstep ticks, light + dark,
   DPR 1 / 2, incl. a fade (group layer) tick and an explode share.
   (Fix loop B's runner `npm run gates:full` became the finish line during the loop: all rows green.)
2. GPU frame span (timestamps) steady state ≥ 3× lower than HEAD at 1280 DPR 2 and 390 DPR 3; stress10 iframe numbers
   reported (desktop + phone rows).
3. Static gate (`node tools/gate.mjs --themes light,dark`) and `node tools/test-export.mjs` pass; static GPU frame vs
   v2 and live lockstep gates at DPR 1 / 2 / 4, light + dark, fade injection, reduced motion: no regression beyond
   0.01 % against FINDINGS-M3 floors; calibration sheet ratios unchanged (± 0.01).
4. Draws per runtime tick = 1.00 in steady state (stress phone).
5. 10 000-tick run: no growth in buffers / textures / heap after warm-up; User Timing entries 0 unless profiling.
6. Device loss after reveal + failing reinit → live SVG fallback that keeps animating; dev unsupported markup sets
   `__gpu.error`; null adapter binds the runtime to the real figure.
7. tsc strict (+ noUnused*) clean on src; no `any` in src.

## Test plan
- `out/tmp/fixa/gputime.mjs`: GPU span / CPU ms per variant (cache on/off, before/after pages).
- `out/tmp/fixa/identity.mjs`: lockstep ticks, cached vs `?cache=0` shots, pixel diff (exact).
- B's tools run read-only when stable (`tools/live-gate.mjs compare/baseline/cost`, `tools/gate.mjs`,
  `tools/test-export.mjs`, `tools/live-edge.mjs`); else the HEAD snapshot `out/tmp/fixa/lg-head.mjs`.
- `bench/run-gpu-rows.mjs` commands (perf.mjs desktop / phone, stress10 iframe) on rebuilt bench pages.
- Calibration sheet: GPU before vs after shots (exact diff) + measure-calib ratios.
- Long run 10 000 turbo ticks with buffer / texture / heap / User Timing counters; device-loss and fallback probes.
