status: review

# Centrifuge (kind `centrifuge`, one instance)

Meaning: the lock-free single-producer rings (1,024 slots in the engine) that hold events until the audio thread
drains them at the next render quantum. Drawn with 10 pockets. The spout is the write index, the release gate the
read index; in sync both run at once (packets drop into free pockets as they pass while the gate drains one per slat).

## Use in the assembly
- `import { build, LIVE, CSS } from "../parts/centrifuge/centrifuge.mjs"`
- `build(ctx, origin, { id: "centrifuge" })` — origin is the machine's axis on the case floor; everything is built
  relative to it. Tallest point: funnel mouth at origin z + 186 (pulleys and motor cable + 183), under the ≈ 280 case top.
- `page(ctx, { css: CSS + …, live: [LIVE, …] })` — **CSS is required** (funnel interior gradient, strobe, lamp glow).
- Boot: `FACTORY.define("centrifuge", MACHINES.centrifuge)`, then
  `FACTORY.machines.centrifuge.syncTo(() => FACTORY.machines.audio.quanta())`. `fn()` may return the conveyor's
  `quanta()` object `{ phase, period }` (phase wraps once per cleat gap = one 128-frame quantum) or a bare phase
  number; `syncTo(fn, period)` takes the period separately. With a period the rotor runs at exactly one pocket per
  quantum and the release is led by `status().lead` (≈ 1.09 s: leave the pocket 0.28 + spout 0.50 + fall 0.31) so
  releases come one per quantum at the belt's rate; the conveyor's `accept` then lands each on the next free cleat.
  Without `syncTo` it uses its own 0.42 s clock.
- Backpressure: `canAccept()` is false while 2 parcels wait in the funnel throat (`status().full`); belt B should hold
  its front parcel at the roller until it turns true. Extra parcels are still accepted and stack visibly.
- `status()` → `{ held, rpm, phase, queued, inSync, full, lead }`; `rpm` is the rotor's true speed (0 under reduced
  motion); `phase` ∈ idle · filling · spinning up · in sync · spinning down · passing packets (reduced motion).

## Size and ports
`ctx.data[id].portsLocal` (relative to origin), `.ports` (world) and `.origin`:
- `in` local [0, −32, 186]: in the funnel mouth (mouth centre [0, −23, 186], r 11, lip r 12.2).
  `accept("in", item, from)` arcs the parcel from `from` into the mouth; without `from` it fades in 12 above the mouth.
- `out` local [−4.5, 51.2, 100]: the hand-over point **in front of the machine** (viewer side, angle 95°). The parcel
  leaves the rotor through the gate, slides down the spout and falls off its lip; it is emitted as it passes z 100,
  still falling, as `api.emit("out", { ...item, v: [vx, vy, vz] }, point)` (world velocity, u/s, gravity 400). The
  receiving belt's top run should pass under it (top ≈ 92, running along x at local y ≈ 51).
- Footprint (local) x −40…+63, y −29…+57 incl. the spout and its fall path (stand x −40…+40, y −28…+28), drive
  cabinet on the floor at x 51…63, y −7…17, z 0…40. Below z 100 inside the legs: legs, rails at z 22–26 (all sides),
  upper rails z 58–61 (±y sides). Heights: skids 0–4, legs to 96, isolators to 100, base flange 100–103 (r 37), bowl
  103–120 (r 30 → 34 knuckle, then r 34), rotor 122.5–132, rim and gate to 139.6, ring 162, motor/bearing to 182,
  funnel mouth 186.

## Construction (≈ 100 parts)
Stand: skids 2 + lifting eyes 4, feet 4 + levellers 4, legs 4, leg pads 4, rubber isolators 4, rails 6, cooler shelf,
gussets 2, label plate. Bowl: base flange (24 bolts), bowl with an analytic knuckle bottom, stiffening ribs 8, top
flange (32 bolts). Rotor: carousel, live vanes 10, hub collar + hub column (separate items), strobe disc (10 live
sectors), shaft; stationary rim (back half + two front pieces, bolted) open at the gate, gate sill, guillotine gate
(two guides, lintel, live plate), discharge spout (floor + two walls). Cage: post feet 8, posts 8, top ring, spider,
arms 3. Drive: bearing cartridge (base flange, bright body, collar, cap, grease nipple — separate items, no fins),
shaft neck and pulley, motor plate + spacer, finned graphite motor with flange, shaft, pulley, terminal box + gland,
dark rubber V-belt (r 1), floor-standing drive cabinet (plinth, door, vents, rating plate, handle, hinges, gland)
with its cable up to the terminal box. Intake: funnel bars 2, flange, flared funnel, lip with interior. Instruments:
tachometer, sync lamp (housing + bezel + lens, the one lit accent), gate crank at 118° (pad, boss, live arm). Drain
valve with handwheel at 20°. Coolant: pads 2, pipes 2 with 4 flanges, cooler on two cradles with end caps and port
saddles. Oiler + oil line to the bearing body.

