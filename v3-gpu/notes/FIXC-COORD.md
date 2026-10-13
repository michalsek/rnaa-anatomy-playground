# Fix loop C: coordination between C1 (core / web robustness) and C2 (native path)

Append-only. Each entry: who, what file, the exact change, status.

## C2 → C1 requests

### R1 (needed for CQ-M5 S3 soft fallback) — `src/live/slot-renderer.ts`: `LiveSlots.acquire`
`SlotPainter` (src/core/slots.ts, C2) gains an optional `acquire?(slots)`: the renderer calls it on the new owner in
`setSlotPainter` (symmetric with `release`). A native machine that fails hands its slots back to the markup painter
with `renderer.setSlotPainter(liveSlots, slots)`; `DomSlotSource.disownNatively` then marks them dirty, so the adapter
parses and uploads them again — but only if `LiveSlots.owns(slot)` is true again. Please add to `LiveSlots`:

```ts
  /** The renderer gave `slots` back (a native machine fell back): they are uploaded and drawn again. */
  acquire(slots: readonly number[]) {
    for (const slot of slots) {
      const i = this.index.get(slot);
      if (i !== undefined) this.released[i] = 0;
    }
    this.version++;
  }
```

Status: requested (C2 applies it itself if the file is still untouched by C1 when C2 needs it, and notes that here).

### R2 — `tools/gates.mjs`: native self-test rows (CQ-M5 S4, QA-M5 D2)
C2 adds a `native:fault` row (error containment, quick + full) and `selftest:native:identity` (`identity --quick
--mutate patch`, full) and exports them as `NATIVE_ROWS` from a separated block at the end of `tools/gates.config.mjs`
(the contract gate checks its own mutations in-run, no extra row). Please spread them into `ROWS` (after the
`native:sheet` row):

```js
import { NATIVE_ROWS } from "./gates.config.mjs";
…
  ...NATIVE_ROWS.map((row) => ({ ...row, command: node(...row.args) })),
```

Status: requested.

### R3 — `notes/GATES.md`, `notes/GPU-API.md` text
C2 will append the exact text blocks here when the native changes are final (new rows, `frameStats().native.machines`,
`?nativeFault` on the dev page, gates:full duration).

### R4 (info) — `src/core/strokes.ts` crowd semantics are mirrored in WGSL
The native rotor's compute pass restates `SegWriter.joinPolyline` (joins, hairpin / sharp-turn crowd, pinch points)
and, since C1's D4 change, the ownership-window pair rule (`segmentDistance`, `CHAIN_TOLERANCE` 1e-6,
`OWNERSHIP_WINDOW`) in `src/native/rotor-shaders.ts`. `native:contract` now runs `SegWriter` on the read-back
polylines and compares joins / crowd / flags, so a later change to `joinPolyline` that is not mirrored fails that row.
If C1 changes `joinPolyline` again, please note it here (C2 mirrors it). Request: export `CHAIN_TOLERANCE` from
strokes.ts (C2 then imports it instead of restating 1e-6).

### R5 (info) — `src/core/renderer.ts` ownership region
C2 moved slot ownership into `SlotOwners` (src/core/slots.ts); the renderer delegates (`this.owners`). C2 also
replaced the per-frame `activePainters.reduce(…)` for the region version with a plain loop (C1's "region version"
allocation nit is done there).

## C1 → C2 (status of C2's requests, and requests)

### R1 — done (C1): `LiveSlots.acquire(slots)` in `src/live/slot-renderer.ts` (as requested). Also (CQ-M5 N9)
`LiveSlots.release` now destroys the released slots' buffers and drops their bind groups; `acquire` re-enables upload,
the adapter re-uploads on the next dirty mark.

### R2 — done (C1): `tools/gates.mjs` spreads `NATIVE_ROWS` (after `native:sheet`), mapping `args` → `command`.

### R4 — done (C1): `CHAIN_TOLERANCE` is exported from `src/core/strokes.ts`.

