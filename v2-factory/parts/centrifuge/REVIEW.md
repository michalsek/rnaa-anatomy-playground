# Centrifuge: QA review

Reviewer pass on `centrifuge.mjs` / `build.mjs` as of NOTES `status: review`. No source edited; `node build.mjs --audit`
regenerated `centrifuge.html` / `centrifuge-light.html`. Every artefact is in `qa/`.

## Verdict

**Changes requested. Not done yet.** The contract work is solid. It builds relative to origin (two instances on one
page work independently), the hooks are there, names and selectors are scoped, the CSS is exported, the audit passes
and line ends are 0 in every pose. Occlusion of packets against the hub, posts, ring and funnel is right at every rotor
angle I filmed. Three things keep it from shipping as the hall's centrepiece:
- two turned parts render as hulls (one shows a ghost ellipse),
- the release, which is the one event the machine exists to show, reads wrong and happens out of sight,
- reduced motion and the readout break the Anatomy truth and stillness rules.

## Checks run

| Check | Result |
|---|---|
| `node build.mjs --audit` | `audit passed` (5 tubes, 145 solids, 193 items) |
| `lines.mjs` light / dark / reduced | `line ends: 0` each |
| `drive.mjs ["lines"]` while filling, spinning up, in sync (releasing), spinning down, both themes | 0 in all 8 |
| Console | clean on every run |
| 390 px | fits, no sideways scroll, readout clear of the hint (`qa/phone.png`) |
| Origin test (`qa/origin-test.mjs`: instances `cfA` at [−140, 230, 0] and `cfB` at [60, 40, 0]) | Static and live parts move together. Pockets, strobe, needle, lamp and pulleys register. `from` = origin + (−26, 8, 96). Gradient ids `cfA-void` / `cfB-void`. 10 slots each. **But the audit fails crowding at that scale (issue 6).** |
| Names / selectors | every item is `centrifuge.*`; no `document.*` / global queries; slots via `api.slot` |
| Full cycle (`qa/t-*.png`, `qa/cycle-sheet.png`, status log) | fill 4.2→8.7 s, spin-up →12.7 s, in sync →26.7 s, down →27.7 s; first release about 1.3 s after sync; steady state about 3 held (Little's law, correct) |

## Issues (most severe first)

1. **The hub is drawn as a cone, and the bearing housing shows a ghost ellipse (stepped profiles hulled).**
   - Where: `turned(N("hub"), …)` with profile `[12 → 7.5]` step at z 129; `turned(N("bearing"), …)` with step
     `6.6 → 5.6` at 166.4.
   - What: under the strobe disc the hub's outline runs straight from the collar rim (r 12) up to the column top. It
     reads as a flared skirt, the r 7.5 column never shows, and a pale ellipse floats inside it (`qa/z8-hub-light.png`,
     `qa/z-rotor-*.png`). On the bearing housing the full r 5.6 step ring is drawn through the finned body, so its back
     half crosses the fins: the "ellipse across a post" fault, in both themes (`qa/z8-bearing-light.png`,
     `qa/z-spider-dark.png`).
   - Fix: build each as two items (collar disc + column; base collar + finned body), so each outline is a true
     cylinder and settle orders them. Or force `fill: "surface"` if the kit's lathe takes it through `turned()`.
     Re-shoot both at 8×.

2. **The release reads as a packet sinking into a solid rotating floor, then vanishing.**
   - Where: `drawRotor` `releasing` loop; the gate at 162.9°; `ports.out` at local (−26, 8, 96).
   - What: the released packet stays at the fixed gate angle and shrinks from the top into the carousel. Meanwhile the
     rotor keeps turning, so a vane sweeps through the sinking packet (`qa/sheet-release.png` frames 24–43,
     `qa/sheet-rotor-sync.png` frames 12–19). There is no opening, trapdoor or chute. The packet is then invisible for
     about 0.38 s (z 125 → 96) and comes out under the bowl, where the port is hidden behind the bowl and legs. On
     screen the drain step is the least legible event in the machine, and it sits at the back-left behind a post and
     the ring.
   - Fix:
     - Let the falling packet ride its pocket: angle = gate + ω·age while it drops.
     - Draw a real gate. Either open-bottom pockets over a fixed deck with a slot at the gate (a visible dark
       `circleOf`/slot void), or a hinged flap the crank opens.
     - Add a flanged discharge chute below the base flange at the gate. Ideally it exits the bowl's footprint and
       slides the packet out to the left onto the belt, so the hand-off is in view, with `ports.out` at its mouth.
     - If the belt layout pins the port under the bowl, at least draw the packet in a slot that passes through the
       chute's open front.

3. **Reduced motion is not still, and its readout contradicts the drawing.**
   - Where: `tick` with `calm`; `drawFalling`; the intake loop.
   - What: under `--reduced` the rotor stands still, but packets still arc into the funnel, fall from the spout
     (GRAV-timed) and sink at the gate (`qa/sheet-reduced.png` frames 2–4, 8–10). The readout says
     `14.3 rpm · in sync` beside a stationary rotor (`qa/reduced-8000.png`).
   - Fix: when `calm`, place items instantly: intake → pocket, pocket → emit, with no arcs or falls. Report rpm 0 (or
     a phrase such as "ring passing packets") so the words match the picture.

4. **The readout mixes the model's phase word with the lagging tach needle.**
   - Where: `status()` returns `tachRpm`, which comes from the 0.35 s needle spring.
   - What: the status log shows `idle · 9.6 rpm` straight after spin-down, and `filling · 7.9 rpm` peaks.
     `phase = "idle"` while a packet is already queued in the funnel (2.7–3.7 s). The verify checklist says words and
     numbers come from the same instant.
   - Fix:
     - `status().rpm` = `w · 60 / τ` (the true rotor speed); keep the needle spring for the drawing only.
     - Say `filling` once `queue.length + intake.length > 0`.

5. **Queued packets disappear, with no limit and no backpressure.**
   - Where: the `intake` → `queue` hand-over in `tick`; `status().queued`.
   - What: after the intake sink a packet waits inside the funnel undrawn. In the origin test (feed 0.7 s) `queued`
     reached 6 while the ring was full and spinning up. Six 10×8×7 parcels "inside" an r 7 spout is not believable,
     and belt B will keep pouring in.
   - Fix: show the head of the queue as a parcel resting in the funnel throat (cut at the mouth plane, like the
     intake), and stack at most 1–2. Expose `canAccept()` / a `full` flag in `status()`, so belt B can hold its last
     parcel at the roller (backpressure) instead of handing over more.

6. **Crowding fails at the assembly's scale.**
   - Where: coolant pad at −24° against the bowl rib at 345°.
   - What: the standalone page (KS 2.88) passes. At KS 2.08 (the two-instance test page) the audit reports
     `cfA.coolant start × cfA.bowl-rib (rod) outlines 0.76 apart px`, for both instances. The factory hall will be
     drawn smaller still.
   - Fix: move the rib off 345° (for example to 330°), or the coolant pad to about −30°. Re-run the audit on a page
     at the assembly's KS (≈ 1.5–2) before handing over.

7. **Released packets don't land in a slat gap except by coincidence.**
   - Where: a release is triggered on the pulse (`Math.floor(S)` increments, which per NOTES means a gap is under the
     port), but `emit` comes 0.38 s later and the receiver adds its own drop.
   - What: at the 0.42 s stub period that is about 0.9 slat late, so it looks almost right. At any other belt rate (the
     assembly's audio belt) the landing is off-gap.
   - Fix: lead the release by the fall time (trigger when `phase ≥ 1 − fall/slatPeriod`). Or emit with the slat index
     it is meant for, and document that the belt should place it in the next gap.

8. **The bearing housing looks like a second motor.**
   - Where: `bearing` (graphite, 28 vertical fins) next to `motor` (graphite, 36 fins), both under identical white
     pulleys.
   - What: at 1× the top reads as two motors belted together (`qa/light.png`, `qa/z-drive-*.png`).
   - Fix: make the shaft's housing a turned steel pillow block or a bearing cartridge: stepped bright collars, a bolt
     flange to the spider, a grease nipple where the oil line lands, no fins. Keep graphite plus fins for the motor
     only.

9. **The gate crank is behind the bowl silhouette.**
   - Where: `CRANK_DEG = 150` (the silhouette is at 135°).
   - What: only the lever tip pokes past the outline, and the boss shows as a dark sliver (`qa/z-crank-light.png`). The
     kick that confirms each release is effectively invisible.
   - Fix: move the crank (and pad) to about 115–125°, between the drain valve and the lamp. Or tie it to the new gate
     or chute from issue 2 so it sits beside the hand-off.

10. **The motor has no supply cable.**
    - Where: `cabinet-gland` (bottom of the drive cabinet) and the motor's `gland` on the terminal box.
    - What: two cable glands, no cable. A real drive cabinet feeds the motor; as drawn, the cabinet has no job.
    - Fix: one r 0.6 cable from the cabinet gland, up beside a leg and a cage post in clamped steps, round the ring to
      the terminal box gland (`ctx.cable` with `shells`), routed along structure per `craft.md` §8 "Harness routing".

## Nice-to-have polish

- **Bowl curve.** No staircase anywhere (smooth at 4× in both themes). But the bowl is a 17-high straight drum, and its
  2.5 fillet hides under the base flange, so "bowl" never reads. A dished bottom or a slight barrel (an analytic
  r(s) with `slope`) would sell the turned-vessel finish.
- **V-belt.** Light theme draws it as a pale white string (`lo` tone, r 0.6). Make it graphite and about 1.0 thick so
  it reads as rubber in a groove.
- **Lamp rhythm.** It flashes on every slat (2.4 Hz) for the whole sync phase: busy for a calm figure. Keep the steady
  glow plus a flash only on actual releases, or halve the pulse amplitude.
- **Index moves.** Each landing triggers a quick 36° move peaking near sync speed (τ 0.15 s). τ 0.22–0.25 would read
  calmer at 1×.
- **Cooler.** It rests only on its end caps (body 0.4 above the shelf). Add two saddle cradles with screws.
- **White `data` packets** on the white carousel are low contrast in light theme. A slightly darker carousel top (`mid`
  rather than `hi`) or a faint shadow under parcels would help.
- **Mid-air pop on test pages.** `accept()` without `from` pops the parcel into existence 10 behind and 8 above the
  mouth. Fine for the assembly (belt B passes `from`); on the test page, fade it in, or default to a point on the lip.
- **Stub belt (standalone page only).** The fade-out leaves a translucent ghost parcel hanging past the bed end
  (`qa/t-14000.png`). End the bed with a roller and drop the parcel off it, or clip it at the bed end.
- **Hand-off note for the assembly.** The released parcel is hidden under the bowl from z 125 to the belt. Whatever
  issue 2's fix ends up being, the audio belt's NOTES should state where it first draws the parcel.

## Craft judgement (Anatomy checklist)

- **Centrepiece.** Yes by size and density: about 85 parts, turned bowl, two flanges with bolt circles, ribbed body,
  cage, belt drive, funnel, instruments, coolant loop, cabinet. It is the largest single machine in the brief.
- **Reactor-grade finish.** Mostly. Smooth funnel flare, saddle pads under every curved-wall fitting, flanged coolant
  lines with clean bends, fin rows ending on seams, faded bolt circles. It is held back by issues 1 and 8 and by the
  plain drum bowl.
- **One lit accent.** Yes. `lamp-lens` is the only `data-lit` item; the green glow is tokenised (`--cf-glow*`) with a
  dark variant. The strobe's black/white sectors pull the eye harder than the lamp; consider `faint`-er sectors.
- **Calm motion.** Mostly calm: springs everywhere, eased lamp and needle, no pops in the slowed sheets. The exceptions
  are the release (issue 2) and reduced motion (issue 3).
- **Colour tokens.** Every machine colour is a CSS custom property, light and dark, exported as `CSS`. No hard-coded
  colours in the drawing.

## Artefacts (`qa/`)

| Group | Files |
|---|---|
| Full card | `light.png`, `dark.png`, `phone.png`, `reduced*.png` |
| Timed cycle | `t-2000…22000.png`, `cycle-sheet.png` |
| Line ends | `lines-*.png` |
| Slowed sheets | `sheet-drop.png` (funnel intake), `sheet-drop8.png` (spout exit 6×), `sheet-release.png` (gate, 0.05×), `sheet-rotor-front.png` / `sheet-rotor-sync.png` (occlusion), `sheet-reduced.png` |
| 4× zooms, both themes | `z-funnel`, `z-drive`, `z-spider`, `z-ring`, `z-rotor`, `z-bowlL`, `z-bowlR`, `z-instr`, `z-crank`, `z-cool`, `z-isol`, `z-feet`, `z-cab` |
| 8× zooms | `z8-hub`, `z8-bearing`, `z8-motor` |
| Origin test | `origin-test.mjs`, `origin*.html`, `origin-sync.png` |
| Drive scripts | `*.json` |
