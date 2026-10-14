# M2 → M4 plan: building blocks → static centrifuge → animated centrifuge

*2026-10-14. Planning-agent output, filed by the orchestrator. The user approved the M1 look and asked to continue through to the full centrifuge. The census is taken from v2's final `centrifuge.mjs` and the `build.mjs` stubs, which are newer than `qa/light.png`; `shot.png` shows the current look.*

## 1. Census of the v2 centrifuge (about 175 solids)

**Blocks:**
- `Box`/`Extrude` use the plan tone rule when upright and bands otherwise.
- `Lathe` uses bands; `Tube`/`Belt` use the tube rule.
- `Instances` is a pool.
- `Marks` covers free lines and dots.

**Line codes.** Every solid gets an in-face outline and creases for free. The "extra" column lists only what comes on top:
- M = seam or forced ring
- U = UV line set
- F = free segment
- D = dot
- X = contact line

| group | parts | block | extra | motion |
|---|---|---|---|---|
| halo | soft floor shadow | Halo (M3) | – | – |
| stand base | 2 skids (lo), 4 lifting eyes | Box r; Lathe ring | M side seam | – |
| feet | 4 feet (lo), 4 levellers | Extrude circle | 4 D/foot; M | – |
| legs | 4 legs, 4 leg pads, 4 rubber isolators | Extrude r; Box; Lathe smooth | 2 M/leg; 3 screws/pad (D + F ring) | – |
| rails | 4 lower, 2 upper | Box | – | – |
| shelf | shelf; 2 gussets (prism in the xz plane); label plate | Box r; Extrude rotated; Box | M, 2 D; inset F + 3 F rules, 2 D | – |
| bowl | base flange, bowl with knuckle, top flange | Lathe (smooth knots) | 24/32 D bolts; 2 faint M rings | – |
| bowl ribs | 8, sunk 0.05 | Extrude polygon | X | – |
| rotor | carousel, hub collar (hi), hub column (hi), strobe disc (hi), shaft | Lathe | M rings; 10 D; U 10 dark sectors | spin (group) |
| vanes | 10 | Instances (Extrude) | – | spin with the rotor |
| rim and gate frame | back rim + 2 front sectors, sill, 2 guides, lintel | Extrude sector/polygon | D every 20°; 2 D | – |
| gate plate | 1 | Extrude sector | 2 D | lifts 8.3 per release |
| spout | floor + 2 walls, sloped 15° | Extrude rotated | – | – |
| cage | 8 post feet, 8 posts, ring (closed), spider (graphite), 3 arms | Extrude circle; Tube closed; Lathe; Box | M posts; X post×ring; 6 D; D arm tips | – |
| bearing | flange, body (hi), collar, cap, neck, grease nipple + ball | Lathe; sphere | 6 D; M; X nipple×body | – |
| pulleys | shaft pulley (hi), motor pulley (hi), motor shaft | Lathe | 2 M rings (lo); U 4 spokes each | spin; motor pulley ×5.5/4 |
| drive | spacer, plate, motor flange, motor (graphite), terminal box + gland, V-belt (graphite, r 1) | Box; Lathe; Belt | 2 screws; 6 D; U 36 ribs fade [.1,.55]; F inset, 2 D | – |
| intake | 2 funnel bars, funnel flange, funnel (smooth flare), lip with void | Box; Lathe; gradient disc (M3) | 2/8/16 D; M; inner arc F (lo) | – |
| tach | saddle pad, graphite dial | Lathe | X; U 18 ticks with `hi` majors + M arc ring; sync tick F 1.3 hi | needle F 1.0 hi + D 0.8, sprung to rpm |
| lamp | pad, housing, bezel, lens (hi, lit), glow | Lathe; sphere; Glow (M3) | X | glow steady, plus a flash per release |
| crank | pad, boss, arm + tip ball + hub | Lathe; sphere | X | arm kicks −60° per release |
| drain valve | pad, stub, bulge body, outlet, plug, stem, handwheel | Lathe | X; F 3 spokes + 2 circles (lo) | – |
| coolant | 2 pads, 2 pipes + 4 flanges, cooler + 2 caps, 2 cradles, 2 ports | Lathe; Tube; Box | X; 6/8/2 D; 13 M rings on the cooler | – |
| oiler | base, glass (hi), cap, oil line r 0.5 | Extrude circle; Tube | M | – |
| cabinet | plinth (lo), cabinet (graphite), handle, 2 hinges, gland, motor cable r 0.7 (lo) | Box; Extrude circle; Tube | F door + 4 vents + plate + 3 rules; 4 D | – |
| packets | up to 40 rounded 10×8×7 boxes, material by kind | Instances (Box r) | M band seam; F strap per instance | arc in → throat → drop → pocket → gate → spout → fall → hand off |
| stub feeder | 2 columns, feet, brace, bed, 2 rails, roller | Box; Lathe | – | packets slide and hold at the roller (backpressure) |
| stub audio belt | 6 legs, feet, brace, bed, 2 rails, roller, slats | Box; Lathe; Instances | – | slats advance one per 0.42 s; packets ride and tip off |
| card (RN views) | frame line, "Part", "CENTRIFUGE", hint, readout | `<Card>` over the canvas | – | readout `held n/10 · x.x rpm · phase`, at most 10 Hz |

