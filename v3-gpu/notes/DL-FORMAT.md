# Display list format v1 (`out/dl/<scene>.dl.json` + `.dl.bin`)

## Changes for consumers (M1 fix loop, 2026-10-13)
Still version 1: the header layout, the section order and every record's field order and stride are unchanged, so a
loader that reads offsets / byteLengths / counts / strides from the header (or `json.sections`) keeps working. What a
loader must know:
1. **Sections start at 256-byte offsets** (was 16), WebGPU's default `minStorageBufferOffsetAlignment`: one uploaded
   GPUBuffer can bind every section as a storage-buffer sub-range. Never assume an offset; read it from the header.
2. **Prims are stored in draw order.** The `@back` item's prims (the floor halo) are now the FIRST records
   (`prims[0]`), followed by the scene items by rank, layers ascending. `json.items` is unchanged: scene items by rank
   (`index === rank`), `@back` last (`index 239`, `rank −1`, `key null`). A loader that walks prims in buffer order now
   draws the halo first without sorting; sorting by `key ?? −∞` still gives the same order.
3. **Palette ids changed** (the halo's entry is now id 0 because palette ids are assigned in prim order). Anything
   cached by palette id from an older export is stale; resolve ids only against the same export's `json.palette`.
4. **Unused fill vertices are dropped**: every `fillVertices` record is referenced by exactly one fill's indices (287
   collinear / zero-area leftovers were removed in the centrifuge: 26,122 → 25,835 vertices). Triangles and indices
   are unchanged in content; vertex numbering inside a fill is compacted.
5. **Gradient paint ids are written as unsigned u32** (`0x80000000 + index`). Read them with
   `isGradientPaint(id)` / `gradientIndexOf(id)` and build them with `gradientPaint(index)` from
   `export/dl-format.mjs`; never compare against the int32 `PAINT_GRADIENT | i`.
6. **Record layouts are exported as word tables**: `FIELD_WORD.<section>.<field>` (word index inside the record) and
   `STRIDE_WORDS.<section>`, next to `PRIM_KIND`, `PRIM_FLAG`, `SEG_FLAG`, `MAGIC`, `VERSION`, `HEADER_BYTES`. The
   module is dependency-free ES, so `src/dl-loader.ts` can import them instead of re-declaring `KIND_*`, `SEG_*`,
   `PAINT_GRADIENT`, the magic and hard-coded word offsets (`o + 1 … o + 7`, `r + 8`, `r + 9`, `r + 6`).
7. **`sectionsOf()` validates** the magic, version, section count, header size, every stride against the layout,
   `byteLength = count × stride`, ordering / overlap and bounds, and accepts an `ArrayBuffer` or any
   `ArrayBufferView` (a Node `Buffer` with a pooled `byteOffset` included). It throws on any mismatch.
8. **`iso-wire-end` outlines are butt / miter** (its CSS sets only the width), not round / round. None in the
   centrifuge static scene.
9. The `groupOpacity` flag now marks every element under a `<g opacity>` that draws more than one element at any
   depth (was: only groups with more than one direct child). The centrifuge static scene still flags none.

Produced by `node export/export.mjs [--scene centrifuge]`; layouts live in `export/dl-format.mjs` (single source of
truth — this file mirrors it). The DL is theme-independent: no colour is stored, only palette ids whose colours are
resolved in the page from CSS (light/dark, any token change).

Coordinates: SVG user units of the figure's `viewBox` (`json.viewBox`, centrifuge `[0, 0, 640, 760]`), y down.
Stroke widths: CSS px (every kit path/circle has `vector-effect: non-scaling-stroke`), so device px = width × DPR.

## Binary (`.dl.bin`)
All words little-endian, 4 bytes. `f32` IEEE float, `u32` unsigned.

### Header (96 bytes, then sections at 256-byte aligned offsets)
| byte | type | value |
|---|---|---|
| 0 | u32 | magic `0x4C444E52` (bytes `52 4E 44 4C`, "RNDL") |
| 4 | u32 | version `1` |
| 8 | u32 | section count `5` |
| 12 | u32 | header bytes `96` |
| 16 + 16·i | u32 ×4 | section i: `offset`, `byteLength`, `count`, `stride` (bytes) |

Section order: 0 `prims`, 1 `fillVertices`, 2 `fillIndices`, 3 `segments`, 4 `dots`. `json.sections` repeats the table.
Every struct section (all but `fillIndices`, a plain u32 array with stride 4) has a stride that is a multiple of 8,
and every field is 4-byte aligned, so a section binds directly as a WGSL `array<Struct>` storage buffer (vec2f pairs
at 8-aligned offsets) or as a vertex buffer. Section offsets are multiples of 256 (WebGPU's default
`minStorageBufferOffsetAlignment`), so one GPUBuffer holding the whole file can bind each section as a sub-range; the
file ends at the next multiple of 256 after the last section. Files exported before 2026-10-13 used 16-byte alignment
under the same version; `sectionsOf` only requires 4-byte aligned offsets so they still load.

