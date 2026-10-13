# FIX-M1: fix loop for the display-list exporter

This loop answers `QA-M1.md` (D1–D10 and the test-hygiene notes) and `CQ-M1.md` (S1–S13 and the nits). The consumer-facing format changes are listed at the top of `DL-FORMAT.md`.

## Per finding

### Strict SVG subset (CQ1, D6–D8)

`svgsub.mjs` now enforces the subset:

- **Path data**
  - Tokenized as letter / number / separator / stray character.
  - Any command letter other than M/L/H/V/Z throws, as does any stray character and a missing number.
- **Attributes**
  - Each tag has an allow-list. Everything else throws (`transform`, `fill-rule` other than `nonzero`, `clip-path`, `mask`, `filter`, `stroke-dasharray`, `gradientTransform`, `href`, …).
  - Single-quoted attributes are supported.
  - Numeric entities (`&#N;`, `&#xH;`) and the basic named entities decode. An unknown named entity throws.
- **Numbers**
  - Plain decimals only.
  - `%` is accepted on opacities and `offset`, and `px` in the inline `stroke-width`. Any other unit throws.
  - Gradient `x1`–`y2` are now required: the SVG defaults are not modelled.
- **`defs`**
  - Anything inside `defs` other than `linearGradient` throws, so nothing in `defs` is drawn.
  - `<stop>` outside a gradient throws, and so does a gradient outside `defs`.
- **Inline style** allows only `stroke-width`. The check moved from `build-dl` to `svgsub`.
- **`data-pulse`** throws in `roles.mjs`, next to the dash attributes, with a reason: the pulse is a CSS animation.
- **`groupOpacity`** now covers every element under a `<g opacity>` that draws more than one element, at any depth.

### Palette-probe and gate-side checks (CQ1)

- `palette-probe` reports the computed `fill-rule`, `stroke-dasharray`, `clip-path` and `mask`. `gate-page` fails unless they are `nonzero` / `none`.
- `parseColor` throws on anything other than `rgb()` / `rgba()`, `none` and `url()`.

### Pack and header validation (CQ2/3)

- **`pack`**
  - Every field is required except `pad`.
  - u32 fields must be integers in [0, 2³²−1], and f32 fields must be finite.
  - The error message names the section, record, field and value.
- **Gradient paint ids**
  - Built with `gradientPaint(i)`, which is `(PAINT_GRADIENT | i) >>> 0`.
  - Read with `isGradientPaint` / `gradientIndexOf`.
- **`sectionsOf`**
  - Validates the magic, version, section count, header size, each stride against `LAYOUTS`, `byteLength = count × stride`, 4-byte alignment, order / overlap and bounds.
  - Accepts `ArrayBuffer | ArrayBufferView`: it folds in `byteOffset`, and copies when that offset is unaligned.
  - Asserts a little-endian host.

### Layout and docs (CQ4/5, D9, D10)

- `SECTION_ALIGN = 256`.
- The stride doc was fixed: "struct sections are multiples of 8; `fillIndices` 4".
- Never-indexed fill vertices are dropped in `triangulate`, keeping the original order (26,122 → 25,835).
- Triangles are now also dropped when they are zero-area after f32 rounding, and are oriented on the f32 values.
- Stroke prims with `count` 0 are documented.
- The PLAN-M1 file name and the stale `kit.mjs:139–149` reference were fixed.
- The ROADMAP census line now notes that the exporter counts 93 non-simple fills (touching edges included).

### Shared record layouts (CQ6)

- `dl-format.mjs` exports `FIELD_WORD` / `STRIDE_WORDS` (derived from `LAYOUTS`) and `HEADER_BYTES`.
- `gate.mjs`, `gate-page.js` and `dl2svg.mjs` use them, with no hard-coded word offsets left.
- `src/dl-loader.ts` can import them (see below).

### Meaningful gate checks (CQ7, D4, D5)

These checks replace the ones that could not fail:

- **Settled keys** are non-decreasing by rank. The back item is last, with rank −1 and key null.
- **Item + slot order** is compared with the `<g class="fx-parts">` children of the generated page: 254 children.
- **The fx-parts markup** is rebuilt byte for byte from `itemMarkup` + the slot anchors.
- **Scene copy drift**: the gate diffs the scene file against v2 `build.mjs` modulo the documented edits (imports, the `STUB_LIVE` hoist, `out`, indentation).
- **The header** is decoded with a raw DataView and compared with an expectation written out independently from DL-FORMAT.md (magic bytes, 256 alignment, strides, `json.counts`, file length).
- **Orientation** is checked on the stored f32 triangles.
- **The polyline structure** is checked, as D3 asked: start/end pairing, continuity, closure, and uniform style per prim.
- **Records** must carry their prim's item, paint, layer and alpha, and every fill vertex is used exactly once.

### Role probes (CQ8)