## 2. Roadmap

**M2: building blocks (3–4 days)**
- Generators: extrude (box becomes a wrapper), lathe seams, closed tube, belt.
- Plan and tube tone rules.
- Instances, styles and batches.
- Marks: free lines and dots.
- Contact lines.
- SceneStore and React blocks.
- A gallery to check it all.
- **Go/no-go:** the gallery passes §M2.11 on web and iOS.
  - If contacts misbehave: author contacts flush and drop `contact.ts`.
  - If RN breaks: report to the user.

**M3: static centrifuge (3 days)**
- `apps/app/src/machines/centrifuge/*.tsx`, built from the census.
- Engine additions:
  - a transparent pass for the halo and glow (multiply in light, screen in dark);
  - a gradient tone rule for the funnel void;
  - a `sectors` line-set kind for the strobe;
  - packet and centrifuge tokens;
  - a lens "lit" material.
- Overlay `apps/app/src/overlay/Card.tsx`: RN views, kit fonts and `CARD` tokens. The readout is static for now. On narrow screens the hint goes above the readout.
- Token pass: dark-mode contrast and the `hi` subject outline.
- Views: `fit`, plus crops matching `qa/z-rotor`, `z-instr`, `z-drive` and `z-funnel`.
- **Go/no-go:** a style review next to `shot.png` / `centrifuge(-light).html`, light and dark. One tuning round of at most ½ day.

**M4: animated centrifuge (2–3 days)**
- `packages/engine/src/sim/centrifuge.ts`: a port of the final v2 sim.
  - Plain TS, typed state.
  - Fixed step of 1/120 s, at most 8 substeps, dt clamped to 0.1 s.
  - Covers index, fill, spin with phase lock, release (gate, spout, fall), spin-down, backpressure, the stub feeder (bursts of 8) and the stub belt (0.42 s quantum).
- One `useFrame` in `Centrifuge.tsx` writes:
  - group spins: the rotor and the motor pulley;
  - the gate offset;
  - the crank and needle angles;
  - the glow level;
  - packet and slat pool poses.
- Readout through a throttled external store (`useSyncExternalStore`). Phase changes are announced via `accessibilityLiveRegion`.
- Reduced motion, from `AccessibilityInfo.isReduceMotionEnabled()` plus its listener (RN-web maps it to the media query):
  - nothing moves;
  - packets are placed instantly, one leaves per quantum by the clock;
  - the readout says `0 rpm · passing packets`;
  - instance uploads are skipped while nothing changes.
- **Go/no-go:** one full cycle of about 30 s on web and the iOS sim, compared phase by phase against `qa/t-*.png` and `cycle-sheet.png`. Reduced motion stays still. Motion is smooth on the iOS sim.

**Cut or deferred**
- Gear generator: none in the centrifuge.
- "ribs" generator: ribs are a UV line set.
- Bevel geometry: the kit bevel is a line.
- `manifold-3d` and glTF.
- Render bundles and indirect draws.
- ID-buffer audit and perf harness (Decision 2).
- Orbit beyond presets; explode.
- M5 tuning overrides; Android builds.

