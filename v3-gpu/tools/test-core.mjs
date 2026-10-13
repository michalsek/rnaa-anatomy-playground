// node --test tools/test-core.mjs — src/core without a browser or a GPU.
// Contract: (1) the static cache's selection is exact: every static primitive whose coverage can reach a slot's redraw
// region is redrawn in a cached frame (property test, explode offsets and stroke widths included), envelopes grow and
// report off-grid extents; (2) the paint table's versions drive cache invalidation inside render(); (3) stroke
// ownership: no pixel of a polyline is claimed by two segments where the exact neighbour loop would give it to one
// (QA-FIXA D4); (4) the frame loop and the renderer on a fake device: frames == ticks, device loss at every point of
// the lifecycle (QA-FIXA D1, D5), failed frames (D2), zero sizes (D3), failure reasons and no device leaks (D6, S7).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as esbuild from "esbuild";

const ROOT = new URL("..", import.meta.url).pathname;
const SOURCES = ["src/core/frame-loop.ts", "src/core/renderer.ts", "src/core/static-cache.ts", "src/core/static-geometry.ts", "src/core/paint.ts", "src/core/strokes.ts", "src/core/draw-list.ts", "src/core/schemas.ts", "src/core/fills.ts", "src/core/profiler.ts", "src/core/scene.ts"];
const bundle = await esbuild.build({
  stdin: { contents: [...SOURCES.map((path) => `export * from "./${path}";`), `export { sizeOf } from "typegpu/data";`].join("\n"), resolveDir: ROOT, loader: "ts" },
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "error",
  define: { __GPU_DEV__: "true" },
});
// what TypeGPU and the texture factories read from the browser's WebGPU globals
globalThis.GPUTextureUsage ??= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
globalThis.GPUBufferUsage ??= { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
const core = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const { GpuView, Renderer, SlotEnvelopes, CachePartition, PaintTable, SegWriter, buildStaticGeometry, painterSequenceOf, frameOrderOf, slotsByAnchorOf, orderOf, slotRectOf, clippedRectOf, offsetOf, SEG, SEG_RECORD, FILL_VERTEX_RECORD, CROWD_NONE, OWNERSHIP_WINDOW, NO_PROFILER, sizeOf } = core;

// ---- fake WebGPU device / TypeGPU root ----------------------------------------------------------------------------

/** A device whose `lost` the test resolves (`lose`) or that `destroy()` resolves, as WebGPU does. */
function fakeDevice(world) {
  let resolveLost;
  const device = {
    lost: new Promise((resolve) => (resolveLost = resolve)),
    destroyed: false,
    listeners: [],
    adapterInfo: world.noAdapterInfo ? undefined : { vendor: "fake", architecture: "test", description: "" },
    queue: { onSubmittedWorkDone: () => Promise.resolve() },
    addEventListener(type, listener) {
      if (type === "uncapturederror") device.listeners.push(listener);
    },
    lose(reason = "unknown") {
      resolveLost({ reason, message: `lost (${reason})` });
    },
    destroy() {
      if (device.destroyed) return;
      device.destroyed = true;
      world.liveDevices--;
      resolveLost({ reason: "destroyed", message: "destroyed" });
    },
    validationError(message) {
      for (const listener of device.listeners) listener({ error: { message } });
    },
  };
  world.liveDevices++;
  return device;
}

/** A TypeGPU root on a fake device: resources are plain objects with host mirrors; passes and submits are recorded. */
function fakeRoot(world) {
  const device = fakeDevice(world);
  const resource = (extra) => ({ destroyed: false, destroy() { this.destroyed = true; }, $usage() { return this; }, $overrideFlags() { return this; }, $name() { return this; }, ...extra });
  const root = {
    device,
    enabledFeatures: new Set(),
    createBuffer(schema) {
      world.buffers++;
      return resource({ dataType: schema, arrayBuffer: new ArrayBuffer(sizeOf(schema)), buffer: {}, write() {} });
    },
    createTexture(props) {
      const [width, height] = props.size;
      if (!(width >= 1 && height >= 1)) world.zeroTextures++;
      return resource({ props });
    },
    createSampler: () => ({}),
    createBindGroup: () => ({}),
    createQuerySet: () => resource({ resolve() {}, read: () => Promise.resolve([0n, 0n]) }),
    createRenderPipeline: () => ({ initAsync: () => world.compile() }),
    createComputePipeline: () => ({ initAsync: () => world.compile() }),
    destroy: () => device.destroy(),
    "~unstable": {
      createCommandEncoder() {
        const passes = [];
        return {
          beginRenderPass(descriptor) {
            const pass = new Proxy({ descriptor, calls: 0 }, { get: (target, key) => (key in target ? target[key] : () => target.calls++) });
            passes.push(pass);
            return pass;
          },
          submit() {
            world.submits++;
            if (world.failSubmits > 0) {
              world.failSubmits--;
              throw new Error("submit failed (test)");
            }
            world.passes.push(...passes);
          },
        };
      },
    },
  };
  world.roots.push(root);
  return root;
}

function fakeWorld() {
  return { liveDevices: 0, buffers: 0, zeroTextures: 0, submits: 0, failSubmits: 0, passes: [], roots: [], compile: () => Promise.resolve(), noAdapterInfo: false };
}

// ---- a small synthetic scene ----------------------------------------------------------------------------------------

/** Paints by probe class: opaque grey fill, dark stroke (width 1), translucent fill, wide stroke (width 3). */
const PROBED = {
  fill: { color: [0.5, 0.5, 0.5, 1], alpha: 1, width: 0, cap: "butt", blend: "normal", blur: 0, translate: [0, 0] },
  stroke: { color: [0.1, 0.1, 0.1, 1], alpha: 1, width: 1, cap: "round", blend: "normal", blur: 0, translate: [0, 0] },
  glass: { color: [0.2, 0.4, 0.8, 0.5], alpha: 1, width: 0, cap: "butt", blend: "normal", blur: 0, translate: [0, 0] },
  wide: { color: [0.3, 0.1, 0.1, 1], alpha: 1, width: 3, cap: "round", blend: "normal", blur: 0, translate: [0, 0] },
};
const probe = (prop, cls) => ({ key: `${prop}:${cls}`, desc: { kind: "probe", prop, ancestors: [], el: { tag: "path", attrs: { class: cls } } } });

/** A resolver answering from `table` (class → ProbedPaint); `overrides` patches single classes. */
const resolverOf = (overrides = {}) => ({
  calls: 0,
  resolve(probes) {
    this.calls++;
    return probes.map((p) => ({ ...PROBED[p.el.attrs.class], ...overrides[p.el.attrs.class] }));
  },
});

function rectTris(x0, y0, x1, y1) {
  return [x0, y0, x1, y0, x1, y1, x0, y0, x1, y1, x0, y1];
}

/** viewBox 200 × 100: a ground rect (opaque), a translucent pane, a few strokes and dots spread over the box. */
function syntheticScene({ strokes = defaultStrokes(), items = 4, extraTris = [] } = {}) {
  const palette = [probe("fill", "fill"), probe("stroke", "stroke"), probe("fill", "glass"), probe("stroke", "wide")];
  const tris = [...rectTris(0, 0, 200, 100), ...rectTris(120, 20, 170, 60), ...extraTris.flat()];
  const fills = [
    { item: 0, layer: 0, paint: 0, alpha: 1, first: 0, count: 6 },
    { item: 1, layer: 0, paint: 2, alpha: 1, first: 6, count: 6 },
    ...extraTris.map((_, i) => ({ item: 1 + (i % (items - 1)), layer: 1, paint: 0, alpha: 1, first: 12 + i * 3, count: 3 })),
  ];
  const points = [];
  const strokeElems = strokes.map(({ item, paint = 1, width = 0, closed = false, pts }) => {
    const first = points.length / 2;
    points.push(...pts.flat());
    return { item, layer: 2, paint, alpha: 1, polys: [[first, pts.length, closed]], width };
  });
  return {
    viewBox: [0, 0, 200, 100],
    svgClass: "iso-svg",
    items: Array.from({ length: items }, (_, i) => ({ name: `item${i}`, key: i, lift: 0, move: [0, 0], layers: 4 })),
    palette,
    tris: new Float32Array(tris),
    fills,
    points: new Float32Array(points),
    strokes: strokeElems,
    dots: [{ item: 2, layer: 3, paint: 1, x: 40, y: 70, r: 0.5, alpha: 1 }],
  };
}

function defaultStrokes() {
  return [
    { item: 1, pts: [[10, 10], [60, 12], [90, 40]] },
    { item: 2, pts: [[20, 80], [180, 80]] },
    { item: 3, paint: 3, pts: [[150, 10], [150, 90], [190, 90]] },
  ];
}

function paintTableOf(scene, resolver = resolverOf()) {
  const paints = new PaintTable();
  for (const { key, desc } of scene.palette) paints.idOf(key, () => desc);
  paints.resolveAll(resolver);
  return paints;
}

const fakeClock = () => ({ t: 0, now() { return this.t; } });
const SURFACE = { context: {}, format: "bgra8unorm" };

/** A slot painter whose extent the test sets (one slot, nothing drawn). */
function fakePainter(slots = [0]) {
  return {
    slots,
    version: 0,
    extent: null,
    layersOf: () => 1,
    extentOf() {
      return this.extent;
    },
    release() {},
    prepare() {},
    drawOpaque() {},
    drawSlot() {},
    pipelines: () => [],
    dispose() {},
    stats: {},
    activeGroups: 0,
  };
}

function rendererOf(world, { scene = syntheticScene(), paints = paintTableOf(scene), slots = [], cache = "on" } = {}) {
  const root = fakeRoot(world);
  const renderer = new Renderer(root, { surface: SURFACE, scene, slots, paints, cache, clock: fakeClock(), profiler: NO_PROFILER });
  renderer.resize(400, 200, 2);
  return { root, renderer, scene, paints };
}

/** Renders until the cache is in use (the share must be stable for a few frames first). */
function renderSettled(renderer, frames = 4) {
  for (let i = 0; i < frames; i++) renderer.render(0);
}

// ---- renderer: cache validity -------------------------------------------------------------------------------------

test("a frame that fails to submit leaves no stale cache: the next frame re-renders it (QA-FIXA D2)", () => {
  const world = fakeWorld();
  const { renderer, paints } = rendererOf(world);
  renderSettled(renderer);
  const rebuilds = renderer.stats.cacheRebuilds;
  assert.ok(rebuilds >= 1 && renderer.stats.cachedFrames > 0, "cache in use before the failure");
  // the theme changes; the frame that re-renders the cache fails at submit
  paints.resolveAll(resolverOf({ fill: { color: [0.9, 0.2, 0.2, 1] } }));
  world.failSubmits = 1;
  assert.throws(() => renderer.render(0), /submit failed/);
  renderer.render(0);
  assert.equal(renderer.stats.cacheRebuilds, rebuilds + 2, "re-rendered after the failed frame, not assumed valid");
  renderer.render(0);
  assert.equal(renderer.stats.cacheRebuilds, rebuilds + 2, "valid again once a frame got through");
});

test("a WebGPU validation error invalidates the cache (its content is unknown)", () => {
  const world = fakeWorld();
  const { renderer } = rendererOf(world);
  renderSettled(renderer);
  const rebuilds = renderer.stats.cacheRebuilds;
  renderer.invalidate("gpu error");
  renderer.render(0);
  assert.equal(renderer.stats.cacheRebuilds, rebuilds + 1);
  assert.equal(renderer.stats.lastRebuildReason, "gpu error");
});

test("paint appearance changes invalidate the cache inside render(), no host call needed (CQ-FIXA S2)", () => {
  const world = fakeWorld();
  const { renderer, paints } = rendererOf(world);
  renderSettled(renderer);
  const rebuilds = renderer.stats.cacheRebuilds;
  paints.resolveAll(resolverOf());
  renderer.render(0);
  assert.equal(renderer.stats.cacheRebuilds, rebuilds, "re-resolving the same colours keeps the cache");
  paints.resolveAll(resolverOf({ stroke: { color: [0, 0, 1, 1] } }));
  renderer.render(0);
  assert.equal(renderer.stats.cacheRebuilds, rebuilds + 1);
  assert.equal(renderer.stats.lastRebuildReason, "paints");
});

test("a stroke width or cap change rebuilds the static geometry (stroke pads, cap flags) (CQ-FIXA S2)", () => {
  const world = fakeWorld();
  // width 0: the paint's computed width is baked into the stroke's partition pad
  const scene = syntheticScene({ strokes: [{ item: 1, width: 0, pts: [[10, 50], [190, 50]] }] });
  const { renderer, paints } = rendererOf(world, { scene });
  renderSettled(renderer);
  const before = paints.geometryVersion;
  paints.resolveAll(resolverOf({ stroke: { width: 4 } }));
  assert.equal(paints.geometryVersion, before + 1);
  const buffers = world.buffers;
  const rebuilds = renderer.stats.cacheRebuilds;
  renderer.render(0);
  assert.ok(world.buffers >= buffers + 5, "new static buffers (segments, order, fills)");
  assert.equal(renderer.stats.cacheRebuilds, rebuilds + 1);
  paints.resolveAll(resolverOf({ stroke: { width: 4, cap: "butt" } }));
  assert.equal(paints.geometryVersion, before + 2, "cap change");
});

test("paint versions: first resolutions do not count, appearance and geometry only on real changes", () => {
  const scene = syntheticScene();
  const paints = paintTableOf(scene);
  assert.deepEqual([paints.appearanceVersion, paints.geometryVersion, paints.classVersion], [0, 0, 0]);
  paints.idOf("stroke:new", () => probe("stroke", "stroke").desc);
  paints.resolvePending(resolverOf());
  assert.deepEqual([paints.appearanceVersion, paints.geometryVersion], [0, 0], "a new live paint changes nothing cached");
  paints.resolveAll(resolverOf({ glass: { color: [0.2, 0.4, 0.8, 1] } }));
  assert.deepEqual([paints.appearanceVersion, paints.geometryVersion, paints.classVersion], [1, 1, 1], "glass became opaque: class and appearance");
  paints.resolveAll(resolverOf({ glass: { color: [0.2, 0.4, 0.8, 1] }, wide: { translate: [1, 0] } }));
  assert.deepEqual([paints.appearanceVersion, paints.geometryVersion, paints.classVersion], [2, 1, 1], "translate: appearance only");
});

test("an extent beyond the envelope grid makes frames full redraws until it is back (CQ-FIXA S3)", () => {
  const world = fakeWorld();
  const slots = [{ name: "s", anchor: 1, side: "after", seq: 0 }];
  const { renderer } = rendererOf(world, { slots });
  const painter = fakePainter();
  renderer.setSlotPainter(painter);
  painter.extent = { box: { x0: 20, y0: 20, x1: 40, y1: 40 }, halfWidth: 0.5 };
  renderSettled(renderer);
  const cached = renderer.stats.cachedFrames;
  assert.ok(cached > 0);
  // the viewBox is 200 wide, the grid reaches 25 % beyond it: x = 260 is off-grid
  painter.extent = { box: { x0: 230, y0: 20, x1: 260, y1: 40 }, halfWidth: 0.5 };
  painter.version++;
  const full = renderer.stats.fullFrames;
  renderer.render(0);
  renderer.render(0);
  assert.equal(renderer.stats.fullFrames, full + 2);
  assert.equal(renderer.stats.cachedFrames, cached);
  painter.extent = { box: { x0: 30, y0: 20, x1: 50, y1: 40 }, halfWidth: 0.5 };
  painter.version++;
  renderer.render(0);
  assert.equal(renderer.stats.cachedFrames, cached + 1, "back on the grid: cached again");
});

test("zero-size targets are never created; a renderer without a size draws nothing (QA-FIXA D3)", () => {
  const world = fakeWorld();
  const { renderer } = rendererOf(world);
  renderSettled(renderer);
  renderer.resize(0, 0, 2);
  assert.equal(world.zeroTextures, 0);
  assert.equal(renderer.render(0), true, "keeps drawing at the last size");
  const fresh = new Renderer(fakeRoot(world), { surface: SURFACE, scene: syntheticScene(), slots: [], paints: paintTableOf(syntheticScene()), cache: "on", clock: fakeClock() });
  assert.equal(fresh.render(0), false, "no targets yet: nothing drawn");
  fresh.resize(0, 300, 1);
  assert.equal(fresh.render(0), false);
  assert.equal(world.zeroTextures, 0);
});

// ---- static cache: envelopes and partition --------------------------------------------------------------------------

test("envelopes: growth by cells, halfWidth growth re-adds every cell, off-grid flag, covers()", () => {
  const envelopes = new SlotEnvelopes(2, [0, 0, 200, 100]);
  assert.equal(envelopes.include(0, { box: { x0: 10, y0: 10, x1: 20, y1: 20 }, halfWidth: 1 }), true);
  const cells = envelopes.takeAdded().length;
  assert.ok(cells > 0);
  assert.equal(envelopes.include(0, { box: { x0: 11, y0: 11, x1: 19, y1: 19 }, halfWidth: 1 }), false, "inside: no growth");
  assert.equal(envelopes.takeAdded().length, 0);
  assert.ok(envelopes.covers(0, { box: { x0: 11, y0: 11, x1: 19, y1: 19 }, halfWidth: 1 }));
  assert.ok(!envelopes.covers(0, { box: { x0: 11, y0: 11, x1: 19, y1: 19 }, halfWidth: 2 }), "a wider stroke is not covered");
  assert.equal(envelopes.include(0, { box: { x0: 11, y0: 11, x1: 19, y1: 19 }, halfWidth: 2 }), true);
  assert.equal(envelopes.takeAdded().length, envelopes.rectsOf(0).length, "every cell re-padded");
  assert.equal(envelopes.anyOffGrid, false);
  envelopes.include(1, { box: { x0: -80, y0: 10, x1: -60, y1: 20 }, halfWidth: 0 });
  assert.equal(envelopes.anyOffGrid, true, "x < −50 is beyond the grid");
  assert.ok(!envelopes.covers(1, { box: { x0: -80, y0: 10, x1: -60, y1: 20 }, halfWidth: 0 }));
  envelopes.include(1, { box: { x0: 10, y0: 10, x1: 20, y1: 20 }, halfWidth: 0 });
  assert.equal(envelopes.anyOffGrid, false);
  envelopes.include(1, null);
  assert.equal(envelopes.anyOffGrid, false);
});

/** Deterministic PRNG (mulberry32). */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distance from segment a–b to the rectangle (0 when they touch). */
function segmentRectDistance(ax, ay, bx, by, r) {
  const inside = (x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  if (inside(ax, ay) || inside(bx, by)) return 0;
  const corners = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
  const cross = (px, py, qx, qy, ux, uy, vx, vy) => {
    const d = (qx - px) * (vy - uy) - (qy - py) * (vx - ux);
    if (d === 0) return false;
    const s = ((ux - px) * (vy - uy) - (uy - py) * (vx - ux)) / d;
    const t = ((ux - px) * (qy - py) - (uy - py) * (qx - px)) / d;
    return s >= 0 && s <= 1 && t >= 0 && t <= 1;
  };
  for (let i = 0; i < 4; i++) if (cross(ax, ay, bx, by, ...corners[i], ...corners[(i + 1) % 4])) return 0;
  const pointSeg = (px, py, qx, qy, ux, uy) => {
    const dx = ux - qx, dy = uy - qy, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - qx) * dx + (py - qy) * dy) / l2)) : 0;
    return Math.hypot(px - qx - dx * t, py - qy - dy * t);
  };
  const clampDist = (x, y) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.y0 - y, 0, y - r.y1));
  return Math.min(clampDist(ax, ay), clampDist(bx, by), ...corners.map(([x, y]) => pointSeg(x, y, ax, ay, bx, by)));
}

