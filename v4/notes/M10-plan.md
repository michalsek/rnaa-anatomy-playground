# M10 plan: the final factory scene (`factory`)

*2026-10-14. Planning-agent output, filed by the orchestrator. Work in step order with checkpoints and stop rules. There are no time estimates. M5-M11-plan §6 (user answers) overrides anything here. Paths are relative to `v4/` unless they start with `v2-factory/`.*

## 0. Findings that shape the plan
1. **The dispenser tip is at z 437, not 493.** v2 `phone.mjs` L18/L236–274 with v2 A's options (displayZ 560, neck 72) gives 560−2.4−72−23.6−14−11 = 437, and `assembly/qa/ports.json` agrees. A bead falls 205, not 260. v2 hands the bead on with the speed it has gained, not a fixed −150.
2. **No 16:9 framing contains everything.** At yaw 45 / elev 30 the floating display (z 560, shift [−80,−24]) makes the full scene about 832×930 (aspect 0.89). The case plus the machines alone is about 1.8:1. **Decided: option (a), see §10.**
3. **The cramped iOS stage comes from the card layout, not the camera.** Card.tsx reserves 52 pt at the top and `TWO_LINES` (≈58) at the bottom, and App.tsx adds 52 for the chip row. That leaves a 676×206 stage in an 874×402 window.
4. **Reveal motion would make every part "moving" for E8.** `store.ts` L831–842 sends any part under a `moves` group to the moving slots. Add a `rare` group flag that E8's packing skips, while `mover()` still counts it for contacts. Bounds are taken at rest (L824), so `fit` stays the assembled layout.
5. **Items already ride with their machines.** Their poses are machine-local and live in pools under each machine's root. With the sim frozen during the reveal, items move rigidly with their machine for free.

## 1. Phone machine: `apps/app/src/machines/phone/{Phone,Case,Display,Dispenser}.tsx`, `dims.ts`

**Options** (v2 A L24, phone.mjs L9–17): `CASE = { w 360, d 760, r 44, depth 280, cut 36, t 6, back 8, displayZ 560, displayShift [−80,−24], neck 72, dispenser [20,−190] }`. The origin is the centre of the case floor.

**Case** (`walls:"low"`, L39–157)
- **Back plate:** inner plan (inset 6, r 38), z −8…0, lo.
- **Band:** a ring between r 44 and r 38, z −8…36. Build it from 4 `Box` sides plus 4 `Extrude` sector corners, because polygons can't have holes. The low variant has no seams, rails or antennas.
- **Buttons** on +x (x 180…181.8, z 10…26, r 0.8): action y −284…−268, vol+ y −250…−220, vol− y −208…−178.
- **USB-C** on the +y end: ±14 × z 13…22, r 4.5, with an inner slot ±8 × 16.4…18.6. No grille, no screws.
- **Floor:**
  - vapour plate x ±158, y −358…−206, r 14, 0.4 thick, mid;
  - battery x ±154, y −45.6…212.8, r 8, lo;
  - label x −156…−96, y 316…340;
  - 6 standoffs, r 3.2 h 5, at x ±158, y −350/0/350;
  - 4 bosses, r 2.6 h 3.6, at x ±171.4, y ±190.
- **Halo:** a `Halo` under the case.

**Display** (L162–227; shifted plan)
- **OLED slab:** inset 3, z 560…563.4, graphite, seam at +1.6.
- **Glass:** inset 0.8, z 563.4…565. **Cut: an opaque dark slab** with a new near-black `screen` material and a linear `gradient` tone.
- **Screen art,** scale s = 347/130 = 2.669, centred at LY −29.9. Check the axis against `topMatrix(...,"x")` L181.
  - It sits on a `moves` group `logo` turning at 0.32 rad/s.
  - **3 orbit rings:** ellipses rx 114.8, ry 43.8 at 90/30/150°, drawn as `Tube` r ≈ 2, `react` material. Fallback: Marks.
  - **Nucleus:** `Lathe` disc r 20.8, pulsing ×(1 + 0.2·e^(−tap/0.18)).
  - **Glow:** a `Glow` disc.
  - **Island:** 82.7×24 r 12, at top + 13.3.
  - **Home indicator:** 117×5.9.
  - **Meter:** 4 cells 13.9×9.6, live E2 blends to `pkAudio` by `scanner.stats.reads % 4`.
