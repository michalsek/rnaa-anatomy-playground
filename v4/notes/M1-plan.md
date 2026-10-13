# M1 "line spike": implementation plan

*2026-10-13. Written by the planning agent from `ARCHITECTURE.md`, the M0 engine, the kit (`~/.claude/skills/anatomy/kit/{iso.css,iso-kit.mjs,lathe.mjs,tube.mjs}`), `craft.md`/`3d.md`, `v2-factory/parts/centrifuge/centrifuge.mjs` and the lessons in `v3-gpu/REPORT.md`. §8 was trimmed by the orchestrator: lighter verification, by eye.*

## 0. Facts that shape the design

- **Kit strokes are 0.6 CSS px and don't scale with the figure.** `iso.css` sets `.iso-svg path{vector-effect:non-scaling-stroke}` and `--anatomy-weight:.6px`.
  - Outline (`iso-edge`), crease (`iso-crease`) and texture lines (`iso-line`) are 0.6.
  - Tube rings are 0.45; the tach sync tick is 1.3.
- **Kit tones.**
  - Outline is `mid` (`hi` for the subject); crease is `faint` (`lo` on hi parts).
  - v2 tach (graphite): 18 ticks over 270°, from r 3.2 to 4.6. Arc and minor ticks are `mid`, every 3rd (major) tick is `hi`.
  - Motor ribs are `lo`, faded by facing with `fade:[0.1,0.55]`. `3d.md` fades planes with `[0.04,0.3]`.
- **The kit's outline/crease split matches a per-frame silhouette.** A rim's back half is a silhouette (outline tone); its front half is a crease (faint).
- **The M0 lathe has degenerate triangles at the r=0 caps** (192 for the rotor). They make the radial edges non-manifold.
  - Winding is CCW from outside, which is CW on screen because the kit projection is mirrored.
- **Curved silhouettes fall on sliver triangles.** The front facet next to the limb is seen almost edge-on: its projected width is 0–0.7 px, against a 0.6–1.8 device-px line.
  - A line drawn only inside the triangle that owns the edge gets cut, and pulses during spin.
  - So curved bodies also need a **smooth-contour term** (§2.4).
- **Lesson from v3:** use box-filter coverage, so ink equals line width. Blend in gamma space (non-sRGB target, raw hex). Clamp the drawn width to 1 device px and scale alpha by the true width.

## 1. Mesh format, topology, generators

### CPU `Mesh` (`geo/mesh.ts`)

Add to the mesh:
- `uvs: Float32Array`, 2 per vertex;
- `tags: Uint32Array`, per triangle: the UV line-set id, 0 = none;
- `marks: Uint32Array`, vertex-index pairs of forced line edges.

`MeshBuilder` changes:
- skip triangles with area < 1e-12 (this fixes the cap degeneracy);
- `tag(set)` applies to the triangles that follow;
- `mark(a, b)` records a forced edge;
- `mergeMeshes` rebases `marks`.

### Topology (`geo/topology.ts`, new)

`buildTopology(mesh) → { adj, flags, faceNormals }`, run after merging.

- **Weld key:** `part:qx,qy,qz`, positions quantised to 1e-4. Including the part means touching parts are never adjacent.
- **Edge numbering:** edge `i` is opposite corner `i`: edge 0 = (v1,v2), edge 1 = (v2,v0), edge 2 = (v0,v1).
- **Adjacency:** `adj[3t+i]` = the triangle across edge i, or `0xFFFFFFFF`.
- **Crease:** the two triangles' vertex normals differ by more than 1° at either welded endpoint, OR the edge is in `marks`. This gives:
  - box: 12 creases, no diagonals;
  - lathe: sharp knots are creases; smooth knots and the u-seam are not;
  - tube: only the cap rims.
- **Boundary:** an edge with no neighbour.
- **`smooth` bit:** any vertex normal differs from the face normal by more than 1°.
- **Throws** on a non-manifold edge (3+ triangles) and on inconsistent winding.

### GPU schemas (`render/schemas.ts`)

Vertex pulling: no vertex or index buffers, `draw(triCount*3)`. Write packed `ArrayBuffer`s and assert `d.sizeOf`.

