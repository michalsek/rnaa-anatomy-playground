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
| `nativeCheck()` | **M5, dev page only** (`live-dev.html`): resolves to `{ gpu, reference }` — the native rotor's GPU-expanded Seg / FillVertex words of the current frame (read back), its slot ranges and hull paints, and the records the markup path builds from v2's strings for the same state (tools/native-gate.mjs `contract`) |

## `frameStats()`

Renderer fields are present **only while a renderer exists** (tools use `"lastEncodeMs" in frameStats()` to see that a
re-init finished):

| field | meaning |
|---|---|
| `frames`, `lastEncodeMs`, `avgEncodeMs`, `draws`, `segments`, `opaqueVertices`, `blendedVertices`, `reorders` | as in M2/M3 (`segments`: static Seg records; `draws`: draw calls of the last frame) |
| `lastGpuMs` | **M5: null unless GPU timestamps are on** (`?profile`, `?gpuTime`, or `window.__gpuTimestamps = true` before load; `window.__gpuProfile` alone no longer turns them on — CQ-FIXA S5: each measured frame cost an extra pass and two submits). **Fix-A meaning**: GPU time of the last measured frame from the start of its first pass to the end of its main pass (timestamp queries; includes halo / group-layer / cache-rebuild passes of that frame). M3 measured the main pass only; on steady frames the two coincide up to the extra passes |
| `lastGpuFrameRebuiltCache` | **new** — that frame also re-rendered the static cache |
| `cachedFrames`, `fullFrames`, `cacheRebuilds`, `lastRebuildReason` | **new** — static cache: frames drawn from the cache / as full redraws, cache (re)builds and why the last one happened (`resize`, `paints`, `layout`, `envelope growth`, `frame uniform`, `background`, `slot painter`) |
| `perFrameEntries`, `cachedEntries`, `perFrameSegments` | **new** — partition of the static scene: blended entries redrawn per frame / cached, static segments redrawn per frame |

Always present: `reinits`, `width`, `height`, `dpr`, `share`, **new** `errors` (count), **new** `paints` (paint table
size), **new** `envelopes` (per slot name: `{ box: [x0, y0, x1, y1] (viewBox units), cells, growths }` or null; null
without a renderer).

Live pages add `native` (**M5**; null with `?native=0`): `{ active, drawing, parts, calls, changedFrames, markupRefreshes,
gpu: { uploads, bytesUploaded, dispatches } | null, ms: { model } }` — `active` from the first presented frame until a
fallback, `drawing` while the RotorPainter owns the rotor slots of the current renderer, `calls` hook calls (one per
tick), `changedFrames` ticks whose rotor changed, `markupRefreshes` times a reader of the rotor slots' `innerHTML` made
v2 build its strings, `ms.model` the hook's CPU time (state → packed records).

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
| `?native=0` | **M5**: no native rotor — v2 builds the rotor slots' strings every frame and the markup path draws them (the fix-A behaviour). Default `1` on live pages with WebGPU |

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

## Native slot painters (M5)

`src/core/slots.ts` `SlotPainter`. Slot ownership lives in the renderer: `renderer.addPainter(p)` makes a painter known
(compiled and disposed with the renderer) without slots; `renderer.setSlotPainter(p, slots = p.slots)` gives it slots,
and every previous owner gets `release(lostSlots)` and stops drawing them (LiveSlots drops their geometry, the adapter
no longer parses them). Only painters owning ≥ 1 slot get `prepare` / `drawOpaque`. Per frame the renderer calls
`prepare(frame, encoder)` (offscreen passes, compute), `drawOpaque(frame, pass)` and `drawSlot(frame, pass, slot)` at
each slot's painter position; the painter reports `layersOf(slot)` and `extentOf(slot)`.

`GpuViewOptions.painters: PainterHost[]` (`src/core/frame-loop.ts`): `attach(root, renderer)` runs for every renderer
(first start and each device-loss re-init) after the live path attached and **before** `renderer.compile()`;
`detach()` when the renderer is gone. The native rotor (`src/native/native-rotor.ts`) is one; v2's `drawRotor` reaches
it through `api.gpu.rotor(…)` (contract: `src/native/rotor-contract.ts`). Its slots are native-owned in the DOM slot
source: writes are kept but never parsed or scheduled, and reading their `innerHTML` (gates, the SVG fallback) makes v2
build its strings for the current state on demand.