- **Cut:** text glyphs, the ripple, play/speed controls (§6: chips only), glare, the tap-dip spring.

**Dispenser** (L231–274), `react` material, plan at the absolute position [20,−190]

| part | spec |
|---|---|
| plate | 24×24 r 2, z 557.6…560 |
| neck | r 3.4, z 485.6…557.6 |
| collars | r 5.4: z 482.6…485.6 and 459…462 |
| sight section | r 3.8, z 462…482.6 |
| valve box | x 13…27, y −196…−184, z 448…459, r 1.4 |
| sight glass on +y | profile L260, dark window r 3.7; rotor = `moves` group of 6 spokes |
| motor on +x | profile L265, U ribs |
| nozzle | profile L269, U knurl, from z 448 down to the **tip at 437** |

- **Cut:** the glass tube becomes **an open sight cage** (4 rods), so the queued beads stay visible.

**Sim** (`packages/engine/src/sim/dispenser.ts`)
- **Signature:** `createDispenser(clock, ledger, { id:'dispenser', origin:[0,0,0], at:[20,−190], tipZ:437, valveZ:449, tube:{ z0:462, z1:482.6 }, seed })`.
- **Timing:** `RATES.beads` with M9's hash streams, so timing matches `createBeadSource`.
- **Queue:** queued beads fall to slots at pitch 4.7. The cage shows 4; extras wait hidden in the neck. M9's tube holds 8 and v2's held 4; the user decides in M11.
- **Release:** `rotorTarget += π/3`, rotor eased τ 0.1, a 0.28 s wait, then the bead falls through the nozzle. Once z + 4.4 < 437 it is handed on to belt A with `v=[0,0,−v]`.
- **Shape:** the dispenser implements M9's `BeadSource` shape: an asking `out` plus `from`. Belt A must sit on the gutter line. Remove the `Hopper` stand-in from the factory.
- **Outputs:** `beads(cb)`, `outputs({ rotor, spin, tap })`, `status()`, computed `pools`.

## 2. Factory graph (`packages/engine/src/sim/graphs.ts`, `packages/engine/src/assembly/layout.ts`)

```ts
export interface FactoryLayout {           // every field required
  phone: { case: CaseDims; displayZ: number; shift: [number, number]; neck: number; dispenser: [number, number] };
  input: InputLayout; beltB: TopRun; centrifuge: V3; audio: LoopRun;
  garbage: { beltC: TopRun; crusher: V3 }; read: { scanner: V3; beltD: BeltDLayout }; output: OutputLayout;
  stands: Record<'beltA'|'beltB'|'beltC'|'beltD'|'audio'|'packer'|'centrifuge'|'scanner'|'elevator'|'speaker'|'crusher', boolean>; // render-only
}
export const FACTORY_LAYOUT: FactoryLayout = { ...LINE_LAYOUT-derived, phone: PHONE, stands: ALL_ON };
export interface FactoryGraph { factory; dispenser; beltA; packer; beltB; centrifuge; scanner; audio; beltC; crusher; beltD; elevator; speaker } // no nulls
export const FACTORY_ORDER = ['dispenser','beltA','packer','beltB','centrifuge','scanner','audio','beltC','crusher','beltD','elevator','speaker'] as const;
export function createFactoryGraph(l = FACTORY_LAYOUT, o: { seed?: number; controller?: SpinController } = {}): FactoryGraph;
```

