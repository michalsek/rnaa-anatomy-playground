# M3 plan: full static centrifuge

Reduced motion is out of scope (user decision, 2026-10-14). Step 1 removes the unused `motion.reduced` / `onFrame` `reduced` plumbing from the SceneStore.

*2026-10-14. Planning-agent output, filed by the orchestrator with the day estimates removed. Work in step order with checkpoints; verify by eye. This plan follows M2-M4-plan §1 (census) and §2 (M3 row).*

> **Superseded:** the tach phase, crank and needle angles below are replaced by [M3.md](M3.md) "Deviations" (face frames: tach phase 15, crank arm 25°, sync tick and needle 54°).

*Sources of truth for geometry:*
- *`v2-factory/parts/centrifuge/centrifuge.mjs` (final);*
- *`build.mjs` (stubs).*

*`qa/z-*.png` and `qa/dark.png` predate the final geometry (the cabinet was still front-left, the hub still a cone). Use them for tones and framing only. Judge geometry against `shot.png` and `centrifuge(-light).html`.*

## 0. Conventions (state once, apply everywhere)

### Axes and units: 1:1
- The v2 kit and the v4 camera use the same projection: yaw 45°, elevation 30°, z up, `X = x·sinA − y·cosA`. `camera.ts#kitProject` is the kit's `iso`.
- v2 `L(x,y,z)` (relative to origin `[100,66,0]`) = v4 machine-local world coordinates, 1 unit = 1 unit.
- Angles are degrees CCW from +x. The machine sits at `[0,0,0]`.
- For `build.mjs` stubs, subtract `[100,66,0]`.

### Profiles flip
- v2 `turned(F, [[s, r, smooth?]…])` lists the side only.
- v4 `Lathe` needs `[r, s, smooth?]`, closed axis-to-axis.
- `disc(r, s0–s1)` = `[[0,s0],[r,s0],[r,s1],[0,s1]]`.

### Frames
- A v2 frame `{o, a, u, v}` maps to model z = a, model x = u.
- Add `placeFrame(F) → { position, rotation: Euler°, mirror }` to `dims.ts`.
- `mirror` is true when u×v = −a. Then map polygon (u,v) to (u,−v), reverse the winding, and negate angular phases.
- **Shortcuts:**
  - Vertical axis at (x,y): position `[x,y,0]`, no rotation, profile s = absolute z.
  - Radial face frame `F(deg, z)` (v2 `faceFrame` / `bowlFrame`): position `[0,0,z]`, rotation `[0,90,deg]`, profile s = radial distance.
- Under `F(deg,z)`:
  - model +x = down, model +y = dir(deg+90);
  - a v2 face angle θ (measured from up, toward viewer-right) is model angle **θ+180°**.

### v2 builder → v4 block

| v2 | v4 |
|---|---|
| `ctx.box(a,b,{r})` | `Box size=b−a center=(a+b)/2 r` |
| `ctx.slab(plan{x,y,w,d,r}, z, h)` | `Extrude plan={{rect:[w,d], r}}`, positioned at the plan centre, `z`, `height` |
| `ctx.cyl(x,y,r,z0,h)` | `Extrude plan={{circle:r}} z={z0} height={h}` at `[x,y,0]` |
| `ctx.prism(sector/rect)` | `Extrude sector` (degrees) / `polygon` |
| `G.prismOf(F, poly, s0, s1)` | `Extrude polygon` + `placeFrame` |
| `cable` / `pipe` | `Tube` |

### Lines
- `inner: Ln(arcOf/sideSeam/sideArc)` (faint) → `seams: [z]`.
- `k.ring` (lo) on a top face → profile knot + `marks: [i]` with crease `lo`.
- `Dots(dotsOf(F, s, r, n, {phase rad}))` → `boltCircle({ center, axis: a, r, count: n, phase: deg, size })`. v2 dot sizes carry over unchanged as CSS px at fit.
- `tone: lo / hi` on a solid → `outline`.

### Contacts are opt-in in this machine
`<Machine id="centrifuge" contacts={false}>` (new, §2.7). Only the census X parts set `contacts`, and both sides of each pair do:
- bowl × ribs and pads
- posts × ring
- nipple × bearing body
- ports × cooler
- drain stem × valve body

### Notation used below
- `L(r, z0–z1)` = lathe disc
- `C(r) z0+h @(x,y)` = extruded circle
- `B[x0..x1, y0..y1, z0..z1] r` = rounded box
- `S(r0–r1, a0→a1) z0+h` = extruded sector
- `•n R @z s` = n dots at radius R, height z, size s
- `|z` = seam
- `hi` / `lo` = outline tone; `gr` = graphite material

## 1. Composition: `apps/app/src/machines/centrifuge/`

### `dims.ts`
- v2 constants: `Z`, `R_`, `SPOUT_DEG=−90`, `GATE_DEG=95`, `GATE_HALF=9`, `LEG=24.5`, `MOTOR=[46,0]`, `FUNNEL=[0,−23]`, `TACH 50`, `LAMP 74`, `CRANK 118`, `DRAIN 20`, `COOL [−24,4]`, `SHELF_TOP=74.1`.
- Helpers: `polar`, `dir`, `F(deg,z)`, `placeFrame`.
- Rotor rest angle **A0 = −108°** (`SPOUT − ½·36`).
  - Pocket k centre: −90 + 36k.
  - Vane i: −108 + 36i.

