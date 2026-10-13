# CQ-M5: code-quality review of M5 (native instanced rotor)

**Scope.** Commit `8b99e77`: `v3-gpu/src/{core,live,web,native}` and `v3-gpu/tools/{build,native-gate,test-native,gates,gates.config,live-gate}.mjs`. That is +2177 / −38 lines in 23 files. `src/native/` is new (8 files, 1416 lines), so I read it in full. Elsewhere I read the hunks plus the code around them. The working tree equals the commit for these paths, so all `file:line` references hold at HEAD. I made no code edits. I also read v2 (`parts/centrifuge/centrifuge.mjs` `centrifugeLive`, `shared/runtime.js`) without changing it.

**Lens.** This pattern is the template for porting the hot paths of about 20 machines. I looked at:
- what is specific to this machine and what can be reused;
- the cost of restating v2 literals, and how drift is detected;
- how fragile the injection is;
- whether the WGSL expansion is correct;
- the CPU/GPU split and the allocation-free claim;
- ownership and release, and how they interact with the static cache;
- TypeGPU idiom.

**Rules applied.**
- `code-quality-dictionary.md` §M, TS-1…TS-7, MR-4, §R and §N. The React, RN and [REPO] rules have no equivalent here.
- The expressive-code skill.
- TypeGPU 0.12.7 idiom, checked against `node_modules/typegpu` (`createGuardedComputePipeline`/`dispatchThreads`, `memoryLayoutOf`, `TgpuBuffer.write`), plus SPIKE.md.

## Measurement (§M, adapted)

| Step | Result |
|---|---|
| 1 Size | 2177 added lines. That is reviewable, because 1416 are one new, self-contained module. |
| 2 Gates | `tsc -p src/tsconfig.json`: **0 errors**. `node --test tools/test-native.mjs`: 4/4 pass. `test-export` + `test-live`: 36 pass, 1 todo. There is no lint or format tooling. |
| 4 Type-aware lint | I ran `eslint.typeaware.mjs` on the changed TS files with punchbowl-mobile's typescript-eslint 8. It found **4 NEW** hits: `rotor-contract.ts:30` `no-redundant-type-constituents` ×3 (N2) and `main.ts:159` `!`, which is in dev-only code. The other 43 hits are older and mostly `!` in `renderer.ts`. |
| 5 Deprecations | `deprecations.cjs` on the changed files: **0**. |
| 6 Grep pass | No `any`, `as unknown as` or `@ts-` in added lines. There are two casts: `api.data as RotorData` (`native-rotor.ts:74`, see S5) and the dev-only `elements.get(...)!`. |

## CQ-FIXA claims

- **S1 (painter ownership): mostly fixed.** What I verified in code:
  - `Renderer.setSlotPainter` calls `release()` on the previous owners (`renderer.ts:249-261`).
  - Only `activePainters` are prepared and drawn (`:325`, `:387`, `:393`), and `writeRegion` sums only their versions (`:546`).
  - `LiveSlots.update` and `LiveAdapter.flush` skip released slots (`slot-renderer.ts:118-120`, `adapter.ts:73-77`).
  - `PainterHost.attach` runs before `compile()` on every init and re-init (`frame-loop.ts:271-273`).
  - The identity gate's two device losses show that re-attach works.

  **Not fixed** is the bullet "painter pipelines compiled ahead". The native painter's `pipelines()` returns `[]`. It compiles synchronously in its constructor (`rotor-painter.ts:63-69`), and that constructor runs lazily from inside v2's tick (S2). `addPainter` has no external caller, and `painterOf` is unused (N8).
- **S5 (timestamps): fixed.** The query set is created only with `options.timestamps` (`renderer.ts:220`). The web host enables it for `?profile`, `?gpuTime` and `__gpuTimestamps` (`main.ts:209`). Two optional follow-ups from CQ-FIXA were not done: resolving inside the frame's encoder, and sampling 1 frame in N. Both matter only while profiling.

## Findings

