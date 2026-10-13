# CQ-M3: code-quality review of the M3 live adapter

**Scope.** Commit `4231c6d`, `v3-gpu/src` and `v3-gpu/tools`:
- new `src/live/{adapter,dom-slots,geometry,slot-renderer}.ts`;
- changes to `src/{main,renderer,shaders,palette}.ts`;
- `tools/{build,live-gate,live-edge,test-live}.mjs`.

`src/` in the working tree equals `4231c6d`. I re-checked the CQ-M2 findings against the current code (table at the end). I made no code edits.

**Rules applied.**
- `code-quality-dictionary.md`: the [U] rules that fit a TS + WebGPU module (TS-2, TS-3, TS-5, TS-7, MR-4), the §R severity rubric and the §N non-goals. React, RN, Expo and [REPO] rules are skipped because this codebase has no equivalent.
- The expressive-code skill.
- TypeGPU 0.12.7 idiom, verified against `node_modules/typegpu` sources and typings.

## Measurement (dictionary §M, adapted)

| Step | Result |
|---|---|
| 1 Size | 2094 added lines in 12 files. That is above the ~1.5k split threshold. Most of it is in `geometry.ts` (523), `live-gate.mjs` (448) and `slot-renderer.ts` (337). |
| 2 Gates | There is no tsconfig, lint or format script. I ran `tsc` ad hoc (`strict`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `skipLibCheck`) on `src/main.ts`. It reports **2 errors**, the same as M2: `renderer.ts:64 device` and `:86 gradIndexOf` (CQ-M2 N1, still open). M3 added no new tsc errors. |
| 4 Type-aware | ESLint is not installed. Manual equivalents found:<br>• 2 floating promises: `main.ts:200` (`start().then(...)` with no catch) and `main.ts:146` (`onSubmittedWorkDone().then` with no rejection path).<br>• `any`: 20 in `renderer.ts`, 3 in `main.ts`, 0 in `src/live/*`.<br>• About 14 non-null `!`s were added: in `main.ts`, `adapter.ts:102,111` and `slot-renderer.ts:171,188,318,327`.<br>• 3 unnecessary casts in `slot-renderer.ts:270,271,282`. A probe compiled against 0.12.7 shows `root.createTexture(...).$usage('render')` is assignable to `MsaaTarget`/`ColorTarget` without `as`. |
| 5 Deprecations | `deprecations.cjs` reports 0. The 20 `any` TypeGPU handles in `renderer.ts` stay invisible to the scan. |
| 6 Grep | No `Math.random`, `Date.now`, TODOs or `catch {}` in added lines. One `queueMicrotask` (`main.ts:177`), one `console.warn` (`adapter.ts:148`), and a global `requestAnimationFrame` monkeypatch in production builds (`main.ts:77-86`). |
| TypeGPU check | Read in the sources:<br>• `TgpuRenderPass` binds groups **by layout** at draw time (`drawState.js` `recordBindGroup`/`applyBindGroups`), so mixing `compositeLayout` and `S.layout` in one pass is safe.<br>• `setVertexBuffer` officially accepts a raw `GPUBuffer`.<br>• `TgpuBuffer.write(ArrayBuffer, { startOffset, endOffset })` and the `buffer.arrayBuffer` host mirror exist. `write(buffer.arrayBuffer, …)` skips the copy (`buffer.js:211`).<br>• `TgpuCommandEncoder` is exported.<br>• `d.memoryLayoutOf` and `d.sizeOf` exist. |

### WebGPU checks that pass

- **Group composite.**
  - It is scissored to the group box, and the pass scissor is restored afterwards.
  - The premultiplied layer × alpha with OVER blending is SVG group opacity.
  - The depth test at the front layer with no depth write is correct.
  - `textureLoad` bounds are guarded.
- **Multiply stroke.** `vec3(1 − a) + rgb·a` with `(dst, zero)` gives `dst·(1 − a + a·src)`. Screen reuses `strokeFrag` with `SCREEN`, which is correct for premultiplied output.
- **Slot buffers.**
  - They are grow-only with power-of-two capacity. The replaced buffer is destroyed.
  - The bind group is rebuilt on replacement and on `resourceVersion`/`identityVersion`.
  - `writeBuffer` sizes are multiples of 4.
- **Destroyed resources.** The `groupParams` and identity buffers, and the layer MSAA, depth and resolve textures, are destroyed when replaced. `LiveSlots.destroy()` covers everything it owns.
- **Depth.** The slot depth is a prefix sum per frame over static items and slot pseudo-items, so there are no rank collisions.
- **`updateOrder`.** It no longer allocates per frame. It rebuilds only on reorder.
- **Shader compilation.** `pipeline.initAsync()` runs before the first frame (CQ-M2 S13 fixed).
- **Encode time.** It now comes from a User Timing measure (CQ-M2 S11 fixed).

