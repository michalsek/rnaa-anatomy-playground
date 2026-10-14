# M5–M11 plan: the other machines, the shared sim, the final scene

*2026-10-14. Planning-agent output, filed by the orchestrator.*
- *Ordered steps with checkpoints and stop rules; no time estimates.*
- *Reduced motion is out of scope, so don't port v2 `calm()` branches.*
- *Open questions (§4) are answered by the user before M5 starts; the answers are recorded in §6.*

**References**

| short | file |
|---|---|
| v2 A | `v2-factory/assembly/build.mjs` (final assembly) |
| v2 Cv | `parts/conveyor/conveyor.mjs` |
| v2 Pk | `parts/packer/{packer.mjs, rig.mjs, live.src.js}` |
| v2 Cr | `parts/crusher/crusher.mjs` |
| v2 Sc | `parts/scanner/scanner.mjs` |
| v2 El | `parts/scanner/elevator.mjs` |
| v2 Sp | `parts/screen/speaker.mjs` |
| v2 Ph | `parts/screen/phone.mjs` |

- v2 A's last commit (57eb4f0) is "state when the assembly agent was stopped", so its `qa/` sheets may be stale.
- Take geometry from the per-part sources.
- Take composition from `assembly/hero.png`, `shots/full-light.png` and `shots/z-*.png`.

**Line codes** (as in M2-M4-plan §1): M seam/ring, U UV line set, F free segment, D dot, X contact.

## 1. Census of the v2 machines besides the centrifuge

### 1.1 Conveyor "top": shared, ×4 (belts A, B, C, D)
Build: v2 Cv L134–258. Live: L641–748.

| group | parts | v4 block | extra | motion |
|---|---|---|---|---|
| belt body | top and return runs, 2 drum wraps and cores, 4 flanges, hubs (L56–83) | Box; Lathe | D 6-bolt circle, M rim ring on the near flanges | drums spin; **slats scroll** (U faint) |
| frame | 2 rail channels and lips, carrying and return idlers, axle nuts, pillow blocks (L156–190) | Box r; Lathe idlers (static instancing §2.4) | D screws | – |
| drive | gearbox (seam, cover with bolt circle, breather), ribbed motor, fan cowl, terminal box (L109–121, L193) | Box, Lathe (graphite) | U ribs, F vents, D | – |
| guides, plate, lamp | guide bars on arms and posts (L203); label plate (L98); run lamp, lit (L91) | Box; Extrude circle; Lathe + Glow | F 3 rules, 2 D | lamp steady |
| legs (`legs:false` in v2 A) | legs, feet with anchor screws, braces | Box; Extrude | D | – |
| items | parcels and beads | Instances | M band, F strap | fall from `item.v` (quadratic bend L619–639), ease to speed with a hop, queue or `hold`, tip round the head drum, emit with v |

### 1.2 Conveyor "loop": the audio belt / render loop
Build: v2 Cv L262–470. Live: L752–939.

| group | parts | v4 block | extra | motion |
|---|---|---|---|---|
| truss | top and bottom chords, riveted end plates and verticals (L294) | Box | D rivet rows | – |
| rollers | carrying idlers and stubs, return rollers on hangers (L316–345) | Lathe; Box | – | – |
| take-up | rails, slide block, bracket, rod, split coil spring with hooks, nut (L356–400) | Box; Lathe; Tube (helix) | – | – |
| drive | shaft-mounted gearmotor at the head, torque arm (L404–431) | Box, Lathe (graphite) | U ribs | head drum spins |
| read lamp | on the bottom chord at `readAt`, lit (L401) | Lathe + Glow | – | – |
| cleats and bails | ~27 cleats; bail straps swing out under the drum and fold back over 0.3 s (L788–806) | pools on a stadium path, **pitched** on the wraps | – | ride the loop |
| parcels | top run → round the head → hang under the bottom run → **greyed at the read point over 0.6 s** → round the tail → top → drop at the bottom of the head drum as garbage with v (L870–905) | pool, pitched | M, F | `quanta()`, `canTake(lead)` (L908–936) |

