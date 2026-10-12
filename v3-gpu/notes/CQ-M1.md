# CQ-M1 — code-quality review of the M1 display-list exporter

Scope: commit `7d2c5a2`, covering `export/*.mjs`, `scenes/centrifuge.scene.mjs`, `tools/{dl2svg.mjs,gate.mjs,gate-page.js,test-export.mjs}`, `package.json` and `notes/DL-FORMAT.md`. I made no code edits.
Rules applied: the `code-quality-dictionary.md` [U] rules that fit plain ES modules (TS-5/6-style silent coercion, QT-1, §R severity, §N non-goals), the expressive-code skill, and the v2 kit house style.
I skipped the React, RN and Expo sections and the [REPO] rules, because this codebase has no equivalents.

## Measurement (dictionary §M, adapted)

| Step | Result |
|---|---|
| 1 Size | 1721 added lines in scope. That is above the ~1.5k split threshold, but it is a single new module tree, so a split is not worth it. |
| 2 Gates | No lint, format or tsc scripts exist. `node tools/test-export.mjs`: **all passed** (23 tests). `node tools/gate.mjs --no-pixels`: **gate passed** (11 checks). `node --check` passes on all files. I did not run the pixel / Chrome gate, to stay off the shared `out/gate/`. |
| 4 Type-aware (ad hoc) | `tsc --checkJs` with `lib: [es2022, dom]` and **no Node types** over `svgsub`, `build-dl`, `tess`, `roles`, `dl-format`, `palette-probe` and `dl2svg`. The only output is a false positive for a closure-mutated `current` in `parsePathData` (a §N non-goal). This confirms the isomorphic modules use no Node API. `svgsub.mjs` is browser-safe: `matchAll` on global regexes, `??`, no lookbehind, no `Buffer`. |
| 6 Grep | No `Math.random` or `Date.now`, and no TODOs. `catch {}` appears only in the tests. |
| Line length | Long lines (max 439) match the v2 style (`kit.mjs` max 269, `iso-kit.mjs` max 436), so line length is not flagged. |

Runtime probes I ran to confirm the silent-fallback findings (none of these throw today):

```
parsePathData("M0 0 X 5 5 L1 1")                 → X dropped, 5 5 drawn as an implicit lineto
<path class="iso-fill" transform="translate(100 0)"> → accepted, geometry untransformed
<path class="iso-fill" fill-rule="evenodd">        → accepted, tessellated nonzero
<linearGradient gradientTransform=…><stop offset="50%"> → accepted, stop offset NaN
<defs><path class="iso-fill" …></defs>             → drawn as a normal fill
<circle cx="1px">                                  → cx NaN
pack({ prims: [{ itme: 7 }] }) / segments item −1  → item 0 / item 4294967295
```

## Should-fix (S)

1. **[S] The "anything else throws" contract is not enforced.** See `export/svgsub.mjs:1-3,55,59-60,120,130-136,153-164`, `export/build-dl.mjs:122` and `notes/DL-FORMAT.md:118-121`.
   - What is silently accepted:
     - The `NUMBER` tokenizer only matches M/L/H/V/Z. Any other letter is skipped, so its numbers become implicit linetos. Only C/S/Q/T/A are rejected, by a separate regex.
     - Unknown attributes are ignored: `transform`, `fill-rule`, `clip-path`, `mask`, `marker-*`, `gradientTransform`, `spreadMethod` and `href`.
     - Non-gradient children of `<defs>` are drawn.
     - `Number()` turns `"50%"` or `"1px"` into NaN.
   - Fix:
     - Tokenize with `/[A-Za-z]|<number>/g`, so the `switch` `default:` throws for any unsupported command, and drop the separate curve regex.
     - Keep a per-tag attribute allow-list in `svgsub` (geometry + `class`/`data-*`/`aria-*`/`role`/`id`/opacity/`fill`/`style`) and throw on anything else.
     - Add a strict number reader `numberAttr(node, name, fallback)` that throws when the value is not finite.
     - Throw on non-`linearGradient` children of `defs`.
     - Also add computed `fill-rule`, `stroke-dasharray`, `clip-path` and `mask` to `resolvePalette`, and make `gate-page` fail unless they are `nonzero`/`none`. CSS can set these too, and the exporter cannot see CSS.