## Painter's strategy
- Empty envelope items carry the live content, each followed by its slot: `env-back` / `env-front` (half annuli
  r 12.3–29.3 → `rotorBack` / `rotorFront`), `env-drop` (column under the funnel → `drop`), `env-gate` (the gate
  plate's swept sector → `gate`), `env-spout` (above the spout floor, between the walls → `spout`), `env-fall`
  (box beyond the lip → `fall`). Settle orders them against the static parts; the near spout wall comes after
  `env-spout`, so a sliding parcel's foot is hidden by it.
- A released parcel moves rotor slot → spout slot (centre past the rim) → fall slot (centre past the lip).
- Other slots: `intake` (after the funnel lip: arcing and queued parcels and the top of a parcel starting to fall,
  all cut at the mouth plane), `hubtop`, `shaftPulley` / `motorPulley`, `tach`, `lamp`, `crank`.
- Stepped turned parts are separate items (hub, bearing, lamp, drain outlet) — the same as the kit's new
  `ctx.stepped`; the module keeps its own `turned()` because it needs the recorded shape back for saddle cuts.

## Motion
- `index` (filling): a critically damped angle spring (τ 0.22 s) brings the next free pocket under the spout; the head
  of the queue is let go when the predicted error at landing is < 0.02 rad; with nothing queued the rotor creeps at
  ~1 rpm. The next parcel falls 7 to the throat when the head leaves.
- `spin` at 6 held (or 4 s quiet with some held): speed settles (τ 0.4 s) to one pocket per quantum; a phase term
  locks the release crossings to the quantum phase plus the lead. `in sync` after 0.35 s within 4 % / 0.05 pocket.
- In sync: each time a full pocket reaches the gate, the gate lifts (crank swings with it), the parcel rides out of
  its pocket onto the spout, slides, falls and is handed on; the lamp glows steadily and flashes once per release.
  Queued parcels drop timed to land in free pockets as they pass (≥ 0.2 s apart).
- Empty for 0.6 s → `down` → back to `index`, coming to rest with a pocket under the spout.
- Reduced motion: nothing moves. Parcels go straight into free pockets, one leaves per quantum (by the clock) and is
  emitted at `out` with no animation; rpm 0, phase `passing packets`; the rotor stands with a pocket under the spout.

## Verification (last run)
- `node build.mjs --audit` → `audit passed` (6 tubes, 175 solids, 239 items incl. stubs).
- Small-scale test (two instances at KS 1.88 and 1.47, `shots`-free script in the session scratchpad) →
  `audit passed`, `line ends: 0`.
- `lines.mjs` light and dark → 0; `drive.mjs ["lines"]` at 4, 11, 15.5 (release in flight), 26.5 s → 0.
- Captures: full light/dark, phone 390, reduced-motion status log and sheet, 0.15× sheet of the release path, zooms of
  hub/bearing (both themes), gate/spout, bowl, funnel with queued parcels.

## Standalone page
Stub of belt B above (bursts of 8, 0.9 s apart, then a pause; holds its front parcel while `canAccept()` is false).
Stub audio belt under the spout lip with slats every 12, `quanta()` = `{ phase, period: 0.42 }`, an end roller the
parcels tip off. Boot exposes `window.FACTORY` for drive.mjs.

## Known issues / open questions
- Parcels are drawn level on the 15° spout (their foot hides behind the low near wall).
- The phase offset between the release and the belt's read point is absorbed by the conveyor landing parcels on the
  next free cleat; if the assembly wants a parcel in a specific gap, add the belt's own fall time to `lead`.
- Spin-up to sync takes ~4 s; a whole cycle ~18 s.

## Out-of-scope findings
- `FACTORY.feed` calls `accept(port, item)` with no `from`; machines must default it.
- The page script is a module, so `FACTORY` is not global; drive.mjs `eval` needs `window.FACTORY = FACTORY` in boot.
- Belt B's end roller must stay out of the funnel lip (lip spans local y −35.2…−10.8, x ±12.2 at z 184–186).
