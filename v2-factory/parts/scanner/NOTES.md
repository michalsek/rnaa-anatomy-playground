status: review

# scanner + elevator (one folder, two kinds)

Modules
- `scanner.mjs`: kind `scanner` (`build`, `LIVE`, `GEOMETRY`).
- `elevator.mjs`: kind `elevator` (`build`, `LIVE`, `GEOMETRY`).
- `helpers.mjs`: my own helpers (shared/ is untouched): `bar` (a rectangular bar along any axis, recorded as `A.prism`),
  `slabAlong`, `pulseCable` (like `ctx.cable`, but every chunk carries a hidden `.fx-pulse` copy of its body and a
  `data-span="a,b"` arc-length span, so the page can run a mint pulse along the cable chunk by chunk in true painter's
  order), `faceScrews` (screw rings + dots on a vertical face).
- `stubs.mjs`: standalone-only stand-ins: `beltDStub` (built between the two ports) and `speakerStub` (a bare driver
  facing up on a post, centred under the elevator's spout; it animates the packet's fall into the cone and pumps its
  dust cap). The audio belt on the page is the REAL conveyor (`../conveyor/conveyor.mjs`, type "loop").
- `build.mjs` → `scanner.html` + `scanner-light.html` (W 640 × H 760). It places the real audio belt at
  [−120, 70, 0] (L 170, readAt −30), the scanner at audio + [90, −38, 0] = [−30, 32, 0], and the elevator at
  [−107, −123, 0] with lift 210; belt D and the speaker stub are built from the ports.

Both builds are **relative to `origin`** (phone-case pivot). Frames and ports are below; no absolute coordinates.

## Local frames and ports (relative to `origin`, units ≈ px, z up)

**scanner** — `scanner.build(ctx, origin, { id, belt = "audio" })`. `origin` = the foot of the arm's pivot axis on the floor.
- Footprint: x −86…+24, y −26…+31.5, z 0…105.4 (deck z 80–86, arm plane z 94.5–96, VCM top plate to z 101, status
  lamp on the plate to z 105.4). All live parts follow origin z.
- **Placement on the audio belt (the real conveyor `loop`, width 18): scanner origin = audio origin + [dx, −38, 0]**,
  with dx anywhere from ≈ 30 to L − 30 along the flat top run (standalone: dx 90 on L 170). Pass the belt
  `readAt` = scanner origin x so parcels grey under the head. The read head (local [0, +30.5, 93.6]) then hovers 1.5
  inside the belt's far edge, clear of parcels (±4 about the centreline) and 0.4 above cleat tops (z 93.2).
- Clearances to the real belt, all proved by the audit with the real conveyor: the park-ramp post is at local
  x +13…+17, y +19…+23, z 85–96 (the belt's far truss chord sits at y +24.4…+26, z 86.4–90), and its tongue
  cantilevers over the chord at z 94.2–96 out to y +31.5. The preamp (box local x −86…−68, y +7…+21, fins to +22.8,
  legs on the floor) and the cable riser (local y +19) clear the belt's far legs (y +24…+26.4) at any dx.
- Head sweep: ±9 (±17°) about the pivot x. Crash stops at ±39°.
- **`out` = local [−77, +5, 24]**: the packet's bottom centre at the end of its push, sitting fully on the lip (lip
  local y +1…+7, top z 24). Belt D should start at local y +1 (the lip end) and run along −y.
- `read` = local [0, +31, 92].

