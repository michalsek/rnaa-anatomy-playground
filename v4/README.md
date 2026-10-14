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
             (optional `frame` box to fit)
  palette/   light/dark tokens (from the v2 kit) → GPU palette table (material slots, then FX
             colours: halo, glow, void, strobe); CARD tokens and MONO for the overlay
  geo/       JSON GeoSpecs → cached prototypes: box/extrude (plans, polygon smooth points, seams, side line sets: E6
             stripes), lathe (seams, poles,
             spline spans), tube (open/closed, tangents), belt, band (a conveyor belt loop whose u
             is the sim's arc length: slats as a line set); topology per prototype;
             contacts (triangle crossings); mark helpers (bolt circles, polylines); helix (E7);
             tube pieces (`range`: one centreline, joined cuts draw no outline; `tubeCentreline`);
             circleSteps / lodSteps (E9 step LOD by radius)
  scene/     SceneStore (groups/parts/pools/marks, tokens, build → batches, flatten → instances
             and the rewritten range; moving slots last); live parts (PartHandle: mix, uShift),
             pools with blend/shift/axis scale; M1 profiles and line sets
  sim/       M5: the shared sim, plain TS on one fixed 1/120 s step: clock (factory, advance/run,
             link in step order), ports (receivers, strict receivers, asking senders, local → world
             → local), items (kinds, sizes, ledger, PoseFn), math, path (belt frame, stadium loop, vertical stadium),
             fall, conveyor (top: hop, hold, tip), loop (cleats, bails, read greying, drop,
             quanta/phaseAt/canTake, syncToLoop), source, sink, crusher (M6), scanner (M7: reads on
             the loop's read point, `scannerReadAt`, pulses, cells, the push onto belt D), elevator
             (M8: cradles on a vertical stadium, boot queue, cubic fling, hidden transit, spout),
             speaker (M8: ledge, throat, cone impulse, meter with peak hold), packer (M9: transfer
             plate, gutter, walking beam, magazine, pusher, erector, flaps, fold, tape, the two
             arms' tool points, the interlock), arm (the 2-link planar IK, `solveArm`), the bead
             source (the dispenser's stand-in), rates (the tunable rates), graphs (line from the
             bead source through belt A and the packer to belt D → elevator → speaker, built from
             path builders; centrifuge, v2 conveyor-, crusher-, scanner- and packer-page layouts,
             the output page); `Machine.status()` (required) for the dev hook; every drawn sim
             exposes its pool sizes (`pools`);
             centrifuge/ = packets (throat, pockets, release path, §A invariants) + controller (the
             swappable spin model: default and ramp)
  shading/   'use gpu' tone rules (bands, plan, tube stripes) + AA weights, line coverage
  render/    vertex pulling, instance (96 B: + style2/mix blend, uShift)/style/mark/gradient
             tables, in-face lines (+ UV sectors, per-instance scroll), gradient tone, marks
             pipeline, sprites (halo, glow discs; multiply/screen by theme), MSAA 4× + depth, one
             encoder/submit per frame, dirty-range instance upload, DEV perf ring
  platform/  #platform/* contract (+ Node stub for tests)
apps/app
  src/blocks/                  React blocks: Scene, Group/Machine (contacts default), Box,
                               Extrude, Lathe, Tube (+ range), Belt, Instances, Marks, Halo,
                               Glow, useFrame, useNode, useNodes (render null)
  src/machines/kit.ts          shared authoring helpers (frames, FX/FY/FZ, discs, rod, turned,
                               corners, rings, screws, faceScrews, dots, slot, circle, ribs, plateX)
  src/machines/Packets.tsx     the packet pool every machine uses (5 kinds, straps)
  src/machines/centrifuge/     the centrifuge from v2 (dims.ts + one module per assembly;
                               views.ts: fit + 4 crops, card text); one useFrame in
                               Centrifuge.tsx; `stand` prop (default on)
  src/machines/crusher/        the crusher from v2 (Housing, Drive, Discharge, Control; one frame
                               hook in Crusher.tsx; `stand` prop, default on; dims.ts, views.ts)
  src/machines/scanner/        the read arm from v2 (Base, Head (VCM, moving arm, ribbon, lamp),
                               Preamp (cells, lip, cable pieces); one frame hook in Scanner.tsx;
                               `stand` prop, default on; dims.ts, views.ts)
  src/machines/elevator/       the bucket elevator from v2 (Boot, Tower (posts, girts, gussets, chain
                               bands with scrolling pins), Head (frame, turning wheel, discharge,
                               drive); five cradle plate pools; one frame hook in Elevator.tsx;
                               `stand` prop, default on; dims.ts)
  src/machines/speaker/        the speaker from v2 (Driver (mount, basket, surround, cone + cap on
                               live groups), Throat (mouth, ledge, 6 live LEDs, wiring); one frame
                               hook in Speaker.tsx; `stand` prop, default on; dims.ts)
  src/machines/packer/         the packer from v2 (Deck: stand, deck, lane, magazine, pusher,
                               bridge, gutter, transfer plate, pedestals, cabinet; Arm: nested
                               moves groups (turret, link 1, link 2, level wrist, tool) posed by
                               `solveArm`; carton, stack, finger and rod pools; one frame hook in
                               Packer.tsx; `stand` prop, default on, and `floor`; dims.ts)
  src/machines/Opening.tsx     openings in faces (void-gradient insets: slots, mouths, feed holes)
  src/machines/Beads.tsx       the fluff bead pool; styles.ts: the packet kinds' materials
  src/machines/poses.ts        useItemPoses / usePacketPoses: the one sim → item pool writer
                               (packets and beads; an item past a pool's capacity is skipped with
                               one DEV warning)
  src/machines/conveyor/       Top.tsx (single-sided belt) and Loop.tsx (the audio belt) from
                               v2 conveyor.mjs, Parts.tsx (belt body, lamp, motor, label, nut),
                               dims.ts (belt-coordinate kit); `legs` prop (default on)
  src/factory/                 live.ts (a graph per scene, playback, readout, `__v4.sim`; every
                               machine block calls `live.step` first), Scenes.tsx (line,
                               centrifuge, crusher, scanner, output, conveyor), views.ts
  src/overlay/Card.tsx         the kit's figure card (fig, title; hint and live readout share a
                               wrapping bottom row; the stage leaves room for two lines)
  src/overlay/readout.ts       readout store (≤ 10 Hz, phase changes at once)
  src/gallery/                 M2 gallery (rows m1, ext, lathe, inst, marks, contact, fx) + M1
                               row; views.ts holds layout and view presets (no components)
  src/platform/{web,native}/   hosts for #platform/*, picked by metro.config.js
  src/shell/                   rAF loop: store.tick (dt ≤ 0.1 s; 0 while paused) → renderer.frame
                               → present?.()
  src/Stage.tsx                <Canvas> + layout → configure → shell (rebuilt on Fast Refresh)
  src/gpuRoot.ts               the TypeGPU root in module state (survives Fast Refresh)
```

## Controls

Rule for Fast Refresh: component modules (`*.tsx`) export only components; constants and
view presets live in plain modules (`dims.ts`, `views.ts`). Then a prop edit patches in place:
the store and GPU device survive and the scene rebuilds warm.

The toolbar row above the card: scene (`line` default: bead source → belt A → packer → belt B →
centrifuge → audio loop → belt C → crusher, and the scanner reading the loop → belt D → the
elevator → the speaker, at the final layout; `packer`: v2's packer page (bead source, belt A, the
packer, a short belt B into a crate, on a floor raised to 120); `centrifuge`: the centrifuge with
short belts; `crusher`: v2's crusher page; `scanner`:
v2's scanner page; `output`: a source over belt D, the elevator, the speaker; `conveyor`: v2's
conveyor page; `gallery`, `m1`), view preset (line: `fit`, `dispenser-A`, `A-packer`, `packer`, `packer-B`,
`centrifuge-audio`, `funnel`, `release`, `read`, `head`, `audio-C`, `C-crusher`, `crusher`,
`scanner-read`, `scanner-D`, `arm`, `preamp`, `D-elevator`, `elevator`, `elevator-head`,
`elevator-speaker`, `speaker`; packer: `fit`, `gutter`, `lane`, `magazine`, `folder`, `nose`; centrifuge: `fit`, `rotor`, `instr`,
`drive`, `funnel`; crusher: `fit`, `hopper`, `spring`, `drive`, `ctl`, `bin`; scanner: `fit`,
`arm`, `preamp`, `scanner`, `D`; output: `fit`, `boot`, `head`, `spout`, `speaker`, `meter`; the
speaker views are turned (yaw −45): from the standard camera the elevator's head hides it), pause, debug view (`dbg 1` = line
classes: outline red, contour magenta, crease blue, ticks green, marks and contacts cyan;
`dbg 2` = lines off), theme. In dev builds the same is scriptable from a debugger or the browser
console: `__v4.setScene('m1')`, `__v4.setView('close cage')`, `__v4.look({ focus: [x, y, z],
zoom: 8 })`, `__v4.setDebug(1)`, `__v4.setPaused(true)`, `__v4.setTheme('dark')`,
`__v4.setPoolCount('inst.packets', 12)`, `__v4.setChrome(false)` (hide the toolbar for
captures), `__v4.store()`; `__v4.views` / `__v4.scenes` list the names. In the line,
packer, centrifuge, crusher, scanner and conveyor scenes `__v4.sim` controls the scene's graph: `seek(t)` (deterministic:
rebuild, run, pause), `play()`, `pause()`, `speed(0.25–4)`, `seed(n)` (integer), `status(id)`
(`machines()` lists the ids), `log()` (the centrifuge's phase changes), `ledger()`
(created/alive/consumed), `release(false)` (the loop refuses packets). `__v4sizes()` (DEV) returns the window, stage, canvas and texture sizes (rotation diagnosis).
`__v4perf()` reports fps,
rAF gaps, tick, flatten + upload and frame CPU over the last 300 frames. The rates (source, the bead
source's bursts, the packer's tempo, HOLD, loop and belt speeds, belt D's speed, the elevator's chain speed, the crusher's bin dump and
feed, the scanner and output pages' feeds) are `RATES` in
`packages/engine/src/sim/rates.ts`. DEV builds keep
the last 50 engine log lines in `globalThis.__v4logs` (per-phase rebuild ms). Notes:
[notes/M1.md](notes/M1.md), [notes/M2.md](notes/M2.md), [notes/M3.md](notes/M3.md),
[notes/M4.md](notes/M4.md), [notes/M5.md](notes/M5.md), [notes/M6.md](notes/M6.md),
[notes/M7.md](notes/M7.md), [notes/M8.md](notes/M8.md), [notes/M9.md](notes/M9.md). Test timelines print with `V4_TIMELINE=1 pnpm test`.
