# packer: QA review

**Verdict: needs fixes.** At a glance it reads as a real packaging cell. The deck, legs, two articulated arms, the
lane with coloured cartons and the photo-eye gutter all make sense, and the contract (origin, ids, slots, ports,
`from`, readout) holds. The audit and the line check pass. But the drawing and the motion have real faults:

- The two arms run through each other every cycle.
- The picker drags its beads through the gutter.
- Seven turned parts, including the biggest masses in the picture, are drawn as hulled, see-through cones.
- Both flap pops the builder admits are confirmed, and there is a third jump at the push-off.
- Reduced motion isn't still.

## What was run (evidence in `qa/`)

| Check | Result |
|---|---|
| `node build.mjs --audit` | `audit passed` (119 items, 112 solids, 4 tubes, 0.5 s). It covers static parts only: the arms, cartons and pad are live and never audited. |
| `lines.mjs` light / dark / reduced | `line ends: 0` in all three (`lines-light.png`, `lines-dark.png`). |
| `drive.mjs ["lines"]` every ~130 ms for 9 s (pick, erect, fold, tape, push), both themes | 0 every frame (`lines-cycle.json`). The checker counts 44 lines throughout: the `.pk` tape and band lines aren't counted (see polish 8). |
| Full light, dark, 390 px, reduced, timed | `light.png`, `dark.png`, `phone.png` (no sideways scroll), `reduced*.png`, `timed-*.png`. Console clean everywhere. |
| Slowed sheets | Whole cycle: `cycle-0…6.png` (0.1×). Arm clash: `arms-clash.png` plus 6× `arms-clash-a/b/d.png`. Picker over the gutter: `gutter-carry.png`, `gutter-return.png`. Fold → closed: `fold-switch2.png`. Erect / flaps spring: `erect-flaps2.png`. Push-off: `push-off.png`, `push-drop.png`. |
| 4× zooms, light and dark | `z-picker-*` (head and cups), `z-gutter-*`, `z-lane-*` (cartons), `z-folder-*` (link and drag chain), `z-magazine-*`, `z-magpush-*`, `z-deck-*` (T-slots), `z-cabinet-*`, `z-hoses-*`, `z-legs-*`, `z-belts-*`, `z-pedestal-light.png`, `z-shelf-light.png`, `tape-light-a/b.png` (tape head, also dark) |
| Headless simulation | `qa/sim.mjs` runs the page's `LIVE` in node and records every arm pose and carton state per tick. `qa/clash.mjs` and `qa/clash3.mjs` sample the live arm volumes against the static solids, the cartons and each other. |
| Origin test | `qa/origin-test.mjs` → `qa/origin-test.html` (+ light), `origin-test.png`: two packers, `pkA` at ANCHOR and `pkB` at ANCHOR + [75, 95, 40], in one scene. |

Contract items that passed:

- **Relative to origin.** On the test page both packers run on their own. Arms sit on their own pedestals, beads land in their own gutter, and cartons ride their own lane. After 9 s the readout was `A 12/1 · B 11/1`.
  - `pkB` emitted at [175, 0.5, 240] = origin + [0, 23.5, 200], exactly as `pkA` did.
  - `line ends: 0` there too.
  - No absolute world coordinates in `build` or `LIVE`: everything goes through `w()` or `D.*`.
- **`ports` / `portsLocal`.** `in` [−28, 0, 232] and `out` [0, 26, 196] local; world = origin + local.
- **`from` convention.** It is the packet's bottom-centre (carton floor z = lane z 200), as `packetSvg(kind, p)` expects. The NOTES record it. Propose it to the BRIEF as the shared convention.
- **Names and slots.** All 93 items per instance carry the id prefix (`pkA.` / `pkB.`), and the slots are `${id}:gutter|stack|lane|picker|folder`.
- **Scoped selectors.** `LIVE` touches only `api.slot()`, with no document queries. Colours are tokens (`var(--fx-react)`, `fx-graphite`, `.pk[data-kind]`), with no hard-coded hex.
- **Readout counts are true.** `beads` is beads accepted, `packets` is packets emitted. Checked against the simulation: 22 / 6 at 20 s.

