# QA — M1 display-list exporter (independent verification, 2026-10-12)

Scratch work, scripts and crops: `out/tmp/qa-m1/` (reader.mjs, slots.mjs, fuzz.mjs, scene-cover.mjs, edge.mjs,
drop-small.mjs, live-prims.mjs, svgsub-*.json, crop-*.png). No M1 code, v2 file or skill file was modified; `out/dl`,
`out/svg` are byte-identical to the committed ones and `out/gate` was left in its clean state (last run unmutated).

## Verdict: PASS with defects

| Acceptance criterion | Result | Evidence |
|---|---|---|
| `page()` output in `out/svg/` byte-identical to a v2 build | **PASS** | I copied v2 `parts/centrifuge/build.mjs` unchanged except the two import paths, built it into scratch: both `centrifuge.html` and `-light.html` `cmp`-identical to `out/svg/`. The committed v2 HTML is stale (same SVG, script lacks `frameOffset`), as FINDINGS-M1 #1 says |
| Structural gate (census, ranks, slots, bounds, area, orientation) | **PASS** | gate all PASS; my own reader (below) agrees. Slot positions checked separately against `<g data-slot>` in the v2 SVG: 15/15 `insertAt` + `seq` match |
| Palette resolves in light + dark; roles match computed style | **PASS** | `DLGATE ok`, 73 entries, both themes |
| Pixel gate < 0.1 % at DPR 2, light + dark | **PASS** | light: 10 px Δ>8 (0.0004 %), max Δ 55 on 2 isolated belt-edge px; dark: 2 px (0.0001 %), max Δ 14 |
| DL theme-independent | **PASS** | `--theme dark` export is byte-identical; no colour literal in json |
| Test-plan edge cases present in `tools/test-export.mjs` | **PASS** (one gap) | 24/24 pass. Gap: there is no unit case for a closed zero-length subpath (`M x y Z`). I probed it and the behaviour is correct: round cap gives 1 dot segment, butt cap gives nothing |

## 1. Re-runs
- `node export/export.mjs`: 3.5 s (page() 3.3 s, export 90 ms). json 54.3 KB (7.2 KB gzip), bin 1937 KB (362.5 KB gzip).
  Counts: 240 items, 1783 prims, 24,324 tris, 26,122 verts, 20,851 segs, 209 dots, 73 palette entries, 1 gradient, 15 slots.
  The output is byte-identical to the committed `out/dl` (bin and json).
- **v2 `shared/kit.mjs` is being edited by another agent. This does not affect the export.** The current diff only adds
  an optional `settleStates` to `page()` (default `null`, which gives `AA.settle(R, P, undefined)`, the old call), so
  the re-export is byte-identical. The export is deterministic: two runs plus the `--theme` variant give identical bytes.
  Its real inputs are v2 `kit.mjs` / `centrifuge.mjs` and the anatomy kit loaded through the absolute path at
  `kit.mjs:6`, which is outside the repo and can change.
- `node tools/gate.mjs --themes light,dark`: gate passed (10 s). Run-to-run noise: the dark "any change" count was
  8,163 px in one run and 4,253 px in the next. The Δ>8 count is stable.
