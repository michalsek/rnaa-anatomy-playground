status: review

# crusher (kind "crusher", instance `crusher`)

The Disposer thread: a double-roll crusher that destroys garbage packets (buffers/nodes the audio thread swapped
out), off the audio thread. Centre (−136, 176), built in local coords (origin = centre on the floor), z 0…38.
Height z 0…38 (hopper back lip top 37.9). 130 items / 112 recorded solids / 4 tubes. `node build.mjs --audit` →
audit passed + "order rules hold"; `lines.mjs` → line ends: 0 (light, dark, reduced, and mid-motion: fall, nip,
crush, chute queue behind the shut gate, bin out, dump, roll back, release).

## Fix loop after REVIEW.md (issues 1–14)
1. Fall: the packet slides off belt C onto the back lip, tips nose-down over its edge and holds z ≥ lip top + 0.35
   until its tail is clear (base y > −9.5 local), then drops onto the back roller. The back lip and both hopper
   liners sort early (bias −30 on items with no screen overlap), so the item slot is painted after them; asserted.
2. Lamp: `crusher:lens` slot after the lens with an amber gradient (pale core, saturated rim, token colours
   `--cr-lamp*`), opacity = lamp level; the halo behind is smaller.
3. Held flakes queue behind a visible slide gate at the chute lip (guides, crossbar, actuator; closes while the bin
   is away) in 7 lanes, 1.9 apart; on reopening they leave one at a time (0.07 s stagger); pending flakes are
   released one per 0.085 s and only into a lane with room.
4. Pile slab fades in with its height; a landed flake stays 0.3 s, flattens and fades while a chip fades in on that
   spot (chips = where flakes really landed).
5. Fall lerps x from `from[0]` to the hopper centre.
6. `orderRules(id)` / `checkOrder(ctx, id)` exported; build.mjs fails if any relation breaks after page(). The
   lacing marks now live inside the V-belt chunk groups they lie on (no shared overlay).
7. Photo-eye emitter and receiver on one axis (y 2, z 32.2 local); cable unchanged in that plane.
8. V-belt drawn in rubber (fx-graphite).
9. Lamp follows the eye (packet above the nip); standalone feed every 2.4 s so idle shows.
10. Front roller carries `data-move="crusher:block"` and kicks back with its bearing block.
11. Reduced motion: bin snaps home, a 100% state is shown before wrapping to 10%, anything in flight is settled.
12. Lanes + per-lane speeds + depth-sorted painting: no flake passes through another.
13. Housing front wall lowered to z 15.5; flakes start at y 11 under it with no fade.
14. accept() ignores ports other than "in"; announcements only on "bin full, emptying" and "bin emptied".
Polish done: hopper wear liners (back, left) with countersunk screws, chip stroke token `--cr-chip-line`, flywheel
outline `mid`, stub hand-off by distance and stub packets painted after the stub drum. Not done: chips falling
through the grate while dumping (hidden under the drawer anyway).

## What it is
Belt C drops a grey packet over the back lip of a flared feed hopper (four separate wall slabs: back, left,
right, front, plus lips). It lands on the back roller, tumbles, slides into the nip of two toothed rollers (7 rings
each, teeth redrawn as they turn) and is squashed while it sinks; the front roller, painted after it, eats it.
Flakes slide out under the housing along a vibrating discharge chute and drop into a drawer bin on casters.
A photo-eye (emitter on −x wall, cabled to the control box; receiver on +x wall) speeds the drive up while a packet
is in the hopper: motor → V-belt → flywheel on the back roller shaft; rollers, flywheel, pulley and belt lacing
marks all speed up (critically damped), then settle. The front roller's sliding bearing block is held by a
tramp-relief coil spring against an abutment: it kicks back (underdamped spring) while crushing and the coil is
rebuilt per frame. Control box on a pedestal: lamp (the one lit accent; amber gradient glow with attack/decay while
the eye sees a packet), a step-counter dial (one of 20 divisions per disposal, springy needle), label plate with
rule lines, start/stop buttons, key, vents. Bin: hazard-stripe band on its front; when full (10 packets) the
chute holds new flakes, the drawer rolls out over a floor grate (bottom-dump), drains, rolls back.
Other parts: skid rails on 4 feet, cross members, side plates, housing walls, −x gear guard, rating plate, motor
on a slotted slide base with foot block, terminal box, motor cable and control conduit to floor boxes, halos.