No blockers. The pixel, contract, identity and determinism gates are green, and the WGSL expansion is correct as far as I can verify by reading (see "WGSL" below).

### Should-fix

**[S] S1 Any exception on the native path freezes the whole factory.**
- **Where:** `native-rotor.ts:140-163`, `:169`; `rotor-styles.ts:61-81`; v2 `shared/runtime.js:105-122`.
- **What happens:** v2's `tick` calls `requestAnimationFrame(tick)` as its *last* statement, with no `try`. So a throw inside `drawRotor` stops every machine on the page for good. The hook can throw on this path in several ways:
  - **By design:** `RotorStyles.add` throws when a packet kind seen for the first time produces a template with another primitive count or with non-round caps. This happens inside the tick, at the kind's first appearance, not at boot.
  - `new RotorPainter`, with `createComputePipeline(...).initSync()` and buffer creation, runs inside the tick at first activation (S2). A WGSL compile failure on some driver, or a lost device, throws there.
  - Any model bug, for example a NaN from a renamed `api.data` field. That one only draws garbage and does not throw.
- **Fix:**
  - Wrap the body of `rotor()` in `try/catch`. On error, record it through the host (`onWarning` or `recordError`), `deactivate()`, request a fallback (a soft one after S3), and `return false` so that v2 draws this frame.
  - Pre-register the styles for v2's `KINDS` (`shared/kit.mjs:17`) in the `NativeRotor` constructor, so that template mismatches fail at boot.

**[S] S2 The native painter is built and compiled inside v2's tick, not ahead of time.**
- **Where:** `native-rotor.ts:103-108`, `:154`, `:166-173`; `rotor-painter.ts:63-69`, `:92-94`.
- **What happens:**
  - `takeSlots()` constructs `RotorPainter` on the first hook call after `onReady`. Its constructor does a synchronous `initSync()` pipeline build and 3 buffer creations, all inside a rAF callback right as the GPU figure appears.
  - `pipelines()` returns `[]`, so `Renderer.compile()` never sees the compute pipeline.
  - This contradicts two docs: the `PainterHost` doc ("before the renderer compiles its pipelines", `frame-loop.ts:76-85`) and GPU-API.md ("`addPainter` … compiled with the renderer").
- **Fix:**
  - In `attach`, always construct the painter and call `renderer.addPainter(painter)`.
  - Make `RotorPainter.pipelines()` return `[this.pipeline]` and drop `initSync`. `compilePipelines` already mutes `external-omitted`.
  - Have the hook only call `renderer.setSlotPainter(painter)` when ownership begins.
  - This removes `registered` and `painter ??=`, and the `warn.disable/reset` copy (N12).

**[S] S3 Slot ownership is one-way, and its state is held in four places.**
- **Where:** `renderer.ts:159`; `slot-renderer.ts:77`, `:106-116`; `rotor-painter.ts:49`, `:96-102`; `dom-slots.ts:26-28`, `:66-69`.
- **The four copies:**
  - `Renderer.painterOfSlot`
  - `LiveSlots.released`, which is never cleared
  - `RotorPainter.owned`, which is never re-set
  - `DomSlotSource.native`, which is permanent, plus a single `refreshNative` callback
- **Consequences:**
  - The renderer can give a slot back with `setSlotPainter(liveSlots, slots)`, but `LiveSlots.owns()` stays false, so the markup path can never take a slot back.
  - The only recovery from a native problem is a whole-figure SVG fallback.
  - `ownNatively` *overwrites* `refreshNative`, so a second native machine silently disconnects the first one's markup refresh. Its `innerHTML` readers and the SVG fallback would then get stale strings.
- **Why it matters:** with about 20 native machines, per-machine soft fallback (native → markup) and per-slot refresh are needed.
- **Fix:**
  - Make the renderer the single source of truth. Painters ask `frame.ownerOf(slot) === this`, or receive their owned slots in `prepare`/`drawOpaque`; this finally gives `painterOf` a caller.
  - Make release symmetric with an `acquire(slots)`, or have `setSlotPainter` re-enable the slots on the new owner.
  - Give `DomSlotSource` a per-slot `refreshOf: (() => void)[]` and a `disownNatively(slots)`, which writes the current strings and resumes dirtying.