### C1-1 (request) — native painters and failed frames (QA-FIXA D2 follow-up)
`Renderer.render` now invalidates offscreen state when a frame throws (encode or submit) and on WebGPU validation
errors (`Renderer.invalidate(reason)`, public). A slot painter whose `prepare` encodes work into the frame's encoder
(the rotor's compute expansion) has the same hazard: if that frame's submit throws, its records were never expanded,
but the painter believes they were and skips the dispatch until the model changes (reduced motion: possibly for good).
Proposal: `SlotPainter.invalidate?(): void` in `src/core/slots.ts` ("work encoded in the last frame may not have run:
redo it next frame"), called from `Renderer.invalidate` for every known painter. C1 leaves the loop to C2 (painter
iteration is C2's region): add `for (const painter of this.owners.painters) painter.invalidate?.();` at the end of
`Renderer.invalidate` together with the interface method.

### C1-2 (info) — renderer.ts changes in C1's regions
`render()` → `boolean` (false: no size / no paints), body moved to `encodeFrame()`; `paintsChanged()` removed (the
renderer compares `PaintTable.appearanceVersion` / `geometryVersion` itself); the static geometry's buffers live in one
`StaticResources` (`this.statics`); `FrameContext.translate` is a tuple updated in place (do not keep it across
frames); new `RendererOptions.cacheFault` (test hook) and `stats.offGridFrames`. `HaloEffect.prepare` takes the offsets
array. `SharedBindings.writeFrame(values, target, originX, originY)` (was an `[x, y]` origin tuple).

### R3 (text) — C2's blocks for `notes/GATES.md` and `notes/GPU-API.md`
Please paste (or let C2 paste once C1 is done with these two files — say so here).

**GATES.md — rows table** (replace the `native:contract` row, add the two new rows after `native:sheet`; `unit` cell: add
the C2 sentence):

- `unit` (append): **fix C2** `test-native`: kit mirror ≡ kit for 4- to 64-point rings (incl. exact edge-on angles);
  `hypot2` ≡ `Math.hypot` bit for bit (2·10⁶ inputs); v2's whole page script (kit + runtime + centrifuge LIVE + stubs)
  run in Node with the hook injected as the build does: `RotorModel` ≡ v2's rotor strings at every one of 3000 ticks,
  all six packet kinds, and four mutated literals (20.4, 0.45, 0.6, 0.1) are caught; build injection rejects a renamed
  v2 variable; native host with fakes (two machines per page, per-machine failure → markup path, painters at attach,
  late definitions, symmetric slot ownership).
- `native:contract` | `native-gate.mjs contract` (dev page) | at every LIVE tick (quick: 5), with packets of every kind
  injected (`NATIVE_INJECT`: audio / garbage at 60, fluff + an unknown kind at 400, another unknown + audio at 1300),
  the GPU-expanded records equal the markup path's: polyline count, order, paint, **width, alpha, item, caps at both
  ends**, layer order, every point; fill area per paint; the hull covered; **joins, crowd and flags equal what
  `SegWriter` writes for the read-back polylines**. In-run self-test: six mutations of the read-back records (crowd,
  join, width, tone, item, caps) must each be rejected at every tick. The browser's `Math.hypot` ≡ `hypot2` (10⁶
  inputs) | points ≤ 0.08 (measured 0.0675); area ≤ 0.08 × boundary (≤ 23 %); joins ± 1e-3, crowd ± 1e-3 below 10
  viewBox units (`NATIVE_STROKES`: f32 recomputation tilts joins by ≤ 2.5e-5) |
- `native:fault` | `native-gate.mjs fault` (quick + full) | error containment: a packet kind the native rotor refuses
  (`"bad kind"`) reaches the rotor between 300 and 600: the machine fails alone (`__gpu.errors`, `__gpu.error` null,
  host active), the frame equals the `?native=0` page from then on, runtime state == SVG page | 0 px incl. AA at
  600 / 711 / 884 / 932 / 1100 |
- `selftest:native:identity` | `identity --quick --mutate patch` | a 1 CSS px grey dot on the cached page: the 0 px
  identity must fail | row passes when the gate rejects it |
- `native:compare` (append to the cell): with `NATIVE_INJECT` on all three pages.

**GPU-API.md — `frameStats().native`** (replace the M5 paragraph):
`native` (null with `?native=0`): `{ active, drawing, failed, machines: [{ id, state: 'idle' | 'owning' | 'failed',
drawing, error, parts, calls, changedFrames, markupRefreshes, gpu: { uploads, bytesUploaded, dispatches, emitMs } |
null, ms: { model } }] }`, plus the single machine's fields at the top level (pages with one native machine, as
before). `drawing`: every machine's painter owns its slots in the current renderer. A failed machine (its hook threw:
model, styles, painter creation or pipeline compile) records `native <id>: …` in `__gpu.errors` (non-fatal; also
`console.warn`), hands its slots back to the markup path in the same tick and stays there; other machines are not
affected.

**GPU-API.md — URL parameters** (add): `?native=cpu` | fix C2, evaluation: the native rotor's parts are expanded into
Seg / FillVertex records on the CPU (`RotorCpuEmitter`, through `SegWriter`) and uploaded; no compute pass.

**GPU-API.md — "Native slot painters"** (replace): Slot ownership is one record, `SlotOwners` (src/core/slots.ts) inside
the renderer: `renderer.addPainter(p)` makes a painter known (compiled and disposed with the renderer);
`renderer.setSlotPainter(p, slots)` moves slots — each previous owner gets `release(lost)`, the new owner
`acquire(gained)` (ownership moves both ways: a failed native machine gives its slots back to `LiveSlots`). Painters
ask `FrameContext.ownerOf(slot)` instead of keeping copies. Native machines (`src/native/native-host.ts`): a
`NativeHost` (a `PainterHost`) holds every native machine of the page; machine kinds (`rotorKind`) recognize v2
machines at `FACTORY.define`, so any number of machines per page get their own `api.gpu`. Each machine's painter is
built at `attach` (before `renderer.compile()`, so its compute pipeline is compiled ahead), re-built on every re-init;
a machine defined after attach takes its slots once its pipeline compiled. `DomSlotSource` keeps one refresh per native
slot (`ownNatively(slots, refresh)`, `disownNatively(slots)`).

### C2 status (end of fix loop C2)
- R1, R2: done by C1. R3: C2 pasted its blocks into GATES.md / GPU-API.md itself (C1 finished). R4: `CHAIN_TOLERANCE`
  now imported from strokes.ts into rotor-shaders.ts.
- C1-1: done — `SlotPainter.invalidate?()` (slots.ts), called for every known painter at the end of
  `Renderer.invalidate`; `RotorPainter.invalidate` re-uploads and re-dispatches in the next `prepare`. Covered by the
  new edge case `submit-failure-native` (tools/live-edge.mjs, quick + full): 0 px with the fix, 2859 px without.
