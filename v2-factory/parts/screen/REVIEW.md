# QA review: screen + speaker (parts/screen/)

**Verdict: needs fixes.** At 1× it reads as a real object: a phone in a machined gantry with a speaker hung beside it. The gantry feet, clamp blocks, X-brace, phone glass and speaker cabinet hold up at 4×. The blockers are in motion and assembly. In the factory the dispenser leaves no room for the drop onto belt A. The falling bead goes behind the surface it lands on and then pops sideways. Reduced motion is not still. The light-theme LED meter can't be read.

## What passed
- `node build.mjs --audit`: `audit passed` (126 solids, 125 items, 366 order rules, 1.1 s).
- `lines.mjs` reports `line ends: 0` on screen-light.html and screen.html, and at 4 mid-motion moments run with drive.mjs (1.6 / 2.5 / 4.2 / 6.5 s).
- Console clean in every run. No sideways scroll at 390 px, and the readout wraps under the hint.
- Contract: `MACHINES.screen` and `MACHINES.speaker` are registered. Ports are in `ctx.data` (`screen.ports.fluff`, `speaker.ports.in`). Fluff is emitted with a world point `[x, y, drop]`, and the speaker `accept`s `"in"`. Moving things live in slots. Every item name, slot, `data-part`, gradient id and clip id carries the instance id. The live code looks elements up with `api.el('[data-part="' + api.id + '-…"]')`, so lookups are scoped and nothing collides. The catch tray is drawn only with `opts.tray`.

Captures are in `qa/`: light, dark, phone, reduced (+1.5 s, 3 s), timed t-*.png (0–9.6 s, sheet `t-sheet-top.png`), `sheet-drop.png`, `sheet-packet.png`, `sheet-packet-full.png` (slowed 0.1×), 4× zooms `z-*.png`, and line rings `lines-*.png`.

## Issues (most severe first)

1. **Nothing visibly falls in the assembly, and the landing bead overlaps the nozzle** (screen.mjs: `NOZZLE_TIP = VB.z0 - 5` = 234, `drop` default 232, falling bead pushed at `z: D.nozzle[2] - BEAD*2` = 229.4).
   - The bead starts *below* the landing height, so the first tick after its 0.32 s delay emits it and removes it before it is ever drawn.
   - Belt A then holds a bead at z 232…236.6 directly under a nozzle whose tip is at 234, so the two overlap.
   - The valve body (bottom at 239) and the nozzle leave about 2 units above belt A's top. Any belt rail at y ≈ −127 runs into them.
   - The BRIEF puts the port at z 252, which gives about 20 units of fall.
   - Fix: raise the dispenser stack, or shorten it, so the nozzle tip sits at ≥ 250 (or agree a lower belt A). Start the bead at the tip. Add a guard: when start ≤ drop, emit with a short visible drop rather than instantly.

2. **The falling bead goes behind its landing surface, then pops sideways** (`screen:fall` slot sits `after: screen.nozzle`; pile position is `nozzle ± rand(4)`, `± rand(3)`).
   - In `sheet-drop.png`, frames 19–21, the bead disappears behind the tray floor and front wall. In frame 22 it reappears in the pile, up to 4 units to the side.
   - In the assembly the same slot makes belt A (y −118, in front of the nozzle at y −126) paint over the bead as it lands.
   - Fix: pick the landing point before the fall and drop along it. Put the last part of the fall in a slot after the landing surface (after `tray.wall.front` standalone; for the assembly, hand the item to belt A mid-air via `from` or expose `opts.fallAfter`). Add a small damped settle on landing.

3. **Reduced motion is not still** (screen LIVE `calm` branches, speaker LIVE).
   - Under `--reduced` the beads still jump from glass to lane to tray, the tray pile and counters grow, and the rotor snaps (`reduced*.png`, readout 3 → 5 dropped).
   - The speaker packet still animates its rise: `rise`/`up` have no `calm` gate.
   - The LED bar still jumps.
   - The BRIEF says "reduced motion goes still", and as built every step jumps instead.
   - Fix: when `api.calm()`, render one representative frame (a few queued beads, one packet in the window, the meter at about 3 LEDs) and stop scheduling bursts and swallows.

4. **The LED meter can't be read in the light theme** (speaker.mjs `meter`, LED fill `var(--anatomy-shade-0)` off, `--pk-audio-top` on).
   - The meter plate is brushed steel, so off LEDs are pale on pale and vanish. At rest the meter reads as a blank white strip (`z-speaker.png`).
   - Lit LEDs are pale mint on near-white (`sheet-packet-full.png`, frames 18–31).
   - Dark looks fine.
   - Fix: make it a dark window (`fx-graphite` on the meter, or a dark inset). Draw off LEDs as dim dark segments and lit ones in `--pk-audio-face` with a `lo` edge, keeping the top LED amber.