test("partition exactness (property): every static primitive that can cover a pixel of the redraw region is redrawn", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rand = random(seed);
    const items = 6;
    const strokes = Array.from({ length: 12 }, () => {
      const n = 2 + Math.floor(rand() * 4);
      return { item: 1 + Math.floor(rand() * (items - 1)), paint: rand() < 0.3 ? 3 : 1, pts: Array.from({ length: n }, () => [rand() * 200, rand() * 100]) };
    });
    const extraTris = Array.from({ length: 10 }, () => {
      const [x, y] = [rand() * 190, rand() * 90];
      return [x, y, x + 2 + rand() * 20, y + rand() * 5, x + rand() * 5, y + 2 + rand() * 20];
    });
    const scene = syntheticScene({ strokes, items, extraTris });
    const paints = paintTableOf(scene);
    const geometry = buildStaticGeometry(scene, paints);
    const slots = [{ name: "a", anchor: 2, side: "after", seq: 0 }, { name: "b", anchor: 4, side: "before", seq: 0 }];
    const order = orderOf(scene.items, 0);
    const frameOrder = frameOrderOf(order, slotsByAnchorOf(slots), items);
    const steps = painterSequenceOf(frameOrder, geometry.entries, items);
    // explode offsets (viewBox units) on every item and slot pseudo-item
    const offsets = new Float32Array((items + slots.length) * 2).map(() => (rand() - 0.5) * 10);
    for (let s = 0; s < slots.length; s++) offsets.set(offsets.subarray(slots[s].anchor * 2, slots[s].anchor * 2 + 2), (items + s) * 2);
    const dpr = 1 + Math.floor(rand() * 3);
    const view = { scale: 4 * dpr / 2, translate: [rand() * 4, rand() * 4], dpr, width: 400 * dpr / 2, height: 200 * dpr / 2, offsets, slotItemBase: items, haloBox: () => ({ x0: 0, y0: 0, x1: 0, y1: 0 }) };
    const envelopes = new SlotEnvelopes(slots.length, scene.viewBox);
    const partition = new CachePartition(steps, geometry.entries, geometry.segs, geometry.opaque, geometry.opaqueFills, view);
    const extents = [];
    // several frames of moving content; the partition is extended incrementally, as in the renderer
    for (let frame = 0; frame < 4; frame++) {
      for (let s = 0; s < slots.length; s++) {
        const [x, y] = [rand() * 190, rand() * 90];
        const extent = { box: { x0: x, y0: y, x1: x + rand() * 15, y1: y + rand() * 15 }, halfWidth: rand() * 2 };
        envelopes.include(s, extent);
        extents.push([s, extent]);
      }
      partition.include(frame === 0 ? envelopes.allCells() : envelopes.takeAdded(), envelopes);
      if (frame === 0) envelopes.clearAdded();
    }
    const regions = extents.map(([s, extent]) => clippedRectOf(slotRectOf(extent, offsetOf(view, items + s), view), view)).filter(Boolean);
    const W = SEG_RECORD.words;
    const toDevice = (x, y, item) => [(x + offsets[item * 2]) * view.scale + view.translate[0], (y + offsets[item * 2 + 1]) * view.scale + view.translate[1]];
    steps.forEach((step, s) => {
      if (step.item < 0) return;
      const entry = geometry.entries[step.item][step.index];
      if (entry.kind !== "segs") return;
      for (let i = entry.first; i < entry.first + entry.count; i++) {
        const o = i * W;
        const dot = (geometry.segs.u32[o + SEG_RECORD.flags] & SEG.dot) !== 0;
        const reach = dot ? geometry.segs.f32[o + SEG_RECORD.width] * view.scale + 0.5 : entry.halfWidth * dpr + 0.5;
        const [ax, ay] = toDevice(geometry.segs.f32[o + SEG_RECORD.p0], geometry.segs.f32[o + SEG_RECORD.p0 + 1], step.item);
        const [bx, by] = toDevice(geometry.segs.f32[o + SEG_RECORD.p1], geometry.segs.f32[o + SEG_RECORD.p1 + 1], step.item);
        // pixel centres inside the region: the region shrunk by ½ px
        const reaches = regions.some((r) => segmentRectDistance(ax, ay, bx, by, { x0: r.x0 + 0.5, y0: r.y0 + 0.5, x1: r.x1 - 0.5, y1: r.y1 - 0.5 }) < reach);
        if (reaches) {
          assert.equal(partition.segmentMask[i], 1, `seed ${seed}: segment ${i} reaches the region but is cached`);
          assert.equal(partition.perFrame[s], 1, `seed ${seed}: its entry is cached`);
        }
      }
    });
    // opaque triangles: their box (the partition's test) must be selected whenever the triangle reaches a region
    const V = FILL_VERTEX_RECORD.words;
    const selected = new Set();
    for (let v = 0; v < partition.regionOpaque.count; v++) selected.add(`${partition.regionOpaque.f32[v * V]},${partition.regionOpaque.f32[v * V + 1]}`);
    for (const fill of geometry.opaqueFills) {
      for (let v = fill.first; v < fill.first + fill.count; v += 3) {
        const pts = [0, 1, 2].map((k) => toDevice(geometry.opaque.f32[(v + k) * V], geometry.opaque.f32[(v + k) * V + 1], fill.item));
        const reaches = regions.some((r) => [0, 1, 2].some((k) => segmentRectDistance(...pts[k], ...pts[(k + 1) % 3], { x0: r.x0 + 0.5, y0: r.y0 + 0.5, x1: r.x1 - 0.5, y1: r.y1 - 0.5 }) < 0.5));
        if (reaches) assert.ok(selected.has(`${geometry.opaque.f32[v * V]},${geometry.opaque.f32[v * V + 1]}`), `seed ${seed}: an opaque triangle reaching the region is not redrawn`);
      }
    }
  }
});

