# Fix loop C2: the native path (CQ-M5 S1–S7, QA-M5 D1–D4)

Scope (C2): `src/native/**`, `src/core/slots.ts`, the slot-ownership code of `src/core/renderer.ts`,
`src/web/dom-slots.ts`, the native wiring in `src/web/main.ts`, the build's hook injection, `tools/native-gate.mjs`,
`tools/test-native.mjs`. Requests for C1's files go to `notes/FIXC-COORD.md`.

The rotor is the template for ≈ 20 native machines (PORT-PLAN P3), so every fix lands as machine-agnostic code first and
the rotor second.

## Design

### Host / machine split (S1, S2, S3; reuse for P3)
- `src/native/native-host.ts` — `NativeHost` (a `PainterHost`): the list of native machines on the page, their
  lifecycle and error containment. Machine kinds (`NativeKind`) are registered with the host; `machineGpu(id, api)`
  asks every kind, so any number of machines (two centrifuges, a centrifuge + an elevator) get their own `api.gpu`.
- `NativeMachine` (base class): slots, state (`idle → owning → failed`), the painter of the current renderer,
  `run(hook)` = the guarded hook body. On any throw: the error goes to `__gpu.errors` (`onError`), the machine becomes
  `failed` for good, its slots go back to the markup path (soft fallback, per machine), and the hook returns `false`
  so v2 draws that very frame. Nothing ever propagates into v2's tick.
- Painter at attach (S2): `attach(root, renderer)` builds every live machine's painter and `renderer.addPainter`s it,
  so `renderer.compile()` precompiles its compute pipeline (`pipelines()` returns it; no `initSync`). The host also
  awaits the same (memoized) `initAsync` and hands slots over only once the pipeline exists; a machine registered
  after attach gets its painter at registration (still outside v2's tick). Device loss: detach drops the painters,
  the next attach rebuilds them from the CPU model.
- Styles for v2's `KINDS` (fluff, control, graph, data, audio, garbage) are registered when the machine is created:
  a template mismatch fails at boot (contained: that machine never goes native). Unknown kinds register lazily, and
  a malformed kind (not `[\w-]+`) throws inside the guard → soft fallback.

### Single source of truth for ownership (S3)
- `Renderer.painterOfSlot` is the only owner record. `setSlotPainter(p, slots)` tells previous owners `release(lost)`
  and the new owner `acquire(gained)` (new, symmetric). `FrameContext.ownerOf(slot)` lets painters ask the renderer
  instead of keeping copies; `RotorPainter.owned` is removed.
- `NativeHost` records the markup painter (`renderer.painterOf(slot)` before taking a slot) and gives slots back with
  `setSlotPainter(markupPainter, slots)`.
- `DomSlotSource`: per-slot `refreshOf[slot]` (no global callback; several machines coexist), `ownNatively(slots,
  refresh)` and the new `disownNatively(slots)` (refresh → current v2 strings, clear the flag, mark dirty → the
  adapter parses them again). `release()` refreshes every distinct owner once.
- `LiveSlots` must re-enable an acquired slot (C1's file → FIXC-COORD request; `acquire` is optional on the interface
  until then).

### Records and limits (S6, D1)
- Classes leave the part record: a `classes: array<u32>` table, per part `classFirst`; facing / seam masks take
  ⌈n/32⌉ words each, shades ⌈n/16⌉. No ring-size cap besides an explicit sanity limit asserted at template
  registration.
- Templates (`PrismTemplates`): ring table + an earcut triangulation per template, computed once on the CPU; the top
  fill draws the template's triangles (no convex-fan assumption).
- Buffers sized from the model's exact `partCount / segCount / vertexCount / classWords` (grow-only, powers of two);
  `LARGEST_RING` and the duplicate ring constant go.
- `hypot2(x, y)`: an allocation-free replica of V8's two-argument `Math.hypot` (max-normalized sum; for two
  arguments the Kahan compensation is exactly 0), used in `classifyRing` and the model. Unit test: bit-equal to
  `Math.hypot` over the 7200-angle rings and ≥ 10⁶ random / edge inputs, interpreted and optimized.
- `RotorPainter.prepare`: `device.queue.writeBuffer(gpuBuffer, 0, records, 0, words)` — no host copy, no view,
  no options object per changed frame.

### Injection (S7)
- `tools/rotor-hook.mjs`: `injectRotorHook(script)` (moved from build.mjs) + `assertHookNames(script)`: every
  identifier the hook line passes is declared in `centrifugeLive` (`let|const|var|function NAME`, or a parameter of
  `centrifugeLive` / `drawRotor`). Build fails otherwise; a unit test proves a renamed variable is rejected.