### `prims` — 32 B, one per drawn primitive, in draw order (the `@back` item first, then items by rank; layers ascending)
| byte | type | field | meaning |
|---|---|---|---|
| 0 | u32 | kind | 0 fill, 1 stroke, 2 dot run |
| 4 | u32 | item | index into `json.items` |
| 8 | u32 | layer | 0-based order of this prim inside its item (document order) |
| 12 | u32 | paint | palette id, or `0x80000000 + gradientIndex` (unsigned; `gradientPaint` / `isGradientPaint` / `gradientIndexOf`) |
| 16 | f32 | alpha | markup alpha (opacity attributes, see Alpha) |
| 20 | u32 | first | fill: first index in `fillIndices`; stroke: first `segments` record; dot: first `dots` record |
| 24 | u32 | count | fill: index count (3 per triangle, may be 0 for a zero-area path); stroke: segments (may be 0: a zero-length butt-capped or lone-moveto path draws nothing); dot: dots |
| 28 | u32 | flags | 1 halo, 2 blend, 4 gradient, 8 seamless, 16 groupOpacity |

### `fillVertices` — 24 B (`struct { p: vec2f, item: u32, paint: u32, layer: u32, alpha: f32 }`)
| byte | type | field |
|---|---|---|
| 0 | f32 | x |
| 4 | f32 | y |
| 8 | u32 | item |
| 12 | u32 | paint (as the prim) |
| 16 | u32 | layer (as the prim) |
| 20 | f32 | alpha (as the prim) |

### `fillIndices` — 4 B: u32 absolute index into `fillVertices`
Triangle list (`triangle-list`, 3 indices each). Vertices are never shared between fills, and every vertex is used by
its fill (no unindexed vertices). Every triangle has a positive cross product `(b − a) × (c − a) > 0` in SVG
coordinates (clockwise on screen) computed on the stored f32 coordinates; triangles with zero area in f64 or after f32
rounding are dropped. The union of a fill's triangles is exactly the nonzero-rule region of the source path (no
overlaps).

### `segments` — 48 B, one per line segment of a stroke polyline
| byte | type | field | meaning |
|---|---|---|---|
| 0 | f32 | x0 | start |
| 4 | f32 | y0 | |
| 8 | f32 | x1 | end (equal to start for a zero-length round-capped dot) |
| 12 | f32 | y1 | |
| 16 | u32 | item | |
| 20 | u32 | paint | palette id (stroke prop) |
| 24 | u32 | layer | |
| 28 | f32 | alpha | |
| 32 | f32 | width | CSS px: 0.6 hairline, 0.45 tube ring, 0.4 seamless seam, inline overrides (1.3 tach mark) |
| 36 | u32 | flags | 1 start of polyline, 2 end of polyline, 4 polyline closed, 8 round cap (else butt), 16 round join (else miter), 32 width from inline style (`style="stroke-width:N"` or `Npx`) |
| 40 | u32 | prim | index into `prims` (one SVG path = one prim: never double-blend inside a prim) |
| 44 | u32 | pad | 0 |

A closed polyline includes its closing segment (last end = first start) and has no caps; joins between consecutive
segments of a polyline (and the closing join) use the join style. Inside a polyline every segment starts exactly
(bit-equal f32) where the previous one ended; width, cap, join, alpha and the closed flag are uniform inside a prim
(the gate checks all of this). Most kit strokes use round joins, so round-capped capsules per segment reproduce them;
butt-capped strokes (tube rings, seams) need caps only on `start`/`end` sides, and miter-joined ones (`iso-wire-end`,
`fx-fluff` circle outlines: closed 32-gons) need real joins. A zero-length subpath (`M x y L x y` or `M x y Z`) with
round caps is one zero-length segment (a dot) with start + end set; with butt caps it is dropped.

### `dots` — 32 B (`struct { c: vec2f, r: f32, item: u32, paint: u32, layer: u32, alpha: f32, prim: u32 }`)
Filled circles (bolt heads `r` 0.36–0.42, lamp glow in slots). Consecutive circles of one item with the same paint,
alpha and flags share one prim (a "dot run") and one layer.

## JSON (`.dl.json`)
```
{ format: "rnaa-dl", version: 1, scene, viewBox: [x, y, w, h], units, probe, sections: [header table],
  counts: { items, prims, triangles, fillVertices, segments, dots, palette, gradients, slots },
  items: [{ index, name, piece, key, lift, rank, material, prims: [first, count], flags: [...], back? }],
  slots: [{ name, side: "after"|"before", anchor, insertAt, rank, targets, seq }],
  palette: [{ id, prop: "fill"|"stroke"|"stop-color", ancestors: [{ tag, attrs }], el: { tag, attrs }, alphaAttrs: [{ at, name }] }],
  gradients: [{ id, units: "userSpaceOnUse", x1, y1, x2, y2, paint, stops: [{ offset, alpha, paint }] }] }
```
- **items** are in settled painter order: `index === rank` for the 239 scene items and `key` (the settled depth key,
  `A.settle`) is non-decreasing with rank; `lift = move · V` (explode: sort key = key + lift · share), `piece` the
  explode piece. The extra last item `@back` (`rank −1`, `back: true`, key null) holds `ctx.back` (the floor halo),
  drawn before rank 0; its prims are stored first. `flags` is the union of its prims' flags plus `slot-after` /
  `slot-before` when a slot is anchored to it.
