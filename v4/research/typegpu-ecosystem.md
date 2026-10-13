# TypeGPU ecosystem: dictionary (2026-10-13)

Sources: npm registry (`npm view`), the monorepo https://github.com/software-mansion/TypeGPU (`packages/`, `apps/typegpu-docs`), and the docs https://docs.swmansion.com/TypeGPU. Doc paths below are relative to the docs root.

TypeGPU is still 0.x. Some APIs sit under `root['~unstable']`: `createCommandEncoder`, `createRenderBundleEncoder`, `pipe`, `with`. Others sit under `tgpu['~unstable']`: `declare`, `rawCodeSnippet`, `namespace`, `simulate`. **Pin exact versions.**

## Packages

| package | version / date | maturity | what it is | key APIs | for us |
|---|---|---|---|---|---|
| `typegpu` | 0.12.7 · 2026-10-06 | 0.x; some `~unstable` APIs | Typed layer over WebGPU/WGSL | `tgpu.init`, `root.createRenderPipeline`, `tgpu.vertexLayout`, `d.*` schemas, `std.*` | **core** |
| `unplugin-typegpu` | 0.12.5 · 2026-10-06 | stable-ish | Build plugin: `'use gpu'` JS/TS → AST metadata → WGSL; names resources automatically | `/babel` (Metro/Expo), `/vite`, `/esbuild`, `/webpack`, `/rollup`, `/rolldown`, `/rspack`, `/bun`. Only babel and vite/rollup are actively tested | **core**: shaders in TS, CPU-testable |
| `@typegpu/react` | 0.12.1 · 2026-10-06 | new in 0.12 | React hooks for resources and the frame loop; browser and `react-native` builds | `<Root>`, `useRoot`, `useFrame`, `useConfigureContext`, `useUniform`, `useMirroredUniform`, `useBuffer`, `useMutable`, `useReadonly`, `useBindGroup`, `ClientOnly` | **core**: no scene graph, reconciler, camera or instancing |
| `@typegpu/noise` | 0.12.1 | stable | Random numbers and Perlin noise; runs on CPU and GPU | `randf`, `perlin2d`, `perlin3d` | useful: flicker, wear |
| `@typegpu/color` | 0.12.1 | stable | Colour-space helpers | `hexToRgb`, `oklabToRgb`, `srgbToLinear`, `hsvToRgb` | useful: palette work |
| `@typegpu/sdf` | 0.12.1 | stable | 2D/3D signed distance functions, jump flooding | `sdRoundedBox3d`, `sdCapsule`, `opSmoothUnion`, `createJumpFlood` | useful: SDF parts, maybe outline effects |
| `@typegpu/three` | 0.12.1 · 2026-08-21 | WebGPU-only | Write three.js TSL nodes as TypeGPU functions | `toTSL`, `fromTSL`, `uniform`, `instancedArray` | the bridge, if three.js is ever used |
| `@typegpu/gl` | 0.12.6 | experimental | WebGL2/GLSL fallback; render pipelines only, no storage buffers or bind groups | `initWithGLFallback` | not for 3D |
| `@typegpu/radiance-cascades` | 0.12.1 | new | 2D global illumination | – | not relevant |
| `@typegpu/geometry`, `@typegpu/sort` | 0.11.0, **private (not on npm)** | unreleased | 2D lines/circles; bitonic sort, prefix scan | – | not yet |
| `@typegpu/cli` (`npx typegpu@latest`) | 0.12.3 · 2026-09-07 | new | Project scaffolding | templates: `vite-bare`, `vite-complex`, `vite-react`, `expo-bare` (+ next, waku) | useful. Note: the `expo-bare` template pins a stale `react-native-webgpu ^0.5.11` and `typescript: npm:tsover@6.0.2` |
| `eslint-plugin-typegpu` | 0.12.1 | stable | Lint rules for `'use gpu'` code (ESLint and Oxlint) | `no-unsupported-syntax`, `no-math`, `no-invalid-assignment` | useful |
| `tgpu-gen` | 0.12.0 | stable | WGSL → TypeGPU definitions | `npx tgpu-gen shader.wgsl --watch` | useful for porting WGSL |
| `tsover` | 6.0.2 | TS fork | Adds operator overloading on vectors (`a * b`) | `"typescript": "npm:tsover@6.0.2"` | optional; tooling risk; otherwise use `std.mul` / `.mul()` |
| `tinyest`, `tinyest-for-wgsl` | 0.3.4 / 0.4.2 | internal | AST format used by the plugin | – | used indirectly |
| `react-native-webgpu` (wcandillon) | **0.14.0 · 2026-10-13** | fast churn (0.5 → 0.14 in 3 months) | Dawn WebGPU for RN; web entry renders a real DOM `<canvas>` | `<Canvas>`, `context.present()` (a no-op on web); RN ≥ 0.81, New Architecture | **core** for the native phase; already usable on web |
| `react-native-wgpu` | 0.5.17 | shim | Old name, re-exports `react-native-webgpu@0.5.17` | – | avoid |
| Agent tooling | – | experimental | `npx skills add software-mansion-labs/skills -s typegpu`; `typegpu-runtime-inspector-mcp` 0.10.0 (inspect generated WGSL) | – | useful |

