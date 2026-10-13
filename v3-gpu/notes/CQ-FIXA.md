# CQ-FIXA: code-quality review of fix loop A (renderer foundation)

**Scope.** Commit `2e51703`: `v3-gpu/src/{core,live,web}`, the shared `export/` modules it imports, and `tools/build.mjs`. I read a `git archive` snapshot in `out/tmp/cq-fixa/`, because M5 is editing `src/` concurrently. All `file:line` references are at `2e51703`. I made no code edits.

**Lens.** I judged this as the foundation for porting about 20 machines and possibly a react-native-webgpu host. The questions were:
- module boundaries;
- ownership and dispose;
- `SlotPainter` extensibility;
- sharing one device across figures;
- testability;
- completeness of static-cache invalidation.

**Rules applied.**
- `code-quality-dictionary.md`: TS-1…TS-7, MR-4, §R severity and §N non-goals. React, RN, Expo and [REPO] rules have no equivalent here.
- The expressive-code skill.
- TypeGPU 0.12.7 idiom, checked against `node_modules/typegpu` sources.

## Measurement (dictionary §M, adapted)

| Step | Result |
|---|---|
| 1 Size | +5326 / −2709 in 48 files (`src`, `export`, `tools`). This is a refactor, so I reviewed whole files, not hunks. `renderer.ts` is 697 lines; the next largest are `geometry.ts` (517) and `static-cache.ts` (413). |
| 2 Gates | `tsc -p src/tsconfig.json` (strict, `noUnused*`, `noImplicitReturns`, `noFallthroughCasesInSwitch`): **0 errors**. `node --test tools/test-export.mjs tools/test-live.mjs`: 36 pass, 1 todo. There is no lint or format tooling. |
| 2b DOM-free check | `tsc` on `core/` + `live/` with `lib: ["es2023"]` (no `dom`) gives only 4 errors: `setTimeout` and `queueMicrotask` (`frame-loop.ts:144,156`), `console` (`:237`) and `atob` (`scene.ts:73`). Hermes provides all four. Grepping core and live for `document`, `window`, `HTMLElement`, `getComputedStyle`, `ResizeObserver`, `requestAnimationFrame`, `performance` and `navigator` finds nothing. **`src/core` and `src/live` are DOM-free.** One global is read at module load: `GPUTextureUsage` (`gpu-types.ts:17`, see N9). |
| 4 Type-aware | ESLint is not installed, so I checked by hand. Results: 0 `any`; 7 `as` casts (5× `(error as Error)`, `paint.ts:160,162`, `geometry.ts:332`); about 30 `!`, of which 15 are in `renderer.ts` (see N2). No floating promises: `start()`, `readTimestamps` and `awaitPresented` all handle rejection. |
| 5 Deprecations | `deprecations.cjs`: **0**. The scan now means something, because there are no `any` handles left. |
| 6 Grep | Raw `device.queue.writeBuffer`: 0. `console.*` in core: 1 (`frame-loop.ts:237`, rate-limited). `0.999` literal: 1 (`geometry.ts:300`). |
| TypeGPU check | Read in the sources: `$usage('transient')` exists and forces `TRANSIENT_ATTACHMENT \| RENDER_ATTACHMENT` (`texture.js:94-105`). Every texture and buffer starts with `COPY_SRC \| COPY_DST` (`texture.js:47`, `buffer.js:60`). `querySet.resolve()` and `read()` each create their own encoder and submit (`querySet.js:88-117`). `configureContext` defaults `format` to `getPreferredCanvasFormat()`. |

### WebGPU checks that pass

- **Stencil and depth.**
  - Every scene pipeline uses `IN_REGION` (compare `equal`, write mask 0).
  - Full frames clear the stencil to 0 and draw with reference 0.
  - Cached frames set reference 1. `markRegion` writes it (`always`/`replace`), and `cachedFrame` copies only where `not-equal`.
  - Halo, composite and atlas passes test the stencil the same way.
  - The debug overlay alone skips the stencil, which is intended.
  - `depth24plus-stencil8` plus `1 − (seq+1)/(N+2)` leaves rank spacing far above 2⁻²⁴ at factory scale.
