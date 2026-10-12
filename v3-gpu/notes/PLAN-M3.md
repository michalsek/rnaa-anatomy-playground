# PLAN — M3 live adapter

Owner: M3 agent. Owns M3 changes in `src/`, `out/gpu/live*`, `tools/live-gate.mjs` (new), this file,
`notes/FINDINGS-M3.md`. Extends `tools/build.mjs` (M2's build; adds the live pages, keeps every M2 output).
Read-only: `../v2-factory`, `~/.claude/skills`, `export/*` (imported: `svgsub.mjs`, `tess.mjs`, `roles.mjs`),
`tools/perf*.mjs` (M6a; `perf-lib.mjs` imported for Chrome/CDP plumbing).

## Recon (v2 SVG page, lockstep, 2,400 frames)
- 15 slots written every frame: median 40.6 KB, max 53.2 KB of markup per frame. Largest: belt 22 KB, rotor back/front
  11 KB each, crank 7 KB, feed 6 KB, intake 4.6 KB. Empty strings are common (spout, fall, drop, lamp, feed).
- Classes seen: iso-solid/fill/shade/top/crease/bevel/edge, iso-line, iso-dots, pk, cf-strobe, cf-glow(-soft),
  it fx-graphite (tach). Inline style only `stroke-width:1` (tach needle).
- **No `<g opacity>` group is ever written on this page**: the stub feeder always passes `from`, so the intake's
  fade-in arc (`fade: !from`, centrifuge.mjs:922) never runs. The group-opacity path is exercised by a scripted
  `FACTORY.machines.centrifuge.accept("in", item)` (no `from`) injected at the same lockstep frame in both pages.

## Architecture

### 1. Script: v2 runtime + LIVE verbatim
`tools/build.mjs` takes the page script out of `out/svg/centrifuge(-light).html` (written by the real `page()` through
`export/export.mjs`, i.e. kit script + lathe + runtime.js + LIVE + STUB_LIVE + boot, byte for byte) and keeps it in
the live page as the same `<script type="module">`. The build asserts the script contains `runtime.js` (both halves
around `__FACTORY_DATA__`) and the centrifuge `LIVE` string exactly, so a drift fails the build. No machine logic is
touched.

### 2. Page: skeleton + canvas
The stage keeps its CSS box and children; the figure `<svg>` becomes
`<canvas class="iso-svg" data-gpu data-live>` + a hidden skeleton `<svg class="fx-live-slots" hidden>` holding only
the 16 `<g data-slot>` (15 + `overlay`) in document order + `<template id="svg-fallback">` (the full SVG).
runtime.js queries `stage.querySelector("svg")` → the skeleton (template content is not in the tree), its
`[data-slot]` elements, `.fx-stage` (IntersectionObserver), `[data-readout]`, `[data-status]` — all unchanged.
The GPU bundle is a classic inline script, so it runs during parsing, before the deferred module script: it installs
the slot interceptors synchronously, then boots WebGPU asynchronously.

### 3. Interception (`src/live/slots.ts`)
`Object.defineProperty(g, "innerHTML", { get, set })` on each skeleton slot element. The setter stores the string;
identical to the last one → nothing; otherwise the slot is dirty. The first write of a frame queues one microtask
(runs right after the runtime's rAF callback returns) that parses dirty slots, uploads and renders: one rAF drives
both the simulation and the GPU frame. No DOM is created for slot content.
Fallback (no WebGPU / no adapter / device init failure): the template SVG replaces the canvas and every intercepted
write is forwarded to the real slot `<g>` of that SVG, so the v2 page keeps animating.
Errors: unsupported markup throws from the setter in dev builds (`--dev`, `__GPU_DEV__`), so the runtime's tick fails
loudly at the offending write; prod builds render that slot empty and `console.warn` once per (slot, message).

### 4. Slot geometry (`src/live/geometry.ts`)
`parseSvg` (svgsub) → own walk mirroring `drawables` + `roleOf` (roles.mjs) → per slot, in document order, prims with
layer = index in the slot:
- fills: `parsePathData` → convex single ring → fan (O(n)); else `triangulate` (earcut fast path, libtess nonzero).
  Meshes memoized by the `d` string (bounded map, cleared when it exceeds 4,096 entries).
- strokes: polylines exactly as the exporter (repeats removed, closing duplicate dropped, zero-length subpath → dot
  only with round caps); cap/join/width from the role, inline `stroke-width` override.
- dots: one record per circle.
- palette: key = prop + chain of (tag, class, data-*) — cached per chain string; a new key becomes a probe paint
  (`fx-parts > g(slot) > …chain > el`), resolved once through the page's CSS and appended to the paint buffer.
  Fill alpha ≠ 1 is folded into the paint (quantized to 1/1024) like the DL loader; stroke/dot alpha stays per record.
- group opacity: a `<g opacity>` whose subtree has > 1 drawable becomes a **layer group** (below); a single-drawable
  group folds its opacity into the element (exact).
Output per slot: one CPU byte array `[segments (48 B Seg) | fill vertices (16 B FillVertex)]`, a draw list in layer
order (opaque fill range, blended entries: seg runs, translucent fill ranges, group composites), layer count, bbox.

### 5. GPU (`src/renderer.ts` extended)
- Slots are pseudo-items appended to the item buffer (index = items + slot). Frame order = static order with each
  slot spliced in next to its anchor (before-slots before, after-slots after, ties by `seq`), so slots travel with
  their anchor under explode like the kit's `.xw` wrapper. Depth stays the painter rank: a slot's `layers` is its
  current prim count, the per-frame prefix sum gives every slot prim a unique depth (`insertAt − 0.5` semantics).
- Per slot one grow-only GPU buffer (storage + vertex; capacity doubles), written with **one `writeBuffer` per
  changed slot**, and one bind group (segs = slot buffer, order = shared identity buffer) recreated only on growth.
- Phase A: static opaque fills, then each slot's opaque fill range (depth write). Phase B: the static stream with a
  marker at each slot position (draw list rebuilt only on reorder); a marker expands to the slot's blended entries.
- Blend-mode dots (lamp `cf-glow`: multiply light / screen dark) need stroke pipelines with multiply / screen blend.
- **Group opacity — offscreen layer (chosen)**: before the main pass each group's prims are drawn with the normal
  pipelines into a bbox-sized 4× MSAA layer (own frame uniform shifted to the bbox; own depth, cleared) and resolved;
  in phase B, at the group's stream position, a bbox quad composites the layer × group alpha (premultiplied over),
  depth-tested at the group's frontmost rank so later fills still cover it per sample.
  Rejected: depth/stencil "frontmost fragment once" tricks — exact for opaque fills only; the packet's .55 strap
  lines and AA edges blend with the group's own fills, which needs a real intermediate composite. Cost is bounded by
  the bbox (one packet ≈ 40×40 CSS px) and only paid while a fade runs; measured in FINDINGS-M3.

### 6. Timing (`window.__gpu.frameStats()`)
`performance.measure`: `live-js` (the runtime's rAF callback, measured by wrapping `requestAnimationFrame` before the
module script runs), `adapter-parse`, `adapter-upload`, `gpu-encode` (+ M2's `gpu:encode` kept). frameStats keeps every
M2 field and adds `live: { frames, slotWrites, slotsChanged, bytesUploaded, meshCache {hits, misses}, paints, groups,
ms: { liveJs, parse, upload, encode } → { last, median, p95 } over the last 600 frames }`. Marks/measures of these
names are cleared every 600 frames (observers still see them).

## Acceptance criteria
1. `out/gpu/live.html` / `live-light.html` run the v2 script verbatim (build assertion) and animate like v2; readout
   and aria-live text equal to the SVG page at the same lockstep frame.
2. Lockstep frame diffs GPU vs `out/svg/centrifuge(-light).html` at DPR 2, light + dark, at N covering fill, spin,
   release and a packet fade: ≤ 0.5 % differing px at pixelmatch threshold 0.1; strict any-channel Δ > 8 reported.
3. Crops of rotor / pockets / packets at 1× (DPR 2) and 4× (`--scale 4`) in `out/gpu/live-crops/`, inspected.
4. 60 consecutive lockstep frames as a contact sheet: no popping, no z-fighting, rotor back/front split right.
5. CPU cost per frame (median / p95 over 600 frames): live-js, adapter parse, upload, gpu encode at 1280 px DPR 2
   and 390 px DPR 3, both with 4× CPU throttle.

## Manual / scripted test plan
| Case | How | Pass |
|---|---|---|
| Normal flow: fill → spin → release cycles | lockstep shots at fill / spin-up / in sync / release / spin-down frames | diff ≤ 0.5 %, readouts equal |
| Packets entering / leaving pockets | frames around a drop (intake → drop → pocket) and a release (rotor → spout → fall → belt) | packet visible in the same slot, same order vs static parts |
| Lamp / strobe / tach / gate / crank / pulleys / belt stubs | crops at an in-sync frame with lamp lit and gate open | match SVG (lamp blend multiply light / screen dark) |
| Empty slot strings | frames where spout/fall/drop/lamp/feed are "" | nothing drawn, no stale geometry |
| Unsupported markup | `live-dev.html`: write `<text>` into a slot from the console | dev: setter throws, `__gpu.error` set; prod: slot empty + one warning |
| Theme switch mid-animation | `__gpu.setTheme('light')` while running on the dark page | equals `live-light` at the same frame (live paints re-probed, slots re-parsed) |
| Resize mid-animation | change viewport width while running | canvas re-sized, animation continues, frame equal to a fresh load at that width |
| Tab hidden / IntersectionObserver | scroll the stage out of view | runtime stops its loop → no slot writes → no GPU frames; resumes on return |
| Reduced motion | `Emulation.setEmulatedMedia prefers-reduced-motion: reduce` on both pages | identical frames (the runtime still writes every frame; the dirty check skips unchanged slots) |
| Packet fade group opacity | inject `accept("in", item)` (no `from`) in both pages at the same frame; shots during the 0.18 s fade | the faded packet matches SVG (no inner edges showing through) |
| Rotor back/front split vs static items | 60-frame contact sheet while spinning | vanes/packets switch slot at d = 0 without popping; static rim/hub occlude correctly |
| No WebGPU | `--preload tools/no-webgpu.preload.js` | fallback SVG animates (writes forwarded) |