**[S] S4 The contract gate does not check the stroke fields that are hardest to restate.**
- **Where:** `native-gate.mjs:32-51`, `:121-129`; `rotor-shaders.ts:152-254`.
- **What happens:** The WGSL re-implements `SegWriter.joinPolyline` (`strokes.ts:141-191`): join bisectors, hairpin and sharp-turn crowd, and pinch points. `decodeSegs` never reads `joinStart`, `joinEnd` or `crowd`. Only `p0`/`p1`, paint, the first segment's caps and the sign of the layer order are compared, so the claim "exact SegWriter.polyline semantics" is backed only by pixels.
- **What I checked by reading:** the pinch and join neighbourhoods match the CPU: segment k gets joins (k−1, k) and (k, k+1), and pinches of k−1, k and k+1 under the same `first`/`last` guards.
- **Fix:** Decode the three fields and compare them against `SegWriter` run on the *read-back* `p0`/`p1` polylines on the CPU. This is exact up to f32, independent of the kit's 0.1 rounding, and needs no tolerance invention. While there:
  - check `roundEnd` on each polyline's last segment;
  - replace `& 48` with `SEG.roundStart | SEG.roundEnd` (N3).

**[S] S5 Drift from v2 literals and data is detected only end-to-end, and the unit test checks its own copies.**
- **Where:** `rotor-model.ts:15-28`; `native-rotor.ts:74`; `test-native.mjs:28-40`; `tools/fixtures/live-markup.json`.
- **What is restated and how it is checked:**
  - Eight v2 literals in `rotor-model.ts` (0.6, 20.4, 0.1, the plan, 2 steps, 0.3, 5, 0.45/0.55) are checked only by the browser gates: contract at 24 ticks with a 0.08 tolerance, pixel compare, and the 60-frame sheet.
  - `test-native.mjs` hard-codes `P`, `D` and `PACKET_PLAN` and rebuilds the rings with its *own* 0.6. It never imports `rotor-model.ts`, so `RotorModel` has no browser-free test at all.
  - The markup fixture was recorded by hand in `cdb744c` and nothing regenerates it.
- **What gets missed:** a change to the 20.4 depth radius moves only back/front swaps. The 24 contract ticks can miss that, and the sheet catches it only between ticks 700 and 759.
- **Also:** `api.data as RotorData` is an unchecked cast (TS-5).
- **Fix:**
  - Add a node test that evaluates v2's `LIVE` (`centrifugeLive.toString()`) with a fake api. Read `data` and `P` from the exported page's `__FACTORY_DATA__`, record the slot writes and use the real `releasePose`. Run thousands of ticks and compare `RotorModel`'s parts (slot, order, centre, angle, z, kind) with the parsed strings. That one test detects every restated literal and every data rename without a browser.
  - Read `P` and `D` in `test-native` from the same source.
  - Add a dev-mode `assertRotorData(api.data)` in `machineGpu`.

**[S] S6 The representation hits a wall on the next machine.** This matters for the template, not for today's rotor.
- **Where:** `kit-mirror.ts:72-75`; `rotor-shaders.ts:82-84`, `:264-275`; `rotor-painter.ts:17-22`, `:212-218`.
- **The limits:**
  - **Ring size.** Facing, seam and shade masks are 32-bit, so rings are capped at 16 points (32 shade bits). The cap is undocumented in code paths and asserted nowhere. The kit's `roundedPlan` default (8 steps) gives 36 points, and lathes or cylinders have more.
  - **Fill triangulation.** The top fill is a fan from vertex 0, which is only correct for convex plans.
  - **Buffer sizing.** Buffers are sized as `capacity × LARGEST_RING = 12`. That is a second copy of `PACKET_RING_COUNT` (`rotor-model.ts:33`); today it is safe only because the model throws on a ring of another size.