### Tests and gates (S4, S5, D2, D4)
- `tools/test-native.mjs`:
  - S5 equivalence: runs the SVG page's whole module script (kit + runtime + v2 LIVE + stubs) in Node with a minimal
    fake DOM, the hook injected by `injectRotorHook`, `api.gpu` installed by the same define wrapper as the page; the
    hook runs `RotorModel.update` and returns false, so v2 writes its strings. Per tick the model's parts are turned
    back into markup with the kit's own functions (template ring → `extrude` / `solidSvg` / `ringSeam` / `onTop` /
    `lineSvg`), slot by slot, and compared with v2's strings: exact string equality over ≥ 3000 deterministic ticks,
    with audio / garbage / fluff packets injected. Covers every restated literal (0.6, 20.4, 0.1 bias, plan, steps,
    bevel, strap, band) and every `api.data` name. Mutation self-test: the model bundled with `VANE_DEPTH_RADIUS`
    20.4 → 20.3 and with `BAND_BELOW_TOP` 0.45 → 0.4 must fail it.
  - model facing / shade masks vs kit `extrude` for every part of those ticks;
  - `PACKET_KINDS` === v2 `KINDS`; palette test over all six kinds;
  - mirror test extended: 36-point (kit default rounded plan) and 64-point rings, exact edge-on angles;
  - host unit tests with fakes: two machines on one host (independent slots, per-slot refresh, one machine failing
    falls back alone), symmetric acquire / release through a fake renderer, error containment (hook never throws).
- `tools/native-gate.mjs contract`: decodes width, alpha, item, joinStart, joinEnd, crowd, flags; runs the CPU
  `SegWriter` on the read-back polylines and requires exact join / crowd / flag equality (f32), width / alpha / item
  equal to the markup path's records; checks each polyline's last-segment caps. Ticks with audio / garbage / fluff
  injected (D4). `--mutate crowd|join|width|tone|item` mutates the read-back records: each must fail.
- `identity --mutate patch`: a 1-CSS-px patch on the cached page must fail the 0-px identity.
- Requests to C1 (FIXC-COORD): `selftest:native:*` rows, injected-kinds coverage in `native:compare`, GATES.md /
  GPU-API.md text, LiveSlots `acquire`.

### ?native=cpu evaluation (≤ ½ day)
CPU emitter: the model's parts → `Seg` records through the existing `SegWriter.polyline` + fill vertices on the CPU,
uploaded into the same buffers the painter draws (no compute pipeline). Only if it stays small; measured against the
compute path: `ms.model` + emit time, bytes uploaded, GPU pass, live-js.

## Acceptance criteria
1. A throw anywhere in the hook path (model, styles, painter creation, compile) never reaches v2's tick: the error is
   in `__gpu.errors`, that machine draws v2's strings through the markup path from the same tick on, other machines
   keep drawing natively. Proven by unit tests with fakes and by a dev-page check (`?nativeFault=…`, dev bundle only).
2. No pipeline is built inside v2's tick; `RotorPainter.pipelines()` returns its compute pipeline; device-loss
   re-init gets a new painter (identity gate).
3. Ownership lives only in the renderer; acquire / release are symmetric; DomSlotSource refresh is per slot; the
   host handles N machines (unit test with two).
4. Contract gate compares width, alpha, item, joins, crowd, caps; every `--mutate` variant is rejected.
5. The Node equivalence test runs v2's LIVE for ≥ 3000 ticks, all six kinds, exact strings; both literal mutations fail.
6. Rings > 32 points classify exactly (unit), templates are triangulated once, buffers sized from exact counts.
7. Build fails when a hook identifier is not declared in centrifugeLive (unit-tested).
8. `hypot2` ≡ `Math.hypot` (unit); GC count over 2000 ticks native ≤ `?native=0` (3 runs).
9. `npm test` and `npm run gates:full` green; native perf rows (3-run medians) not regressed beyond noise (±10 %).

## Test plan
- `npm test` after each step; `node tools/build.mjs`; `node tools/native-gate.mjs contract|identity --quick` while
  iterating; `--mutate` variants; final `npm run gates:full`.
- GC: CDP trace (`disabled-by-default-v8.gc`) over 2000 turbo ticks after warm-up, native vs `?native=0`, 3 runs.
- Perf: `bench/run-m5-rows.mjs --only centrifuge- --force` (+ stress10) 3 runs, compared with FINDINGS-M5 / QA-M5.
- Manual (dev page): `?nativeFault=hook|painter` shows the rotor via the markup path, `__gpu.errors` holds the error,
  the figure keeps animating.