### 1.3 Packer
Build: v2 Pk `packer.mjs` L22–280. Rig: `rig.mjs`. Live: `live.src.js` (gutter L41, lane L94, flaps L160, picker L250, folder L338).

| group | parts | v4 block | extra | motion |
|---|---|---|---|---|
| deck | deck with T-slots and bolt rows, 2 turned lane columns with bolt circles, bed, rail and posts | Box; Lathe | D rows, F slots | – |
| magazine, pusher, erector | magazine posts, gate, hopper, cap, knob; pusher block, body, gland, ports; bridge posts, beam, cylinder, pad | Box; Lathe | – | pusher slides a blank out; pad lifts; the stack shows the coming colours (pool) |
| gutter | post, floor, walls, 3 pockets, photo-eyes, 3 LEDs, stop, lips | Box; Lathe | – | beads roll in; LEDs (**style blend**) |
| 2 arms | pedestal, turret, slewing ring, yoke, cheeks, servo cans, 2 stadium links (recess outline), caps, 2 drag chains, wrist; tools: picker (3-cup vacuum bar, React-blue lit) and folder (tape head) | Extrude `rect r=h/2`; Lathe; Tube | F recess, D pins | turret yaw + 2-link planar IK, wrist kept level (nested `moves` groups) |
| cartons | at S0, S1 and S2: floor, 4 walls, 4 flaps, 3 beads | 3 station groups + flap groups | – | walking beam (pitch 11); flaps spring (ω 14, ζ 0.7); fold; tape; packet onto belt B at [0, 27, 200] |
| cabinet, manifold | door, hinges, handle, label, louvres, lamp; valve manifold with 2 valves and coils; 2 cables, 2 hoses | Box; Tube | F louvres, rules | lamp lit while the vacuum holds |
| stand (`stand:false` in v2 A) | legs, stringers, braces, shelf, air receiver, pump | – | – | – |

### 1.4 Crusher
Build: v2 Cr L19–372 (section comments). Live: L486+.

| group | parts | v4 block | extra | motion |
|---|---|---|---|---|
| base and housing (L51–91) | skids on 4 feet, cross members, side plates, walls, gear guard, rating plate | Box; Extrude polygon | D, F rules | – |
| rollers (L92) | 2 toothed rollers, 7 rings each | Lathe rings + U `sectors` teeth | U | spin; speed up while the photo-eye sees a packet (settle) |
| hopper (L111) | 4 flared wall slabs and lips, 2 wear liners | Extrude polygon, rotated | D countersunk screws | – |
| bearings (L140) | fixed back block, sliding front block on rails, coil spring, abutment | Box; Tube helix | – | front block kicks back (underdamped); spring compresses (**scale**) |
| drive (L159) | flywheel with 6 holes, rubber V-belt, 3-piece pulley, motor on a slide base, terminal box | Lathe; Belt; Extrude | U lacing marks | flywheel and pulley spin; lacing scrolls |
| discharge and bin (L234–291) | chute and cheeks, slide gate, drawer bin on casters with a hazard band and handle, floor grate | Box; Extrude | **U stripes (new)**, F grate | gate; drawer rolls out 16, dumps, rolls back |
| control box (L292) | pedestal, amber lamp (lit), step-counter dial and needle, label, buttons, key, vents, conduit, cable | Lathe; Box; Tube | U 20 ticks, F needle | needle steps 1/20 per disposal; lamp attack/decay (**amber glow**) |
| live (L547+) | tumbling packet, squash, flakes in 7 lanes, pile slab, chips | pools with **pitch and scale** | – | – |

### 1.5 Scanner: the read arm
Build: v2 Sc L21–147. Live: L148–334.

| group | parts | v4 block | extra | motion |
|---|---|---|---|---|
| base and pedestal | floor plate, 4 feet, groove, label plate; flange, column with 2 seams, 4 gussets, cap, deck casting | Box; Lathe; Extrude polygon | M, D, F rules | – |
| arm and VCM | pivot flange, bearing cartridge, hub, clamp nut; E-block with 2 lightening slots and a trace, load beam, slider; VCM plates, 2 magnets, 3 standoffs, 2 crash stops, coil and fork | Lathe; Extrude polygon; slots as F outlines on dark insets | F trace | arm sweeps ±17° tracking a cleat; 0.16 s seek |
| flex, cable, park ramp | flex bracket and boss, flex ribbon, round cable to the preamp; ramp bar, post, tongue | Tube; Box | – | **mint pulse** along the cable, in chunks (style blend) |
| lamp and preamp | status lamp (mint, lit); preamp on 4 legs, lid, 7 fins, input boss, 4-cell window, output lip | Lathe + Glow; Box | D | glow burst per read; cells fill; 4 reads → 1 audio packet onto belt D |