- `--no-chrome` is now separate from `--no-pixels`. `--no-pixels` still runs the Chrome palette / role checks.
- `roles.mjs` exports `ROLE_PROBES`: 21 synthetic elements covering every rule, used in the scene or not. `gate-page` compares computed fill / stroke / width / cap / join with `roleOf`.
- `iso-wire-end` is now `WIRE_END` (0.6, butt / miter). I verified that reverting it to `LINE` fails the gate: "circle.iso-wire-end 0.6 butt miter vs 0.6 round round".
- The `tb-edge`-alone rule is removed: it has no CSS and the kit only emits `iso-line tb-edge`. A bare `tb-edge` now throws.

### Remaining should-fix items (CQ9–13)

- `structural` reads only its own arguments.
- **Determinism** is a second in-process export into `out/tmp/gate-determinism/`, comparing json, bin and both pages.
- **Freshness** is a separate check that fails when `out/dl` is missing or stale.
- **Census**: `EXPECTED` lives in `scenes/centrifuge.scene.mjs`.
  - It holds all 20 `CENSUS_KEYS` exactly, plus the DL counts. The update path is documented in place.
  - The stat is renamed `selfIntersecting` → `nonSimpleFills`.
  - The key sets must match, so a new census key forces an update.

### D1: draw order

The `@back` prims are emitted first. `json.items` keeps `@back` last, so `index === rank` still holds for the scene items.

### D2: pixel-gate limits

The pixel gate now fails when any of these holds:

- Δ>8 pixels > 50 px absolute.
- Δ>8 pixels ≥ 0.1 % of the frame.
- The largest 8-connected Δ>8 blob > 8 px.
- Any change at all ≥ 1 %. This limit was added because a swap of two dark shades only Δ 6 apart, `#0f0f0f` / `#151515`, passed in dark.

`--mutate drop-item <name>` was added. The `swap-paint` mutation now looks up its pair by attributes.

### D3: dl2svg uses every segment field

dl2svg now reads:

- Continuation x0 / y0: a mismatch restarts the subpath.
- The closing x1 / y1: `Z` is used only when the segment returns to the subpath start.
- Per-segment width / cap / join / alpha: a change starts a new `<path>`.
- The dot record alpha.

A unit test covers all three stroke cases.

### Test hygiene

- `tools/test-export.mjs` now uses `node:test` + `node:assert/strict`, with 28 tests.
- Every "throws" case asserts its specific message: 28 cases.
- New cases:
  - closed zero-length subpath
  - `iso-wire-end`
  - unsigned gradient id
  - nested opacity group
  - accepted syntax
  - `pack` validation
  - `sectionsOf` validation and byteOffset handling
  - dl2svg
- The slot test name now states kit's first-match behaviour.
- The live-markup test imports the anatomy `iso-kit.mjs` directly, not v2 `kit.mjs`. It is isolated from the concurrent kit edits but still depends on the skill kit outside the repo.

### Nits

- **Naming**
  - `unescape` → `decodeEntities`.
  - `exact` / `matched` → `changed` / `mismatched`.
  - `collect` / `checks` → `collectFillChecks` / `fillChecks`.
  - `build` → `buildProbeChain`.
- **Dead code**
  - `special.gradient`, the `dot` role field, `??=`, the `dotAlpha` alias and `parseStyle` are gone.
  - `groupAlpha` is now `hasFilter`.
- **Deduplication**
  - One `OPACITY_ATTRS`, exported from svgsub.
  - `samePoint` / `withoutRepeats` / `EPS` are exported from tess, and `cleanRing` composes them.
  - The earcut deviation limit is named.
- **Census and fill code**
  - Census tallying is separated from emission (`tallyFill` / `tallyStroke` / `tallyGroups`).
  - Fill rings and their simplicity are computed once (`triangulate` returns `rings` / `simpleRings`).
  - The stats object is derived from `CENSUS_KEYS`.
- **Build output and CLI**
  - The JSON is assembled once in `buildDisplayList`, which also packs.
  - `VERSION` is imported.
  - `@back` gets `key: null` directly, and non-finite scene keys throw.
  - The `cliOption` helper is shared. An unknown `--mutate` gives a clear error.
- **Gate page**
  - It is bundled with esbuild (`buildSync`, IIFE, `globalName: "dlGate"`); the regex inlining is gone.
  - `stripScript` is non-greedy, and the svg is anchored on `.fx-stage`.
  - The 390 truncation is named and explained. Sample indices are guarded.
- **palette-probe**
  - `alphaAttrsOverridden` uses try/finally through `withProbeRoot`.
  - Probes are built in one batch, then read, then removed once.

## Skipped (with reason)