### `Centrifuge.tsx`
- `<Machine id="centrifuge" contacts={false}>` with the groups below.
- `CENTRIFUGE_VIEWS` (§5) and the `CARD` text (§3).
- Module constants live in a separate non-component module, per the M2 review's Fast Refresh fix.
- The static state is the shot's "in sync" moment.

### Moving parts (★)
- `moves` groups for M4: `rotor`, `motorPulley`, `gate`, `crank`, `needle`.
- The `lampGlow` sprite handle.
- Pools `packets` and `stubBelt.slats` exist but are posed once in M3.

### `Stand.tsx` (v2 L151–212)
- **halo:** sprite (§2.2), plan centre (0,0), 68×68, r 30, floor z 0.
- **skid ×2:** `B[−40..40, ±24.5∓3.5..±24.5±3.5, 0..4] r.6`, lo, `|2`.
- **eye ×4:** at (±36.5, ±24.5, 6.3), axis y, band r 1.25–2.3, s ±0.6. Built as a closed `Tube` ring (centreline r 1.775, radius 0.525).
- **foot ×4:** at (±24.5, ±24.5), `C(5) 4+1.6`, lo. 4 dots at r 3.8, angles 45+90i, z 5.6, size .4.
- **leveller ×4:** `C(3.2) 5.6+3.4 |7.3`.
- **leg ×4:** rect 5×5 r .6, z 9+87, `|34 |70`.
- **leg-pad ×4:** rect 9×9 r .8, z 96+2.2. 3 screws per pad (dot .4 + ring .9 polyline) at (wx±2.6, wy±2.6), on the outer corner and its two neighbours, z 98.2.
- **isolator ×4:** lathe `[[0,98.2],[2.4,98.2],[2.9,98.7,1],[3.1,99.1,1],[2.9,99.5,1],[2.4,100],[0,100]]`, lo, `subdivisions: 3`.
- **rail ×4:** z 22+4, r .4. x-runs `B[−22..22, ±24.5±1.5]`; the y-runs mirror them.
- **rail-upper ×2:** the x-runs at z 58+3.
- **shelf:** rect x 27..48.5, y −27..27, r .8, z 71.6+2.5, `|72.85`. Screws at (29.4, ±24.6), z 74.1.
- **gusset ×2:** polygon `(x,z) [[26.5,71.6],[39,71.6],[26.5,58.1]]`, thickness y ±1 at y=±24.5. `placeFrame` a=y, u=x, v=z (mirrored); falls back to bands.
- **label:** rect x 28.2..32.8, y −9..9, r .6, z 74.1+.6.
  - faint inset-0.8 outline polyline;
  - 3 lo rules (x 29.8+1.1i, y −6 → [3,0,4]);
  - 2 dots .38.

### `Bowl.tsx` (L214–253, L272–325)
- **base-flange:** `L(37, 100–103)`, `•24 35.6 @103 .42`.
- **bowl** (contacts): `[[0,103],[30,103],[32,103.8,1],[33.46,106,1],[34,109,1],[34,120],[0,120]]`, `seams [109.6,116]`, `subdivisions 4`. This is v2's quarter-ellipse knuckle, r 30→34 over z 103→109.
- **bowl-rib ×8** (contacts): at 32/95/140/175/210/245/280/312°, rect radial r 33.95→36.2 (2.25×1.4), z 103+17, rotation [0,0,deg].
- **top-flange:** `L(36, 120–122.5)`, `•32 34.9 @122.5 .38 phase 5.625°`.
- **Rim** (AZ=45):
  - rim-back `S(29.6–31.4, 135→315) 122.5+7.1`;
  - rim-front ×2 `S(…, −45→86)` and `S(…, 104→135)`;
  - all with dots every 20° from a0+10, r 30.5, z 129.6, size .36.
- **gate-sill:** `S(29.4–31.4, 86→104) 122.5+2.5`.
- **gate-guide ×2:** rect radial r 31.4–32.8, half-width .7, at 84.5° and 105.5°, z 122.5→138.2.
- **gate-lintel:** `S(31.4–32.8, 83→107) 138.2+1.4`. Dots at 89° and 101°, r 32.1, z 139.6.
- **★gate** (group): plate `S(31.5–32.3, 86.4→103.6) 125.05+4.5`. 2 dots at 95±4°, r 31.9, z 129.55. M4 lifts it by 8.3·open.
- **Spout:** frame `SF = {o: polar(95, 31.4, 125), a: SD=(cos95·cos15, sin95·cos15, −sin15), u: dir(185), v: SD×u}`. Polygons in (u,v):
  - floor `[[−5,−1],[5,−1],[5,0],[−5,0]]`, s 0→15;
  - walls `[[4.4,0],[5,0],[5,2.4],[4.4,2.4]]` and its mirror, s 1.6→15.

