# M2 findings

## TypeGPU 0.12.7 friction (report material)
1. WGSL-string entry functions that read `in.<field>` log spurious `[external-omitted]` warnings, also in production builds → silenced with `warn.disable`.
2. Several pipelines in one render pass need `root['~unstable'].createCommandEncoder()`.
3. No typed-array view over arrays of structs → records packed by hand and checked against `d.sizeOf` at startup.
4. Runtime-sized storage arrays need buffers of ≥ 1 element → empty sections padded.
5. `d.arrayOf` inside a generic helper needs an `as any` cast.
6. Library typings need `skipLibCheck` under TS 5.9.
7. Shader compilation is lazy → first frame ≈ 9 ms CPU.
8. Timestamps work via `createQuerySet` / `resolve` / `read` without raw WebGPU.
No raw-WebGPU escape hatch was needed for rendering; `root.device` only for device-lost, error events, adapter info, destroy.

## Tooling / kit
1. Under the device-scale emulation used by capture.mjs / drive.mjs, `devicePixelContentBoxSize` reports CSS px; a canvas sized from it renders at DPR 1 and is upscaled (fixture diff 0.004 % → 0.45 %). `src/main.ts` trusts it only when it agrees with `devicePixelRatio`.
2. capture.mjs `--zoom` re-rasterizes the SVG but only magnifies the canvas bitmap → for fair 4× comparisons render both at `--scale 4` and crop.
3. drive.mjs shots use a 4 px margin, capture.mjs 6 px → never diff images across the two tools.
4. Chrome draws the kit's bolt dots at ≈ 1.6× their true area at DPR 1 (dots use distance-ramp coverage to match).
5. On the centrifuge page `setShare` reorders items 3 times without changing a pixel (explode off for this part).

## Known gaps
- 452 px mobile-emulated viewport: 0.62 % diff vs 0.025 % for the same 420 px layout without mobile emulation; cause not isolated (check on a real phone in M4).
- Group opacity over overlapping children (live packets) needs an offscreen layer (M3).
- Sub-0.5 px open ticks at DPR 1 too heavy (+48 %); the kit does not draw them.