```ts
const GpuVertex = d.struct({ position: d.vec3f, u: d.f32, normal: d.vec3f, v: d.f32 });            // 32 B
const GpuTri = d.struct({ idx: d.vec3u, part: d.u32,
  faceNormal: d.vec3f, flags: d.u32,   // bits 0-2 crease[i], 3-5 boundary[i], 6 smooth, 8-15 lineSet
  adj: d.vec3u, _pad: d.u32 });                                                                     // 48 B
const Part = d.struct({ model: d.mat4x4f, material: d.u32, outlineSlot: d.u32, creaseSlot: d.u32, width: d.f32 }); // width: CSS px at fit
const LineSet = d.struct({ count: d.f32, phase: d.f32, first: d.i32, last: d.i32, majorEvery: d.u32,
  minorSlot: d.u32, majorSlot: d.u32, width: d.f32, majorWidth: d.f32, fade: d.vec2f });          // ≤ 8 sets, id-1
const Frame = d.struct({ viewProjection: d.mat4x4f, light: d.vec3f, toward: d.vec3f,
  viewport: d.vec2f, pxPerCss: d.f32, debug: d.u32 });                                             // pxPerCss = dpr·lineScale
```

Edges have no GPU table of their own; per-edge data lives in the triangle's `adj` slot `i` and its `flags` bits.

### Generators

- **box:** uv zeros.
- **lathe:**
  - `u = k/steps`, `v` = cumulative profile length;
  - `lineSets?: {segment, set}[]`;
  - `marks?: number[]`, knot indices whose ring is forced as a line;
  - default `steps` 128.
- **tube (`geo/tube.ts`, new):** `tube({ path, radius, sides=32, bend=3·radius, caps=[true,true], part })`.
  - Corners are filleted as arcs of radius `bend`, 8 samples per 90°.
  - Rings use parallel-transport frames, with `sides+1` vertices per ring and smooth radial normals.
  - `u = j/sides`, `v` = arc length.
  - Caps are a centre vertex plus a ring with normal ±tangent, so the mesh is closed and manifold.

## 2. Shader design

### 2.1 Barycentrics under vertex pulling

- In the vertex stage: `t = vertexIndex/3`, `c = vertexIndex%3`.
- Output `bary` one-hot for corner c, with `linear` interpolation.
- Flat outputs (`heights`, `modes`, `material/slots`) are identical for all three vertices of a triangle.
- If TGSL rejects a dynamic index like `idx[c]`, use a `std.select` chain instead.
- Don't use the `primitive_index` builtin; it's an optional feature.

### 2.2 Screen-space altitudes

- Project the corners to device px.
- Altitude of corner i: `h_i = |cross2(p_{i+2}−p_{i+1}, p_i−p_{i+1})| / max(|p_{i+2}−p_{i+1}|, 1e-6)`.
- In the fragment, `dist_i = bary_i · h_i` is the device-px distance into the face from edge i.

### 2.3 Silhouette test: per frame, in the vertex stage

- `facing(t) = dot((model·vec4(faceNormal,0)).xyz, frame.toward)`. `toward` is the camera basis vector, so this stays valid under orbit.
- Edge mode, in order:
  - own face back-facing → 0;
  - boundary → 2 (outline);
  - `facing(adj) ≤ 0` → 2;
  - crease bit set → 1;
  - otherwise → 0.
- Culling: `frontFace:'cw', cullMode:'back'`.
- A compute prepass over an edge list is only worth it with a second consumer (fallback F1).

### 2.4 Smooth-contour term (curved bodies)

- Only on `smooth` triangles: `f = dot(normalize(n_interp), toward)`, then `dist_c = f / max(length(vec2(dpdx(f), dpdy(f))), 1e-6)`.
- It uses the outline slot.
- Outline coverage = max(mode-2 edge terms, contour term).

### 2.5 Coverage

The same `'use gpu'` functions run on the CPU in tests.

```ts
export const overlap = (x: number, lo: number, hi: number) => {
  'use gpu'; return std.clamp(std.min(hi, x + 0.5) - std.max(lo, x - 0.5), 0, 1); };
export const wire = (w: number) => { 'use gpu'; const drawn = std.max(w, 1); return d.vec2f(drawn, w / drawn); };
export const edgeCoverage = (dist: number, extent: number, alpha: number) => {
  'use gpu'; const share = std.clamp(dist + 0.5, 0.125, 1);   // MSAA writes only this face's samples
  return std.min(1, (alpha * overlap(dist, 0, extent)) / share); };
export const tickCoverage = (dist: number, drawn: number, alpha: number) => {
  'use gpu'; return alpha * overlap(dist, -drawn / 2, drawn / 2); };
```

- Line width: `w = part.width · frame.pxPerCss`, then `(drawn, alpha) = wire(w)`.
- **Outline:** `extent = drawn`, inside the face. The ink matches the SVG, shifted by w/2.
- **Crease:** `extent = drawn/2` on each side of the edge.
- **Compose order:** band → ticks → crease → outline, each step `mix(c, tone, cov)`.

### 2.6 Line tones

Add `mid, lo, faint, lit` slots, values from the kit:

