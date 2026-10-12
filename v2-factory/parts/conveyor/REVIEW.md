# conveyor: QA review

**Verdict: needs fixes.** It reads as a real conveyor at a glance. The hand-off from belt B to the audio belt and the
hanging run are convincing, and the painter's order on the drums and under the lower run held in every sheet. Five things
still need work before it is done. The loop breaks the audit as soon as its height or drum size moves off the standalone
values. Port opts use absolute world coordinates. There are two visible pops in motion. There is no lit accent you can see.

## What was run (all evidence in `qa/`)

| Check | Result |
|---|---|
| `node build.mjs --audit` | `audit passed` (304 items, 3.4 s) |
| `lines.mjs conveyor-light.html` / `conveyor.html` (at rest) | `line ends: 0` both themes (`lines-light.png`, `lines-dark.png`) |
| `drive.mjs … ["lines"]` at 3, 7.5, 13.5, 21.5, 30.5 s | 0 · **1** · 0 · **1** · 0. The float at 7.5 s and 21.5 s is `audio.takeup.springFront` (issue 9) |
| Full light, dark, 390 px, reduced, timed 4–20 s | `full-light.png`, `full-dark.png`, `phone-390.png`, `reduced.png`, `timed-*.png`. No sideways scroll, console clean |
| Slowed sheets | parcel dropping onto belt B `sheet-drop-beltB.png`; hand-off B → audio `sheet-handoff.png`; round the head drum `sheet-headdrum.png`; garbage leaving at the head `sheet-garbage-drop.png`; back up round the tail drum `sheet-taildrum.png`; belt C tip `sheet-beltC-bin.png`; into the bin `sheet-bin.png` |
| 4× / 6× / 8× zooms | `z4-*` (light), `z4d-*` (dark), `z6-taildrum-*`, `z8-lamp-*` |
| Parametric test page | `qa/param-test.mjs` → `qa/param.html` (+ light). Throwaway, not in `build.mjs`: a top belt along +y with dir −1, top 70, width 14; a top belt along +x, top 36, width 18; a loop along +y with dir +1, drum 12, width 16. Sheets `param-sheet-ty-tip.png`, `param-sheet-ly-head.png` |

Contract items that passed:
- Every item name carries its instance prefix (audio 106, beltB 99, beltC 86, demo 13; on the test page ly/tx/ty).
- Slots are `${id}:…`.
- The live code only touches `api.slot()`, so its selectors are scoped.
- `FACTORY.machines.audio` has `items()`, `slatPhase()` and `geometry()`, plus `spend()` and `stats()`.
- Top-level live names (`CONVEYOR`, `CONVEYOR_G`, `conveyorFall`, `conveyorFallAt`, `conveyorTop`, `conveyorLoop`) are scoped to the module (`<script type="module">`), carry the part's prefix, and clash with no other part's LIVE.
- No hard-coded colours: everything goes through tone tokens.
- On the test page both top belts are correct: drive and motor sit at the right end for either dir, the far-end tip is hidden behind its drum, and `lines` reads 0. The loop along +y with dir +1 orders correctly round the near head drum.

## Issues (most severe first)

1. **The loop isn't parametric in `top` or `drum`: the audit fails off the standalone geometry.**
   - On the test page with drum 12, `ly.gearbox × ly.torqueArm` is sunk 1.8 deep, as are `ly.gearbox × ly.torqueArm.drop` and `torqueArm × torqueArm.drop`.
   - `torqueArm.drop` becomes an inverted box: its z0 of `zBot1 − 0.4` sits above its z1 of `zc − 8`. Any drum below about 14 fails.
   - With drum 15 and top 60, `ly.belt.bottom × ly.beam` is sunk 0.6, and there are two depth-order cycles (`beam#2`, `beam#4`). The cause is the cross beams at a fixed `z = 30`, which is where the lower run sits (`conveyor.mjs:349`).
   - With top below about 45, hanging parcels go through the floor (lower run `T − 2·RW`, then hook 6, then parcel 7).
   - Fix: hang the beams off `zBot0`, e.g. `[8, Math.min(30, zc − RW − 8)]`, and drop the upper beam when there's no room. Size the gearbox and torque arm from `RW` rather than constants (`:330`, `:334–335`). Assert, or clamp with a console warning, `top ≥ 2·RW + BT + HOOK + PK.h + margin`.
