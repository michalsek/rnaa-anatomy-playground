# M5 plan: native instanced rotor

Goal: the four slots `drawRotor` writes (`rotorBack`, `rotorFront`, `spout`, `fall`) are drawn from the rotor state
directly — no SVG strings built, parsed or tessellated per frame — with the same pixels as the markup path up to the
kit's 0.1-unit coordinate rounding, and every fallback keeps v2's strings.

## Design

### 1. The injected line (tools/build.mjs, GPU live pages only)

At the one `function drawRotor(now) {` of the page's module script (asserted: exactly one match, else the build
fails), after the existing drift check of the v2 script:

```js
function drawRotor(now) {
    if (api.gpu?.rotor?.(Ad, pockets, releasing, now, releasePose, drawRotor)) return;
```

Nothing else in LIVE changes; `out/svg` pages are untouched. `api.gpu` exists only when the GPU bundle wrapped
`FACTORY.define` (WebGPU present and `?native` ≠ 0); `rotor` returns `true` only when the native painter took the frame
(after the GPU figure is ready, before any fallback). Otherwise v2 runs unchanged.

State contract — everything `drawRotor` reads, by source:
- per call: `Ad` (drawn angle), `pockets[i]` (item or null; only `.kind` is read), `releasing[]` (`item.kind`, `t0`,
  `a0`), `now`; `releasePose(r, age)` is v2's own kinematics (stage / pos / a / z), called, never re-implemented;
- constants (read once from the machine api the define wrapper sees): `api.data` (`pockets`, `centre`, `toward`,
  `r.vaneIn/vaneOut/pocket`, `z.pocket/vane/packet`), `api.P` (projection);
- literals copied from v2 `vane` / `packet` / `drawRotor`: vane half-thickness 0.6, the vane depth radius 20.4, the
  packet plan {x −5, y −4, w 10, d 8, r 0.6} with 2 corner steps and bevel 0.3, the strap ±5, the band at
  `h − PK·0.45` drawn when `h > PK·0.55`, the +0.1 packet depth bias.
- `drawRotor` itself, so a reader of the slots' `innerHTML` (gates, fallback) can get v2's exact strings on demand
  (re-entrant call with the hook bypassed).

Proof of completeness: (a) a dev-page check reads back the GPU-expanded geometry at the gate ticks and compares it,
polyline by polyline and fill area by fill area, with the geometry the markup path builds from v2's strings for the
same tick; (b) the pixel gates (live / motion / determinism) run with native on.

### 2. CPU model (src/native/rotor-model.ts, kit-mirror.ts)

Per call: parts = 10 vanes + pocketed packets + releasing packets, `d` computed with v2's exact expressions, stable
insertion sort, split `d < 0` → back / `d ≥ 0` → front, spout / fall in releasing order. Per part, in f64 with the
kit's own formulas (`extrude`: signed area → orientation, edge normals, `facing = n·v > 1e-9`,
`shade = clamp(floor((n·l + 1)/2 · SHADES))`; `ringSeam`'s un-normalized facing for the band): a facing mask, a band
facing mask and 2-bit shade indices per face — so tone and silhouette classification are bit-identical to the kit —
and the exact projected bounds. Packed into one preallocated record array (TypeGPU schema `RotorPart`); compared with
the previous frame's bytes: unchanged → no upload, no redraw (reduced motion stays frame-free). Allocation-free after
warm-up (buffers grow only past their capacity; a new packet kind registers its paints once).

### 3. GPU expansion (src/native/rotor-shaders.ts, rotor-painter.ts)

One compute dispatch per changed frame, one workgroup (64 threads) per part:
- fills: top fan (n − 2) + 2 triangles per side face (degenerate when not facing) → FillVertex records
  (item = slot pseudo-item, paint = style shade / top paint, layer = part base + 1 + shade / + 5), drawn by the
  existing `fillOpaque` pipeline in `drawOpaque` (one draw for all four slots). The paper hull under the faces is not
  emitted: the faces tile it exactly (shared vertices, MSAA), so it can never show.