- **Exactness of the copy.** Region rects are snapped to whole device px (`clippedRectOf`), so every sample of a pixel is either inside or outside R. An outside pixel resolves 4 equal samples, which returns the cached unorm value exactly.
- **Transient attachments.** Main, cache and atlas passes all use MSAA colour and depth/stencil with `clear`/`discard`, so `transient` is legal there.
- **Dispose on every path.** `Renderer.dispose`, `HaloEffect` (CQ-M2 S1 is fixed), `SharedBindings.grow`/`ensureIdentity`, `writeRects`, `LiveSlots` (slot buffers, cells, params, atlas) and `destroyTargets` (cache plus `cacheGroup`) all release what they own. A 10k-tick resource-count plateau confirms it. Exception: a failed init (S7).
- **Bind groups.** No churn in steady state. The static group, slot groups and cell groups are keyed by `bindings.version` and the buffer identity. The static group is re-bound only after a slot draw (`drawList`, CQ-M2 S14 is fixed).
- **Uniform writes.** The frame uniform and halo params are written only when their values change.
- **Packing.** Schema-derived offsets (`d.memoryLayoutOf`), `tgpu.const` flags, `buffer.write(host, {startOffset, endOffset})`, and asserted u16 ids (`fills.ts:4-6`).

## Static-cache invalidation: every input to cached pixels

| Input | Rebuild trigger | Status |
|---|---|---|
| Target size, DPR | `resize()` compares w/h/dpr → `invalidateCache('resize')` | ok |
| View transform, viewport, dpr, depth denominator | `writeFrame` change → `'frame uniform'` | ok |
| Background | `setBackground` compare | ok |
| Paint class (visible/opaque/blend) | `classVersion` → `syncGeometry` → `layoutDirty` → `'layout'` | ok |
| Paint colour, width, blur, translate, stops | **only the host's manual `paintsChanged()`** | **fragile (S2)** |
| Width-0 stroke `halfWidth` and cap baked in at build (`static-geometry.ts:114-121`) | geometry is rebuilt only on class change | **stale on width/cap change (S2)** |
| Order, explode offsets, depth bases, slot capacities | `relayout` → `'layout'`; caching starts after 2 stable share frames | ok, but offsets are always 0 on DL scenes, so this is **never exercised (S4)** |
| Halo masks, colour, shift, depth | `halo.invalidate()` on resize/paints/geometry; params compared per frame; halo boxes read live | ok (box aliasing: N4) |
| Painter registration | `'slot painter'` | ok. A replaced painter keeps drawing (S1) |
| Region R ⊆ envelopes | an extent outside its envelope grows it and extends the partition | **hole for extents outside the grid (S3)** |
| New live paints | not invalidated: correct, because new ids are referenced only by slots and gradients are rejected in slots | ok |
| Slot content outside its extent | clipped by the stencil in cached frames only (cached ≠ `?cache=0`) | a contract, not enforced (S8) |

## Should-fix (S), ranked

### S1. Replacing a slot painter does not stop the old one, and native painters have no lifecycle hook (blocks M5)

**Where:** `renderer.ts:233-237` (`setSlotPainter` pushes and remaps), `:296`, `:358`, `:364` (`prepare`/`drawOpaque` run on **every** registered painter); `slot-renderer.ts:137-193` (`prepare` and `drawOpaque` iterate all of their own slots); `live-path.ts:14`, `:26-29` (LiveSlots owns every DL slot); `frame-loop.ts:254-262`.

**What happens:**
- When the M5 rotor takes slot *k*, LiveSlots still draws *k*'s opaque fills and renders *k*'s group layers into the atlas. LiveAdapter also keeps parsing *k*'s markup, because the v2 runtime keeps writing it.
- That content lies outside the region in cached frames, so it is clipped there but drawn in full frames. The two diverge.
- `GpuView` exposes no way to register a painter.
- `attach` runs after `renderer.compile()`, so `SlotPainter.pipelines()` are never compiled ahead, as the contract promises.
- After device loss the renderer is recreated with only the live painter, so a native painter disappears.

**Fix:**
- Make slot ownership authoritative in the renderer: `setSlotPainter` calls `previous.release(slots)`, and `drawOpaque(frame, pass)` / `prepare` receive the slots the painter currently owns. LiveSlots and LiveAdapter skip released slots.
- Add `GpuViewOptions.painters(root, renderer, frame) → SlotPainter[]`. `init()` calls it, together with `live.attach`, **before** `compile()`, and calls it again on every re-init.

### S2. The cache depends on a manual `paintsChanged()`, and stroke widths and caps are frozen at build time