| material | theme | mid / lo / faint / lit |
|---|---|---|
| steel | light | `#8a8a8f / #b4b4b8 / #d4d4d6 / #000` |
| steel | dark | `#6a6a6a / #3e3e3e / #2a2a2a / #fff` |
| graphite | both | `#8b8f97 / #5c6068 / #43464d / #fff` |
| react | light | `#2a6f86 / #4f97b1 / #7cc3dc / #000` |
| react | dark | `#61dafb / #3c8aa6 / #2a6377 / #fff` |

### 2.7 Depth

- Lines are the face's own fragments: depth-tested, and they end where the face ends.
- Contacts between parts are not lines. In M1, seat parts flush with a 0.02 standoff; the real contact rule is M2.
- Compute `fwidth`/`dpdx`/`dpdy` before any branch, to keep control flow uniform.

## 3. Line width vs zoom

- `w_device = width_css · dpr · lineScale`, with `lineScale = camera.zoom / fitZoom(viewport, yaw, elevation)`.
- At fit this is 0.6 CSS px, matching the kit; zoom scales it like a pinch-zoomed SVG (Decision 3).
- Widths are stored as CSS-px-at-fit, so tuning uses the kit's numbers.

| element | M1 width | tone |
|---|---|---|
| outline (silhouette, boundary, contour) | 0.6 | `mid` (`hi` for the subject) |
| crease, forced ring | 0.6 (½ per side) | `faint` (`lo` on hi parts) |
| tach ticks, minor / major | 0.6 | `mid` / `hi` |
| needle (stretch goal) | 1.3 | `hi` |
| drum ribs | 0.6, fade [.1,.55] | `lo` |

## 4. Band AA

- `s = dot(normalize(n), light)`, `fw = fwidth(s)`.
- `w_k = clamp((s − BANDS[k]) / max(fw,1e-6) + 0.5, 0, 1)`.
- Blend: `c = s0; c = mix(c,s1,w0); c = mix(c,s2,w1); c = mix(c,s3,w2); c = mix(c,top,w3)`.
- On flat faces this equals `toneOf`. Add `bandWeights` to `shading/tone.ts`.

## 5. UV tick line sets

- `x = u·count − phase`, `i = round(x)`, `dist = |x−i| / length(vec2(dpdx(x), dpdy(x)))`; draw only if `wrap(i) ∈ [first,last]`.
- Majors (major tone and width) where `(i−first) % majorEvery == 0`.
- Fade: `alpha *= smoothstep(fade.x, fade.y, dot(normalize(n), toward))`.
- Ticks span the full height of the tagged segment, so they end on its crease or forced ring.
- Making spin visible:
  - a raised rib band on the rotor (r 8.2→8.6, z 3–9.5), 36 ribs, `lo`, fade [0.1,0.55];
  - an annulus on the hub top (r 2.2–3.0, forced ring at 2.2), 24 ticks, a major every 6th.
- Stretch goal: a 1-tick "needle" set whose `phase` the frame updates.

## 6. Scene and app

`scene/m1.ts` replaces `m0.ts`. Bounds come from the transformed mesh AABBs.

Parts:
- **steel box**, 12×12×10;
- **steel rotor**: the M0 profile plus the rib band and the hub dial;
- **graphite tach**:
  - profile `[[0,5.4],[2.4,5.4],[2.4,4.6],[1.9,4.6],[1.9,3.2],[1.9,0]]`;
  - ticks: 18 over 270° (`count 24, first 0, last 18`), a major every 3rd;
  - seated on the box's +y face, axis +y, with a 0.02 standoff;
- **react tube**, r 0.9: runs from the box's +x face, arcs over, and lands on the rotor flange top.

`PartSpec` gains `rotation`, `outline`/`crease` tones and `width`. The model matrix is `T·R·Rz(spin·t)`.

View presets (`{name, yaw, elevation, zoom, focus?}`):
- `fit 45/30`
- `yaw 20`
- `yaw 70`
- `yaw 160` (back)
- `elev 10`
- `elev 60`
- `0.5× thin`
- `4× box corner`
- `4× tach`
- `4× rotor limb`
- `4× tube bend`

Renderer API: `setView(view)` and `setDebug(0|1|2)`.
- Debug 1: line classes drawn on paper. Outline red, contour magenta, crease blue, ticks green.
- Debug 2: lines off.

The shell gets `setPaused`.

App: a top-right button row `[view] [pause] [debug] [theme]`. Each button has an `accessibilityLabel` and a hit area of at least 44 pt.

## 7. Unit tests (a few, meaningful)

