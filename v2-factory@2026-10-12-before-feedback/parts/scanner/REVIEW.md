# QA review: scanner + elevator

Reviewed 2026-10-12 against BRIEF.md (with the in-phone pivot), NOTES.md, verify.md and craft.md sections 1, 2 and 8.
Evidence is in `qa/`. The relocation and real-belt test pages are throwaways built by `qa/relocate.mjs` and are not part of the build.

## Verdict

**Changes required. Do not mark this part done yet.**

The standalone page is clean: audit passed, 0 line ends on both themes and mid-motion, console clean, reduced motion
still. The elevator works as the vertical hero, and both builds move correctly when placed at another origin. Two
problems block the assembly:
- it fails against the real audio belt: the API does not match, and the scanner collides with the belt when placed as
  the plan says;
- the elevator has two visible pops: feed packets vanish, and packets blink out at the launch point.

## Checks run

| Check | Result |
|---|---|
| `node build.mjs --audit` | `audit passed` (281 items, 296 solids, 1 tube) |
| `lines.mjs` light / dark / reduced | `line ends: 0` (164 ends, 85 lines) |
| `drive.mjs ["lines"]` at 3.1 s, 4.8 s and slowed, both themes | `line ends: 0` |
| Console | clean on every page and run |
| 390 px | no sideways scroll; the hint touches the card's right border (issue 11) |
| Reduced motion | still: two shots 2 s apart are byte-identical, `quanta read 0` |
| Relocation (scanner at [30,−20,0], elevator lift 180 / outDir "-x" / reach 16 at [−47,−124,0]) | every static and live part moves with its origin; elevator audit clean at that origin (`qa/relocate-cleats.png`, `relocate-z-arm.png`, `relocate-z-head.png`) |
| Relocation with origin z = 12 | **fails**: the live hub, nut, coil, beam and slider stay at absolute z (issue 5, `qa/relocate-z12-arm.png`) |
| Real audio belt (`parts/conveyor` loop), brief placement (belt [−130,74,0] L 216; scanner [−30,36,0]) | **audit failed: 6 problems** (issue 2) |
| Ports | match NOTES: scanner out [−77,+8,24], read [0,+31,92]; elevator in [0,+39,24], out −y [0,−49,234], −x [−5−r,−33,24+lift], +x [5+r,−33,24+lift], reach < 12 → [0,−33,24+lift] (but see issue 10) |
| Names / slots | every item and slot carries its id prefix (scanner 77, elevator 176, stubs separate) |
| Selectors | one global `document.querySelectorAll` (issue 9) |

## Issues (most severe first)

### 1. The scanner does not work with the real audio belt API: read storm or jitter, and the elevator backlog grows without limit
**Where:** `scanner.mjs` lines 171–181 (`slats()`) and 287 (`pitch`).
**What:** `parts/conveyor` exposes `slatPhase()` = `travel / pitch`. That is a running slat count that grows without
bound; it is not a 0..1 phase. The belt also has no `pitch` property; the pitch lives in `geometry().pitch` and is 3.
With the real belt, the scanner falls back to `pitch = 12` and its six fallback slats run off toward −∞, so every frame
counts as a read.

Measured on `qa/relocate-none-light.html`:
- **≈ 54 reads/s** (one per frame);
- **15 packets/s** into an elevator that can lift **0.81/s**.

Adding `slats()` at the belt's true pitch of 3 (`qa/relocate-slats-light.html`) still gives:
- 10.6 reads/s and 2.6 packets/s;
- the 0.16 s seek never completes (a slat arrives every 94 ms), so the head jitters in a 3-unit sawtooth;
- the flex and cable stay solid mint instead of showing separate pulses (`qa/sheet-relocate-slats-arm.png`);
- the elevator's `waiting` queue grows without limit and is never drawn.

