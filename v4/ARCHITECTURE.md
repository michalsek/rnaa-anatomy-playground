# v4: Anatomy-style 3D machines on TypeGPU — research summary & architecture plan

*Draft, 2026-10-13. Status: plan for review, nothing built. Research briefs: [research/](research/).*

## Decisions (2026-10-13, from review)

These override anything below that contradicts them.

1. **Shell: one Expo app targeting web and iOS/Android at the same time.**
   - Migration either way is cheap; doing both at once is cheapest overall.
   - **Drop RN at the first sign of real trouble** and continue web-only.
   - Keep Bone Tide's engine/`#platform` seam anyway, so that drop costs nothing.
2. **Verification is by eye, using argent tools:** screenshots, flows, simulator and Chromium/web interaction.
   - No precise measurement tooling: no pixel-diff gates, calibration sheets or perf harness unless a concrete problem demands it. That was the main token sink in v3.
   - This is a presentation/showcase, not a product.
3. **Line widths scale with zoom**, like the SVG. Revisit after the first visuals. If the experiment works, expect normal 3D camera controls (orbit/pan/zoom) and expansion of the idea, so design the camera module for free views, not just the fixed 2:1 dimetric. The facing→tone lookup uses a camera-fixed light, so it keeps working under orbit.
4. **Location:** `~/Documents/rnaa-anatomy/v4/`.
   - The repo is local-only (not pushed to GitHub).
   - Commit source and docs only: **never temporary files, screenshots, build outputs or other artifacts.** Add a `.gitignore` for them first.
5. **Still open:** content scope after the centrifuge (whole factory vs showcase machines).

## 0. The idea, and where the research pushed back

| your idea | verdict | why |
|---|---|---|
| Expo/RN app as the base, web only first | **keep the engine/shell split; shell choice open (§8, §9.1)** | Verified hands-on: the official TypeGPU Expo template builds for web with Metro, `'use gpu'` shaders compile via the Babel plugin, and `react-native-webgpu`'s `<Canvas>` renders a real DOM canvas on web (no platform-split files). Precedent: Bone Tide shares one TypeGPU engine between web and an Expo app. **Rule:** the engine lives in a package with no react-native or DOM imports. Then the shell, Expo or Vite, is replaceable. Costs: heavier web bundle (react-native-web), Metro tooling less mature than Vite for web, and SDK 58's fast Rust transformer is off when a custom Babel plugin is present. |
| TypeGPU stack | **keep for the engine** | It gives typed buffers, `'use gpu'` shaders testable on CPU, React hooks, RN support. It lacks a camera, scene graph, mesh loading, post-processing and editor tooling; we build small versions (§3). The alternative, three.js + r3f with TypeGPU-written nodes, is weighed in §2. |
| 3D models + cel shading | **reframe: palette lookup + a line system** | The Anatomy look isn't lighting. The kit maps each face's facing direction (against a camera-fixed light) to one of 4 palette tokens + a top token: a lookup. And most of the look is **lines**: silhouettes, creases, part boundaries, plus many non-edge lines (seams, ribs, ticks, knurls, bolt dots) that must end on an edge or fade. A post-process outline shader would only cover a minority of them. |
| "models" | **procedural TS generators, not authored meshes** | Agents iterate well on diffable code and badly on binary assets. glTF can't carry edge marks. The kit is already procedural (lathe, tube, slab), so generators port its vocabulary. glTF stays an escape hatch for odd shapes. |
| React lego style | **yes for machines, no for parts** | `<Centrifuge>` composed of `<Lathe>`, `<Tube>`, `<Belt>` is the right authoring model. But thousands of parts and packets must be instanced data, not React elements, and per-frame animation never goes through React. Components register into instance pools; no custom reconciler. |
| manual fine-tuning (first to drop) | **cheap version first** | The underlying problem is shared addressing (which element, which axis, how far), not missing gizmos: stable dotted IDs + a sparse `scene.overrides.json` written back by a dev-server endpoint + click-to-select labels + nudge keys on the iso grid. About a day of work; a 3D drag gizmo is optional later. |

## 1. Target look → techniques

Taken from the kit source (`iso-kit.ts`, `lathe.mjs`, `tube.mjs`) and `craft.md`, not from screenshots alone.