### `Rotor.tsx` (L255–352)
★`rotor` group at the origin, contacts off.
- **carousel:** `L(29, 122.5–125) |123.75`.
- **vane ×10:** static Extrude parts, rect radial 12→28.8 (16.8×1.2), z 125+5, at −108+36i. Static because they never move relative to the rotor.
- **hub-collar** (hi): `L(12, 125–129)`, `•10 9.8 @129 .36`.
- **hub-column** (hi): `L(7.5, 129–137) |133`.
- **strobe** (hi, crease lo): `[[0,137],[10.5,137],[10.5,139],[9.8,139],[9.5,139],[3.1,139],[2.8,139],[0,139]]`, `marks [3,6]`. Sectors on segment 4 (§2.4): count 10, duty .5, phase 0 (−108/36 is a whole number), fill `strobe`.
- **shaft:** `L(2.2, 139–159.6) |149`.
- **shaft-neck:** `L(2, 176.2–178)`.
- **shaft-pulley** (hi, crease lo): pulley(5.5) = `[[0,178],[5.1,178],[5.5,178.4],[5.5,181.6],[5.1,182],[5,182],[1.8,182],[0,182]]`, `marks` on the r 5 / r 1.8 knots. Spokes: a line set on the 5→1.8 segment, count 4, lo. In the rotor group, so it spins with the shaft.

### `Cage.tsx` (L354–399, L621–629)
- **post-foot ×8:** at 22.5+45i, r 33.5, `C(2.3) 122.5+1`.
- **post ×8** (contacts): `C(1.4) 123.5→160.87 |141`.
- **ring** (contacts): closed `Tube`, 96-point circle r 33.5 at z 162, radius 1.8, sides 16.
- **spider** (gr): `L(8, 159.6–164.4)`, `•6 6.6 @164.4 .4 phase 30°`.
- **arm ×3:** at 0/120/240°, rect radial 8→31.7, half-width 1.5, z 160.8+2.4. A dot at r 28, z 163.2.
- **Bearing:**
  - bearing-flange `L(7.2, 164.4–165.6)`, `•6 6.3 @165.6 .38`;
  - bearing-body (hi, contacts) `L(5, 165.6–172.6) |169.6`;
  - bearing-collar (hi) `L(5.8, 172.6–174)`;
  - bearing-cap `L(4.2, 174–176.2)`.
- **grease-nipple** (contacts): on the axis dir(20) from `polar(20, 4.9, 170.6)`, `L(.55, s 0–1.5)` plus a ball `sphereProfile(.75)` at s 2.1.
- **Oiler** at polar(120, 20):
  - base `C(1.6) 163.2→168.8`;
  - glass (hi) `C(1.3) 168.8+3.2 |170.1`;
  - cap `C(1.6) 172+.8`;
  - oil-line: Tube r .5, from polar(120, 18.4, 168) to polar(120, 5, 168).

### `Drive.tsx` (L401–471)
- **motor-spacer:** `B[26..30, −1.5..1.5, 163.2..163.8] r.3`.
- **motor-plate:** rect x 26..56, y −9..9, r 1.2, z 163.8+1.8, `|164.7`. Screws at (28.5, ±6.5), z 165.6, ring 1.
- **At (46, 0):**
  - motor-flange (gr) `L(8.5, 165.6–167)`, `•6 7.6 phase 30°`;
  - motor (gr) `[[0,167],[7,167],[7,168],[7,175.6],[7,176.4],[6.4,177],[6.4,177.6],[0,177.6]]`, `marks [2,3]`, ribs on segment 2 (count 36, lo, fade [.1,.55]);
  - motor-shaft `L(1, 177.6–178)`;
  - **★motorPulley:** pulley(4) (hi, crease lo), rings r 3.5 / 1.3, 4 spokes.
- **terminal-box** (gr): rect x 42..50, y 7..11, r .5, z 168.5+6. Faint inset-0.7 outline, 2 dots.
- **gland:** `C(1.1) 174.5+1.4 @(46,9)`.
- **belt** (gr, tube rule): `Belt a=[0,0,180] ra=6.5 b=[46,0,180] rb=5 radius=1`.

### `Intake.tsx` (L473–518)
- **funnel-bar ×2:** `B[7.5..10.5 | −10.5..−7.5, −34..−17, 163.8..165.8] r.4`. Dots at (±9, −31.4) and (±9, −19), z 165.8.
- **At (0, −23):**
  - funnel-flange `L(9.5, 165.8–167)`, `•8 8.4 phase 22.5°`;
  - funnel `[[0,167],[7,167],[7,171,1],[7.43,174.25,1],[8.39,177.5,1],[9.81,180.75,1],[11.5,184],[0,184]]`, `|171`, subdivisions 4;
  - funnel-lip `L(12.2, 184–186)`, `•16 11.6 @186 .36`;
  - **funnel-void:** an open disc `[[11,186.02],[0,186.02]]`, `tone: 'gradient'` (§2.3).
    - Runs from the back point polar(225, 11, 186) to the front point polar(45, 11, 186).
    - Stops: void0 → void1 at .55 → void2.
    - Outline lo (the v2 inner arc).