- **Exported path builders** returning non-null records:
  - `inputPath(factory, at, seed, feeder: 'beads'|'dispenser')`;
  - `corePath(factory, l, scanner?)`: create the loop, then add belt B, centrifuge, scanner, loop;
  - `garbagePath`, `readPath`, `createBeltD`, `outputPath`.
- `createFactoryGraph` asserts the ids equal `FACTORY_ORDER`.
- **`line`:** keep `createLine`/`LineGraph` unchanged as the test bed (centrifuge scene, the §A-on-line tests, timelines). At the end of M10, remove the `line` *scene* from the chips.

## 3. The reveal (user's design: rigid, packed → assembled)

**Data** (`packages/engine/src/assembly/reveal.ts`, pure TS)
- `MACHINE_BOX`: local rest AABBs (stands per step 6). In DEV, check them against a new `store.groupBounds(id)` and warn if they differ by more than 2.
- `PACKED: { id, at, yaw: 0|90|−90|180 }[]`: a hand-authored, flow-ordered list.
- **Designing it:**
  1. Seed from the layout squished toward c = [0,−20]: `c + 0.55·(origin − c)`. Positions only.
  2. Fix overlaps by hand: turn the long belts (B, D, loop) ±90° and nudge.
  3. Validate with the test (no overlap, everything inside x ±168, y ±368).

**Motion**
- `revealPlan(layout, PACKED, boxes)` gives each machine a start `s_i` and the phases lift → travel → drop.
- **Stagger:** outermost destination first, gap `REVEAL.stagger` 0.3, `REVEAL.move` 1.4 with ease in-out. Yaw is eased during travel.
- **Collision rule:** if the straight plan sweep crosses another box at its current position, lift by (max crossed top − own bottom + 6), travel, then drop. Otherwise slide along the floor.
- **Docking pairs** (A↔packer, packer↔B, B↔centrifuge, centrifuge↔loop, loop↔scanner, loop↔C, scanner↔D, D↔elevator, elevator↔speaker, C↔crusher): the member that lands later ends with a vertical drop (v2 A L26–30).
- `revealPose(plan, id, t, out:{d, yaw})` is pure T·R, and exactly identity for t ≥ end.
- The display stays static.

**Live transform**
- `Group` gains `rare`. In `store.ts`, `GroupNode.rare` makes E8 use `animator(n)`, which skips rare groups.
- Machine blocks gain `reveal?: boolean` (default false) and render the root as `<Group id position={origin} moves rare>`. The pose is `T(o)·T(d)·Rz(ψ)`. **`sim.origin` never changes.**
- `factory/RevealDriver.tsx`: one frame hook writes the poses. After landing it writes identity once, then stops.

**Sim during the reveal**
- Frozen: `live.ctl.hold`, separate from the user's pause, makes the sim `advance(0)`.
- It starts at t = 0, with nothing mid-hand-off, and runs from the moment the last machine lands.
- M11 option: freeze at a warm `seek(t)` with nothing in the air.

**Scrub hook:** `__v4.reveal = { seek(s), play(), skip(), restart(), state() }`, plus a `reveal` chip.

## 4. Stands policy (user §6)

For each machine (belts A–D, loop, packer, centrifuge, scanner, elevator, speaker, crusher):
1. Toggle it with `__v4.stands({ id: false })`.
2. Screenshot `fit` and every view showing that machine and its neighbours, at fixed `seek` times.
3. Remove the stand **only if, with it on, it covers another machine, a belt, a hand-off or an item path.**
4. Record the decision in `FACTORY_LAYOUT.stands`, with a one-line reason, and in a table in `notes/M10.md` with the shot names.

**Check these first:**
- belt A's 232-tall legs vs the packer stand and the bead fall;
- the speaker's 220 posts vs the elevator boot and belt D;
- belt B's legs vs the coolant pipe;
- the loop's legs vs belt C's tail and the preamp;
- the packer stand vs belt A's head and belt B's tail.

Decide stands **before** the reveal, because they change `MACHINE_BOX`.