**Where:** `renderer.ts:271-274`, `:282`; `bindings.ts:77-79`; `paint.ts:101-107`, `:170-177`; `frame-loop.ts:187-198`; `static-geometry.ts:113-121`; `static-cache.ts:361`.

**What happens:**
- `writePaints` already notices `table.version` and uploads the new colours. It does not invalidate the cache.
- A host that calls `resolveAll` without `paintsChanged()` (an RN theme switch, a future palette hot-swap) gets new colours inside R and old colours outside it. The result is visible seams.
- Separately, width-0 strokes (`sceneFromWire` today; any future "width from CSS" path) bake `resolved.width` into `entry.halfWidth` and `resolved.cap` into the seg flags. Geometry is rebuilt only on a class change.
- After a theme changes the width, the shader draws the new width, but the partition pads with the old one. Static segments that the wider stroke brings into R are then missed. A cap change is never applied at all.

**Fix:**
- Add `PaintTable.appearanceVersion`, bumped in `store()` when a **settled** entry's rgba, width, cap, blend, blur, translate or stops change.
- In `render()`, compare it like the frame uniform: `invalidateCache('paints')` plus `halo.invalidate()`. Delete `paintsChanged()`.
- Give geometry a `geometryVersion` (class **or** width/cap of a referenced paint), or read `paints.resolved[paint].width` when the partition pads a stroke entry.

### S3. Envelope grid clamping breaks exactness for content beyond viewBox ±25 %

**Where:** `static-cache.ts:37-39`, `:103-104`, `:110-125`; `renderer.ts:523-527`.

**What happens:**
- `clampColumn` and `clampRow` fold any out-of-grid extent into the edge cells. `inside()` then succeeds while the extent lies in no envelope cell.
- `writeRegion` still builds R from the **real** extent. Static primitives in R outside the envelope were never selected, so their pixels are cleared and not redrawn.
- Today this is unreachable, because DL offsets are 0 (S4) and such content is off-canvas. With explode moves, an anchor offset can bring it on screen.

**Fix:** when an extent leaves the grid, mark the slot "unbounded", so frames are full while it stays outside (or the partition gets an overflow list). Add a dev assertion that R ⊆ ∪ envelope rects.

### S4. Explode never moves anything on DL scenes, so the offset path is untested

**Where:** `dl-loader.ts:92` (`move: [0, 0]`); `dl-format.d.mts:50` (items carry `lift` only).

**What happens:**
- `setShare` only reorders the items. FINDINGS-M2 #5 already noted this for the centrifuge.
- The factory's explode slider needs a screen move per item. Every offset-dependent cache path (partition offsets, region, halo shift, atlas boxes) currently runs with zeros. The "explode share 0.4" identity run therefore proves the reorder only.

**Fix:** export `move` (move · P in viewBox units) per item in the DL, and add a gate and a Node test with non-zero offsets.

### S5. Timestamp queries run on every production frame

**Where:** `web/main.ts:157`; `renderer.ts:212`, `:292-293`, `:320`, `:667-686`.

**What happens:** each frame whose previous read has finished does all of this:
- an extra 1×1 render pass;
- `querySet.resolve()`, with its own encoder and submit;
- `read()`, which does a copy, a submit, `mapAsync`, `getMappedRange().slice()` and `Array.from`.

That is 3 submits per frame per figure, or about 60 per frame for 20 figures.

**Fix:**
- Add `RendererOptions.timestamps`, off by default. The web host enables it under `?profile`, `__gpuProfile` or tool pages.
- Resolve inside the frame's encoder.
- Optionally sample 1 frame in N.

### S6. One device per figure: not ready for sharing

**Where:** `frame-loop.ts:43`, `:226-243`, `:220`; `renderer.ts:202-204`; `pipelines.ts:73-80`.

**Why each piece blocks sharing:**
- Every `GpuView` calls `host.createRoot()`, which runs `tgpu.init` and creates a new device.
- Every `Renderer` compiles all 15 pipelines.
- `device.lost` and `uncapturederror` are handled per view, so one validation error would be attributed to every figure.
- `dispose()` and `fallback()` destroy the root.
- `compilePipelines` toggles the global `warn.disable`/`reset`, which is not re-entrant.

Per-figure state is already isolated: bindings, targets, cache, halo, painters and `PaintTable`.