2. **Absolute world coordinates in opts break "placed by translation only".**
   - `inAt`, `outAt`, `readAt` and `feedFrom` are absolute world coordinates (`:215–216`, `:362–363`, build `feedFrom`). Moving a belt means rewriting all of them, or its ports drift.
   - Legs and feet start at absolute z 0 and `origin[2]` is ignored.
   - Fix: take the opts as distances along s from the origin (or keep the absolute names but add relative `inS`, `outS`, `readS`), make `feedFrom` relative, and treat `origin[2]` as floor level. Update NOTES and the brief's examples to match.
3. **Painter's-order pop at the head of every top belt.**
   - Within 6 of the near drum a parcel switches to `:end1` (`end: it.s > D.L − 6`, `:580`). The near guide bar runs to `L − 2` and is drawn before `end1`.
   - So for its last 4–6 units the parcel jumps from behind the near guide bar to over it (`sheet-beltC-bin.png`, frames 7 → 8). Belt B does the same.
   - Fix: end the near guide bar at `L − 6`, add a post there, and leave the drum end open. Alternatively, switch slots on the parcel's rear edge (`s − half > L − 2`).
4. **Parcels change look where they enter and leave a drum.**
   - On the top run and lower run a parcel is drawn with `packetSvg` (tape band and strap line). On a drum it is drawn with `packetObb`, a plain box (`:462`, `:645–656`).
   - So the tape vanishes the moment a parcel goes onto a drum and reappears when it hangs (`sheet-headdrum.png` 9 → 10, `sheet-garbage-drop.png` 16 → 17).
   - When a parcel drops (`:706–712`) its two bail straps vanish in one frame, and the parcel turns back into a taped box on belt C.
   - Fix: give `packetObb` the same seam band at `0.55·h` and the top strap along `t`. Keep drawing the empty bail on the cleat after release and let it relax back to flat over about 0.3 s.
5. **The audio belt's motor and torque arm point away from the belt, beyond the head drum.**
   - `inward` is defined from the tail, but the head uses `sHead + inward·…` (`:334–336`), whose comment says "toward the middle". Toward the middle at the head is `−inward`.
   - Result: the 24-long motor overhangs the head by about 30. In the brief layout it reaches x ≈ −161, next to the full-height −x wall of the case. It also pushes the hanger arm and the motor out to where the assembly will put belt C, the crusher and the case wall.
   - Fix: use `−inward` for the motor and torque arm (re-check that the torque arm still lands on the bottom chord, which ends at `−sEnd`). If the overhang is intended, fix the comment and tell the assembly the true footprint.
6. **No readable lit accent.**
   - The three run lamps are r 0.8 domes on graphite terminal boxes. In graphite, `lit` means a slightly lighter grey top with a white rim, so the lamp reads as a grey push button (`z8-lamp-light.png`, `z8-lamp-dark.png`). At 1× it can't be seen.
   - Fix: give the audio belt one real accent, e.g. a lens of r ≈ 1.6 in a bezel on a small steel plate (not graphite) on the head end plate, or light the read station at `readAt`. The top belts can keep a small lamp, or none.
7. **Reduced motion: items pile up forever.**
   - `FACTORY.feed` keeps firing and `accept()` still adds items while `tick` uses `dt = 0`.
   - Belt B went from 2 to 11 parcels in 15 s, all stacked inside the hopper and rebuilt into `innerHTML` every frame (`:533`, `:680`, build `:100`).
   - The reduced still is also an empty set of belts.
   - Fix: don't feed when `FACTORY.still.matches` (the boot or the runtime should own this). In `tick`, draw once and then return while calm. Ideally seed a few parcels at fixed spots on the top run and lower run so the still tells the story.
8. **Demo bin: parcels vanish behind the bin's back walls.**
   - `bin:items` sits after `demo.bin.floor`, so before the back walls (`build.mjs:50`), even though the comment says otherwise.
   - A parcel that lands is painted over by the back walls: only a sliver above the back rim shows (`sheet-bin.png` frame 17), and after "6 out" the bin still looks empty (`z4-bin-later.png`).
   - Fix: put the slot after `demo.bin.wallBack` and `wallLeft`, before the front and right walls. Lower the walls to about 9 so the pile reads.
9. **Take-up: a coil end floats, and the bracket hangs over an open bay.**
   - The front coil of `audio.takeup.springFront` ends on the open face of the bracket. It is rooted only when a bottom slat happens to pass behind it, so the line check fails mid-motion (1.2 px at card 564.6,366.4, at 7.5 s and 21.5 s). NOTES says 0 at every moment.
   - The bracket at `L − 16…18` and the rails reach 9 past the end plate (which ends at `L − 9`) into a bay with no vertical (`z4-tail-drum-spring.png`).
   - Fix: end the coil on a spring-seat washer, or draw the bracket after the front coil. Lengthen that end plate to about `L − 19`, or add a vertical under the bracket.
