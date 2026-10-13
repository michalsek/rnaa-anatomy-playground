# CQ-M2 — code-quality review of the M2 TypeGPU static renderer

Scope: commit `929cbcf`, covering `src/{main,renderer,shaders,scene,palette,dl-loader}.ts`, `src/fixture/*.mjs`, `tools/{build.mjs,diff.mjs,lockstep.js}`. I read the files with `git show 929cbcf:…` (M3 is editing `src/`), compared them with `export/dl-format.mjs` and `export/palette-probe.mjs` at the same commit, and checked the in-progress M1 diff of `dl-format.mjs`. I made no code edits.
Rules applied:
- the `code-quality-dictionary.md` [U] rules that fit a TS + WebGPU module: TS-2, TS-3, TS-5, TS-7, MR-4, QT-1, §R severity and §N non-goals;
- the expressive-code skill;
- TypeGPU 0.12.7 idiom, verified against `node_modules/typegpu` typings.

I skipped the React, RN, Expo and [REPO] rules, because this codebase has no equivalents.

## Measurement (dictionary §M, adapted)

| Step | Result |
|---|---|
| 1 Size | 2010 added lines in scope (13 files). That is above the ~1.5k split threshold, but it is one new module tree. `renderer.ts` (544 lines) carries most of the weight (see S10). |
| 2 Gates | No lint, format or tsc scripts and no `tsconfig.json`. I ran ad hoc on a snapshot in the scratchpad: `tsc` with `strict`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns` and `skipLibCheck` gave **2 errors**, both dead fields (N1). `esbuild` bundle: OK (333 KB minified). `node --check` on `src/fixture/*.mjs`: OK. |
| 4 Type-aware | ESLint is not installed in `v3-gpu`, so `eslint.typeaware.mjs` could not run. I did the equivalent checks by hand. There is 1 floating promise (S8). There are 31 `any`s: 21 in `renderer.ts`, 5 in `dl-loader.ts`, 3 in `main.ts` and 2 in `scene.ts`. There are 6 non-null `!`s, all in `main.ts`. |
| 5 Deprecations | `deprecations.cjs` reports 0. The 21 `any`-typed TypeGPU handles in `renderer.ts` are invisible to this scan, so treat the 0 as a lower bound. |
| 6 Grep | No `Math.random`, `Date.now` or TODOs. There is one `catch {}`, at `main.ts:118` (the `device-pixel-content-box` fallback). It is legitimate. |
| TypeGPU probe | I compiled a probe file against 0.12.7. These all type-check: `common.writeSoA(segBuffer, {p0: Float32Array, …, flags: Uint32Array})`, `TgpuBindGroup<(typeof S.layout)['entries']>`, `TgpuRenderPipeline`, `TgpuTexture`, `tgpu.const(d.u32, …)` and `d.memoryLayoutOf(S.Seg, s => s.flags)`. A generic `ensure<T>(schema: T)` around `d.arrayOf` still needs one cast, which confirms FINDINGS-M2 #5. |

WebGPU checks that **pass**:
- The premultiplied OVER, multiply and screen blend states match their fragment outputs. Multiply is `dst·(1−a+a·src)` and screen is `dst + a·src·(1−dst)`.
- The MSAA colour attachment uses `storeOp: 'discard'` and resolves straight into the canvas context. Depth uses `depth32float`, is cleared to 1, compares with `less` and is discarded.
- Rank-based depth never compares raw keys.
- `alphaMode: 'opaque'` with a non-sRGB preferred format is intentional (gamma-space blending, like Chrome's SVG raster).
- Uniform structs are 16-byte multiples, and the sizes passed to `write` equal the buffer sizes.
- Bind groups are cached rather than created per frame. Pipelines are created once.
- The MSAA and depth targets are destroyed on resize.

## Should-fix (S)

1. **[S] Halo GPU resources leak.** See `renderer.ts:340`, `:357` and `:539-543`.
   - `buildGeometry` does `this.haloTex = []`. That drops 2 textures and 3 uniform buffers per halo without destroying them, on every palette re-classification.
   - `resize()` destroys only `a`/`b` and leaks `blurH`/`blurV`/`params` on every resize, so a window drag accumulates them.
   - `destroy()` frees neither the halo targets nor the query set.
   - TypeGPU roots do not retain resources (`WeakMemo`), so release depends on GC timing. MR-4 asks for explicit `destroy()`.
   - Fix: move the halo into a `HaloEffect` class that owns its textures, buffers and bind groups and has a single `dispose()`. Call it from `buildGeometry`, `resize` and `destroy`. Recompute sigma on `setPalette`, because today sigma is frozen at creation (`:442-444`).

2. **[S] TypeGPU handles are typed `any`.** See `renderer.ts:73-107`, `:142`, `:213-216` and `:429`.
   - Every typing exists in 0.12.7 and compiles (see the probe row above):
     - `TgpuBuffer<d.WgslArray<typeof S.Seg>> & StorageFlag`, and likewise `… & VertexFlag` / `UniformFlag`
     - `TgpuBindGroup<(typeof S.layout)['entries']>`
     - `TgpuRenderPipeline`, `TgpuTexture`, `TgpuSampler`
     - `TgpuQuerySet<'timestamp'>`, `TgpuCommandEncoder`
   - With `any`, tsc cannot check attachments, bind-group entries or `write` payloads, and the deprecation scan sees nothing.
   - Fix:
     - Declare the handle types above.
     - Make `pipes` a typed object literal returned by `createPipelines()`.
     - Keep the one unavoidable cast inside `ensure`, with a comment, or replace `ensure` with three concrete calls.

3. **[S] Hand-packed records with literal word offsets, although `common.writeSoA` exists.** See `renderer.ts:193-224`, `:235-241`, `:306-319`, `:379-392` and `shaders.ts:10-35`.
   - FINDINGS-M2 #3 says there is "no typed-array view over arrays of structs". That is wrong: TypeGPU 0.12.7 ships `common.writeSoA(buffer, { field: TypedArray })`, which scatters SoA typed arrays into the padded AoS layout.
   - The packers currently hard-code positions such as `i*8+5` and `i*12+9`. These mirror the struct field order in `shaders.ts`, and only the total size is asserted.
   - `pushFill` bit-casts `u32` ids through a `Float32Array` into a JS `number[]`. That costs 2 typed-array allocations per fill. It also round-trips u32 bit patterns through doubles: small `layer` values become denormals, and `paint ≥ 0x7F80` makes `ids.x` a NaN pattern that the spec allows engines to canonicalize.
   - Fix:
     - Build SoA typed arrays directly. For example, segments become `p0: Float32Array(2n)`, `flags: Uint32Array(n)` and so on, and fills become `pos`/`ids`.
     - Upload them with `common.writeSoA`.
     - Delete `assertSize` and the explicit `pad*` fields, which exist only for hand packing.
     - Where a raw view is still needed, take offsets from `d.memoryLayoutOf(schema, s => s.field)`.
     - Assert `item < 2^16 && paint < 2^16` before packing `ids.x`.
     - Correct FINDINGS-M2 #3.

4. **[S] Flag and kind constants are duplicated between TS and WGSL, and one name means two things.** See `shaders.ts:37-42` vs `:187,221,228,244,255-261`, `renderer.ts:200`/`shaders.ts:109`, `renderer.ts:237`/`shaders.ts:132,137`, and `dl-loader.ts:12`.
   - `SEG_*` is exported from TS, but the WGSL uses literals: `1u 2u 4u 8u 16u 32u 60u`. Paint kind `1u` and the `0xffff`/`16u` id packing are also literals on both sides.
   - `SEG_CLOSED` is `2` in `shaders.ts` (the GPU segment flag) and `4` in `dl-loader.ts` (the DL segment flag).
   - Fix:
     - Inject the constants with `$uses({ SEG_DOT: tgpu.const(d.u32, SEG_DOT), … })`. Raw JS numbers are *not* inlined as externals: `externals.js` warns `external-omitted` for them.
     - Name the cap mask (`SEG_CAP_MASK`).
     - Rename the GPU flags (`GPU_SEG.closed` …).
     - Import the DL flags from `dl-format.mjs`.

5. **[S] `dl-loader.ts` re-implements `export/dl-format.mjs`.** See `dl-loader.ts:10-30`, `:73-74`, `:89-90`, `:112` and `scene.ts:86-91`.
   - It re-declares MAGIC, the kinds, the flags and `PAINT_GRADIENT`.
   - It parses sections itself from `json.sections`, checking the magic but not the binary version or endianness.
   - It hard-codes field words: `o+4..o+7` for prims, `r+8`/`r+9` for segments, `r+6` for dots.
   - `decodeBase64` exists twice, here and in `scene.ts`.
   - M1 is adding `FIELD_WORD`, `STRIDE_WORDS`, `isGradientPaint`/`gradientIndexOf` and `SECTION_ALIGN = 256`.
   - Fix:
     - Import `sectionsOf`, `FIELD_WORD`, `STRIDE_WORDS`, `PRIM_KIND`, `PRIM_FLAG`, `SEG_FLAG`, `isGradientPaint` and `gradientIndexOf`. esbuild bundles `.mjs`; add `dl-format.d.mts` or `allowJs` + `checkJs`.
     - Replace the 5 `json: any` with a `DlJson` interface declared next to the format.
     - Share one `decodeBase64` helper. Hermes has no `Uint8Array.fromBase64`, so keep a helper rather than relying on it.

6. **[S] `palette.ts` is a second, diverging implementation of `export/palette-probe.mjs`.** That module's header says "the renderer imports it". See `palette.ts:27-115`.
   - There are two `parseColor`s (the renderer's has a canvas-2D fallback), two `build`s and two `resolvePalette`s.
   - `palette.ts` leaves every probe subtree attached until the end (`:82`, `:95`). The siblings pile up, so structural selectors (`:nth-child`, `+`, `~`) can resolve differently from the gate's probe, which removes each subtree after reading it.
   - The gate therefore validates one implementation while the renderer ships another.
   - `palette.ts` also interleaves append and `getComputedStyle`, which forces a style recalc per paint on every theme switch.
   - Fix:
     - Keep one typed probe module that returns raw resolved entries. `palette.ts` only maps them to `ResolvedPaint`.
     - Build all probes first, then read them all.
     - Delete the `leafOf` wrapper (`:77-80`).

7. **[S] The readiness wait spins forever after a fallback.** See `main.ts:141-146`.
   - When `start()` returns through `showFallback` (no adapter), `api.frames` stays 0, and `wait` re-queues `requestAnimationFrame` every frame for the life of the page.
   - Fix: `start()` returns `boolean`, and `main` returns early on `false` (or on `api.error`).

8. **[S] Reinit failures and GPU errors are invisible.** See `main.ts:92` and `:94` (TS-2).
   - `start().then(() => request())` has no `catch`. If the `Renderer` constructor throws (`assertSize`, pipeline creation) during a device-lost reinit, the result is an unhandled rejection, a blank canvas and `api.error === null`.
   - `uncapturederror` only goes to `console.error`, so `gate.mjs`/QA cannot see validation errors.
   - Reinit has no cap or backoff.
   - Fix:
     - Add `.catch((e) => showFallback(canvas, …))`.
     - Push uncaptured errors into `api.errors[]`.
     - Wrap init and the first frame in `pushErrorScope('validation')`.
     - Fall back to SVG after N reinits.

9. **[S] Portability: DOM coupling is not behind an interface.** See `renderer.ts:6`, `:111-116`, `:351-352`, `main.ts` throughout, and `scene.ts:10-24`.
   - What ties `Renderer` to the browser:
     - It takes an `HTMLCanvasElement`.
     - It calls `navigator.gpu.getPreferredCanvasFormat()` and `root.configureContext` itself. TypeGPU types that `canvas` as `HTMLCanvasElement | OffscreenCanvas`.
     - It writes `canvas.width`/`height` in `resize`.
     - It has no present hook. react-native-webgpu needs `context.present()` after each submit.
   - The palette contract types (`ResolvedPaint`, `BlendMode`) are defined in the DOM module `palette.ts`.
   - `main.ts` mixes platform-neutral lifecycle (init, device-lost reinit, frame scheduling, readiness) with DOM sources (`ResizeObserver`, `matchMedia`, `MutationObserver`, `getElementById`). It has no teardown: observers are never disconnected and `renderer.destroy()` is never called. An RN unmount needs that.
   - `PaintDesc` is probe-only (DOM chains), so RN has no way to supply colours.
   - Fix:
     - Construct `Renderer(root, { context, format })`. `resize(w, h, dpr)` only reallocates targets, and the host sizes the surface.
     - Move `ResolvedPaint` and `BlendMode` to `paint.ts`.
     - Split `main.ts` into `gpu-view.ts` (lifecycle, scheduling, reinit, dispose) and `host-web.ts`, which provides `SizeSource`, `ThemeSource` and `SceneSource` adapters. The RN host implements the same three, using layout plus `PixelRatio`, `Appearance`, and per-theme palettes resolved at export time.
     - Add a `{ kind: 'solid', rgba }` `PaintDesc` (or a resolved palette table).

10. **[S] `Renderer` has too many responsibilities for a port seed.** See `renderer.ts` as a whole.
    - It builds CPU geometry from `GpuScene`, uploads paints and gradients, builds the order and draw list, runs the halo effect, encodes frames and collects stats.
    - Fix: split it into:
      - `geometry.ts`: pure, testable in Node, `GpuScene` + paint classes → typed arrays + entries;
      - `draw-list.ts`: order → `draws` + stroke indices;
      - `halo.ts`: see S1;
      - `renderer.ts`: GPU resources and encoding.
    - Also share one `classifyPaint(p) → 'hidden' | 'opaque' | 'blended'` between `setPalette` (`:169`) and `buildGeometry` (`:250`). Today `0.999` and the branch logic are duplicated, and the `classify` key ignores `cap`, which `buildGeometry` reads.

11. **[S] Encode stats read 0 under lockstep.** See `tools/lockstep.js:54` vs `renderer.ts:472,531`.
    - `lockstep` replaces `performance.now` with virtual frame time, so `lastEncodeMs`/`avgEncodeMs` are always 0 under `drive.mjs --preload tools/lockstep.js`.
    - `performance.measure('gpu:encode')`, which uses the real clock, is correct.
    - Fix: either derive the stats from `performance.getEntriesByName('gpu:encode').at(-1).duration`, or have `lockstep` expose `realNow()` and use that.

12. **[S] `__lockstep.step(k)` hangs on on-demand pages.** See `tools/lockstep.js:23-28,61-65`.
    - `tick` only advances when callbacks are pending. The GPU page renders only on request, so `step()` on an idle page never resolves.
    - Fix: advance `frame` (deliver empty frames) while stepping, or document that the page must have a pending rAF.

13. **[S] First-frame shader compilation.** See FINDINGS-M2 #7 and `renderer.ts:132-165`.
    - TypeGPU 0.12.7 has `pipeline.initAsync()` (`renderPipeline.d.ts:134`), which resolves the pipeline and awaits `createRenderPipelineAsync`.
    - Fix: `await Promise.all(Object.values(pipelines).map((p) => p.initAsync()))` in `start()` before the first frame. Correct FINDINGS #7.

14. **[S for M3 / N for the static frame] Per-frame allocations and redundant state.** See `renderer.ts:376-396`, `:476`, `:484-489` and `:497-515`, and `scene.ts:110-113`.
    - Every frame, `updateOrder` allocates an `ArrayBuffer` with 2 views, `bases`, an `Array.from` + sort + `Uint32Array.from`, and a new `draws`.
    - The frame and halo uniforms are written from objects (`d.vec4f`/`d.vec2f` per halo per frame).
    - The pass re-sets `setBindGroup(S.layout, …)` and `setVertexBuffer` before every draw. TypeGPU pass state persists across `setPipeline` (`drawState.selectPipeline` only swaps the pipeline), and each set bumps the state version, which forces re-application.
    - Fix for 60 fps:
      - Use preallocated typed arrays and an in-place index sort.
      - Bind once after `beginRenderPass`. `pass.setBindGroup(group)` (no layout argument) is enough.
      - Consider recording the blended stream in a render bundle (`root['~unstable'].createRenderBundleEncoder`) that is rebuilt only on reorder.

## Nits (N)

1. **Dead code.**
   - `renderer.ts:62` `device` and `:84` `gradIndexOf` (field) are never read (tsc `noUnusedLocals`).
   - `scene.ts` `StrokeElem.optional` (`:55`) and `SceneItem.name` are never read.
   - The linear `units` is ignored. `objectBoundingBox` would silently render as user space, so assert it in the loader.
   - `build.mjs:57-58` lists 4 variants and then filters 2 out. `:61` is a one-element loop. `--no-dl` is undocumented.
   - `make-calib.mjs:20` `svgDark` is unused, and `svgLight` holds both halves and is theme-neutral, so it is misnamed.

2. **Magic numbers.**
   - WGSL:
     - quad AA margin `e = hw + 1.0` (`shaders.ts:192`)
     - ownership window `-3..3` (`:229`)
     - thin-cap threshold `0.75` (`:254`)
     - round-cap extension `0.6` (`:259`)
     - "no cap" sentinel `1e4` (`:260-261`)
     - epsilons `1e-8`/`1e-5`/`1e-6`
   - TS:
     - `3σ` blur radius (`renderer.ts:443-444`)
     - half-resolution `/2` (`:432-433,442`)
     - depth denominator `+2` (`:476,487`)
     - opaque `0.999`
     - record word strides `12`/`48`/`8`/`32`
     - `-1e9` back key (`dl-loader.ts:118`)
     - default width `0.6` (`dl-loader.ts:86`, which is always overwritten)
   - Fix: name them, as `tgpu.const` for WGSL.

3. **The depth formula is duplicated.** It exists as WGSL `depthOf` (`shaders.ts:74-76`) and as TS halo depth (`renderer.ts:487`). Pass `seq` in `HaloParams` and call `depthOf` in `haloVert`. Rename `Frame.total` (which holds total + 2) to `depthDenominator`.

4. **`warn.disable('external-omitted')` at module scope** (`shaders.ts:8`).
   - Importing `shaders.ts` silences the warning globally. That warning kind stays enabled in production builds, so the disable also hides genuine omissions elsewhere in the bundle.
   - Fix: move it to the bootstrap in `main.ts` with a link to an upstream issue, or call `warn.reset()` after the pipelines resolve.

5. **Full-screen triangles.** `fullscreenVert` re-implements `common.fullScreenTriangle`. `haloVert` needs depth, so it stays custom.
   - The halo composite is a full-screen triangle at 4× MSAA every frame. Bound it to the halo's bounding box.

6. **Unnecessary casts in `main.ts`.**
   - `(root.device as any).adapterInfo`: `@webgpu/types` 0.1.66 types `GPUDevice.adapterInfo`.
   - `(e: any)`: use `GPUUncapturedErrorEvent`.
   - `(window as any).__gpu`: use `declare global { interface Window { __gpu: GpuApi } }`.
   - `Awaited<ReturnType<typeof tgpu.init>>`: use `TgpuRoot`.
   - The `!`s on DOM lookups (`:35,37,50`): throw explicit errors instead.
   - `:108` `dpr = width / cssW` becomes `Infinity` when the canvas has 0 CSS width at boot.

7. **API shape.**
   - `renderer.share` is a public mutable field, set before each `render()`. Use `render(share)` instead.
   - The `prev.some(… [this.paintBuffer, …][i])` compare (`renderer.ts:218-225`) allocates an array per element. Have `ensure` return whether the buffer was replaced.
   - Rename `haloTex` (it also holds buffers and bind groups) to `haloTargets`, and `pipes` to `pipelines`.

8. **Comments.**
   - `shaders.ts:99-102` and `:245-248` record calibration history (percentages per DPR). That is a line of reasoning (expressive-code). Keep the decision and the named constant in the code, and move the measurements to FINDINGS-M2.
   - `scene.ts:10` "re-resolved on every theme change" is non-local: it describes a decision made in `main.ts`.

9. **Behaviour gaps to document.**
   - Nearest-segment ownership works per polyline (subpath), not per prim. A translucent stroke whose subpaths cross (one `<path>` with several `M`) double-blends at the crossing, while SVG blends once per path. DL-FORMAT promises "never double-blend inside a prim".
   - A closed 2-segment polyline becomes open (`dl-loader.ts:101` `n > 2`, then `renderer.ts:269` `count >= 3`), so it gets caps instead of joins.
   - `stroke-linecap: square` silently renders as round (`palette.ts:108` cast).

10. **FINDINGS-M2 corrections.**
    - #3 is wrong: see S3.
    - #7 has a fix: see S13.
    - #4: zero-size bindings are a WebGPU rule, not TypeGPU friction.
    - #5 is confirmed.

11. **Tools.**
    - `diff.mjs:15` drops a positional argument that follows a boolean flag (`--json a.png b.png`). Missing paths give no usage error, and crop boxes are not bounds-checked (`:27-30`).
    - `build.mjs:39` matches the exact attribute order of `<svg xmlns=… class="iso-svg"`, and `:43` destructures a possibly-null match.
    - `lockstep.js:46` declares `cancelled` after `tick` uses it. That is safe but reads oddly. The set also grows when callers cancel ids that were already delivered.

## Out of scope / follow-ups (not introduced here)

- `src/fixture/make-{fixture,calib}.mjs` import `~/.claude/skills/anatomy/kit/iso-kit.mjs` and `../v2-factory/shared/factory.css` live and unpinned. Fixture outputs therefore change whenever the skill kit changes. Snapshot the kit version, or record its hash in `fixture.scene.json`.
- From FINDINGS-M2 (kit tooling in `~/.claude/skills/anatomy/scripts`, not re-verified here):
  - `devicePixelContentBoxSize` reports CSS px under CDP emulation.
  - `capture.mjs --zoom` magnifies the canvas bitmap but re-rasterizes the SVG.
  - `capture.mjs` and `drive.mjs` use different shot margins (6 vs 4 px).
  - Kit bolt dots (r 0.36–0.5) rasterize at about 1.6× their area at DPR 1.
- `notes/DL-FORMAT.md` still documents 16-byte section alignment, while M1's in-progress `dl-format.mjs` moves to 256 (M1's doc to update).
