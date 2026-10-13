# M1 — display-list exporter: plan

## Pipeline
1. `scenes/centrifuge.scene.mjs` — copy of `v2-factory/parts/centrifuge/build.mjs` with absolute imports into
   `../v2-factory` (read-only) and no top-level side effects: `export async function run({ out })` builds the ctx,
   calls the REAL `page(ctx, …)` (writes `out/svg/centrifuge.html` + `-light.html`) and returns ctx.
   After `page()` the items are settled and sorted (kit.mjs:136–137).
2. `export/build-dl.mjs` `placeSlots(items, slots)` (planned as a separate `export/scene-capture.mjs`, merged into
   build-dl): the slot lookup of the slot loop in kit `page()`, plus document-order sequence numbers (before-slots,
   item, after-slots).
3. `export/svgsub.mjs` (isomorphic, no Node APIs) — tokenises the SVG subset (g, path, circle, defs, linearGradient,
   stop), keeps the element's class/data-* context chain, multiplies `opacity` down the tree, reads
   `fill-opacity`/`stroke-opacity`/inline `style` stroke-width, resolves `url(#id)`, parses path data (M/L/H/V/Z
   absolute + relative; curves throw).
4. `export/roles.mjs` — which props an element paints (fill/stroke/dot/stop) and default stroke geometry, a small
   rule table mirroring iso-kit/factory CSS. Unknown classes throw (new kit features must be noticed). The
   browser gate cross-checks every rule against `getComputedStyle`.
5. `export/tess.mjs` (isomorphic) — fills: earcut for a single simple subpath; libtess nonzero for multi-subpath,
   mixed orientation or self-intersecting; output triangles all positively oriented, zero-area dropped.
   `nonzeroArea()` — independent exact slab/trapezoid integration for the area gate.
6. `export/dl-format.mjs` (isomorphic) — record layouts (byte offsets), pack/unpack the `.dl.bin`.
7. `export/export.mjs` — CLI `node export/export.mjs [--theme light|dark] [--scene centrifuge]`; writes
   `out/dl/<scene>.dl.json` + `.dl.bin`; prints sizes (raw + gzip), counts, timings.
8. `tools/dl2svg.mjs` — isomorphic `renderDlSvg(dl, buffers, paints)` (fills: ONE path per original fill
   reassembled from its triangles, so coverage is computed per fill like v2's path and no triangle seams appear;
   strokes: one path per stroke primitive from its segments; dots; gradient; halo). CLI writes
   `out/gate/<scene>-{v2,dl}-<theme>.html`: v2 = the generated page with its script removed (slots empty, frozen);
   dl = the same page with the svg emptied and a module that probes the palette in-page and draws the DL with
   inline resolved paint only (no classes).
9. `tools/gate.mjs` — structural gate (Node) + capture both pages with `capture.mjs` (DPR 2, light and dark) +
   pixelmatch + palette/role verification messages from the page (`console.warn("DLGATE …")`, which capture.mjs prints).

## DL contents
Per item: index, name, piece, key (settled), lift = move·V, rank (sorted index), material, flags, primitive range.
Primitives (each with item, layer = index within the item in document order, paint id, alpha): fill meshes,
stroke polylines (as segment records), dot runs. Palette: one entry per distinct (ancestor class/data chain ×
element class/data × prop) with the probe recipe. Gradients in user space with stop paint ids. Back items (halo)
before rank 0. Slots: name, side, anchor item, insertAt (draw position), seq.

## Acceptance criteria
- `page()` output in `out/svg/` is byte-identical to a v2 build except the location (diff vs v2's html).
- Structural gate passes: items 239, fills/strokes/dots counts match the census (fill paths 1136 / 1956 subpaths,
  stroke paths 525 / 1025 polylines / ~15.1k segments, 209 dots in 37 groups, 1 gradient, 3 opacity groups,
  1 halo, 17 seamless solids); every item has a unique rank 0..238; every slot has an insertAt; every vertex /
  dot / segment end within the viewBox (+halo margin); per fill |Σ triangle area − nonzero area| ≤ 0.5 %
  (absolute floor 0.01 px² for slivers); no triangle with negative orientation.
- Palette resolves to a colour (not none) for every entry in light and dark; computed stroke width/cap/join/opacity
  of every probe equals what roles.mjs assumed (or the DL carries the override).
- Pixel gate: DL→SVG vs v2 static frame at DPR 2, < 0.1 % differing pixels (pixelmatch threshold 0.1), light and dark.
- DL is theme-independent: `--theme` only selects which baseline page is checked; the json/bin are identical.

## Test plan (edge cases)
`tools/test-export.mjs` unit checks (no Chrome):
- multi-subpath fill (two disjoint squares; nested same orientation → union; nested opposite → hole);
- mixed orientation; self-intersecting bow-tie and pentagram (nonzero: centre filled);
- degenerate: repeated points, zero-length segments, zero-area fill (→ 0 triangles), lone `M` (no stroke);
  zero-length closed subpath with round cap → one zero-length segment (dot), with butt cap → dropped;
- closed vs open polylines (Z → closed flag, closing segment emitted; open keeps caps);
- relative commands m/l/h/v, implicit lineto after M;
- dot groups: per-tone context and `fill-opacity` attr → alpha;
- tubes: tb-ring `opacity` attr + butt caps 0.45; tb-edge round;
- gradient: `url(#id)` paint with class-coloured stops → gradient record, stops as palette ids;
- group opacity: `<g opacity>` multiplies into child alpha; multi-child opacity groups are flagged;
- halo: back item, flagged with probe props filter/transform/opacity;
- seamless solids: shade/top give a fill prim AND a 0.4 px closed stroke prim with the stroke palette key;
- slot placement: after/before, several targets (latest/earliest), `name#n` match, missing target throws;
- format round trip: pack → unpack equals input.