10. **The near guide bar is cantilevered at the drive end.**
    - The post near the gearbox is skipped (`:180`) rather than moved, so the bar hangs about 27 units unsupported (belt B 80.5 → 108, belt C 58.7 → 88; see `z4-beltC-drive.png`).
    - Fix: put that post at `sDrive − dir·6`, clear of the gearbox.
11. **The audio belt's return run has no support across 216 units.**
    - There are no return rollers, and the lower run hangs below the bottom chord while carrying parcels.
    - Fix: add edge return rollers outside the strap lanes (c ≈ 6…9) on brackets off the bottom chords, every 50–60 units.
12. **Assembly clash in the brief's layout (worth a NOTES line).**
    - The brief puts belt C at x −136, but garbage drops at x −130. A parcel 10 across therefore starts its fall over belt C's near guide bar (x −128.8…−127.8) and is pulled 6 sideways while it falls.
    - The NOTES assembly note checks only z. Recommend belt C at x −130 in the assembly.
13. **API accuracy.**
    - `items()` reports a falling item at its landing target: on top belts at `inS` with z = T, on the loop at its claimed cleat (`:586`, `:732`). Report the real position, plus a `phase: "fall"` or `run: "air"`.
    - `geometry()` returns the live data object; return a frozen copy.
    - `drop` emits `v: [0,0,0]`, but the belt surface moves at 32 along −dir·s at the drum bottom. Pass that velocity so receivers continue it.
    - `conveyorFall` uses only `v[2]`. The horizontal part is an ease-out whose starting speed is 2·dx/dur (about 36 u/s against 14 coming in at B → audio). Either honour the horizontal v or reword NOTES ("continues the fall").
    - `ports.drop` (z 62) and the emission point (z ≈ 47.8) differ. NOTES documents this, but the assembly should place receivers from the emission point.
14. **`window.FACTORY`.** `build.mjs:90` sets it, and the shared `runtime.js` now does `window.FACTORY = api` itself (someone else changed it at 19:46). So the boot line is redundant, and the global now leaks on every page, the assembly included. That is a runtime decision rather than the conveyor's fault: drop the boot line, and decide centrally whether the assembly exposes it. (The runtime's new `api.els()` and `api.el()` query the whole SVG, not the machine. The conveyor doesn't use them.)
15. **Smaller robustness points.**
    - A top belt shorter than about 28 makes NaN geometry for the label plate (`labelPlate` uses `idlers[1] − idlers[0]`, `:207`): verified at L 24.
    - `build` sets `ctx.material = ""` at the end instead of restoring the caller's value.
    - `void i` is left over at `:141`.
    - The demo uses the instance id `bin` for its slot but names its items `demo.bin.*`.
    - A loop narrower than about 12 puts the bail straps outside the belt, and an axis-y top belt narrower than about 12 puts parcels into the guides. Clamp `width`, or derive the parcel lanes from it.

## Nice-to-have polish

- Top belts: the tipping parcel slides down the drum perfectly level, then drops flat. Tilt it by the drum slope with `obbSvg` during `tip` (and on belt C into the bin).
- The audio belt parcel rides centred on top of a 1.6-wide cleat ridge, floating 1.2 above the belt. Seat it on the belt just ahead of the cleat, so the cleat pushes it.
- The audio belt's near flanges (r 17.2, 2.2 beyond the wrap) and end plates read as large blank discs and slabs at 1×. Add a weld ring or lagging seam to the drum face, lightening holes or spokes to the flanges (or a smaller overhang), and rivet rows to the end plates.
- The readout's "10.7 slats/s" is a constant. Show a live quantum count from `slatPhase()` instead.
- The demo hopper is a closed box that parcels come out of. Give it an open top rim and a discharge throat.
- Dark theme: the graphite motor's `hi` outline is a heavy white rim along its top. Consider `mid` for the motor body edge.
- The 390 px layout is fine (the readout wraps under the hint).

## Note for the orchestrator

While checking top-level LIVE names I imported every `parts/*/*.mjs`. Importing each part's `build.mjs` runs it, so the
standalone pages of centrifuge, crusher, packer, packets, scanner and screen (and conveyor) were rebuilt from their
current sources at 20:03–20:04. All six load with a clean console. No source file was touched. The conveyor pages now
also carry the newer shared runtime (`window.FACTORY` set in `runtime.js`, `api.els`). The drawing is otherwise unchanged
(the audit was re-run identical earlier). The `qa/` captures before that moment came from the 19:39 build.