## Gallery examples worth reading

Links take the form `examples/#example=<category>--<name>`.

| example | why it's relevant |
|---|---|
| `rendering--3d-fish` | OBJ mesh via `@loaders.gl/obj`, instancing, `wgpu-matrix` camera, also runs on RN |
| `simple--mesh-skinning` | glTF via `@loaders.gl/gltf`, MSAA |
| `rendering--phong-reflection` | lighting model |
| `rendering--simple-shadow`, `rendering--point-light-shadow` | instanced boxes, MSAA |
| `rendering--two-boxes`, `rendering--render-bundles` | minimal 3D with depth and MSAA; render bundles (`~unstable`) |
| `rendering--jelly-switch` | stylised SDF object with hand-written TAA |
| `react--spinning-triangle` | minimal `@typegpu/react` usage |
| `threejs--simple`, `threejs--varyings`, `threejs--compute-geometry` | `@typegpu/three` |
| RN repo: software-mansion-labs/typegpu-rn-examples | stale: SDK 54, last pushed 2026-05 |

There is **no toon, cel or outline example** in the gallery.

## What TypeGPU does not provide

| need | what the examples use instead |
|---|---|
| maths / camera | `wgpu-matrix` 3.4.2; orbit and first-person camera helpers local to the docs (not a package) |
| mesh / glTF loading | `@loaders.gl/obj`, `@loaders.gl/gltf` |
| scene graph, picking, materials | hand-rolled per example, or three.js via `@typegpu/three` |
| post-processing, outlines, AA | MSAA by hand (`sampleCount` + `resolveTarget`); custom TAA in jelly-switch |
| declarative JSX scene | nothing (`@typegpu/react` covers resources and the frame loop only) |

## `'use gpu'` notes

- A `'use gpu'` function is ordinary JS/TS. The build plugin turns it into an AST, and WGSL is generated at runtime. The same function runs on the CPU, which makes unit tests possible. Inside one you can only call other `'use gpu'` functions, `std.*`, most `Math` functions and `console.log`.
- **Expo/Metro:** `plugins: ['unplugin-typegpu/babel']`, then run `expo start --clear`. **Vite:** `unplugin-typegpu/vite`. The plugin is optional if you write WGSL strings with `$uses` instead.
- **On native with `react-native-worklets` installed:** `useFrame` callbacks must be worklets and run on the UI thread. This needs worklets Bundle Mode with `importForwarding`; `<Root disableWorklets>` opts out. Expo Go is not supported (use a dev build). On the iOS simulator, disable Metal API Validation (`react-native-webgpu` ships a config plugin for it).