- **CQ8, longer-term half: deriving width / cap / join from probes at export time.** The exporter runs in Node without CSS, so it cannot read computed style. I asserted every rule in Chrome instead (`ROLE_PROBES`). Moving geometry to the runtime probe (and shrinking `roles.mjs` to fill / stroke / dot) is a renderer-side change that belongs with `src/`.
- **CQ nit: `CENSUS` snapshot brittleness.** This is kept on purpose as an acceptance criterion. It now lives with the scene, and its update path is written down.
- **Bit-for-bit independence of the scene from `~/.claude/skills/anatomy`** (QA out-of-scope #1). This is a v2 / kit issue and outside v3.

## Verification (2026-10-13)

### Export and baseline

- `node export/export.mjs`: 240 items, 1783 prims, 24,324 triangles, 25,835 fill vertices, 20,851 segments, 209 dots, 73 palette entries, 1 gradient, 15 slots. json 54.3 KB, bin 1931.3 KB (361.0 KB gzip).
- Byte changes and why:
  - Section offsets moved to 256 alignment.
  - The halo prim moved to `prims[0]`.
  - Palette ids shifted by one: the halo entry is id 0.
  - 287 unindexed vertices were dropped and fill vertex numbering compacted.
  - Gradient vertex paint ids are identical bytes (the u32 was always `0x80000000`).
- The `out/svg` pages are `cmp`-identical to a fresh v2 build: v2 `build.mjs` copied into scratch with only its two import paths made absolute.
- The `--theme dark` export is byte-identical (the DL is theme-independent).

### Gate

`node tools/gate.mjs` (light + dark): every check passes.

| Theme | Δ>8 | Largest blob | Any change |
|---|---|---|---|
| light | 10 px | 1 | 0.33 % |
| dark | 2 px | 1 | 0.17–0.32 % (run-to-run AA noise) |

### Mutation self-tests

All of these fail the gate (exit 1). Δ>8 counts are light / dark.

| Mutation | Result |
|---|---|
| `drop-fill` | bowl: 0.56 % / 0.36 % |
| `swap-paint` | light 4.8 %; dark caught by any-change, 5.4 % |
| `width` | Chrome geometry check, plus 3.3 % / 3.0 % |
| `drop-item centrifuge.eye` | 476 / 317 px |
| `drop-item centrifuge.grease-nipple` (29 u²) | 59 / 53 px |
| `drop-item centrifuge.drain-stem` (31 u²) | 42 / 30 px, blob 32 / 28 |
| `drop-item centrifuge.grease-nipple-ball` | 81 / 71 px |
| `drop-item centrifuge.belt:chunk#2` | 82 / 67 px |
| `drop-item centrifuge.cabinet-hinge#2` | 178 / 169 px |
| `drop-item centrifuge.gland` | 125 / 117 px |
| `drop-item centrifuge.belt:chunk#17` | 124 / 120 px |
| `drop-item centrifuge.oil-line:chunk` | 233 / 163 px |

Two kinds of item stay undetectable by design:

- `centrifuge.motor-shaft` (37 u²) changes no pixel at all: the counts equal the clean run, so it is fully occluded in the static frame.
- The six `centrifuge.env-*` items have no prims.

### Tests and live markup

- `node tools/test-export.mjs`: 28/28 pass.
- QA's live slot markup (`out/tmp/qa-m1/live-slots.json`, all 15 slots) goes through the strict `primitivesOf` with no throws.

### src/dl-loader.ts (read-only check)

The loader loads the new binary unchanged; **nothing in `src/` has to change**.

- **Scene comparison.** I bundled `src/dl-loader.ts` with esbuild into scratch and loaded the old and new DLs with `sceneFromDl`. After sorting by (item, layer) and resolving paint descriptors, fills (1134), strokes (610), dots (209), items and viewBox are identical. Only array order and paint indices differ. The halo fill is now `fills[0]`.
- **GPU render.** I built the `static(-light).html` harness into scratch with a copy of the `tools/build.mjs` harness function (out/gpu untouched). I captured it with `capture.mjs` and `CHROME_PATH=tools/chrome-webgpu.sh` for the old and new DL: 0 px differ in both themes (pixelmatch, AA included).

Recommended, optional changes for the `src/` owner:

1. Import `FIELD_WORD`, `STRIDE_WORDS`, `PRIM_KIND`, `PRIM_FLAG`, `SEG_FLAG`, `MAGIC`, `VERSION`, `isGradientPaint` and `gradientIndexOf` from `export/dl-format.mjs`, instead of the local `KIND_*` / `SEG_*` / `PAINT_GRADIENT` constants, the magic literal and the hard-coded word offsets. Optionally use `sectionsOf()` to get validated views.
2. The `key ?? -1e9` sort for `@back` keeps working. Prims now arrive in draw order, so it is no longer needed for order.
3. To bind sections as sub-ranges of one GPUBuffer, rely on the 256-byte offsets (`json.sections[i].offset`).
4. The loader assumes round joins, and strokes carry only `cap`. `iso-wire-end` / `fx-fluff` outlines are miter-joined (`SEG_FLAG.joinRound` clear). None are in the static scene, but live slots or other scenes may have them.