**elevator** — `elevator.build(ctx, origin, { id, lift = 210, outDir = "-y", outReach = 14 })`.
`origin` = centre of the tower column on the floor (column x −11…+11, y −11…+11).
- `lift` = height of the discharge port above the in port (in at z 24, so **out at z 24 + lift**). Everything scales from
  it: head shaft at z lift + 31.5, posts to lift + 53.5, girts every 36 from z 44, one landing every 3 bays plus the head
  platform (lift 210 → one mid landing at z 134), ladder and cage sections between them, cradle count = loop / 38
  (lift 210 → 14). **Highest point ≈ lift + 66** (a flung packet's apex; structure top lift + 53.5), so lift 210 keeps
  it under the case top at 280 (max ≈ 214).
- Footprint (lift 210, outDir −y, reach 14): x −11…+31 (landings, cage), y −55…+40 (duct … in-feed chute), plus the
  gearbox/motor on +x (x +12.4…+21, y −10…+23, z lift + 25.5…+41.4). Boot housing y −26…+26, z 0…42.
- **`in` = local [0, +39, 24]** (mouth of the in-feed chute; the feeding belt should run along −y at local x 0 and end
  at local y ≈ +40).
- Discharge: packets are flung off the cradles at the head into an open hopper behind the head (local x −11…+11,
  y −41…−25, rim at z lift + 45.5), then through a short duct and out of a **down-spout**. **`out` = spout bottom**,
  `ctx.data[id].outDir = [0, 0, −1]` (the packet falls straight down from it):
  - outDir "-y": local [0, −34 − reach, 24 + lift] → default **[0, −48, 234]**;
  - outDir "-x": local [−4 − reach, −33, 24 + lift]; outDir "+x": local [4 + reach, −33, 24 + lift];
  - outReach < 12: no duct, spout under the hopper at local [0, −33, 24 + lift].
  The packet is drawn sliding out of the spout (cut at the flange) and is emitted when fully clear, with
  **`from` = out − [0, 0, 7]** (its bottom centre). **The speaker's `accept("in", item, from)` must continue the fall
  from `from` along `outDir` into its cone** (the standalone stub does: gravity, cut at the cone, dust cap pumps).
  Spout r 6.5, flange r 8. The speaker (bare driver, membrane up) sits with its cone centred under the spout, its rim
  well below the spout (stub: 10 below), clear of the back run (cradles reach local y −23.4) and the boot housing
  (y ≥ −26 below z 42).
- Audited variants: lift 150/−x/16, 210/−y/14, 230/−y/0, 300/+x/18 all `audit passed`.
- **`access: false`** (default `true`) leaves off the access steel that hides the mechanism: the ladder (stiles, rungs,
  standoff brackets), the safety cage (hoops, straps), the intermediate landings, the head platform (grating, beams,
  toe boards, posts, rails) and the alternating diagonal braces on the side faces. Kept: posts, base plates, splice
  plates, all girts and gussets, chain guides, boot, head with sprockets, hopper/duct/spout, gearbox/motor, drive lamp.
  The gearbox's torque arm, which stood on the head platform, then rests on `elevator.drive.beam`, a short cantilever
  from the right back post at z lift + 5.1…+7.5 (local x +11…+19, y −10.5…−7.5). No slot was anchored to a removed
  item, so slots, ports and live code are unchanged; the footprint shrinks to x −11…+22 (motor). Audited: lift 210/−y/14 and /40 with
  `access: false` → `audit passed`, `line ends: 0` at rest and at 6 s. The default output is byte-identical.

## What they mean
- Scanner = the platform audio callback (CoreAudio / Oboe) reading each finished 128-frame quantum. A hard-disk read
  arm on a pedestal behind the audio belt: the head tracks one cleat (one cleat gap = one quantum), flies back to the next in a 0.16 s eased seek, and
  every read runs a mint pulse along the flex ribbon and the round cable to the preamp. Four reads (one 512-frame device
  buffer = 4 quanta) fill the preamp's 4-cell buffer window; then one mint `audio` packet is pushed out of the preamp's
  back face onto the lip, toward belt D.
- Elevator = output to the device. Bucket elevator: packets slide down the in-feed chute into the boot, ride cradles
  (14 at lift 210, twin roller chain, 30 u/s) up the front run, round the open head sprocket and are flung over it
  into the discharge hopper; after the duct's transit (0.5 s) they drop out of the down-spout into the speaker below.
  Empty cradles return down the back.

## Parts (scanner ~50, elevator ~70 kinds; 281 items in the standalone page at lift 210)
Scanner: floor plate, 4 feet, groove, corner screws, label plate with rule lines; pedestal flange, column with 2 seam
rings, 4 gusset ribs, cap flange; deck casting with groove + screws; pivot base flange, bearing cartridge, (live) hub,
clamp nut, E-block arm with 2 lightening slots and a trace with pads, load beam, slider; VCM bottom plate, 2 magnets,
3 standoffs, 2 crash stops, top plate, (live) coil + fork; flex bracket + boss, (live) flex ribbon; park ramp (bar,
post, tongue over the belt's far margin); status lamp (lit accent) on the VCM top plate with a mint glow per read; preamp on 4 legs + pads,
lid with screws, 7 fins, input boss, 4-cell buffer window (live), output lip; round cable with pulse overlays.
Elevator: boot housing with feed opening, top flange with two run slots + screws, inspection door + handle; in-feed
chute (floor, two walls, leg); take-up (bottom/top bars, guides, slide, rod, jam nut, flanged bearing, shaft end);
4 posts on base plates with anchor bolts, seam rings, splice plates; girts on 4 faces at 10 levels; gussets with bolts
and alternating diagonal braces on both side faces; chain guide channels + link strands front and back, (live) pins;
open head: ring beams, side beams, 2 pillow blocks, shaft in 4 pieces, 2 hub flanges, 2 toothed sprocket wheels with
fading tooth ribs, hub, bolt circle, top side beams, discharge hopper on two arms, duct, down-spout + flange (out port);
(live) chain wraps as
link segments + pins; right-angle gearbox with torque arm, ribbed motor with fan cowl, terminal box, drive lamp (lit
accent); ladder in 3 sections (stiles + rungs) with standoff brackets; safety cage (flat-bar hoops + 3 straps per
section); landings (1 at lift 210) + head platform (U-shaped grating plates round the ladder, beams, toe boards, posts, two rails).

## Live data and the belt interface
- One cleat gap of the audio belt = one 128-frame render quantum. The scanner reads once per cleat gap (when the
  locked cleat leaves the ±9 track window it counts a read, sends a pulse and seeks back to the next cleat); four reads
  = one 512-frame device buffer = one packet. With the real belt (speed 32, cleat gap 18.27): 1.75 reads/s and
  0.44 packets/s, well under the elevator's ≈ 0.8/s at lift 210, so the boot queue stays at 0–1.
- The belt is `FACTORY.machines[opts.belt]` (default `"audio"`). The adapter prefers `quanta()` →
  `{ phase, period, cleats: [{ pos, run }] }` (top-run cleat x from `pos`), falls back to `geometry()` (`cleatGap` if
  present, else loop ÷ floor(loop ÷ (pitch · cleatEvery))) with `slatPhase()` (the conveyor's travel in slats), then
  to `slats()` + `pitch`. It handles `dir` ±1; a belt with `axis: "y"` is not supported (the arm parks).
- Counters for readouts: `FACTORY.machines.scanner.reads`, `.packets`; `FACTORY.machines.elevator.lifted`.

## Painter strategy (as built)
- Elevator: boot and head wraps are handled differently. The boot is enclosed; cradles are slabs truncated at the
  boot top (z 42). Slot `elevator:back` sits right after `elevator.boot.flange` (back run and the far third of the head
  wrap, φ > 129°, are behind every tower part); slot `elevator:front` sits right after `elevator.head.sprocketR`
  (front run, the near part of the head wrap, chain wraps and the flung packets). Wrap cradles are drawn per frame
  as x-prisms with the kit's shading rule; a flung packet is cut at the hopper rim once it is over the hopper. `elevator:feed` sits
  before the chute's +x wall; feed packets are cut at the boot's feed face.
- Scanner: `scanner:coil` before `scanner.vcm.top`; `scanner:arm` after `scanner.ramp` — the ramp's tongue overlaps
  the belt's far margin, so settle puts it after the belt, which puts the arm over the belt (works in the assembly
  too, as long as the belt is in the same settle). `scanner:out` before the preamp box (packets leave by its back face,
  so the box hides their start); `scanner:buffer` after it; `scanner:lamp` after the lens.

## Verification
Standalone page with the REAL audio belt (`parts/conveyor`, loop, L 170): `node build.mjs --audit` → `audit passed`
(364 items, 379 solids). `lines.mjs scanner-light.html` → `line ends: 0`, also at 2.7 s, 4.3 s, 6.9 s with
`drive.mjs [["lines"]]` and on the dark page. Console clean; reduced motion still (`quanta read 0`); 390 px fits.
QA's brief placement (`PLACE=brief node qa/relocate.mjs cleats 0 --audit`): the scanner × belt collisions are gone;
its only remaining problem is the throwaway belt-D stand-in, which still uses the old out port (+8; now +5).

## Notes for the assembler
- Audio belt: `scanner origin = audio origin + [dx, −38, 0]`, `readAt` = scanner origin x (see the scanner frame).
- Belt D: starts at the scanner's lip end (scanner local [−77, +1, 24]) and runs along −y to the elevator's `in`
  (elevator local [0, +39, 24]); belt top z 24, centred on x of both ports.
- Speaker: continue the fall from `from` = elevator out − [0, 0, 7] along [0, 0, −1].

## Known issues / open questions
- The boot sprocket is hidden inside the boot housing (only its flanged bearing, shaft end and take-up show); the
  head sprocket is fully visible.
- Packets on cradles are drawn level; they are flung at the head's front tangent (the cradle's first instant in the
  wrap), from their exact pose on the cradle. The duct transit (0.5 s) is hidden; the packet then slides out of the
  spout and falls.
- In the standalone page belt D is mostly hidden behind the audio belt and the pedestal (true to the plan). The
  audio belt is fed demo parcels every 2.2 s; spent ones leave its drop port unlinked (no belt C on this page).
- Throughput (lift 210): one cradle every ~1.3 s. A packet waiting in the boot is not drawn; at the real belt's rate
  the queue never exceeds one.
- Out of scope: `shared/kit.mjs` `page()` takes `css`, but the assembly contract doesn't say how part CSS is merged,
  so I used inline styles (`var(--pk-audio-*)`) for pulses and openings instead of classes.

## Assembly changes (assembly agent, 2026-10-12)
- build.mjs (standalone): `readAt: S[0] - AUDIO[0]` (a distance along the belt). It passed the world x, so the read lamp
  sat off the belt after the conveyor's switch to relative opts and the audit failed (3 loose solids).
