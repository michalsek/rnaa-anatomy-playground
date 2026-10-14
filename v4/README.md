# v4: Anatomy-style 3D machines on TypeGPU

One TypeGPU engine (`packages/engine`) and one Expo app (`apps/app`) for web, iOS and Android.
Plan: [ARCHITECTURE.md](ARCHITECTURE.md). Skeleton adapted from BoneTideOSS (MIT), see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Setup

```sh
pnpm install            # Node 24+, pnpm 11 (packageManager pinned)
```

## Run

```sh
pnpm web                # Expo dev server on :8090; web at http://localhost:8090 (WebGPU browser)
pnpm test               # engine unit tests (vitest, 'use gpu' runs on the CPU)
pnpm types              # typecheck engine (no DOM lib) + app
```

iOS (dev build, no Expo Go; `ios/` is generated and gitignored):

```sh
cd apps/app
CI=1 npx expo prebuild --platform ios --clean
(cd ios && LANG=en_US.UTF-8 pod install)          # CocoaPods needs a UTF-8 locale
nice -n 15 xcodebuild -workspace ios/Anatomyv4.xcworkspace -scheme Anatomyv4 \
  -sdk iphonesimulator -configuration Debug -derivedDataPath ios/build -jobs 4 build
xcrun simctl install booted ios/build/Build/Products/Debug-iphonesimulator/Anatomyv4.app
npx expo start --port 8090                         # same server serves web + native bundles
# the debug build defaults to Metro on :8081; point it at :8090 instead:
xcrun simctl launch booted eu.omaewa.anatomyv4 -RCT_jsLocation localhost:8090
```

`pnpm ios` (`expo run:ios`) also works but builds with full parallelism.
Android: `pnpm android` (config only so far, not built).

## Layout

```
packages/engine/src
  camera/    2:1 dimetric ortho camera (kit projection), fit (to part box corners), view presets
  palette/   light/dark tokens (from the v2 kit) → GPU palette table (fill, line and dot tones)
  geo/       JSON GeoSpecs → cached prototypes: box/extrude (plans, seams), lathe (seams, poles,
             spline spans), tube (open/closed, tangents), belt; topology per prototype;
             contacts (triangle crossings); mark helpers (bolt circles, polylines)
  scene/     SceneStore (groups/parts/pools/marks, tokens, build → batches, flatten → instances);
             M1 profiles and line sets
  shading/   'use gpu' tone rules (bands, plan, tube stripes) + AA weights, line coverage
  render/    vertex pulling, instance/style/mark tables, in-face lines, marks pipeline,
             MSAA 4× + depth, one encoder/submit per frame
  platform/  #platform/* contract (+ Node stub for tests)
apps/app
  src/blocks/                  React blocks: Scene, Group/Machine, Box, Extrude, Lathe, Tube,
                               Belt, Instances, Marks, useFrame, useNode (render null)
  src/gallery/                 M2 gallery (rows m1, ext, lathe, inst, marks, contact) + M1 row
  src/platform/{web,native}/   hosts for #platform/*, picked by metro.config.js
  src/shell/                   rAF loop: store.tick (dt ≤ 0.1 s) → renderer.frame → present?.()
  src/Stage.tsx                <Canvas> + layout → configure → shell (rebuilt on Fast Refresh)
```

## Controls

Top-right toolbar: scene (`gallery`, `m1`), view preset, pause, debug view (`dbg 1` = line
classes: outline red, contour magenta, crease blue, ticks green, marks and contacts cyan;
`dbg 2` = lines off), theme. In dev builds the same is scriptable from a debugger or the browser
console: `__v4.setScene('m1')`, `__v4.setView('close cage')`, `__v4.look({ focus: [x, y, z],
zoom: 8 })`, `__v4.setDebug(1)`, `__v4.setPaused(true)`, `__v4.setTheme('dark')`,
`__v4.setPoolCount('inst.packets', 12)`, `__v4.store()`; `__v4.views` / `__v4.scenes` list the
names. Notes: [notes/M1.md](notes/M1.md), [notes/M2.md](notes/M2.md).