- **depth** for a renderer: `rank · L + layer` (L > max layers per item) for static order; slots sit at `rank`
  `insertAt − 0.5`.
- **slots** mirror the slot loop in v2 kit `page()`: `after` → after the latest of its targets, `before` → before the
  earliest; a target name matches `name` or the first `name#n` (findIndex). The gate checks the item + slot sequence
  against the generated page's `<g class="fx-parts">`. `insertAt` = index of the first item drawn
  after the slot; `seq` = position in document order (before-slots, item, after-slots), which orders several slots
  at one `insertAt`.
- **palette** entries are probe recipes. Build `ancestors[0] > … > el` with exactly those attributes as SVG elements
  inside an `svg.iso-svg` of a page that has the real CSS (`body.iso[data-theme]`, `.iso-plate`, stage), then read
  `getComputedStyle(el)`:
  - `fill`: colour = `fill`; cssAlpha = Π computed `opacity` (el + every probe ancestor) × `fill-opacity`
  - `stroke`: colour = `stroke`; cssAlpha likewise × `stroke-opacity`; also `stroke-width` / caps / joins (the gate
    checks they equal what the DL carries, and probes every `export/roles.mjs` rule against the CSS)
  - `stop-color`: colour = `stop-color`, cssAlpha = `stop-opacity`
  - also `mix-blend-mode` (lamp glow: multiply light / screen dark), `filter` + `transform` (halo: blur(9px),
    translateY(3px)). `export/palette-probe.mjs` implements this (`resolvePalette`); it also reports the computed
    `fill-rule`, `stroke-dasharray`, `clip-path` and `mask`, which the gate requires to be `nonzero` / `none` because
    the DL cannot express anything else. Computed colours must be `rgb()` / `rgba()` (`parseColor` throws otherwise).
  Keys keep `class` and `data-*` (tone, shade, lit, seamless, kind…) and drop geometry, `data-name`, `data-route`,
  ids, `style` and opacity attributes. `alphaAttrs` lists where markup carried opacity attributes; the gate checks
  CSS never overrides them (it would win over a presentation attribute).
- **gradients**: user-space linear gradients; `paint` is the filled element's own entry (its opacities apply on top),
  each stop's `paint` is a `stop-color` entry.

## Alpha
`final = colour.a × cssAlpha(palette) × alpha(record)`, where record alpha = product of `opacity` attributes on the
element and its `<g>` ancestors × the element's `fill-opacity` / `stroke-opacity` attribute (plain numbers or
percentages). Group opacity is folded into each element; `groupOpacity` flags every prim under a `<g opacity>` that
draws more than one element at any depth (folding is exact only when those elements do not overlap; the three static
opacity groups of the centrifuge each draw one path). For a halo (`filter` ≠ none) apply the alpha after the blur.

## Not encoded (v1)
The exporter accepts only this subset and throws on anything else (`export/svgsub.mjs`, `export/roles.mjs`):
- elements `g`, `path`, `circle`, `defs > linearGradient > stop` (any other child of `defs` throws, so nothing in
  `defs` is drawn); comments; whitespace between tags; double- or single-quoted attributes; entities `&amp; &quot;
  &apos; &lt; &gt;` and numeric `&#N;` / `&#xH;` (other named entities throw);
- per element only: `class`, `id`, `role`, `data-*`, `aria-*`, plus `g`: `opacity`; `path`: `d fill stroke opacity
  fill-opacity stroke-opacity fill-rule(nonzero only) style`; `circle`: `cx cy r fill stroke opacity fill-opacity
  stroke-opacity style`; `linearGradient`: `gradientUnits(userSpaceOnUse only) x1 y1 x2 y2` (all four required);
  `stop`: `offset stop-color stop-opacity`. So `transform`, `gradientTransform`, `href`, `clip-path`, `mask`,
  `filter`, `marker-*`, `stroke-dasharray`, `stroke-linecap` attributes etc. throw;
- `style` may hold only `stroke-width` (number or `px`);
- numbers are plain decimals; `%` only on opacities and `offset`, `px` only in the inline stroke-width;
- path commands M/L/H/V/Z (absolute + relative); curves, arcs and any other letter or stray character throw;
- `data-dotted` / `data-dashed` / `data-flow` (dash arrays) and `data-pulse` (pulsing dot animation) throw.
Not representable at all: curves (kit emits none), `<text>`, clip/mask, stroke gradients (`fadeLineSvg`). CSS opacity
on a multi-element ancestor is folded per element (approximation).