### 1.6 Bucket elevator
Build: v2 El L21–295. Live: L296+. v2 A sets `access:false` (no ladder, cage or landings).

| group | parts | v4 block | extra | motion |
|---|---|---|---|---|
| boot, take-up | housing with feed opening, flange with slots, inspection door; in-feed chute; take-up bars, slide, rod, nut, bearing | Box; Lathe | D | packets slide down the chute (depth hides them inside) |
| tower | 4 posts on base plates, splice plates, girts on 4 faces × 10 levels, gussets | Box (static instancing) | D bolts, M | – |
| chain | guide channels, twin link strands | Box with **scrolling U** (no pin pool) | U | 30 u/s |
| head | ring and side beams, pillow blocks, shaft, hub flanges, 2 toothed sprockets, hopper, duct, down-spout, flange | Lathe with U fading teeth; Box; Tube | U | sprockets spin |
| drive | right-angle gearbox, torque-arm beam, ribbed motor, terminal box, drive lamp | Box; Lathe | U ribs | lamp |
| cradles | 14 cradles, lift 210 | pool on a stadium path, pitched | – | lift; fling (parabola); 0.5 s hidden transit; slide out of the spout to [0, −74, 234] |

### 1.7 Speaker
Build: v2 Sp L11–224. Live: L225+. `stand:false`.

| group | parts | v4 block | extra | motion |
|---|---|---|---|---|
| driver | back plate, magnet, top plate, stamped dish, 4 arms with windows, spider, former, mounting ring with 4 slots | Lathe; Extrude sector | F slots | – |
| baffle | 4 ring quarters, 4 ears, connector, terminal block, 2 wires | Extrude sector; Box; Tube | – | – |
| cone | roll surround (closed tube), mint cone, dust cap | Tube; Lathe (**mint**) | M | cone pumps +z (damped, 4.6 Hz, amplitude 2.4); cap ×1.35 |
| throat | mouth, feed ledge, flap, 6-LED meter with peak hold | Box; Extrude | – | packet falls onto the ledge, slides in; LEDs jump (style blend) |

### 1.8 Phone: case, display, dispenser
Build: v2 Ph L11–304. Live: L333–447. v2 A sets `walls:"low"`, `controls:true`, `displayShift`.

| group | parts | v4 block | extra | motion |
|---|---|---|---|---|
| case | back plate, low band (4 Box sides + 4 Extrude sector corners), buttons, USB-C recess, floor plates, 6 standoffs, 4 bosses | Extrude; Box | F plate outlines, D | – |
| display | OLED slab (graphite), cover glass, dark screen gradient, React logo (3 ellipses + nucleus), glow, island, home indicator, ripple, 4-cell meter | Extrude rounded rect; gradient tone; **Marks ellipses on a `moves` group**; sprites | – | logo turns slowly; glow; ripple on a burst; cells fill per scanner read |
| dispenser | plate, drop pipe, collars, glass sight tube with beads, star-valve with sight glass and rotor, gearmotor, knurled nozzle (React) | Lathe; Box | U knurl | bursts of 2–3 beads every 2.6–3.6 s; one released per 0.9–1.25 s; the bead falls 260 onto belt A |

### 1.9 New engine and blocks capabilities