| element | technique | notes |
|---|---|---|
| **camera** | orthographic, yaw 45°, pitch 30°, z up = the kit's exact 2:1 dimetric (`X = x·sinA − y·cosA`, `Y = (x·cosA + y·sinA)·sinE − z·cosE`) | Not true isometric (35.26°). Scale from the kit's `fitProjection`. `depth32float`; snap translation to device pixels. |
| **four-tone shading** | fragment shader: facing class from the normal against a view-space light, then a palette index `[material][paper, face, top, s0..s3, line tones…]` | flat normals for prisms, smooth for lathes and tubes (per-pixel quantize gives the cylinder banding); band edges AA'd analytically with `fwidth`, because MSAA doesn't AA inside triangles |
| **palette / themes** | one TS token module (light + dark) → a storage buffer. CSS variables for the HTML overlay are generated from the same module | single source works on web and native (no `getComputedStyle` probing); a theme switch is one buffer write |
| **edge lines** (creases, face-ID/material boundaries, silhouettes) | **in-face lines**: the fill shader computes the fragment's screen distance to its triangle's *flagged* edges (barycentrics × screen-space altitudes via vertex pulling) and mixes the line tone with analytic coverage. Silhouette flag per frame = neighbour normal faces away. | The depth test hides lines exactly like faces, so lines end exactly where faces end. Single pass, exact sub-pixel width (clamp to 1 device px, scale alpha by width, the "phone-wire" rule). Refs: Bærentzen et al. 2006/2008 (antialiased wireframe), NVIDIA Solid Wireframe. **Riskiest piece → first spike.** |
| **texture lines** (seams, ribs, ticks, knurls, grilles) | procedural in the surface's UV space, filtered with `fwidth`, fade as a parameter | occlusion and silhouette clipping come free; the craft rule "end on an edge or fade" becomes a shader param |
| **free lines & dots** (wires, needles, bolt dots) | instanced screen-space quads/discs with analytic coverage, depth-tested | v3 already calibrated this against Chrome's SVG; port the shader idea |
| **AA** | MSAA 4× (WebGPU allows only 1 or 4) + analytic coverage for all lines/bands | no FXAA/SMAA: they soften hairlines |
| **halo / contact shadow** | analytic rounded-rect falloff on a floor quad using the kit's `haloOf` parameters | |
| **gradients, glows** | two-token mix along a local coordinate (+ dither); premultiplied transparent pass (screen in dark, multiply/normal in light) | |
| **debug audit** | object-ID buffer + edge detect, compared with drawn lines → "missing line" report | the 3D counterpart of `lines.mjs`; a QA tool, not the renderer |

The depth buffer **deletes** painter's order, `settle` and back/front slot splits. Explode = per-machine translation.

## 2. The big decision: renderer core

| | **A. pure TypeGPU engine (recommended)** | B. three.js WebGPURenderer + r3f, TypeGPU-written nodes via `@typegpu/three` |
|---|---|---|
| first machine on screen | ~1–2 weeks of engine basics (camera, mesh format, pools, passes) | hours |
| the custom look | total control; the in-face line shader needs vertex pulling + adjacency, which is natural here | fights three's material/geometry model: the in-face lines need custom attributes + node materials anyway; three's outline pass is inverted-hull (wrong look) |
| RN path | cleanest: TypeGPU runs "unmodified" on react-native-webgpu; `@typegpu/react` has a native build | r3f on native needs a bundle patch + custom `FiberCanvas`; open shadow crash on devices; drei on RN unclear |
| agent authoring | weaker: small corpus → mitigate with a short, strict building-block API + written spec | strongest: huge r3f/three corpus |
| editor tooling | build the cheap version (§5); no 3D gizmo initially | drei `TransformControls` nearly free |
| bundle | typegpu ≈ 90 KB gz | three WebGPU ≈ 310 KB gz + r3f 57 KB |
| "TypeGPU building blocks" goal | fully | partially (shaders only) |

**Why A:** the look is ~80 % custom shading and line work, which three wouldn't do for us. Three's main gifts (scene graph, gizmos, loaders) are things we need only small versions of. A also gives the cleanest RN path and actually produces the TypeGPU building blocks you asked for.