**Fix (minimal):**
- Add a `GpuDevice` service (`acquire()`/`release()`, refcounted) that owns:
  - the root;
  - `pipelinesFor(format)` (memoized);
  - the shared sampler;
  - one `lost` handler that fans out to its views and owns the re-init budget;
  - the error log.
- `GpuHost.createRoot()` becomes `device: GpuDevice`.
- Use one canvas and context per figure (the native WebGPU model; sub-rect resolve into a shared canvas is impossible, because a resolve covers the whole attachment).
- Add `suspend()`, which frees the targets and the cache for off-screen figures (IntersectionObserver on the web, `onLayout`/visibility in RN). Twenty idle 4× targets are the next memory wall.

### S7. A failed init leaks its device and reports the wrong reason

**Where:** `frame-loop.ts:133-147`, `:226-266`, `:232-233`.

**What happens:**
- If `new Renderer` or `compile()` throws, the root (and any buffers already created) is never destroyed. Three attempts leave up to 3 devices behind.
- Every failure is reported as `no-adapter: …`, including WGSL or pipeline errors.
- `root.device.adapterInfo` is dereferenced unguarded. It is undefined on older Dawn builds, which matters for the react-native-webgpu (RN) host, so init throws there.

**Fix:**
- Use `try { … } catch { renderer?.dispose(); root.destroy(); throw }`.
- Report `init-failed: …` separately from `no-adapter`.
- Read `adapterInfo` with optional chaining.

### S8. The riskiest logic has no Node tests

**Where:** `static-cache.ts` (`SlotEnvelopes`, `CachePartition`, `OccupancyGrid`), `paint.ts` (version transitions), `strokes.ts` (crowd/join), `frame-loop.ts` (`GpuView` scheduling). All are DOM- and GPU-free.

**What happens:** exactness rests on a browser pixel diff of one scene with zero offsets. `test-live.mjs` covers the builder only. The `extentOf` contract (content ⊆ extent) is not enforced.

**Fix:**
- A property test: random segments, triangles and halos with random slot extents (including offsets, out-of-grid extents and halfWidth growth). Assert that every primitive whose true coverage reaches R is per-frame.
- `PaintTable` version tests.
- `GpuView` tests with a fake host (clock, `requestFrame`, microtasks) covering frames == ticks, coalescing, 3 failures → fallback, and the re-init cap.
- In dev, assert that a painter's draws stay inside `extentOf`; LiveSlots can compare its own bounds.

## Nits (N)

1. **Per-frame allocations remain in steady state.**
   - `writeFrame` builds an 8-element array plus an `every` closure (`bindings.ts:54-56`).
   - `viewTranslate()` returns tuples twice or three times.
   - `halo.prepare` creates two lambdas and an object per frame, and a `values` spread plus a `some` closure per halo (`renderer.ts:294-295`, `halo.ts:81-82`).
   - `writeRegion` runs a `reduce` closure.
   - `LiveSlots.prepare` runs `forEach` closures even with no groups. With groups it adds `Math.max(...map)`, sort arrays and `i32.set([...])` (`slot-renderer.ts:158-162`, `:288-290`).
   - Parsing creates `writer.u32.slice` per stroked element (`geometry.ts:494`) and `[...chain]` per group.
   - An explode drag re-creates `PainterStep` objects and two `join(',')` strings per frame (`renderer.ts:478-483`).
   - Fix: scratch tuples, `Float32Array` compares, reused `steps`.
2. **`renderer.ts` is still a 697-line orchestrator.**
   - Eight nullable geometry fields produce 15 `!`.
   - Fix: extract a `StaticCache` (cache texture, partition, region, overlay rects) and a `GpuTimer` (S5).
   - Group `segBuffer`/`orderBuffer`/`*VB`/`staticGroup` into one nullable `StaticResources`.
   - This closes the rest of CQ-M2 S10.
3. **Naming.**
   - `frame-loop.ts` exports `GpuView`.
   - `slot-renderer.ts` exports `LiveSlots` (CQ-M3 N3).
   - `gpu-types.ts` holds factories.
   - `debugRectVert`/`DebugRect` drive the production stencil mark; rename them to `rectVert`/`DeviceRectRecord`.
   - `SlotEnvelopes.halfWidthOf` is a getter that returns a function; make it a method.
   - `stats.draws = … + 3`/`+ 1` are magic (`renderer.ts:313,316`).