**First to cut if a timebox is tight:** lifting eyes, screw rings (keep the dots), label-plate rules, cabinet vents and plate, drain-wheel spokes, oiler.

## 3. Detailed M2 plan

### M2.0 Placement
- Engine (no React): generators, tone rules, contacts, marks, SceneStore, renderer.
- Blocks layer: `apps/app/src/blocks/`, React only, renders null.
- Gallery: `apps/app/src/gallery/`.
- `scene/m1.ts` shrinks to its profile constants, and the M1 scene becomes gallery row `m1`.

### M2.1 Generators (`packages/engine/src/geo/`)

`spec.ts` holds a JSON-serializable union, `buildGeo(spec, part): Mesh` builds it, and `geoKey(spec)` is the cache key.

```ts
type Plan = { rect: [number, number]; r?: number } | { circle: number; steps?: number }
  | { polygon: [number, number][] } | { sector: { r0: number; r1: number; a0: number; a1: number } };
type GeoSpec =
  | { kind: 'box'; size: Vec3; center?: Vec3; r?: number; seams?: number[] }
  | { kind: 'extrude'; plan: Plan; z?: number; height: number; seams?: number[] }
  | { kind: 'lathe'; profile: ProfilePoint[]; steps?: number; seams?: number[]; marks?: number[];
      lineSets?: { segment: number; lines: LineSetSpec }[] }
  | { kind: 'tube'; path: Vec3[]; radius: number; sides?: number; bend?: number; caps?: [boolean, boolean]; closed?: boolean }
  | { kind: 'belt'; a: Vec3; ra: number; b: Vec3; rb: number; radius: number };
```

- **`extrude.ts` (new)**
  - Side quad strips. Plan arcs (circle, rounded corners, sector arcs) get smooth normals; polygon corners and sector ends are sharp.
  - Flat caps: a fan for convex plans, quad strips between arcs for sectors.
  - uv: u = perimeter fraction, v = height.
  - `seams` (z values) split the sides into rings and mark them.
  - `box.ts` becomes a wrapper; `r` gives rounded corners.
- **`lathe.ts`**
  - `seams` (z values) insert knots and mark them.
  - Default `steps = clamp(round(8·maxR), 32, 128)`.
  - New `sphereProfile(r, n=12)`.
  - Line-set tags are local (1-based) and get remapped on merge.
- **`tube.ts`:** `closed: true` wraps the rings and drops the caps. Planar loops only (assert).
- **`belt.ts` (new):** outer tangents plus pulley arcs → `tube({ closed: true, bend: 0 })`.
- **`topology.ts`**
  - `buildTopology` runs once per prototype, cached by `geoKey`.
  - `mergeTopologies(list, triOffsets)` rebases `adj` and quad partners.
  - Never weld across prototypes. This also fixes the M1 review finding about welding by part id.

### M2.2 Tone rules (`shading/tone.ts`, `'use gpu'`, CPU-testable)

`Style.toneRule`: 0 = bands, 1 = plan, 2 = tube.

- **plan** (kit `extrude`)
  - Used when the model's z axis is vertical (`|model·ẑ·ẑ| > 0.999`, decided in the vertex stage); otherwise bands.
  - `n.z > .5` → `top`; `n.z < −.5` → `s0`.
  - Otherwise `lit = (dot(normalize(n.xy), normalize(light.xy)) + 1)/2`, binned into 4 equal bins → s0..s3.
  - AA the bin edges with the `bandWeights` pattern.
- **tube** (kit `tube.mjs`; smooth triangles only, flat caps use bands)
  - `g = (dpdx(uv.y), dpdy(uv.y))`, `m = normalize(−g.y, g.x)`.
  - `s = dot((n·right, −n·up), m)`, `tw = dot(m, L)`, with `L = normalize(−0.55, −0.835)` in screen space, y down.
  - Base `s2`. `top` where `|s − .44·tw| < .24`. `s0` where `|s + .62·tw| < .2`. AA with `fwidth(s)`.
  - If `|g| < 1e-6`, fall back to bands.