### `Instruments.tsx` (L520–593)
All on `F(deg, z)`.
- **Tach** (deg 50, z 114.7):
  - tach-pad (contacts) `[[0,32.5],[5.4,32.5],[5.4,35.4],[0,35.4]]`, sunk into the bowl.
  - tach (gr) `[[0,35.4],[5.4,35.4],[5.4,37.8],[4.6,37.8],[4.6,37.3],[3.2,37.3],[0,37.3]]`, `marks [5]` (arc ring, mid).
  - Ticks on segment 4: count 24, phase 3, first 0, last 18, a major every 3 (`hi`), minor `mid`. This gives model angle 45+15i, i.e. v2's −135+15i. Confirm by eye.
  - Sync tick: a Marks segment on the face, r 3.2→4.6 at model angle 234°, width 1.3, hi.
- **★needle:** group at the tach face centre (s 37.35). A Marks segment from r .9 (opposite side) to r 3.9 at 234°, width 1, hi, plus a dot of size .8, hi.
- **Lamp** (deg 74, z 115.5):
  - pad a 3 → s 35.2;
  - housing (gr) `r 2.7, s 35.2–37.2`;
  - bezel (gr) `r 1.9, s 37.2–37.8`;
  - lamp-lens `sphereProfile(2.1, 10)` at s 38.69, material `lit`, outline hi;
  - **★lampGlow** sprites at the lens (§2.2), level .45.
- **Crank** (deg 118, z 114):
  - pad a 2.8 → s 35.4;
  - boss (gr) `r 2, s 35.4–37.6`;
  - **★crank** group at s 38.4: arm `L(.75, 0–7)` along model angle 205° (v2 φ = 25°), tip ball r 1.4 at 7.4, hub `L(1.3, −.8–1)` along the face axis.
- **Drain valve** (deg 20, z 113):
  - pad a 2;
  - stub `r 1.2, s 35.4–39.6`;
  - drain-valve (contacts) `[[0,39.6],[1.5,39.6],[1.5,40],[2.06,40.6,1],[2.3,41.8,1],[2.06,43,1],[1.5,43.6],[1.5,44],[0,44]]`;
  - outlet `r 1.2, s 44–46`;
  - plug `r 1.6, s 46–47`;
  - stem, vertical at (39.28, 14.30): `C(.45) 115.15→117.2`;
  - wheel `C(2.6) 117.2+.6`, with 3 lo spokes from r .6→1.9 at 0.4 rad + 120i measured from dir(20), and circles r 1.9 and .6 as polylines.

### `Coolant.tsx` (L595–619)
COOLER_Z = 82; the cooler axis is +y, origin (41.5, −22, 82).
- **cooler-cap ×2:** `r 5.9, s 0–1.2` and `s 30.8–32` (the second gets `•8 4.8 phase 22.5°`).
- **cooler** (contacts): `r 5.5, s 1.2–30.8`, 13 seams at s 3.6+2i.
- **cooler-cradle ×2:** `B[37..46, c±1.2, 74.1..76.5] r.3` at c = −17 and 5, dots at x ± 3.6.
- **Pipes** (r 1.5, bend 3.9):
  - deg −24: (32.52, −14.48, 114) → (41.5, −18.48, 114) → down to the port at z 88.9;
  - deg 4: (35.51, 2.48, 114) → (41.5, 2.90, 114) → down to z 88.9;
  - each pipe has a pad (a 2.6 → s 35.6, contacts), a cooler-port cylinder `r 2.4, z 82→88.9` (contacts), and flanges `r 2.4` 0.9 thick at both ends with 6 dots.

### `Cabinet.tsx` (L631–654)
- **plinth:** rect x 51..63, y −7..17, r .6, z 0+2, lo.
- **cabinet** (gr): `B[52..62, −6..16, 2..40] r.8`.
- **On the x=62 face** (normal +x), lo:
  - door inset 1.6;
  - 4 vents at y −2..9, z 33−2.4i, 1 tall;
  - plate y −2..6, z 10..16;
  - 3 rules at z 14.6−1.6i, from y −0.8 to [5, 3.2, 4.2];
  - 4 dots at y {−2.8, 12.8}, z {5.2, 36.8}.
- **handle:** `B[62..63.4, 11.6..13, 20..27] r.3`.
- **hinge ×2:** `C(.6) @(62.6,−3.6)`, z 10 and 30, h 3.5.
- **cabinet-gland:** `C(1.2) 40+1.4 @(57.5,14)`.
- **motor-cable** (lo): Tube r .7, bend 3, path (57.5,14,41.4) → (57.5,14,183) → (46,9,183) → (46,9,175.9).

### `Stubs.tsx`
Siblings of the machine; ids `stubFeed.*` and `stubBelt.*`.
- **Feeder:**
  - feet `C(3.6) 0+1.4 @(±7.5, −94)`, lo;
  - columns `B[±7.5±1.5, −95.5..−92.5, 1.4..188] r.4`;
  - brace `B[−6..6, −95..−93, 110..113]`;
  - bed `B[−9..9, −100..−45, 188..191.4] r.6`;
  - rails `B[−9..−7 | 7..9, −100..−42.5, 191.4..194.6] r.4`;
  - roller `L(2.5, 0–18)` at (−9, −42.5, 188.9), rotation [0,90,0].
