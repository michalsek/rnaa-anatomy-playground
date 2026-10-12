// v3 copy of v2-factory/parts/centrifuge/build.mjs: the original writes its page at import, so it is copied here and
// wrapped in run({ out }). The only edits: the imports point at the read-only v2 modules (HERE dropped), STUB_LIVE is
// hoisted above run(), the scene body is indented into run() and ends with `return ctx`, and page() writes to `out`.
// tools/gate.mjs ("scene copy matches v2") diffs the two files modulo exactly these edits.
// Standalone page for the centrifuge: a stub of belt B above feeds it packets, a stub of the audio belt below
// catches the releases and gives the centrifuge its slat phase through syncTo().
import { scene, page, k, G, A } from "../../v2-factory/shared/kit.mjs";
import { build, LIVE, CSS } from "../../v2-factory/parts/centrifuge/centrifuge.mjs";

// v2 source of this copy (relative to this file), for the gate's drift check
export const V2_SOURCE = "../../v2-factory/parts/centrifuge/build.mjs";

// What the gate expects from this scene's export: the exporter census (every key of build-dl CENSUS_KEYS) and the
// DL counts. After an intended scene or kit change, run `node export/export.mjs`, check the printed census and counts
// against the figure (and notes/ROADMAP.md), then copy them here.
export const EXPECTED = {
  census: { fillPaths: 1136, fillSubpaths: 1956, fillRingVerts: 31191, multiSubpath: 379, mixedOrientation: 11, nonSimpleFills: 93, earcut: 737, libtess: 397, emptyFills: 2, strokeElements: 610, strokePaths: 525, polylines: 1025, pathSegments: 15182, closedPolylines: 90, dotCircles: 209, dotGroups: 37, opacityGroups: 3, seamlessSolids: 17, halos: 1, blends: 0 },
  counts: { items: 240, slots: 15, gradients: 1 },
};

const STUB_LIVE = `
MACHINES.stubFeed = (api) => {
  const D = api.data;
  const items = [];
  const g = api.slot("feed");
  const next = () => FACTORY.machines.centrifuge;
  return {
    accept(port, item) { if (item) items.push({ item, y: D.y0 }); },
    tick(dt, t) {
      // backpressure: the front parcel waits at the roller while the centrifuge's throat is full
      let limit = D.y1;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        it.y = api.calm() ? limit : Math.min(it.y + D.speed * dt, limit);
        limit = it.y - 11;
      }
      if (items.length && items[0].y >= D.y1 && next().canAccept()) api.emit("out", items.shift().item, [D.x, D.y1, D.z]);
      g.innerHTML = items.map((it) => api.packetSvg(it.item.kind, [D.x, it.y, D.top])).join("");
    },
  };
};
MACHINES.stubBelt = (api) => {
  const D = api.data;
  const g = api.slot("belt");
  const speed = D.pitch / D.period;
  const items = [];
  let clock = 0;
  const along = () => clock * speed;
  return {
    quanta() { return { phase: ((((along() - (D.x1 - D.port)) / D.pitch + 0.5) % 1) + 1) % 1, period: D.period }; },
    accept(port, item, from) {
      const v = item.v ?? [0, 0, 0];
      delete item.v;
      items.push({ item, p: (from ?? [D.port, D.y, D.top + 4]).slice(), v: v.slice(), landed: false });
    },
    tick(dt, t) {
      const calm = api.calm();
      if (!calm) clock += dt;
      const parts = [];
      const len = D.x1 - D.x0 - 2;
      for (let j = 0; j * D.pitch < len + D.pitch; j++) {
        const x = D.x1 - 1 - (((along() + j * D.pitch) % len) + len) % len;
        const plan = { x: x - 0.8, y: D.y - 7.6, w: 1.6, d: 15.2, r: 0.3 };
        parts.push({ x, svg: solidSvg(slabOf(plan, D.slat, 0.6, api.P, 2), { tone: "lo" }) });
      }
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (calm) {
          // reduced motion: shown where it lands, then gone
          it.p = [D.port, D.y, D.top];
          it.shown = (it.shown ?? 0) + dt;
          if (it.shown > 1.2 || i < items.length - 1) { items.splice(i, 1); continue; }
        } else if (!it.landed) {
          it.v[2] -= 400 * dt;
          for (const a of [0, 1, 2]) it.p[a] += it.v[a] * dt;
          if (it.p[2] <= D.top) { it.p[2] = D.top; it.landed = true; it.v = [-speed, 0, 0]; }
        } else if (it.p[0] > D.x0 - 1) {
          it.p[0] -= speed * dt;
          it.p[1] += (D.y - it.p[1]) * Math.min(1, dt * 8);
        } else {
          // off the end roller
          it.v[2] -= 400 * dt;
          it.p[0] += it.v[0] * dt;
          it.p[2] += it.v[2] * dt;
          if (it.p[2] < D.top - 16) { items.splice(i, 1); continue; }
        }
        parts.push({ x: it.p[0] + 0.5, svg: api.packetSvg(it.item.kind, it.p) });
      }
      parts.sort((a, b) => a.x - b.x);
      g.innerHTML = parts.map((p) => p.svg).join("");
    },
  };
};`;