**Fix: read cleats, not slats.** One cleat is every `cleatEvery` = 6 slats, and the true cleat gap is loop length ÷ cleat
count = 18.27. This gives 1.8 reads/s and 0.45 packets/s, and the head tracks a cleat, seeks back and dwells
(`qa/sheet-relocate-cleats-arm.png`). Put this exact adapter in the assembly boot right after the belt is defined, or
move it into the scanner and read `geometry()` directly:
```js
FACTORY.define("audio", MACHINES.conveyor);
{
  const belt = FACTORY.machines.audio, g = belt.geometry();
  const sTail = g.dir > 0 ? 0 : g.L;                       // top run: s = sTail + dir·u (conveyor CONVEYOR.path)
  const loop = 2 * g.L + 2 * Math.PI * g.RW;
  const n = Math.floor(loop / (g.pitch * g.cleatEvery)), gap = loop / n;   // = conveyor's nCleats / cleatGap
  belt.pitch = gap;
  belt.slats = () => {                                      // world x of the cleats on the top run
    const travel = belt.slatPhase() * g.pitch, out = [];
    for (let i = 0; i < n; i++) {
      const u = (((i * gap + travel) % loop) + loop) % loop;
      if (u < g.L) out.push(g.origin[0] + sTail + g.dir * u);
    }
    return out;
  };
}
```
**Words:** one read is then one cleat, not one 128-frame quantum. Pick one of these:
- update the caption and hint, for example "one read per cleat · four per packet";
- set `PER_PACKET` so the numbers stay true.

Either way, keep packets/s under about 0.8 or add a visible queue in the boot. The scanner also assumes `axis: "x"` and
`dir: −1`; it never reads on a +x belt. Assert this, or handle both directions.

### 2. In the planned placement the scanner collides with the real audio belt
**Where:** `scanner.mjs` lines 85–87 (park ramp) and 99–119 (preamp). Reproduce with `PLACE=brief node qa/relocate.mjs slats 0 --audit`.
**What:** the head has to sit over the real belt's far margin. The belt is 18 wide, so its far edge is at y 65, which
puts the scanner origin at y ≈ 36. In that placement the audit reports:
- `sunk audio.chordTopF × scanner.ramp.post 1.60 deep`, plus a depth-order cycle. The far truss top chord is at
  y 60.4–62, z 86.4–90; the ramp post is at local y +22…+26, z 85–96.
- `sunk audio.legF × scanner.preamp.box 2.00 deep` and `… × scanner.preamp.lid 1.20 deep`, plus two cycles. The belt's
  far leg at s = 24 (x −106, y 60–62.4) stands inside the preamp (local x −86…−68, y +12…+26).

The stub belt hid both problems: it is 26 wide, has no truss and has different legs. NOTES' "no guard above z 93" is
true, but the structure *below* z 93 is in the way.

**Fix:**
- **Ramp:** move the post to local y ≤ +23 (for example +19…+23, z 85–96). Run the tongue as a cantilever bar at
  z 94.2–96 from the post to +31.5. It clears the chord top (z 90) by 4.
- **Preamp:** shift it −4 in local y (box +8…+22, fins to +23.8). Move the cable riser from +24 to +20, and move the lip
  and the out port by the same amount (out → [−77, +4, 24]); update NOTES. Alternatively, record in NOTES that the belt
  needs no leg within local x −90…−64, y ≥ +20, although conveyor legs sit at fixed s.

Re-run the brief-placement audit until it is clean.

### 3. Feed packets are never drawn: packets vanish at the end of belt D
**Where:** `elevator.mjs` line 451.
**What:** `packetPart(..., D.feed.z, { w: 10, yMin: D.feed.face })` leaves `zMin` at its default `D.zLow` (z 42, the
boot top). The chute is at z 24–31, so every feed packet is clipped to nothing and `elevator:feed` always has 0
children. On screen a packet reaches the end of belt D and disappears, then appears 0.5 s later rising out of the boot
slot on a cradle. The slide down the in-feed chute never shows (`qa/sheet-feed.png`, frames 7→8 and 16→17).
**Fix:** pass `zMin: -1e9` (or `D.feed.z`) in that call. Then check with a slowed sheet that the packet is cut at the
feed face as intended.