// ---- strokes: crowd and ownership -----------------------------------------------------------------------------------

/** The stroke shader's ownership rule (shaders.ts strokeVert / strokeCoverage), at device scale `scale`. */
function ownershipModel(segs, start, count, scale, hw) {
  const W = SEG_RECORD.words;
  const read = (i) => {
    const o = (start + i) * W;
    const f = segs.f32, u = segs.u32;
    return { a: [f[o + SEG_RECORD.p0] * scale, f[o + SEG_RECORD.p0 + 1] * scale], b: [f[o + SEG_RECORD.p1] * scale, f[o + SEG_RECORD.p1 + 1] * scale], js: [f[o + SEG_RECORD.joinStart], f[o + SEG_RECORD.joinStart + 1]], je: [f[o + SEG_RECORD.joinEnd], f[o + SEG_RECORD.joinEnd + 1]], flags: u[o + SEG_RECORD.flags], crowd: f[o + SEG_RECORD.crowd] };
  };
  const list = Array.from({ length: count }, (_, i) => read(i));
  const closed = (list[0].flags & SEG.closed) !== 0;
  const dist = (p, s) => {
    const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / l2)) : 0;
    return Math.hypot(p[0] - s.a[0] - dx * t, p[1] - s.a[1] - dy * t);
  };
  const exactClaims = (p, i) => {
    const d = dist(p, list[i]);
    for (let k = -OWNERSHIP_WINDOW; k <= OWNERSHIP_WINDOW; k++) {
      if (!k) continue;
      let j = i + k;
      if (closed) j = ((j % count) + count) % count;
      else if (j < 0 || j >= count) continue;
      if (j === i) continue;
      const od = dist(p, list[j]);
      if (od < d || (od === d && j < i)) return false;
    }
    return true;
  };
  const fastClaims = (p, i) => {
    const s = list[i];
    if (s.flags & SEG.joinStart) {
      const ds = (p[0] - s.a[0]) * s.js[0] + (p[1] - s.a[1]) * s.js[1];
      if (!(ds > 0 || (ds === 0 && i === 0))) return false;
    }
    if (s.flags & SEG.joinEnd) {
      const de = (p[0] - s.b[0]) * s.je[0] + (p[1] - s.b[1]) * s.je[1];
      if (!(de < 0 || (de === 0 && i + 1 !== count))) return false;
    }
    return true;
  };
  const usesLoop = (i) => list[i].crowd < CROWD_NONE && list[i].crowd * scale < 2.5 * hw + 1.5;
  const adjacent = (i, j) => Math.abs(i - j) === 1 || (closed && Math.abs(i - j) === count - 1);
  /**
   * Whether pixel p is drawn (coverage > 0) by two non-adjacent segments under the shader's mixed rule while the exact
   * loop gives it to at most one. (Adjacent segments in different modes may disagree in the outer wedge of their
   * joint, where both distances are the vertex distance: a pre-existing AA-level artefact, not QA-FIXA D4.)
   */
  return {
    loops: list.filter((_, i) => usesLoop(i)).length,
    doubleBlended(p) {
      const mixed = [];
      let exact = 0;
      for (let i = 0; i < count; i++) {
        if (dist(p, list[i]) >= hw + 0.5) continue;
        if (usesLoop(i) ? exactClaims(p, i) : fastClaims(p, i)) mixed.push(i);
        if (exactClaims(p, i)) exact++;
      }
      return exact <= 1 && mixed.some((i) => mixed.some((j) => j > i && !adjacent(i, j)));
    },
  };
}