// run({ out }) → ctx after the real page(): items settled and sorted, slots listed, out + its -light twin written.
export function run({ out }) {
  const ctx = scene({
    W: 640,
    H: 760,
    pad: 30,
    fit: [
      [18, 60, 0], [18, 90, 0], [160, 40, 0], [160, 100, 0], [92, -40, 0], [108, -40, 0],
      [92, -40, 196], [108, 24, 196], [146, 66, 184], [100, 41, 188], [60, 100, 0], [18, 128, 0], [112, 128, 0], [162, 60, 0],
    ],
  });
  build(ctx, [100, 66, 0], { id: "centrifuge" });

  // ---------- stub feeder: the end of belt B, along +y at x = 100, top z 192, on two columns ----------
  const FEED = { x: 100, y0: -34, y1: 24, z: 192 };
  {
    const S = ctx.S;
    for (const x of [92.5, 107.5]) {
      ctx.cyl("stub.feed.foot", x, -28, 3.6, 0, 1.4, { tone: "lo" }, { steps: 20 });
      ctx.box("stub.feed.column", [x - 1.5, -29.5, 1.4], [x + 1.5, -26.5, 188], { tone: "mid" }, { r: 0.4, bevel: 0.3 });
    }
    ctx.box("stub.feed.brace", [94, -29, 110], [106, -27, 113], { tone: "mid" }, { r: 0.3 });
    ctx.box("stub.feed.bed", [91, -34, 188], [109, FEED.y1 - 3, 191.4], { tone: "mid" }, { r: 0.6, bevel: 0.3 });
    for (const x of [91, 107]) ctx.box("stub.feed.rail", [x, -34, 191.4], [x + 2, FEED.y1 - 0.5, 194.6], { tone: "mid" }, { r: 0.4, bevel: 0.3 });
    const F = G.frameOf([91, FEED.y1 - 0.5, 188.9], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    ctx.turned("stub.feed.roller", F, [[0, 2.5], [18, 2.5]], { tone: "mid" }, { bevel: 0.2 });
    ctx.slot("stubFeed:feed", { after: "stub.feed.bed" });
    ctx.data.stubFeed = { ...FEED, speed: 30, top: 191.4 };
  }

  // ---------- stub audio belt: along −x under the centrifuge's spout, slats on top, top z 92 ----------
  const OUT = ctx.data.centrifuge.ports.out;
  const BELT = { x0: 22, x1: Math.round(OUT[0] + 14), y: OUT[1], top: 92, pitch: 12 };
  {
    const y0 = BELT.y - 8;
    const y1 = BELT.y + 8;
    for (const x of [34, 64, BELT.x1 - 8])
      for (const y of [y0 + 1, y1 - 1]) {
        ctx.cyl("stub.belt.foot", x, y, 2.6, 0, 1.2, { tone: "lo" }, { steps: 18 });
        ctx.box("stub.belt.leg", [x - 1.2, y - 1.2, 1.2], [x + 1.2, y + 1.2, 87], { tone: "mid" }, { r: 0.3 });
      }
    ctx.box("stub.belt.brace", [35.2, y0 - 0.2, 30], [62.8, y0 + 1.8, 33], { tone: "mid" }, { r: 0.3 });
    ctx.box("stub.belt.bed", [BELT.x0, y0, 87], [BELT.x1, y1, 91.4], { tone: "mid" }, { r: 0.6, bevel: 0.3 });
    for (const y of [y0 - 2.2, y1]) ctx.box("stub.belt.rail", [BELT.x0 + 3, y, 87], [BELT.x1, y + 2.2, 94.4], { tone: "mid" }, { r: 0.4, bevel: 0.3 });
    const F = G.frameOf([BELT.x0 - 2.4, y0 - 2.2, 89], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
    ctx.turned("stub.belt.roller", F, [[0, 2.4], [20.4, 2.4]], { tone: "mid" }, { bevel: 0.2 });
    ctx.slot("stubBelt:belt", { after: "stub.belt.bed" });
    ctx.data.stubBelt = { ...BELT, port: OUT[0], period: 0.42, slat: 91.4 };
  }


  const kinds = ["control", "control", "graph", "data", "control", "graph", "control", "data", null, null, null, null, null];
  page(ctx, {
    out,
    title: "Centrifuge",
    fig: "Part",
    hint: "fills · spins up · drains one per quantum",
    readout: "held 0/10 · 0.0 rpm",
    css: CSS,
    live: [LIVE, STUB_LIVE],
    boot: `
window.FACTORY = FACTORY;
FACTORY.define("centrifuge", MACHINES.centrifuge);
FACTORY.define("stubFeed", MACHINES.stubFeed);
FACTORY.define("stubBelt", MACHINES.stubBelt);
FACTORY.link("stubFeed", "out", "centrifuge", "in");
FACTORY.link("centrifuge", "out", "stubBelt", "in");
FACTORY.machines.centrifuge.syncTo(() => FACTORY.machines.stubBelt.quanta());
let n = 0;
const KINDS = ${JSON.stringify(kinds)};
FACTORY.feed("stubFeed", "in", 0.9, () => { const kind = KINDS[n++ % KINDS.length]; return kind && FACTORY.item(kind); });
FACTORY.readout(() => {
  const s = FACTORY.machines.centrifuge.status();
  return "held " + s.held + "/10 · " + s.rpm.toFixed(1) + " rpm · " + s.phase;
});`,
    caption:
      "The lock-free ring between JS and the audio thread. Packets (fixed-size closures: blue control events, amber graph changes, white data hand-overs) drop into the pockets one at a time; nothing waits on a lock, and when the throat is full the belt above holds back. Once enough are held the rotor spins up until one pocket passes the gate per cleat gap of the audio belt (one 128-frame render quantum), and each quantum drains one packet down the spout. The real rings hold 1,024 slots.",
    audit: {},
  });
  return ctx;
}
