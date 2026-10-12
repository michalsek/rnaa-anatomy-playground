// Standalone-only stand-ins for the scanner/elevator page: a short belt D between the ports and a bare-driver speaker
// under the elevator's spout. Not part of the assembly (the page uses the real conveyor for the audio belt).
import { k, G, A } from "../../shared/kit.mjs";

// belt D stand-in from the scanner's `out` (packet bottom centre on the lip) to the elevator's `in` (chute mouth)
export function buildBeltDStub(ctx, id = "beltD", from = [-107, 37, 24], to = [-107, -84, 24]) {
  const { P } = ctx;
  const n = (s) => `${id}.${s}`;
  const X = from[0], Y0 = to[1] + 1, Y1 = from[1] - 4, Z = from[2];
  ctx.material = "";
  for (const y of [Y1 - 6, Y1 - 46, Y1 - 86, Y0 + 7])
    for (const x of [X - 7.4, X + 6.4]) ctx.box(n("leg"), [x, y - 1, 0], [x + 1, y + 1, Z - 5], { tone: "lo" }, { r: 0.2 });
  ctx.box(n("rail"), [X - 7.4, Y0, Z - 5], [X - 6, Y1, Z], { tone: "mid" }, { r: 0.3 });
  ctx.box(n("belt"), [X - 6, Y0, Z - 1], [X + 6, Y1, Z], { tone: "mid" }, { r: 0.2, inner: "" });
  ctx.slot(`${id}:items`, { after: n("belt") });
  ctx.box(n("rail"), [X + 6, Y0, Z - 5], [X + 7.4, Y1, Z], { tone: "mid" }, { r: 0.3 });
  ctx.data[id] = { x: X, y0: Y0, y1: Y1, z: Z, speed: 20 };
}

export const BELTD_STUB_LIVE = `
MACHINES.beltDStub = (api) => {
  const D = api.data;
  const g = api.slot("items");
  const items = [0.25, 0.55, 0.85].map((f) => ({ item: api.item("audio"), y: D.y0 + (D.y1 - D.y0) * f }));
  return {
    accept(port, item, from) { items.push({ item, y: from ? from[1] : D.y1 }); },
    tick(dt) {
      if (!api.calm()) for (const it of items) it.y -= D.speed * dt;
      for (let i = items.length - 1; i >= 0; i--) if (items[i].y <= D.y0 + 2) { const [it] = items.splice(i, 1); api.emit("out", it.item, [D.x, it.y, D.z]); }
      g.innerHTML = items.slice().sort((a, b) => a.y - b.y).map((it) => api.packetSvg(it.item.kind, [D.x, it.y, D.z])).join("");
    },
  };
};`;

// A bare driver facing up (stamped basket, magnet, back plate, rim with bolt holes, surround and cone rings; the dust
// cap pumps per arrival), on a post, its cone centred under `port` (the elevator's down-spout).
export function buildSpeakerStub(ctx, id = "speaker", port = [-107, -172, 234]) {
  const { P, S, Ln, Dots } = ctx;
  const n = (s) => `${id}.${s}`;
  const [cx, cy] = port;
  const z0 = port[2] - 24;
  ctx.material = "";
  ctx.cyl(n("foot"), cx, cy, 7, 0, 1.6, { tone: "lo" }, { steps: 36, bevel: 0.3 });
  ctx.cyl(n("post"), cx, cy, 2.2, 1.6, z0 - 2.6, { tone: "mid" }, { steps: 20 });
  ctx.material = "fx-graphite";
  ctx.cyl(n("backplate"), cx, cy, 6.6, z0 - 1, 1, { tone: "mid" }, { steps: 36 });
  ctx.cyl(n("magnet"), cx, cy, 6, z0, 4.4, { tone: "mid" }, { steps: 36, inner: Ln(k.sideArc(cx, cy, 6, z0 + 2.2, P, 28), { tone: "faint" }) });
  ctx.material = "";
  const F = G.frameOf([cx, cy, z0 + 4.4], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  const ribs = G.ribsOf(F, 0.6, 7.6, 7.2, 8, P, { r1: 13.4, fade: [0.1, 0.55] });
  ctx.turned(n("basket"), F, [[0, 6.2], [0.6, 6.2], [7.6, 13.4], [7.6, 14.6], [8.8, 14.6]], { tone: "mid" }, { extra: k.fadedSvg(ribs, { tone: "lo" }) + ctx.Dots(G.dotsOf(F, 8.8, 13.9, 8, P, { all: true }), { size: 0.32 }) + Ln(G.circleOf(F, 8.8, 12.6, P) + G.circleOf(F, 8.8, 11, P) + G.circleOf(F, 8.8, 7.4, P) + G.circleOf(F, 8.8, 4.2, P), { tone: "lo" }) });
  ctx.slot(`${id}:cap`, { after: n("basket") });
  ctx.data[id] = { cap: [cx, cy, z0 + 4.4 + 8.8] };
}

export const SPEAKER_STUB_LIVE = `
MACHINES.speakerStub = (api) => {
  const D = api.data;
  const g = api.slot("cap");
  let hitAt = -9;
  const falling = [];
  const RIM = D.cap[2] - 1.6;
  // a packet's visible part above the cone (it drops into the cone and is cut there)
  const part = (kind, [x, y, z]) => {
    const lo = Math.max(z, RIM), hi = z + 7;
    if (hi - lo < 0.05) return "";
    return '<g class="pk" data-kind="' + kind + '">' + solidSvg(slabOf({ x: x - 4.6, y: y - 4, w: 9.2, d: 8, r: 0.6 }, lo, hi - lo, api.P, 2, 0.3), { tone: "hi" }) + '</g>';
  };
  const self = {
    received: 0,
    // falls from the spout (\`from\` = packet bottom centre) under gravity into the cone; the dust cap pumps on landing
    accept(port, item, from) { falling.push({ item, t0: api.now(), from: from || [D.cap[0], D.cap[1], D.cap[2] + 10] }); },
    tick(dt, t) {
      let html = "";
      for (let i = falling.length - 1; i >= 0; i--) {
        const f = falling[i], a = t - f.t0;
        const z = f.from[2] - 0.5 * 160 * a * a - 7 * 0.6 * a;
        if (z + 7 < RIM) { falling.splice(i, 1); self.received++; hitAt = t; continue; }
        html += part(f.item.kind, [f.from[0], f.from[1], z]);
      }
      const age = t - hitAt;
      const push = api.calm() ? 0 : api.smooth(0, 0.06, age) * Math.exp(-Math.max(0, age - 0.06) / 0.22) * 0.9;
      const F = G.frameOf([D.cap[0], D.cap[1], D.cap[2] - 0.6 + push], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
      g.innerHTML = '<g class="it fx-graphite">' + solidSvg(G.solidOf([[0, 4.2], [0.4, 4.2, 1], [1.1, 3.4, 1], [1.6, 2.1, 1], [1.8, 0]], F, api.P), { tone: "mid" }) + '</g>' + html;
    },
  };
  return self;
};`;