| # | capability | needed by | how |
|---|---|---|---|
| E1 | **scrolling line sets** (shared): per-instance u-shift | slats on every belt, chain strands, V-belt lacing | `Instance` grows from 80 to 96 B: + `style2: u32`, `mix: f32`, `uShift: f32`, pad. No new binding; still at most 8 storage buffers. |
| E2 | **style blend** (shared): the fill mixes `style` and `style2` tones by `mix`; set through a `PartHandle` | read-point greying, LEDs, preamp cells, speaker meter, cable pulse, lamps | same struct as E1 |
| E3 | pool **pitch on a path** plus pool-only **axis-aligned scale** (`POSE_FLOATS` 6 → 9, store.ts L265, `scalable` pools only) | cleats and parcels on drums, cradles, squash, pile, coil spring | box-face normals stay exact under axis scale, since the shader renormalises `model·n` |
| E4 | `sim/path.ts`: stadium loop path, u → position, tangent, normal | loop belt, elevator, top-belt tip | plain TS |
| E5 | materials `pkAudio` (mint), `pkGarbage`, `fluff`, `mint`, `amber`, `rubber`; per-sprite glow colours | all | palette only |
| E6 | line-set kind `stripes` (diagonal) | crusher bin band | `shaders.ts` |
| E7 | helix path helper | coil springs | for the existing Tube |
| E8 | dirty-range instance upload; moving slots packed last | perf | renderer L362–364 + store `flatten` |
| E9 | lathe/extrude step LOD by radius | perf | `geo/lathe.ts`, `extrude.ts` `circleSteps` |
| E10 | static instancing of prototypes repeated ≥ 8× | perf, only if measured | a "static pool" batch, written once |
| E11 | orbit/pan/zoom input; eased view transitions | final scene | `Stage.tsx` PanResponder + web `onWheel`, via `renderer.getCamera`/`setCamera` |

Not needed:
- **polygon holes:** slots are F outlines over dark insets;
- **glass:** cut (the sight tube is opaque with a window inset);
- **text:** cut (screen glyphs are shapes only).

## 2. The final scene

### 2.1 Layout (world; recomputed from v2 A L23–113)
- The origin is the centre of the case floor; z is up.
- Every machine is placed by translation only.

| id | origin | key options | ports (world) |
|---|---|---|---|
| case | [0,0,0] | w 360, d 760, r 44, depth 280, lip 36 | – |
| display | shift [−80,−24], underside z 560 | – | – |
| dispenser | [20,−190] under the display | – | `fluff` [20,−190,493], v [0,0,−150] |
| beltA | [−4,−190,0] | axis x, dir +1, L 61, top 232, w 20, inAt 24 | out [57,−190,232] |
| packer | [100,−190,0] | `stand:false` | in [72,−190,232]; out [100,−163,200] |
| beltB | [100,−158,0] | axis y, dir +1, L 177.8, top 192, inAt 2, `hold` | out at the funnel |
| centrifuge | [100,68.8,0] | (v2: `stand:false`) | in [100,36.8,186]; out ≈ [95.5,119.9,100] |
| audio (loop) | [−90,119.9,0] | axis x, dir −1, L 197.5, top 92, drum 15, inAt 185.5, readAt 120 | drop at the head drum, x −90, z 47.8 |
| scanner | [30,81.9,0] | belt "audio" | out [−47,86.9,24] |
| beltD | [−47,−175,0] | axis y, dir −1, L 249.9, top 24, speed 28 | out at the elevator |
| elevator | [−47,−226,0] | lift 210, outDir −y, reach 40, `access:false` | in [−47,−187,24]; out [−47,−300,234] |
| speaker | [−109,−300,0] | height 220, `stand:false` | in [−45,−300,205] |
| beltC | [−90,97.9,0] | axis y, dir +1, L 110, top 40, inAt 22 | out at the crusher |
| crusher | [−90,237.9,0] | – | in [−90,237.9,37] |

**Flow** (v2 A L279–293):
1. Fluff beads fall from the dispenser onto belt A, then into the packer's gutter.
2. The packer turns 3 beads into 1 packet, cycling kinds round-robin (control, graph, data), onto belt B.
3. Belt B holds while `!centrifuge.canAccept()`.
4. The centrifuge fills, spins, and releases one packet per quantum, phase-locked to `audio.quanta()`, but only when `audio.canTake(lead)` is true.
5. Each parcel on the audio loop goes round the head, hangs under the bottom run, and is greyed when the scanner reads it at readAt.
6. Its second time round the head, it drops as garbage onto belt C, which feeds the crusher (flakes, bin, a dump at 10).
7. Separately, the scanner reads one cleat gap per quantum. Every 4 reads make one mint audio packet onto belt D, which goes up the elevator and into the speaker.

