# QA review: crusher (parts/crusher/)

**Verdict: needs fixes (close).** At 1× it is a convincing double-roll crusher: skid base, housing, toothed rollers,
flywheel and V-belt down to a motor on a slotted slide base, a sliding bearing block on a tramp-relief spring, a
control cabinet with a dial, and a drawer bin on rails. The audit and the line checks are clean, and the build is fully
relative to `origin` (proved by a pixel comparison, below). The blockers are in motion. Every packet that falls in is
sliced by the hopper's back lip. The one lit accent, the lamp lens, does not light up. The flakes held back while the bin
empties come out as one clump. The pile pops in as a full slab.

## What passed
- `node build.mjs --audit` ends `audit passed` (105 solids, 4 tubes, 123 items, 471 order rules, 0.5 s).
- `lines.mjs` reports `line ends: 0` on `crusher-light.html` and `crusher.html`, and with `--reduced`.
- `drive.mjs ["lines"]` also reports 0 in six poses on both themes: fall, nip, crush, bin out, dump and roll back (`qa/lines-mid.json`).
- The console is clean in every run. There is no sideways scroll at 390 px, and the readout wraps under the hint.
- The readout comes from the model (`stats()`).
- **Origin acceptance.** `qa/origin-test.mjs` rebuilds the standalone page at `[60, −40, 0]` with the same relative framing. It also builds at `[60, −40, 12]`.
  - `qa/det.js` is a preload that makes the clock and `Math.random` deterministic and holds the page at a set frame. With it, the base page and the shifted page were shot at the same frames and compared pixel by pixel.
  - The static drawing matches to the pixel.
  - Live frames 1000, 1250, 1450, 1700 and 1900 (16.7–31.7 s) are pixel-identical. They cover the rollers, flywheel, pulley, lacing dots in the overlay group, spring, needle, glow, flakes, pile, and the full bin out/dump/back cycle.
  - Frames 150–300 differ by exactly one frame of timing. The cause is the standalone stub in `build.mjs`, not the crusher: `it.y >= y1` is tested on a sum of 1/3 steps that starts at an origin-dependent `y0`, so the packet crosses at frame 84 at y 176 and at frame 85 at y −40.
  - **No absolute coordinates found.** Reading the code agrees: every build helper goes through `W`/`plan`/`ox,oy,oz`, and LIVE takes everything from `D.origin` or world data.
  - The z = 12 build draws correctly. It fails only `support`, because the standalone floor is at z 0, which is expected.
- **Contract.**
  - `MACHINES.crusher` is registered.
  - `accept("in", item)` without `from` falls back to `D.drop`.
  - Every item name is `crusher.*`. Slots, `data-part`, `data-move`, `data-bin` and the gradient id all carry `api.id`, and the live lookups are scoped by id.
  - `ports.in` and `local` are in `ctx.data`.
  - `CSS` is exported, and the lamp colour is a token (`--cr-lamp`, with a dark override).

Captures are in `qa/`:
- `light.png`, `dark.png`, `phone.png`
- `reduced*.png` (0, +1.5 s, +3 s)
- `t*.png` and the montage `t-sheet.png` (1.9–3.4 s)
- slowed sheets: `sheet-crush.png` (0.1×), `sheet-fall.png` (0.05×, 3×), `sheet-bin.png` (0.1×), `sheet-release.png`, `sheet-drop.png`
- 4× zooms `z-*-light/dark.png` (hopper, spring, drive, ctl, bin), and the fall close-up `z-fall.png`
- line rings `lines-*.png`
- origin test: `origin-test.mjs`, `_build-*.mjs`, `origin-*.html`, `det.js`, `o-*.png`

## Issues (most severe first)