5. **The nozzle reads as a dark crescent, and the bead appears out of thin air below it** (card ≈ 300,575; `z-valve.png`, `z-tray-late.png`, `sheet-drop` frames 0–2).
   - Only about 2 units of the 5-unit spout show under the valve body.
   - The bead fades in (alpha 0→1 over 0.06 s) as a ghost below the tip.
   - Fix: lengthen the nozzle to 8–10 units with a flared or knurled tip. Spawn the bead inside it (a slot before the nozzle, so the spout hides it) and drop the fade.

6. **The trough has no visible support** (card ≈ 268–467, 525–625; `z-trough.png`, `z-brace-top.png`).
   - The 122-unit trough is held only by face contact with the front of the cradle channel (y −137), with no bracket or fastener. At 4× it reads as cantilevered from nothing.
   - Fix: extend the three `cradle.rib` gussets (x −56, 0, 56) forward under the trough to y −116, or add 2–3 hanger straps with screws.

7. **The BRIEF scene table was not updated.** It still lists:
   - the speaker at x −130…−84, y −152…−118, z 430…490, with `in` at [−107, −135, 430];
   - fluff out at [−40, −128, 252].

   The actual values are a cabinet at x −134…−94, y −148…−116, z 446…500, a receiver at z 430…446, `in` at [−108, −121, 430], and a nozzle at [−40, −126, 234]. The BRIEF asks for changes to be written into the table, not only into NOTES.md.

8. **The speaker only works at the screen's origin.** speaker.mjs imports `GANTRY` and places its shelf, gusset and plate against a gantry assumed to be at the speaker's own origin. Placed at any other origin than the screen, it hangs in the air. Fix: write the mount points into `ctx.data.screen` (e.g. `mounts: { shelf, plate }`) and have the speaker read them (or take `opts.gantry`). At least throw if no screen is built first.

9. **The lit accent doesn't read** (`speaker.cone` / `speaker.cap`; `z-speaker-cone.png`, `z-speaker-dark.png`).
   - In light the cone is a pale grey-white disc, hard to tell from the basket. In dark it is a dark disc with a white rim.
   - The React logo and the beads take the eye.
   - The kick is a 2.6-unit translate of a flat disc along +y, which on screen reads as the disc sliding diagonally rather than pumping.
   - Fix: check the `--anatomy-lit-*` tokens so the cone gets a saturated lit body. Animate the dust cap's translate further than the cone (or scale the corrugation rings by ±3–4 %), so it reads as excursion.

10. **The tone hierarchy is inverted at the jaws.**
    - The jaws, jaw screws, side buttons, nozzle and valve glass are `hi`, with the heaviest and darkest outlines (in dark, the brightest).
    - The subject's band is `mid` and the glass `lo`.
    - At 4× the jaws out-shout the phone (`z-jaws-right.png`).
    - Fix: jaws `mid`, phone band `hi`.

11. **The gate bead sinks into the floor, not into the bore** (card ≈ 300,550). During the `gate` phase the bead drops 3.4 units while fading, drawn over the trough floor and front wall instead of clipped by the throat. Fix: clip the gate-phase bead to the throat ellipse (or a clip path in the floor plane).

12. **Tray pile beads interpenetrate** (standalone). They all sit at the same z, pushed in arrival order with no depth sort, so a back bead can paint over a front one. Fix: sort by x + y and stack (z += r for overlaps), or keep a small grid of positions.

13. **The tray post merges with the left column at 1×** (card ≈ 287–309, 630–890). The post (x −40, y −126) projects straight in front of the column (x −82, y −158), so the tray reads as a bracket on the column. Standalone only. Fix: give the post an anchor-bolted base like the columns, and/or shift the tray (and the standalone drop point) clear of the column on screen.

14. **The jaw thumb screws push on nothing.** The knurled screws point +y out of the front lip in front of the glass. A side jaw would tighten along ±x from the outer face. Fix: move the screw to the jaw bar's outer x face, axis ±x.

15. **The JS-side parts don't use `fx-react`.** The BRIEF asks for `ctx.material = "fx-react"` on JS-side parts. The dispenser (trough, valve, nozzle) is plain steel. Either tint the dispenser `fx-react` so the JS side is colour-coded consistently across the factory, or note in NOTES.md why not.

16. **Possible duplicate clip id.** In planes.mjs `recessY`, the default id `scr-clip-${clips++}` counter restarts for every `planes(ctx)` call. Two machines that omit `id` would both emit `scr-clip-0`. Every current call passes an id, so this is not live yet. Fix: prefix by a required id, or keep a module-level counter.

## Nice to have
- **Lower half.** Below the trough, about 45 % of the figure is bare columns and two flat bars. Run a power/data cable from the phone's bottom edge down the left column in clamps to a small junction box on the floor. It has a job and fills the run. A ladder rung set or a column nameplate would also fit.
- **Where beads leave the glass.** Beads fade in on the glass over the home bar. A thin exit slot or lip in the cradle front, where the drip emerges, would make "calls leave the screen" physical.
- **Landing.** A tiny damped hop when a bead lands (tray or belt).
- **Tray post foot.** Give it washers and nuts like the column feet.
- **LED meter.** Add a peak-hold LED that falls slowly.
- **Head beam.** Cable glands or a junction box where the phone's cable would run up.