**Rates at v2 values:**
- beads ≈ 0.8/s, so packets ≈ 0.27/s;
- quantum 0.57 s (loop speed 32, cleat gap 18.27);
- audio packets 0.44/s;
- the elevator's capacity is ≈ 0.8/s.

### 2.2 The shared simulation (`packages/engine/src/sim/`, plain TS, no RNG)
- **`clock.ts` `createFactory({ H: 1/120, maxSteps: 8 })`:** machines, links, `acc`.
  - `advance(dt, speed)` is today's centrifuge `advance`, lifted up one level; `run(s)` is used for seek and tests.
  - The step order is fixed, with each reader stepping before the belt it reads: dispenser, beltA, packer, beltB, centrifuge, scanner, audio, beltC, crusher, beltD, elevator, speaker.
- **`ports.ts`:**
  - `Receiver { canAccept(lead?): boolean; accept(item, from: V3, v: V3): void }` and `link(a,'out',b,'in')`.
  - Machines are placed by translation; the hand-off converts local → world → local (v2 R `route`).
  - Belts expose `quanta(): { phase, period, count }` and `canTake(lead)`.
- **`items.ts`:**
  - `ItemKind` = fluff, control, graph, data, audio, garbage.
  - Each pool maps kind → style index explicitly; this replaces `Kind = 0|1|2`.
  - A conservation counter: `created = alive + consumed`.