- **Defaults:** box/extrude → plan, lathe → bands, tube/belt → tube. A style can override.

### M2.3 Contact rule
- **Flush contacts are already lined by M1.** The contact face is culled or open, so the rim shows as an outline. Authoring rule: flush where possible.
- **Piercing contacts:** `geo/contact.ts` → `contactSegments(a: Placed, b: Placed, eps=1e-4): Float32Array`, with `Placed = { mesh, model }` at rest.
  - **Which pairs:** world AABBs overlap, same nearest `moves` ancestor, neither has `contacts: false`. Skip pools.
  - **Search:** a uniform grid over B's triangles, cell = 2 × the mean edge length.
  - **Proper crossings only:** each triangle has vertices strictly on both sides of the other's plane. This rejects coplanar and touching pairs.
  - **Segment:** the overlap of the two triangles on the line where their planes meet.
  - **Output:** marks in the smaller part's local frame, using its outline slot and width, normal = 0 (no fade).
  - **Cache:** by `(geoKeyA, geoKeyB, relative transform)`.

### M2.4 Instances and the part-transform buffer (`render/schemas.ts`)

```ts
const Instance = d.struct({ model: d.mat4x4f, style: d.u32, flags: d.u32, _pad: d.vec2u });    // 80 B, flags bit0 = visible
const Style = d.struct({ material: d.u32, outlineSlot: d.u32, creaseSlot: d.u32, toneRule: d.u32,
  width: d.f32, _pad: d.vec3f });                                                                    // 32 B
// GpuTri layout unchanged; `part` becomes `slot` = instance offset within its batch (0 for pools)
```

- **Layout:** frame, vertices, tris, instances, styles, lineSets, palette, marks. Assert sizes with `d.sizeOf`.
- **Batches**
  - Batch 0 is the static block: all single parts merged, instance slots 0..S−1, `tri.slot = k`.
  - One batch per pool, drawn with `draw(triCount·3, count, firstTri·3, firstInstance)`.
- **Vertex stage**
  - `inst = instances[instance_index + tri.slot]`.
  - Invisible instances are clipped away.
  - Only rotation, translation and uniform scale are allowed (assert in the store).
- **Upload:** a CPU `Float32Array` mirror, 20 floats per instance. One `writeBuffer` per frame, only when dirty.

### M2.5 Free lines and dots (in M2; M3 needs them heavily, and contacts use them)

```ts
const Mark = d.struct({ a: d.vec3f, size: d.f32, b: d.vec3f, instance: d.u32,
  normal: d.vec3f, kind: d.u32, fade: d.vec2f, material: d.u32, slot: d.u32 });                      // 64 B; kind 0 dot, 1 segment
```

- **`render/marks.ts`:** a second pipeline in the same MSAA pass, after the fills.
  - Draw: `draw(6, markCount)`. Each mark is a screen quad, half-width + 1 px.
  - Depth: `less-equal`, no depth write. Positions are biased 0.05 world units along `toward`.
  - Blend: alpha, in gamma space.
- **Coverage**
  - Segment: `tickCoverage` on the distance to the segment, with round caps.
  - Dot: `clamp(r·pxPerCss + .5 − dist, 0, 1)` × tone opacity (`hi .85, mid .45, lo .22, faint .12`).
- **Facing:** if `normal ≠ 0`, hide on the back side and fade with `smoothstep(fade)`, default `[.04, .42]`.
- **Visibility:** hidden when the instance flags say so.
- **Debug:** cyan in debug view 1, off in view 2.
- **Palette:** a new `dot` slot (steel light `#3a3a3e`, dark `#e6e6e6`; graphite `#c8cbd1`).
- **Helpers (`geo/marks.ts`):** `boltCircle({center, axis, r, count, phase, size, tone})`, `polyline(points, {normal, width, tone})`.

### M2.6 SceneStore (`packages/engine/src/scene/store.ts`)

