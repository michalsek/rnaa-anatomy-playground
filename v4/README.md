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
  camera/    2:1 dimetric ortho camera (kit projection), fit (to part box corners, into the
             viewport minus pads, optionally a centred 16:9 rectangle: `frameRect`), view presets
             (optional `frame` box to fit); ease.ts: eased view changes (critically damped);
             orbit.ts (M11): orbit about the target (elevation 10–80°), pan, zoom about a point
             (0.5–12× the fit); film.ts (M12): the loop video's maths (the top-down screen
             cameras, the 16:9 film band and frame, cameraLerp, smootherstep, the compositor's geometry)
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
             and the rewritten range; moving slots last, rare movers keep static slots); live parts
             (PartHandle: mix, uShift), pools with blend/shift/axis scale; clip groups and the clip
             volume; groupBounds, haloIds; M1 profiles and line sets
  sim/       M5: the shared sim, plain TS on one fixed 1/120 s step: clock (factory, advance/run,
             link in step order), ports (receivers, strict receivers, asking senders, local → world
             → local; M11: a machine may be turned by quarter turns, `yaw`), items (kinds, sizes, ledger, PoseFn), math, path (belt frame, stadium loop, vertical stadium),
             fall, conveyor (top: hop, hold, tip), loop (cleats, bails, read greying, drop,
             quanta/phaseAt/canTake, syncToLoop), source, sink, crusher (M6), scanner (M7: reads on
             the loop's read point, `scannerReadAt`, pulses, cells, the push onto belt D), elevator
             (M8: cradles on a vertical stadium, boot queue, cubic fling, hidden transit, spout),
             speaker (M8: ledge, throat, cone impulse, meter with peak hold), packer (M9: transfer
             plate, gutter, walking beam, magazine, pusher, erector, flaps, fold, tape, the two
             arms' tool points, the interlock), arm (the 2-link planar IK, `solveArm`), the bead
             source (the dispenser's stand-in), dispenser (M10: the phone's: bursts down the neck
             into the sight cage, star valve, nozzle; tip at z 437), rates (the tunable rates),
             graphs (exported path builders: input, core, garbage, read, output; the line (the
             test bed: bead source → … → speaker); centrifuge, v2 conveyor-, crusher-, scanner- and
             packer-page layouts, the output page); `Machine.status()` (required) for the dev hook; every drawn sim
             exposes its pool sizes (`pools`);
             centrifuge/ = packets (throat, pockets, release path, §A invariants) + controller (the
             swappable spin model: default and ramp)
  assembly/  M10: factory.ts (the phone, FACTORY_LAYOUT with the stands, createFactoryGraph in
             FACTORY_ORDER; M11: the layout from knobs, `factoryLayout`: V2_KNOBS = v2 A's =
             LINE_LAYOUT, M11_KNOBS the factory's), origins.ts (machine origins and turns, boxes,
             placeBox), reveal.ts (the phone-opening reveal: machine boxes, the packed layout, order,
             docking pairs, the scheduler (M11: most machines at once, rests checked), poses, the
             lid, the clip volume)
  shading/   'use gpu' tone rules (bands, plan, tube stripes) + AA weights, line coverage
  render/    vertex pulling, instance (96 B: + style2/mix blend, uShift)/style/mark/gradient
             tables, in-face lines (+ UV sectors, per-instance scroll), gradient tone, marks
             pipeline, sprites (halo, glow discs; multiply/screen by theme), the clip volume
             (discard outside, for clip groups), MSAA 4× + depth, one
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
  src/machines/speaker/        the speaker from v2 (Driver (stand, baffle, basket, surround, cone +
                               cap on live groups), Throat (mouth, ledge, 6 live LEDs, terminal,
                               wiring); one frame hook in Speaker.tsx; `stand` prop, default on;
                               dims.ts; M11: the driver drawn `scale` (2) times v2's, the machine
                               turned by its sim's yaw)
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
  src/machines/phone/          the phone (M10): Case (low band halves, buttons, port, floor
                               plates), Display (OLED, glass, logo rings, nucleus, meter cells),
                               Dispenser (cage, valve, rotor, nozzle, beads); one frame hook
  src/factory/                 live.ts (a graph per scene, playback, hold, readout, `__v4.sim`;
                               every machine block calls `live.step` first), Scenes.tsx (factory,
                               centrifuge, crusher, scanner, output, conveyor, packer),
                               factoryViews.ts (views in machine-local frames), cards.ts (the card
                               per view, readouts, caption, legend), stands.ts, revealCtl.ts +
                               RevealDriver.tsx (the reveal), tour.ts + TourDriver.tsx, views.ts
  src/overlay/                 Card.tsx (an overlay: page strips, frame, header/footer bands,
                               corner texts), layout.ts (card, chips and camera pads for card,
                               bare and 16:9), InfoSheet.tsx (the "i" sheet)
  src/overlay/readout.ts       readout store (≤ 10 Hz, phase changes at once)
  src/film/                    M12 film mode (DEV, off by default): filmCtl.ts (the loop video's shots,
                               `__v4.film`), FilmDriver.tsx (its frame hook in the factory scene)
tools/film/                    M12: the loop video's capture (CDP), checks, status-bar tracer, compositor,
                               master encode (notes/M12.md has the commands)
  src/gallery/                 M2 gallery (rows m1, ext, lathe, inst, marks, contact, fx) + M1
                               row; views.ts holds layout and view presets (no components)
  src/platform/{web,native}/   hosts for #platform/*, picked by metro.config.js
  src/shell/                   rAF loop: store.tick (dt ≤ 0.1 s; 0 while paused) → renderer.frame
                               → present?.(); gestures.ts (M11: orbit, pan, pinch, wheel, double
                               tap; fed by Stage.tsx's PanResponder on a pad over the canvas)
  src/Stage.tsx                <Canvas> + layout → configure → shell (rebuilt on Fast Refresh)
  src/gpuRoot.ts               the TypeGPU root in module state (survives Fast Refresh)
```

## Controls

Rule for Fast Refresh: component modules (`*.tsx`) export only components; constants and
view presets live in plain modules (`dims.ts`, `views.ts`). Then a prop edit patches in place:
the store and GPU device survive and the scene rebuilds warm.

The chips (top right; in landscape inside the card's header): scene (`factory` default: the phone with the whole
factory in its tray, from the dispenser under the floating display through belt A, the packer, belt B, the
centrifuge, the audio loop, belt C and the crusher, and the scanner reading the loop → belt D → the elevator → the
speaker; `packer`: v2's packer page; `centrifuge`: the centrifuge with short belts; `crusher`, `scanner`: v2's
pages; `output`: a source over belt D, the elevator, the speaker; `conveyor`: v2's conveyor page; `gallery`, `m1`),
view preset (factory: `fit` (the tray and the machines in 16:9; the floating display is cut at the top), `phone`,
`case`, the hand-offs `dispenser-A`, `A-packer`, `packer-B`, `B-centrifuge`, `centrifuge-audio`, `release`,
`scanner-read`, `audio-C`, `C-crusher`, `scanner-D`, `D-elevator`, `elevator-speaker`, and one per machine
`dispenser`, `packer`, `centrifuge`, `loop`, `crusher`, `scanner`, `elevator`, `speaker`; the
card's text follows the view; packer: `fit`, `gutter`, `lane`, `magazine`, `folder`, `nose`; centrifuge: `fit`,
`rotor`, `instr`, `drive`, `funnel`; crusher: `fit`, `hopper`, `spring`, `drive`, `ctl`, `bin`; scanner: `fit`,
`arm`, `preamp`, `scanner`, `D`; output: `fit`, `boot`, `head`, `spout`, `speaker`, `meter`), view changes ease
(critically damped, τ 0.35 s), run/paused, pause, debug view (`dbg 1` = line
classes: outline red, contour magenta, crease blue, ticks green, marks and contacts cyan;
`dbg 2` = lines off), `reveal`/`conceal` (the factory: the phone opens: the screen lifts off the closed case,
the machines rise out of their packed layer, most of them at once, and turn into place, ≈ 4.5 s; conceal is the
reverse), `tour` (an event-gated camera script for recordings: the reveal, the phone, every hand-off, ≈ 46 s), `i`
(the figure's caption and a legend), `bare`/`card` (full-bleed, the default since M11: no card frame or texts; the
card is opt-in), theme. On the stage (M11): drag orbits (elevation 10–80°), two fingers or shift-drag pan, pinch or
the wheel zoom (0.5–12× the fit), a double tap eases back to the view; any of them stops the tour. The stage always fills the window; the card,
its texts, the chips and the sheet are overlays, and the camera keeps the figure clear of them through the frame's
pads. In dev builds the same is scriptable from a debugger or the browser
console: `__v4.setScene('m1')`, `__v4.setView('close cage')`, `__v4.look({ focus: [x, y, z],
zoom: 8 })`, `__v4.setDebug(1)`, `__v4.setPaused(true)`, `__v4.setTheme('dark')`,
`__v4.setPoolCount('inst.packets', 12)`, `__v4.setChrome(false)` (hide the toolbar for
captures), `__v4.setBare(true)` (full-bleed), `__v4.record(true)` (fit every view into a centred 16:9 rectangle),
`__v4.setSheet(true)`, `__v4.reveal` (`seek(0–1)`, `reveal()`, `conceal()`, `skip()`, `restart()`, `state()`),
`__v4.tour` (`play()`, `stop()`, `state()`), `__v4.store()`, `__v4cam` (the free camera: `get()`, `set(state,
ease)`, `ref()`, `reset()`); `__v4.views` / `__v4.scenes` list the names. In the factory,
packer, centrifuge, crusher, scanner and conveyor scenes `__v4.sim` controls the scene's graph: `seek(t)` (deterministic:
rebuild, run, pause), `play()`, `pause()`, `speed(0.25–4)`, `seed(n)` (integer), `status(id)`
(`machines()` lists the ids), `log()` (the centrifuge's phase changes), `ledger()`
(created/alive/consumed), `release(false)` (the loop refuses packets), and in the factory `stands({ beltA: true })`
(override the stands decided in M10; `stands(null)` restores them). `__v4sizes()` (DEV) returns the window, stage, canvas and texture sizes (rotation diagnosis).
`__v4perf()` reports fps,
rAF gaps, tick, flatten + upload and frame CPU over the last 300 frames. The rates (source, the bead
source's bursts, the packer's tempo, HOLD, loop and belt speeds, belt D's speed, the elevator's chain speed, the crusher's bin dump and
feed, the scanner and output pages' feeds) are `RATES` in
`packages/engine/src/sim/rates.ts`. DEV builds keep
the last 50 engine log lines in `globalThis.__v4logs` (per-phase rebuild ms). Notes:
[notes/M1.md](notes/M1.md), [notes/M2.md](notes/M2.md), [notes/M3.md](notes/M3.md),
[notes/M4.md](notes/M4.md), [notes/M5.md](notes/M5.md), [notes/M6.md](notes/M6.md),
[notes/M7.md](notes/M7.md), [notes/M8.md](notes/M8.md), [notes/M9.md](notes/M9.md), [notes/M10.md](notes/M10.md),
[notes/M11.md](notes/M11.md), [notes/M12.md](notes/M12.md). Test timelines print with `V4_TIMELINE=1 pnpm test`.

## The loop video (M12)

`loop-light-60.mp4` (16:9, 60 fps, light, silent; made from scripts, not kept in the repo):
- **Part 1, web:** the open factory, the M11 tour, the conceal, and the camera going top-down onto the closed
  phone's screen.
- **Seam A:** the screen becomes the iOS simulator's.
- **Part 2, iOS:** the camera pulls back into a phone inside the phone, tilts and opens it.
- **Seam B:** the output zooms back into it and dissolves into Part 1's start.

DEV `__v4.film`: `enable({ platform: 'web' | 'sim' })` (bare, no chips, light, the 16:9 film frame, lines in
proportion to it, the screen's iOS status bar and Dynamic Island), `part1()`, `step()` (web: one 1/60 s
frame, resolves when drawn), `arm({ logo })`, `go()`, `state()`, `disable()`. Commands and numbers:
[notes/M12.md](notes/M12.md).