/** Pixels (sample grid over the polyline's box) blended by two non-adjacent segments of the polyline. */
function doubleClaims(points, { closed = false, scale = 4, hw = 2, step = 0.5 } = {}) {
  const writer = new SegWriter();
  const xy = points.flat();
  const count = writer.polyline(xy, 0, points.length, closed, "round", { width: 0, item: 0, paint: 0, layer: 0, alpha: 1 });
  const model = ownershipModel(writer, 0, count, scale, hw);
  const xs = points.map((p) => p[0] * scale), ys = points.map((p) => p[1] * scale);
  let bad = 0;
  for (let x = Math.min(...xs) - hw - 1; x <= Math.max(...xs) + hw + 1; x += step)
    for (let y = Math.min(...ys) - hw - 1; y <= Math.max(...ys) + hw + 1; y += step) if (model.doubleBlended([x, y])) bad++;
  return { bad, loops: model.loops, segments: count };
}

test("stroke ownership: non-adjacent segments crossing or touching at ≤ 90° turns are never double-blended (QA-FIXA D4)", () => {
  const shapes = {
    "square spiral": [[0, 0], [10, 0], [10, 10], [2, 10], [2, 3], [7, 3], [7, 7]],
    "4th crosses 1st": [[0, 5], [10, 5], [10, 10], [5, 10], [5, 0]],
    "3rd touches 1st": [[0, 0], [10, 0], [10, 4], [0.5, 0.3]],
    "zig-zag back over itself": [[0, 0], [8, 0], [8, 3], [3, 3], [3, -3]],
  };
  for (const [name, points] of Object.entries(shapes)) {
    for (const scale of [2, 4, 8]) {
      const { bad } = doubleClaims(points, { scale, hw: 1.5 });
      assert.equal(bad, 0, `${name} at scale ${scale}: ${bad} samples blended twice`);
    }
  }
});