## Should-fix (S), ranked

### S1. Fill alpha folded into derived paints: an unbounded paint table, plus a forced DOM probe and a full palette re-upload per new alpha

**Where:** `geometry.ts:344-345`, `adapter.ts:123-136`, `renderer.ts:256-259` (`appendPaints` → `uploadPaints`) and `palette.ts:74-120`.

**What happens:**
- The fill alpha is quantized to 1/1024 and made part of the paint key.
- Each new alpha does three things:
  - It calls `resolver.resolve([desc])`, which appends a probe `<svg>` to the stage, calls `getComputedStyle` (a forced style recalc in the middle of the frame, inside the microtask) and removes the probe.
  - It re-packs and re-uploads **all** paints, gradients and stops (`uploadPaints` is O(P)).
  - It can reallocate the paint buffer, which bumps `resourceVersion` and rebuilds every slot bind group.
- An `opacity` animation on a single-drawable group or element creates up to 1024 paints per chain. Each one is a DOM probe, and the class map never evicts.
- The centrifuge escapes this only because its one fade, `centrifuge.mjs:922`, is a multi-drawable packet that takes the layer path. The factory port will meet single-drawable fades.
- Warm-up hits the same path 46–56 times, one probe and one full upload per discovered key.

**Fix:**
- Carry fill alpha per vertex. Pack a u16 alpha into the high half of `FillVertex.ids.y` next to `layer`, asserting `layer < 2^16`, or use a per-prim alpha storage array. The colour paint is then keyed by chain only.
- Batch discovery: assign provisional ids during `collect`, then resolve all new keys once per `flush` (one probe tree, one style recalc), then call `appendPaints` once.
- For RN, and for a cold start with no probes at all, precompute the live palette offline. `live-gate record` already captures slot markup. Run the key derivation in Node, ship `{key → probe desc}` with the display list, and resolve it together with the static palette. This needs the shared key function from S5.

### S2. Error handling on the live path: exceptions escape in microtasks, and the fallback after a lost device does not animate

**Where:** `main.ts:107-133`, `:177`, `:194-202`; `adapter.ts:106-121`, `:138-152`; `geometry.ts:281-293` vs `:328`.

**What happens:**
- `onChange → queueMicrotask(draw)` has no try/catch.
  - In dev (`policy: 'throw'`), a builder error thrown in `flush` is an uncaught microtask exception. `api.error` stays null.
  - `takeDirty()` has already cleared the other changed slots, so their updates are lost until they change again.
  - `validate()` (the dev setter check) does not reject halos, which only `collect()` rejects (`:328`). Halo markup therefore reaches this path instead of throwing at the write as the plan promises.
- In prod, any `renderer.render()` throw (for example a TypeGPU `MissingBindGroupsError`) repeats every frame with no circuit breaker.
- `start().then(() => request())` (`:200`) has no catch, and reinit has no cap (CQ-M2 S8, still open).
- **Functional bug:** if the device is lost after `reveal()` and `tgpu.init` then fails, `showFallback` puts back `preview`. Because `reveal()` already called `live.source.stopForwarding()`, the fallback SVG shows the boot-time slot markup frozen, and the moving parts stop.

**Fix:**
- Wrap the microtask frame: `try { draw() } catch (e) { reportError(e) }`, where `reportError` sets `api.error`, pushes to `api.errors[]` and, after N consecutive failures, calls `fallback()`.
- In `flush`, build into a temporary list and keep the dirty flags of slots that were not built, or call `markDirty(index)` on failure.
- Make `validate()` share `collect()`'s checks. Simplest: `validate = (m) => this.collect(m)` with a throw-only palette stub.
- `showFallback` must call `live?.source.forwardTo(preview)` (it re-sends the current markup), or own the fallback in a host object that knows the slot source.
- `.catch(reportError)` on `start()`.
- Push `uncapturederror` into `api.errors`.

### S3. The microtask schedule is tied to native rAF callback boundaries, and the gates cannot see it

**Where:** `main.ts:77-87`, `:168-177`, `dom-slots.ts:41-47`, `:71-75`, `live-gate.mjs:104-114`, `tools/lockstep.js:26-40`.

