// Standalone page: the packer with a stub of belt A delivering fluff and a stub of belt B taking packets away.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scene, page, k } from "../../shared/kit.mjs";
import { build, LIVE, CSS } from "./packer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const O = [0, 0, -120];
const w = (x, y, z) => [x + O[0], y + O[1], z + O[2]];

const fit = [
  ...k.boxCorners({ x: 34, y: -150, w: 98, d: 20, r: 0 }, 0, 0),
  ...k.boxCorners({ x: 70, y: -150, w: 60, d: 105, r: 0 }, 0, 0),
  w(34, -122, 236), w(72, -150, 236), w(84, -140, 258), w(130, -150, 236), w(130, -100, 236), [110, -44, 0], [100, -44, 44],
];
const ctx = scene({ W: 700, H: 760, fit, pad: 26 });

build(ctx, [100, -118, O[2]], { id: "packer", prefill: true, floor: -O[2] });

// ---- stub of belt A (along +x, top z 232) -----------------------------------------------------------
{
  const { k: K, P } = ctx;
  const y = -118;
  const top = 232 + O[2];
  ctx.material = "fx-graphite";
  for (const x of [41, 64]) {
    ctx.box("stubA.foot", [x - 3, y - 3.6, 0], [x + 3, y + 3.6, 1.2], { tone: "lo" }, { r: 0.6 });
    ctx.box("stubA.leg", [x - 1.4, y - 1.4, 1.2], [x + 1.4, y + 1.4, top - 8], { tone: "mid" }, { r: 0.3 });
  }
  ctx.box("stubA.cross", [36, y - 4.6, top - 8], [71, y + 4.6, top - 7], { tone: "mid" }, { r: 0.4 });
  ctx.material = "";
  for (const s of [-1, 1]) ctx.box("stubA.channel", [36, y + s * 4.6 - (s > 0 ? 1 : 0), top - 7], [71, y + s * 4.6 + (s < 0 ? 1 : 0), top - 1], { tone: "mid" }, { r: 0.2, inner: ctx.Ln(K.sideSeam({ x: 36, y: y + s * 4.6 - (s > 0 ? 1 : 0), w: 35, d: 1, r: 0.2 }, top - 3.5, P, 2), { tone: "faint" }) });
  for (const x of [41, 68]) ctx.turned("stubA.drum", ctx.G.frameAlong([x, y - 3.6, top - 3.6], [0, 1, 0]), [[0, 3], [7.2, 3]], { tone: "hi" });
  ctx.box("stubA.belt", [41, y - 3.4, top - 0.6], [68, y + 3.4, top], { tone: "lo" }, { r: 0 });
  ctx.slot("stubA:beads", { after: "stubA.belt" });
  ctx.data.stubA = { y, top, x0: 42, x1: 69 };
}

// ---- stub of belt B (along +y, top z 192) and a tote at its end -------------------------------------
{
  const { k: K, P } = ctx;
  const x = 100;
  const top = 192 + O[2];
  ctx.material = "fx-graphite";
  for (const yy of [-86, -66]) {
    ctx.box("stubB.foot", [x - 3.6, yy - 3, 0], [x + 3.6, yy + 3, 1.2], { tone: "lo" }, { r: 0.6 });
    ctx.box("stubB.leg", [x - 1.4, yy - 1.4, 1.2], [x + 1.4, yy + 1.4, top - 8], { tone: "mid" }, { r: 0.3 });
  }
  ctx.box("stubB.cross", [x - 6.6, -94, top - 8], [x + 6.6, -60, top - 7], { tone: "mid" }, { r: 0.4 });
  ctx.material = "";
  for (const s of [-1, 1]) ctx.box("stubB.channel", [x + s * 6.6 - (s > 0 ? 1 : 0), -94, top - 7], [x + s * 6.6 + (s < 0 ? 1 : 0), -60, top - 1], { tone: "mid" }, { r: 0.2 });
  for (const yy of [-91, -63]) ctx.turned("stubB.drum", ctx.G.frameAlong([x - 5.6, yy, top - 3.6], [1, 0, 0]), [[0, 3], [11.2, 3]], { tone: "hi" });
  ctx.box("stubB.belt", [x - 5.4, -91, top - 0.6], [x + 5.4, -63, top], { tone: "lo" }, { r: 0 });
  ctx.slot("stubB:packets", { after: "stubB.belt" });
  // tote on a low stand past the belt end
  ctx.box("stubB.toteStand", [x - 8, -60, 0], [x + 8, -46, 30], { tone: "mid" }, { r: 0.8, bevel: 0.4, inner: ctx.Ln(K.sideSeam({ x: x - 8, y: -60, w: 16, d: 14, r: 0.8 }, 26, P, 4), { tone: "faint" }) });
  ctx.box("stubB.toteBack", [x - 7.5, -59.5, 30], [x + 7.5, -58.9, 44], { tone: "mid" }, { r: 0.1 });
  ctx.box("stubB.toteLeft", [x - 7.5, -58.9, 30], [x - 6.9, -46.5, 44], { tone: "mid" }, { r: 0.1 });
  ctx.box("stubB.toteFloor", [x - 6.9, -58.9, 30], [x + 7.5, -46.5, 31], { tone: "lo" }, { r: 0 });
  ctx.slot("stubB:tote", { after: "stubB.toteFloor" });
  ctx.box("stubB.toteRight", [x + 6.9, -58.9, 31], [x + 7.5, -47.1, 44], { tone: "mid" }, { r: 0.1 });
  ctx.box("stubB.toteFront", [x - 6.9, -47.1, 31], [x + 7.5, -46.5, 44], { tone: "mid" }, { r: 0.1 });
  ctx.data.stubB = { x, top, y0: -94, y1: -61, tote: [x, -53, 31] };
}