2. **[S] `pack` silently coerces bad records.** See `export/dl-format.mjs:46-48` and `export/build-dl.mjs:162`.
   - Problems:
     - `?? 0` turns a misspelled or missing field into 0.
     - `value >>> 0` wraps negatives, truncates fractions and turns NaN into 0.
     - `setFloat32` accepts NaN.
     - `PAINT_GRADIENT | index` is a **negative** int32 in JS. In the centrifuge that is 1 prim and 24 fill vertices. It is correct only because `>>> 0` re-wraps it. Any check comparing sink records against decoded u32 values, or a JSON dump of records, sees a different number.
   - Fix:
     - In `pack`, require every field except `pad`.
     - Require `Number.isInteger(v) && v >= 0 && v <= 0xffffffff` for `u`, and `Number.isFinite(v)` for `f`. Throw with section, record and field in the message.
     - Build gradient paints as `(PAINT_GRADIENT | index) >>> 0`, or `PAINT_GRADIENT + index`. Expose `isGradientPaint(id)` / `gradientIndexOf(id)` helpers so no caller repeats the bit maths: today `dl2svg:55,57`, `gate-page:38` and `src/dl-loader.ts` all do.

3. **[S] `sectionsOf` trusts the header.** See `export/dl-format.mjs:56-69`.
   - Problems:
     - It does not check the section count against `SECTIONS.length`; a larger count maps `SECTIONS[s]` to `undefined`.
     - It does not check the stride against `LAYOUTS[name].stride`, `headerBytes`, `offset + byteLength <= buffer.byteLength`, `offset % 4`, or `byteLength === count * stride`.
     - It accepts only a bare `ArrayBuffer`. A Node `Buffer`'s `.buffer` may be pooled with a non-zero `byteOffset`; that is silently misread.
   - Fix: validate each field and throw. Accept `ArrayBuffer | ArrayBufferView` and fold in `byteOffset`.
   - Optionally assert a little-endian host once (`new Uint8Array(new Uint32Array([1]).buffer)[0] === 1`). The typed-array views assume it, even though the writer is explicit about little-endian.

4. **[S] `SECTION_ALIGN = 16` does not support the documented promise "a section binds directly as a storage buffer".** See `export/dl-format.mjs:2-3,7` and `notes/DL-FORMAT.md:13,23-24`.
   - WebGPU's default `minStorageBufferOffsetAlignment` is 256. Binding sections of one uploaded GPUBuffer at `entry.offset` fails validation; only per-section uploads work.
   - Fix: set `SECTION_ALIGN = 256` (at most about 1.3 KB of padding), or reword the doc to "upload each section to its own buffer".

5. **[S] The doc and comment are wrong on strides.** `DL-FORMAT.md:23` says "Every stride is a multiple of 8", and `dl-format.mjs:2` says "record strides are multiples of 8". `fillIndices` has stride 4.
   - Fix: "every struct section (all but `fillIndices`) has a stride that is a multiple of 8".