### 4. A packet blinks out at the head for 2 units, then jumps to its flight start
**Where:** `elevator.mjs` lines 398–401 and 435–436.
**What:** a packet is drawn on its cradle only while `u < Lf`. From `Lf` to `Lf + LAUNCH` (2 units ≈ 67 ms), the cradle
is drawn by `wrapCradle` with no packet, but `c.item` is still set. The flight then starts from a separate point,
`[XC, yf + 5.9, zb + Lf + 3.2]`, so the packet reappears offset up and back. This shows in every slowed sheet
(`qa/sheet-fling2.png` frames 28→37, `sheet-fling3.png` 15→18).
**Fix:** use one of these:
- launch at `u = Lf` (`LAUNCH = 0`) and start the flight from the packet's exact pose on the cradle;
- draw the packet on the wrap cradle, rotated with it, until launch, and start the flight from that pose.

### 5. Live arm parts ignore origin z
**Where:** `scanner.mjs` LIVE lines 196–209.
**What:** the coil ring (z 91, height 5.5), coil inner line (96.5), beam (95.0), slider (93.6), hub (94), nut (96.5)
and nut dot (98) use absolute z. Only the E-block and fork use `D.armZ`. With origin z = 12 the hub, coil and slider sit
12 below the arm (`qa/relocate-z12-arm.png`). The case floor is z 0, so this may never bite, but the contract is
"relative to origin".
**Fix:** export `oz` (or `armZ[0]`) in `ctx.data` and write these as offsets from it.

### 6. Nothing visible happens between the hopper and the speaker
**Where:** `elevator.mjs` lines 441–448, and the speaker stub.
**What:** the packet drops into the hopper and is cut at the rim correctly (`qa/sheet-fling4.png` 25–27). Then it is
hidden for the 0.5 s duct transit and emitted at the spout bottom, and the stub only pumps its dust cap 0.9 units.
Nothing falls the ≈ 11 units from the spout to the cone, so the last link of the story (lifted audio reaches the
speaker) cannot be read.
**Fix:** at the end of `DUCT`, draw the packet falling out of the spout (cut at the spout flange, fading or shrinking
into the cone). Or tell the speaker builder in NOTES that `accept("in", item, from)` must animate the drop from `from`
along `outDir`. The standalone stub should show the drop either way.

### 7. Preamp buffer cells pop
**Where:** `scanner.mjs` line 268.
**What:** each cell switches from shade-0 to mint in one frame when a pulse lands, and all four clear in one frame when
the packet starts (`qa/sheet-preamp.png` 12→13). That breaks "nothing pops".
**Fix:** give each cell an opacity envelope of about 0.12 s in and about 0.25 s out.

### 8. The elevator queue is unbounded and invisible
**Where:** `elevator.mjs`, the `waiting` array.
**What:** at lift 210 there is one cradle every 1.23 s (0.81/s). If more packets arrive than that, packets pile up in
`waiting` and no limit applies. Nothing shows the backlog, and the counters drift away from what the reader sees. This
is tied to issue 1.
**Fix:** cap the scanner's packet rate (issue 1), and draw up to two queued packets at the chute floor or in the boot
window. An alternative is to let belt D hold its items while the queue is non-empty.

### 9. The belt id is hard-coded and one selector is global
**Where:** `scanner.mjs` lines 152, 172 and 287.
**What:**
- `document.querySelectorAll('[data-route=…]')` scans the whole document, while the runtime offers `api.els(sel)`
  (svg-scoped).
- `FACTORY.machines.audio` is hard-wired, so the scanner can only read a belt with the id `audio`.

**Fix:** use `api.els('[data-route="' + D.cable + '"]')`. Take `opts.belt` (default `"audio"`), store it in
`ctx.data[id].belt`, and look the belt up through it.

### 10. The emitted point and the documented `out` port disagree
**Where:** `scanner.mjs` lines 298 and 305 against line 138.
**What:** `ports.out` is local [−77, +8, 24], but the packet is emitted at `y0 + 4 − 10`, which is local **+6**. The
packet (d = 8) then hangs 4 units past the lip end. The standalone belt-D stub clamps `from`, which hides this.
**Fix:** either end the push at the documented port (lip end minus half a packet), or document +6 and extend the lip.
Keep the packer's convention that `from` = the packet's bottom centre.

