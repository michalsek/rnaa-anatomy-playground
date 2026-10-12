status: review

# conveyor (kind)

One module, `conveyor.mjs`: `build(ctx, origin, opts)` + `LIVE` (registers `MACHINES.conveyor`, one kind for both
variants; the instance picks its variant from its data). Standalone page: `build.mjs` → `conveyor.html` (+ `-light`):
a single-sided belt (like belt B) fed from a hopper drops parcels onto the audio belt; garbage leaves the audio belt
at its head drum onto a second single-sided belt (like belt C) that tips it into a bin.

## Everything is relative to `origin`

`origin = [x, y, z]`: the belt centreline at its first drum (s = 0), on the floor the legs stand on (`z`). `s` runs
along `axis` for `length` (drum centre to drum centre); `+c` is the near side (`+y` for axis x, `+x` for axis y).
`top` is the belt surface height above `origin[2]`. No option takes a world coordinate:

| opt | top | loop | default |
|---|---|---|---|
| `id`, `axis` ("x"/"y"), `dir` (±1, travel of the top run), `length` | yes | yes | |
| `top` (z of the belt surface above the origin) | ≥ 20 | ≥ 2·drum + 22.2 (hanging parcels clear the floor by 8; clamped with a console warning) | 60 / 92 |
| `width` | ≥ parcel lane + 4 (12 on x, 14 on y; clamped) | same | 16 / 18 |
| `drum` (outer radius) | – | ≥ 10; gearbox, torque arm, motor, hubs, pillow blocks follow it | 15 |
| `inAt` (distance along the belt from the origin) | yes | yes | 8 / 12 in from the tail |
| `outAt` (distance) | yes | – | the head drum |
| `readAt` (distance; read point and lamp) | – | yes | L/2 |
| `feedFrom` (offset `[dx, dy, dz]` from the origin, start of an `accept` without `from`) | yes | yes | 24 above `inAt` |
| `tip` | when `outAt` is at the head drum: the parcel slides round it and drops 16 below the belt before `out` | – | true |
| `speed`, `pitch` (slat spacing) | 14, 4 | 32, 3 | |
| `cleatEvery` (slats per cleat) | – | 6 | |
| `drop`, `autoSpend` | – | true, true | |

Brief layout, translated: `build(ctx, [-60, -118, 0], { id: "beltA", type: "top", axis: "x", dir: 1, length: 132, top: 232, inAt: 20, outAt: 132 })`,
`build(ctx, [-130, 74, 0], { id: "audio", type: "loop", axis: "x", dir: -1, length: 216, top: 92, drum: 15, inAt: 204, readAt: 100 })`
(drums at x −130 and 86; head = x −130).

## Ports (`ctx.data[id].ports`, world points)

- top: `in` (belt surface at inAt); `out`: with `tip`, 16 below the belt just past the head drum (where `out` is
  emitted, with `item.v`); otherwise on the belt at outAt (also with `item.v` = belt velocity).
- loop: `in` (top run at inAt); `drop` = the emission point: base of a parcel hanging under the head drum
  (for the audio belt x −130, z 47.8), emitted as `{...item, kind: "garbage", was, v}` with `v` the belt velocity
  there; `read` (lower run at readAt).

## Live API (`FACTORY.machines.<id>`)

- `accept("in", item, from)`: the fall starts at `from` (or `feedFrom`) with exactly `item.v` if given (all three
  components; then deleted) and bends in a quadratic to land on the target, which may be moving. While
  `prefers-reduced-motion` is set it refuses items (the feeder keeps firing) and draws a representative still once
  (three parcels on a top belt; every third cleat loaded on the loop, those past the read point grey).
- `items()` → `[{ id, kind, pos, run }]`: `pos` is where it is drawn this frame; `run` is `"air"` while falling
  onto or tipping off a belt, else `"top"`/`"bottom"`.
- `slatPhase()` (belt travel in slats), `geometry()` (a copy of the build data: axis, origin, dir, L, T, W, RW, zc,
  pitch, and on the loop `cleatGap`, `nCleats`, `total`, `PK`, `CH`, `HOOK`).