**What we borrow instead:**
- `wgpu-matrix` for math;
- three's MIT geometry code as reference for generators;
- `manifold-3d` for booleans and extrusions at authoring/build time (it's WASM, so it stays out of the runtime);
- the v3 prototype's lessons (palette, analytic lines, exact caching ideas).

**When I'd flip to B:** if the line spike (M1) shows in-face lines can't hold the look, then a three-based outline pipeline loses its main disadvantage. Or if speed-to-demo dominates and RN gets postponed indefinitely.

## 3. Architecture (A)

```
anatomy-gpu/                      (pnpm/yarn workspace)
  packages/
    engine/        TypeGPU core. NO react, react-native, DOM imports.
      gpu/           'use gpu' functions (shading, lines, coverage), d.struct schemas, pipelines
      mesh/          mesh format: positions, normals, uv, partId, faceId, edge flags, adjacency
      geo/           procedural generators: box/roundedBox, extrudePlan(+bevel), lathe, tube(sweep), belt, gear, ribs/grille
      scene/         SceneStore: parts, instance pools, transforms (typed arrays), ids
      render/        Renderer(device, context, size, dpr, palette) → frame(): fills+in-face lines, quads/dots, halo, glow; MSAA
      camera/        2:1 dimetric ortho, fit, pan/zoom, pixel snap
      palette/       tokens (light/dark) → GPU table + CSS-var export
    blocks/        React "lego" layer (React only, no DOM/RN): <Scene>, <Machine id>, <Lathe>, <Extrude>, <Tube>, <Belt>, <Instances>,
                   useFrame(sim), useInstances(pool), useOverrides(id). Components register into SceneStore in effects and render null.
    machines/      content: centrifuge.tsx (+ its sim.ts), conveyor.tsx, … — params as JSON-serializable spec with stable ids
    sim/           (optional) shared simulation helpers: fixed-step clock, belts, queues — plain TS over typed arrays
  apps/            (layout and seam adapted from BoneTideOSS, §8)
    web/ or expo/  phase 1 shell — Vite web app (Bone Tide split) or Expo app on web (§9.1)
    expo/          Expo SDK 57 app; web target now if Expo-first, else added in the native phase. <SceneCanvas> = react-native-webgpu <Canvas> + @typegpu/react <Root>.
                   HTML/RN overlays for titles, readouts, legend. Dev-only tuning overlay + Metro middleware for overrides.
  tools/           screenshot compare vs v2 (reuse drive/capture), perf smoke, line audit
```

**Rules:**
- **engine:**
  - takes `device`, `context`, size and DPR as inputs;
  - calls `ctx.present?.()`;
  - no module-level GPU singletons;
  - `frame()` stays a plain function, so it can become a worklet later.
- **React:** owns structure and params only. Per-frame state lives in typed arrays, updated in `useFrame`.
- **Ids:**
  - every element has a stable dotted id (`centrifuge.rotor.vane[3]`);
  - defaults live in code, tuning lives in `scene.overrides.json`;
  - unknown ids fail loudly.
- **Shared device:** one device and one canvas for a whole scene, from day one (v3's per-figure device was a mistake to avoid).
- **Versions:** pin exact versions of `typegpu`, `@typegpu/*`, `react-native-webgpu` and `expo`. All of them churn weekly.

**Mesh & draw model:**
- generators emit indexed triangles with per-vertex `partId`, `faceId` and normal type, plus per-edge flags (crease/boundary) and adjacency for silhouette tests;
- static geometry is merged per material into a few big buffers, plus a per-part transform palette in a storage buffer (moving parts need no rebuild);
- repeated parts (vanes, slats, packets, bolts) are GPU-instanced;
- target ≈ tens of draw calls for a whole factory.

**Frame:**
1. the sim updates typed arrays;
2. one upload per changed pool;
3. one MSAA pass: opaque fills with in-face lines, then depth-tested quads/dots, then a small transparent pass (halo, glow);
4. resolve.

No static cache needed initially; add one only if measurements say so.

## 4. Testing & verification (lean, lessons from v3)

- **Unit (Node):**
  - generators (topology, normals, edge flags, no sliver triangles thinner than a line);
  - `'use gpu'` shading/coverage functions run on CPU;
  - the sim.
- **Visual:**
  - side-by-side screenshots against the v2 SVG crops (rotor, tach, ribs) for style judgement by eye: "same style", not pixel parity;
  - the ID-buffer line audit as an objective check.
- **Perf smoke:** reuse `v3-gpu/tools/perf.mjs` (desktop + throttled phone) at each milestone.
- **Not yet:** no 20-row gate suite until the look is settled.

## 5. Fine-tuning (drop first if needed)

1. **Stable ids** + a typed spec with defaults.
2. **`scene.overrides.json`:** sparse, keyed by id, deep-merged at load, sorted keys, rounded values.
3. **Dev endpoint** (Metro `server.enhanceMiddleware`): `POST /__scene/patch` writes the overrides file and appends to `scene.edits.jsonl` (`{id, prop, from, to, note?}`), so the agent reads exactly what you changed and why.
4. **Click-to-select:** CPU ray against part bounding boxes. Show an overlay with id, position and rotation, an iso grid and an axis legend, plus "copy ref" (`#centrifuge.motor @ (3,0,1) rotY 90`).
5. **Nudge keys:** arrows = one grid cell, Shift = ¼ cell, R = rotate 90°, `[`/`]` = height. Numeric params via a lil-gui/tweakpane panel bound to the selected id.
6. **Agent hygiene:** the agent folds settled overrides into defaults and clears the file.

Cost ≈ 1–2 days. A 3D drag gizmo is optional later (≈ 3–5 days in pure TypeGPU).

## 6. Milestones (timeboxed, check-in after each)

| # | goal | output | timebox | go / no-go |
|---|---|---|---|---|
| **M0** | skeleton | workspace + Expo web app + engine package; camera; one shaded box and one lathe with the palette; theme switch | 1 day | renders at DPR 1–3 in Chrome/Safari; `'use gpu'` unit test runs in Node |
| **M1** | **line spike** (riskiest) | in-face crease/boundary/silhouette lines + band AA + one procedural UV line set (ticks) on box, lathe and tube; screenshot next to the v2 tach and rotor crops | 2–3 days | you judge: does it read as Anatomy? If not, try the screen-space or hybrid fallback, or reconsider B |
| M2 | building blocks | generators: extrude+bevel, lathe, tube sweep, belt, gear/ribs; instancing; part transforms; `<Scene>` / `<Machine>` / block components + SceneStore | 4–6 days | Node tests; a gallery page of all blocks |
| M3 | centrifuge, static | `machines/centrifuge.tsx` composed from blocks; halo, gradient, glow; overlay card | 3–4 days | side-by-side with the v2 page, your style review |
| M4 | centrifuge, animated | sim port (fill / spin / release, packets) via `useFrame` + instance pools | 3 days | perf smoke desktop + throttled phone |
| M5 | fine-tuning | §5 | 1–2 days | you nudge something and the agent sees it in the overrides + edits log |
| later | more machines; native phase (dev build, worklets, `present()`), WebGPU-unavailable fallback (poster image) | | | |

Rough total to an animated, tunable centrifuge: **≈ 3–4 weeks of human engineering**, or a fraction of that agent-orchestrated with check-ins. The engine estimate from the shading research for the full set is ≈ 30–45 days, which includes generators and QA tooling that later machines reuse.

## 7. Risks

- **In-face lines:**
  - silhouette lines sit *inside* the outline (SVG strokes straddle it), so they may read slightly lighter, and there may be notches at corners;
  - curved bodies show faceted silhouettes unless tessellation tracks screen size;
  - sliver triangles cut lines.

  → the M1 spike exists to find these.
- **Churn:**
  - TypeGPU is 0.x with `~unstable` APIs;
  - `react-native-webgpu` went 0.5 → 0.14 in 3 months;
  - open crash: one GPUDevice shared across JS runtimes on native (#455).

  → pin versions; keep the engine free of platform code.
- **WebGPU availability:** missing on Firefox Android and Linux browsers; Chrome Android needs Android 12+ → a static fallback image for phase 1.
- **Agent authoring on a bespoke API** → keep the block API small, typed and documented with examples. Specs are JSON-serializable, so agents generate data, not engine code.
- **Look drift from v2:** "same style" means a human judgement call at M1 and M3. Budget for 1–2 tuning rounds.

## 8. Bone Tide: a proven blueprint (public, MIT)

[reczkok/BoneTideOSS](https://github.com/reczkok/BoneTideOSS) (Konrad Reczko, TypeGPU team, SWM; open-sourced 2026-09-03) is a survivors-like game shipped on iOS, Android and web. Its engine is "shared 1:1" between a web app and an Expo app. Details: [research/bone-tide.md](research/bone-tide.md).

**What it validates:**
- **The layout:** a pnpm monorepo with `packages/engine` (imported as raw TS source), `apps/web` = **Vite** (not Expo web), and `apps/mobile` = Expo 57 / RN 0.86 / react-native-webgpu.
- **The platform seam:** the engine reaches the host only via `#platform/{env,assets,storage}` (a Vite alias on web, a Metro `resolveRequest` remap on native). The engine typechecks without the DOM lib.
- **The build:** `babel-preset-expo` + `unplugin-typegpu/babel` on native, `unplugin-typegpu/vite` on web, `tsover` for vector operators.
- **The native frame loop:** plain JS-thread rAF → `queue.submit` → `context.present?.()`. **No worklets for rendering.**
- **Native gotchas, already solved:**
  - request the `'implicit-device-synchronization'` feature (Dawn devices aren't thread-safe otherwise);
  - a `TextDecoder` polyfill;
  - no ES2023 change-by-copy array methods on Hermes;
  - a UIScene config plugin for iOS 27;
  - dev build only.
- **Perf patterns:**
  - one encoder and one submit per frame;
  - render bundles + `drawIndexedIndirect`, so empty instance batches cost nothing;
  - shared per-frame state via `tgpu.accessor`/`slot` bound with `root.with(...)`.

**What differs:**
- perspective camera, PBR-ish lighting, HDR, bloom and FXAA;
- no toon shading or outlines;
- glTF art (KayKit) with procedural placeholder primitives;
- **React stays out of the 3D scene**: imperative passes over GPU storage-buffer entities, and React only for `<Root>` and the HUD.

**Effect on this plan:**
1. **Reuse, MIT-attributed:**
   - the monorepo + `#platform` seam;
   - Metro/Babel/Vite configs;
   - the device init with the Dawn feature;
   - the `onLayout` → `configureContext` → rAF/`present()` shell;
   - `core/kernel.ts` and `core/indirect.ts`;
   - the indirect instanced-draw pattern;
   - box/tube placeholder builders;
   - the palette-texture idea;
   - the `.agents/skills/typegpu/` agent reference docs.

   This cuts M0 from "build a skeleton" to "adapt a proven one".
2. **Web shell:** Bone Tide shows the native port is cheap *without* Expo web, because the engine and seam carry it. That makes **Vite for the web app** a real option with no penalty for the later port. See question 1 in §9.
3. **Engine style:** follow Bone Tide's imperative, data-driven core: passes, GPU entity buffers, accessors. Keep the React lego layer as a *thin authoring layer on top* (machines → spec → pools), never inside the frame loop. This is new design that Bone Tide doesn't cover.
4. **Our own work remains:**
   - the 2:1 ortho camera;
   - palette-lookup shading;
   - the line system (§1);
   - generators beyond box/tube;
   - the React blocks;
   - fine-tuning.

## 9. Open questions for you

1. **Web shell: Expo web or Vite?**
   - Both work, verified.
   - **Expo web** = one app for web and native.
   - **Vite web + Expo mobile** = Bone Tide's proven split: faster web tooling, lighter bundle, two thin shells around one engine.
   - My lean: Bone Tide's split, since its port evidence removes the main reason for Expo-first. Your call.
2. M1 is a style judgement. Is "reads as Anatomy next to the v2 crop" the bar, or do you want measured criteria (line width, tone values)?
3. Line width under zoom: scale with zoom like the SVG, or fixed hairline pixels?
4. Content scope after the centrifuge: the whole factory, or a few showcase machines?
5. Where to put it: `~/Documents/rnaa-anatomy/v4/` as a new workspace (this draft lives there), and commit there?
