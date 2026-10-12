# PLAN — M0 scaffold + M2 static TypeGPU renderer

Owner: M2 agent. Owns `src/`, `tools/lockstep.js`, `tools/build.mjs`, `tools/diff.mjs`, `out/gpu/`, this file, `notes/FINDINGS-M2.md`.
Read-only: `../v2-factory`, `~/.claude/skills`. Not touched: `export/`, `scenes/`, `out/svg/`, `out/dl/`, `notes/DL-FORMAT.md`, `notes/PLAN-M1.md` (M1).

## Architecture as planned

### Renderer-facing scene (`src/scene.ts`, decoupled from the DL file format)
- `items[]`: key, lift, move (screen vector per unit share, optional), `layers` (primitive count, for depth slots).
- `paints[]`: probe descriptors (class chain + element + prop) or literal colours; resolved in the DOM to RGBA (+ blend mode).
- `fills`: interleaved vertices `{pos vec2f, ids vec2u}` (ids.x = item | paint<<16, ids.y = layer) + optional u32 index buffer. One fill element = a run of triangles with one (item, paint, layer).
- `strokes`: segment table `{p0, p1, halfWidth, item, paint, layer, alpha, flags, polyStart, polyEnd}`; flags: width in CSS px (non-scaling) vs viewBox units (dots), closed polyline, dot.
- `specials`: halo (fill run + blur σ + offset, own pipeline), blend-mode fills (multiply/screen), gradients (paint kind 1 → gradient table).
- `dl-loader.ts` maps M1's DL onto this once `notes/DL-FORMAT.md` exists; `src/fixture/` produces the same structure for the synthetic fixture.

### Depth = painter's rank, never raw keys
CPU per frame: order items by `key + lift·share` (stable, ties by export index), prefix-sum their `layers` into `base[item]`. Every primitive's sequence number is `base[item] + layer`, depth `= 1 − (seq+1)/(total+2)` in depth32float (exact integers < 2^24 → no z-fighting by construction; 239 items × ≤ few thousand layers ≪ 2^24). Only the 239-entry item storage buffer `{offset vec2f, base u32}` is rewritten when order/share changes; no vertex-buffer rebuild.

