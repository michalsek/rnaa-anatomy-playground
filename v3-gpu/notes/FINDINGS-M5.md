# M5 findings — native instanced rotor

The four slots `drawRotor` writes (rotorBack, rotorFront, spout, fall) are drawn from rotor state — no SVG string built, parsed or tessellated for them per frame. Default live pages use it; `?native=0` restores the fix-A markup path; every fallback runs v2 unchanged.

## Design
- **Injected line** (tools/build.mjs, GPU live pages only; build fails unless exactly one `function drawRotor(now) {`; text from `ROTOR_HOOK_LINE` in src/native/rotor-contract.ts):
  `if (api.gpu?.rotor?.(Ad, pockets, releasing, now, releasePose, drawRotor)) return;`
  Returns true (skip v2) only from the first presented GPU frame until a fallback → boot preview and fallbacks get v2 strings.
- **State contract**: per call `Ad`, `pockets[i].kind`, `releasing[]` (item.kind, t0, a0), `now`; `releasePose` is v2's own kinematics (called, not re-implemented); per machine `api.data` (pockets, centre, toward, r.vaneIn/vaneOut/pocket, z.pocket/vane/packet) and `api.P`; v2 literals restated in rotor-model.ts (vane half-thickness 0.6, sort radius 20.4, packet plan 2 corner steps, bevel 0.3, strap ±5, band at h − 0.45·PK when h > 0.55·PK, depth bias +0.1); `drawRotor` itself so reading a native slot's innerHTML re-runs it with the hook bypassed and returns v2's exact strings. Completeness: native records = markup records at all 24 LIVE ticks; runtime state bit-identical to SVG over 3000 ticks; pixels match at AA level.
- **CPU**: depth values, stable sort and back/front split use v2's expressions (bit-identical); face visibility/tone and band seam runs use the kit's arithmetic in f64 (unit test: 7200 angles × 3 rings exact), sent to GPU as bitmasks; one 80-byte record per part per frame; unchanged frame → no upload, no new frame; allocation-free after warm-up.
- **GPU**: one ≈ 1.1 KB write + one compute dispatch (one 64-thread workgroup per part) per changed frame, expanding parts into existing `Seg` records (exact SegWriter.polyline semantics: round caps, joins, crowd incl. pinch points, polyline ranges) in v2 document order, and `FillVertex` records (top fan + sides). Drawn with existing pipelines only: one fillOpaque draw for all four slots + one instanced stroke draw per slot; 10 depth layers per part; paints via the same palette keys as the markup path (template markup through SlotGeometryBuilder); paper hull omitted (faces tile it exactly).
- **CQ-FIXA S1 fixed**: renderer owns slot→painter assignment; `setSlotPainter` calls `release()` on the previous owner; only owning painters are prepared/drawn; LiveSlots and the adapter skip released slots; `addPainter` registers without slots; `GpuViewOptions.painters` attach before compile() and on every re-init. DomSlotSource: native-owned slots keep writes but never schedule frames; reading them or `release()` on fallback triggers the lazy v2 refresh.
- **CQ-FIXA S5 fixed**: GPU timestamps opt-in (`?profile`, `?gpuTime`, `window.__gpuTimestamps`).
- API: `?native=0|1`, `frameStats().native`, `__gpu.nativeCheck()` (dev page).

## Gates (`npm run gates:full` all green, 623 s, no threshold loosened)
New rows: native:contract, native:identity, native:compare, native:sheet, live:markup, selftest:live (drop-native), selftest:live:markup (drop-slot).
- Contract: max point distance 0.0685 (kit rounds to 0.1); fill areas within 29 % of the rounding bound.
- Identity: cached = `?cache=0` 0 px both themes; after two device losses painter draws again, = fresh page 0 px; explode share 0.4 0 px.
- Compare (loose max; solid blob 0 everywhere):

| | native vs SVG | markup vs SVG | native vs markup |
|---|---|---|---|
| DPR 1 | 0.097 % dark / 0.125 % light | 0.093 / 0.124 % | ≤ 0.004 % |
| DPR 2 | 0.012 / 0.014 % | 0.011 / 0.013 % | ≤ 0.0011 % |
| DPR 4 | 0.0024 / 0.009 % | 0.001 / 0.008 % | ≤ 0.0014 % |

Intended difference: lost 0.1 rounding (edges move ≤ 0.07 viewBox units). Crops: out/tmp/gates/native/crops/; motion sheet: out/tmp/gates/native/sheet/ (no popping at back/front swaps). 10k ticks: heap flat 5.67–5.99 MB. Geometry uploaded per frame 78.8 KB → 53.0 KB + 1.1 KB part records.

## Perf (medians of 3, ms/frame; out/perf/m5/rows.md)
| page · config | renderer | fps | main task | live-js | parse | encode | GPU pass Σ |
|---|---|---:|---:|---:|---:|---:|---:|
| centrifuge · desktop | SVG / markup / native | 60 / 60 / 60 | 3.05 / 2.38 / 2.00 | – / 0.93 / 0.79 | – / 0.89 / 0.69 | – / 0.12 / 0.14 | – / 1.51 / 1.57 |
| centrifuge · phone 4× | SVG / markup / native | 59.6 / 60 / 60 | 10.61 / 8.19 / 6.89 | – / 3.01 / 2.47 | – / 3.13 / 2.40 | – / 0.47 / 0.57 | – / 1.51 / 1.57 |
| stress10 · desktop | SVG / markup / native | 43.5 / 58.0 / 60.0 | 22.8 / 16.9 / 13.6 | – / 7.35 / 5.83 | – / 7.17 / 5.29 | – / 0.96 / 0.97 | – / 9.27 / 7.54 |
| stress10 · phone 4× | SVG / markup / native | 10.7 / 14.5 / 14.7 | 94.6 / 69.3 / 68.7 | – / 29.1 / 27.0 | – / 29.2 / 28.4 | – / 5.69 / 7.07 | – / 36.0 / 30.0 |
Single figure: main thread −16 % (desktop and phone) vs markup path, −35 % vs SVG. Stress10 desktop: clean 60 fps (0 % dropped vs 3.3 % markup). Stress10 phone: still saturated ≈ 14.5 fps — remaining page script dominates. Cost: encode +0.02–0.1 ms, GPU +≈ 0.06 ms for the compute step.

## Known gaps
- Only the rotor's four slots are native; other slots ≈ 55 % of the remaining parse.
- Rotor fills assumed opaque (true in both themes; no translucent-fill branch). Paper hull not drawn natively.
- Contract area check can't catch a wrong tone on extremely thin faces (unit test checks tones exactly).
- Explode moves nothing on these scenes (CQ-FIXA S4) → share 0.4 check proves reordering only.
- RN host untested with the native painter. `?cache=overlay` clean to tick 900.
- tools/perf.mjs "GPU pass Σ" empty unless the page enables timestamps (`?gpuTime` or bench/preload/gpu-timestamps.js).