const STUBS = `
MACHINES.stubA = (api) => {
  const D = api.data;
  const beads = [];
  const g = api.slot("beads");
  return {
    accept(port, item) { if (!api.calm()) beads.push({ item, x: D.x0 }); },
    tick(dt, t) {
      if (api.calm()) return;
      for (const b of beads) b.x += dt * 13;
      while (beads.length && beads[0].x >= D.x1) {
        const b = beads.shift();
        api.emit("out", b.item, [D.x1, D.y, D.top]);
      }
      g.innerHTML = beads.map((b) => api.fluffSvg([Math.min(b.x, D.x1), D.y, D.top], 2.4)).join("");
    },
  };
};
MACHINES.stubB = (api) => {
  const D = api.data;
  const items = [];
  const g = api.slot("packets");
  const tote = api.slot("tote");
  return {
    accept(port, item, from) { items.push({ item, p: [from[0], from[1], from[2]], v: item.v ? -item.v[2] : 0, vy: item.v ? item.v[1] : 0, phase: "fall" }); },
    tick(dt) {
      if (api.calm()) return;
      for (const it of items) {
        if (it.phase === "fall") {
          it.v += 120 * dt;
          it.p[2] -= it.v * dt;
          it.p[1] += it.vy * dt;
          if (it.p[2] <= D.top) { it.p[2] = D.top; it.phase = "ride"; it.v = 0; }
        } else if (it.phase === "ride") {
          it.p[1] += 10 * dt;
          if (it.p[1] >= D.y1) it.phase = "drop";
        } else if (it.phase === "drop") {
          it.v += 120 * dt;
          it.p[2] -= it.v * dt;
          it.p[1] = Math.min(D.tote[1], it.p[1] + 9 * dt);
          if (it.p[2] <= D.tote[2]) it.phase = "gone";
        }
      }
      for (let i = items.length - 1; i >= 0; i--) if (items[i].phase === "gone") items.splice(i, 1);
      g.innerHTML = items.filter((it) => it.phase !== "drop").map((it) => api.packetSvg(it.item.kind, it.p)).join("");
      tote.innerHTML = items.filter((it) => it.phase === "drop").map((it) => api.packetSvg(it.item.kind, it.p)).join("");
    },
  };
};`;

page(ctx, {
  out: join(HERE, "packer.html"),
  title: "Packer",
  fig: "Part",
  hint: "Fluff in from belt A · packets out onto belt B",
  readout: "beads 0 · packets 0 · next control",
  live: [LIVE, STUBS],
  css: CSS,
  boot: `FACTORY.define("packer", MACHINES.packer);
FACTORY.define("stubA", MACHINES.stubA);
FACTORY.define("stubB", MACHINES.stubB);
FACTORY.link("stubA", "out", "packer", "in");
FACTORY.link("packer", "out", "stubB", "in");
FACTORY.feed("stubA", "in", 0.9, () => FACTORY.item("fluff"), 0.1);
FACTORY.readout(() => { const s = FACTORY.machines.packer.stats(); return "beads " + s.beads + " · packets " + s.packets + " · next " + s.next; });`,
  caption: "The packer: loose JS calls (fluff) arrive from belt A, a picker arm boxes three at a time into a carton, the folder arm closes and tapes it, and the finished packet (blue control, amber graph, white data) drops onto belt B.",
});