- **Fix:**
  - Size `segs` and `fills` from `model.segCount` and `model.vertexCount`, which the model already computes exactly. This is smaller and cannot under-allocate.
  - Triangulate each template once on the CPU (earcut is already a dependency) and upload an index table per template. The template is rigid, so this stays exact.
  - Store per-face classes as `array<u32>` words, or as a `vec4u` for 128 faces, indexed by `ringFirst`, and assert the limit when a template is registered.

**[S] S7 The injected hook depends on v2's lexical names, and the build does not check them.**
- **Where:** `build.mjs:51-65`; `rotor-contract.ts:56`.
- **What happens:** The build checks that exactly one `function drawRotor(now) {` exists, which is good: a changed signature fails loudly. Renaming `Ad`, `pockets`, `releasing` or `releasePose` still builds. It then throws a `ReferenceError` inside `drawRotor` on every tick, which freezes the factory (S1). Gates would catch it, but late and noisily.
- **Fix, now:** for every identifier in `ROTOR_HOOK_LINE`, assert a declaration in the `centrifugeLive` source at build time. A regex `\b(let|const|var|function)\s+NAME\b` is enough, or a scope check with acorn.
- **Fix, longer term:** a sanctioned v2 extension point (see v2 notes below) instead of text injection. Injection is still the right call while v2 must stay untouched.

### Nits

| ID | Where | Problem → fix |
|---|---|---|
| N1 | `rotor-painter.ts:116-117` | Each changed frame allocates `new Uint32Array(host)` and a `subarray`. Cache the view in `Buffers`, or `partBuffer.write(model.records.buffer, { endOffset: bytes })`, which costs the same single copy (`TgpuBuffer.write`). FINDINGS-M5 "allocation-free after warm-up" holds for the model only. v2's `releasePose` (called as `poseOf`) allocates 1–4 arrays plus an object per released packet per frame. Say so. |
| N2 | `rotor-contract.ts:30` | `'rotor' \| 'spout' \| 'fall' \| string` collapses to `string`, so narrowing is lost (lint). v2 returns only the three, so drop `\| string`. |
| N3 | `native-gate.mjs:124`, `:333` | `& 48` is a magic number, and the `!==` test in front of it is redundant. Use `SEG.roundStart \| SEG.roundEnd`. `worst.solid <= 4` should be `NATIVE.sheet.solidCluster` in `gates.config.mjs`. |
| N4 | `rotor-styles.ts:28`, `rotor-painter.ts:80` | The initial style capacity 8 is written twice with no shared name. Use one constant, or size the buffer from `styles.count`. |
| N5 | `rotor-shaders.ts:256-262` | `writeVertex` hand-packs `FillVertex` (`d.unstruct({pos, ids: uint16x4})`, `schemas.ts:56`) as `item \| paint<<16`, `layer \| alpha<<16`, with no range check. Values ≥ 65536 bleed into the neighbour field. Share one pack helper with the core shaders, and assert `item`/`paint`/`layer` < 2¹⁶ on the CPU. |
| N6 | `rotor-shaders.ts:87-92`, `:121-131`, `:219-222` | Every `slotDrawn` call recomputes `runStart` (O(n)) inside run-walking loops, so a thread does O(n²–n³) work. The CPU already has the masks: put `facingRunStart`/`seamRunStart` in `RotorPart`. GPU cost is +0.06 ms today, so this is hygiene, not a hot spot. |
| N7 | `rotor-model.ts:223` | `band = packet && height > PK * BAND_MIN_HEIGHT` is always true, because packet height ≡ `PK`. It mirrors v2's `h > PK*0.55` with constant `h`. Fine as a mirror, but the comment should say it is constant here. v2's `packet()` early return (`h <= 0.25`) is not mirrored either, for the same reason. |
| N8 | `renderer.ts:264`, `:241`, `:255` | `painterOf` has no caller (S3 gives it one). `addPainter` is only called internally (S2 gives it a caller). `[...spread]` per released slot is quadratic but rare. |
| N9 | `slot-renderer.ts:106-116` | `release()` keeps the released slots' GPU buffers and bind groups. The `SlotPainter.release` contract says "drop what they hold" (`slots.ts:62-66`). Destroy `state.buffer` and reset `group` and `capacity`. |
| N10 | `pipelines.ts:73-76` | The structural type `{ initAsync(): Promise<void> }` is written inline twice. Name it (`Compilable`). |
| N11 | `rotor-painter.ts:168-182` | Dev readback re-packs `Seg` field by field. That is a third manual mirror of the Seg layout, and a field missing there reads as 0. Copy raw bytes instead: a `copyBufferToBuffer` to a MAP_READ buffer. |
| N12 | `rotor-painter.ts:63-69` | A second global, non-reentrant `warn.disable/reset` (CQ-FIXA S6). S2 removes it. |
| N13 | `rotor-model.ts:180` | `pack(total, PK)`, `D`, `R`, `o`: v2 mirror names are fine where they mirror an expression one to one. A parameter named `PK` is not; use `packetHeight`. |