```ts
type Token = number;
interface StyleSpec { material: Material; outline?: Slot; crease?: Slot; width?: number; tone?: 'bands' | 'plan' | 'tube' }
interface SceneStore {
  group(id: string, o: { parent?: string; transform?: Transform; moves?: boolean }): Token;
  part(id: string, o: { parent?: string; geo: GeoSpec; style: StyleSpec; transform?: Transform; contacts?: boolean }): Token;
  pool(id: string, o: { parent?: string; geo: GeoSpec; styles: StyleSpec[]; capacity: number; marks?: MarksSpec }): Token;
  marks(id: string, o: { parent?: string } & MarksSpec): Token;   // MarksSpec = { material, dots?, segments? }
  remove(id: string, token: Token): void;     // no-op unless token is current (StrictMode, Fast Refresh)
  node(id: string): GroupHandle | PoolHandle; // throws `unknown id "x"; known under "m": …`
  onFrame(cb: (f: { t: number; dt: number; reduced: boolean }) => void): () => void;
  tick(t: number, dt: number): void;
  motion: { reduced: boolean };
  readonly version: number;                   // bumps on structural change
  build(): SceneBuild;                        // merged mesh + topology, batches, styles, lineSets, marks, bounds (pools excluded)
  flatten(): { f32: Float32Array; used: number; dirty: boolean };
}
interface GroupHandle { readonly id: string; set(t: Transform): void; spin(axis: 'x' | 'y' | 'z', rad: number): void } // local = rest·R
interface PoolHandle { readonly id: string; readonly capacity: number; count: number;
  pose(i: number, p: Vec3, yaw?: number): void; style(i: number, k: number): void }
```

- Ids are dotted and full; duplicates throw.
- Registration order doesn't matter: parents are resolved at `build()`, and an unknown parent throws.
- `node()` on a group without `moves` throws.
- `flatten` walks parents first, recomputing only below dirty nodes. `count > capacity` throws.

### M2.7 React blocks (`apps/app/src/blocks/`)

```tsx
<Scene views theme view paused debug>…blocks…</Scene>  // owns store + <Stage store>; context { store, path }
<Machine id position rotation>                         // root group; ids below resolve relative to it
<Group id position rotation moves>
<Box|Extrude|Lathe|Tube|Belt id material outline? crease? width? tone? position? rotation? contacts? {...geo props} />
<Instances id geo styles capacity marks? />  <Marks id material dots? segments? />
useFrame(cb): void                                     // registers in store.onFrame; never setState inside
useNode<H>(relId): () => H                             // lazy getter; resolves on first call, then cached
```

- Each block calls `useLayoutEffect(() => { const tk = store.part(full, …); return () => store.remove(full, tk) }, [geoKey, styleKey, transformKey])` and renders null.

### M2.8 Renderer and shell
- **`createRenderer({ root, context, format, width, height, dpr, store, theme })`.** `frame(t)`:
  - rebuild if `store.version` changed;
  - upload instances if dirty;
  - one encoder, one pass: fill batches, then marks;
  - submit, then `present?.()`.
- Cache `fitZoom` per resize or view, and fix a reference zoom for line width, so lines don't change width while orbiting.
- **Shell:** takes `store`; per frame calls `store.tick(time, dt)` with dt clamped to 0.1 s, then `renderer.frame()`. Resize must not re-apply the view preset over the user's camera.
- **`App.tsx`:** a `scene` chip (`gallery`, later `centrifuge`), and dev hooks `__v4.setScene(name)`, `__v4.setPoolCount(id, n)`. These throw on unknown names.

### M2.9 Gallery (`apps/app/src/gallery/Gallery.tsx`), 4×3 grid, light and dark
1. **M1 row:** box + tach, ribbed rotor (spin), tube. This is the regression check.
2. **Extrudes:** rect box, rounded slab with 2 seams, circle post, sector rim, rotated gusset (bands).
3. **Lathes:** smooth dome with line sets, sphere, closed ring tube, open pipe without caps, belt over two pulleys.
4. **Instances:** spinner group (carousel + 10 vanes + a 10-bolt circle); a packet pool with 3 materials, count cycling 0 → 12 → 0 every 6 s.
5. **Marks:** a needle on a `moves` group sweeping 270°, polyline rules, dots on a box top.
6. **Contacts:** post through a ring tube, rib sunk into a drum, saddle pad on a cylinder, and a flush box-on-box control (no line).