- loop: **`quanta()` → `{ phase, period, count, cleats }`. One cleat gap = one 128-frame render quantum.** `phase`
  goes 0 → 1 once per cleat gap and is 0 when a cleat is at the read point (readAt on the lower run); `period` is
  seconds per quantum (`cleatGap / speed`, 0.57 s on the standalone page); `count` counts quanta read so far;
  `cleats: [{ pos, run }]` are the cleat bases this frame. The scanner and centrifuge sync to `phase`.
- loop: `spend(id)` (grey a parcel now; `autoSpend: false` leaves it to the scanner), `stats()` →
  `{ riding, hanging, dropped, spent }`. A full belt refuses a parcel with a console warning.
- Readout on the standalone page is live: quanta read, quanta per second, parcels on top / hanging / dropped.

## Slots (painter's order)

top: `:slats`, `:top` after `<id>.belt`; `:wrapSlats0` after `.wrap0`; `:wrapSlats1`, `:end1` after `.wrap1` (a parcel
within 6 of the front drum is drawn after it; the near guide bar stops 12 short of that drum so nothing switches
layer under it). loop: `:wrap0` BEFORE `.wrap0`, `:wrap1` after `.wrap1`, `:bottom` BEFORE `.belt.bottom`,
`:bottomSlats` after `.belt.bottom`. Wraps and drum cores are half-cylinder prisms split at the drum's centre plane.

## Parts

Shared: top run, lower run, two half-drum wraps, two half-cores, four flanges (bolt circle + rim ring on the near
ones), four hubs, moving slats (lines) and cleats (loop). Top: side channels with lips, carrying idlers visible
between belt edge and rail, return idlers, axle nuts, pillow blocks + caps, gearbox (seam, cover with bolt circle,
breather), ribbed motor with fan cowl vents and terminal box, guide bars on arms and posts (posts evenly to each bar
end, none skipped), legs, feet with anchor screws, cross braces, near stretcher, label plate, lit run lamp (lens in a
bezel on a steel plate by the idle drum). Loop: truss stringers (chords, end plates with rivet rows — the tail one
runs 19 in to carry the whole take-up — riveted verticals), carrying idlers + axle stubs, return rollers under the
lower run's edges on hangers from the bottom chords, pillow blocks, take-up (rails, sliding block, bracket, rod, split
coil spring hooked at both ends, nut), shaft-mounted gear motor at the head (shaft, gearbox, cover, breather, torque
arm to the bottom chord) with the motor running inward along the belt, legs, feet, cross beams kept below the
hanging parcels, label plate, and the one lit accent: the read lamp at readAt on the near bottom chord.

Parcels look the same everywhere: on drums they are oriented boxes with the same tape band (its height follows the
parcel's normal so it never jumps) and strap; a released parcel's bail stays on the cleat and folds back over 0.3 s.

## Verification

- `node build.mjs --audit` → `audit passed` (340 items).
- Line ends 0: `lines.mjs` light at 20 s, dark at 21.5 s; `drive.mjs ["lines"]` at 3, 7.5, 13.5, 21.5, 30.5 s all 0
  (the take-up spring float is fixed).
- A parametric page (scratch, not shipped): top belt y/dir −1/top 70/width 14 on a 20-high plinth (origin z 20),
  top belt x/top 36/width 18 on the plinth, loop y/dir +1/drum 12/top 60, loop x/dir −1/drum 15/top 60 — audit
  passed, line ends 0.
- Sheets read: hand-off B → audio, round the head drum (tape continuous), garbage release (bail folds, parcel falls
  onto belt C), the bin, reduced-motion still, dark, 390 px.

## Known issues / notes for the assembly

- Recommend belt C at the audio belt's head x (−130 in the brief layout, not −136): garbage leaves at the head
  x; any offset is absorbed by the fall but starts the parcel over belt C's near guide bar.
- Receivers built by other parts start their fall at rest unless they read `item.v`.
- `drum` overhang: flanges are `drum + 2.2`; the drive (gearbox + motor) sits on the near side out to about
  `width/2 + 4.6 + 4.2 + 0.53·drum` and runs `0.43·drum + max(16, 1.6·drum)` inward from the head along the belt.
- The demo hopper is a closed box parcels appear from (demo furniture only).