4. **Duplication.**
   - `geometry.ts:300` uses `0.999` instead of `isOpaqueAlpha` (the last CQ-M3 S7 residue).
   - `RectRegion.testSegment` repeats `OccupancyGrid.testSegment` (`static-cache.ts:201-210` vs `:263-272`).
   - `fillBounds` is computed twice per halo (`static-geometry.ts:91-92`).
   - `(error as Error).message` appears 5× next to `recordError`'s own normalizer.
   - Partition `stepRects` alias the halo's mutable `box` objects (`static-cache.ts:316`).
5. **Comments that hold history** (expressive-code).
   - `geometry.ts:8-9` "(Caching whole elements was tried … 7 %)".
   - `strokes.ts:11,16` "the old ownership rule".
   - Move both to FINDINGS. Also, `paint.ts:48-50` says `translate` is "CSS px", but `halo.ts:78` uses it as viewBox units (equal only because SVG user units are CSS px). State that precisely.
6. **Hand-written `export/*.d.mts` are unchecked against the `.mjs`.** Generate them with `tsc --allowJs --declaration`, or add `checkJs` for `export/`.
7. **The web host has no teardown.** Observers, interceptors and `GpuView.dispose()` cannot be reached. That is fine for one-figure pages but required for multiple figures or SPA use.
8. **`createSurface` takes the format from a second source** (`main.ts:160`). Pass `format` to `configureContext` and reuse it.
9. **Usage flags.**
   - Every texture keeps TypeGPU's default `COPY_SRC | COPY_DST`. That covers the MSAA colour/depth wherever `transient` is unavailable (Safari, Firefox, the RN Dawn build), plus the cache, atlas resolve and halo masks. Use `$overrideFlags(RENDER_ATTACHMENT)` (MSAA) and `RENDER_ATTACHMENT | TEXTURE_BINDING` (resolve/mask), and measure on the phone row.
   - `ATTACHMENT_USAGE` is decided from a global at import (`gpu-types.ts:17`). Decide it per root.
   - Each halo owns its own scratch mask; one shared scratch is enough.
10. **The atlas never shrinks while groups stay active** (`slot-renderer.ts:309-313` keeps the max). Shrink when the need stays below ½ for K frames.
11. **`sceneFromWire` (fixture format) lives in `core/scene.ts`.** Move it to `src/fixture`.
12. **`build.mjs:95`** calls `FIGURE_TAG.exec(html).index` twice and crashes without a message on a miss.
13. **`compilePipelines`' global `warn` toggle is not re-entrant.** Two figures compiling at once re-enable it early.
14. **Unclamped opacity.** `opacityAttr` does not clamp to [0, 1] (`svgsub.mjs:121`, pre-existing). It now feeds `GroupParams.alpha` and `Seg.alpha` directly, so an easing overshoot over-brightens on the GPU only. Clamp it in `opacityAttr`.
15. **Behaviour gaps (CQ-M2 N9, open).**
    - A square cap renders as round (`palette-dom.ts:11` → `static-geometry.ts:114`).
    - A closed 2-point polyline is drawn open (`dl-loader.ts:73`).
    - Ownership is per polyline.
    - Miter joins are drawn round.

## CQ-M2 closure

