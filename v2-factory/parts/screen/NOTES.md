status: review

# phone + speaker (parts/screen/) — rebuilt for the pivot (factory inside the phone)

## Modules
- `phone.mjs` — kind `phone` (`MACHINES.phone`): `build(ctx, origin, opts)` draws the case, the floating display and
  the fluff dispenser under it. Also exports `buildTray(ctx, origin, opts)` + `MACHINES.catchTray` (standalone catch
  tray, receives falling items) and `CASE` (defaults).
- `speaker.mjs` — kind `speaker` (`MACHINES.speaker`): bare driver on a stand. Independent of the phone (QA #8).
- `planes.mjs` — local helpers (not in shared/): prisms along any axis (`prism`, `prismPaths`, `seamOf`),
  `planeMatrix`, `recess(face "x" | "y", …, { id })` (id now required, so clip ids are always instance-scoped, QA #16).
- `build.mjs` → `screen.html` / `screen-light.html`: a smaller case (w 200, d 380, depth 160, display at 330) so the
  machines read at card size; dispenser at [84, 130] dropping into a catch tray (post on the case floor, top z 64);
  speaker at [−30, −70, 0] (height 92) fed by `FACTORY.feed("speaker", "in", 1.6, …audio)`.
- No extra CSS: colours are inline (`--fx-react`, `--pk-audio-*`, `--pk-graph-top`) or kit/factory materials.
- The old `screen.mjs` (upright phone + gantry) is gone.

## phone — opts, geometry, ports (all relative to origin = centre of the case floor, z 0 = factory floor)
| opt | default | |
|---|---|---|
| `id` | "phone" | |
| `w`, `d`, `r` | 280, 540, 40 | outer plan of the case (x across, y along; the phone's top is the −y end) |
| `depth` | 280 | wall height (far walls) |
| `cut` | 40 | height of the near lip (+x side, +y end) |
| `t`, `back` | 6, 8 | wall thickness; back plate z −8…0 |
| `displayZ` | depth + 220 | underside of the display (OLED back); glass top = displayZ + 5 |
| `dispenser` | [−40, −118] | [dx, dy] of the dispenser under the display |
| `neck` | 16 | drop-pipe length between display and sight tube |
| `rails` | true | two mounting rails on each far wall's inner face (z 0.42·depth and 0.78·depth, 2.4 deep) |
- Case: back plate inside the band; band split into corner halves and ≤110-long side runs (depth-sortable). Far walls
  full height with seams at the cut height and near the top; near walls cut to the lip. +x lip: action + volume
  buttons, SIM tray; +y lip: USB-C recess, grilles, two screws. Floor (all ≤ 0.4 thick, or small and near the walls):
  vapour-chamber plate (−y end), battery plate (middle), label plate, 6 standoffs, 4 screw bosses.
- `ctx.data.phone.interior` = { x0, x1, y0, y1, floor, top, lip } for placing machines; `display` = { z, top }.
- Display: OLED (fx-graphite) + glass with the animated screen drawn on the glass top (k.topMatrix): logo glow,
  slow turn, status bar, island, home indicator, tap ripple. Scales with `w`.
- Dispenser (fx-react, QA #15): plate on the OLED back → drop pipe → collar → glass sight tube (queued beads visible,
  clipped to the tube window) → collar → star-valve body (sight glass with live rotor, gear motor) → knurled nozzle.
- **Port `fluff`** = origin + [dx, dy, displayZ − 67] (nozzle tip). Bursts of 2–3 beads every 2.6–3.6 s (tap
  ripple on the logo) drop into the sight tube; the valve releases one every 0.9–1.25 s. A bead is drawn inside the
  nozzle (the spout hides it) and is emitted **the moment it clears the tip**: `emit("fluff", item, [x, y, zBottom])`
  with `item.v = [0, 0, −v]` (≈ 150 units/s). The receiver draws the fall (QA #1/#2).
- Getters: `FACTORY.machines.phone.queued / .sent`.
- Slots: `phone:tube` (clipped to the sight tube), `phone:spout` (before the nozzle), `phone:rotor`.

## speaker — opts, geometry, ports (origin = centre of the stand's base plate, underside)
- `opts.height` (default 64) = baffle top. Footprint ±46 (base plate), throat + ledge reach x +64.
  Driver: back plate / magnet / top plate (bottom at height − 41.4), stamped dish, four arms (45°, 135°, 225°, 315°)
  with open windows, spider, former, mounting ring (r 27–32.5, four screw slots) on an open baffle (ring plate in
  quarters + four tabs to the posts), rubber roll surround (closed tube), mint cone (shallow, so its whole inside
  shows; lit rim) and mint dust cap (lit outline) — the lit accent reads in both themes (QA #9). Terminal block with
  two tabs and two wires down to a plug on the base. Throat on +x with a recessed mouth and a feed ledge; 6 level
  LEDs + peak hold in a dark window on the throat top (QA #4).
- **Port `in`** = origin + [64, 0, height − 15] (outer end of the ledge). `accept("in", item, from)`: from `from`
  (or fading in on the ledge) the packet moves to the ledge in 0.3 s, slides into the throat (drawn through the
  mouth clip plus its still-outside part), fades through the flap at the back; at 1.0 s the cone pumps along +z
  (damped 4.6 Hz impulse, 2.4 units; the cap moves 1.35×) and the meter jumps.
- Getters: `FACTORY.machines.speaker.heard / .level`. Slot: `speaker:packet`.

## Reduced motion (QA #3)
Phone: one still frame (three beads waiting in the tube, logo unturned, no ripple), no bursts, nothing emitted.
Speaker: a packet half in the throat, meter at 3 LEDs, cone at rest; `accept` ignores items. Tray: three beads.

## Verification (last run)
- `node build.mjs --audit` → audit passed (112 solids, 3 tubes, 545 order rules).
- `lines.mjs` light + dark → line ends: 0; mid-motion via drive.mjs at 1.5 / 2.4 / 3.7 s → 0. Console clean.
- Read: light, dark, reduced, 4× zooms (dispenser, speaker over a packet's slide-in, cut corner), timed sheets.

## Known issues / for the coordinator
- **Shared floor overlap.** `scene()` records the shop floor at z −1…0, but the case's back plate is z −8…0. To pass
  the audit the back plate is recorded from −8 to −1 (grounded) and the band walls from z 0 up; both are drawn in
  full. If shared/kit stops recording its floor under a case, record them in full.
- **The display is recorded as grounded** (it is held by the exploded view, not by anything below it).
- **Dispenser visibility.** Anything hanging under the display is hidden by it unless it is near the display's near
  (+x or +y) edge: a point Δz below the display shows only if (x + 1.22Δz, y + 1.22Δz) falls outside the plan.
  The default [−40, −118] (belt A's plan position) is hidden in a 280×540 case; the assembly should put belt A's
  intake under a dispenser near the +x edge (e.g. dx = w/2 − 16), or lengthen `neck`.
- The speaker's elevator hand-over must reach the ledge end at origin + [64, 0, height − 15].
- QA #5–#7, #10–#14 referred to the old trough/gantry/jaws, which no longer exist; the BRIEF table rows for
  `phone` and `speaker` are updated.