- **Audio belt** (port at (−4.5, 51.2, 100)):
  - feet `C(2.6) 0+1.2` and legs `B 2.4² 1.2..87`, at x −66/−36/2 and y 44.2/58.2;
  - brace `B[−64.8..−37.2, 43..45, 30..33]`;
  - bed `B[−78..10, 43.2..59.2, 87..91.4] r.6`;
  - rails `B[−75..10, 41..43.2 | 59.2..61.4, 87..94.4] r.4`;
  - roller `L(2.4, 0–20.4)` at (−80.4, 41, 89), rotation [−90,0,0];
  - pool `slats`: rect 1.6×15.2, r .3, h .6, z 91.4, lo, 8 instances at x = 9 − 12j.
- **Packets** (pool `centrifuge.packets`, capacity 16; M4 raises it to 40):
  - geometry `box [10,8,7] r.6 center [0,0,3.5] seams [3.85]`;
  - pool marks: a strap segment (−5,0,7)→(5,0,7), lo, normal +z;
  - styles `pkControl`, `pkGraph`, `pkData`;
  - M3 poses: pockets k = 1, 2, 4, 6, 7 at r 23, angle −90+36k, z 125, yaw = angle, kinds C/G/D/C/G;
  - 3 more on the feeder at (0, −90/−79/−68, 191.4), yaw 90°.

### Triangle budget
Target ≤ 120k triangles; DEV warning at 150k. M2 ran 38k at 60 fps, and the quad-partner vertex cost is about 3×. Rules:
- smooth profiles get ≤ 6 knots plus `subdivisions` 3–4;
- spheres use `sphereProfile(r, 10)` plus subdivisions 2;
- default `steps` for r ≥ 10, and `steps: 24` for lathes with r < 3;
- tubes get 12 sides for r ≤ 1, 16 otherwise.

Without these rules, v2 profile sampling (19–22 knots × 8 subdivisions × 128 steps) puts the bowl alone at about 43k triangles.

## 2. Engine additions (`packages/engine/src/`)