- **topology:**
  - box: 12 triangles, 18 edges, 12 creases, symmetric adjacency;
  - lathe: no degenerate triangles, closed, signed volume ≈ the analytic volume;
  - tube: closed with caps, and with boundaries when the caps are off;
  - a reversed profile throws.
- **silhouette:** a CPU port of `edgeMode` at the kit view.
  - The box gives 6 outline edges forming one closed hexagon.
  - The lathe's silhouette edges form closed loops.
- **coverage** (the `'use gpu'` functions run on the CPU):
  - ink conservation over sub-pixel offsets;
  - the two crease halves sum to one full line;
  - peak ≤ min(1, w).
- **tone:** `bandWeights` with fw=0 equals `toneOf`.
- **resolve:** the full vertex and fragment functions resolve to WGSL.

## 8. Acceptance and by-eye check (trimmed)

**Acceptance criteria:**
- `pnpm test` and `pnpm types` are green, with no WebGPU validation errors on web or iOS.
- **Debug view 1 is correct:**
  - box: a red hexagon, 3 blue creases, no hidden edges;
  - rotor: magenta limbs, and rims split back/front;
  - every step has its own side outlines.
- **Lines and ink:**
  - lines read thin and even, not 2-px smears;
  - silhouettes are not visibly lighter than creases;
  - no visible breaks at corners at 4×.
- **Ticks and ribs:**
  - ribs fade before the limbs and end on the band creases;
  - spin is visible;
  - tach ticks end on the ring, with majors in `hi`.
- **Bands and zoom:**
  - band edges are soft, with no stairs at 4×;
  - at 0.5× lines thin out without breaking into dashes.
- **Final bar:** the user judges that it "reads as Anatomy" next to the v2 crops.

**By eye, light on resources:**
- **Web:** the built-in browser pane on :8090, at the Mac's DPR. Run at most ONE extra Chrome, with `--force-device-scale-factor=1`, for a DPR 1 look. Drive it with argent Chromium (CDP), then close it.
- **iOS:** the simulator (DPR 3).
- **Views:** `fit`, `yaw 160`, `4× tach`, `4× rotor limb`, `0.5× thin` in light + dark. Add `fit` and `4× rotor limb` in debug 1. Spin check: 3 shots of `4× rotor limb` while unpaused.
- **Screenshots:** go in the session scratchpad only.
- **References:**
  - `v2-factory/parts/centrifuge/qa/z-instr-{light,dark}.png`;
  - `z-rotor-{light,dark}.png`;
  - `centrifuge-light.html`.
- **Write-up:** a short `v4/notes/M1.md` with verdicts and problems.

## 9. Risks and the fallback decision point

**Risks:**
1. Slivers at curved limbs. Handled by the contour term (§2.4).
2. TGSL gaps. Unroll, or use a raw-WGSL `tgpu.fn`.
3. Missing contact lines. Use a standoff for now.
4. The crease→outline switch along a rim.
5. Acute corners can over-darken a little.
6. Edge-on faces. Clamp the altitudes.
7. Tubes use the lathe band rule (known gap). Judge the lines, not the tube tones.

**Trigger:** check after step 8, at 1× fit. Any of these means fallback:
- T1: silhouettes read lighter or thinner than creases, or than the v2 outlines;
- T2: notches of 1 px or more in 2+ presets;
- T3: silhouette width pulses during spin.

One tuning round of at most ½ day is allowed. If a trigger still holds, **stop and report with screenshots; don't build the fallback inside M1.**

**Fallbacks, in order:**
- **F0:** dilate the triangles that own outline edges, with alpha-to-coverage.
- **F1 (preferred):** a compute pass extracts silhouette segments, drawn as depth-tested quads straddling the edge; creases and UV lines stay in-face.
- **F2:** screen-space edge detect.
- **B:** three.js.

## 10. Steps and checkpoints

1. Palette line slots.
2. MeshBuilder (degenerate skip, uv, tags, marks); lathe uv, sets and marks; box uv; `tube.ts`; `topology.ts` and its tests. **Checkpoint A:** tests green, M0 unchanged.
3. Renderer to vertex pulling, culling cw/back, the extended `Frame`. **Checkpoint B:** looks the same as M0; `yaw 160` is fine.
4. `shading/lines.ts` and coverage tests; altitudes, modes, silhouette; composition; debug modes.
5. Smooth-contour term. **Checkpoint C:** debug view 1 is correct and the limb doesn't pulse. If C is missed, stop and report.
6. Band AA.
7. Views, and app buttons for view, pause and debug.
8. Ticks and the scene (ribs, hub dial, tach, tube).
9. By-eye pass (§8), `notes/M1.md`, README update, apply the §9 decision. Commit source and docs only.
