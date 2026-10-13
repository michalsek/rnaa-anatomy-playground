# M4 findings — packaging

Status: `npm run gates:full` green (793 s); new `package` row (54 checks); 72 unit tests; chrome-reap 0 orphans.

## Deliverables
- `centrifuge-gpu.html` (dark) and `centrifuge-gpu-light.html` (light, ships): single self-contained files, work over file:// and http://. `npm run build` writes them (`npm run package` = export + build); byte copies of out/gpu/live(-light).html, hash-checked by the build and by the `package` gate row → every gate runs on the deliverable bytes.
- Size: raw / gzip-9 — before (M5 live page) 3,844 / 773 KB; deliverable 1,537 / 498 KB; v2 SVG page 763 / 160 KB. Display-list binary in a compact lossless encoding (export/dl-wire.mjs, decoded with DecompressionStream): 2,637 KB → 251 KB inline, bit-exact round trip (no lossy quantization). Remaining breakdown: v2 page incl. SVG figure (fallback + boot preview) 763 KB, bundle 482 KB, display list 307 KB.
- Decode cost: 7 ms desktop, 35 ms phone 4× (gunzip 22 ms, unpack 10 ms).
- Boot: two steps — everything v2's script needs immediately, GPU view once the binary is decoded; device requested at start in parallel with decoding (desktop time-to-first-GPU-frame 153 → 134 ms); palette read from the JSON half alone (`paletteOfDl`).
- Renderer indicator: no visible badge (card identical to v2); `html[data-renderer]` = `svg` while the vector figure shows (booting, fallback, disposed) / `webgpu` once the canvas takes over; one `console.info` line (e.g. "figure renderer: WebGPU · TypeGPU (apple metal-3)" or "SVG fallback (no-webgpu)").
- New fallback reason `dl-decode-failed: …` (no DecompressionStream). `?native=0`, `?cache=0`, reduced motion (v2's own), animated labelled SVG fallback all work.

## package gate row (tools/package-gate.mjs, quick + full)
Byte identity with live pages, no external references; both themes over file:// and http://: ready, data-renderer=webgpu, native rotor active, one console line, otherwise clean console; `?native=0`, `?cache=0`; three fallbacks (no WebGPU, null adapter, no DecompressionStream); deliverable vs committed v2 page at ticks 711, 884, 600 (reduced motion): loose 0.010–0.0135 %, incl. AA 0.052–0.091 %, solid blob 0, runtime state equal. No threshold changed. New unit test for the encoding round trip.

## Comparison shots (report/, numbers in report/README.md)
Reference: committed v2 pages (= fresh v2 build out/svg at tick 971, 0 px). Method: drive.mjs + lockstep + tick gate, readouts equal at every shot; full card at DPR 2, crops rendered at DPR 4 (not magnified). hero-*.png are real-time capture.mjs shots, not part of the comparison.
Cells: loose % / incl. AA % / largest channel Δ; solid blob 0 everywhere.

| subject | light | dark |
|---|---|---|
| full card 1× | 0.0102 / 0.072 / 99 | 0.0088 / 0.044 / 99 |
| rotor + packets 4× | 0.0197 / 0.292 / 86 | 0.0303 / 0.196 / 60 |
| tach hairlines 4× | 0.0111 / 0.208 / 70 | 0.0111 / 0.244 / 70 |
| belt stub edges 4× | 0.0035 / 0.156 / 72 | 0.0025 / 0.017 / 44 |
| funnel gradient 4× | 0.0219 / 0.202 / 65 | 0.0061 / 0.242 / 59 |
| halo edge 4× | 0 / 0.033 / 56 | 0 / 0.002 / 37 |
| motor ribs 4× | 0.0104 / 0.292 / 68 | 0.0139 / 0.258 / 59 |
| lamp glow 4× | 0 / 0.136 / 67 | 0 / 0.087 / 44 |
| motion strip, 12 frames (worst) | 0.089 / 0.420 | 0.069 / 0.411 |

Heatmaps: blue ≤ 8 levels, amber ≤ 32, red above. Differences are edge AA only (native rotor's lost 0.1 rounding, Chrome hairline weights). The Δ 99 on both full cards is a single hairline pixel column.

## Perf (out/perf/final/rows.md, medians of 3)
| | v2 SVG | GPU deliverable |
|---|---|---|
| single desktop (1280 DPR2): main ms/frame | 3.11 | 2.16 (GPU pass 1.57) |
| single phone (390 DPR3, 4×): main ms/frame | 10.97 | 6.82 |
| stress10 iframe desktop: fps / dropped / main | 44.9 / 25.2 % / 22.3 | 60.0 / 0 % / 13.9 |
| stress10 iframe phone: fps / main | 11.7 / 86.0 | 15.0 / 66.9 |
| load desktop: first paint / DCL / first GPU frame (ms) | 48 / 14 / – | 68 / 52 / 134 (M5 page 127) |
| load phone: first paint / DCL / first GPU frame (ms) | 120 / 108 / – | 124 / 202 / 538 (M5 page 504) |
Phone: first GPU frame ≈ 30 ms later than M5 page (throttled decode ≈ 35 ms), DCL 47 ms earlier; SVG figure on screen from first paint either way. Frame rows measured on the build just before the device-request change (boot-only change; gates show identical frames); load rows on the final build. JS heap: GPU page 18 MB vs SVG page 3.5 MB (TypeGPU + scene).

## Notes
- Small additive edits outside M4's files: tools/gates.mjs (package rows), tools/harness.mjs (PAGES.deliverable), tools/test-export.mjs (round trip), package.json (`package` script), notes/GPU-API.md (data-renderer, fallback reason, encoding), notes/GATES.md (package row). New: tools/report-shots.mjs (`--readme-only`), bench/run-final-rows.mjs (`--freeze`, frozen copies in bench/final/).
- Headless: a page query in a freshly opened Chrome sometimes never returns (v2 page too); load script retries in a fresh Chrome (final run needed none). Gates unaffected.
