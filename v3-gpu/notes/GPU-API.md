# `window.__gpu` — the GPU figure's tool surface

Set by `src/web/api.ts` (assigned with `window.__gpu = api`, so a preload may observe it through a window setter) as
soon as the bundle runs, on every GPU page (`out/gpu/*.html`). One figure per document. Fields keep their M2/M3
meaning; everything new is additive.

## Fields

| field | type | meaning |
|---|---|---|
| `ready` | boolean | the first GPU frame was presented and the canvas replaced the vector figure (`html[data-gpu=ready]`) |
| `error` | string \| null | why the GPU path stopped or misbehaves: fallback reason (`html[data-gpu=fallback]`), or a dev-build markup error (`live slot <name>: …`, set at the offending write). **Fix C1** reasons: `no-webgpu` (no `navigator.gpu`), `no-adapter: …` (the first start got no device, 3 attempts), `init-failed: …` (a device, but the renderer or its pipelines failed, 3 attempts), `reinit-failed: <no-adapter: … \| init-failed: …>` (the re-init after a device loss failed 3 times), `device-lost: lost again after 16 re-inits`, `render-error: …` (3 frames in a row threw), `start-failed: …` (a bug: `start()` itself threw), **M4** `dl-decode-failed: …` (the page's display-list binary could not be decoded, e.g. no `DecompressionStream`) |
| `errors` | string[] | the last ≤ 20 non-fatal errors, oldest first: WebGPU validation errors (`uncapturederror`; the first 5 are also logged with `console.error`), frames that threw, **fix C1**: device losses (`device lost (<reason>): …`) |
| `adapter` | object \| null | `{ vendor, architecture, description, features }` of the current device |
| `frames` | number | GPU frames drawn. A plain data property, assigned (`api.frames = n`) on every frame, so tools may redefine it with an accessor to observe increments. With a live runtime: exactly one per runtime tick that changed something (plus one per canvas resize) |

## Methods

| method | meaning |
|---|---|
| `frameStats()` | snapshot object, below |
| `setShare(x)` | explode share; frames are full redraws while it changes, the static cache is rebuilt once it is stable for 2 frames |
| `setTheme('light' \| 'dark')` | sets `body[data-theme]`; the figure re-probes its palette from the attribute change (one probe, not two as in M2) |
| `redraw()` | requests one frame (folded into the next runtime tick when the runtime is running) |
| `simulateDeviceLoss()` | destroys the current device — **fix C1**: also while it is being initialised (pipelines compiling) — and the page re-initializes as after any loss, including a `destroy()` from outside the figure (bounded: 3 failed attempts per re-init → fallback `reinit-failed`; a 17th loss → fallback `device-lost`) |
| `dispose()` | **fix C1** — tears the figure down: resize / theme / resolution observers off, the renderer, its painters and the device released (every buffer and texture destroyed before the device), the live slots handed back to the DOM (`release()`), the SVG figure shown and animated by the runtime, `html[data-gpu=disposed]`, `ready` false. Idempotent |
| `nativeCheck()` | **M5, dev page only** (`live-dev.html`): resolves to `{ gpu, reference }` — the native rotor's GPU-expanded Seg / FillVertex words of the current frame (read back), its slot ranges and hull paints, and the records the markup path builds from v2's strings for the same state (tools/native-gate.mjs `contract`) |

## `frameStats()`

Renderer fields are present **only while a renderer exists** (tools use `"lastEncodeMs" in frameStats()` to see that a
re-init finished):

| field | meaning |
|---|---|
| `frames`, `lastEncodeMs`, `avgEncodeMs`, `draws`, `segments`, `opaqueVertices`, `blendedVertices`, `reorders` | as in M2/M3 (`segments`: static Seg records; `draws`: draw calls of the last frame) |
| `lastGpuMs` | **M5: null unless GPU timestamps are on** (`?profile`, `?gpuTime`, or `window.__gpuTimestamps = true` before load; `window.__gpuProfile` alone no longer turns them on — CQ-FIXA S5: each measured frame cost an extra pass and two submits). **Fix-A meaning**: GPU time of the last measured frame from the start of its first pass to the end of its main pass (timestamp queries; includes halo / group-layer / cache-rebuild passes of that frame). M3 measured the main pass only; on steady frames the two coincide up to the extra passes |
| `lastGpuFrameRebuiltCache` | **new** — that frame also re-rendered the static cache |
| `cachedFrames`, `fullFrames`, `cacheRebuilds`, `lastRebuildReason` | static cache: frames drawn from the cache / as full redraws, cache renders and why the last one happened (`resize`, `paints`, `layout`, `frame uniform`, `background`, `slot painter`; **fix C1**: `frame error` — the previous frame threw, `gpu error` — a WebGPU validation error made the cached content unknown). `cacheRebuilds` counts encoded renders, so a render in a frame that failed counts too |
| `offGridFrames` | **fix C1** — full frames drawn because a slot's extent reached beyond the envelope grid (viewBox ± 25 %), which no envelope can cover (CQ-FIXA S3) |
| `perFrameEntries`, `cachedEntries`, `perFrameSegments` | **new** — partition of the static scene: blended entries redrawn per frame / cached, static segments redrawn per frame |

Always present: `reinits`, `width`, `height`, `dpr`, `share`, **new** `errors` (count), **new** `paints` (paint table
size), **new** `envelopes` (per slot name: `{ box: [x0, y0, x1, y1] (viewBox units), cells, growths }` or null; null
without a renderer).

Live pages add `native` (**M5**, **changed in fix C2**; null with `?native=0`): `{ active, drawing, failed, machines:
[{ id, state: 'idle' | 'owning' | 'failed', drawing, error, parts, calls, changedFrames, markupRefreshes, gpu: { uploads,
bytesUploaded, dispatches, emitMs } | null, ms: { model } }] }`, plus the machine's own fields at the top level when the
page has exactly one native machine (as in M5). `active` from the first presented frame until a fallback; `drawing`:
every machine's painter owns its slots in the current renderer; `calls` hook calls (one per tick), `changedFrames` ticks
whose rotor changed, `markupRefreshes` times a reader of the rotor slots' `innerHTML` made v2 build its strings,
`ms.model` the hook's CPU time (state → packed records), `gpu.emitMs` the CPU expansion time with `?native=cpu`. A
machine whose hook threw (model, styles, painter creation or pipeline compile) is `failed`: `native <id>: …` is in
`__gpu.errors` (non-fatal, also `console.warn`), its slots went back to the markup path in that same tick, and other
machines are unaffected.

Live pages add `live`:

| field | meaning |
|---|---|
| `frames`, `slotsChanged`, `bytesUploaded`, `paints`, `errors` | adapter counters (`paints`: live paints resolved, in batches) |
| `mesh` | **changed** — `{ elements, styleHits, styleMisses, fills, segments }` (elements built, path-style cache hits / misses; M3 had `meshHits / meshMisses` of a mesh cache keyed by `d`) |
| `gpu` | slot painter counters `{ uploads, bytesUploaded, groups, layerPixels, atlasAllocations }` |
| `ms` | rolling 600-sample summaries `{ n, last, median, p95, mean }` of `liveJs`, `parse`, `upload`, `encode`, `encodeWithGroups`, `gpu` and **new** `gpuCacheRebuild` (GPU time of frames that rebuilt the static cache; `gpu` holds the others) |

`ms.*` are measured with the event clock (`new Event('').timeStamp`), which tools/lockstep.js does not virtualize,
so they are real durations under lockstep too. `liveJs` spans the runtime tick from its first `FACTORY.onFrame` hook
to the end of its animation-frame callback.

## URL parameters

| parameter | meaning |
|---|---|
| `?cache=0` (or `off`) | static cache off: every frame redraws the whole scene (identity reference) |
| `?cache=overlay` | cache on, plus a debug overlay: the slot envelopes (blue) and the per-frame static entries (magenta) of the current partition |
| `?gpuRepeat=K` | measurement aid: the main pass is encoded K times per frame and `ms.gpu` reports the time per pass (the GPU clocks up under load; K = 4 shows the cost at a steady clock rather than the idle one) |
| `?profile` | mirror the timing spans into User Timing (as `window.__gpuProfile = true`) and turn GPU timestamps on |
| `?gpuTime` | **M5**: GPU timestamp queries only (`lastGpuMs`, `live.ms.gpu`); off by default |
| `?cacheBug=skip-invalidate` \| `skip-growth` | **fix C1, test hook** (`tools/live-gate.mjs identity --mutate …`): a deliberate static-cache defect the identity gate must catch — the cache texture is not re-rendered after an invalidation (stale colours after a theme switch) / the partition is not extended when an envelope grows |
| `?native=0` | **M5**: no native rotor — v2 builds the rotor slots' strings every frame and the markup path draws them (the fix-A behaviour). Default `1` on live pages with WebGPU |
| `?native=cpu` | **fix C2**, evaluation: the native rotor's parts are expanded into Seg / FillVertex records on the CPU (`RotorCpuEmitter`, through `SegWriter`) and uploaded; no compute pass |

## User Timing

Off unless `window.__gpuProfile === true` (set before the page loads, e.g. by `bench/preload/gpu-timing.js`) or
`?profile`. When on, every span is a `performance.measure` named `live-js`, `adapter-parse`, `adapter-upload` or
`gpu-encode`, cleared immediately after it is recorded (PerformanceObservers still receive it), so the entry buffer
never grows. Production pages create no marks or measures and do not patch `requestAnimationFrame`.

## Robustness (fix C1)

- **Frames** count only frames that drew: a canvas with no size yet draws nothing (and is not `ready`).
- **Hidden canvas**: a 0 × 0 box (`display:none`, the transient resize of a `captureBeyondViewport` screenshot) is
  ignored — the backing store and the targets keep their last size, no 0-sized texture is ever created; drawing goes on
  and an unchanged size on return does not redraw.
- **Failed frames**: the static cache and the halo masks count as rendered only once the frame that rendered them was
  submitted; a frame that throws (encode or submit) or a WebGPU validation error invalidates them, so the next frame
  equals `?cache=0` again.
- **Paint changes** invalidate the cache inside the renderer (`PaintTable.appearanceVersion`; class / width / cap
  changes rebuild the static geometry via `geometryVersion`): hosts no longer call `paintsChanged()` (removed).

## Page structure (tools relying on it)

- `canvas[data-gpu]` (+ `data-live` on live pages), `role="img"`, the figure's `aria-label`, followed by the figure's own
  `svg.iso-svg` (the v2 markup, slots included). While booting the SVG overlays the hidden canvas (the accessible
  image); once ready it is `display:none` + `aria-hidden`; on fallback the canvas is removed and the SVG takes its place.
- The v2 runtime binds to that SVG (`FACTORY.svg`, `api.el / els` work in every mode). `FACTORY.slots[name].innerHTML`
  returns the last markup written; on fallback the slot elements get real DOM again.
- `html[data-gpu]`: `ready`, `fallback` or (**fix C1**) `disposed`.
- **M4** `html[data-renderer]`: `svg` while the vector figure is on screen (booting, fallback, disposed), `webgpu` once
  the canvas replaced it; one `console.info("figure renderer: …")` line when the renderer is decided (WebGPU · TypeGPU
  with the adapter, or SVG fallback with the reason). No visible badge: the card stays identical to v2.
- **M4** the DL binary is inlined as `<script id="gpu-dl-bin" data-encoding="rnaa-dl-columns-delta+gzip+base64">`
  (`export/dl-wire.mjs`, decoded with `DecompressionStream`), so the GPU view is created asynchronously after parsing;
  slot interception, the native host and the `FACTORY` hooks are still installed synchronously before v2's module
  script runs. The deliverables `centrifuge-gpu(-light).html` are byte copies of `out/gpu/live(-light).html`.

## Native slot painters (M5, fix C2)

`src/core/slots.ts` `SlotPainter`. Slot ownership is one record, `SlotOwners`, inside the renderer:
`renderer.addPainter(p)` makes a painter known (compiled and disposed with the renderer) without slots;
`renderer.setSlotPainter(p, slots = p.slots)` moves slots: every previous owner gets `release(lost)`, the new owner
`acquire(gained)` (ownership moves both ways: a failed native machine gives its slots back to `LiveSlots`). Painters ask
`FrameContext.ownerOf(slot)` instead of keeping copies. Only painters owning ≥ 1 slot get `prepare` / `drawOpaque`. Per
frame the renderer calls `prepare(frame, encoder)` (offscreen passes, compute), `drawOpaque(frame, pass)` and
`drawSlot(frame, pass, slot)` at each slot's painter position; the painter reports `layersOf(slot)` and
`extentOf(slot)`. `invalidate()` (optional) is called from `Renderer.invalidate` (a frame threw, a WebGPU validation
error): work the painter encoded into that frame may not have run, so it redoes it in the next `prepare`.

`GpuViewOptions.painters: PainterHost[]` (`src/core/frame-loop.ts`): `attach(root, renderer)` runs for every renderer
(first start and each device-loss re-init) after the live path attached and **before** `renderer.compile()`;
`detach()` when the renderer is gone. Native machines live in a `NativeHost` (`src/native/native-host.ts`, a
`PainterHost`): machine kinds (`rotorKind`, `src/native/native-rotor.ts`) recognize v2 machines at `FACTORY.define`, so
any number of native machines per page get their own `api.gpu`. Each machine's painter is built at `attach` (its compute
pipeline is compiled with the renderer, never inside v2's tick) and rebuilt on every re-init; a machine defined after
attach takes its slots once its own pipeline compiled. v2's `drawRotor` reaches the rotor through `api.gpu.rotor(…)`
(contract: `src/native/rotor-contract.ts`; the build checks that every name the injected line passes is declared in
`centrifugeLive`). Native slots in the DOM slot source keep one refresh per slot (`ownNatively(slots, refresh)`,
`disownNatively(slots)`): writes are kept but never parsed or scheduled, and reading their `innerHTML` (gates, the SVG
fallback) makes v2 build its strings for the current state on demand.