### 2.1 Tokens (`palette/tokens.ts`)
- **MATERIALS:** append `'lit', 'pkControl', 'pkGraph', 'pkData'`. Existing indices stay unchanged.
- **`lit`** (the kit's `data-lit`):
  - light: face/paper/top `#ffffff`, s0–s3 `#eeeeeb`, hi/mid/lo/faint/lit `#000000`, dot `#3a3a3e`;
  - dark: face `#1b1b1b`, top `#262626`, s0–s3 `#1d1d1d`, line slots `#ffffff`, dot `#e6e6e6`.
- **`pk*`** (from `factory.css`, the same in both themes):

  | material | top | face | s0–s3 |
  |---|---|---|---|
  | control | `#5aa9e6` | `#4b98d6` | `#2f6fa6 #3a7fb8 #4689c4 #5294cf` |
  | graph | `#f0be5e` | `#e4ad48` | `#b07a1f #c08a2b #cc9636 #d8a241` |
  | data | `#ffffff` | `#f3f4f6` | `#c9ccd2 #d4d7dc #dfe1e5 #e9eaed` |

  - hi/mid/dot `#2a2c31`;
  - lo/faint = `mixHex('#2a2c31', face, .55)`, because v2 lines draw at .55 opacity.
- **New `FX` table**, rgba, appended to the palette buffer after `[material][slot]`, with `fx(i) = palette[MATERIALS·SLOTS + i]`. Size the palette buffer from the new length.

  | fx | light | dark |
  |---|---|---|
  | halo | `#8a8a80` α .32 | `#050505` α .9 |
  | glow | `#38c27a` | `#7dffb4` |
  | glowSoft | `#9fe8bd` | `#2f8a5a` |
  | void0 | `#c9ccd1` | `#3a3d43` |
  | void1 | `#7d8188` | `#1a1c20` |
  | void2 | `#4a4d53` | `#0b0c0e` |
  | strobe | `#7d8188` | `#8b8f97` |

- **New `CARD` tokens:**

  | token | light | dark |
  |---|---|---|
  | page | `#f2f2ef` | `#0b0b0b` |
  | card | `#fbfbfa` | `#131313` |
  | text | `#57575a` | `#a3a3a3` |
  | strong | `#18181a` | `#e6e6e6` |
  | muted | `#8c8c90` | `#6e6e6e` |
  | frame | steel.mid | `#6a6a6a` |

- `MONO = { web: 'ui-monospace,"SF Mono",Menlo,Consolas,monospace', ios: 'Menlo' }`.

### 2.2 Transparent pass (`render/sprites.ts` + shaders)
Runs after the marks in the same MSAA pass: depth `less-equal`, no depth write, premultiplied output `(rgb·a, a)`.

```ts
export const SPRITE = { halo: 0, disc: 1 } as const;
export const Sprite = d.struct({            // 64 B
  center: d.vec3f, kind: d.u32,             // model-space centre (halo: floor point)
  half: d.vec2f, corner: d.f32, sigma: d.f32,   // halo: plan half-extent, corner r, blur σ (world units)
  radius: d.f32, grow: d.f32, opacity: d.f32, cap: d.f32, // disc: r = radius + grow·level, a = min(opacity·level, cap)
  fx: d.u32, instance: d.u32, level: d.f32, bias: d.f32,  // FX colour index, instance (rides moves groups), toward-viewer bias
});
type SpriteSpec =
  | { kind: 'halo'; plan: { w: number; d: number; r: number }; sigma?: number /*3.1*/; shift?: number /*1.04*/ }
  | { kind: 'disc'; radius: number; grow?: number; opacity: number; cap?: number; fx: FxName; blend: 'normal' | 'glow'; bias?: number; level?: number };
store.sprite(id: string, o: { parent?: string; transform?: Transform } & SpriteSpec): Token;
interface SpriteHandle { readonly id: string; level: number }          // dirty → re-upload the sprite table
```

- **Pipelines** (same shaders):
  - `normal`: `one, one-minus-src-alpha`;
  - `multiply`: `dst, one-minus-src-alpha`;
  - `screen`: `one-minus-dst, one`.
- `setTheme` picks multiply (light) or screen (dark) for `blend:'glow'`.
- `SceneBuild` gains `sprites` and `spriteRanges {normal, glow}`. Draw with `draw(6, n, 0, first)`. Sprites are excluded from the bounds.
- **Halo:** the kit's `.iso-halo` (the `haloOf` fill, blur 9 viewBox px, translateY 3 px, theme opacity). At v2's KS 2.88 that is σ 3.1 world units and a screen-down shift of 1.04.
  - Vertex: a floor quad inflated by 3σ+shift, offset by `normalize(toward.xy)·shift/sinE`.
  - Fragment: `sdf = roundedRectSdf(q, half, corner)`, `dPx = sdf/length(vec2(dpdx(sdf), dpdy(sdf)))`, `cover = haloCoverage(dPx, sigma·pxPerUnit)`.
  - `haloCoverage(d,s) = 1/(1+exp(1.702·d/s))` (the logistic approximation of ½·erfc), `'use gpu'`, CPU-testable.
  - Output alpha = cover·fx.a, with an IGN dither of ±0.5/255.
  - Blend `normal` in both themes.
- **Glow** (v2 `drawLamp`): two screen-facing discs at the lens centre.
  - Both: bias 2.2 (clears the r 2.1 lens), level .45 in M3, `cover = clamp(rPx+.5−dist, 0, 1)`.
  - `glowSoft`: radius 2.4, grow 3.2, opacity .35, `normal` blend.
  - `glow`: radius 1.6, opacity .85, cap .85, `glow` blend.
- **Blocks:** `<Halo id plan …/>`, `<Glow id fx radius grow opacity cap blend level/>`. `useNode` returns a `SpriteHandle`.

### 2.3 Gradient tone (funnel void)
- `TONE_RULE.gradient = 3`.
- `StyleSpec.gradient?: { from: Vec3; to: Vec3; stops: [FxName,FxName,FxName]; mid?: number }`.
- `Style._p0` indexes a new `gradients` table: `d.struct({ from: d.vec3f, mid: d.f32, to: d.vec3f, _p: d.u32, fx: d.vec3u, _q: d.u32 })`, 48 B.
- **No new varying:** the fill shader already uses 13 of 16 inter-stage slots. The vertex stage writes `uv = vec2(t, 0)` with `t = dot(pv−pa, pb−pa)/|pb−pa|²` in device px. Ortho is affine, so this equals SVG's `userSpaceOnUse` linear gradient.
- **Fragment:** a 3-stop mix plus dither; the outline still draws on top.

### 2.4 `sectors` line-set kind (strobe)
- `LineSetSpec += kind?: 'lines'|'sectors', duty?, fill?: FxName`. The GPU `LineSet` gains `kind: u32, duty: f32, fill: u32`.
- **Fragment**, before the tick and edge lines:
  - `f = fract(x)`, `dist = min(f, duty−f)/xGrad`, `cover = clamp(dist+.5, 0, 1)`;
  - mix toward `fx(fill)`;
  - `first..last` still apply.

### 2.5 Lens "lit"
The `lit` material from §2.1. No shader change.

### 2.6 Views (`camera.ts`, renderer)
- `ViewPreset += frame?: [Vec3, Vec3]`: fit this world box instead of the scene bounds; `zoom` multiplies that fit.
- `ViewPreset += lines?: number`: a line-scale cap.
- `pxPerCss = dpr · min(zoom/refZoom, view.lines ?? ∞)`.

### 2.7 Small
- Lathe `GeoSpec` / `<Lathe>` pass `subdivisions` through. `spec.ts#buildMesh` drops it today.
- `<Group|Machine contacts={false}>` sets the default for descendants (via `SceneContext.contacts`).
- The DEV rebuild log adds the sprite count and build ms, and warns when triangles exceed 150k.

## 3. Overlay card (`apps/app/src/overlay/Card.tsx`, RN views)

**Props:**
- `{ theme, fig:'Part', title:'Centrifuge', hint:'fills · spins up · drains one per quantum', readout:'held 5/10 · 14.1 rpm · in sync', children /*Stage*/ }`.
- `SceneEntry += card`. Gallery and m1 get simple cards.

**Layout** (from `iso.css .iso-plate`):
- Page background `CARD.page`.
- Card: absolute, inset by the safe-area insets + 12 (narrow: + 8); background `CARD.card`; `borderWidth 1`, `borderColor CARD.frame`.
- The Stage is inset 52/24/52/24 (narrow: 48/12/70/12), so the fit never reaches the corner texts.

**Corner texts** (absolute; inset 18 top/bottom, 20 sides; `MONO`, 10.5 px, `lineHeight 10.5`):
- fig: top-left, `text`, letterSpacing .42.
- title: top-right, uppercase, `muted`, letterSpacing 1.05.
- hint: bottom-left, uppercase, `muted`, 1.05.
- readout: bottom-right, `text`, `fontVariant ['tabular-nums']`.

**Narrow** (card width < 560, from `onLayout`): the hint moves up 18 (bottom 36), above the readout.

**Accessibility:** the Stage wrapper gets `accessibilityRole="image"` and an `accessibilityLabel` with the first sentence of the v2 caption.

**App chrome:**
- The chip bar moves out of the card into a 44 pt row above it (top = safe top + 4). The card's top inset becomes insets.top + 52.
- `__v4.setChrome(false)` hides the bar for clean captures.
- Chip ink comes from `CARD`.

## 4. Token pass (dark contrast, subject `hi`)

1. **Diagnose first.**
   - Shoot v4 `instr` and `rotor` in dark at about v2 scale. Compare with `qa/z-instr-dark.png` / `qa/z-rotor-dark.png` and `centrifuge.html` at fit.
   - A minimal one-off PIL histogram script in the session scratchpad (not committed tooling) prints the top ~12 colours per crop.
   - The v2 dark crops show exactly the kit tones:
     - fills `#1c1c1c #0f0f0f #131313 #181818 #151515 #121212`;
     - lines `#6a6a6a` (mid) and `#2a2a2a` (faint);
     - graphite `#24262a #8b8f97 #43464d`.
   - If v4 shows the same set, the tokens are right and the gap is line weight or coverage. Otherwise fix the slot that is off.
2. **Subject `hi`** on the census parts: hub collar, hub column, strobe, bearing body/collar, both pulleys, oiler glass.
   - The lens is `lit`; packets have `#2a2c31` edges.
   - Most of v2's dark "sparkle" comes from these plus the dots.
3. **If v4 still reads dimmer at fit, dark only,** in this order, stopping once it matches:
   1. steel `mid` `#6a6a6a`→`#767676` and `faint` `#2a2a2a`→`#303030`;
   2. `top` `#1c1c1c`→`#202020`, which separates tops from s3 `#181818`;
   3. a `Frame.lineGain` (dark 1.15) on edge/tick/mark alpha, if DPR-1 phone-wire alpha is the cause.

   Leave light alone unless the light comparison shows a gap. Record the final values with the comment `v4 dark lift vs kit (M3 compare)`.

## 5. Views and scene chip

- `SCENES = [centrifuge (default), gallery, m1]`. The chip cycles them, and `setScene` takes the new name.
- `CENTRIFUGE_VIEWS` (machine-local boxes matching the v2 crops):

  | view | yaw/elev | frame | lines | matches |
  |---|---|---|---|---|
  | `fit` | 45/30 | – | – | – |
  | `rotor` | 45/30 | `[[−34,−34,120],[34,34,150]]` | 2 | `qa/z-rotor` |
  | `instr` | 45/30 | `[[6,20,108],[30,42,122]]` | 2 | `qa/z-instr` |
  | `drive` | 45/30 | `[[−8,−12,162],[56,14,184]]` | 2 | `qa/z-drive` |
  | `funnel` | 45/30 | `[[−13,−36,164],[13,−10,187]]` | 2 | `qa/z-funnel` |

- The v2 crops are the same page at DSF 4 (2× the shot), so their lines appear at 2× weight. `lines: 2` reproduces that at any crop zoom; tune it in the tuning round.

## 6. Cut list (in order, if scope must shrink)
1. lifting eyes
2. screw rings (keep the dots)
3. label-plate rules and inset
4. cabinet vents and rating plate
5. drain-wheel spokes and circles
6. oiler and oil line
7. coolant pipe flanges (keep the pipes)
8. stub belt slats pool (keep the bed)
9. grease nipple
10. terminal-box inset
11. sync tick
12. `fx` gallery row

Never cut: the halo, glow, void, strobe, lens, card, `hi` subjects.

## 7. Acceptance and by-eye test plan

**Basics:**
- `pnpm test` and `pnpm types` are green; no WebGPU validation errors on web or iOS.
- The DEV log shows ≤ 120k triangles (hard limit 150k).
- The first Hermes build takes ≤ 1.5 s; report the number.
- The iOS sim holds 60 fps at `fit` (the largest rAF gap stays < 25 ms).

**Composition**, at `fit` next to `shot.png` and `centrifuge-light.html`, part by part:
- gate and spout on the left;
- lamp, tach, crank and drain on the front;
- the coolant loop and shelf on the right; the cabinet front-right;
- the feeder top-right and the audio belt left;
- the belt over two pulleys;
- 5 held packets.

**Effects:**
- **Halo:** soft, with no edge or banding at DPR 1. It sits under the stand and is hidden by the legs. Strength about v2's (~30% in light, strong in dark).
- **Glow:** a green dot over the lens. In light the lens outline shows through it (multiply); in dark it's a bright screen glow.
- **Void:** light → dark from back to front, as in `z-funnel`, with a lo inner ring.
- **Strobe:** 10 sectors between two rings, as in `z-rotor`.
- **Lens:** a white ring in dark, a black ring in light.

**Lines:** contact lines at every X pair and nowhere else. Dots fade toward the limbs. No thick-line blowout in the crops.

**Card:** fonts, tones and corners as in `shot.png`. At 390 px the hint stacks above the readout. Safe areas are respected, and no text sits over the figure.

**Procedure.** Screenshots go in the scratchpad only.
- **Web:** the built-in pane on :8090, at desktop width and then `resize_window` mobile 375×812. Plus one argent Chromium at DPR 1, closed afterwards.
- **iOS:** the simulator, portrait, DPR 3.
- For each of `fit` / `rotor` / `instr` / `drive` / `funnel`, light and dark, compare side by side with `shot.png`, `centrifuge(-light).html` (opened in that Chromium) and `qa/z-*-{light,dark}.png`.

**Edge cases:**
- phone portrait fit, web and iOS;
- DPR 1 vs 3: line weight, halo banding, dot sizes;
- theme toggle on every view: the glow blend flips, and the card and palette update in the same frame;
- resize while on a crop: it stays on the preset and refits;
- hide the pane, then show it again: frames resume with no errors;
- one Fast Refresh edit of a part prop: no duplicate-id throw, and a warm rebuild (the store and device survive).

**Tuning round:** write one delta list, fix it, reshoot, done.

**Go/no-go:**
- Go: the user's style review of `fit` plus the 4 crops, light and dark, reads "same style as v2".
- No-go: ship with the cuts and gaps listed in `notes/M3.md`, and report.

## 8. Tests (few)
- **`tests/halo.test.ts`:** `haloCoverage(d,s)` is within 0.02 of `½·erfc(d/(s√2))` for d ∈ [−4s, 4s] and s ∈ {1, 5, 20} px; it is 0.5 at d=0 and monotone.
- **`tests/shaders.test.ts`** (extend): the sprite vertex/fragment and the fill shader with sectors + gradient resolve to WGSL.
- **Optional:** `sectorCoverage` covers half of each period at duty .5.
- `store.test.ts` must still compile after `reduced` is removed. No new store tests.

## 9. Risks, steps, checkpoints

**Risks:**
- **Content volume:** about 175 solids. Build the machine core first and use the cut list.
- **Hermes rebuild:** topology + contacts over about 175 parts. Mitigated by opt-in contacts, the per-prototype caches and the M2 review's numeric-key fixes. If the build still exceeds 1.5 s, lower subdivisions/steps, then report.
- **Frame mapping:** mirrored frames give inside-out prisms or reversed phases. `placeFrame` checks u×v vs a; verify by eye at the crops.
- **Inter-stage varyings:** 13 of 16 are used. Add none; the gradient goes through `uv`.
- **Halo approximation:** `sdf/|∇sdf|` is exact for a nearly round plan (r 30 on 68) and slightly off at sharp corners, which this plan doesn't have.
- **Void disc** 0.02 above the lip: depth24 precision over a ±1000 slab is about 1.2e-4, so this is fine.
- **Chips vs title:** solved by moving the bar outside the card.

**Steps:**
1. **Remove reduced motion:**
   - `store.ts`: delete `FrameInfo.reduced`, `readonly motion`, and `reduced` in `tick`;
   - `blocks/Scene.tsx`: delete the `AccessibilityInfo` import and its effect;
   - docs: drop the reduced-motion lines from the ARCHITECTURE §6 M4 row and the `M2.md` known-gap line.
2. **Tokens** (§2.1) and the palette buffer size.
3. **Engine additions:** lathe `subdivisions` passthrough, the Group `contacts` default, `ViewPreset.frame/lines`, `sectors`, `gradient`.
   **Checkpoint A:** the gallery is unchanged (`fit`, m1 `4× rotor limb`, light and dark) and tests are green.
4. **Sprites:** schema, `store.sprite`, the 3 pipelines, halo, disc, blocks. Add a gallery row `fx`: a halo under a box, a glow on a sphere, the void disc, a strobe disc.
   **Checkpoint B:** the `fx` row is right in both themes, on web and iOS.
5. **Content, core first:** `dims.ts` + `placeFrame`, then Bowl, Rotor, Cage, Drive, Intake.
   **Checkpoint C:** the core is on screen on web and iOS; triangles, build ms and fps are logged. If over budget, apply the budget rules now.
   Then Stand, Instruments, Coolant, Cabinet, Stubs, packets.
6. **Card, App layout,** the scene chip default, views.
7. **Token pass** (§4).
   **Checkpoint D:** the full §7 pass.
8. **Tuning round,** then `notes/M3.md` and the README. Commit source and docs only.

## Out-of-scope findings in existing code
- **Contacts on by default:** `store.part` defaults to `contacts: true`. Every touching pair runs `contactSegments`, so the cost grows with flush neighbours. M3 works around this with a Group default; consider making contacts opt-in globally later.
- **Contact cache:** `contactCache` clears wholesale above 256 entries. The M2 review fixes this before M3.
- **Line weight depends on context:** it's tied to the whole-scene fit (`refZoom`), so the same machine inks differently in the gallery and alone. M3 caps it for presets only.
- **Stale QA crops:** the `qa/` crops and `qa/dark.png` predate the final v2 geometry. Use them for tones and framing only.