6. **[S] Record layout is duplicated as hard-coded word offsets.**
   - Locations:
     - `tools/gate.mjs:47-49` (`*6`, `*12`, `*8`) and `:161-172` (`p*8+6`, `s*12+8`)
     - `tools/gate-page.js:34-44` (`+3 +5 +6 +7`, `+8 +9`)
     - `tools/dl2svg.mjs:64,76-77,86` (`base`, `base+1..3`)
     - `src/dl-loader.ts:10-13` redeclares `PRIM_KIND`, `SEG_FLAG` and `PAINT_GRADIENT` (out of this review's scope, but it is the same drift).
   - `dl-format.mjs` claims to be the single source of truth, but changing a field order today silently breaks four readers. `dl2svg` already has a private `field()` helper.
   - Fix: export from `dl-format.mjs` a derived `WORD = { prims: { kind: 0, item: 1, … }, … }` and `STRIDE_WORDS`, built from `LAYOUTS`, and use them everywhere, including the renderer.

7. **[S] v2 logic is copied with nothing detecting drift.**
   - What is copied:
     - `placeSlots` (`build-dl.mjs:54-72`) copies the slot loop of kit `page()`.
     - `itemMarkup` (`:233`) copies kit's `<g class="it …" data-name>` wrapper.
     - `lift` (`:243-244`) copies kit's explode formula.
     - `scenes/centrifuge.scene.mjs` is a copy whose header claims "Scene content is unchanged". I diffed it against v2 `parts/centrifuge/build.mjs` and it is a faithful copy today, but nothing enforces that.
   - The pixel gate cannot see slots, because scripts are stripped and slots are empty. The slot check (`gate.mjs:40`) only range-checks `insertAt`.
   - Fix (v3-only; v2 stays read-only):
     - In `structural`, parse the generated page's `<g class="fx-parts">` with `parseSvg`. Assert that its child sequence equals `itemMarkup(items)`, with each `<g data-slot>` at the `placeSlots` `insertAt`/`seq` position. This is exact and cheap.
     - Add a scene-copy check: read the v2 `build.mjs`, take the text from `const ctx = scene(` through `audit: {},\n});`, dedent it, swap `out: join(HERE, …)` for `out`, and compare it with `run()`'s body.

8. **[S] Drift in the `roles.mjs` CSS mirror is only partly detected.** The header (`roles.mjs:3`) says "drift in the CSS fails the gate", but:
   - The checks run only inside Chrome, and `--no-pixels` skips Chrome entirely (`gate.mjs:183`).
   - Only classes present in the scene are probed. `iso-wire-end` is mapped to `LINE` (round cap/join, `roles.mjs:27`), but its CSS rule (`iso-kit.mjs:624`) sets no cap or join, so it computes butt/miter. That mismatch is latent; it is not in the centrifuge figure. `FLUFF` is likewise never verified.
   - Fix:
     - Split `--no-chrome` from `--no-pixels`.
     - In `gate-page`, probe one synthetic entry per class `roleOf` knows (the same pattern as the lamp-glow probe at `gate-page.js:59`), whether or not the scene uses it.
     - Longer term: read width, cap and join from the palette probe (it already returns them), keep only inline overrides in the DL, and shrink `roles.mjs` to tag/class → fill/stroke/dot.

9. **[S] `gate.mjs:43` reads the module-level `exported`** instead of its own `json` parameter. It works only because `structural` is called after line 176.
   - Fix: `json.sections.find(…)`.

10. **[S] "export is deterministic" (`gate.mjs:89-93`) is a freshness check against committed `out/dl/`, and it is silently skipped when that file is missing.**
    - Fix:
      - Export twice in-process and compare JSON and bytes (true determinism).
      - Separately, add an "out/dl is fresh" check that **fails**, not skips, when the file is missing.

11. **[S] `gate.mjs:38-39` is a tautology.** `rank` is assigned from the `map` index (`build-dl.mjs:240`), so `r === i` always holds.
    - Fix: assert the property the exporter actually depends on, that `page()` left `R.items` settled and sorted: `json.items` keys are non-decreasing. I checked and they are today.

12. **[S] The census expectations are scene-specific constants in a scene-parameterized gate,** and one census number disagrees with the ROADMAP. See `gate.mjs:19,36-40`.
    - The values 1136…, 15100±150, 239, 15 and 1 are all centrifuge numbers.
    - `stats.selfIntersecting` is 93, while ROADMAP says "41 self-intersecting". It is left out of "census matches ROADMAP", because `isSimpleRing` also counts touching edges.
    - Fix:
      - Move the expectations into the scene module (`export const EXPECTED = {…}`).
      - Rename the stat `nonSimpleRings`, or reconcile the ROADMAP number. Keep every census key in the check.

13. **[S] The `groupOpacity` flag counts direct children, not drawn descendants** (`svgsub.mjs:145`).
    - `<g opacity=".5"><g><path/><path/></g></g>` is not flagged, although its two paths blend as a group.
    - Fix: flag the element when the nearest `g[opacity]` ancestor has more than one drawable leaf descendant. Precompute that per group in `drawables`.

## Nits (N)

- **Comments and dead code**
  - `palette-probe.mjs:70`: the comment names `alphaAttrsHonoured`, but the function is `alphaAttrsOverridden`. The function also lacks the `try/finally` that `resolvePalette` has, so probes can leak if it throws.
  - `roles.mjs:24`: `special.gradient` is dead (`build-dl` uses `urlRef` again). The `dot` field of `roleOf` is never read.
  - `svgsub.mjs:119,169`: `OPACITY_ATTRS` is exported but unused, and duplicates `build-dl.mjs:10` `ALPHA_ATTRS`. Keep one.
  - `build-dl.mjs:253`: `??=` is dead, because `flags` was set on every item at line 251.
  - `dl2svg.mjs:25`: `groupAlpha` carries a value that is only tested for nullness; return `hasFilter: boolean`. At `:85`, the `dotAlpha = total` alias plus its comment add nothing.
- **Naming**
  - `svgsub.mjs:11`: `unescape` shadows the deprecated global `unescape`. Rename it to `decodeEntities`. Numeric entities other than `&#39;` stay encoded.
  - `gate.mjs:142-153`: `exact` counts *changed* pixels, so rename it `changed`. `matched` is pixelmatch's *mismatch* count, so rename it `mismatched`.
  - Single-letter stride names mean different things in different files:
    - `P/V/S/D` are word strides in `dl2svg.mjs:31-34` and `gate-page.js:28-29`.
    - In `gate.mjs`, `S` is the sections object.
    - In `build-dl`, `V` is the kit view vector.
    - Use `WORD`/`STRIDE_WORDS` from S-6, or descriptive names.
  - `collect` / `checks` are vague; rename them `collectFillChecks` / `fillChecks`. In `palette-probe.mjs:15`, `build` is a generic name for a top-level function inlined into a shared page scope; rename it `buildProbeChain`.
- **Silent fallbacks, duplication and constants**
  - `build-dl.mjs:249,262`: `key: -Infinity`, mapped later to `null`, is roundabout. The same `Number.isFinite` mapping would also silently null a NaN scene key. Set `key: null` on `@back` directly, and throw on non-finite scene keys.
  - `build-dl.mjs:256`: `version: 1` is hard-coded; import `VERSION` from `dl-format`.
  - Near-duplicate helpers: `build-dl.mjs:93-94` `samePoint`/`withoutRepeats` (with its own 1e-9) duplicate `tess.mjs` `cleanRing`/`EPS`. Export one `samePoint` and `EPS` from `tess` and compose them. Also `tess.mjs:54`: name the earcut deviation limit `1e-6`.
- **Readability of `primitivesOf`**
  - `primitivesOf` (`build-dl.mjs:102-218`, about 115 lines) mixes census counting with emission.
  - The predicate `el.tag === "path" && !(flags & PRIM_FLAG.seamless)` is repeated at lines 177 and 188.
  - `emitFill` recomputes `cleanRing` and `isSimpleRing`, which is O(n²), and `triangulate` then does both again. Have `triangulate` return `{ rings, simple }`.
  - `createSink`'s 439-character stats literal could be derived from a `CENSUS_KEYS` array.
- **Assembly**: `export.mjs:27-28` patches `json.sections` and `json.counts` after `buildDisplayList`. Assemble the JSON in one place.
- **Tooling and gate robustness**
  - Duplication and error handling: `gate.mjs:22` and `export.mjs:35` duplicate the `option()` parser. An unknown `--mutate` name throws a bare TypeError (`gate.mjs:180`). There is a double blank line at `gate.mjs:30-31`.
  - Fragile inlining:
    - `gate.mjs:96-98` inlines modules with a regex strip. That breaks on multi-line imports, `export {…}` or `export default`, and on top-level name clashes across the three inlined files. This matches how the v2 kit inlines `lathe`, but `esbuild` is already a dependency: `buildSync({ bundle: true, format: "iife", write: false })` would be safer.
    - `gate.mjs:100`: `stripScript` is greedy (`[\s\S]*`).
    - `gate.mjs:103` finds the first `<svg xmlns`, while `gate-page.js:6` uses `.fx-stage svg`. Anchor both on `fx-stage`.
  - Magic values:
    - `gate.mjs:168`: the `swap-paint` mutation assumes palette ids 1 and 3; look the entries up by attributes instead.
    - `gate-page.js:12`: the 390 truncation is unexplained.
    - `gate-page.js:62-63`: `[0, 1, 5]` sample indices throw on a palette with fewer than 6 entries.
- **Probe robustness (live adapter)**
  - `parseColor` (`palette-probe.mjs:8-13`) returns NaN for percentage alpha. It returns `null` for computed `oklch()` / `color(srgb …)` values, which Chrome returns once the kit adopts CSS Color 4 tokens. Throw, or log a clear error, instead.
  - `resolvePalette` forces a style recalculation per entry: append, read, remove. Build every probe first, read them all, then remove the root once.
- **Not enforced after quantization**: "every triangle positive" is verified on the f64 mesh, not on the packed f32 data. Today the minimum doubled area after f32 rounding is 3.4e-4 (checked on `out/dl/centrifuge.dl.bin`), so this is safe now. Apply `Math.fround` before the orientation and sliver test in `triangulate`, or run the gate's orientation check on the packed buffer.
- **Stale reference**: `DL-FORMAT.md:92` cites `kit.mjs:139–149`, and the working-tree kit has already shifted. Reference "the slot loop in `page()`" instead.
- **Tests (QT-1)**
  - `test-export.mjs` has no tests for the silent cases above (S-1, S-2, S-3), for `sectionsOf` rejecting a bad header, or for `dl2svg`.
  - `node:test` + `node:assert` (`assert.throws`) would replace the hand-rolled harness and its two `threw` try/catch blocks.

## Out-of-scope issues in v2 / kit code (follow-ups; not touched)

- `v2-factory/parts/centrifuge/build.mjs` has unused imports (`k`, `A`), a dead `const S = ctx.S`, and a double blank line; the v3 copy carries all of these over verbatim. It also writes its page at import time instead of exporting a builder, which is what forced the v3 copy. Export `buildScene()`.
- `v2-factory/shared/kit.mjs` `page()`:
  - Slot placement, the item `<g class="it">` wrapper and `lift` are inline and not exported, so v3 must copy them. Export `placeSlots` / `itemGroupSvg` / `liftOf`.
  - `page()` sorts `R.items` in place as a side effect that v3 depends on.
  - `page()` calls `auditOrExit`, which reads `process.argv` implicitly.
- Kit `iso-kit.mjs:624` / `iso.css:57`: `.iso-wire-end` sets `stroke-width` but no cap or join, so it computes butt/miter, unlike `.iso-line`'s round/round. It is probably meant to be round/round.
- `v2-factory/shared/factory.css:20-21`: `.fx-fluff` uses hard-coded `#1c5f78` / `#ffffff` rather than theme tokens, so it has no dark variant.
- The kit inlines `lathe.mjs` with the same regex strip (`page()`), so it has the same fragility as `gate.mjs:96`.
- Cross-agent (`src/`): `src/dl-loader.ts:10-13,26` re-declares the format constants and the magic, instead of importing them from `export/dl-format.mjs`. Address it together with S-6.
