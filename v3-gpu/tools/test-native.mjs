// node --test tools/test-native.mjs — the native path's CPU side (src/native, slot ownership), browser-free.
// Contract:
// (1) the kit mirror classifies faces exactly as the kit's own extrude / ringSeam (same faces drawn, same tone per face,
//     same seam runs) for rings of any size, builds the same rounded plan, and its hypot is V8's Math.hypot bit for bit;
// (2) RotorModel ≡ v2's drawRotor: v2's own LIVE runs (tools/v2-page.mjs) with the hook injected as the build injects
//     it; at every tick the model's parts, turned back into markup with the kit's own functions, equal the strings v2
//     wrote, slot by slot — every restated literal and every api.data name is covered; mutated literals must fail;
// (3) the rotor's template markup has v2's element and attribute structure, and the native styles register exactly
//     the palette entries the markup path resolves for v2's strings, for all of v2's packet kinds;
// (4) the build's hook injection rejects a hook naming a variable centrifugeLive does not declare;
// (5) native machine lifecycle (native-host.ts) with fakes: several machines per page, symmetric slot ownership,
//     errors contained per machine (soft fallback to the markup path), painters built at attach.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as esbuild from "esbuild";
import { k, KINDS } from "../../v2-factory/shared/kit.mjs";
import { assertHookNames, hookNames, injectRotorHook } from "./rotor-hook.mjs";
import { bootV2Page } from "./v2-page.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const SOURCES = [
  "src/native/kit-mirror.ts", "src/native/prism-templates.ts", "src/native/rotor-styles.ts", "src/native/rotor-model.ts", "src/native/rotor-contract.ts",
  "src/native/native-host.ts", "src/live/geometry.ts", "src/core/paint.ts", "src/core/slots.ts", "src/web/dom-slots.ts",
];

// DomSlotSource reads Element.prototype's innerHTML accessor at import: a minimal stand-in
globalThis.Element ??= class Element {
  get innerHTML() {
    return this.html ?? "";
  }
  set innerHTML(value) {
    this.html = String(value);
  }
};

