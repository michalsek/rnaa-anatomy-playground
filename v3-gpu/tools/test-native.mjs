// node --test tools/test-native.mjs — the native rotor's CPU side (src/native), browser-free.
// Contract: (1) the kit mirror classifies faces exactly as the kit's own extrude / ringSeam (same faces drawn, same tone
// per face, same seam runs) and builds the same rounded plan; (2) the rotor's template markup has v2's element and
// attribute structure (recorded v2 rotor markup, tools/fixtures/live-markup.json); (3) the native styles register the
// palette entries the markup path resolves for v2's strings — no other keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as esbuild from "esbuild";
import { k } from "../../v2-factory/shared/kit.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const SOURCES = ["src/native/kit-mirror.ts", "src/native/rotor-styles.ts", "src/live/geometry.ts", "src/core/paint.ts"];
const bundle = await esbuild.build({
  stdin: { contents: SOURCES.map((path) => `export * from "./${path}";`).join("\n"), resolveDir: ROOT, loader: "ts" },
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "error",
  define: { __GPU_DEV__: "true" },
});
const native = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const { cameraOf, classifyRing, roundedPlan, VANE_TEMPLATE, packetTemplate, RotorStyles, SlotGeometryBuilder, CollectedSlot, PaintTable } = native;
const fixture = JSON.parse(readFileSync(new URL("fixtures/live-markup.json", import.meta.url), "utf8"));

// the centrifuge page's projection and rotor data (out/svg/centrifuge.html __FACTORY_DATA__)
const P = { origin: [281.34282749223223, 465.5035565257994], scale: 2.2747385669817044, azimuth: 45, elevation: 30 };
const D = { centre: [100, 66], r: { vaneIn: 12, vaneOut: 28.8, pocket: 23 }, z: { pocket: 125, vane: 5, packet: 7 } };
const PACKET_PLAN = { x: -5, y: -4, w: 10, d: 8, r: 0.6 };

// v2 vane() / packet() rings at angle a
const vaneRing = (a) => {
  const ca = Math.cos(a), sa = Math.sin(a), t = 0.6;
  return [[D.r.vaneIn, -t], [D.r.vaneOut, -t], [D.r.vaneOut, t], [D.r.vaneIn, t]].map(([u, v]) => [D.centre[0] + u * ca - v * sa, D.centre[1] + u * sa + v * ca]);
};
const packetRing = (c, a) => {
  const ca = Math.cos(a), sa = Math.sin(a);
  return k.roundedPlan(PACKET_PLAN, 2).map(([u, v]) => [c[0] + u * ca - v * sa, c[1] + u * sa + v * ca]);
};

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

/** The kit's shade buckets and seam for `ring`, rebuilt from the mirror's classification. */
function fromMirror(ring, z, height) {
  const classes = classifyRing(ring.flat(), ring.length, cameraOf(P), { counter: false, facing: 0, seamFacing: 0, shades: 0 });
  const top = ring.map(([x, y]) => k.iso([x, y, z + height], P));
  const bottom = ring.map(([x, y]) => k.iso([x, y, z], P));
  const buckets = [[], [], [], []];
  ring.forEach((_, i) => {
    if (!((classes.facing >> i) & 1)) return;
    const next = (i + 1) % ring.length;
    buckets[(classes.shades >> (2 * i)) & 3].push(k.pathOf(oriented([top[i], top[next], bottom[next], bottom[i]]), true));
  });
  const seamFlags = ring.map((_, i) => ((classes.seamFacing >> i) & 1) === 1);
  const seam = runsOf(seamFlags, true).map((run) => k.pathOf(run.map((i) => k.iso([ring[i][0], ring[i][1], z + height / 2], P)))).join("");
  return { shades: buckets.map((paths) => paths.join("")), seam, counter: classes.counter };
}

test("kit mirror: roundedPlan equals the kit's", () => {
  for (const [plan, steps] of [[PACKET_PLAN, 2], [{ x: 0, y: 0, w: 3, d: 7, r: 1 }, 8], [{ x: 1, y: 2, w: 4, d: 4, r: 0 }, 3]]) assert.deepEqual(roundedPlan(plan, steps), k.roundedPlan(plan, steps));
});

test("kit mirror: every face's visibility and tone, and the seam runs, equal the kit's for vanes and packets at 7200 angles", () => {
  let checked = 0;
  for (let step = 0; step < 7200; step++) {
    const a = (step / 7200) * Math.PI * 2 + 1e-4 * Math.sin(step);
    const cases = [
      [vaneRing(a), D.z.pocket, D.z.vane],
      [packetRing([D.centre[0] + D.r.pocket * Math.cos(a), D.centre[1] + D.r.pocket * Math.sin(a)], a), D.z.pocket, D.z.packet],
      [packetRing([97.3 + step * 1e-3, 99.1], a * 3), 121.1 - step * 1e-3, D.z.packet],
    ];
    for (const [ring, z, height] of cases) {
      const kit = k.extrude(ring, z, height, P);
      const mirror = fromMirror(ring, z, height);
      assert.deepEqual(mirror.shades, kit.shades, `angle ${a}: shade buckets`);
      assert.equal(mirror.seam, k.ringSeam(ring, z + height / 2, P), `angle ${a}: seam`);
      checked++;
    }
  }
  assert.equal(checked, 7200 * 3);
});

/** Markup with the path data and the per-face shade paths dropped (a frame draws only the facing faces' tones). */
const normalized = (markup) => markup.replace(/ d="[^"]*"/g, "").replace(/<path class="iso-shade" data-shade="\d"\/>/g, "");

test("templates: v2's recorded rotor markup is a sequence of the vane and packet templates", () => {
  const vane = normalized(VANE_TEMPLATE);
  let parts = 0;
  for (const slot of ["rotorBack", "rotorFront", "spout", "fall"]) {
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

test("styles: the native rotor registers exactly the palette entries the markup path uses for v2's rotor strings", () => {
  const chain = [{ tag: "g", attrs: { class: "fx-parts" } }, { tag: "g", attrs: {} }];
  const table = new PaintTable();
  const styles = new RotorStyles(table, chain);
  for (const kind of ["control", "graph", "data", "audio", "garbage"]) styles.styleOf(kind);
  const registered = table.size;
  const builder = new SlotGeometryBuilder(table, chain);
  const collected = new CollectedSlot();
  const used = new Set();
  for (const slot of ["rotorBack", "rotorFront", "spout", "fall"]) {
    builder.collect(fixture.slots[`centrifuge:${slot}`], collected);
    for (let i = 0; i < collected.count; i++) used.add(collected.prims[i].prim.paint);
  }
  assert.equal(table.size, registered, "v2's rotor markup needed no paint the native styles did not register");
  const styleIds = new Set([...styles.fillPaints, ...styles.strokePaints]);
  for (const id of used) assert.ok(styleIds.has(id), `paint ${id} of the markup path is a native style paint`);
  assert.equal(styles.maxHalfWidth, Math.fround(0.6) / 2, "rotor lines are .iso-line (0.6 px)");
});
