# Spike results (2026-10-12)

Machine: Apple Silicon, Chrome 154.0.8037.99, Node 25.9.0.

## Headless WebGPU
- Plain `--headless=new` (what capture.mjs / drive.mjs already pass) gives a real adapter: vendor apple, metal-3, isFallbackAdapter false, preferred format bgra8unorm. No extra flags needed for rendering.
- Needs secure context: `file://` and `http://127.0.0.1` OK; `about:blank` / `data:` have no navigator.gpu.
- CDP `Page.captureScreenshot` captures the presented WebGPU frame exactly (also when rendered once and idle). Works with unmodified capture.mjs and drive.mjs.
- 4× MSAA works. `timestamp-query` exists; values are coarsened unless `--enable-webgpu-developer-features`.
- No preserveDrawingBuffer: in-page `canvas.toDataURL()` / `drawImage(canvas)` later returns transparent → in-page readback must copy from a texture. Screenshots are fine.
- Extra flags: use `tools/chrome-webgpu.sh` as CHROME_PATH (appends `$CHROME_EXTRA_FLAGS`, default `--enable-unsafe-webgpu --enable-webgpu-developer-features`):
  `CHROME_PATH=$PWD/tools/chrome-webgpu.sh node ~/.claude/skills/anatomy/scripts/drive.mjs page.html '[["until","window.__result.ok"],["shot","a.png","canvas"]]'`
- No-WebGPU fallback test: `--preload tools/no-webgpu.preload.js` (drive.mjs `--no-webgl` does NOT block WebGPU).

## Versions (exact pins)
typegpu@0.12.7, @typegpu/noise@0.12.1 (requires typegpu ^0.12.7), unplugin-typegpu@0.12.5 (has esbuild variant `unplugin-typegpu/esbuild`), earcut@3.2.4, esbuild@0.28.2; dev typescript@5.9.3, @webgpu/types@0.1.66.

## TypeGPU 0.12.7 API that works (see notes/spike/main.ts)
- `const root = await tgpu.init(); root.configureContext({canvas, alphaMode:'premultiplied'})`
- `tgpu.vertexLayout(d.arrayOf(d.vec2f), 'vertex' | 'instance')`; struct instance layouts accessed per field (`instanceLayout.attrib.offset`).
- `tgpu.bindGroupLayout({ frame: {uniform: Frame}, colors: {storage: d.arrayOf(d.vec4f), access:'readonly'} })`
- `root.createBuffer(schema, init).$usage('vertex'|'index'|'storage'|'uniform')`, `.write()`, `.patch()`.
- Shaders as WGSL strings: `tgpu.vertexFn({in, out})/* wgsl */\`{...}\`.$uses({ layout })` and in WGSL `layout.$.frame.time`. NOT `$uses({frame: layout.$.frame})` (throws).
- Pipeline: `root.createRenderPipeline({vertex, fragment, attribs:{...}, targets:{format}, primitive, multisample:{count:4}, depthStencil:{...}})` (the old `root['~unstable'].withVertex()` chain is gone).
- Draw: `pipeline.with(layout, buffer).with(bindGroup).withColorAttachment({view: msaaTex, resolveTarget: context, ...}).withDepthStencilAttachment({...}).withIndexBuffer(ib).drawIndexed(n, instances)`.
- `root.createTexture({size, format, sampleCount:4}).$usage('render')`.
- `'use gpu'` JS shaders need the unplugin (else "Missing metadata for tgpu.fn function body"); WGSL strings need no plugin.
- Gotchas: WGSL fragment `{ return in.color; }` logs harmless `[external-omitted]` warning; without plugin generated names are generic (`$name()` to fix).

## Size / CDN
Minified 313,602 B / gzip 89,756 B (typegpu ≈285 KB, no tree-shaking). jsdelivr `https://cdn.jsdelivr.net/npm/typegpu@0.12.7/+esm` works; esm.sh needs `?bundle`.

## React Native
`react-native-wgpu` 0.5.17 now re-exports `react-native-webgpu` 0.13.1. TypeGPU docs: `react-native-webgpu` + `typegpu` + `@typegpu/react` (`useRoot`, `useConfigureContext`, `useFrame`, `ctx.present?.()` after each draw); `unplugin-typegpu/babel` only for TS shaders; no Expo Go; disable Metal API Validation on iOS simulator.
