// Standalone page for the crusher: the machine with a short stub of belt C above it dropping garbage packets.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scene, page, k, G } from "../../shared/kit.mjs";
import { build, LIVE, CSS, checkOrder } from "./crusher.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));

const O = [-136, 176, 0];
const W = ([x, y, z]) => [O[0] + x, O[1] + y, O[2] + z];
const B = (x0, y0, z0, x1, y1, z1) => k.boxCorners({ x: O[0] + x0, y: O[1] + y0, w: x1 - x0, d: y1 - y0, r: 0 }, z0, z1);
const FIT = [B(-21, -24, 0, 17, 26, 38), B(-38, -1, 0, -26, 12, 37), B(21, -36, 0, 40, -17, 18), B(21, -17, 12, 27, 5, 34), B(-13, 19, 0, 13, 60, 11), B(-8, -58, 0, 8, -24, 42)].flat();
const ctx = scene({ W: 720, H: 560, pad: 30, fit: FIT });
build(ctx, O, { id: "crusher" });

// ---- a stub of belt C: end of the conveyor that brings spent packets from the audio belt ----------------------------
const STUB = { x0: -6, x1: 6, y0: -58, y1: -26, top: 40 };
const box = (name, a, b, style = {}, opts = {}) => ctx.box(`stub.${name}`, W(a), W(b), style, opts);
ctx.material = "";
for (const y of [-54, -32]) {
  for (const x of [-8, 6]) {
    ctx.cyl(`stub.pad.${x}.${y}`, O[0] + x + 1, O[1] + y + 1, 2, 0, 0.7, { tone: "lo" }, { steps: 20, bevel: 0.2 });
    box(`leg.${x}.${y}`, [x, y, 0.7], [x + 2, y + 2, 35], { tone: "mid" }, { r: 0.3, bevel: 0.2 });
  }
  box(`brace.${y}`, [-6, y + 0.4, 12], [6, y + 1.6, 13.6], { tone: "lo" }, { r: 0.2, bevel: 0.15 });
}
for (const x of [-8, 6]) {
  const p = { x: O[0] + x, y: O[1] + STUB.y0, w: 2, d: STUB.y1 + 2 - STUB.y0, r: 0.3 };
  box(`channel.${x < 0 ? "l" : "r"}`, [x, STUB.y0, 35], [x + 2, STUB.y1 + 2, STUB.top + 0.6], { tone: "mid" }, { r: 0.3, bevel: 0.2, inner: ctx.Ln(k.sideSeam(p, 37, ctx.P, 3), { tone: "faint" }) });
}
const slats = [];
for (let y = STUB.y0 + 2; y < STUB.y1 - 1.2; y += 3) slats.push(k.lineOnTop([O[0] + STUB.x0, O[1] + y], [O[0] + STUB.x1, O[1] + y], STUB.top, ctx.P));
box("belt", [STUB.x0, STUB.y0, STUB.top - 0.6], [STUB.x1, STUB.y1 - 1.2, STUB.top], { tone: "mid" }, { r: 0.1, extra: ctx.Ln(slats.join(""), { tone: "faint" }) });
ctx.turned("stub.drum", G.frameOf(W([STUB.x0, STUB.y1, STUB.top - 2.4]), [1, 0, 0], [0, 1, 0], [0, 0, 1]), [[0, 2.4], [STUB.x1 - STUB.x0, 2.4]], { tone: "mid" }, { bevel: 0.2 });
ctx.slot("stub:top", { after: "stub.drum" });
ctx.data.stub = { x: O[0], y0: O[1] + STUB.y0 + 4, y1: O[1] + STUB.y1, z: STUB.top };

const STUB_LIVE = `
MACHINES.stub = (api) => {
  const g = api.slot("top");
  const { x, y0, y1, z } = api.data;
  const items = [];
  const SPEED = 20;
  return {
    accept(port, item) { items.push({ item, s: 0 }); },
    tick(dt) {
      const calm = api.calm();
      // distance travelled, not absolute y, decides the hand-off
      for (const it of items) it.s += calm ? 1e9 : SPEED * dt;
      for (let i = items.length - 1; i >= 0; i--) if (items[i].s >= y1 - y0) { const it = items.splice(i, 1)[0]; api.emit("out", it.item, [x, y1, z]); }
      g.innerHTML = items.map((it) => '<g opacity="' + api.smooth(0, 6, it.s).toFixed(3) + '">' + api.packetSvg(it.item.kind, [x, y0 + it.s, z]) + "</g>").join("");
    },
  };
};`;

page(ctx, {
  out: join(HERE, "crusher.html"),
  title: "Crusher",
  fig: "Part",
  hint: "a spent packet arrives every 2.4 s",
  readout: "disposed 0 · bin 0%",
  css: CSS,
  live: [LIVE, STUB_LIVE],
  boot: `FACTORY.define("crusher", MACHINES.crusher);
FACTORY.define("stub", MACHINES.stub);
FACTORY.link("stub", "out", "crusher", "in");
FACTORY.feed("stub", "in", 2.4, () => FACTORY.item("garbage"));
FACTORY.readout(() => { const s = FACTORY.machines.crusher.stats(); return "disposed " + s.count + " · bin " + Math.round(s.fill * 100) + "%" + (s.bin === "home" ? "" : " · emptying"); });`,
  caption:
    "The Disposer. Buffers and nodes the audio thread swaps out cannot be freed on the audio thread, so they ride belt C to this crusher and are destroyed off the audio thread: a photo-eye speeds up the drive, the toothed rollers squash the packet against a spring-loaded bearing, and the flakes fill a bin that is emptied when full.",
});
const broken = [...checkOrder(ctx, "crusher"), ...checkOrder(ctx, "stub", [["stub.drum", "@top"], ["@top", "stub.channel.r"]])];
if (broken.length) {
  console.error("painter order broken:\n  " + broken.join("\n  "));
  process.exitCode = 1;
} else console.log("order rules hold");