- strokes: fixed edge blocks per part in v2 document order — crease (facing top runs), bevel, outline (back top runs,
  front bottom runs, verticals at facing transitions), band runs + strap — written as `Seg` records with the exact
  `SegWriter.polyline` semantics (round caps, join bisectors, `crowd` incl. pinch points, polyline index ranges), so
  the existing `stroke` pipeline and fragment coverage draw them unchanged (hairline parity). Unused slots are
  off-screen zero-alpha records. Each slot's parts are contiguous: `drawSlot` is one instanced stroke draw.
- depth: part k of a slot uses layers [10k, 10k + 10) (shades 1–4, top 5, crease 6, bevel 7, edge 8, lines 9) inside
  the slot's reserved range; `layersOf` = 10 · parts.
- paints: the same keys as the markup path — template markup (v2's exact element/attribute structure, `d` dummies)
  is collected by `SlotGeometryBuilder` with the slot probe chain, giving the shared palette ids and stroke widths.
- `extentOf` = exact projected box of the slot's parts + max stroke half-width.

### 4. Wiring (src/web, src/live)

- `?native=0|1` (default 1 when WebGPU), `__gpu.native` / `frameStats().native`.
- `FACTORY.define` wrapped in the existing `whenFactory` hook to add `api.gpu`.
- Activation at `onReady` (the boot preview keeps getting strings); the first hook call after it registers the
  painter (`renderer.setSlotPainter`) at the next flush and makes the four slots *native-owned* in `DomSlotSource`:
  writes are stored but no longer dirty the adapter (`markupOf` = ''), the element getter refreshes v2's strings
  lazily, `release()` (fallback) refreshes before handing the markup to the DOM.
- Device loss: `LiveSlotPath.attach` re-attaches the native painter to the new renderer (state kept on the CPU).
- Fallback: hook disabled before the slots are released.

## Acceptance criteria

1. Build fails unless exactly one injection site; GPU live pages differ from v2's script by that one line only.
2. Unit: kit mirror = kit `extrude` / `ringSeam` / `roundedPlan` (facing, shade index, band facing) over ≥ 3600
   angles × both templates; template markup = v2's recorded rotor markup structure; paint keys = adapter keys.
3. Dev readback check at the gate ticks: polylines (points within 0.08 viewBox units, same order, paints, caps) and
   fill area per paint (within 1 %) equal to the markup path's; no extra / missing primitives.
4. `npm run gates:full` green with native default; no global threshold loosened (any rotor-only limit explicit in
   gates.config.mjs + GATES.md). Self-tests still reject their defects; a native self-test rejects a dropped rotor.
5. Lockstep native vs adapter vs SVG at the gate ticks, DPR 1/2/4 light+dark: no solid blobs; numbers in
   FINDINGS-M5; scale-1 and scale-4 crops looked at; 60-frame contact sheet: no popping at back/front swaps.
6. Perf: native vs adapter (`?native=0`) vs SVG; live-js / parse / upload / encode / GPU; desktop 1280 DPR2, phone
   390 DPR3 4×, stress10 iframe; 3 repeats, medians; out/perf/m5/ + table in FINDINGS-M5.
7. tsc strict clean; zero allocations per frame in the model after warm-up (heap flat over 10k ticks).

## Manual test plan

Normal: whole cycle (idle → filling → spinning up → in sync → release → spinning down → filling) on `live.html` and
`live-light.html`; packets dropping into pockets (237), leaving them (883/884), sliding down the spout and falling
(913–932); vanes at all angles (spin); back/front split transitions (711 and the motion run 700–759).
Edge: theme switch mid-spin; resize storm / DPR change; explode share (`__gpu.setShare(0.4)`: slots move with their
anchor); device loss after ready (painter re-registered, frame == fresh page) and before ready; no WebGPU / null
adapter / failed re-init (fallback SVG shows the current rotor, v2 strings); `?native=0` (adapter path, identical to
fix-A); reduced motion (no frames while still); dark theme; `?cache=0` (identity) and `?cache=overlay`.
