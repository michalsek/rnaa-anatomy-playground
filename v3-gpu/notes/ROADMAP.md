# v3-gpu roadmap (from roadmap planner, 2026-10-12)

## Findings (ground truth from v2)
- `parts/centrifuge/build.mjs` writes files at import (`page({out})` build.mjs:133) → never import it; COPY it into `v3-gpu/scenes/centrifuge.scene.mjs` (stubs, STUB_LIVE, page options). `centrifuge.mjs` and `shared/kit.mjs` are side-effect free → import directly from ../v2-factory (read-only!).
- `scene()` (kit.mjs:20–119) returns ctx; each helper builds SVG strings immediately and calls `ctx.put(name, ref, svg, shapes, {bias, material})` → `R.put` (audit.mjs:1830). Item = {name, svg, shapes, material, key=ref·V+bias, piece, move}.
- `page()` → `A.settle(R,P)` (kit.mjs:136) rewrites item.key; then sorts R.items by key (kit.mjs:137). Slots = `<g data-slot>` inserted after/before a named item (kit.mjs:138–148). Explode wraps items with data-k/data-l (kit.mjs:150–156); assembly re-sorts by k + l·share (assembly/build.mjs:164–206). Centrifuge page: explode:false.
- Exporter hook: call real `page()` with `out` into v3-gpu/out/svg/ → SVG baseline/fallback AND settled+sorted ctx.R.items; parse each item.svg; mirror the 12-line slot placement. Coords already 0.1-rounded (pathOf/tenth iso-kit.mjs:24–32).
- runtime.js injected with `__FACTORY_DATA__` (kit.mjs:160), finds slots via `svg.querySelectorAll("[data-slot]")` (runtime.js:15); LIVE does `slot.innerHTML = string` every frame for every slot (centrifuge.mjs:1174–1182). Page script = kit globals + lathe subset + runtime + LIVE + boot (kit.mjs:166).

### SVG feature census (centrifuge-light: 782 KB, SVG 650 KB)
239 items; 1661 path / 529 g / 209 circle. 168 solids (fill+top+edge), 603 shade paths, 166 crease + 74 bevel + 52 other lines, 65 tube chunks (body/shine/shade/edge), 37 dot groups (209 circles r 0.36–0.42).
Path commands: ONLY M/L/Z (2981 M, 44338 L). No C/Q/A (assembly too).
Fills: 1136 paths (1956 subpaths, 31k verts); 379 multi-subpath, 11 mixed orientation, 41 self-intersecting (the M1 exporter counts 93 non-simple fills: touching edges included); nonzero rule everywhere.
Strokes: 525 paths (1025 polylines, 15.1k segs); tones faint 270 / mid 231 / lo 50 / hi 11.
NONE: clipPath, mask, filter attr, text, transform, dasharray.
Must handle: 1 linearGradient (funnel void, 3 stops, colors from CSS classes, centrifuge.mjs:506–513); 3 `<g opacity>` (faded motor ribs); 1 halo (CSS filter blur(9px), 3px offset, opacity .32, iso-kit.mjs:611); per-tone dot opacity (iso-kit.mjs:629–633); packet lines .55 (factory.css:19); lamp glow mix-blend multiply(light)/screen(dark) (centrifuge.mjs:74–75); 17 "seamless" solids also stroke tone regions at 0.4px (iso-kit.mjs:602–609); non-scaling stroke 0.6 CSS px (iso-kit.mjs:576,591); tach sync mark stroke-width 1.3 (centrifuge.mjs:540).
Text: none in SVG; card corners/readout/legend/caption are HTML (plateHtml iso-kit.mjs:550–556) → stays HTML around canvas.
Interaction on centrifuge page: none (no pointer/click/key); focusable stage role=group, aria-live status span, IntersectionObserver gates loop (runtime.js:124).
Live per frame: 13 centrifuge slots + 2 stub slots rewritten every frame (even reduced motion). Rotor ≈21.6 KB (10 vanes ×660 B + up to 10 packets ×1.5 KB), stub belt slats ≈11.5 KB; total ≈35–45 KB markup/frame. Best native hot path: rotor (`drawRotor` centrifuge.mjs:821–846), CPU sort by d into rotorBack/rotorFront slots.
Tones: `--anatomy-*` (iso-kit.mjs:568–589) light/dark; `.it.fx-graphite`/`.fx-react` (factory.css:23–25); `.pk[data-kind]`×5 (factory.css:4–18); `--cf-*` (centrifuge.mjs:69–77); `.iso-plate` paper→card (iso-kit.mjs:650). Colour = CSS cascade of material context × role.