test("stroke ownership: random walks with turns ≤ 90° (spirals, loops, crossings): no pixel blended by two non-adjacent segments", () => {
  const rand = random(7);
  for (let n = 0; n < 200; n++) {
    const count = 4 + Math.floor(rand() * 6);
    let [x, y, heading] = [0, 0, rand() * 2 * Math.PI];
    const points = [[x, y]];
    for (let i = 1; i < count; i++) {
      const length = 0.5 + rand() * 4;
      x += length * Math.cos(heading);
      y += length * Math.sin(heading);
      points.push([x, y]);
      heading += (rand() - 0.5) * Math.PI;
    }
    const closed = rand() < 0.2;
    const hw = 0.5 + rand() * 2;
    const { bad } = doubleClaims(points, { closed, scale: 3, hw, step: 0.75 });
    assert.equal(bad, 0, `walk ${n} (${JSON.stringify(points.map((p) => p.map((v) => +v.toFixed(2))))}${closed ? ", closed" : ""}, hw ${hw.toFixed(2)}): ${bad} samples blended twice`);
  }
});

test("stroke crowd: smooth curves keep the fast path (D4 fix does not send dense curves to the exact loop)", () => {
  // a quarter circle in 24 steps of ≈ 0.65 units: segments i and i + 2 are close only through segment i + 1
  const arc = Array.from({ length: 25 }, (_, i) => [10 * Math.cos((i / 24) * Math.PI / 2), 10 * Math.sin((i / 24) * Math.PI / 2)]);
  const { loops, bad } = doubleClaims(arc, { scale: 2, hw: 0.5, step: 0.5 });
  assert.equal(bad, 0);
  assert.equal(loops, 0, "no segment of a gentle arc needs the exact loop");
});