## WGSL compute expansion: correctness notes

- **Dispatch and bounds.** There is one workgroup per part (`dispatchWorkgroups(partCount)`, far below 65535), with 64 threads and strided loops over `6n + 1` seg slots and `3n − 2` triangles. The writes are `segFirst + slot` and `vertexFirst·4 + …`. Both are below the per-part maxima (73 / 102 for n = 12), and the buffers are sized `capacity × max`. There is no out-of-bounds path today (S6 for later).
- **Races.** Every invocation writes disjoint records and reads only read-only bindings. No shared memory or atomics are needed, and none are used. WebGPU orders the compute → render dependency between passes, and `queue.writeBuffer` precedes the submit.
- **Semantics checked by reading.**
  - The edge normal orientation matches kit `counter`.
  - A run walk from `runStart` keeps each run contiguous in k. The single-run case (all facing) maps to kit `runsOf`'s open `[0…n−1, 0]` path: caps at both ends and no wrap join. `SegWriter` treats it the same way.
  - The strap runs along the rotation x axis at `z0 + h`, and the band is at `z0 + h − 0.45·PK`.
  - Undrawn slots are zero-alpha, off-canvas, single-segment polylines. Non-facing faces become zero-area triangles.
- **Occupancy.** A vane keeps at most 25 of 64 threads busy (25 segs, then 10 triangles); a packet has 73 segs (2 iterations) and then 34 triangles. That is irrelevant at this size.

## CPU/GPU split

The CPU does order, classification and extents, and packs 80 B per part. The GPU only builds geometry. That split is right for exact parity, because tone and visibility decisions stay in f64 with the kit's own formulas. The cost is that the stroke semantics now live twice, in `strokes.ts` and in WGSL, and S4 shows the second copy is under-tested.

For the template, measure one alternative before cloning this 20×: a **CPU direct emitter**. The model would write `Seg`/`FillVertex` through the existing `SegWriter` with no string and no parse. This rotor uploads about 50 KB per frame instead of 1.1 KB, but it reuses `SegWriter` exactly and needs no compute pipeline. `ms.model` is already recorded, so add the emitter's cost next to it.

GPU expansion pays off for high instance counts, for example belts with hundreds of slats. It is not obviously worth it for 25 prisms.

## TypeGPU idiom

The current code is idiomatic for 0.12:
- a typed `bindGroupLayout`;
- `createComputePipeline`;
- typed `arrayOf` buffers;
- word offsets derived with `d.memoryLayoutOf`, which is a good pattern for the per-machine record packers;
- `tgpu.const` for the shared enums.

