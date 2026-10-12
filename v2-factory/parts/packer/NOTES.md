status: review

# packer

Boxes loose fluff (3 beads per packet) into post-style packets and drops them on belt B.

## What it is

A small packaging cell on a raised deck (four legs to the case floor, stringers, lower shelf with an air
receiver and a vacuum pump). Beads roll off belt A into a three-pocket gutter (photo-eyes light up React blue
as pockets fill). A **picker arm** (front-left, seen side-on) lowers a three-cup vacuum head (the lit accent),
lifts all three beads and drops them into the open carton at S1. A **walking-beam lane** (fingers rise through
a slot, push one pitch of 11, sink) indexes cartons through S0 erect → S1 fill → S2 fold + tape. At S0 a
pusher slides the bottom blank out of the magazine (the stack shows the coming colours, round-robin
control → graph → data) and the erector pad pulls it up into a carton whose flaps spring open. At S2 the
**folder/taper arm** (back-right) closes the minor then major flaps, runs a tape head across the top (strap
line grows, band fades in), then the next index pushes the taped packet off the lane nose onto belt B.

Parts: ≈ 112 recorded solids + 4 tubes static (legs, feet, heads, stringers, shelf, tank + saddles + gauge,
pump + motor, deck with T-slots and bolt rows, 2 turned lane columns with bolt circles, bed, rail + posts,
magazine posts/gate/hopper/cap/knob, pusher block/body/gland/ports, erector bridge posts/beam/cylinder/gland,
gutter post/floor/wall + eyes/stop/lip/near lip, 2 arm pedestals/turrets/slewing rings/cable bosses, picker
drive box, control cabinet with door, hinges, handle, label, valve manifold with 2 valves + coils, 2 cables,
2 air hoses) plus live parts: per arm ~30 (yoke, cheeks, servo cans, 2 stadium links with recess outlines,
caps, 2 drag chains, wrist, tool), cartons (floor, 4 walls, 4 flaps, beads), beam fingers, pad + rod,
blank stack, pusher rod + plate.

## Placement, size, ports (relative to `origin`)

- `build(ctx, origin, { id, prefill, floor, stand })`. Local frame: `origin` = the floor point under the lane axis on
  the gutter line (the BRIEF plan point [100, −118, 0] is `ANCHOR`; pass `origin = ANCHOR` to reproduce the plan).
  `floor` (default 0) is the local z the legs stand on. With legs taller than ≈ 40 the stand gets a second stringer
  ring under the deck and diagonal braces on all four faces; the standalone page uses `floor: 120` (shelf readable).
- `stand` (default `true`). `stand: false` (assembly: the stand hid the mechanism) leaves out the four legs, feet,
  leg heads, both stringer rings, the diagonal braces and the lower shelf with the air receiver (saddles, nozzles,
  neck, gauge) and the vacuum pump + motor. Nothing else served them (no hoses or cables to the shelf), so no line
  is rerouted. The deck then hangs in the air; its recorded shape `<id>.deck` carries `ground: true` (only then) so
  the support check passes. Everything on the deck (lane, magazine, pusher, bridge, gutter, pedestals, arms,
  drive box, cabinet, manifold, cables, hoses), ports, slots and live code are unchanged; `floor` is then unused.
  Verified on a scratch copy of build.mjs: `--audit` passed (132 solids, 4 tubes), `lines.mjs` light/dark 0,
  `drive.mjs [["wait",8000],["lines"]]` 0. The default build is byte-identical to before.
- Extent (local): x −30…30, y −32…24.5 (deck x −30…30, y −32…14; front-left tab x −30…−12 to y 20.5 for the
  picker, front-right tab x 12…30 to y 24.5 for the folder; lane nose to y 22.7; pusher cylinder to y −29.2),
  z 0…≈250 (picker at its gate height). Below the 290 cap.
- `in`: origin + [−28, 0, 232] (end of belt A; beads fly from `from` into the gutter entry at local x −24.2, z 228).
- `out`: emitted at the **end** of the walking-beam stroke, packet at rest and clear of the lane nose:
  `from` = the packet's **bottom-centre** = origin + [0, 27, 200], `item.v = [0, 0, 0]` (its real velocity).
  Belt B (top z 192) receives it 8 units below. Both are in `ctx.data[id].ports` (world) and `portsLocal`.
- Kind: round-robin control → graph → data (the magazine stack holds the sequence); `stats().next` is the kind
  being filled, shown in the standalone readout.