// ---- frame loop on a fake host --------------------------------------------------------------------------------------

/** A GpuView on a fake host; `world.compile` and `host.createRootImpl` let tests stall or fail the lifecycle. */
function viewOf(world, options = {}) {
  const scene = syntheticScene();
  const paints = paintTableOf(scene);
  const frames = [];
  const host = {
    clock: fakeClock(),
    profiler: NO_PROFILER,
    resolver: resolverOf(),
    createRootCalls: 0,
    createRootImpl: async () => fakeRoot(world),
    createRoot() {
      this.createRootCalls++;
      return this.createRootImpl();
    },
    createSurface: () => SURFACE,
    requestFrame: (callback) => frames.push(callback),
    background: () => [1, 1, 1, 1],
    readyCount: 0,
    fallbackReason: null,
    onReady() {
      this.readyCount++;
    },
    onFallback(reason) {
      this.fallbackReason = reason;
    },
  };
  const view = new GpuView(host, { scene, slots: [], paints, cache: "on", live: null, ...options });
  view.resize({ width: 400, height: 200, dpr: 2 });
  const runFrames = () => {
    const callbacks = frames.splice(0);
    for (const callback of callbacks) callback();
  };
  return { view, host, runFrames };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
async function until(condition, what, timeoutMs = 3000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("frame loop: one frame per runtime tick, out-of-tick requests coalesce into one own frame", async () => {
  const world = fakeWorld();
  const { view, host, runFrames } = viewOf(world);
  assert.equal(await view.start(), true);
  await until(() => view.ready, "ready");
  const frames = view.frames;
  for (let tick = 0; tick < 5; tick++) {
    host.clock.t += 16;
    view.beginRuntimeFrame();
    view.request();
    view.request();
    await flush();
  }
  assert.equal(view.frames, frames + 5, "one frame per tick");
  // the runtime stopped long ago: an out-of-tick request draws in the next display frame, several coalesce
  host.clock.t += 1000;
  view.request();
  view.request();
  view.setShare(0);
  runFrames();
  assert.equal(view.frames, frames + 6);
  runFrames();
  assert.equal(view.frames, frames + 6, "nothing pending");
  // while the runtime runs, an out-of-tick request waits one display frame for the tick
  view.beginRuntimeFrame();
  view.request();
  await flush();
  assert.equal(view.frames, frames + 7);
  view.beginRuntimeFrame();
  await flush();
  assert.equal(view.frames, frames + 7, "a tick that changed nothing draws nothing");
  view.request();
  runFrames();
  assert.equal(view.frames, frames + 7, "the request waits a display frame for the tick");
  view.beginRuntimeFrame();
  await flush();
  runFrames();
  assert.equal(view.frames, frames + 8, "folded into the tick, no extra frame");
});

test("device lost while the first renderer compiles: re-initialised, never 'ready' on the lost device (QA-FIXA D1)", async () => {
  const world = fakeWorld();
  let releaseCompile;
  const stalled = new Promise((resolve) => (releaseCompile = resolve));
  let compiles = 0;
  world.compile = () => (compiles++ === 0 ? stalled : Promise.resolve());
  const { view, host } = viewOf(world);
  const started = view.start();
  await until(() => world.roots.length === 1 && compiles > 0, "first compile");
  world.roots[0].device.lose("unknown");
  await flush();
  releaseCompile();
  await started;
  await until(() => view.ready, "ready on the second device");
  assert.equal(host.createRootCalls, 2, "a new device after the loss");
  assert.equal(view.reinits, 1);
  assert.equal(world.roots[0].device.destroyed, true, "the lost device is released");
  assert.equal(world.liveDevices, 1);
  assert.equal(view.error, null);
});

test("simulateDeviceLoss() during init and an external destroy() after ready both re-initialise (QA-FIXA D1, D5)", async () => {
  const world = fakeWorld();
  let releaseCompile;
  let compiles = 0;
  world.compile = () => (compiles++ === 0 ? new Promise((resolve) => (releaseCompile = resolve)) : Promise.resolve());
  const { view, host } = viewOf(world);
  const started = view.start();
  await until(() => compiles > 0, "first compile");
  view.simulateDeviceLoss();
  await flush();
  releaseCompile();
  await started;
  await until(() => view.ready, "ready");
  assert.equal(host.createRootCalls, 2);
  // a device destroyed by someone else (reason "destroyed", not through simulateDeviceLoss)
  const frames = view.frames;
  world.roots[1].device.destroy();
  await until(() => host.createRootCalls === 3 && view.frames > frames, "re-init after the external destroy");
  assert.equal(view.reinits, 2);
  assert.equal(view.error, null);
  assert.equal(world.liveDevices, 1);
});

test("failure reasons: no-adapter, init-failed, reinit-failed, device-lost after the cap; failed inits leak no device (QA-FIXA D6, CQ-FIXA S7)", async () => {
  {
    const world = fakeWorld();
    const { view, host } = viewOf(world);
    host.createRootImpl = async () => {
      throw new Error("no adapter");
    };
    assert.equal(await view.start(), false);
    assert.match(view.error, /^no-adapter: no adapter/);
    assert.equal(host.fallbackReason, view.error);
  }
  {
    const world = fakeWorld();
    world.compile = () => Promise.reject(new Error("bad WGSL"));
    world.noAdapterInfo = true;
    const { view } = viewOf(world);
    assert.equal(await view.start(), false);
    assert.match(view.error, /^init-failed: bad WGSL/);
    assert.equal(world.roots.length, 3, "three attempts");
    assert.equal(world.liveDevices, 0, "every failed attempt destroyed its device");
  }
  {
    const world = fakeWorld();
    const { view, host } = viewOf(world);
    await view.start();
    await until(() => view.ready, "ready");
    host.createRootImpl = async () => {
      throw new Error("adapter gone");
    };
    view.simulateDeviceLoss();
    await until(() => host.fallbackReason, "fallback");
    assert.match(view.error, /^reinit-failed: no-adapter: adapter gone/);
    assert.equal(world.liveDevices, 0);
  }
  {
    const world = fakeWorld();
    const { view } = viewOf(world);
    await view.start();
    for (let loss = 1; loss <= 17; loss++) {
      const roots = world.roots.length;
      world.roots[roots - 1].device.lose("unknown");
      if (loss <= 16) await until(() => world.roots.length === roots + 1 && view.rendererStats, `re-init ${loss}`);
    }
    await until(() => view.error, "fallback after the cap");
    assert.equal(view.reinits, 16);
    assert.match(view.error, /^device-lost: lost again after 16 re-inits/);
    assert.equal(world.liveDevices, 0);
  }
});

test("frame failures: two recover with a rebuilt cache, three in a row fall back (QA-FIXA D2)", async () => {
  const world = fakeWorld();
  const { view, host, runFrames } = viewOf(world);
  await view.start();
  await until(() => view.ready, "ready");
  for (let i = 0; i < 4; i++) {
    view.request();
    host.clock.t += 1000;
    runFrames();
  }
  const rebuilds = view.rendererStats.cacheRebuilds;
  world.failSubmits = 2;
  for (let i = 0; i < 3; i++) {
    view.request();
    runFrames();
  }
  assert.equal(view.error, null);
  assert.equal(view.errors.length, 2);
  // the second failed frame already re-rendered the cache (not submitted); the next one renders it again
  assert.equal(view.rendererStats.cacheRebuilds, rebuilds + 2, "the frame after the failures rebuilt the cache");
  assert.equal(view.rendererStats.lastRebuildReason, "frame error");
  world.failSubmits = 3;
  for (let i = 0; i < 3; i++) {
    view.request();
    runFrames();
  }
  assert.match(view.error, /^render-error: submit failed/);
  assert.equal(world.liveDevices, 0);
});

test("zero size: frames are not counted until the view has a size; an unchanged size does not redraw (QA-FIXA D3)", async () => {
  const world = fakeWorld();
  const { view, host, runFrames } = viewOf(world);
  view.resize({ width: 0, height: 0, dpr: 2 });
  await view.start();
  await until(() => view.ready, "ready at the last non-zero size");
  const frames = view.frames;
  view.resize({ width: 400, height: 200, dpr: 2 });
  assert.equal(view.frames, frames, "same size: nothing to redraw");
  view.resize({ width: 0, height: 0, dpr: 2 });
  view.request();
  host.clock.t += 1000;
  runFrames();
  assert.equal(world.zeroTextures, 0);
  assert.equal(view.frames, frames + 1, "draws at the kept size");
  // a view that never had a size draws nothing and is not ready
  const fresh = viewOf(fakeWorld());
  fresh.view.resize({ width: 0, height: 0, dpr: 1 });
  fresh.view.size = { width: 0, height: 0, dpr: 1 };
  await fresh.view.start();
  await flush();
  assert.equal(fresh.view.frames, 0);
  assert.equal(fresh.view.ready, false);
  fresh.view.resize({ width: 300, height: 150, dpr: 1 });
  await until(() => fresh.view.ready, "ready once sized");
});

test("dispose: renderer, painters and device released; later runtime ticks are no-ops", async () => {
  const world = fakeWorld();
  const painter = fakePainter();
  let detached = 0;
  const { view } = viewOf(world, { painters: [{ attach: (_root, renderer) => renderer.addPainter(painter), detach: () => detached++ }] });
  await view.start();
  await until(() => view.ready, "ready");
  view.dispose();
  assert.equal(world.liveDevices, 0);
  assert.equal(detached, 1);
  const frames = view.frames;
  view.beginRuntimeFrame();
  view.request();
  await flush();
  assert.equal(view.frames, frames);
});