## Issues (most severe first)

1. **The picker's vacuum head runs through the folder's elbow every cycle.**
   - *Where:* the picker lowers into S1 (`waitS1`, `lower`, `release`, `PLACE` = lane x, S1). Meanwhile the folder is in `toStart` / `tape` at S2. Its base at plan (123, −121) reaches S2 diagonally across S1, so its elbow stands at ≈ (105.3, −112, 224.6), right over S1.
   - *What:* the cup bar (x ±6.6 along world x) and the right cup pass through the folder's elbow servo, its far elbow cap and the end of link 1. This happens for ≈ 0.6 s every cycle, from 1.2 to 2.0 s after each emit (`clash3.mjs`: bar × elbowCapFar up to 56 samples inside, bar × link1 up to 30, cups × link1). The picker slot always paints before the folder slot, so the head simply vanishes into the elbow. At 6× (`arms-clash-a/d.png`) the bar's outline runs on inside the elbow, and the third cup and bead come out from under it.
   - *Fix:* do both.
     - Move the folder base onto the +x side level with S2, e.g. local (21, 18), so its arm plane never crosses S1. This also clears the S0 view (issue 8).
     - Interlock the two arms: the picker may leave `waitS1` only while `folder.free`, or the folder holds at `FHOVER` until `picker.clearOfLane`.
     - Re-run `clash3.mjs` until it is empty.
2. **Seven turned parts are drawn as hulled, translucent cones.**
   - *Where:* every stepped profile passed to `ctx.turned`:
     - `picker.pedestal` and `folder.pedestal`
     - both `lane.column`s
     - `gutter.post`
     - both `bridge.post`s
     - `pump`, `pusher.body` and `bridge.cyl`
     - The suction-cup bellows in `pickerTool` have the same fault.
   - *What:* `lathe`'s `fill: "auto"` falls back to the hull whenever a profile has a radial step face. I checked each profile with `G.solidOf`: all of them come out hulled.
     - The pedestals are drawn as a pale tapered sleeve from the r 5.4 foot to the r 5 top flange, with the r 2.4 column and its collar ring showing through as if behind glass (`z-pedestal-light.png`).
     - The bridge posts read as tapered cones from the r 2.2 foot to the r 1.1 top.
     - The cups read as ghostly bells with a swirl inside.
     - The paper fill also hides whatever lies behind the hull.
     - The audit records the true profile (`A.solid(F, profile)`), so it can't see this.
     - These are the biggest masses in the picture, which is the "wireframe / see-through" anti-pattern.
   - *Fix:* build each stepped body from straight segments, one `turned` per step (foot flange, column, collar, column, top flange), with the column between flanges as its own item. Each segment then hulls correctly and sorts on its own. For the cups, drop the face-on step `[2.85k, 0.8] → [2.85k, 0.95]` so the bellows is one smooth run, or use `fill: "surface"`. That needs `shared/kit.mjs` `ctx.turned` to forward `fill` (out-of-scope change: flag it to the kit owner).
3. **The carried beads and cups sweep through the gutter's near wall and stop.**
   - *Where:* `stepPicker`, the `carry` hop `PICK → PHOVER` (about 0.6–0.75 s after grip) and the `return` hop `PLACE → PHOME`.
   - *What:* the gutter's stop end (plan x 95…95.8, y −121.6…−114.4, z 226.6…231.6) hangs over the back-left corner of the S1 carton. With the bar along x, the left cup sits at lane x − 5 = 95 when the head is over S1.
     - During `carry` the cups pass z 224–232 while their y reaches −115.4, so the hanging beads (r 2–2.4) cut through `gutter.near` and `gutter.stop` by ≈ 1.4 (`gutter-carry.png`, frames 6–17; `clash.mjs` lists cup × gutter.stop, near and floor).
     - On `return` the empty cups and bar rise diagonally through the same corner.
   - *Fix:* end the gutter at plan x ≤ 92 (local −8: move the pockets 3 back), or move S1's drop point. Then split the hops into lift → traverse → lower, with the traverse at a cup-bottom height ≥ gutter top + bead diameter + 0.5.