### 11. At 390 px the hint runs into the card border
**Where:** `build.mjs`, the `hint` option.
**What:** "One slat read per quantum · four make a packet" ends exactly on the plate's right edge at 390 px
(`qa/z-phone-hint.png`).
**Fix:** shorten it to about 34 characters, for example "One read per cleat · four per packet" (this also fits issue 1).

### 12. The read arm only half-reads as a hard-disk actuator
**Where:** `scanner.mjs`, `GEOMETRY.track` and the lamp.
**What:**
- The parts vocabulary is right: kidney VCM plates on standoffs, magnets, crash stops, E-block with lightening slots,
  load beam, slider, flex ribbon to a bracket, park ramp.
- But the sweep is ±5.5 at a reach of 30.5 (±10°). At 1× desktop the seek is a few pixels, and the dark VCM top plate
  is the only thing that reads (`qa/light.png`, `sheet-seek.png`).
- At 390 px the scanner is a small dark blob.
- The status lamp (the lit accent) is a 1.7-radius white ball on a white deck in light theme: only its black outline
  shows, and only the mint glow announces a read.

**Fix:**
- Widen the track to about ±10–12 (±20°). This pairs well with cleat reads at pitch 18.27 and gives a clear
  track → seek → dwell rhythm.
- Move the park ramp out to match.
- Raise the lamp on a short post off the deck, or put it on the graphite VCM top plate, where the kit's lit style
  (white top, black edge) contrasts.

## Craft judgment (Anatomy checklist)

- **Elevator as the vertical hero:** yes. At lift 210 it is the tallest, densest thing on the page and reads at a
  glance as a bucket elevator:
  - boot with take-up and door;
  - twin chain channels with moving pins;
  - cradles on the front run;
  - open head with toothed sprocket and chain wraps;
  - gearbox and ribbed motor;
  - ladder with cage, landing and head platform.

  The graphite motor and gearbox at the head anchor the top. The chain itself is faint against the posts; the cradles
  carry the motion.
- **Arm as an HDD actuator:** half-way (issue 12). The right parts are there, but the motion is too small to read.
- **One lit accent each:** yes, the scanner status lamp and the elevator drive lamp. The scanner's is too weak in
  light theme (issue 12). Mint is used for audio (packets, pulses, cells, glow), which is the subject, so that is
  acceptable.
- **Calm motion:** the eased seek, travelling flex and cable pulses, constant chain and eased flight are good. These
  pop: issues 3, 4 and 7, and the hidden hand-off in issue 6.
- **Lines, order, tokens:** audit zero and line ends zero. Openings and cells use theme tokens (`--anatomy-mid`,
  `--anatomy-shade-0`, `--pk-audio-*`) as inline styles. Dark theme reads well. Light shading is correct, with
  graphite parts kept for the VCM, preamp, gearbox and motor.
- **Density:** high on the elevator and adequate on the scanner. Two faces are plain (see polish).

## Nice-to-have polish

- The boot housing's +x face and the discharge hopper are large plain boxes. Add a bolted top flange on the hopper rim,
  stiffener seams and a duct flange where the duct meets the hopper, and an access panel on the boot's +x face.
- In the standalone page, a belt-D packet passing far behind lines up on screen with the read head and looks as if the
  head is emitting it (`qa/z-reduced-green.png`). Shorten belt D's visible span, or move the stub.
- The speaker stub's tall single post reads as a lamppost. A short bracket from the head platform would read as part of
  the machine (standalone only).
- Dead code:
  - `elevator.mjs:395` `travel += 0;`
  - `elevator.mjs:250–251`: both branches of `if (Z !== ZHB)` are identical.
  - `elevator.mjs:95`: `if (!(y === PYF))`.
  - `scanner.mjs:142` `at3` wraps `ctx.at`.
- The conveyor's own `read` port and `autoSpend` grey parcels on the *lower* run at `readAt`, while the scanner reads
  the *top* run. Set the belt's `readAt` to the scanner's pivot x so the greying happens under the head's x, and say so
  in the caption.
- NOTES says the flung packet peaks at about lift + 66 (276 at lift 210). That is 4 below the case top and close to the
  display's underside: confirm the clearance once the display height is settled.