## Ports / data (`ctx.data.crusher`) — all relative to `origin` (machine centre on the floor)
- build() is fully origin-relative (verified: built at origin [40, −60, 0], audit passed, line ends 0).
- `local.in` = [0, 0, 37] hopper mouth; `local.drop` = [0, −26, 40] where belt C should release the packet.
  World copies: `ports.in`, `drop` (origin + local), per the runtime contract.
- `accept("in", item, from)`: `from` = where the packet leaves belt C (bottom-centre of the packet, as packetSvg
  draws it); falls back to `drop`.
- Footprint (local): x −38…40, y −36…60 (the drawer rolls +16 to y 56 and the grate reaches y 59), z 0…38.
  Feed side is −y (belt C comes in from −y at x 0, top z ≈ 40, ending at y ≤ −21).
- No outputs. `stats()` on the machine → `{ count, fill, bin }` (used by the standalone readout).
- Belt C must end at local y ≤ −21 with its top at z ≈ 40: the hopper back lip sits at local y −19.6…−16.6, z 37…37.9.
- Emits nothing; reduced motion: accept() just counts and fills, everything still.

## Assembly notes
- Include `CSS` exported from crusher.mjs (lamp glow token `--cr-lamp`, chip fills) in the assembly page css.
- Slots: `crusher:item` (after `crusher.roller.back`), `crusher:bin` (after `crusher.bin.mat`), `crusher:flakes`
  (after `crusher.chute.floor`), `crusher:glow` (before `crusher.lamp.lens`), `crusher:lens` (after it).
  Nothing goes into the shared overlay any more.
- After page() in the assembly, run `checkOrder(ctx, "crusher")` (from crusher.mjs) and fail on any result. Add
  `[<last belt C item at its end>, "@item"]` to the rules there so belt C's drum is painted before the falling packet.
- `crusher.bin.mat` records the envelope of the full pile (mat + 5.4) rather than just the 0.6 mat, so the settled
  order puts the live pile inside the bin walls and behind the chute lip. Deliberate; drawn mat is inside it.
- The bin items (+ its halo in ctx.back) carry `data-bin="crusher"` and are translated together (+16 y) when it
  empties; nothing static sits in front of the bin, so its order stays valid.
- Standalone stub of belt C lives only in build.mjs (`MACHINES.stub`, fades its packets in at the stub start).

## Phone-case pivot
- Front (+y: bin with hazard band and handle, chute, grate) and right (+x: flywheel, spring-loaded bearing, rating
  plate, motor) are the faces to show. The whole machine is ≤ 38 tall, so a near lip at z ≈ 40 directly in front of
  it would hide most of it: keep it back from the +x/+y lip (or lower the lip there) by at least the lip height ÷
  tan 30° ≈ 70 units of clear floor, or the bin/chute/drive will be cut off.

## Known issues / open questions
- The drain while the drawer is out has no visible chips falling into the grate (hidden under the bin).
- BRIEF's table still says z 0…36 for the crusher; the true height is 0…38 and the +y footprint is 60 (not edited
  here: BRIEF belongs to the orchestrator).

## Out-of-scope findings
- runtime `api` has no `querySelectorAll`; the crusher reaches siblings via `api.el(".fx-parts").ownerSVGElement`.
- page `G` lacks `prismOf`/`lightOf`; the crusher passes the light vector in data and draws its tumbling packet
  with its own small box renderer (pitchedBox in LIVE).