**What happens:**
- In a real browser, a microtask checkpoint runs after **each** rAF callback. Today this is correct only because `runtime.js` ticks every machine in one callback (`runtime.js:104-123`).
- These cases each render an extra full GPU frame:
  - a second runtime callback per frame;
  - the host's own `request()` callback registered before the runtime's (on theme and resize frames);
  - a `ResizeObserver` redraw after the tick (`main.ts:230-231`).
- Any slot write **outside** rAF renders immediately in that task. Input handlers, timers, the factory's explode slider, and an `accept()` that redraws all count, so a 240 Hz pointer gives 240 GPU frames per second.
- Both lockstep harnesses run all callbacks inside one task. Production's per-callback checkpoints are therefore never exercised, and a torn or double frame cannot show up in `live-gate`.
- `DomSlotSource.pending` latches until the consumer calls `takeDirty()`. When `renderer` is null (boot, or a device-loss reinit), the microtask is a no-op, `pending` stays true, and later writes never notify. Recovery depends on `probe()` calling `request()` as a side effect.

**Fix:**
- Let the rAF wrapper own the frame scope:
  - set `inRuntimeFrame = true` around the callback;
  - in `finally`, if slots are dirty, flush once (synchronously, after the last wrapped callback of the frame, tracked by a pending-callback counter);
  - writes outside a frame call `request()`, which coalesces to the next vsync, instead of a microtask.
- `DomSlotSource` should only record dirtiness and expose `hasDirty`. The host owns the scheduling, so no latch is needed.
- Add a gate case with real rAF (`REAL_LOCKSTEP=1`) and two runtime callbacks per frame. Assert `__gpu.frames` == runtime ticks.

### S4. The group-opacity layer costs scale with the largest group ever seen, and the targets never shrink

**Where:** `slot-renderer.ts:166-197` and `:262-287`.

**What happens:**
- Every active group opens its own render pass. Each pass clears the **whole** `layerSize` 4× MSAA colour and depth targets and resolves the **whole** target: the scissor does not limit `loadOp: 'clear'` or the MSAA resolve.
- `layerSize` only grows, in steps of 64 px, up to the canvas size. After one large fade, every later small packet fade pays full-size clear and resolve. On a 2560×1600 canvas that is ≈ 65 MB of MSAA colour + 65 MB of depth, retained for good.
- Each layer also owns a full-size resolve texture, a `Frame` uniform buffer and a cached bind group. The bind group key embeds the slot index and capacity (`:325`, with an O(n) `indexOf`), so it is rebuilt whenever the group-to-target assignment changes between frames.

**Fix:**
- Pack this frame's group boxes into **one** atlas: a single MSAA + depth target sized to the packed boxes (shelf packing), a single render pass with one `setViewport`/`setScissorRect` per group, one resolve and one composite bind group.
- Give `GroupParams` an `atlasOrigin` per group. The per-group `Frame` translation moves to `setImmediates` (TypeGPU 0.12.7 has it) or to a small per-group uniform array with dynamic offsets.
- Shrink or free the atlas after K frames without groups, and on `resize`.
- The FINDINGS-M3 cost row "encode 0.5 → 0.6 ms" was measured with 40×40 packets only.

### S5. `src/live/geometry.ts` re-implements the M1 exporter's rules instead of sharing them (one source of truth broken)

**Where:** `geometry.ts:12-23`, `:213-262`, `:281-358`, `:464-482` vs `export/build-dl.mjs:10-21`, `:76-96`, `:146-226`, `export/svgsub.mjs:80-104`, `:176-226` and `export/tess.mjs:6-17`.

The rules are copied, and some of the copies already differ:

