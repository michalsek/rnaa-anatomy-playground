# PORT-PLAN: from the centrifuge prototype to the whole v2 factory

Status 2026-10-13. Measured on Apple M4 Pro with Chrome 155 headless. The M6a baselines were taken on Chrome 154, so
today's SVG reference rows were re-run. desktop = 1280 px at DPR 2. phone = 390 px at DPR 3 with 4× CPU throttle. The
throttle slows only the renderer main thread, and the GPU is the M4's, so a real phone GPU is slower.
Scripts and raw output are in `out/tmp/port/`; all of them are read-only for v2:
- `make-scenes.mjs`, `kit-shim.mjs` and `scenes/`: copies of every v2 build with only the imports rewritten. The audit
  is skipped; settle and sort still run.
- `census.mjs`: SVG features of each page, plus the exporter's verdict for the whole scene and for each item.
- `locate.mjs`: maps each feature to the items that use it.
- `export-skip.mjs`: DL size with the rejected items left out.
- `live-census.mjs`: 1200 turbo-lockstep ticks; slot bytes, identical writes, features and DOM mutations outside slots.
- `live-export.mjs`: runs live markup through the v3 parser.
- `envelopes.mjs`: slot envelopes and the minimum static-layer split.
- `profile.mjs`, `perf/`: CPU profile and perf.mjs rows.

## 1. Census

| scene | items | slots | SVG KB | path / circle / g | other elements | L cmds | live KB/frame (p95) | identical bytes | live DOM outside slots, per tick | static export |
|---|---:|---:|---:|---|---|---:|---:|---:|---|---|
| packets | 1 | 1 | 3 | 11 / 4 / 6 | – | 166 | 7.8 | 0 % | – | clean |
| centrifuge | 239 | 15 | 635 | 1661 / 209 / 529 | 1 linearGradient | 44.3k | 40.0 (50) | 23 % | – | clean |
| conveyor | 340 | 19 | 735 | 2769 / 193 / 787 | – | 46.9k | 48.9 (59) | 0 % | – | clean |
| crusher | 130 | 6 | 429 | 1092 / 59 / 332 | – | 30.0k | 7.6 (11) | 20 % | 8.4 innerHTML into `data-part` groups, 4 transforms, appendChild into 15 items | clean |
| packer | 159 | 8 | 398 | 1286 / 145 / 360 | – | 26.5k | 114 (212) | 0 % | – | clean |
| scanner + elevator | 387 | 19 | 818 | 3276 / 227 / 912 | – | 50.1k | 161 (169) | 3 % | 13 `style.opacity` writes (cable pulse) | **throws**: 27 items (inline `style="fill:…"`) |
| screen (phone + speaker) | 138 | 6 | 316 | 1013 / 94 / 335 | 13 rect, 1 text, 4 clipPath, 1 radialGradient | 20.3k | 4.7 (6.6) | 40 % | 3 transforms, 2 `r`, 0.4 style | **throws**: 9 items + 1 back entry |
| **factory, open** | 1158 | 64 | 2574 | 8761 / 784 / 5062 | 20 rect, 2 text, 5 clipPath, 1 radial + 2 linear gradients | 157k | **224 (302)** | 5 % | 8 transforms, 13.6 style, 2 `r`, 8.2 innerHTML | **throws**: 39 items + 5 back entries |
| factory, tour | | | | | | | 234 (341) | 5 % | **+435 transforms, 472 re-inserted nodes** | |
| factory, reduced motion | | | | | | | **122, 100 % identical** | 100 % | 4 transforms, 50 re-inserts | |

Path data uses only M/L/Z, static and live (no C, Q or A curves). No mask, filter attribute, dasharray, `data-pulse` or
dash attributes. Blend: the centrifuge `cf-glow` only. Halos: CSS blur.

**Exporter gaps**, with the items that hit them:
- inline `style` fill, stroke, opacity, stop-color, fill-rule or display: 48 paths (scanner cable chunks,
  elevator/speaker flanges and ears, display glass);
- static `clipPath`: `speaker.throat`, `phone.end`, the display glass, plus the explode well applied to 3 back halo
  groups;
- `<g transform>` (meter, SIM, glass);
- `<rect rx>` (20);
- `<text>`: "9:41" and the speed pill;
- radialGradient (display glow);
- evenodd (React logo).

Almost everything lives in `phone.display.glass` (the animated screen and its controls) and the speaker.

**Export size:** with the rejected 3 % left out, the factory DL is 78.6k triangles, 52.8k segments and 758 dots (3.2× /
2.5× the centrifuge). The bin is 5.8 MB (1.1 MB gzip), against 0.46 MB gzip for the whole SVG page.