1. **The falling packet is sliced by the hopper's back lip, and its tail passes through the lip and the back wall.**
   - Where: `z-fall.png`, and `sheet-fall.png` frames 7–17, every 1.6 s.
   - Slot `crusher:item` sits at order index 86. `crusher.hopper.lip.back` is at 103, `hopper.front` at 97 and `hopper.right` at 99. So the lip paints across the middle of the packet while the packet is still at belt height, with its bottom (z ≈ 39.9) above the lip top (37.9). It reads as the packet being skewered.
   - The trajectory is also wrong. The trailing bottom edge crosses the lip (y −16.6) at about z 35.8 (f ≈ 0.63, plus the pitch), about 2 units inside the lip and through the inner face of the back wall. NOTES says this "reads fine". It does not at 1×.
   - Fix, part 1: add a slot `crusher:fall` with `{ after: crusher.hopper.lip.back }` and draw the packet there until its trailing face is past the lip (base y > −12.6 local). Then hand it to `crusher:item`.
   - Fix, part 2: hold z ≥ 38.2 until then. Either let it tip about the lip edge, or use a delayed drop such as `f' = max(0, (f − 0.55) / 0.45)` on z. Re-shoot `sheet-fall` at 0.05×.

2. **The lamp lens never lights; only a halo appears behind it** (`z-ctl-light.png`, `z-ctl-dark.png`).
   - `crusher:glow` sits *before* `lamp.lens`. In light the dome stays paper-white with orange behind it. In dark the lens is a **black** dome with a white outline inside a gold halo, so it reads as a lamp that is off.
   - The colour is themed through `--cr-lamp`, but the one lit accent should be the lens itself.
   - Fix: add a second slot `crusher:lens` `{ after: crusher.lamp.lens }`. Fill the dome silhouette with an amber gradient from `--cr-lamp`, opacity driven by `lamp.x`, with a pale core and a saturated rim (on the light theme, saturation, not dark ink). Keep the halo small and on surfaces.

3. **Flakes held during emptying come out as one clump of about 26 interpenetrating flakes, through a gate nobody can see** (`sheet-release.png`).
   - The feeder keeps running while the bin is out, so 3–4 packets are crushed. Their `pending` flakes all have `due` in the past and all start on the same frame once `bin.mode === "home"`.
   - Fix: when the bin returns, re-stagger the held flakes (`due = t + k * 0.085`) and spread their x.
   - Fix: draw the chute gate, a flap or slide at the lip that visibly closes in `full`/`out`/`dump`/`back` and opens after. The flakes rest against it, so the hold reads as a mechanism.

4. **The pile pops in as a full-floor slab, and flakes vanish when they land** (`sheet-drop.png`, frames 11→12).
   - The first flake to land takes `fill` to 1/70. `pileSvg` then draws a slab across the whole bin floor in one frame.
   - Each flake is removed the instant `p[2] <= zPile`, and chips appear at random spots, not where flakes landed.
   - Fix: fade the slab in (opacity `smooth(0, 0.8, h)`), or start with scattered chips only.
   - Fix: let a landed flake stay where it fell for about 0.3 s, flatten it and fade it into the pile. Ideally that spot becomes a chip.

5. **The fall ignores `from[0]`** (LIVE `drawItem`: `base = [X0, …]`).
   - Only `from[1]` and `from[2]` are used. In the assembly, belt C ending at an x other than −136 makes the packet jump sideways at the hand-off.
   - Fix: lerp x from `from[0]` to `X0` over the fall (and the tumble).

6. **The live layering depends on the settle order, which a bigger scene can interleave.**
   - Standalone order: `bin.wall.back` 77 < `bin.wall.left` 78 < `bin.mat` 79 < **`crusher:bin`** 80 < `chute.floor` 81 < **`crusher:flakes`** 82 < `bin.wall.right` 83 < `roller.back` 85 < **`crusher:item`** 86 < `chute.cheek.*` 87–88 < `bin.wall.front` 89 < `roller.front` 90 < `wall.front` 94 < `hopper.front` 97.
   - Risk: any item from another machine or the case that settles between `bin.mat` and the bin walls, or between `roller.back` and `roller.front`, paints over the pile or the packet.
   - Risk: a belt C item that settles after `roller.back`, with no screen overlap and so no rule, covers the packet at the start of its fall.
   - Risk: the `bin.mat` envelope (recorded about 6 tall, drawn 0.6) adds order rules against neighbours that nobody sees.
   - Risk: the lacing dots go into the shared `overlay` group, which paints over *everything*. In the case, the near lip (z ≈ 40) or anything in front of the drive would be overdrawn by belt dots.
   - Risk: the drawer travels +16 y (to y +56 local, past the grate at y 59), so the crusher's footprint at the +y end is about 60 local. Check that against the case's near wall.
   - Fix: export the needed relations (for example an `ORDER` list of `[a, b]` pairs) and assert them after `A.settle` in both `build.mjs` and the assembly.
   - Fix: move the lacing dots to a slot after the last V-belt chunk of the upper run (or after `crusher.flywheel`) instead of `overlay`.
   - Fix: record the real footprint of the drawer's travel in NOTES and BRIEF.

