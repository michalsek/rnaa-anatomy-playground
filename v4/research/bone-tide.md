# Bone Tide (BoneTideOSS): research notes, 2026-10-13

## What it is

- **Author:** Konrad Reczko ([@reczkok](https://github.com/reczkok)), TypeGPU engineer at Software Mansion.
- **Game:** a survivors-like, on the [App Store](https://apps.apple.com/pl/app/bone-tide-horde-survival/id6791994827), [Google Play](https://play.google.com/store/apps/details?id=com.swmansion.bonetide) and the [web](https://reczkok.github.io/typegpu-adventure/beta/).
- **Write-up:** the [TypeGPU 0.12 blog post](https://docs.swmansion.com/TypeGPU/blog/typegpu-012/).
- **Source:** [reczkok/BoneTideOSS](https://github.com/reczkok/BoneTideOSS), **MIT**, created 2026-09-03; a "near 1:1 version of the actual game core".
  - KayKit art and audio are removed; everything renders from procedural placeholders.
  - Not on npm: `@bonetide/engine` is a private workspace package, imported as raw TS.
  - The original repo `reczkok/typegpu-adventure` is private.
- **Local clone:** `scratchpad/v4-research/bonetide/BoneTideOSS`.

## Architecture (verified from code)

- **Monorepo (pnpm):** `packages/engine` plus two apps:
  - `apps/web`: **Vite + DOM**;
  - `apps/mobile`: Expo 57, RN 0.86.3, react-native-webgpu 0.6.1, typegpu 0.12.4.
- **Platform seam:** `#platform/{env,assets,storage}.ts`.
  - Vite alias on web; Metro `resolveRequest` remap in `metro.config.js` on native.
  - The engine typechecks without the DOM lib.
- **Build:** `babel-preset-expo` + `unplugin-typegpu/babel` on native, `unplugin-typegpu/vite` on web; TypeScript replaced by `tsover`.
- **Scene:** no scene graph, ECS or React components.
  - Imperative passes: characters, props, ground, particles, post.
  - Entities are GPU storage-buffer structs (e.g. a 2178-slot `Actor` array simulated in compute).
  - Shared state (camera, lighting, shadow map) as `tgpu.accessor`/`slot`, bound via `root.with(...)`.
- **React:** `@typegpu/react` `<Root>`/`useRoot` only. The HUD is RN views over the canvas via `useSyncExternalStore`.
- **Frame:** one encoder and one submit.
  - Passes, in order: compute prepass → depth-only shadow pass → MSAA HDR scene → post (bloom, haze, sun rays, FXAA).
  - Render bundles + `drawIndexedIndirect`, so empty batches cost nothing.
- **Native loop:** JS-thread `requestAnimationFrame` → `queue.submit` → `context.present?.()` (`createGameShell.ts`). Worklets only in `Joystick.tsx`.
- **Camera:** perspective, 46° FOV, offset `[0,12.5,11]`.
- **Shading:** `scene/lighting.ts` `shade()` = sun N·L + hemisphere ambient + PCF shadows + fresnel rim + fog. **No toon/cel shading, no outlines.**
- **Meshes:**
  - glTF via `@loaders.gl/gltf` (`assets/gltf.ts`);
  - procedural fallback `assets/placeholder.ts` (box/tube/blob/blade + a 16-slot palette texture);
  - skinning baked into a joint-matrix texture, drawn instanced.

## Native gotchas (documented in the repo)

- Request the `'implicit-device-synchronization'` optional feature; Dawn devices aren't thread-safe without it.
- Hermes lacks the ES2023 change-by-copy array methods.
- No Expo Go (dev build only).
- `TextDecoder` polyfill (`polyfills.ts`).
- iOS 27 UIScene lifecycle config plugin (`plugins/withSceneLifecycle.js`).
- Since TypeGPU 0.12, guarded compute pipelines submit on their own. Bone Tide records compute into one shared pass instead (`core/kernel.ts`).

## Reuse

- **Copy (MIT, keep the notice):**
  - the Metro + Babel + `#platform` alias setup;
  - device init with the Dawn feature;
  - the `onLayout` → `root.configureContext` → rAF/`present()` shell;
  - the TextDecoder polyfill and UIScene plugin;
  - `core/kernel.ts` and `core/indirect.ts`;
  - the indirect instanced draws (`props.ts`);
  - box/tube builders and the palette texture (`placeholder.ts`);
  - accessor-based scene bindings;
  - `.agents/skills/typegpu/` (13 agent reference docs).
- **Reference only:** the render passes (perspective, PBR-ish, HDR post).
- **Build ourselves:** the 2:1 ortho camera, four-tone palette shading, the hairline line system, the React lego layer (Bone Tide keeps React out of 3D).

## Not found

No conference talks, videos or write-ups beyond the blog post and X posts. The same blog post also features a second TypeGPU game, [Purrkour](https://blazejkustra.github.io/purrkour/) (blazejkustra), which hasn't been looked at.