/** Bundles SOURCES for Node; `replace` = [[file suffix, from, to]] mutates a source text (self-tests). */
async function load(replace = []) {
  const plugins = replace.length ? [{
    name: "mutate",
    setup(build) {
      build.onLoad({ filter: /\.ts$/ }, ({ path }) => {
        let contents = readFileSync(path, "utf8");
        for (const [suffix, from, to] of replace) {
          if (!path.endsWith(suffix)) continue;
          if (!contents.includes(from)) throw new Error(`mutation: ${from} not in ${suffix}`);
          contents = contents.replace(from, to);
        }
        return { contents, loader: "ts" };
      });
    },
  }] : [];
  const bundle = await esbuild.build({
    stdin: { contents: SOURCES.map((path) => `export * from "./${path}";`).join("\n"), resolveDir: ROOT, loader: "ts" },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "error",
    define: { __GPU_DEV__: "true" },
    plugins,
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
}

const native = await load();
const { cameraOf, classifyRing, classWordsOf, seamWordOf, shadeWordOf, bitOf, shadeOf, hypot2, roundedPlan, PrismTemplates, VANE_TEMPLATE, packetTemplate, RotorStyles, RotorModel, ROTOR_SLOTS, V2_PACKET_KINDS, SlotGeometryBuilder, CollectedSlot, PaintTable, NativeHost, NativeMachine, SlotOwners, DomSlotSource } = native;
const fixture = JSON.parse(readFileSync(new URL("fixtures/live-markup.json", import.meta.url), "utf8"));

// the centrifuge page's projection and rotor data, as v2's runtime hands them to the machine
const FACTORY_DATA = (() => {
  const html = readFileSync(`${ROOT}out/svg/centrifuge.html`, "utf8");
  return JSON.parse(/const D = (\{.*\});\n/.exec(html)[1]);
})();
const P = FACTORY_DATA.P;
const D = FACTORY_DATA.data.centrifuge;
const CHAIN = [{ tag: "g", attrs: { class: "fx-parts" } }, { tag: "g", attrs: {} }];

// ---- (1) kit mirror -------------------------------------------------------------------------------------------------

/** A ring of the template `plan` turned by a about c (v2's packet() / vane() arithmetic). */
const turned = (plan, c, a) => {
  const ca = Math.cos(a), sa = Math.sin(a);
  return plan.map(([u, v]) => [c[0] + u * ca - v * sa, c[1] + u * sa + v * ca]);
};
const VANE_PLAN = [[D.r.vaneIn, -0.6], [D.r.vaneOut, -0.6], [D.r.vaneOut, 0.6], [D.r.vaneIn, 0.6]];
const PACKET_PLAN = k.roundedPlan({ x: -5, y: -4, w: 10, d: 8, r: 0.6 }, 2);
const WIDE_PLAN = k.roundedPlan({ x: -5, y: -4, w: 10, d: 8, r: 2 }); // the kit's default 8 steps: 36 points
const CIRCLE_PLAN = Array.from({ length: 64 }, (_, i) => [6 * Math.cos((i / 64) * Math.PI * 2), 6 * Math.sin((i / 64) * Math.PI * 2)]);

// test-side copies of two private kit helpers (iso-kit.mjs signedArea / oriented / runsOf)
const signedArea = (points) => points.reduce((area, [ax, ay], i) => {
  const [bx, by] = points[(i + 1) % points.length];
  return area + ax * by - bx * ay;
}, 0) / 2;
const oriented = (points) => (signedArea(points) < 0 ? [...points].reverse() : points);
function runsOf(flags, want) {
  const count = flags.length;
  const runs = [];
  const start = flags.findIndex((flag, index) => flag !== flags[(index + count - 1) % count]);
  if (start < 0) return flags[0] === want ? [Array.from({ length: count + 1 }, (_, index) => index % count)] : [];
  let run = null;
  for (let step = 0; step < count; step++) {
    const index = (start + step) % count;
    if (flags[index] === want) {
      if (!run) run = [index];
      run.push((index + 1) % count);
    } else if (run) {
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);
  return runs;
}

/** The kit's shade buckets and seam for `ring`, rebuilt from a class record (kit-mirror layout). */
function fromClasses(ring, z, height, words) {
  const top = ring.map(([x, y]) => k.iso([x, y, z + height], P));
  const bottom = ring.map(([x, y]) => k.iso([x, y, z], P));
  const buckets = [[], [], [], []];
  ring.forEach((_, i) => {
    if (!bitOf(words, 0, i)) return;
    const next = (i + 1) % ring.length;
    buckets[shadeOf(words, shadeWordOf(ring.length), i)].push(k.pathOf(oriented([top[i], top[next], bottom[next], bottom[i]]), true));
  });
  const seamFlags = ring.map((_, i) => bitOf(words, seamWordOf(ring.length), i) === 1);
  const seam = runsOf(seamFlags, true).map((run) => k.pathOf(run.map((i) => k.iso([ring[i][0], ring[i][1], z + height / 2], P)))).join("");
  return { shades: buckets.map((paths) => paths.join("")), seam };
}

function classify(ring) {
  const words = new Uint32Array(classWordsOf(ring.length));
  const classes = classifyRing(ring.flat(), ring.length, cameraOf(P), words, 0, { counter: false, facingRun: 0, seamRun: 0 });
  return { words, classes };
}

test("kit mirror: roundedPlan equals the kit's", () => {
  for (const [plan, steps] of [[{ x: -5, y: -4, w: 10, d: 8, r: 0.6 }, 2], [{ x: 0, y: 0, w: 3, d: 7, r: 1 }, 8], [{ x: 1, y: 2, w: 4, d: 4, r: 0 }, 3]]) assert.deepEqual(roundedPlan(plan, steps), k.roundedPlan(plan, steps));
});

test("kit mirror: face visibility, tone and seam runs equal the kit's for every ring size at 7200 angles", () => {
  let checked = 0;
  // the angles where a face turns edge-on to the viewer (normal ⟂ view direction), and their float neighbours
  const edgeOn = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4].flatMap((a) => [a, a * (1 + 2 ** -52), a * (1 - 2 ** -52)]);
  const angles = [...Array.from({ length: 7200 }, (_, step) => (step / 7200) * Math.PI * 2 + 1e-4 * Math.sin(step)), ...edgeOn];
  angles.forEach((a, step) => {
    const cases = [
      [turned(VANE_PLAN, D.centre, a), D.z.pocket, D.z.vane],
      [turned(PACKET_PLAN, [D.centre[0] + D.r.pocket * Math.cos(a), D.centre[1] + D.r.pocket * Math.sin(a)], a), D.z.pocket, D.z.packet],
      [turned(PACKET_PLAN, [97.3 + step * 1e-3, 99.1], a * 3), 121.1 - step * 1e-3, D.z.packet],
      [turned(WIDE_PLAN, [40, 12], a), 3, 9],
      [turned(CIRCLE_PLAN, [-20, 7], a * 0.7), 0, 4],
    ];
    for (const [ring, z, height] of cases) {
      const kit = k.extrude(ring, z, height, P);
      const mirror = fromClasses(ring, z, height, classify(ring).words);
      assert.deepEqual(mirror.shades, kit.shades, `angle ${a}, ${ring.length} points: shade buckets`);
      assert.equal(mirror.seam, k.ringSeam(ring, z + height / 2, P), `angle ${a}, ${ring.length} points: seam`);
      checked++;
    }
  });
  assert.equal(checked, angles.length * 5);
});

test("kit mirror: hypot2 is V8's Math.hypot bit for bit (kit edges and random inputs, interpreted and optimized)", () => {
  const same = (x, y) => Object.is(hypot2(x, y), Math.hypot(x, y));
  let checked = 0;
  for (let step = 0; step < 7200; step++) {
    const a = (step / 7200) * Math.PI * 2;
    for (const ring of [turned(VANE_PLAN, D.centre, a), turned(PACKET_PLAN, [D.centre[0] + D.r.pocket * Math.cos(a), D.centre[1] + D.r.pocket * Math.sin(a)], a)]) {
      for (let i = 0; i < ring.length; i++) {
        const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length];
        assert.ok(same(x1 - x0, y1 - y0), `edge ${x1 - x0}, ${y1 - y0}`);
        checked++;
      }
    }
  }
  // random magnitudes, raw bit patterns (subnormals, huge values) and the special values
  const bits = new Float64Array(1), words = new Uint32Array(bits.buffer);
  let seed = 12345;
  const random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const value = (r) => {
    if (r < 0.3) {
      words[0] = random() * 2 ** 32;
      words[1] = random() * 2 ** 32;
      return bits[0];
    }
    return r < 0.6 ? (random() - 0.5) * 10 ** (random() * 40 - 20) : (random() - 0.5) * 400;
  };
  for (let i = 0; i < 2_000_000; i++) {
    const x = value(random()), y = value(random());
    if (!same(x, y)) assert.fail(`hypot2(${x}, ${y}) = ${hypot2(x, y)}, Math.hypot = ${Math.hypot(x, y)}`);
    checked++;
  }
  for (const [x, y] of [[0, 0], [-0, 0], [5e-324, 5e-324], [1e308, 1e308], [NaN, Infinity], [Infinity, NaN], [NaN, 1], [-Infinity, 0], [3, 4], [1, 0], [0, -2]]) assert.ok(same(x, y), `${x}, ${y}`);
  assert.ok(checked > 2_000_000);
});

test("prism templates: rings are triangulated once into n − 2 triangles; repeated points are refused", () => {
  const templates = new PrismTemplates();
  const concave = [[0, 0], [10, 0], [10, 10], [5, 3], [0, 10]];
  const t = templates.add(concave);
  assert.equal(t.triangleCount, 3);
  const triangles = templates.triangles();
  const area = (i) => Math.abs(signedArea([0, 1, 2].map((j) => concave[triangles[i * 3 + j]])));
  assert.equal([0, 1, 2].reduce((sum, i) => sum + area(i), 0), Math.abs(signedArea(concave)), "the triangles tile the concave ring (no convex fan)");
  assert.equal(templates.add(CIRCLE_PLAN).classWords, classWordsOf(64));
  assert.throws(() => templates.add([[0, 0], [1, 0], [1, 0], [0, 1]]), /triangles/);
});

// ---- (2) RotorModel ≡ v2's drawRotor ----------------------------------------------------------------------------------

/** v2 vane() / packet(), from a part the model describes, with the kit's own functions. */
function markupOf(part, kindOf) {
  const ring = turned(part.template, [part.x, part.y], part.angle);
  if (!part.packet) return k.solidSvg(k.extrude(ring, part.z0, part.height, P), { tone: "mid" });
  const ca = Math.cos(part.angle), sa = Math.sin(part.angle);
  const s = part.strap;
  const strap = k.onTop([[part.x - s * ca, part.y - s * sa], [part.x + s * ca, part.y + s * sa]], part.z0 + part.height, P);
  const band = part.band ? k.ringSeam(ring, part.bandZ, P) : "";
  return `<g class="pk" data-kind="${kindOf(part.style)}">${k.solidSvg(k.extrude(ring, part.z0, part.height, P, { bevel: part.bevel }), { tone: "hi" })}${k.lineSvg(band + strap, { tone: "lo" })}</g>`;
}

/** Packet kinds injected besides the page feed's control / graph / data: every kind v2 has gets drawn. */
const INJECT = [[300, "audio"], [420, "garbage"], [520, "fluff"], [1700, "garbage"], [1800, "audio"], [1900, "fluff"]];

/**
 * Runs v2's page for `ticks` with the hook running `RotorModel.update` (returning false, so v2 writes its strings) and
 * compares, after every tick, each rotor slot's string with the model's parts turned back into markup.
 */
function equivalence(model, ticks) {
  const kinds = [];
  const styleOf = (kind) => {
    const at = kinds.indexOf(kind);
    return at >= 0 ? at + 1 : kinds.push(kind);
  };
  const kindOf = (style) => kinds[style - 1];
  let rotor = null;
  let hookCalls = 0;
  const page = bootV2Page({
    machineGpu: (id, api) => {
      if (id !== "centrifuge") return undefined;
      rotor = new model.RotorModel(api.data, api.P, [0, 1, 2, 3], styleOf, () => 0.3);
      return { rotor: (angle, pockets, releasing, now, poseOf) => (hookCalls++, rotor.update(angle, pockets, releasing, now, poseOf), false) };
    },
  });
  const mismatches = [];
  let parts = 0, maskChecks = 0;
  const seen = { swaps: 0, spout: 0, fall: 0, kinds: new Set() };
  let previousFront = null;
  for (let tick = 1; tick <= ticks && mismatches.length < 3; tick++) {
    for (const [at, kind] of INJECT) if (at === tick) page.factory.machines.centrifuge.accept("in", page.factory.item(kind));
    page.tick();
    const bySlot = Object.fromEntries(ROTOR_SLOTS.map((slot) => [slot, ""]));
    for (let part = 0; part < rotor.partCount; part++) {
      const state = rotor.describePart(part);
      bySlot[state.slot] += markupOf(state, kindOf);
      if (state.packet) seen.kinds.add(kindOf(state.style));
      // the model's class record (sent to the GPU) is the kit's own classification of the same ring
      if (tick % 7 === 0) {
        const ring = turned(state.template, [state.x, state.y], state.angle);
        assert.deepEqual(fromClasses(ring, state.z0, state.height, rotor.classesOf(part)).shades, k.extrude(ring, state.z0, state.height, P).shades, `t${tick} part ${part}: facing / shades`);
        maskChecks++;
      }
      parts++;
    }
    for (const slot of ROTOR_SLOTS) {
      const v2 = page.slots[`centrifuge:${slot}`].innerHTML;
      if (bySlot[slot] !== v2) mismatches.push(`t${tick} ${slot}: model ≠ v2 (${bySlot[slot].length} vs ${v2.length} chars)`);
    }
    const front = rotor.slots[1].count;
    if (previousFront !== null && front !== previousFront) seen.swaps++;
    previousFront = front;
    if (rotor.slots[2].count) seen.spout++;
    if (rotor.slots[3].count) seen.fall++;
  }
  return { mismatches, parts, maskChecks, hookCalls, seen };
}

test("RotorModel ≡ v2 drawRotor: 3000 ticks of v2's LIVE, every rotor slot string rebuilt from the model's parts, all six kinds", () => {
  const { mismatches, parts, maskChecks, hookCalls, seen } = equivalence(native, 3000);
  assert.deepEqual(mismatches, []);
  assert.equal(hookCalls, 3000, "the injected hook ran once per tick");
  assert.ok(parts > 3000 * 10 && maskChecks > 1000, `${parts} parts, ${maskChecks} mask checks`);
  assert.ok(seen.swaps > 20 && seen.spout > 20 && seen.fall > 20, `back / front swaps ${seen.swaps}, spout ticks ${seen.spout}, fall ticks ${seen.fall}`);
  assert.deepEqual([...seen.kinds].sort(), [...KINDS].sort(), "every v2 packet kind was drawn");
});

test("RotorModel ≡ v2 drawRotor: a restated literal changed in the model is caught", async () => {
  for (const [from, to] of [["VANE_DEPTH_RADIUS = 20.4", "VANE_DEPTH_RADIUS = 20.3"], ["BAND_BELOW_TOP = 0.45", "BAND_BELOW_TOP = 0.4"], ["VANE_HALF_THICKNESS = 0.6", "VANE_HALF_THICKNESS = 0.61"], ["PACKET_DEPTH_BIAS = 0.1", "PACKET_DEPTH_BIAS = 0"]]) {
    const mutated = await load([["rotor-model.ts", from, to]]);
    const { mismatches } = equivalence(mutated, 3000);
    assert.ok(mismatches.length > 0, `${to}: not caught`);
  }
});

// ---- (3) templates and styles ---------------------------------------------------------------------------------------

/** Markup with the path data and the per-face shade paths dropped (a frame draws only the facing faces' tones). */
const normalized = (markup) => markup.replace(/ d="[^"]*"/g, "").replace(/<path class="iso-shade" data-shade="\d"\/>/g, "");

test("templates: v2's recorded rotor markup is a sequence of the vane and packet templates", () => {
  const vane = normalized(VANE_TEMPLATE);
  let parts = 0;
  for (const slot of ROTOR_SLOTS) {
    let rest = normalized(fixture.slots[`centrifuge:${slot}`]);
    assert.ok(rest.length > 0, `${slot}: recorded markup`);
    while (rest.length) {
      const kind = /^<g class="pk" data-kind="(\w+)">/.exec(rest)?.[1];
      const template = kind ? normalized(packetTemplate(kind)) : vane;
      assert.ok(rest.startsWith(template), `${slot}: part ${parts} is not a template: ${rest.slice(0, 160)}`);
      rest = rest.slice(template.length);
      parts++;
    }
  }
  assert.ok(parts > 20, `${parts} parts`);
});

test("styles: v2's packet kinds are the ones the native rotor registers at creation", () => {
  assert.deepEqual([...V2_PACKET_KINDS], KINDS);
});

test("styles: the native rotor registers exactly the palette entries the markup path uses for v2's rotor strings, all kinds", () => {
  const table = new PaintTable();
  const styles = new RotorStyles(table, CHAIN, V2_PACKET_KINDS);
  const registered = table.size;
  const builder = new SlotGeometryBuilder(table, CHAIN);
  const collected = new CollectedSlot();
  const used = new Set();
  // the recorded strings, plus every kind as v2's packet() writes it
  const markups = [...ROTOR_SLOTS.map((slot) => fixture.slots[`centrifuge:${slot}`]), ...KINDS.map((kind) => fixture.slots["centrifuge:rotorFront"].replace(/data-kind="\w+"/g, `data-kind="${kind}"`))];
  for (const markup of markups) {
    builder.collect(markup, collected);
    for (let i = 0; i < collected.count; i++) used.add(collected.prims[i].prim.paint);
  }
  assert.equal(table.size, registered, "v2's rotor markup needed no paint the native styles did not register");
  const styleIds = new Set([...styles.fillPaints, ...styles.strokePaints]);
  for (const id of used) assert.ok(styleIds.has(id), `paint ${id} of the markup path is a native style paint`);
  assert.equal(styles.maxHalfWidth, Math.fround(0.6) / 2, "rotor lines are .iso-line (0.6 px)");
  assert.throws(() => styles.styleOf('bad"kind'), /plain name/);
});

// ---- (4) hook injection ---------------------------------------------------------------------------------------------

test("hook injection: every name the hook passes is declared in centrifugeLive; a renamed v2 variable fails the build", () => {
  const html = readFileSync(`${ROOT}out/svg/centrifuge.html`, "utf8");
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.deepEqual(hookNames(), ["api", "Ad", "pockets", "releasing", "now", "releasePose", "drawRotor"]);
  assert.doesNotThrow(() => assertHookNames(script));
  for (const name of ["Ad", "pockets", "releasing", "releasePose"]) {
    const renamed = script.replace(new RegExp(`\\b${name}\\b`, "g"), `${name}2`);
    assert.throws(() => injectRotorHook(renamed), new RegExp(`${name} not declared`), name);
  }
  assert.throws(() => injectRotorHook(script.replace("function drawRotor(now) {", "function drawRotor(t) {")), /occurrences/);
});

// ---- (5) native machines with fakes ----------------------------------------------------------------------------------

/** A painter that records what the renderer told it. */
class FakePainter {
  constructor(slots) {
    this.slots = slots;
    this.version = 0;
    this.log = [];
  }
  layersOf() { return 0; }
  extentOf() { return null; }
  release(slots) { this.log.push(["release", [...slots]]); }
  acquire(slots) { this.log.push(["acquire", [...slots]]); }
  prepare() {}
  drawOpaque() {}
  drawSlot() {}
  pipelines() { return [{ initAsync: () => Promise.resolve() }]; }
  dispose() {}
}

/** The renderer's ownership surface over the real SlotOwners. */
const fakeRenderer = (slotCount) => {
  const owners = new SlotOwners(slotCount);
  return { owners, addPainter: (p) => owners.add(p), setSlotPainter: (p, slots = p.slots) => owners.assign(p, slots), painterOf: (slot) => owners.ownerOf(slot) };
};

/** A native machine whose hook can be made to throw; its "v2 strings" are `${id}@${frame}`. */
class FakeMachine extends NativeMachine {
  constructor(id, slots, host, source, failPainter = false) {
    super(id, slots, host);
    this.source = source;
    this.failPainter = failPainter;
    this.frame = 0;
    this.throwAt = -1;
    this.refreshes = 0;
    this.gpu = { draw: () => this.draw() };
  }
  get stats() { return { frame: this.frame }; }
  createPainter() {
    if (this.failPainter) throw new Error("no pipeline");
    this.fakePainter = new FakePainter(this.slots);
    return this.fakePainter;
  }
  refreshMarkup() {
    this.refreshes++;
    for (const slot of this.slots) this.source.elements[slot].innerHTML = `${this.id}@${this.frame}`;
  }
  /** One tick: the hook; when it returns false, "v2" writes its strings itself. */
  tick() {
    this.frame++;
    const native = this.draw();
    if (!native) for (const slot of this.slots) this.source.elements[slot].innerHTML = `${this.id}@${this.frame}`;
    return native;
  }
  draw() {
    if (!this.canDraw) return false;
    try {
      if (this.frame === this.throwAt) throw new Error("model broke");
      this.own();
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    }
  }
}

function fakePage(machineSpecs) {
  const names = machineSpecs.flatMap(([id, count]) => Array.from({ length: count }, (_, i) => `${id}:s${i}`));
  const elements = new Map(names.map((name) => [name, new Element()]));
  const source = new DomSlotSource(elements);
  source.elements = [...elements.values()];
  const changed = [];
  source.onChange = (slot) => changed.push(slot);
  const errors = [];
  let frames = 0;
  const kinds = [{ create: (id, api, host) => new FakeMachine(id, api.slots, host, source, api.failPainter) }];
  const host = new NativeHost({ owner: source, onChange: () => frames++, onError: (error) => errors.push(error.message) }, kinds);
  const renderer = fakeRenderer(names.length);
  const markup = new FakePainter(names.map((_, slot) => slot));
  renderer.setSlotPainter(markup);
  const machines = machineSpecs.map(([id, count, failPainter]) => {
    host.machineGpu(id, { slots: names.flatMap((name, slot) => (name.startsWith(`${id}:`) ? [slot] : [])), failPainter });
    return host.machines[host.machines.length - 1];
  });
  return { names, source, changed, errors, host, renderer, markup, machines, frames: () => frames };
}

test("native host: two machines on one page own their own slots and refresh only their own markup", () => {
  const page = fakePage([["a", 2], ["b", 3]]);
  const [a, b] = page.machines;
  page.host.attach({}, page.renderer);
  assert.equal(a.tick(), false, "inactive host: v2 draws");
  page.host.activate();
  assert.equal(a.tick(), true);
  assert.equal(b.tick(), true);
  assert.deepEqual([0, 1, 2, 3, 4].map((slot) => page.renderer.painterOf(slot)), [a.fakePainter, a.fakePainter, b.fakePainter, b.fakePainter, b.fakePainter]);
  assert.deepEqual(page.markup.log, [["acquire", [0, 1, 2, 3, 4]], ["release", [0, 1]], ["release", [2, 3, 4]]]);
  // writes to native slots no longer schedule frames; a reader gets the owning machine's strings, refreshed on demand
  page.changed.length = 0;
  a.tick();
  b.tick();
  assert.deepEqual(page.changed, []);
  assert.equal(page.source.elements[3].innerHTML, `b@${b.frame}`);
  assert.equal(b.refreshes, 1);
  assert.equal(a.refreshes, 0, "reading b's slot does not refresh a");
  assert.equal(page.host.stats.drawing, true);
  assert.equal(page.host.stats.machines.length, 2);
});

test("native host: a throwing hook fails only its machine; its slots go back to the markup path in the same tick", () => {
  const page = fakePage([["a", 2], ["b", 2]]);
  const [a, b] = page.machines;
  page.host.attach({}, page.renderer);
  page.host.activate();
  a.tick();
  b.tick();
  page.changed.length = 0;
  a.throwAt = a.frame + 1;
  assert.doesNotThrow(() => assert.equal(a.tick(), false, "v2 draws the failing frame itself"));
  assert.equal(a.state, "failed");
  assert.match(page.errors[0], /native a: model broke/);
  assert.deepEqual([0, 1].map((slot) => page.renderer.painterOf(slot)), [page.markup, page.markup], "the markup painter draws a's slots again");
  assert.deepEqual(page.markup.log.at(-1), ["acquire", [0, 1]]);
  assert.deepEqual(a.fakePainter.log.at(-1), ["release", [0, 1]]);
  assert.deepEqual(page.source.takeDirty([]), [0, 1], "a's slots are parsed again");
  assert.equal(page.source.markupOf(0), `a@${a.frame}`, "with v2's strings of the failing frame");
  assert.equal(a.tick(), false, "a stays on the markup path");
  assert.equal(b.tick(), true, "b keeps drawing natively");
  assert.equal(page.renderer.painterOf(2), b.fakePainter);
  // a re-init after device loss leaves the failed machine on the markup path
  page.host.detach();
  const renderer = fakeRenderer(4);
  const markup = new FakePainter([0, 1, 2, 3]);
  renderer.setSlotPainter(markup);
  page.host.attach({}, renderer);
  assert.deepEqual([0, 1, 2, 3].map((slot) => renderer.painterOf(slot)), [markup, markup, b.fakePainter, b.fakePainter], "b takes its slots before the new renderer's first frame, a never");
});

test("native host: a painter that cannot be built fails its machine at attach, never inside a tick", () => {
  const page = fakePage([["a", 1, true], ["b", 1]]);
  const [a, b] = page.machines;
  page.host.attach({}, page.renderer);
  assert.equal(a.state, "failed");
  assert.match(page.errors[0], /no pipeline/);
  page.host.activate();
  assert.equal(a.tick(), false);
  assert.equal(b.tick(), true);
  assert.equal(page.renderer.painterOf(0), page.markup);
});

test("native host: a machine defined after attach takes its slots only once its painter compiled", async () => {
  const renderer = fakeRenderer(1);
  const markup = new FakePainter([0]);
  renderer.setSlotPainter(markup);
  const elements = new Map([["late:s0", new Element()]]);
  const source = new DomSlotSource(elements);
  source.elements = [...elements.values()];
  const host = new NativeHost({ owner: source, onChange() {}, onError() {} }, [{ create: (id, api, h) => new FakeMachine(id, [0], h, source) }]);
  host.attach({}, renderer);
  host.activate();
  host.machineGpu("late", {});
  const machine = host.machines[0];
  assert.equal(machine.tick(), true, "the hook owns the slot (v2 skips its strings) …");
  assert.equal(renderer.painterOf(0), markup, "… but the painter draws only once compiled");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(renderer.painterOf(0), machine.fakePainter);
});

test("slot owners: ownership moves both ways and only changes notify painters", () => {
  const owners = new SlotOwners(3);
  const markup = new FakePainter([0, 1, 2]);
  const rotor = new FakePainter([1, 2]);
  assert.equal(owners.assign(markup, [0, 1, 2]), true);
  assert.equal(owners.assign(rotor, [1, 2]), true);
  assert.equal(owners.assign(rotor, [1, 2]), false, "no change, no notification");
  assert.deepEqual(owners.active, [markup, rotor]);
  assert.equal(owners.assign(markup, [1, 2]), true);
  assert.deepEqual(owners.active, [markup], "a painter left without slots is not drawn");
  assert.deepEqual(markup.log, [["acquire", [0, 1, 2]], ["release", [1, 2]], ["acquire", [1, 2]]]);
  assert.deepEqual(rotor.log, [["acquire", [1, 2]], ["release", [1, 2]]]);
  assert.deepEqual(owners.painters, [markup, rotor], "both stay known (compiled and disposed with the renderer)");
});