## 5. Camera (`packages/engine/src/camera/camera.ts`, `apps/app/src/factory/views.ts`)

**Local views**
- `LocalView = { name, of: MachineId|'phone', frame: Box3 (local), yaw?, card?: CardKey }` and `PortView = { name, between, pad }`.
- `placeViews(layout, list)` translates them once.
- Reuse the existing local view sets. LINE_VIEWS world boxes become local by subtracting origins.
- **The set:**
  - `fit`, `phone`, `case`;
  - cross views as in v2 `z-*`: `dispenser-A`, `A-packer`, `packer-B`, `B-centrifuge`, `centrifuge-audio`, `release`, `scanner-read`, `audio-C`, `C-crusher`, `scanner-D`, `D-elevator`, `elevator-speaker`;
  - one view per machine (the speaker's at yaw −45).

**16:9 fit and the iOS stage**
- `fitToBounds(bounds, vp, { pad:{t,r,b,l}, aspect? })` fits into the largest centred rectangle of that aspect inside the padded viewport. The renderer gets `setFrame({ pad, aspect })`.
- `aspect` is 16:9 when `rec` / `__v4.record(true)` is on.
- **Landscape card** (window w > h):
  - the stage fills the card, inset only by the 1 px border;
  - fig, title, hint and readout overlay the paper, kept clear by `pad` (t 34, b 34, l/r 20);
  - the chips overlay the top-right;
  - the "i" sheet overlays.
- **No stage size may depend on the chrome, the card text or the sheet.** That was the stale-framing trigger. Target iOS stage ≈ 730×355 pt. Portrait is unchanged.

**Eased transitions:** `camera/ease.ts`, `createCameraEase()` with `to`/`step`/`done`.
- Critically damped, τ 0.35, on the target, log zoom, and yaw/elevation by the shortest angle.
- `setView(v, { ease: true })`. `refZoom` is interpolated, not refit every frame.

**Tour** (`factory/tour.ts`, event-gated)
- `Step = { view, speed?, until?: (g) => boolean, min, max }`.
- **Order:**
  1. `fit` with the reveal, hold 2 s
  2. `dispenser-A`, until the first bead lands
  3. `A-packer`, until packed ≥ 1
  4. `packer-B`
  5. `B-centrifuge` at 2×, until spinning
  6. `centrifuge-audio`, until the first release
  7. `scanner-read`, until the first read
  8. `audio-C`, until the first drop
  9. `C-crusher`, until the first crush
  10. `scanner-D`
  11. `D-elevator`
  12. `elevator-speaker`, until heard ≥ 1
  13. `fit`
- Started by the `tour` chip or `__v4.tour.play()`. Any user view, scene or orbit input stops it.

**Orbit/pan/zoom** (last; on the cut list)
- A PanResponder in `Stage.tsx`: drag = orbit (elevation 10–80°), two fingers or shift = pan, pinch or wheel = zoom (0.5–12× fit), double tap = back to the preset.
- Goes through `renderer.getCamera`/`setCamera`.

## 6. Card

- **One card that follows the view:** `SceneEntry.card` becomes `cardFor(view)`, and each `LocalView` has a `CardKey`. A view switch changes the text, never the stage.
- **At `fit`, `case`, `phone`:**
  - fig "Figure";
  - title "Inside a React Native app" (v2 L412);
  - hint "calls → packets → rings → render loop → speaker";
  - readout `56 quanta · 1.77/s here (375/s real) · 3 disposed` (v2 L379–383, speed-aware);
  - label: the first sentence of `CAPTION`.
- **Machine and cross views:** that machine's existing card and readout formatter, moved from `live.ts`. One readout store serves all of them, via `live.readout.setFormat(fn)` + `flush`.
- **"i" sheet** (`overlay/InfoSheet.tsx`, opened by an `i` chip): v2's full `CAPTION` (L386), plus a 6-swatch legend (fluff, control, graph, data, audio, garbage) taken from the palette tokens. It's an overlay, closable and accessible.

## 7. Verification by eye (argent)

**Where:**
- Web: the built-in pane at 1600×900, plus at most one argent Chromium at DPR 1, closed afterwards.
- iOS: start the sim **in landscape** and restart after any rotation. Read `__v4sizes()` before each capture series.

**Checks:**
1. Static `fit` (sim seeked, reveal skipped) next to `hero.png` / `full-light.png`, plus the `phone` view.
2. Every view in both themes against its `z-*` shot, as a contact sheet.
3. A **120 s soak** on iOS: the ledger balances at 0, 30, 60, 90 and 120 s; no refusal and no `[pool]` warning; every `status()` logged.
4. **Reveal scrub** frames at 0, .25, .5, .75 and 1, in both themes. No machine passes through another, by eye.
5. **One 16:9 landscape iOS recording of the tour:** the reveal plus a full packet journey. Chrome hidden, `rec` on. Transpose and crop to 16:9 with ffmpeg (2144 wide, centred).
6. **Report** (no budget): triangles and batches, cold/warm build, fps and max rAF gap at `fit`, in a machine view and **during the reveal**, plus KB/frame and flatten ms.
7. **Edge cases:**
   - theme toggle mid-reveal;
   - view switch mid-tour;
   - Fast Refresh of `views.ts`, `reveal.ts` and a machine block;
   - backgrounding mid-reveal and mid-tour;
   - a chip, card or sheet change with no stage resize.

## 8. Tests (`packages/engine/tests/factory.test.ts`, `reveal.test.ts`, `camera.test.ts`)

1. **Conservation, 300 s of `createFactoryGraph()`:**
   - `created === alive + consumed` on every step;
   - the dispenser makes about 0.8/s;
   - at least one item is heard and one crushed;
   - §A holds on the factory graph for both controllers;
   - determinism (identical `status()` snapshots).
2. **Ports line up.** A fixture of v2 `qa/ports.json` world pairs (`--ports`, L443–455). Each v4 world port must be within 0.5, or appear in `DEVIATIONS` with a reason:
   - the crusher at `C_END` (M6);
   - belt D's derived in point (M7);
   - the packer's drop (M9).

   `dispenser-A` sits at z 437.
3. **The reveal is rigid.** Sample every machine every 1/240:
   - an orthonormal z-turn with det +1 and no scale;
   - identity at the end, `PACKED` at t = 0;
   - bounded per-sample steps;
   - packed AABBs inside the case and not overlapping;
   - no moved AABBs overlap, except a docking pair during the later member's drop.

   Plus a `store.test`: a `rare` group isn't packed as moving, and nothing is uploaded after the final identity write.
4. **Step order:** ids equal `FACTORY_ORDER`; a wrong add order throws; `createLine` matches with `beads` in place of `dispenser`.
5. **16:9 fit:** the projected box sits inside the padded 16:9 rectangle and touches one pair of its edges.

## 9. Ordered steps, checkpoints, stop rules

0. **Baseline.** Fold in the **M9 review findings** (`scratchpad/m9-review.md` is passed with the brief; the must-fixes first: the packer ports and the packer pool guards). Record the `line` scene's perf and `__v4sizes()`.
1. **Engine graph:** `FactoryLayout`, path builders, `createFactoryGraph`, `sim/dispenser.ts`, tests 1, 2 and 4. **Checkpoint A1:** green, with `createLine`'s tests untouched.
2. **Landscape stage + card, 16:9 frame:** camera `pad`/`aspect`, test 5, Card/App landscape overlay. **Checkpoint A2:** the iOS stage is ≥ 700×340 pt, and chrome, sheet or text changes leave `__v4sizes()` unchanged.
3. **Phone blocks + static `factory` scene,** all stands on, sim paused at 0. **Checkpoint A:** `fit` and `phone` next to `hero.png`/`full-light.png`; the ports test is green.
4. **Full sim live.** **Checkpoint B:** the 120 s soak.
5. **Local views, per-view cards, the "i" sheet, eased transitions.** **Checkpoint C:** every view, both themes, against `z-*`.
6. **Stands decisions.** **Checkpoint D:** the table is filled and `MACHINE_BOX` is updated.
7. **Reveal:** `rare`, `store.groupBounds`, the planner, `PACKED`, test 3, the driver, the scrub hook. **Checkpoint E:** scrub frames in both themes, plus perf during the reveal.
8. **Tour + recording.** **Checkpoint F:** the 16:9 iOS recording.
9. **Orbit/pan/zoom.** **Checkpoint G:** works on web and iOS; lines scale with zoom; the light stays fixed.
10. **Wrap-up:** the §7.7 edge cases; remove `line` from the chips; write `notes/M10.md` (verdict, stands table, perf, deviations) and update the README; commit source and docs only.

**Stop rules** (beyond the global ones: two failures for the same reason, a WebGPU validation error, a pool overflow, a red §A test):
- **Ports:** a mismatch over 0.5 with no recorded deviation → stop and report.
- **Reveal:** if a pair can't be made collision-free after one `PACKED` redesign, lift it over at crossed top + 6. If it still clips by eye → stop and report with the scrub frames.
- **Stale framing:** if iOS stale framing returns after step 2 → stop and report `__v4sizes()`. No native fixes.
- **Performance:** fps sustained below 58, or recurring gaps over 25 ms, at `fit`, in a view or during the reveal → stop, profile only, and report to the user. No LOD and no cuts (§6).

**Risks:**
- **Reveal per-frame cost:** limited by the stagger; lower the number of concurrent movers if needed.
- **Halos float during lifts:** prefer sliding along the floor, and keep lifts low.
- **Long belts limit how tightly things pack:** turn them in `PACKED`.
- **`MACHINE_BOX` drift from the real geometry:** caught by the DEV check.
- **The display doesn't fit 16:9:** see §10.
- **Orbit must stop the tour cleanly.**

**Cut list** (cut first at the top):
1. orbit/pan/zoom
2. the nucleus pulse and screen meter cells
3. dispenser rotor spokes and cage beads (draw the tube opaque)
4. yaw turns in the reveal (translation only)
5. "i" legend swatches
6. per-view readouts (keep the title and hint)
7. dark recordings

**Never cut:** the rigid reveal, `fit` and the views, the card that follows the view, 16:9 framing, the full sim, 60 fps.

## 10. Display framing for 16:9 (decided: option a)

The phone's display floats at z 560 above the case, so the scene is roughly square at the kit camera. The options:
- **(a)** `fit` frames the case and machines for 16:9; the display is mostly out of frame and gets its own `phone` view, which the tour visits;
- **(b)** lower or shift the display so that more of it fits a wide frame (best found: aspect 1.32 at dz 420, shift [160,−160]);
- **(c)** a different `fit` camera.

**User answer (2026-10-14): (a).** The 16:9 `fit` frames the tray and machines so they fill the frame; the floating screen may be cut off at the top. The display gets its own `phone` close-up, and the tour visits it. v2's display geometry stays as it is (z 560, shift [−80,−24]).

## Out of scope (record, don't fix)
- Plan §2.1's dispenser port z 493 / fall 260 is wrong (v2: 437 / 205).
- The bead tube holds 8 vs v2's 4 (M11 rates).
- Glow discs are depth-tested.
- `createShell` `MAX_DT` 0.1 vs the clock's 1/30.
- `flatten` walks every node.
- The root cause of iOS stale framing (worked around, not fixed).
- `LINE_LAYOUT.audio.readAt` is unused.
- The argent watermark.
- Hermes `debugger-evaluate` doesn't await promises.
- Fast Refresh console noise on web.
- Cross-machine contact lines are lost under `rare` movers (none are drawn today).