### One MSAA render pass, two phases
1. **Phase A (opaque fills)**: 4× MSAA bgra8unorm + depth32float, depth write, compare `less`. Fill shader reads paint table (solid or linear gradient evaluated per fragment).
2. **Phase B (blended stream, painter order)**: strokes/dots as instanced quads (6 vertices, instance → indirection buffer → segment), translucent fills, halo, blend-mode fills. Depth test `less` against phase A per sample (→ later opaque fills hide earlier lines exactly, including partial coverage at MSAA edges), no depth write, premultiplied "over" blending. Drawn in sorted sequence order; consecutive stroke runs merge into one instanced draw (the indirection buffer is the concatenation of each item's stroke range in item order, rebuilt only when the order changes).
3. Resolve straight into the canvas texture.
- Rationale vs. "separate pass C": all blended things must interleave in painter order anyway (a halo under lines under a later translucent fill), so a single sorted stream with a handful of pipeline switches is simpler and exact. Specials are rare (halo ×1, gradient ×1, group-opacity ribs ×3 in the static frame).

### Stroke coverage
- Distance to the segment (capsule = round caps/joins) in device px computed in the fragment shader from `@builtin(position)`.
- Box-filter coverage across the line: `cov = overlap([d−hw, d+hw], [−½, ½])`, which keeps integrated ink = width for sub-pixel widths (0.6 CSS px @DPR1 → peak 0.6, 1 px wide), i.e. the Skia "modulate by width" hairline behaviour. Calibrated against Chrome's own SVG raster at 4× crops (0.4/0.6/1.3 px, DPR 1/2/3); calibration constants live in one WGSL function.
- No double blending at joins: **nearest-segment ownership** inside a polyline — a fragment is drawn by segment *i* only if no segment in the window *i±3* of the same polyline (wrapping for closed ones) is strictly nearer (ties → lower index). Coverage then comes from the union distance field (min over neighbours) and each pixel is blended once per path. Alternatives rejected: stencil (loses analytic coverage), max-blend (wrong for non-uniform backgrounds), per-path offscreen layers (too slow).
- Dots = zero-length capsules with radius in viewBox units and 2D disk coverage (`clamp` of area-ish ramp) × tone opacity × fill-opacity.
- Non-scaling stroke: `hw = widthCssPx × dpr / 2`, where dpr comes from `devicePixelContentBoxSize / contentBoxSize`.

### Colour
- Canvas `bgra8unorm` (non-sRGB), blending in gamma space like Chrome's SVG raster. Canvas cleared to the probed card colour (opaque) so multiply/screen behave.
- Palette: each probe descriptor becomes a hidden `<svg>` subtree inside an `.iso[data-theme]` clone of the page's theme context (same class chains), resolved with `getComputedStyle` (fill / stroke / stop-color / opacity / mix-blend-mode) into a vec4f storage buffer. Re-probed on `data-theme` mutation, `prefers-color-scheme` change and `__gpu.setTheme()`; only the palette buffer (and the halo opacity) is re-uploaded.

### Halo
CSS `filter: blur(9px); opacity; translateY(3px)` → silhouette rasterized once per size change into an offscreen r8 texture at ½ device resolution, separable Gaussian blur (σ = 9 user units × scale / 2, two fragment passes), composited in the blended stream as a textured quad at its sequence position, offset by 3 user units + item offset. Rebuilt on resize/DPR change only.

### DPR / resize
ResizeObserver(`device-pixel-content-box`) → canvas size in exact device pixels → recreate MSAA colour + depth targets and halo textures → redraw. viewBox→clip transform from the canvas box (`xMidYMid meet`, like SVG) in a uniform.

### TypeGPU usage
`tgpu.init`, `d.struct` schemas, `root.createBuffer(...).$usage(...)`, `tgpu.bindGroupLayout`, `tgpu.vertexLayout`, WGSL-string `tgpu.vertexFn/fragmentFn(...).$uses({layout})`, `root.createRenderPipeline`, `root['~unstable'].createCommandEncoder().beginRenderPass()` with `pass.setPipeline/draw`. Bulk data uploaded with `buffer.write(ArrayBuffer)`. Every raw-WebGPU escape hatch is logged in FINDINGS-M2.md.

### Instrumentation / tools
- `window.__gpu = {ready, error, adapterInfo, frameStats(), setShare(x), setTheme(t), redraw(), simulateDeviceLoss()}`; `performance.mark/measure('gpu:encode')`; GPU timestamp-query when the feature exists.
- `tools/lockstep.js` (drive.mjs `--preload`): fixed 1/60 s rAF timestamps + `performance.now`, `__lockstep.freezeAt(n)`, `__lockstep.step(k)`, `__lockstep.frame`.
- `tools/build.mjs`: esbuild → `out/gpu/gpu.js`; harness pages: take an SVG page, keep its card chrome/CSS, swap the `<svg>` for `<canvas class="iso-svg">` with the same CSS box, inline the scene data and the SVG as `<template>` fallback.
- `tools/diff.mjs`: pixelmatch over two PNGs (+ region crops, nearest-neighbour 4× zoom, side-by-side sheets).

## Acceptance criteria
1. **Fixture**: synthetic scene (overlapping iso prisms, four-tone faces, creases/edges 0.6 px, seamless 0.4 px, a 1.3 px mark, dots of all tones, halo, gradient, translucent group) renders in headless Chrome; vs. its own SVG page ≤ 0.5 % differing pixels at DPR 2 (pixelmatch threshold 0.1, AA detection off… reported both ways).
2. **Centrifuge static frame** (M1 DL vs M1 SVG, slots empty): ≤ 0.5 % differing pixels at DPR 2, light and dark; crops 1× and 4× of hairline-heavy regions in `out/gpu/crops/`, inspected: no seams between fills, no fringes where lines end on edges, hairline weight equal to SVG.
3. **Explode**: `setShare` 0→1→0 sheets — no z-fighting, no popping (depth is unique per primitive; order only changes at key crossings).

## Test plan
| Case | How | Pass |
|---|---|---|
| DPR 1 / 2 / 3 | capture.mjs `--scale 1,2,3`, diff vs SVG at the same scale | diff % reported, ≤ 0.5 % at 2, hairlines not heavier/lighter at 1 and 3 |
| Resize | drive.mjs: change page width 700→420→700, shoot each | canvas backing size = device content box, no stretching, identical to a fresh load at that width |
| 4× zoom crops | capture `--scale 4` region shots + nearest-neighbour 4× of DPR-2 shots, side by side with SVG | visual: equal weight, no seams/fringes |
| Sub-pixel hairlines 0.4 / 0.6 / 1.3 px | calibration page with lines at 0°, 15°, 30°, 45°, 90°, short segments, polylines with sharp joins | ink integral per unit length within ±10 % of SVG, no join blotches |
| Lines over / under fills | fixture prisms overlapping: back prism's edge partially covered by front prism's fill | line hidden exactly where the front fill covers (per-sample), no halo/fringe at the fill edge |
| Translucent overlap order | three translucent fills + .55 lines overlapping in a known order | colour per region equals SVG |
| Theme switch at runtime | `__gpu.setTheme('dark')` then `'light'` after load; compare with fresh loads | identical to fresh loads (≤ 0.01 % diff) |
| Device lost | `__gpu.simulateDeviceLoss()` → reinit | renders again, `__gpu.frameStats().reinits === 1` |
| No WebGPU | drive.mjs `--preload tools/no-webgpu.preload.js` | `__gpu.error === 'no-webgpu'`, SVG fallback shown, no exceptions |
| Explode | `setShare` sweep with lockstep, contact sheet | no flicker/popping between consecutive frames except at order changes |
