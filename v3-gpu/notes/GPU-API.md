# `window.__gpu` — the GPU figure's tool surface

Set by `src/web/api.ts` (assigned with `window.__gpu = api`, so a preload may observe it through a window setter) as
soon as the bundle runs, on every GPU page (`out/gpu/*.html`). One figure per document. Fields keep their M2/M3
meaning; everything new is additive.

## Fields

| field | type | meaning |
|---|---|---|
| `ready` | boolean | the first GPU frame was presented and the canvas replaced the vector figure (`html[data-gpu=ready]`) |
| `error` | string \| null | why the GPU path stopped or misbehaves: fallback reason (`no-webgpu`, `no-adapter: …`, `device-lost: …`, `reinit-failed: …`, `render-error: …`, `start-failed: …`, `html[data-gpu=fallback]`), or a dev-build markup error (`live slot <name>: …`, set at the offending write) |
| `errors` | string[] | **new** — the last ≤ 20 non-fatal errors (WebGPU validation errors from `uncapturederror`, frame errors), oldest first; the first 5 WebGPU validation errors are also logged with `console.error` |
| `adapter` | object \| null | `{ vendor, architecture, description, features }` of the current device |
| `frames` | number | GPU frames drawn. A plain data property, assigned (`api.frames = n`) on every frame, so tools may redefine it with an accessor to observe increments. With a live runtime: exactly one per runtime tick that changed something (plus one per canvas resize) |

## Methods

| method | meaning |
|---|---|
| `frameStats()` | snapshot object, below |
| `setShare(x)` | explode share; frames are full redraws while it changes, the static cache is rebuilt once it is stable for 2 frames |
| `setTheme('light' \| 'dark')` | sets `body[data-theme]`; the figure re-probes its palette from the attribute change (one probe, not two as in M2) |
| `redraw()` | requests one frame (folded into the next runtime tick when the runtime is running) |
| `simulateDeviceLoss()` | destroys the device; the page re-initializes (bounded: 3 failed attempts → fallback; 16 successful re-inits per page) |

## `frameStats()`

Renderer fields are present **only while a renderer exists** (tools use `"lastEncodeMs" in frameStats()` to see that a
re-init finished):

| field | meaning |
|---|---|
| `frames`, `lastEncodeMs`, `avgEncodeMs`, `draws`, `segments`, `opaqueVertices`, `blendedVertices`, `reorders` | as in M2/M3 (`segments`: static Seg records; `draws`: draw calls of the last frame) |
| `lastGpuMs` | **changed meaning**: GPU time of the last measured frame from the start of its first pass to the end of its main pass (timestamp queries; includes halo / group-layer / cache-rebuild passes of that frame). M3 measured the main pass only; on steady frames the two coincide up to the extra passes |
| `lastGpuFrameRebuiltCache` | **new** — that frame also re-rendered the static cache |
| `cachedFrames`, `fullFrames`, `cacheRebuilds`, `lastRebuildReason` | **new** — static cache: frames drawn from the cache / as full redraws, cache (re)builds and why the last one happened (`resize`, `paints`, `layout`, `envelope growth`, `frame uniform`, `background`, `slot painter`) |
| `perFrameEntries`, `cachedEntries`, `perFrameSegments` | **new** — partition of the static scene: blended entries redrawn per frame / cached, static segments redrawn per frame |

Always present: `reinits`, `width`, `height`, `dpr`, `share`, **new** `errors` (count), **new** `paints` (paint table
size), **new** `envelopes` (per slot name: `{ box: [x0, y0, x1, y1] (viewBox units), cells, growths }` or null; null
without a renderer).

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
| `?profile` | mirror the timing spans into User Timing (as `window.__gpuProfile = true`) |

## User Timing

Off unless `window.__gpuProfile === true` (set before the page loads, e.g. by `bench/preload/gpu-timing.js`) or
`?profile`. When on, every span is a `performance.measure` named `live-js`, `adapter-parse`, `adapter-upload` or
`gpu-encode`, cleared immediately after it is recorded (PerformanceObservers still receive it), so the entry buffer
never grows. Production pages create no marks or measures and do not patch `requestAnimationFrame`.

## Page structure (tools relying on it)

- `canvas[data-gpu]` (+ `data-live` on live pages), `role="img"`, the figure's `aria-label`, followed by the figure's own
  `svg.iso-svg` (the v2 markup, slots included). While booting the SVG overlays the hidden canvas (the accessible
  image); once ready it is `display:none` + `aria-hidden`; on fallback the canvas is removed and the SVG takes its place.
- The v2 runtime binds to that SVG (`FACTORY.svg`, `api.el / els` work in every mode). `FACTORY.slots[name].innerHTML`
  returns the last markup written; on fallback the slot elements get real DOM again.
- `html[data-gpu]`: `ready` or `fallback`.

## Native slot painters (for M5)

`src/core/slots.ts` `SlotPainter`: a painter names the slots it draws and is registered with
`renderer.setSlotPainter(painter)` (a later registration replaces an earlier one for those slots). Per frame the
renderer calls `prepare(frame, encoder)` (offscreen passes), `drawOpaque(frame, pass)` (depth-writing content) and
`drawSlot(frame, pass, slot)` at each slot's painter position; the painter reports `layersOf(slot)` (depth slots
used, ≤ the range reserved at `frame.depthBase(slot)`) and `extentOf(slot)` (viewBox box + stroke half-width; the
static cache redraws only inside the slots' extents). `FrameContext` carries the pipelines, the shared bind-group
buffers (`frame.bindings.layoutGroup(segs, order)`), the view transform, the explode offset and the depth layout.