4. **Erect pop: the flaps spring open in about two frames, through the pad.**
   - *Where:* `stepErector` `up`, and the `closedSvg` branch in `cartonParts`.
   - *What:* there are three jumps.
     - At the first `up` frame the carton switches from the rounded `closedSvg` slab (r 0.6, no flaps) to the sharp `cartonSvg` with flap seams (`erect-flaps2.png`, frame 5 → 6).
     - Then `1 − e^{−5f}·cos(4.2f)` over T(0.42) starts at full speed: the flaps reach 40° in the first 1/60 s and 90° in ≈ 70 ms. That is a snap, not a spring.
     - The erector pad has risen only 0.6–1.0 by then, and flaps 1–3 sweep through the r 2.6 pad disc while they pass 26–58° (checked in the simulation at 1/240 s).
   - *Fix:*
     - Draw the erecting carton with `cartonSvg` (flaps at 0) for the whole `lift` phase, so there is no swap.
     - Drive the flaps with a damped spring that starts at rest (ω ≈ 10–14 rad/s, ζ ≈ 0.7, ~0.35 s to settle).
     - Start the flaps only once the pad is higher than the major flap (pad bottom > top + 4).
5. **Fold pop: folded flaps snap to a closed slab, and the head cuts through them.**
   - *Where:* end of `stepFolder` `major` (`cc.stage = "closed"`), and `R.closedSvg`.
   - *What:*
     - The open-construction carton (r 0 corners, the seam between the major flaps, minor flaps showing through the gap) becomes the rounded `slabOf(…, r 0.6, bevel 0.3)` in one frame. The corners round off, the outline moves and the seam vanishes (`fold-switch2.png`, frame 25 → 26).
     - While the major flaps close, their tips pass up to TOP + 3.1 within the block's ±1.5 in y, but the folder block's bottom is at TOP + 2.6, its fingers at TOP + 1.4 and its roller at ≈ TOP + 1. The flaps pass through the head. Only the block painting over them hides it.
   - *Fix:*
     - Make the closed state geometrically identical to the folded flaps: r 0 walls, flaps at 0 with the centre seam drawn as the line the tape will cover. Switch to the rounded `packetSvg` look only under the band fade-in after taping (that switch is already designed to match).
     - Hold the head at TOP + 5 while the flaps pass 60°, then press down.