- **`conveyor.ts`** (v2 Cv L641–748) and **`loop.ts`** (L752–939), both on `path.ts`.
- **`source.ts`, `sink.ts`:** timed spawners (M4's burst pattern, `FEED_MAX`) and absorbers.
  - The M4 stubs become a real `conveyor` (belt B end, `hold`) and a real `loop`.
  - Delete the stub code in sim/centrifuge.ts and `Stubs.tsx`.
- **Centrifuge split, keeping the spin modular:**
  - `centrifuge/packets.ts`: throat, falls, pockets, release path, unchanged from M4;
  - `centrifuge/controller.ts`: the `{ mode, A, w, step(h, io) }` interface. The default implementation is today's index/spin/down plus the §A lock.
  - Injected: `sync: () => { phase, period }` (rate = 1/period), `canRelease = out.canTake`, `HOLD`.
  - A different spin model after the final-scene review becomes a new controller under the same tests.
- **Render side:**
  - Each machine sim exposes `outputs(o)`, `items(cb)` (local poses, extrapolated by `acc`) and machine-specific poses.
  - Each machine owns its pools under its `<Machine>` group.
  - Hand-offs are continuous in pose.
- **App:** `apps/app/src/factory/live.ts` builds the graph per scene (centrifuge-only, line, …, factory) with one `__v4.sim` (seek, pause, speed, log, `status(id)`).

### 2.3 Camera
- **Views** (`factory/views.ts`, named after v2 `assembly/shots/z-*`):
  - `fit` (all, including the display), `floor` (case only);
  - per-machine frames: `dispenser-A`, `packer`, `centrifuge`, `centrifuge-audio`, `scanner-read`, `audio-C`, `crusher`, `elevator`, `elevator-speaker`.
- **Eased transitions:** a critically damped settle (τ ≈ 0.35 s) on target, zoom, yaw and elevation. This also drives a scripted tour for recordings.
- **Orbit/pan/zoom (E11):**
  - drag = orbit, elevation clamped to 10–80°;
  - two-finger or shift-drag = pan;
  - pinch or wheel = zoom (0.5–12 × fit);
  - double tap = back to the preset.
- Lines keep scaling with zoom, and the light stays fixed to the camera.

### 2.4 Perf budget: the centrifuge numbers don't scale for free

**Triangle estimate:**

| part | triangles |
|---|---|
| 4 top belts | ≈ 45k |
| loop | ≈ 30k |
| packer | ≈ 45k |
| crusher | ≈ 35k |
| scanner | ≈ 12k |
| elevator | ≈ 25k |
| speaker | ≈ 10k |
| case, display, dispenser | ≈ 15k |
| centrifuge | 51k |
| **total** | **≈ 270k (±30%)** |

**Where it bites:**
- GPU: one static draw with MSAA is fine.
- CPU, cold Hermes build: roughly linear in triangles, so ≈ 1.7 s.
- The renderer uploads the whole instance table when anything is dirty (≈ 140 KB/frame at ≈ 1.7k instances).
- `flatten` visits every node and every pool's full capacity.

**Budget:**
- ≤ 200k triangles after LOD;
- ≤ 24 draws;
- cold Hermes build ≤ 1.5 s; warm ≤ 250 ms;
- 60 fps on the iOS sim at `fit` and in a machine view, with the max rAF gap < 25 ms;
- sim + flatten + upload ≤ 4 ms p95 on Hermes.

**Levers, in order:**
1. E8 (do it in M5 regardless).
2. E9 LOD.
3. `contacts={false}` by default (keep it on for the centrifuge and crusher).
4. E10 static instancing.

### 2.5 Overlay card
- **One `Card` whose text follows the view.**
  - At `fit`/`floor`:
    - fig "Figure"; title "Inside a React Native app" (v2 A L412);
    - hint "calls → packets → rings → render loop → speaker";
    - readout `56 quanta · 1.77/s here (375/s real) · 3 disposed` (v2 A L379–383);
    - accessibility label: the first sentence of v2 A `CAPTION` (L386).
  - In a machine view: that machine's `CARD` and readout.
- **"i" sheet:** v2's full caption plus a 6-swatch legend of the packet colours.
- **Chips:** scene, view, run, dbg, theme, plus speed (½, 1, 2×).

## 3. Milestones

**Verification for every milestone:**
- argent screenshots on web (built-in pane, plus at most one argent Chromium at DPR 1, closed afterwards) and on the iOS sim, light and dark, at fixed sim times via `__v4.sim.seek`;
- one full-cycle iOS recording;
- a by-eye comparison with the named v2 page (`parts/*/*(-light).html`, freshly captured) and the `assembly/shots/z-*.png` crop;
- `pnpm test` and `pnpm types` green, no WebGPU validation errors, DEV counts logged;
- commit source and docs only; write `notes/M<n>.md` and update the README.

**Global stop rules:**
- A checkpoint that fails twice for the same reason → stop and report.
- A WebGPU validation error or a pool overflow → stop.
- A perf miss after the levers → report the numbers rather than redesign.

### M5: shared sim layer, real conveyors, the centrifuge between real neighbours
**Outputs:**
- `sim/{clock, ports, items, path, conveyor, loop, source, sink}.ts`;
- the centrifuge split into `packets` + `controller`, with `sync` injected;
- E1, E2, E3, E5, E8;
- `machines/conveyor/{Top, Loop}.tsx` with a `legs` prop;
- the `centrifuge` scene rewired (stubs deleted) and a new `line` scene;
- a gallery row for E1–E3.

**Steps:**
1. **Sim refactor.** **Checkpoint A:** the M4 tests are green with source + top belt replacing the stub feeder and a top belt receiving releases; the phase order is kept. The §A tests are adapted, never weakened.
2. **Conveyor and loop sims, with tests:**
   - hold and queue spacing;
   - `canTake` never refuses a sender that asked first;
   - `quanta().phase` wraps once per cleat gap;
   - the parcel path order: top → head → bottom → greyed → tail → top → drop;
   - conservation over 120 s.
3. **E1/E2/E3/E5/E8 plus the gallery row.** **Checkpoint B:** scrolling slats, a pitched cleat round a drum, a blended packet.
4. **`Top` and `Loop` blocks.** **Checkpoint C:** a static conveyor scene next to `conveyor(-light).html`.
5. **The `line` scene.** **Checkpoint D:** the centrifuge releases one packet per loop quantum onto free cleats; parcels hang and grey at the read point.

**Go/no-go:**
- the conveyors read as `conveyor.html` in both themes;
- a full centrifuge cycle on the real loop;
- no pops at hand-offs;
- 60 fps on the iOS sim;
- triangles, build time and per-frame cost recorded and extrapolated.

**Stop rules:**
- If the lock can't hold the loop quantum after one fix, keep a period override and report.
- If the line scene exceeds 120k triangles, do E9 first.

### M6: garbage path (belt C + crusher)
**Outputs:**
- `sim/crusher.ts`: photo-eye speed settle, nip, squash, 7-lane flakes, gate, bin dump at 10;
- `machines/crusher/*`;
- E6, the amber glow, E7;
- the `line` scene extended;
- a `crusher` scene with a source.

**Checkpoints:**
- A: tests (conservation, dump cycle).
- B: static, next to `crusher(-light).html`.
- C: the loop drop → belt C → hopper, against `z-audio-C`.

**Go/no-go:** the rollers eat the packet, the needle steps, the drawer dumps and returns, the lamp pulses.

**Stop rule:** if E3's squash looks wrong on rounded corners, sink the packet without scaling and note it.

### M7: read path (scanner + belt D)
**Outputs:**
- `sim/scanner.ts`: cleat tracking, 0.16 s seek, a read per quantum, a packet per 4 reads, pulse timing;
- `machines/scanner/*`;
- the mint lamp and the cable pulse (E2 chunks);
- belt D, ending in a sink.

**Checkpoints:**
- A: tests (reads = quanta; packets = ⌊reads/4⌋).
- B: static, next to `scanner(-light).html`.
- C: `z-scanner-read`, `z-scanner-D`.

**Go/no-go:** the head stays over a cleat and never crosses parcels; cells fill; packets leave the preamp lip onto belt D.

### M8: output path (elevator + speaker)
**Outputs:**
- `sim/elevator.ts`: cradles on E4, fling, hidden transit, spout;
- `sim/speaker.ts`: ledge, throat, cone impulse, meter;
- `machines/{elevator, speaker}/*`.

**Checkpoints:**
- A: tests (boot queue ≤ 1 at 0.44/s; heard = lifted).
- B: static views.
- C: `z-D-elevator`, `z-elevator-speaker`.

**Go/no-go:** cradles round the sprocket without pops; packets hide inside the duct by depth; the cone pumps.

### M9: input path (dispenser stand-in, belt A, packer)
**Outputs:**
- `sim/packer.ts`: gutter, walking beam, erector, flaps, arm IK targets, interlock (v2 Pk `live.src.js` L41–428);
- `machines/packer/*`, with the IK in a pure helper tested in Node;
- a temporary bead source.

**Checkpoints:**
- A: tests (3 beads/packet, the kind round-robin, the interlock never violated, the 60 s balance from v2 NOTES).
- B: static, next to `packer(-light).html`.
- C: arms through 3 full packets, against `z-A-packer`.

**Stop rule:** if the IK pops or clashes after one fix, switch to keyframed joint poses sampled from v2's IK and note it.

### M10: the final scene
**Outputs:**
- `machines/phone/*`: case, display with the logo screen, the real dispenser;
- a `factory` scene placing everything per §2.1, with the full §2.2 graph;
- views, transitions and orbit (§2.3);
- the factory card and "i" sheet (§2.5);
- perf levers as needed.

**Steps:**
1. **Static layout.** **Checkpoint A:** `fit` next to `hero.png`/`full-light.png`; ports line up (v2 A `--ports`, L443–455).
2. **Full sim.** **Checkpoint B:** a 120 s soak with conservation, no refusals, no overflow.
3. **Camera and card.** **Checkpoint C:** every view, both themes, against `z-*`.
4. **Perf.** **Checkpoint D:** the §2.4 budget.

**Go/no-go:** one recording through a full packet journey (beads → speaker, garbage → crusher) on iOS and web, against v2 `factory(-light).html`.

### M11: review, centrifuge spin revisit, recordings
**Covers:**
- the user's review of M10;
- a new centrifuge controller if asked (same tests);
- rate tuning;
- one tuning round;
- the tour and recordings for social;
- the cut-list decisions.

**Stop rule:** controller changes keep the §A tests green.

### Cut list (cut first at the top)
1. ~~explode/open slider~~: kept as the packed → assembled reveal (§6)
2. screen glyphs
3. packer tape-strap growth and the carton→packet blend
4. crusher spring compression, belt lacing, chute vibration, flake lanes and gate queue, chips
5. scanner flex bend and cable pulse (keep the lamp)
6. speaker peak hold
7. orbit/pan (keep presets and eased transitions)
8. dark recordings

**Never cut:**
- the shared clock, ports and conveyor sims;
- the item story end to end;
- each machine's main motion;
- `fit` and the per-machine views;
- 60 fps.

## 4. Open questions (answers in §6)
1. **Assembly look:** v2 final (low tray, floating display, machines hung without stands) or v2a (tall far walls, card legend, no explode)?
2. **Stands/legs:** hang the machines as v2 A does, or keep them?
3. **Explode slider:** build or cut?
4. **Card:** one card whose text follows the view, per-machine cards, or one static factory card?
5. **Rates:**
   - At v2's rates the centrifuge fills slowly (cycle ≈ 30 s+): speed up the dispenser, lower HOLD, or accept it?
   - The quantum is now 0.57 s (loop belt), so in-sync ≈ 10.5 rpm instead of 14.3.
6. **Recording format:** 9:16, 4:5 or landscape?
7. **Viewer orbit**, or only scripted camera moves?
8. **Playback controls** on the phone screen as in v2, or chips only?

## 5. Out-of-scope problems in existing code
- `createShell.ts` `MAX_DT = 0.1` (the kit says 1/30).
- `renderer.ts` L362–364 uploads the whole instance table on any dirty frame (fixed by E8).
- `store.ts` `flatten` visits every node and every pool's full capacity per dirty frame.
- The scene layout is at 8 storage buffers per stage; E1/E2 extend `Instance` instead of adding a binding.
- Glow discs are depth-tested, so lamps behind thin parts lose their glow.
- `Kind = 0|1|2` doubles as the pool style index (replaced by `items.ts`).
- `Stubs.tsx` duplicates sim constants (gone in M5).
- The `centrifuge.test.ts` timeline assumes the 0.42 s stub period.
- The v2 assembly was stopped mid-work, and the part `qa/` sheets predate REVIEW; take geometry from part sources.

## 6. User answers
*(filled in by the orchestrator)*

- **Reveal / explode (Q3), user, 2026-10-14:** v2's final-scene reveal was wrong. It made the machines and parts *surface out of a void* inside the phone. The intended reveal:
  - The machines start **squished together inside the phone**, packed tightly in the case.
  - They spread out to the assembled layout.
  - It is a **rigid move only**: each machine (and its parts) is translated or rotated. Nothing is scaled, morphed, clipped, or faded in from nothing.
  - Implement it as a packed layout plus the §2.1 layout, interpolated per machine (translation, plus an optional yaw), and staggered so parts don't pass through each other.
  - So the explode slider is **not cut**: it becomes the reveal, and needs no clip box.
- **Assembly look (Q1/Q2), user:** use the v2 final layout, but **keep the stands on machines whose stands don't cover other parts of the factory**. The v2 agent removed stands too aggressively.
  - Every machine block gets a `stand`/`legs` prop, defaulting to on.
  - In M10, decide per machine by eye from `fit` and the per-machine views.
  - Remove a stand only where it hides another machine, a belt or the packet flow.
- **Card (Q4), user:** one card whose text follows the view (§2.5).
- **Rates (Q5), user:** decide in the M11 review. Build with v2's values for now, and keep the rates (dispenser rate, HOLD, loop speed) as single constants that are easy to tune.
- **Recording format (Q6), user:** 16:9 landscape. Size the `fit` view and the camera tour for 16:9.
- **Orbit (Q7) and playback controls (Q8):** not asked; orchestrator defaults.
  - Build cheap orbit/pan/zoom (it stays on the cut list).
  - Chips only, with no on-screen phone controls.
  - Revisit both in M11.
- **Triangle budget (§2.4), user, 2026-10-14:** ignore the 200k triangle limit, and don't cut detail or add LOD/instancing pre-emptively.
  - Keep reporting triangles, cold build and fps per milestone.
  - Only if fps starts dropping: run an agent that finds where the problem lives (profile first), then report to the user, who decides what to do.