| Live (`geometry.ts`) | Exporter | Status |
|---|---|---|
| `KEY_DROP` (`:23`) | `build-dl.mjs:10` (same set via `OPACITY_ATTRS`) | identical |
| `probeNodeOf` | `probeNode` | identical |
| `ringOfCircle` + `CIRCLE_STEPS` | same | identical |
| `polylinesOf` | `build-dl.mjs:80`, **already exported** | identical |
| `samePoint` / `EPS` | `tess.mjs`, exported | identical |
| `opacityOf` | `svgsub` `opacityAttr` | identical |
| `countDrawables` | `drawnLeafCount` | **diverges:** `defs` handling |
| `strokeWidthOverride` (`parseFloat`, so `"1em"` → 1) | `svgsub` `numberOf(…, { px: true })`, strict | **diverges** |
| Palette key: string `prop\|alpha\|tag attr=…` | `JSON.stringify([prop, ancestors, el])` | **diverges:** a live paint never dedupes with an equal static one, and an exported palette cannot answer live lookups (blocks S1's offline table and an RN host) |
| Seg flag emission `pushPolylines` (`:464` comment: "Same segment flags as Renderer.buildGeometry") | `renderer.ts:306-319` | non-local duplicate (expressive-code anti-pattern) |
| The walk `collect`/`validate` | `svgsub.drawables` | re-implemented; the only addition is layer-group ids |

- `build-dl.mjs:2` even says "the live adapter will reuse primitivesOf".
- `geometry.ts:10` imports SEG flags from `shaders.ts`. That drags `typegpu`, every shader definition and the global `warn.disable` into the CPU module and the Node test bundle.

**Fix:**
- Export `probeNode`, `KEY_DROP`, `ringOfCircle`, `opacityAttr`, `styleOf`/`strokeWidthOf` and a single `paintKeyOf(prop, chain, el)` (fast string form) from `export/`.
- Extend `svgsub.drawables` to report `{ opacityGroup, groupAlpha }`, then feed both `primitivesOf` and the live builder from it.
- Move `kitPathData` into `svgsub.parsePathData` as its fast path (FINDINGS-M3 #5), and the convex fan into `tess.triangulate`.
- Extract `emitPolylineSegs(points, closed, cap, sink)`, used by `renderer.buildGeometry` and the live builder.
- Move `SEG_*` and record offsets to a dependency-free `src/gpu-format.ts`.

### S6. TypeGPU idiom: a third hand-packed copy of the record layouts, raw `device.queue.writeBuffer`, and hand-sized structs (CQ-M2 S3 is now worse)

**Where:** `geometry.ts:12-15`, `:444-462`, `:484-500`; `slot-renderer.ts:32-33`, `:125`, `:143`, `:175-181`, `:191`, `:197`, `:215`, `:311`; `renderer.ts:134-139`, `:246-248`, `:447`; `test-live.mjs:17-23`.

**What happens:**
- The `Seg` and `FillVertex` word offsets (`o+5…o+11`, `o+2/o+3`) are now written in `renderer.buildGeometry`, `geometry.pushSeg/pushFill` **and** read back in `test-live.mjs` (`v0 = segCount*12`, `o+4`, `o+8`).
- Several sizes are literals:
  - `SEG_BYTES = 48` and `VERTEX_BYTES = 16` are separate from the `assertSize(..., 48)` literal;
  - `SEG_BYTES / 16` appears three times;
  - `GROUP_PARAMS_BYTES = 16` and `FRAME_BYTES = 32` are hand-sized;
  - the `Frame` words are written positionally (`:175`);
  - the `GroupParams` fields are written through `DataView` offsets 0/4/8/12.
- Five raw `device.queue.writeBuffer` calls. FINDINGS-M3 #6 says partial writes need them, which is inaccurate:
  - `TgpuBuffer.write(data: ArrayBuffer, { startOffset, endOffset })` does partial writes.
  - `buffer.arrayBuffer` is the host mirror. Packing straight into it and calling `buffer.write(buffer.arrayBuffer, { endOffset: byteLength })` skips TypeGPU's copy (`core/buffer/buffer.js:211`) and makes the per-slot `SlotGeometry.bytes` ArrayBuffer unnecessary.
- Using one buffer as both `array<Seg>` storage and the `FillVertex` vertex stream is a legitimate escape (`setVertexBuffer` types `| GPUBuffer`). It relies on an unasserted invariant, `sizeOf(Seg) % sizeOf(FillVertex) === 0`. Passing a byte offset to `setVertexBuffer(layout, buf, segBytes)` would remove the `segCount * 3 + first` arithmetic.
- `encodeLayers(encoder: ReturnType<…>)` (`:161`): use `TgpuCommandEncoder`.

**Fix:**
- `const SEG = { bytes: d.sizeOf(S.Seg), width: d.memoryLayoutOf(S.Seg, s => s.width).offset / 4, … }`, computed once in `gpu-format.ts`. Use it in all three packers and in the test.
- Derive `FRAME_BYTES` and `GROUP_PARAMS_BYTES` from `d.sizeOf`, and write `GroupParams` with `common.writeSoA(groupParams, { origin: Int32Array, depth, alpha }, { endOffset })`.
- Replace the raw writes with `buffer.write(...)`.
- Assert the stride divisibility once.
- Correct FINDINGS-M3 #6 and FINDINGS-M2 #3.

### S7. `Renderer` encapsulation regressed, and `LiveSlots` ↔ `Renderer` are coupled both ways

**Where:** `renderer.ts:65-121` (the M3 diff turned 17 private fields public and mutable: `root`, `scene`, `format`, `paints`, `itemBuffer`/`paintBuffer`/`gradBuffer`/`stopBuffer`/`frameBuffer` typed `any`, `pipes: Record<string, any>`, `width`/`height`/`dpr`, `itemBases`, `total`); `slot-renderer.ts:127`, `:135`, `:165-180`, `:209-214`, `:243-250`, `:333-336`.

**What happens:**
- `LiveSlots` writes `renderer.slotLayers[index]`. It reads about 15 renderer internals, including the `any` buffers, which it feeds into a typed `createBindGroup` (the `any` defeats the entry check).
- `Renderer` imports the `LiveSlots` type and calls `live.encodeLayers`, `drawOpaque` and `drawSlot`.
- Classification logic `opaque = blend normal && a ≥ 0.999` now exists 3 times: `renderer.ts:190`, `:288` and `adapter.ts:26,155`.

**Fix:**
- Pass a per-frame `FrameState` value (`viewTransform`, `share`, `depthDenominator`, `itemBases`, `width`, `height`, `dpr`) into `LiveSlots.encodeLayers`/`drawSlot`.
- Give `LiveSlots` a `SharedBindings` provider (typed buffers + version) instead of renderer fields.
- Have the renderer ask `live.layersOf(i)` rather than receive writes.
- Type `pipes` as the object literal returned by `createPipelines()` (CQ-M2 S2).
- Use one `classifyPaint()` in `paint.ts`.

### S8. Host boundary for a react-native-webgpu port: half done

**Done well:** `SlotSource` and `PaintResolver` are clean seams, and `DomSlotSource` is the only DOM code on the slot path.

**Still missing:**
- **`LiveAdapter` mutates `scene.paints`** (`adapter.ts:129-131`) and relies on `scene.paints[i]` ≡ `renderer.paints[i]`. That is hidden shared mutable state between the loader data, the adapter and the renderer. **Fix:** a `PaintTable` owner (descs + resolved + classes + `append()`), used by both.
- **Types in the wrong module.** `geometry.ts:8` and `adapter.ts:3` import `BlendMode`/`ResolvedPaint` from DOM `palette.ts` (CQ-M2 S9). **Fix:** move them to `paint.ts`.
- **Browser timing globals in the "platform-neutral" adapter.** `adapter.ts:111-117` uses `performance.mark`/`measure` (four `PerformanceMeasure` objects per frame), and `console.warn`. `main.ts:77-86` monkeypatches `window.requestAnimationFrame` in **prod** builds for a stat. **Fix:** inject a `Profiler` (no-op in prod), and measure `live-js` through `FACTORY.onFrame` plus an end hook, or only in bench builds.
- **Leaky interface data.** `SlotSource.markup: string[]` and `names` are public mutable arrays, and `takeDirty(): number[]` allocates per frame. **Fix:** use `forEachDirty(cb)` or a reused index buffer.
- **Missing lifecycle pieces** (open from CQ-M2 S9):
  - no `present()` hook after submit;
  - no teardown: observers and `renderer.destroy()` are never called;
  - `Renderer` still takes an `HTMLCanvasElement` and calls `navigator.gpu`.
- **`main.ts` keeps growing.** It went from 145 to 285 lines and mixes the lifecycle with the DOM preview and fallback. **Fix:** split it into `gpu-view.ts` plus `host-web.ts` (CQ-M2 S9).

### S9. Parse-path allocations: parsing is the largest CPU item (4.0 ms median at 4× throttle), and most of it is regenerated identical data

**Where:** `geometry.ts:295-358`, `:373-442`.

Per changed slot, every frame:
- a full `parseSvg` tree, `[...chain, child]` and `[...probeChain, probe]` arrays per group;
- `probeNodeOf` objects and `keyOf` strings for **every** element, even when the paint key is cached;
- `prefixKey` recomputed (`:309`; it is constant, so compute it in the constructor);
- `chainOf` closures and `Prim` objects;
- `number[][]` points from the parser, `points.filter` copies and `ringOfCircle` arrays for stroked circles;
- new `groups`/`draws` arrays, a `new Uint32Array(bytes)` view and a new `SlotGeometry`.

**Caching and pooling strategy, in payoff order:**
1. **Per-element memo.** Split the slot string at top-level element boundaries with a cheap scanner, and memoize `elementMarkup → {packed segs/verts template, paint ids, layer count}`. Re-pack by `memcpy` plus a layer/item patch. Packets, vanes and slats repeat while they rest. This is FINDINGS-M3 #4's "per-element-markup cache"; the mesh cache already shows hit rates.
2. **Key from raw text.** Key the paint lookup by the raw start-tag attribute substring plus the parent chain key, and build probe nodes only on a miss.
3. **Pooled scratch.** Use a pooled `Prim[]` with `length = 0` reuse and a `Float64Array` scratch for subpath points instead of `number[][]`.
4. **Unit circle.** Cache one unit circle and scale it.
5. **Structural fix for the factory port.** Offer the runtime a structured slot API (records instead of markup) so parsing disappears. See the out-of-scope section.

### S10. The live gates do not gate, and the test tooling is not hermetic

**`live-gate.mjs compare`** (`:291-328`) and **`live-edge.mjs`**:
- They always exit 0 and print or record JSON. PLAN-M3's acceptance (≤ 0.5 % pixelmatch, equal readouts, no `problems`) is never checked. CQ-M1 and CQ-M2 had already moved `gate.mjs` to absolute caps.
- `live-edge` relies on `sleep(1500)` timing (flaky) and cwd-relative `out/...` paths.

**`test-live.mjs`:**
- Not `node:test`.
- Its input is a browser-generated artifact (`out/gpu/live-gate/slot-markup.json`), so `node tools/test-live.mjs` fails on a clean checkout.
- It reads packed offsets by hand.
- It uses a fake palette that marks everything opaque and visible. Groups, translucent fills, invisible paints, draw-list merging, group bounds and cap flags are therefore untested.
- It mixes a benchmark into the correctness run.

**Lockstep and harness duplication:**
- `TURBO_LOCKSTEP` (`live-gate.mjs:89-133`) is a second implementation of the `tools/lockstep.js` contract with different semantics: rAF ids are not unique, `cancelAnimationFrame` is a no-op, and there is no `step`.
- `crop`/`zoom`/diff duplicate `tools/diff.mjs`. `sleep` and the arg parser duplicate `perf.mjs`.
- There are no `package.json` scripts for build, live-gate or test-live.

**Fix:**
- Add `--max-pct` and `--fail-on-problems` to `compare`/`edge` with a non-zero exit, and replace `sleep` with `waitFor` predicates.
- Check in a small live-markup fixture under `src/fixture/`, and make `test-live` a `node:test` suite with:
  - offsets from `gpu-format.ts`;
  - a palette stub covering translucent, invisible and blend paints;
  - cases for groups, merging, caps and bounds;
  - a `kitPathData` ≡ `parsePathData` fuzz test (L after Z, exponents, `+`, commas).
- Fold the turbo mode and the rebase into `tools/lockstep.js` (FINDINGS-M3 #1–2) with a `mode` option.
- Share an image-utils module.

### S11. `build.mjs`: the drift check is weaker than its comment claims, and `--dev` silently turns the prod pages into dev builds

**Where:** `build.mjs:86-127`.

**What happens:**
- `assertVerbatimScript` checks `includes()` for the runtime head, the runtime tail and `LIVE`. The kit, lathe, `STUB_LIVE`, boot, injected data and ordering go unverified, yet the comment promises "kit + lathe + runtime.js + LIVE + STUB_LIVE + boot".
- The check `import()`s `../v2-factory/parts/centrifuge/centrifuge.mjs`, which executes v2 code during the build.
- It re-implements `scriptSafe` (`:94`).
- `:124-125` builds `live.html`/`live-light.html` from `js`, which **is** the dev bundle under `--dev`. Prod builds also always build the 6.4 MB dev bundle.
- The skeleton regex (`:110`) only matches the exact form `<g data-slot="…"></g>`, and nothing asserts the count equals `dl.slots.length`. Drift therefore surfaces only at runtime (`installLive` throws).

**Fix:**
- Regenerate the expected script with v2 `page()` exactly as `export.mjs` does and assert equality. Alternatively, have `export.mjs` record a sha256 of the module script in the DL JSON and compare hashes.
- Always build prod and dev separately, and use the prod one for `live(-light)`.
- Assert the slot count.
- Use `scriptSafe`.

### S12. `rebuildDrawList` is O(items × slots) with allocations, and it runs every frame during an explode drag

**Where:** `renderer.ts:455-456`, `:418-430`.

**What happens:** `slotsAt(anchor, side)` runs `map`/`filter`/`sort` over every slot for every item, twice. `setShare` changes `share` on every slider input, and every share change re-sorts the items (`orderOf`) and rebuilds the draw list. That is fine for 16 slots, but quadratic for the factory.

**Fix:** precompute `slotsByAnchor: Map<anchor, { before: number[]; after: number[] }>` in the constructor, and keep a reusable `frameOrder` buffer.

## Nits (N)

1. **Per-frame allocations in the GPU path.** FINDINGS-M3 says the path is "allocation-free except while groups active". It is not.
   - `bindGroupOf` builds template-string keys twice per slot per frame (`slot-renderer.ts:316`). Compare two numbers instead.
   - `viewTransform()` returns a new array three times per frame (`renderer.ts:544`, `slot-renderer.ts:166`, `:233`).
   - `frameBuffer.write({ d.vec4f, d.vec2f })` and the halo `params.write` run per frame (`renderer.ts:545`, `:554`).
   - Groups add `words.set([...])`, `new DataView`, `Math.max(...map)` and `forEach` closures.
   - Four `PerformanceMeasure` entries per frame.
   - `setBindGroup` before every static draw (`renderer.ts:577-586`, CQ-M2 S14 remainder). Bind once per pass; TypeGPU keeps it across `setPipeline`.
2. **Magic numbers and constant duplication.**
   - Capacity floors `4096` (`slot-renderer.ts:120`) and `1024` (`geometry.ts:437`).
   - `SEG_BYTES / 16` (×3).
   - `r.total + 2` and the depth formula, two more TS copies (`slot-renderer.ts:175`, `:180`; CQ-M2 N3).
   - `0.999` (×3).
   - `1e-6` (`geometry.ts:129`).
   - Timing names duplicated between `main.ts:19-20` and the `adapter.ts`/`renderer.ts` mark sites. Export one `TIMING` const.
3. **Naming.**
   - Class `LiveSlots` lives in `slot-renderer.ts`. Rename the class to `SlotRenderer` or the file to match.
   - `Samples` → `RollingTimings`.
   - `Words` → `WordBuffer`.
   - `KEY_DROP` → `PROBE_KEY_IGNORED_ATTRS`.
   - `encodeLayers` uses `g` (ActiveGroup) and `group` (LayerGroup) side by side, and `r` for the renderer.
   - `pipes` vs `pipelines()`.
   - `Frame.total`/`r.total` hold different things (CQ-M2 N3).
4. **Comments** (expressive-code).
   - `main.ts:213-218` holds two overlapping paragraphs for one function. The first ("trust it only when it agrees") no longer describes the code, which now scales the CSS-px value. Keep one.
   - `geometry.ts:464` "Same … as Renderer.buildGeometry" is a non-local reference. Remove it with S5.
   - `adapter.ts:1` claims "Platform-neutral" while it uses User Timing and console.
5. **Unbounded warning set.** `adapter.ts:145-149` dedupes warnings by message, but messages embed values (`bad inline stroke-width:…`). The `warned` set is unbounded and can spam. Key by `(slot, error kind)`.
6. **Over-broad theme trigger.** `main.ts:253` re-probes the whole palette and rebuilds every slot on **any** `body` `class` change. Watch `data-theme` only, or compare the resolved background or token first.
7. **Interception covers only `innerHTML`.** `dom-slots.ts:54` does not catch `replaceChildren`, `append`, `insertAdjacentHTML` or `textContent` writes from a future machine; they would bypass it silently and freeze the slot. In dev, add a `MutationObserver` on the skeleton that throws on any child.
8. **No bounds assertions on packed ids.** `geometry.ts:490` packs `item | paint << 16` with no `item < 2^16 && paint < 2^16` assertion. Live paints grow at runtime (CQ-M2 S3 sub-point, now on a growing table).
9. **Tool nits.**
   - `browser.close()` is never awaited.
   - Tab closing is inconsistent: `close()` vs `cdp.close()` in `timeline`/`baseline`/`cost`, which FINDINGS-M3 #8 says starves later pages.
   - `compare` without `--ticks` waits 120 s on `NaN`.
   - `test-live.mjs:35` uses an unexplained layer formula.
10. **`build.mjs` duplication.**
    - `harness`/`liveHarness` duplicate the figure extraction, including CQ-M2 N11's exact attribute order and a null destructure, now twice.
    - The existence condition and the `data` scripts are built twice (`:79`, `:122`).
    - The static harness uses the first `</body>`, the live one the last.

## CQ-M2 status in the current code

| CQ-M2 | Status | Note |
|---|---|---|
| S1 halo leaks | **open** | `renderer.ts:378`, `:395`, `:614-619` unchanged |
| S2 `any` handles | **open, worse** | 20 `any`s. Five `any` buffers and `pipes` are now public and consumed by typed `LiveSlots` (S7). `LiveSlots` itself is typed properly. |
| S3 hand packing / writeSoA | **open, worse** | A third packer and a test that reads offsets (S6). FINDINGS-M2 #3 not corrected. |
| S4 TS/WGSL flag constants | **open, worse** | `strokeShade` literals `1u 2u 4u 8u 16u 32u 60u` (`shaders.ts:215-255`). A third TS emitter, and `geometry.ts` imports them from `shaders.ts`. |
| S5 dl-loader duplicates dl-format | **open** | `dl-loader.ts` unchanged |
| S6 two palette probes | **open, worse** | `resolvePaints` now runs at runtime per discovered paint, mid-frame (S1). `leafOf` wrapper still there (`palette.ts:82-85`). |
| S7 readiness wait spin | **fixed** | `start()` returns `boolean` (`main.ts:275`) |
| S8 reinit and GPU errors invisible | **open, extended** | `main.ts:200` and `:202`, plus the new microtask path (S2) |
| S9 DOM coupling / host split | **partially addressed** | Slot and palette seams added; the renderer, lifecycle and paint types are not (S8) |
| S10 `Renderer` responsibilities | **open, worse** | Slot splicing, `appendPaints`, `resourceVersion` and live hooks added. `classify` now has 3 copies. |
| S11 encode stats under lockstep | **fixed** | User Timing duration (`renderer.ts:606`) |
| S12 `lockstep.step` hangs on on-demand pages | **open** | `tools/lockstep.js` unchanged. The live gate sidesteps it with `TURBO_LOCKSTEP` (S10). |
| S13 `initAsync` | **fixed** | `compilePipelines()` |
| S14 per-frame allocations | **partially fixed** | `updateOrder` is allocation-free. Uniform object writes, `setBindGroup` per draw and no render bundle remain (N1). |
| N1 dead code | **open** | tsc still flags `device` and `gradIndexOf`. `build.mjs:66-70` variant filter and one-element loop. `--no-dl` undocumented. |
| N2 magic numbers | **open, worse** | N2 above |
| N3 depth formula duplicated | **open, worse** | Two more TS copies |
| N4 module-scope `warn.disable` | **open, worse** | Now also pulled into CPU and Node bundles through `geometry.ts` |
| N5 full-screen triangles | **open for halo** | The group composite is scissored; apply the same to the halo |
| N6 casts in `main.ts` | **open** | `adapterInfo` `any`, `(e: any)`, `window as any`, `Awaited<…>`, `!`s; `dpr = width / cssW` is `Infinity` at 0 CSS width (`:226`) |
| N7 API shape | **open** | `renderer.share` field (`main.ts:153`), `prev.some` array per element (`:249`), `haloTex`/`pipes` names |
| N8 calibration-history comments | **open** | `shaders.ts:239-247` |
| N9 behaviour gaps | **open, inherited by live** | Per-polyline ownership, square cap → round. Live strokes are also always round-joined (known gap). |
| N10 FINDINGS corrections | **open** | M2 #3 still wrong. M2 #7 was superseded by `initAsync` but the text was not updated. M3 #6 is also inaccurate (S6). |
| N11 tools | **open, duplicated** | `diff.mjs` unchanged. The `build.mjs` attribute-order match and null destructure now exist twice. |

## Out of scope / follow-ups (not introduced by M3)

- **v2 runtime and kit** (read-only here):
  - `runtime.js` binds to `stage.querySelector("svg")`, and machines use `api.el`/`api.els` on that svg. On GPU pages the skeleton holds slots only, so `el`/`els` silently return null. A factory machine that queries its figure will break without an error. Expose `el`/`els` against the `<template>` SVG, or make them throw on GPU pages.
  - The slot protocol is "rebuild a markup string every frame":
    - The runtime builds ~40 KB of markup per frame; this is `live-js`, 3.2 ms at 4×.
    - The adapter then re-parses it.
    - For the factory port, propose a structured slot channel next to `innerHTML`. Machines would emit keyed primitive records. That removes both costs and makes an RN host trivial.
  - `centrifuge.mjs:922`/`:983`: the fade path (`fade: !from`) is unreachable on the centrifuge page because the stub feeder always passes `from` (FINDINGS-M1 #6, M3 #3).
  - The kit's inline module script contains the literal text `</body>` (FINDINGS-M3 #7). Escape it in the kit.
- **M1 export code:** `svgsub` `opacityAttr` does not clamp to [0, 1], unlike SVG. This affects the DL and live paths equally.
- **`tools/lockstep.js`** (pre-existing):
  - non-deterministic across pages: the `dt` rounding depends on the absolute frame number (FINDINGS-M3 #1);
  - `step()` hangs on idle pages (CQ-M2 S12);
  - the `cancelled` set grows.
- **Fixture inputs:** `src/fixture/make-*.mjs` still import the unpinned skill kit and `../v2-factory` CSS (CQ-M2 follow-up).