| CQ-M2 | Status | Evidence |
|---|---|---|
| S1 halo leaks | **fixed** | `HaloEffect` owns and disposes; masks rebuilt on resize/paints/geometry; sigma recomputed |
| S2 `any` handles | **fixed** | 0 `any`; typed `Pipelines`, `LayoutGroup`, `StorageArray<T>` |
| S3 hand packing | **fixed** | `*_RECORD` from `d.memoryLayoutOf`; ids asserted < 2¹⁶. FINDINGS-M2 #3 text still wrong (see N10) |
| S4 TS/WGSL flags | **fixed** | `SEG` → `tgpu.const`; DL flags imported from `dl-format.mjs` |
| S5 dl-loader duplicates dl-format | **fixed** | `sectionsOf`, `FIELD_WORD`, `STRIDE_WORDS`, version check; one `decodeBase64` |
| S6 two palette probes | **fixed** | `palette-dom.ts` → `resolvePalette` (all chains built, then read) |
| S7 readiness spin | fixed (M3) | |
| S8 reinit/GPU errors invisible | **fixed, one new leak** | `errors[]`, bounded re-init with backoff, `uncapturederror` recorded; init-failure device leak (S7) |
| S9 DOM coupling / host split | **fixed (core), partial (web)** | `RenderSurface` + `present`, paint types in `paint.ts`, `GpuView` vs web host; web teardown missing (N7) |
| S10 Renderer responsibilities | **mostly fixed** | Split into 8 modules; cache orchestration and timestamps remain (N2) |
| S11 encode stats under lockstep | fixed (M3) | Event clock |
| S12 `lockstep.step` hang | **fixed (loop B)** | `step()` delivers empty frames (`lockstep.js:25,99-103`) |
| S13 `initAsync` | fixed (M3) | |
| S14 per-frame allocations | **mostly fixed** | Bind once per pass; uniforms written on change; small residue (N1); no render bundle |
| N1 dead code | **fixed** | `tsc` `noUnused*` clean |
| N2 magic numbers | **mostly fixed** | `0.999` in `geometry.ts:300`; draws `+3`/`+1` |
| N3 depth formula duplicated | **fixed** | `depthOfSlot` (TS) mirrors WGSL `depthOf`, cross-referenced; `Frame.depthDenominator` |
| N4 module-scope `warn.disable` | **fixed** | Scoped to `compilePipelines` (re-entrancy nit: N13) |
| N5 full-screen triangles | **fixed** | `common.fullScreenTriangle`; halo scissored |
| N6 casts in `main.ts` | **fixed** | No `any`; `Window` declared; `dpr` guard |
| N7 API shape | **fixed** | `render(share)`, `pipelines`, `HaloTargets` |
| N8 calibration comments | **fixed** | Two new history comments elsewhere (N5) |
| N9 behaviour gaps | **open** | N15 |
| N10 FINDINGS corrections | **open** | FINDINGS-M2 #3 ("no typed-array view…") and FINDINGS-M3 #6 ("partial writes via `device.queue.writeBuffer`") unchanged |
| N11 tools | **partially** (loop B) | `build.mjs` attribute order fixed; null crash (N12) |

## CQ-M3 closure

| CQ-M3 | Status | Evidence |
|---|---|---|
| S1 alpha in paint key | **fixed** | u16 alpha per vertex; chain-only keys; one resolve batch per flush |
| S2 live error handling | **fixed** | Frame try/catch, 3 failures → fallback; `release()` hands back live markup; dev `validate` = `builder.collect` (halos included) |
| S3 microtask schedule | **mostly fixed** | `beginRuntimeFrame` + microtask; out-of-tick writes coalesce into own rAF; no latch. Real-rAF two-callback gate belongs to loop B |
| S4 per-group full-size layers | **mostly fixed** | One atlas, one pass, idle release; never shrinks while active (N10) |
| S5 exporter rules duplicated | **fixed** | `palette-key`, `polylines`, `roles`, `svgsub` (fast path moved), `tess` shared |
| S6 TypeGPU idiom | **fixed** | Schema offsets, `buffer.write` ranges, byte offset in `setVertexBuffer`; FINDINGS-M3 #6 text not corrected |
| S7 Renderer ↔ LiveSlots coupling | **fixed** | Private fields, `FrameContext`, `SharedBindings`, `layersOf`/`extentOf`, one `classifyPaint` (one `0.999` left) |
| S8 host boundary | **mostly fixed** | `PaintTable`, injected `Profiler`/`Clock`, no rAF patch, `present`, `dispose`. The markup-string slot protocol stays (out of scope) |
| S9 parse-path allocations | **partially** | Style cache, slice-free parser (0.60 ms/tick); per-element objects and slices remain (N1) |
| S10 live gates | **loop B** | Not re-verified here (A reads them only) |
| S11 `build.mjs` drift check | **fixed** | Normalized full-script compare against a fresh `page()`, slot set asserted, `--dev` builds only dev outputs |
| S12 O(items × slots) | **fixed** | `slotsByAnchorOf` precomputed; per-relayout allocations remain (N1) |
| N1 per-frame allocations | **partially** | N1 |
| N2 magic numbers | **mostly fixed** | N3/N4 |
| N3 naming | **partially** | `RollingTimings`, `PROBE_KEY_IGNORED_ATTRS`, `pipelines`, `depthDenominator` done; `LiveSlots` file mismatch open |
| N4 comments | **fixed** | New history comments: N5 |
| N5 unbounded warning set | **fixed** | Keyed by slot + message with numbers stripped |
| N6 theme trigger | **fixed** | `attributeFilter: ['data-theme']` |
| N7 only `innerHTML` intercepted | **open** | No dev guard for `replaceChildren`/`append` |
| N8 id bounds | **fixed** | `assertU16` |
| N9 tool nits | **loop B** | |
| N10 `build.mjs` duplication | **fixed** | Single `gpuPage()` |