### M2.10 Unit tests (few)
- **`extrude.test.ts`**
  - a rect box has 12 creases;
  - rounded corners have no vertical creases;
  - a sector is closed and manifold;
  - seams add marked rings.
- **`tone.test.ts`**
  - `planShade` matches the kit's `extrude` bucket for 16 plan normals;
  - tube stripes sit at the kit's offsets.
- **`store.test.ts`**
  - nested spin gives vane world = rotor · local;
  - out-of-order registration resolves;
  - an unknown id throws;
  - a stale-token `remove` is a no-op;
  - `count > capacity` throws.
- **`contact.test.ts`**
  - post × ring endpoints lie on both surfaces and chain into closed loops;
  - flush box-on-box gives 0 segments.
- **`shaders.test.ts`:** the fill and marks shaders resolve to WGSL.

### M2.11 Acceptance criteria
- **Basics:** `pnpm test` and `pnpm types` are green, with no WebGPU validation errors on web or iOS.
- **M1 row:** unchanged at `fit` and `4× rotor limb`, in debug views 0 and 1.
- **Extrusions:** 4 plan steps on the sides, `top` on top, rounded corners step, and the rotated gusset uses bands.
- **Tubes:** body, shine stripe and shade stripe; no seam on closed loops.
- **Instances**
  - vanes keep their outlines at any spin angle;
  - pool counts 0, 12 and capacity show no ghosts;
  - per-instance materials are right.
- **Marks**
  - dots fade toward the limbs, hide on back sides and ride the spin;
  - the needle sweeps;
  - widths scale with zoom.
- **Contacts:** lines at post × ring, rib × drum and pad × cylinder; none on the flush control.
- **Themes:** light and dark both correct.
- **Perf, by eye:** the gallery spins smoothly on the iOS sim. A DEV log prints triangle and instance counts on each rebuild.

### M2.12 By-eye test plan (argent; screenshots in the scratchpad only)
- **Web:** the built-in pane on :8090. At most one extra Chrome, at DPR 1 via argent Chromium, closed afterwards.
- **iOS:** the simulator, DPR 3.
- **Normal views**
  - gallery `fit` in light and dark;
  - `yaw 160`;
  - `4×` on the contact row, the tube bend and an extrude corner;
  - debug view 1 for contacts and marks.
- **Edge cases**
  - pool count 0 / 12 / capacity;
  - spinner mid-spin, 3 shots, plus 3 paused angles;
  - theme toggle while spinning;
  - a Fast Refresh edit of one block prop: it updates once, with no duplicate-id throw;
  - hiding the pane and showing it again.
- **Write-up:** `v4/notes/M2.md` and a README update.

### M2.13 Risks
- **Contacts:** coplanar and grazing cases. The fallback is flush-only authoring.
- **Rebuild cost:** string-keyed topology on Hermes at about 200k triangles. Use the per-prototype cache; switch to numeric weld keys if needed.
- **Pipelines:** two pipelines in one pass is `~unstable` API. Fallback: a raw encoder plus `root.unwrap(pipeline)`.
- **Vertex cost:** the quad-partner work costs about 3× in the vertex stage. If needed, lower lathe `steps`.
- **React lifecycle:** effect order, StrictMode and Fast Refresh are handled by lazy parents and tokens.

### M2.14 Steps and checkpoints
1. Schemas, store core, and the renderer on batches, with M1 registered through the store. **Checkpoint A:** M1 identical, tests green.
2. Extrude, box wrapper, lathe seams and steps, closed tube, belt, `buildGeo`, topology cache and merge, plus their tests.
3. Plan and tube tone rules, with tests. **Checkpoint B:** stepped extrusions and striped tubes on screen.
4. Marks pipeline, the `dot` slot, the helpers.
5. Contacts into marks. **Checkpoint C:** the contact row is correct; on a miss, stop and report.
6. React blocks, `useFrame`, `useNode`; Stage and shell take the store.
7. Gallery, scene chip, dev hooks.
8. By-eye pass, `notes/M2.md`, README. Commit source and docs only.