6. **Push-off hand-off: a velocity jump, and the packet drops through the lane nose.**
   - *Where:* `stepBeam` `push` emits as soon as `c.y ≥ emitY` (plan −94.5), mid-stroke.
   - *What:*
     - At that moment the packet moves at 38.4 u/s (measured). The receiver restarts it from about 8 u/s (the stub; the real conveyor's `conveyorFall` restarts from rest), which is a visible stop (`push-off.png`, frame 25).
     - Its back edge is still 3.2 over the bed (back −98.5, nose −95.3), so during the 0.37 s fall to z 192 it sinks through the bed nose: the back edge stays inside y < −95.3 down to z 196.
     - The real belt B's parabola to y −92 would only move it 2.5 forward, so the clip remains in the assembly.
   - *Fix:* emit at the end of the stroke (shift = pitch), where y = −91, the back edge clears the nose by 0.3 and the velocity is 0. Update `from` in NOTES to origin + [0, 27, 200].
7. **Reduced motion isn't still.**
   - *Where:* `T()` and the fly time return 1e-4 under `api.calm()`, but `tick` keeps running and beads keep arriving.
   - *What:* every 0.9 s the gutter, cartons and packets teleport to the next state, and the readout keeps counting (`reduced-1500/3000.png` differ: `beads 5 · packets 1` → `beads 7 · packets 2`). The conveyor part freezes with `dt = 0` under calm, so the packer is inconsistent with its siblings and with the BRIEF ("reduced motion goes still").
   - *Fix:* under `api.calm()`, draw one settled frame (the prefill pose) and then return early from `tick`. Also ignore or queue `accept`, as the conveyor does.
8. **The S0 station, magazine stack, pusher and taping are hidden.**
   - *Where:* the folder pedestal at plan (123, −121) and its link 1 stand in front of S0 on screen. The bridge beam crosses it, and the pusher, manifold valves and air hoses sit behind the folder turret and the cabinet.
   - *What:*
     - Erection, the pusher stroke, and the coloured blank stack that shows the round-robin `control → graph → data` are almost invisible: `z-magpush-light.png` shows only a sliver of the stack, and `erect-flaps*.png` is mostly folder arm.
     - The tape strap is drawn under the tool block, so taping reads only as the head sliding (`tape-light-a/b.png`).
     - The air hoses hug the folder turret's silhouette on screen and read as coming out of it (`z-hoses-light.png`).
   - *Fix:*
     - The folder move in issue 1 opens most of this up.
     - Turn the magazine so a slot or window in its +x/+y face shows the stack's colours.
     - Let the tape head run on the far side of the strap, or lift the block a little, so the growing strap shows.
9. **There is no lit accent you can see in light.**
   - *Where:* `pickerTool`, the bar `{ tone: "hi", lit: true }`.
   - *What:* in the light theme `lit` means a white top with a black edge, which is how every other `hi` part on this white machine looks (`z-picker-light.png`). In dark it is slightly visible. The eye is caught only by the beads, the cartons and the photo-eye LEDs.
   - *Fix:* make the vacuum head the accent in a way that reads on paper. For example, put the cup bar or vacuum generator in `fx-react` material, or add a React-blue vacuum lamp on the head that lights while gripping.
10. **The stand is crushed in the standalone page and spindly in the assembly.**
    - *What:*
      - With `floor: 150` the shelf, air receiver and pump are squeezed into a 15-unit gap and can't be read (`z-shelf-light.png`; the NOTES admit this).
      - At full height (`origin-test.png`) the four 3.6-thick legs run 176 units with only one ring of stringers at 30% height. 120 units of bare leg read as flimsy for a machine carrying two robots.
    - *Fix:* add a second stringer ring just under the deck and diagonal knee braces, or a closed base frame, and put the shelf at mid height. For the standalone page, choose a floor that leaves the shelf readable (≈ 120).

## Nice-to-have polish

1. **Drag chains** read as 4–5 square teeth on the link (`z-folder-light.png`). They need:
   - a finer pitch;
   - a visible carrier strip;
   - the cable entering and leaving at the end brackets;
   - a tone alternation that shows in light (`lo` and `mid` both look pale there).
2. **Beads shrink** from 2.4 to 2.0 during carry and to 1.6 in the carton. It is eased, but they read as changing size. Keep one radius and make the carton fit three beads (or two layers).
3. **The photo-eyes** are tiny tabs on the far wall top. A small emitter/receiver pair across the gutter (near-lip side too), with the LED on the receiver, would explain "sensor".
4. **The control cabinet** is a plain black box; its door and hinges are behind the folder pedestal. Add louvres or a status lamp on the visible +x face.
5. **Readout:** consider adding the kind being packed (`beads 7 · packets 2 · next graph`). The three prefilled beads are never counted (cosmetic).
6. **Stub issues** (standalone page only):
   - A packet dropping off belt B into the tote paints behind the end drum (`reduced-3000.png`).
   - Packets land centred at y ≈ −93, overhanging the stub belt's tail drum at −91.
7. **No halo** under the feet or the deck.
8. **Line-check blind spot:** the mid-motion `lines` check never counts the `.pk` tape strap or band (44 lines in every pose). Their ends were checked by eye only, and they sit under the head or on the outline.
