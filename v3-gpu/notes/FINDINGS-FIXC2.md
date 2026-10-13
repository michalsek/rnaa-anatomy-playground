# Fix loop C2 findings (native path hardening)

Result: `npm test` 70 pass / 0 fail / 1 todo; `npm run gates:full` green (736 s) incl. new rows native:fault, selftest:native:identity, submit-failure-native edge, contract mutations. Native perf rows not regressed. chrome-reap: 0 orphans / 0 leaked profiles.

## Changes per finding
- **CQ-M5 S1 error containment**: any throw in the hook path (model, styles, malformed kind, painter build, pipeline compile) stays in that native machine → `__gpu.errors` (`native <id>: …`, non-fatal, console.warn), the machine stops drawing natively for good, its slots return to the markup path the same tick, hook returns false so v2 draws that frame. v2's six KINDS registered at define time (`V2_PACKET_KINDS`, unit-checked against v2); kinds not matching `[\w-]+` refused inside the guard; `assertRotorData` checks `api.data`. Guard written inline (no per-call closure). Gate `native:fault`: after the fault, frames = `?native=0` page 0 px at ticks 600, 711, 884, 932, 1100.
- **S2 precompiled pipelines**: painters built at attach before `Renderer.compile()`; `RotorPainter.pipelines()` returns the compute pipeline; machines defined after attach take slots only once compiled; after device loss slots retaken before the new renderer's first frame (identity 0 px after two losses).
- **S3 single source of slot ownership**: `SlotOwners` (src/core/slots.ts) owned by the renderer; moving slots calls `release` on the old owner and optional `acquire` on the new one (ownership can move back); painters ask `FrameContext.ownerOf(slot)`; `DomSlotSource` per-slot refresh callbacks + `disownNatively`; `NativeHost` / `NativeMachine` / `NativeKind` (src/native/native-host.ts) support any number of native machines per page (two-machine case tested with fakes only).
- **S4 + QA-M5 D2 contract gate**: checks width, alpha, item, caps, joins, crowd, flags against `SegWriter` run on read-back polylines; six mutations per tick (crowd, join, width, tone, item, caps) each rejected 5/5; `selftest:native:identity` (1 CSS px patch on cached page) rejected.
- **S5 model vs v2 code**: tools/v2-page.mjs runs the SVG page's module script in Node over a fake DOM (hook injected by the build's own function); for 3000 ticks the imported RotorModel is re-serialized with the kit's functions and must equal v2's slot strings (all six kinds, > 20 back/front swaps; face classification vs kit `extrude`). Mutated literals 20.4→20.3, 0.45→0.4, 0.6→0.61, 0.1→0 each caught.
- **S6 limits lifted**: face classes in a `classes` table sized for any ring; run starts on CPU; `PrismTemplates` earcut-triangulates each template once (concave rings OK); buffers sized from exact model counts (`LARGEST_RING` gone). Unit tests: rings of 4/12/36/64 points, exact edge-on angles.
- **S7 injected names checked**: tools/rotor-hook.mjs fails the build if any hook name isn't declared in `centrifugeLive` (renaming Ad / pockets / releasing / releasePose each fails a unit test).
- **QA-M5 D1 allocations**: `hypot2` bit-identical to V8 `Math.hypot(x, y)` (2·10⁶ inputs Node, 10⁶ in Chrome inside the contract gate) — must be a single return expression (early returns made TurboFan allocate); painter writes via `queue.writeBuffer` directly. Model allocation-free: 100k updates → 1 GC (QA: 157).
- **QA-M5 D3/D4**: docs fixed; packets of every kind + two unknown kinds (style table growth) injected in the contract gate and all three compare pages.
- **C1-1**: optional `SlotPainter.invalidate?()` called from `Renderer.invalidate`; rotor re-uploads/re-expands next frame. Edge `submit-failure-native`: 0 px with fix, 2859 px without.
- C1's crowd rule mirrored in the shader (`CHAIN_TOLERANCE` from strokes.ts); never fires on rotor shapes (checked by reading).
- Nits N1–N8, N11–N13 done. Bug found during CPU evaluation (opaque faces not drawn when `fall` empty) fixed; caught by native:compare and live.

## Results
- Contract: point distance ≤ 0.0675 viewBox units; fill area within 23 % of rounding bound; joins vs SegWriter ≤ 2.5e-5 (f32 noise).
- GC over 2000 ticks (3 runs): default flags native 363–366 scavenges vs `?native=0` 336–338; fixed 16 MB nursery native 276–277 vs 375–376; sampled allocation/tick native 4.2 MB vs 5.5 MB (−23 %). Native allocates less; under default flags V8 grows the nursery on the page allocating more, so it scavenges more often.
- Main-thread task ms/frame (medians of 3): desktop / phone 4× — HEAD native 2.24 / 6.71; C2 native 2.31 / 6.62; `?native=cpu` 2.46 / 7.28; `?native=0` 2.62 / 8.23. GPU pass desktop 1.57 ms native (unchanged), 1.51 ms cpu. stress10 rows not re-run.

## `?native=cpu` evaluation (informs PORT-PLAN P3)
src/native/rotor-cpu-emitter.ts (≈ 200 lines) builds the same records on the CPU via the existing SegWriter; painter uploads instead of compute. Pixels identical to compute (0 px at 6 ticks); record build 0.034 ms per changed frame; main thread +0.15 ms (desktop) to +0.66 ms (phone 4×) vs compute, mostly the larger upload (20.8 KB vs 1.35 KB/frame); GPU pass 0.06 ms cheaper.
Recommendation: start each new machine kind with the CPU emitter (no shader, exact stroke semantics, Node-testable); use the compute path as a main-thread optimisation for many-instance machines, both behind one record format as RotorPainter does now.

## Skipped / limits
- No GPU gate draws a ring wider than 32 points (classification unit-tested to 64).
- Errors inside a painter's per-frame work aren't contained per machine (handled as frame errors by the renderer).
- v2's `releasePose` and the page's event-based clock still allocate per call.