- Reduced motion: one settled frame, then `tick` returns early and `accept` ignores items (like the conveyor).

## Kinematics

Both arms: yaw turret + shoulder + elbow (planar 2-link IK in the yaw plane, elbow up) + a wrist that keeps
the tool vertical + a wrist rotate that keeps the tool bar along world x.
- Picker: base local (−22, 14.5), shoulder z 230, links 17/16. Pick and place is lift → traverse → lower with the
  traverse at a gate height (cup + bead bottom 0.8 above the gutter walls), so nothing crosses the gutter.
- Folder: base local (21, 18.5) on the front-right tab, level with S2, so its arm plane never crosses S1; low
  pedestal (yoke z 206) so it hides less of the lane; links 16/15. It hovers 5 above the flaps while they fold,
  presses only once they are shut, and tapes from the +x end toward −x (the strap appears in front of the head).
- Interlock: the picker does not go down into S1 while the folder is in its tape stroke (`folder.clearOfS1`), and
  the folder holds over the closed carton (`holdS1`) while the picker is down. `qa/clash.mjs` / `clash3.mjs`
  (statics updated to the new geometry): no hits on static solids or cartons, arms ≥ 5.1 apart.
- Rest-pose shapes of every arm link (yoke, cheeks, pins, links, spindle, tool) are recorded for `--audit`.
- Throughput: 60 s simulated at one bead per 0.9 s → 66 beads, 20 packets, nest back to 3 (balanced).

## Painter strategy for live parts

Each arm lies in a vertical plane; arm parts are plates at offsets along the joint axis n, ordered by layer
(sign of n·V) then depth; the tool stack is drawn first, bottom-up. Slots: `gutter` (before gutter.near),
`stack` (after the back magazine posts), `lane` (after mag.hopper: cartons, fingers, pad), `picker` and
`folder` (both after folder.slew, picker first; the pocket LEDs are drawn first in the picker slot).

## Helpers

`rig.mjs` → `makeRig(K, G, P)`: convex prism in any frame, stadium links with recess outlines, drag chains
(graphite carrier strip + fine links + end brackets), arm IK (`solve`), `armSvg`, `cartonSvg`. The page code is
`live.src.js`; `packer.mjs` injects `makeRig` into it with `toString()`. Stepped turned parts are one disc item per
radius run (local `stepped` helper); the cups use `fill: "surface"`.

## Fix loop 1 (QA REVIEW.md)

1. Arm clash: folder moved to the front-right tab level with S2, interlock added, clash scripts clean.
2. Hull cones: pedestals, lane columns, gutter post, bridge posts and cylinder, pump, pusher body, tank nozzles
   rebuilt as disc runs; cups as one smooth bellows with `fill: "surface"`.
3. Gutter shortened (ends at plan x 92, pockets 3 units back), lift → traverse → lower.
4. Erect: the carton is drawn with walls and closed flaps from the magazine on (no swap); flaps open on a damped
   spring (ω 14, ζ 0.7) starting at rest, only once the pad is above the flap arc.
5. Fold: the closed state is the folded flaps themselves (seam = where the tape goes); the switch to the shared
   packet look is a crossfade under the band fade-in. The head stays clear of the flaps until they are shut.
6. Push-off at the end of the stroke, at rest, clear of the nose; `item.v` set.
7. Reduced motion still (packer and stubs).
8. Folder no longer stands in front of S0/magazine/hoses; the strap grows in front of the head.
9. Accent: React-blue vacuum manifold bar with a lamp that lights while it holds (gauge needle no longer `lit`).
10. Stand: two rings + braces at full height; standalone at `floor: 120`.
Polish: finer graphite drag chains, beads keep r 2.4, emitter/receiver photo-eyes with LEDs on the near lip,
cabinet louvres and lamp, readout `· next <kind>`, stub packets no longer paint behind the end drum.

## Known issues / open questions

- The lane nose overhangs belt B's start: bed ends at local y 22.7 (plan −95.3), underside z 196. Belt B's tail
  must stay below local z 195 between local y 20…23; the packet is handed on at y 27, 8 above belt B's top.
- While it works at S2 the folder arm still overlaps S1 and S0 on screen (it is in front of them, not through them).
- The top bead settles lower into the carton as the lid closes (soft fluff), so the three beads fit a 10×8×7 box.

## Out-of-scope findings

- `from` convention (packet bottom-centre) and `item.v` on hand-off are worth writing into the BRIEF contract.
- Runtime `G` lacks `prismOf` / `toneOf`; rig.mjs carries its own prism.