**Live gaps:** 8 of 64 slot families are rejected by the v3 parser:
- `crusher:glow` (radialGradient);
- `crusher:lens` (class `cr-lens` is unknown to roles);
- `phone:tube` (`<stop style>`: a gradient rebuilt every frame);
- `packer:picker` (`circle stroke-width`);
- `scanner:arm`, `scanner:lamp` and `scanner:buffer` (inline style);
- `speaker:packet` (clip-path).

7 non-slot innerHTML targets (the crusher's rollers, flywheel, pulley, spring, needle and lacing marks) are invisible to
the M3 slot interception.

**Hot paths** (factory open, KB/frame and cumulative share):

| slot | KB | cum. |
|---|---:|---:|
| `elevator:front` + `:back` | 98.5 | 44 % |
| `packer:picker`, `:folder`, `:lane`, `:stack` (bursty, up to 89 KB per write) | 52.9 | 68 % |
| `audio:top`, `:bottom`, wraps, slats | 34.9 | 83 % |
| centrifuge (crank 6.7, 100 % identical) | 16.5 | 91 % |
| scanner | 9.8 | 95 % |

**Script is the floor.** The anchor rows below are the re-measured factory, open, n = 2:

| row | desktop | phone |
|---|---|---|
| SVG: main / script / GPU raster (ms per frame) | 18.5 / 10.7 / 16.5 | 81–92 / 48–53 / 15.6 |
| SVG: frame rate | ≈ 54 fps | 12 fps |
| Slots frozen (strings still built, no slot DOM): main / script | 11.8 / 7.6 | 54 / 36 |
| Slots frozen: GPU raster | **15.8** | – |

GPU raster stays at 15.8 ms with frozen slots because the non-slot mutations still invalidate the single paint layer.

A CPU profile of the frozen script (desktop): kit geometry and string formatting dominate.
- `pathOf` + `tenth` take 2.6 ms of about 7 ms of JS.
- `iso`, `extrude`, hulls and lathes take about 2.5 ms.
- The simulation ticks take under 0.2 ms.

## 2. Assembly-level needs

| need | v2 today | GPU design |
|---|---|---|
| Explode | 4 pieces on staggered springs. The `transform` is set on every `.xm` and wrappers are re-sorted by `k + l·share(piece)`. | Export `move`, piece and lift per item (CQ-FIXA S4). Per frame: 4 piece offsets in a uniform and a CPU sort of 1158 keys (≈ 0.1 ms) into the order buffer. The static cache rebuilds at rest; during motion the whole scene is redrawn (≈ 2.5–3× the centrifuge's `?cache=0` pass of 1.33 ms ≈ 3.5–4 ms on M4; a phone GPU is unknown → risk). Later: one cache per piece. |
| Device / canvas | – | One device and one canvas for the factory page. For pages with several figures, the S6 `GpuDevice` service gives each figure its own canvas on a shared device. |
| Well clip | `clip-path` on about 1100 wrappers and 3 halo groups | The clip is static in screen space: "above the band's lower edge" is a y_max(x) function. Use a 1D texture lookup per fragment for items flagged floor/low/high and their halos. No stencil needed. |
| Gradients | linear (funnel), radial (display glow, crusher lamp) | Add a radial paint type next to the existing linear one. Gradients in live slots need the adapter extended (rejected today). |
| Static clips, transforms, rects, evenodd | – | Handle at export: libtess intersection for fills, segment clipping for strokes, baked matrices, rounded rects turned into polylines, the libtess odd winding rule. |
| Text | 2 SVG texts on the moving display | HTML overlay positioned from the display piece offset plus the tap dip (2 nodes, one transform per frame). |
| Hit-testing | `[data-ctl]` play / speed, tap anywhere on the display | 3 real `<button>`s in the overlay, positioned the same way. Neither an ID buffer nor the hidden SVG is needed (it is `display:none` and cannot be hit). |
| Fullscreen / playback / slider / keys | HTML plus FACTORY speed and paused | Unchanged: HTML and runtime. |
| Accessibility | stage `role=group`, aria-live, slider | Canvas `role=img` + `aria-label`, aria-live as today. The overlay buttons fix v2's unfocusable `<g role=button>`. |
| Reduced motion | the loop keeps running and rewrites 122 KB per frame | The GPU skips unchanged slots already. Also stop the loop when calm and nothing has changed. |

## 3. Options

Perf is for the factory open at rest. The C, B, D and A columns are estimates scaled from the measured rows: parse ≈
22 µs/KB desktop and 78 µs/KB phone (M5 markup rows). Native savings scale with the bytes they replace: the
preliminary M5 rotor covers 16 % of the centrifuge's bytes and saves 18–24 % of live-js and parse.

| | today (SVG) | C: SVG wins | B: baked static runs | D: GPU static + SVG live | A: adapter only (P2) | A + native top-4 (P3) |
|---|---|---|---|---|---|---|
| desktop main / raster (ms) | 18.5 / 16.5 | 11–13 / 8–9 | 13–15 / 2–4 | ≈ B | 13–14 / GPU 1.5–2.5, 4 while exploding | ≈ 5 / same |
| desktop fps | ≈ 54 | 60 | 60 at rest; SVG while exploding | ≈ B | 60 | 60 |
| phone main (ms) / fps | 85 / 12 | 45–50 / 20–22 | 60–65 / 15–16 | ≈ B | ≈ 55 / 18 | **15–20 / 50–60** (verify on a device) |
| quality risk | – | layered snapping: 2.3 % of px within ½ px | Canvas2D drops gradients, clips, blur and blend unless "effects" are written; DPR change → re-bake (100s of ms); pinch-zoom blurs | ≈ B, plus WebGPU canvas compositing | measured floors (DPR 2 loose 0.010 %) | native vs markup 0.0001 % (M5) |
| two render paths? | – | no | yes: SVG plus a Canvas2D baker | yes: three (SVG, GPU, SVG overlay) | yes: SVG fallback, gated | yes |
| RN-wgpu | no | no | no | no (live still needs SVG) | yes: src/core is DOM-free, needs a DOM-free runtime port | yes: the structured channel is the RN path |
| human engineer-days | – | 6–12 | 12–20 | 15–25 | P0–P2: 21–33 | +18–32 (total 45–75) |
| agent-orchestrated | – | 2–3 days | 3–5 days | 4–6 days | 4–7 days + 4–6 days of human review | +4–7 days + real-device QA |

**C details, with gains:**
- 60 Hz cap: −50–58 % per second at 120/144 Hz, nothing per frame.
- Dirty-check: measured ≈ 0 on the factory (only 5 % of bytes are identical). Halting the loop when calm wins 100 %
  under reduced motion.
- Transform rigid parts:
  - Only translations stay rigid under the iso projection: packets, buckets on straight runs, slats. These are 50–60 %
    of bytes (elevator ≈ 85 %, audio runs ≈ 90 %).
  - Rotors, arms and drums are not rigid: they need flipbooks (`<use>` with N poses) or regeneration.
  - Gain: script −35–45 %, style and layout −30 %.
- Per-piece CSS custom-property transforms, and re-inserting only the wrappers that moved: the tour goes from 435 to 4
  writes per tick, and style+layout from 7 to about 3 ms.
- `will-change` on slots: measured GPU raster −45 % (16.9 → 9.2), fps unchanged.

C cannot reach 60 fps on phones, because the strings that remain still cost too much.

**B details:**
- `canvas-painter.mjs` is a per-frame repainter for turn-kit, not a cache. It expects:
  - `svg[data-live]` layers with `.iso-parts > [data-p]` runs;
  - a controller with `scene().runs[i].role/roles`, `frames()` (per-run box, `t`/`tm` transforms, `o` alphas,
    `sx`/`sy`), `orderIndex(layer)`, `emitted()` and `setUnit`.
- It compiles ops from `getComputedStyle` for each element: about 10k calls on the factory.
- What it drops or approximates:
  - `url()` gradient fills are skipped silently;
  - clip-path, filter and blend are not handled;
  - group opacity is folded into each element.
- An adapter means:
  - restructuring the figure into one `svg[data-live]` per static layer;
  - a fake controller (static frames, `emitted() = []`);
  - effects for the gradient, halo, blend and clip;
  - re-baking on resize, DPR or theme changes.
- The layer split (`envelopes.mjs`, bounding boxes, slots only) is the minimum count that keeps every slot at its
  painter position:
  - centrifuge: 8 static layers + 9 SVG layers;
  - factory open: **24 static + 25 SVG layers**, covering 2.47× the figure area. That is ≈ 15 MB of canvas at phone
    DPR 3 (6.2 MB for a full-figure layer) and ≈ 28 MB on desktop.
  - The about 40 non-slot animated elements would add more live layers.
- During the explode tour the order and the split change every frame, so B falls back to SVG while the factory moves.
- B removes the whole-tile replay (GPU raster) and most of the static DOM's style and paint (17.7k elements → about 3k).
  It does not touch script (10.7 desktop / 48 phone ms), the main thread's limit on phones.

**D** solves the interleaving with the same envelope partition (the static cache in fix A already computes envelopes),
but it needs about 24 interleaved WebGPU canvases or textures. Drawing static art once gains nothing over Skia. D costs
more than B for the same result, and A does more than both.

## 4. Recommendation

**Do A, in phases, with C's v2-side hygiene first.** On phones every option is limited by script that builds strings.
Only A + native/structured painters removes it, and the same channel is the RN path. Skip B and D.

| phase | work | gate (measure) | human days |
|---|---|---|---|
| **P0 v2 hygiene** (also helps the SVG page) | Route every live DOM write through declared slots or a `api.part(name).transform/alpha` call. Inline styles → classes. 60 Hz cap. Halt the loop when calm and unchanged. Per-piece CSS var transforms; re-insert only moved wrappers. | `live-census`: 0 non-slot innerHTML; reduced motion 0 B per frame; tour ≤ 10 attribute writes per tick; SVG audit and line ends clean; factory desktop at rest ≥ 58 fps | 3–5 |
| **P1 static factory on GPU** | Exporter: inline paints, rect, matrices, static clips, evenodd, radial paint, part-CSS roles + probes, `move`/piece per item. Well-clip flag. Overlay text and buttons. DL quantized to i16 (the kit already rounds to 0.1). | every part exports with no rejected items; static gate at DPR 1/2/4 on the centrifuge floors; explode gate at shares 0 / 0.4 / 1 (S4); DL ≤ 600 KB gzip | 8–12 |
| **P2 live factory, adapter path** | 64 slots + the part protocol; the 8 rejected slot families; shared device (S6); timestamps off (S5); per-piece static cache | live / motion / determinism gates across the tour, open and reduced motion; perf rows desktop + phone; full-redraw GPU pass during explode | 10–16 |
| **P3 structured channel + native painters** | Kit primitives write typed records (no strings) → GPU instancing for prisms, slabs, discs, lathes and lines (generalize M5). Then elevator → packer → audio belt → centrifuge, ranked by measured bytes. | native-contract parity for each painter; phone main ≤ 16 ms; check on real iOS 26 Safari and Android Chrome with WebGPU; stop if the elevator alone cuts phone main by < 30 % | 18–32 |
| P4 RN host | DOM-free runtime, a `MemorySlotSource` or channel, an export-time palette table (CQ-FIXA sketch) | the same frames as web, from the gate replay | 6–10 |

**Top risks:**
1. The phone win depends on P3, which rewrites every machine's drawing code: the largest cost and a behaviour-parity
   risk. The preliminary M5 data saves roughly in proportion to the bytes replaced, not more.
2. Explode motion redraws the whole factory (about 3–4 ms on M4; unknown on phone GPUs). Per-piece caches may be
   needed.
3. A hidden live protocol outside slots (crusher, speaker, scanner, phone) must be formalized first (P0).
4. Payload: the factory GPU page is about 1.7 MB gzip against 0.46 MB; it needs quantization or export in the browser.
5. The SVG fallback stays forever, so there are two paths to keep in sync; the determinism and live gates are the
   guard.
6. Unresolved parity issues on mobile: a 0.62 % diff under 452 px mobile emulation, and browser zoom at DPR 1.25/1.75.
7. The assembly build takes 204 s and 2.1 GB, which slows every exporter iteration.

## 5. Issues found in v2 / kit (new)

1. **Live writes bypass slots:**
   - crusher: appendChild into 15 items, innerHTML into 6 `data-part` groups, transforms on block, gate and bin;
   - speaker: cone and cap transforms, LED `style.fill`;
   - scanner: `style.opacity` on 24 cable chunks;
   - phone: logo rotate, ripple and nucleus `r`.

   With slots frozen, the factory still costs 15.8 ms of GPU raster per frame, and every slot-based tool (dirty-check,
   the frozen bench, the v3 adapter) misses these writes.
2. Reduced motion: the factory rewrites 25 slots (122 KB) every frame, all identical, plus 50 node re-inserts.
3. Inline `style="fill:var(--…)"` (48 static paths and 3 scanner slots) bypasses the tone classes.
4. The explode sets the transform on each wrapper (about 435 writes per tick) and re-appends every wrapper on any order
   change (about 472 nodes per tick).
5. `clip-path` is set on about 1100 wrappers instead of once per piece (cost not measured).
6. `phone:tube` rebuilds a `<linearGradient>` with an id in its slot every frame; `crusher:glow` holds static radial
   gradients in a live slot. Global ids (`fx-well`, `centrifuge-void`) clash when a page has two figures.
7. The playback controls are `<g role="button">` with no tabindex, so Tab cannot reach them; Space is captured for the
   whole document.
8. Packer slots write rarely but very large strings (up to 89 KB per write; frame p95 302 KB against p50 238 KB).
9. The assembly build takes 204 s with 2.1 GB peak RSS.
10. `canvas-painter.mjs` silently skips `url()` fills and has no clip, filter or blend support. Its `unsupported` list
    reports only geometry tags.
11. The perf baselines were taken on Chrome 154 and the machine now runs Chrome 155: re-baseline before comparing.