Options, in order of value:
1. **TGSL (`'use gpu'`) for the polyline/join math.** Its body runs on the CPU and on the GPU. That would single-source `direction`, `joinCrowd`, `pinchCrowd` and `pointSegmentDistance` between `SegWriter` and the expansion. It also makes the expansion unit-testable in node (S4), and it removes the restated epsilons in `rotor-shaders.ts:62-64`; `strokes.ts` keeps them private. The cost: `unplugin-typegpu/esbuild` in `build.mjs` and `test-*.mjs` (SPIKE.md: it exists and is required), plus f64 (JS) vs f32 (GPU) on the CPU path, which is within today's tolerance anyway. Do it with the generic prism painter, not as a retrofit.
2. **`root.createGuardedComputePipeline((part, slot) => { 'use gpu'; … }).dispatchThreads(partCount, 6·12+1)`.** This drops the `WG` constant and the strided loops. It needs TGSL too.
3. **Inside WGSL strings today:** assign whole structs (`segs[index] = Seg(…)`) instead of 13 field stores (`rotor-shaders.ts:200-253`).

## Reuse assessment for the other ~20 machines

Of the 1416 lines in `src/native`, about two-thirds is already machine-agnostic:
- `kit-mirror.ts`, the kit's extrude/ringSeam classification;
- `rotor-schemas.ts` + `rotor-shaders.ts`, "a rigid template ring, rotated, translated, extruded, with optional bevel, band and strap";
- `rotor-painter.ts`, apart from the slot-name and `LARGEST_RING` assumptions;
- `RotorStyles`' mechanism, which is template markup → `SlotGeometryBuilder` → style record and can never drift from the markup path's paint keys;
- the lifecycle half of `native-rotor.ts`: activate/deactivate, owning, bypass + `refreshMarkup`, `PainterHost` attach/detach.

Machine-specific are `rotor-model.ts` (≈ 250 lines mirroring `drawRotor`: depth sort, back/front split, pose → part), the hook contract, the two template strings and the build's injection site.

Suggested split:
- `native/prism/`: `PrismPainter` (N slots, a template registry, exact buffer sizing), the prism schemas and shaders, `TemplateStyles`, `kit-mirror`.
- `native/host/`: `NativeMachineHost<TState>`, a `PainterHost` holding the lifecycle, error containment (S1), per-slot refresh and soft fallback (S3), and painter-at-attach (S2).
- Per machine: `contract.ts` (hook signature + `HOOK_LINE` + the identifier list for S7), `model.ts` (`update(state) → PrismFrame { records, slots[] }`), templates, and one browser-free equivalence test against v2's `LIVE` (S5).

Two caveats:
1. Many machines' hot paths are not prisms: tubes, lathed cylinders, belts, dials, text. The prism painter is the first member of a "kit primitives on GPU" family, not the general answer, and S6's limits (16 points, convex fan) must go before the second member.
2. One native painter per page per kind (`machineGpu` returns `undefined` after the first, `native-rotor.ts:71`) and the single `refreshNative` (S3) both assume one native machine per figure. The assembly page breaks both.

## Out of scope: v2 / kit (report only; nothing touched)

- **`shared/runtime.js:105-122`.** `tick` reschedules rAF as its last statement with no `try/finally`, so any machine exception stops the whole factory for good. Use `try { … } finally { frame = visible ? requestAnimationFrame(tick) : 0; }` and log per-machine errors.
- **`centrifuge.mjs:785-800` `packet()` / `vane()`.** These rebuild `roundedPlan(…)` and closures for every part on every frame. Precompute the plan once. This also benefits the SVG and markup paths.
- **`centrifuge.mjs:802-819` `releasePose`.** Returns fresh arrays and an object on every call (the native path calls it per frame). An out-param variant would make the native model truly allocation-free.
- **A sanctioned extension point.** A native extension point in v2, for example `api.native?.draw("rotor", state)` emitted by the kit per machine, would replace text injection (S7) for all 20 machines.
- **`kit/iso-kit.mjs`.** `signedArea`, `oriented` and `runsOf` are private, so `test-native.mjs:42-66` copies them. Exporting them, or exporting a `classify(ring, P)` the mirror could be tested against directly, would remove the copies.