7. **The photo-eye emitter and receiver don't face each other.**
   - `eye.emitter` sits at y 0.4…3.6, z 32.6…35. The receiver `eye` sits at y 8.4…11.6, z 31…33.4. The beam would run diagonally, 8 units apart in y.
   - Fix: put both on one axis (for example y 10, z 32.2) and move the `ctl.eye` cable end to match.

8. **The V-belt is drawn in pale steel** (`ctx.material = ""` at the `vbelt` cable).
   - Round the black flywheel it reads as a white tyre or rim (`z-drive-light.png`).
   - Fix: draw the belt as rubber, with `fx-graphite` material around the `vbelt` cable (the lacing dots in `hi` still show on it).

9. **The lamp never goes out on the standalone page, so attack and decay are never seen.**
   - `seen` holds for 2.16 s per packet while the feed is every 1.6 s, so the lamp is on all the time once running. The drive barely drops back between packets.
   - Fix: drive the lamp from the eye, while a packet is in the hopper (age < TF + TT). Feed the standalone page every 2.4 s or so, so idle shows.

10. **The bearing block kicks back but the front roller doesn't move with it** (spring zoom).
    - The block and cap translate 0.9 units along +y. The roller, and its shaft in that block, stay put.
    - Fix: put `data-move="crusher:block"` on `crusher.roller.front` (and its teeth group) too. The move is small enough that the order holds; check with lines and sheets.

11. **Reduced-motion edge cases.**
    - The pile and the dial step per packet. That is acceptable as discrete state.
    - The bin wraps 90% → 0% and never shows full.
    - Switching to reduced while the drawer is out leaves it out for good, because the bin state machine is gated by `!calm`.
    - Fix: in calm, snap `bin.pos = 0` and `mode = "home"`, and show a 100% frame before the wrap, or cap at a representative fill.

12. **Flakes pass through one another on the chute** (`sheet-drop.png` frames 0–9, `sheet-release.png`).
    - The x spread (±6) is small, so faster flakes run through slower ones in the same lane.
    - Fix: give each flake a lane (x by index) or a speed per lane, and paint them sorted by y.

13. **Flakes fade in out in the open, below the housing wall.**
    - `CH.exit` is y 15.6, just in front of `wall.front` (y 13…15), so the 0.14 s fade-in shows as a ghost on the bare chute (`z-bin-light.png`).
    - `crusher:flakes` (82) is painted before `wall.front` (94).
    - Fix: start the flakes at y ≈ 12, under the wall, and drop the fade, so the wall hides their first appearance.

14. **Minor contract points.**
    - `accept()` ignores `port`.
    - Every packet calls `api.announce("crushing packet N")`, an aria-live message every 1.6 s. Across the whole factory that is screen-reader spam. Announce state changes only (bin full, emptied).

## Nice-to-have polish
- The inner faces of the hopper and the chute floor are large plain faces. Add wear liner plates with countersunk screws in the hopper, and two wear strips or a lip angle on the chute, so they are not one big slab.
- Show the bottom dump. While the drawer is out over the grate, let a few chips drop through the grate instead of the pile simply sinking.
- In dark, the `hi` outline on the graphite flywheel and rollers (`#e6e8ec`) is very bright. It competes with the lamp. Consider `mid` for the flywheel outline.
- The chip stroke `#2a2c31` is hard-coded (as in `factory.css`). Use a token if the palette is meant to be themable.
- Standalone stub: test distance travelled (`it.y - y0 >= len`) rather than absolute y, so the hand-off frame doesn't depend on the origin. The stub's packet is also painted under `stub.drum` (the `stub:top` slot is at 18, the drum at 38). That affects the standalone page only.
- NOTES says "z 0…36" in the BRIEF table and "z 0…38" in NOTES. Align them (the hopper lip top is 37.9).