## Layout
v3-gpu/{package.json (exact pins), scenes/ (copied centrifuge scene, stress10.mjs), export/ (svgsub.mjs isomorphic parser, tess.mjs, dl-format.mjs, export.mjs), src/ (renderer.ts, pipelines/, palette.ts, adapter.ts, native-rotor.ts), tools/ (perf.mjs, diff.mjs, lockstep.js), out/ (svg baselines, DL binaries), centrifuge-gpu{,-light}.html, REPORT.md, index.html, notes/}

## Milestones
- **M0 scaffold + TypeGPU base** — pinned deps, esbuild bundle, TypeGPU pipeline 4×MSAA + depth + storage-driven instanced quad, raw-device escape hatch; freeze dl-format; lockstep.js preload (fixed 1/60 rAF, freeze after N frames). (Spike in scratchpad provides headless flags + working minimal code.)
- **M1 exporter** — copied scene → page() into out/svg/ → parse item SVGs → fills (simple: earcut; multi/mixed/self-intersecting: libtess nonzero) + polylines (width, paint, round cap) + dots + gradient + palette keys (material|role) + per-item {key, lift, piece, rank, layer} + slot ranks. Gate: DL→SVG debug render pixel-diff <0.1% vs v2 static frame. SVG build untouched.
- **M2 static renderer** — pass A opaque fills 4×MSAA + depth32, depth from (rank·L+layer) via item storage buffer (key + lift·share); pass B lines/dots/gradient/translucent in painter order, depth-test vs fills, no depth write, analytic capsule coverage, width in device px, sub-px hairline alpha×width, no double-blend at joins; halo pre-blurred texture; non-sRGB bgra8unorm (gamma-space blend like Skia); palette via probe elements + getComputedStyle; DPR via devicePixelContentBoxSize + ResizeObserver. Gate: static frame ≤0.5% px diff at DPR2; 4× crops no seams/fringes.
- **M3 live adapter** — runtime.js verbatim + hidden SVG skeleton of slot `<g>`s; override slot innerHTML setter → svgsub+earcut → dynamic per-slot buffers; pass B split at slot ranks. Gate: lockstep frame diffs vs v2 through fill/spin/release; no popping.
- **M4 packaging** — single-file HTML (inline bundle + gzip/base64 DL + card), light+dark; SVG fallback from `<template>` when no navigator.gpu/adapter (test via preload deleting navigator.gpu); reduced motion, canvas role=img, aria-live, theme re-probe.
- **M5 native rotor** — inject one asserted line at `function drawRotor(now) {` in LIVE string → `api.gpu.rotor({...})`; WGSL instanced prisms, 4-tone face shading, edge quads, CPU d-sort ranks; `?native=0/1`.
- **M6 measurement** — perf.mjs (CDP CPU throttle 4×, 390px, rAF + performance marks, LoAF, trace), diff.mjs, 10-centrifuge stress; variants SVG / SVG-dirty-check / SVG-layered / GPU-adapter / GPU-native at 1× and 4×; assembly static layer stretch.
- **M7 REPORT.md + index.html** — crops, perf, parity gaps, full-factory estimate, hybrid options (SVG layers + will-change; rasterize static runs; canvas-painter.mjs needs adapter since it expects turn-kit svg[data-live]/[data-p]).

## Risks
1. AA fringe vs depth → fills MSAA+depth; all blended stuff ordered in pass B w/o depth write.
2. Hairline parity with Skia → box-filter coverage, gamma-space blending, calibrate on 4× crops (0.6/1.3 px).
3. Nonzero topology → libtess for complex; M1 diff gate.
4. TypeGPU gaps → TypeGPU for typed layouts/buffers, raw WebGPU via root.device where needed; WGSL strings, no build plugin required.
5. Depth precision → rank-based depth.
6. Headless may be SwiftShader (capture.mjs:110) → perf only in headed real-GPU runs, adapter info in report.
7. Determinism → lockstep preload; sim has no randomness.
8. dt capped 1/30 (runtime.js:106) → compare cost/frame not cycle times.
9. Fairness → MSAA hides SVG seams; native path loses 0.1 rounding → document as intended differences.

## Out-of-scope findings in v2/kit (for REPORT)
- All slots rewritten every frame even when unchanged (centrifuge.mjs:1174–1182, STUB_LIVE) → DOM churn even under reduced motion; dirty-check is a cheap SVG win.
- page() strips only first `import` line of lathe.mjs (no g flag, kit.mjs:158) — fragile.
- parts/centrifuge/build.mjs writes at import → scene not reusable.
- packetSvg duplicated (kit.mjs:122, runtime.js:32).
- CSS blur halo filter may force full re-raster per frame (hypothesis, measure).
- canvas-painter.mjs is turn-kit-only; needs adapter for factory pages.
- drive.mjs --no-webgl stubs WebGL only, not navigator.gpu.
