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
  camera/    2:1 dimetric ortho camera (kit projection), fit-to-bounds, view presets, pixel snap
  palette/   light/dark tokens (from the v2 kit) → GPU palette table (fill + line tones)
  geo/       box, lathe (spline-refined smooth spans), tube; mesh merge; topology (adjacency,
             crease/boundary/smooth flags)
  shading/   'use gpu' tone bands (+ AA weights), line coverage, per-frame edge modes
  render/    vertex pulling, in-face lines (outline/crease/contour/UV ticks), MSAA 4× + depth,
             one encoder/submit per frame
  scene/     M1 line-spike scene (box + tach, rotor with ribs and dial, tube) and its views
  platform/  #platform/* contract (+ Node stub for tests)
apps/app
  src/platform/{web,native}/   hosts for #platform/*, picked by metro.config.js
  src/shell/                   rAF loop + context.present?.()
  src/Stage.tsx                <Canvas> + layout → configure → shell (rebuilt on Fast Refresh)
```

## Controls (M1)

Top-right toolbar: view preset (cycles `fit`, yaw/elevation variants, `0.5× thin`, 4× zooms),
pause, debug view (`dbg 1` = line classes: outline red, contour magenta, crease blue, ticks
green; `dbg 2` = lines off), theme. In dev builds the same is scriptable from a debugger or the
browser console: `__v4.setView('4× tach')`, `__v4.setDebug(1)`, `__v4.setPaused(true)`,
`__v4.setTheme('dark')`; `__v4.views` lists the presets. Notes: [notes/M1.md](notes/M1.md).
