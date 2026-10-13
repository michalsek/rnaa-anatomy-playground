# M3 findings — live adapter

(Full M3 report incl. design, gate tables and cost breakdown: see notes/PLAN-M3.md and out/gpu/live-gate/*.json; summary here.)

## Gates (DPR 2, lockstep, pixelmatch thr 0.1 · incl. AA · Δ>8)
- Static floor: dark 0.010 · 0.052 · 1.11 %; light 0.011 · 0.090 · 1.49 %.
- Live (8 ticks over idle/fill/spin-up/sync/spin-down): dark 0.010–0.011 · 0.050–0.056 %; light 0.011–0.015 · 0.085–0.091 %. DPR 4 ≤ 0.008 · 0.049 %.
- Packet fade (injected), reduced motion: same floor. 60 consecutive ticks: flat diff, GPU frame-to-frame change 0.99–1.02× SVG's → no popping. Readouts/aria-live equal at every frame.
- Edge cases: theme switch mid-animation 0 px; resize 1280→520 0.022 %; hidden stage pauses/resumes; unsupported markup dev throws / prod empty slot + one warn; no-WebGPU SVG fallback animates; device loss recovers.

## CPU cost per frame (median / p95 ms, 600 frames)
| | live-js | parse | upload | encode | GPU pass |
|---|---|---|---|---|---|
| 1280 DPR2 4× | 3.2 / 3.9 | 4.0 / 5.6 | 0.1 / 0.7 | 0.5 / 1.0 | 4.6 / 6.8 |
| 390 DPR3 4× | 3.2 / 3.8 | 3.9 / 5.6 | 0.0 / 0.8 | 0.5 / 1.1 | 4.1 / 6.8 |
| 1280 DPR2 1× | 1.0 / 1.2 | 1.0 / 1.4 | 0.0 / 0.1 | 0.1 / 0.2 | 3.9 / 6.5 |
perf.mjs main-thread task time/frame: 390 DPR3 4×: GPU page 8.8 ms vs SVG 12.1–13.2 ms (style 0.03 vs 1.7, layout 0.09 vs 1.0); 1280 DPR2 1×: 2.2 vs 3.1–3.7. Both 60 fps.

## Design
- v2 page module script runs verbatim (build fails on drift vs runtime.js / LIVE). Canvas replaces `<svg>`; hidden `svg.fx-live-slots` skeleton holds the 16 slot `<g>`s; classic inline bundle installs per-slot `innerHTML` setters before the deferred module runs.
- Setter: unchanged → skip; changed → dirty + one microtask that parses, uploads (one writeBuffer per changed slot) and renders right after the runtime's rAF callback.
- Geometry mirrors exporter rules; meshes memoized by `d` (≤ 4096); fast path parser for the kit's `M x yLx yZ` form (2.7× faster, equal on 2,114 paths); tools/test-live.mjs checks against build-dl primitivesOf.
- Live palette keys probed once and appended (46–56 live paints); theme switch re-probes and rebuilds slots.
- Slots are pseudo-items spliced next to their anchor (move with it under explode); depth = painter rank via per-frame prefix sum.
- Group opacity: `<g opacity>` with >1 drawable → bbox-sized 4× MSAA offscreen layer composited at the group's frontmost depth (exact for translucent packet lines + AA, unlike a stencil trick). Encode 0.5 → 0.6 ms on group frames; GPU pass unchanged.
- QA-M2 D1 fixed (backing = displayed device box; under CDP emulation devicePixelContentBoxSize is in CSS px → scale by DPR; FINDINGS-M2 tooling #1 was a misreading) → static floor 0.33 % → 0.010 %. D7: template SVG overlays until first GPU frame; pipeline.initAsync() → ready 127–146 ms (was ≈ 305).

## Findings
1. tools/lockstep.js not deterministic across pages (dt rounding depends on absolute frame number at runtime start; GPU page boots later) → visible divergence by tick ≈ 1500. live-gate.mjs rebases virtual time at the runtime's first IO callback → bit-identical over 1600 ticks. Port to lockstep.js.
2. Turbo lockstep (one virtual frame per MessageChannel macrotask): 1600 ticks in ≈ 3 s instead of ≈ 3 min.
3. The centrifuge page never fades a packet (stub feeder always passes `from`, centrifuge.mjs:922) → FINDINGS-M1 #6 latent here; group path tested by injecting `accept("in", item)`.
4. Parse dominates the adapter (4.0 vs 3.2 ms LIVE at 4×): strict tokenizer, chain keys, tessellation, packing. Next win: M5 native rotor or a per-element-markup cache.
5. Move the kit-format path fast path into svgsub.mjs (benefits M1 too).
6. TypeGPU friction: setVertexBuffer type-checks the schema → one buffer used as both array<Seg> and FillVertex passes raw `.buffer`; `root.unwrap(anyTyped)` picks the compute-pipeline overload; partial writes via device.queue.writeBuffer.
7. Kit module script contains the text `</body>` → insert at lastIndexOf.
8. CDP tooling: close tabs (`/json/close/<id>`) — a resumed page left open starves the next; under frozen rAF redraw resized canvases inside the ResizeObserver callback.

## Known gaps
- Live strokes always round-joined (iso-wire-end / fx-fluff should be butt/miter; not on this page).
- `api.el` / `api.els` return null on GPU pages (skeleton holds slots only).
- Gradients / halos / dashes in live slots rejected (dev throws, prod skips).
- Nested layer groups folded per element (approximation).
- Fill alpha outside groups quantized to 1/1024, folded into derived paints.
- Per-frame allocations remain in the parse path (GPU path allocation-free except while groups active).
- Preview overlay not repositioned on resize during the ≈ 0.13 s boot.
- Bundle 389 KB (was 333 KB); live-dev.html 6.4 MB (inline sourcemap).
- M2 items left for the M2+M3 fix loop: `any` handles, halo leaks, dl-loader re-implementing dl-format, QA-M2 D2–D6, D8, D9.