- `node tools/test-export.mjs`: 24/24 ok.
- `--mutate drop-fill | swap-paint | width`: all three make the gate FAIL (exit 1). drop-fill gives 0.56 %, swap-paint
  4.83 % (pixelmatch reports only 2 px, which confirms FINDINGS #7), and width also fails the Chrome role check
  (607 prims).

## 2. Independent binary reader (`out/tmp/qa-m1/reader.mjs`, written from DL-FORMAT.md only)
Everything I checked is consistent:
- **Header and sections:** magic "RNDL", v1, 5 sections, header 96 B. Offsets are 16-aligned, sections don't overlap,
  `byteLength = count·stride`, there is no tail padding, and json.sections and json.counts match.
- **Record agreement and references:** every vertex, segment and dot carries its prim's item, paint, layer and alpha.
  Every index is below the vertex count, no vertex is shared between fills, and each fillIndex, segment and dot is
  referenced by exactly one prim. Item prim ranges partition the prims, and layers are dense 0..n-1 per item.
- **Paint and flags:** palette props match prim kinds (stroke uses stroke, fill/dot use fill). The gradient bit equals
  the gradient flag (1 prim, 3 stop-color stops). Item flags equal the union of their prims' flags.
- **Floats and triangles:** no NaN/Inf. Orientation, checked on the **f32** triangles: 24,324 positive, 0 negative,
  0 zero-area.
- **Segments:** start/continuation/end are consistent and continuous, and closed polylines return to their start.
  There are 0 zero-length segments, and style is uniform inside each prim.
- **Widths:** 0.6 (round/round) ×15,181, 0.4 (butt/round, seams) ×5,669, 1.3* (override, tach mark) ×1. There is no
  0.45: the centrifuge has no tb-ring.
- **Dots:** 209 dots in 37 runs, r 0.36–0.42, record alpha 1. The per-tone opacity comes from CSS through the probe
  chain (`.iso-dots[data-tone] circle`); all static dots are the `mid` tone.
- **Prim alphas:** 0.95, 0.65 and 0.20 come from the 3 static opacity groups (one prim each); all others are 1.
- Real-scene coverage: for all 1,134 non-empty fills, 68k random points classified by an independent winding number on
  the source path vs coverage by the f32 triangles → 0 mismatches. Fuzz (`fuzz.mjs`, 5 seeds × 3,000 random
  multi-ring/self-intersecting polygons on a 0.1 grid + holes, shared edges, double loops, figure-8, slivers) → 0 failures.

## 3. Edge cases
- **Holes:** an opposite-orientation inner ring is cut out (area 300 of 400, no sampling errors). The 11 real
  mixed-orientation fills are covered by the sampling above. A same-orientation inner ring is filled (nonzero rule).
- **Self-intersecting, nonzero rule:** the bow-tie, pentagram (centre filled), a ring traced twice (winding 2) and a
  reversed figure-8 all match the winding count.
- **Zero-length segments:** repeats are removed; `M1 1L1 1` round gives a dot and butt gives nothing; `M1 1Z` round
  gives a dot. A two-point closed path (`M0 0L5 0Z`) emits 0→5 and 5→0 inside one prim, so M2 must not double-blend
  that overlap (by the "one path = one prim" rule).
- **Dots, per-tone opacity:** the palette key keeps `iso-dots[data-tone]` and the alpha comes from the probe. All 209
  dots render pixel-equal to v2.
- **`@back` halo:** rank −1, key null, 1 prim with the halo flag, probed with no ancestors (v2 draws it as a direct svg
  child). It renders identically (blur, translateY, CSS opacity .32 light / .9 dark), **but its prim is stored last** (D1).
- **Slots:** `slots.mjs` walks `.fx-parts` in `out/svg/centrifuge.html`, and all 15 `insertAt`/`seq` match the DL.
  The page's 16th `<g data-slot="overlay">` sits outside fx-parts and is not in the DL; the runtime never writes to it
  on this page.
- **Group opacity, the 3 static groups:** each is `<g opacity=.95|.65|.20>` around a single `iso-line` path with 2
  disjoint subpaths. Folding is mathematically exact, and the alphas are on the prims. Chrome renders the group layer
  very slightly differently: Δ ≤ 11 on ~6 px at the round caps of the faded ribs (`crop-light-motor-ribs.png`), well
  under the threshold.

## 4. Visual
I looked at the full v2, DL and diff PNGs for both themes, plus zoomed crops (×4–×12) of the belt edge, motor ribs,
cable, leg/foot hairline ends, the funnel gradient, the halo, the cabinet corner and the tach dial (light + dark).
**The two renders are indistinguishable.** The tach dial including the 1.3 px sync mark is pixel-identical (Δ 0).
Hairline ends and round caps match. An ×30 amplified diff shows only Δ 1–8 AA shimmer along vertical edges (legs,
cable).

## 5. Isomorphism and live parse
`export/svgsub.mjs` has no imports and no Node APIs. I loaded the **unmodified file** into headless Chrome with
`import(blobURL)` (preload + drive.mjs; `typeof process === "undefined"`). It parsed every live slot, including
Chrome's `innerHTML` serialization (`<path …></path>`) and the tach `style="stroke-width…"`.

Timings on the largest rotor sampled in 30 s (rotorBack + rotorFront = 16.8 KB, held 6/10; packets of 3 kinds):
- `parseSvg` alone: **0.083 ms**.
- parse + drawables + parsePathData: **0.184 ms**, which extrapolates to about **0.23 ms for a 21.6 KB rotor**.
- All 15 slots together (41.9 KB): 0.46 ms.

I also ran the real live markup (largest string per slot over 40 s) through `primitivesOf` in Node: no throws, and 46
palette entries. A full warm export of all slots (48.8 KB) takes **6.2 ms/frame (Node, unthrottled)**. The profile is
spread out: palette `idOf`/`probeNode` JSON keys ≈ 15 %, GC 8 %, libtess 6 %. For M3: cache palette ids per chain and
meshes per path string.

Note that `build-dl.mjs` → `tess.mjs` imports bare `earcut`/`libtess`, so it needs the esbuild bundle in a page.

## Defects
| # | Sev | What | Where | Repro / fix |
|---|---|---|---|---|
| D1 | Med | The `@back` (halo) prim is the **last** record in `prims`, yet DL-FORMAT says prims are "in draw order (items by rank, then layer)". A renderer that walks the buffer in order draws the halo on top. M2's `src/dl-loader.ts:118` already works around it by sorting on key −1e9. | `export/build-dl.mjs:246–249`; `notes/DL-FORMAT.md:26` | `reader.mjs` reports `drawOrderBreaks: [1782]`. Fix: emit back prims first, or document "sort items by rank". |
| D2 | Med (test value) | **The pixel gate cannot see a whole visible part vanish.** The limit is 0.1 % = 2,535 device px, against 10 px on a clean run. Dropping every prim of `centrifuge.eye` gives 476 px (0.019 %) and the gate passes (`crop-eye-dropped.png`). 149/239 items have a fill area under the limit. | `tools/gate.mjs:16` | `node out/tmp/qa-m1/drop-small.mjs centrifuge.eye`. Fix: an absolute cap (for example ≤ 50 px Δ>8) and/or a connected-cluster limit, plus a `drop-item` mutation. |
| D3 | Low–Med (test value) | dl2svg rebuilds strokes from the start segment's x0 plus every x1, uses `Z` for the closing segment, and takes cap/join/width from the last segment. The pixel gate is therefore blind to continuation-segment x0/y0, closing-segment x1/y1 and per-segment style. The structural gate doesn't check them either. Today's data is correct (my reader). | `tools/dl2svg.mjs:74–77` | Move the continuity, closure and uniform-style checks from `reader.mjs` into `gate.mjs` structural. |
| D4 | Low (test value) | The orientation check runs on the f64 mesh after `triangulate()` has already reoriented it, so it is tautological. | `tools/gate.mjs:78`; `export/tess.mjs` triangulate | Check the packed f32 triangles instead (0 negative today). |
| D5 | Low (test value) | Three gate checks are tautological. "bin header round trip" compares `pack()`'s header with `pack()`'s own table and reads the global `exported` instead of its argument. "ranks 0..238 in order" is true by construction. "15 slots placed" has bounds that are true by construction. The meaningful slot check (vs `<g data-slot>` in the v2 SVG) is missing. | `tools/gate.mjs:39,40,43` | Replace with the `slots.mjs` comparison and an independent header decode. |
| D6 | Low (latent) | The `groupOpacity` flag only considers **direct** children > 1. `<g opacity><g class="iso-solid">fill+shade</g></g>` gets alpha folded per element with no flag, so inner overlaps show through. The static scene is unaffected. | `export/svgsub.mjs:145` | `edge.mjs` "nested single-child opacity group". Count drawables under the group instead. |
| D7 | Low (latent) | `opacity="50%"` produces alpha NaN silently. Single-quoted attributes throw a misleading "trailing text" error. Numeric entities other than `&#39;` are not decoded. The kit emits none of these. | `export/svgsub.mjs:120, 8–9` | `edge.mjs` |
| D8 | Low (latent) | `data-pulse` is in `KEY_DROP`, so a pulsing dot (`.iso-dots circle[data-pulse]` CSS animation) loses its animation silently instead of throwing. It does not occur in the static scene. | `export/build-dl.mjs:9` | Throw like the dash attributes do. |
| D9 | Low | 287 fill vertices (1.1 %, 56 fills) are never indexed: points dropped as collinear or zero-area. This is undocumented and only wastes space. | tess / build-dl emitFill | `scene-cover.mjs` |
| D10 | Doc | DL-FORMAT.md:23 says "Every stride is a multiple of 8", but `fillIndices` has stride 4. Stroke prims with `count` 0 (zero-length butt) are not documented. PLAN-M1 step 2 names `export/scene-capture.mjs`, which does not exist (it was merged into `build-dl.mjs` `placeSlots`). ROADMAP lists "41 self-intersecting" where the exporter counts 93 (touching edges included). | notes | — |

## Test-value review (`~/.claude/references/low-value-test-dictionary.md`; all M1 tests are new on this branch)
**`tools/test-export.mjs` (24 tests): keep 23, flag 3. Nothing to delete.**
- **Keep (pure logic, dense):** the fill rules (earcut/libtess dispatch, union, nonzero nesting, hole, overlap,
  bow-tie, pentagram, degenerate, orientation), path-data parsing, polylines, segment flags, override width, dot runs,
  tubes, gradient, group opacity, halo/seamless, palette keying, slot rules, binary round trip and the error paths.
- **Flag, category 8 (stricter or other than the name):** "slot placement … after → latest target" asserts the v2
  `findIndex` first-match behaviour (FINDINGS #2). The behaviour is right because it mirrors v2, but the name should
  say so.
- **Flag, category 10-ish:** "unknown classes … throw" accepts any thrown error, so a TypeError from a bug would also
  pass. Assert on the message.
- **Flag, hermeticity:** "live slot markup" imports the real v2 `kit.mjs`, which another agent is editing right now.
  It stays valuable as a boundary contract for M3; keep it, but expect breakage from unrelated v2 edits.
- **Merge candidate (category 6, small):** "svgsub keeps the chain and resolves entities" could merge into the
  palette-key test.

**`tools/gate.mjs`:**
- Category 1 (tautological): orientation (D4), header round trip, rank order, slot bounds (D5).
- Category 8 (snapshot/brittle): the `CENSUS` constants. These are an acceptance criterion, so keep them, but they
  break on any legitimate scene change.
- Determinism vs `out/dl` is really a staleness check, and it is skipped silently when `out/dl` is missing.
- **Keep:** bounds, record agreement, area vs the independent `nonzeroArea`, the Chrome palette/role/alpha-override
  checks, the pixel gate and the `--mutate` self-tests. The pixel gate needs the D2 threshold change.

**Orphaned tooling sweep:**
- `OPACITY_ATTRS` re-export (`export/svgsub.mjs:169`) is unused, and `build-dl.mjs` keeps its own duplicate
  `ALPHA_ATTRS`.
- `parseStyle`, `MAGIC`, `VERSION` and `SECTION_ALIGN` are exported but only used internally (harmless format
  constants).
- No unused fixtures or helpers.

## Out-of-scope findings (v2 / kit)
1. `v2-factory/shared/kit.mjs:6` hard-codes `ANATOMY = "/Users/michalsek/.claude/skills/anatomy"`. v2 pages and the
   v3 DL therefore depend on mutable files outside the repo and are not portable.
2. The committed v2 `parts/centrifuge/centrifuge{,-light}.html` are stale relative to `runtime.js` (confirmed: SVG
   equal, `frameOffset` missing).
3. `kit.mjs:144` uses `findIndex`, which contradicts its own "latest" comment (confirmed; harmless today).
4. `kit.mjs:152` interpolates `data-name="${item.name}"` without escaping.
5. `page()` always emits `<g data-slot="overlay">`, which the runtime registers but never writes to on part pages.
6. All 15 slots are rewritten every frame. 48.8 KB of markup per frame was observed, which matches the ROADMAP finding.
