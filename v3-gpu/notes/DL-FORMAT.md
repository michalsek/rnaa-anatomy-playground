# Display list format v1 (`out/dl/<scene>.dl.json` + `.dl.bin`)

Produced by `node export/export.mjs [--scene centrifuge]`; layouts live in `export/dl-format.mjs` (single source of
truth — this file mirrors it). The DL is theme-independent: no colour is stored, only palette ids whose colours are
resolved in the page from CSS (light/dark, any token change).

Coordinates: SVG user units of the figure's `viewBox` (`json.viewBox`, centrifuge `[0, 0, 640, 760]`), y down.
Stroke widths: CSS px (every kit path/circle has `vector-effect: non-scaling-stroke`), so device px = width × DPR.

## Binary (`.dl.bin`)
All words little-endian, 4 bytes. `f32` IEEE float, `u32` unsigned.

### Header (96 bytes, then sections at 16-byte aligned offsets)
| byte | type | value |
|---|---|---|
| 0 | u32 | magic `0x4C444E52` (bytes `52 4E 44 4C`, "RNDL") |
| 4 | u32 | version `1` |
| 8 | u32 | section count `5` |
| 12 | u32 | header bytes `96` |
| 16 + 16·i | u32 ×4 | section i: `offset`, `byteLength`, `count`, `stride` (bytes) |

Section order: 0 `prims`, 1 `fillVertices`, 2 `fillIndices`, 3 `segments`, 4 `dots`. `json.sections` repeats the table.
Every stride is a multiple of 8 and every field 4-byte aligned, so a section binds directly as a WGSL
`array<Struct>` storage buffer (vec2f pairs at 8-aligned offsets) or as a vertex buffer.

### `prims` — 32 B, one per drawn primitive, in draw order (items by rank, then layer)
| byte | type | field | meaning |
|---|---|---|---|
| 0 | u32 | kind | 0 fill, 1 stroke, 2 dot run |
| 4 | u32 | item | index into `json.items` |
| 8 | u32 | layer | 0-based order of this prim inside its item (document order) |
| 12 | u32 | paint | palette id, or `0x80000000 | gradientIndex` |
| 16 | f32 | alpha | markup alpha (opacity attributes, see Alpha) |
| 20 | u32 | first | fill: first index in `fillIndices`; stroke: first `segments` record; dot: first `dots` record |
| 24 | u32 | count | fill: index count (3 per triangle, may be 0 for a zero-area path); stroke: segments; dot: dots |
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
Triangle list (`triangle-list`, 3 indices each). Vertices are never shared between fills. Every triangle has a
positive cross product `(b − a) × (c − a) > 0` in SVG coordinates (clockwise on screen); zero-area triangles are
dropped. The union of a fill's triangles is exactly the nonzero-rule region of the source path (no overlaps).

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
| 36 | u32 | flags | 1 start of polyline, 2 end of polyline, 4 polyline closed, 8 round cap (else butt), 16 round join (else miter), 32 width from inline style |
| 40 | u32 | prim | index into `prims` (one SVG path = one prim: never double-blend inside a prim) |
| 44 | u32 | pad | 0 |

A closed polyline includes its closing segment (last end = first start) and has no caps; joins between consecutive
segments of a polyline (and the closing join) use the join style. All kit strokes use round joins, so round-capped
capsules per segment reproduce them; butt-capped strokes (tube rings, seams) need caps only on `start`/`end` sides.

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
- **items** are in settled painter order: `index === rank` for the 239 scene items; `key` is the settled depth key
  (`A.settle`), `lift = move · V` (explode: sort key = key + lift · share), `piece` the explode piece. The extra last
  item `@back` (`rank −1`, `back: true`, key null) holds `ctx.back` (the floor halo), drawn before rank 0. `flags`
  is the union of its prims' flags plus `slot-after` / `slot-before` when a slot is anchored to it.
- **depth** for a renderer: `rank · L + layer` (L > max layers per item) for static order; slots sit at `rank`
  `insertAt − 0.5`.
- **slots** mirror `page()` (v2 kit.mjs:139–149): `after` → after the latest of its targets, `before` → before the
  earliest; a target name matches `name` or the first `name#n` (findIndex). `insertAt` = index of the first item drawn
  after the slot; `seq` = position in document order (before-slots, item, after-slots), which orders several slots
  at one `insertAt`.
- **palette** entries are probe recipes. Build `ancestors[0] > … > el` with exactly those attributes as SVG elements
  inside an `svg.iso-svg` of a page that has the real CSS (`body.iso[data-theme]`, `.iso-plate`, stage), then read
  `getComputedStyle(el)`:
  - `fill`: colour = `fill`; cssAlpha = Π computed `opacity` (el + every probe ancestor) × `fill-opacity`
  - `stroke`: colour = `stroke`; cssAlpha likewise × `stroke-opacity`; also `stroke-width` / caps / joins (the gate
    checks they equal what the DL carries)
  - `stop-color`: colour = `stop-color`, cssAlpha = `stop-opacity`
  - also `mix-blend-mode` (lamp glow: multiply light / screen dark), `filter` + `transform` (halo: blur(9px),
    translateY(3px)). `export/palette-probe.mjs` implements this (`resolvePalette`).
  Keys keep `class` and `data-*` (tone, shade, lit, seamless, kind…) and drop geometry, `data-name`, `data-route`,
  ids, `style` and opacity attributes. `alphaAttrs` lists where markup carried opacity attributes; the gate checks
  CSS never overrides them (it would win over a presentation attribute).
- **gradients**: user-space linear gradients; `paint` is the filled element's own entry (its opacities apply on top),
  each stop's `paint` is a `stop-color` entry.

## Alpha
`final = colour.a × cssAlpha(palette) × alpha(record)`, where record alpha = product of `opacity` attributes on the
element and its `<g>` ancestors × the element's `fill-opacity` / `stroke-opacity` attribute. Group opacity is folded
into each child; `groupOpacity` flags prims whose opacity group had more than one child (exactly equivalent only when
the children do not overlap; none in the centrifuge static scene). For a halo (`filter` ≠ none) apply the alpha after
the blur.

## Not encoded (v1)
Curves (kit emits none), `<text>`, clip/mask, dash arrays (`data-dotted/dashed/flow`), stroke gradients
(`fadeLineSvg`), other inline styles — the exporter throws on all of them. CSS opacity on a multi-child ancestor is
folded per element (approximation).