## RN host sketch (react-native-webgpu)

`src/core` + `src/live` can be used as they are. An RN host implements `GpuHost` and a `SlotSource`, and nothing else.

1. **Device and surface.**
   - `createRoot`: `tgpu.init()` (react-native-wgpu installs `navigator.gpu`), or later `GpuDevice.acquire()` (S6).
   - `createSurface`: `ref.current.getContext('webgpu')`, configured with `{ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' }`, and `present: () => context.present()`. The present hook already exists.
   - Sizing: measure in `useLayoutEffect`. Set `canvas.width = w · PixelRatio.get()` (the drawing buffer is not DPR-scaled, MR-4), then call `view.resize({ width, height, dpr })`.
2. **Palette without a DOM.** `PaintResolver.resolve(probes)` answers from a table built at **export time**. The gate's Chrome step already runs `palette-probe.mjs`.
   - The table is `{ theme → { paintKeyOf(prop, ancestors, el) → ProbedPaint } }` plus `background` per theme.
   - Live paints must be enumerated offline too, from the recorded slot markup through the shared `paintKeyOf` (CQ-M3 S1's offline table, not built yet).
   - An unknown key resolves as hidden and is reported in `errors`.
   - Theme: `Appearance.addChangeListener` → swap the table → `view.repaint()`. This needs S2, so a forgotten `paintsChanged` cannot leave seams.
3. **Scheduling.** `requestFrame = requestAnimationFrame`, and `queueMicrotask` and `setTimeout` exist in Hermes.
   - `clock`: `performance.now()` (Hermes has it).
   - `profiler`: `NO_PROFILER`, or Systrace in dev.
   - The runtime port calls `view.beginRuntimeFrame()` at the start of its tick.
   - Device events (`lost`, `uncapturederror`) fire on the main JS runtime only (MR-4), so `Renderer` and `GpuView` stay on the JS thread. A worklet renderer would need the error plumbing moved.
4. **Slots.** The v2 runtime is DOM-bound (`innerHTML` strings, `api.el/els`).
   - Phase 1: a JS port of the runtime pushes markup into a `MemorySlotSource` (an array plus a dirty bitset; ~25 lines, the same contract as `DomSlotSource` without the interceptors).
   - Phase 2: a structured slot channel (records instead of markup) or native `SlotPainter`s, which needs S1.
5. **Data and lifecycle.**
   - DL JSON + bin ship as assets. `decodeBase64` relies on Hermes `atob`, or load the bin as an `ArrayBuffer` directly.
   - The `useEffect` cleanup calls `view.dispose()`.
   - On AppState `background`, stop requesting frames. iOS may lose the device, which the bounded re-init handles.
   - `onFallback` shows a pre-rendered PNG or Skia vector fallback.
   - Guard `device.adapterInfo` (S7).
   - Decide `ATTACHMENT_USAGE` per root (N9).

## Out of scope (v2, kit, tooling not owned by loop A)

- **v2 runtime.**
  - `FACTORY` is assigned twice, so `onFrame` hooks and naive counters double (FINDINGS-FIXA). Assign it once.
  - The slot protocol rebuilds ~40 KB of markup per tick, which the GPU path then re-parses. A structured slot channel would remove both costs and is the cheapest path to RN (see above).
  - The kit's `overlay` slot is not drawn by the GPU path (`build.mjs:86` `KIT_SLOTS`). A factory machine that uses it renders nothing, with no error. Make `build.mjs` fail when a scene writes to it, or draw it.
- **Kit.**
  - Its module script contains the literal `</body>`; `build.mjs` works around it with `lastIndexOf`.
  - `src/fixture/make-{fixture,calib}.mjs` still import the unpinned `~/.claude/skills/anatomy/kit/iso-kit.mjs` (CQ-M2 follow-up). Record the kit hash in the scene JSON.
- **Loop B tools.** The real-rAF / two-callback scheduling gate (CQ-M3 S3) and the live-gate thresholds were not re-verified here.
