// Standalone page for the conveyor kind: a single-sided belt (like belt B) feeds the audio belt, whose spent
// parcels drop onto a second single-sided belt (like belt C) that tips them into a bin.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scene, page, k, A, G } from "../../shared/kit.mjs";
import { build, LIVE } from "./conveyor.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));

// opts are relative to each belt's origin: inAt / outAt / readAt are distances along the belt, feedFrom an offset
const AUDIO = { id: "audio", type: "loop", axis: "x", dir: -1, length: 216, top: 92, drum: 15, inAt: 204, readAt: 100, drop: true };
const BELT_B = { id: "beltB", type: "top", axis: "y", dir: 1, length: 110, top: 124, inAt: 8, outAt: 110, feedFrom: [0, 8, 140] };
const BELT_C = { id: "beltC", type: "top", axis: "y", dir: 1, length: 90, top: 30, inAt: 22, outAt: 90 };
const BIN = { x: -141, y: 145, w: 22, d: 21, h: 9 };
const HOPPER = { x: 67.5, y: -48, w: 13, d: 12, z0: 134, z1: 152 };

const fit = [
  ...k.boxCorners({ x: -150, y: 54, w: 256, d: 52, r: 0 }, 0, 96),
  ...k.boxCorners({ x: 56, y: -58, w: 40, d: 126, r: 0 }, 0, 130),
  ...k.boxCorners({ x: 66, y: -50, w: 16, d: 16, r: 0 }, 130, 154),
  ...k.boxCorners({ x: -146, y: 44, w: 32, d: 124, r: 0 }, 0, 36),
];
const ctx = scene({ W: 860, H: 540, fit, pad: 22 });
build(ctx, [-130, 74, 0], AUDIO);
build(ctx, [74, -50, 0], BELT_B);
build(ctx, [-130, 52, 0], BELT_C);

// demo furniture: a feed hopper on two posts over belt B, and a bin under the end of belt C
{
  const { k: kk } = ctx;
  const H = HOPPER;
  const hplan = { x: H.x, y: H.y, w: H.w, d: H.d, r: 0.8 };
  ctx.slab("demo.hopper", hplan, H.z0, H.z1 - H.z0, { tone: "mid" }, { steps: 3, bevel: 0.4, inner: ctx.Ln(kk.sideSeam(hplan, H.z0 + 3, ctx.P, 3) + kk.sideSeam(hplan, H.z1 - 3, ctx.P, 3), { tone: "faint" }) });
  ctx.slab("demo.hopper.lip", { x: H.x - 1.4, y: H.y - 1.4, w: H.w + 2.8, d: H.d + 2.8, r: 1 }, H.z1, 1.2, { tone: "lo" }, { steps: 3 });
  const postX = [H.x - 12, H.x + H.w + 12];
  const py = H.y + H.d / 2;
  postX.forEach((x, i) => {
    ctx.cyl(`demo.hopper.post${i}`, x, py, 1.0, 1.2, H.z1 - 4 - 1.2, { tone: "mid" }, { steps: 18 });
    ctx.slab(`demo.hopper.foot${i}`, { x: x - 3, y: py - 3, w: 6, d: 6, r: 0.8 }, 0, 1.2, { tone: "lo" }, { steps: 3, extra: ctx.screws([[x - 2, py - 2], [x + 2, py + 2]], 1.2, { ring: 0.6, size: 0.35 }) });
    const a = i ? H.x + H.w : x + 1.0;
    const b = i ? x - 1.0 : H.x;
    ctx.box(`demo.hopper.arm${i}`, [Math.min(a, b), py - 1, H.z1 - 6], [Math.max(a, b), py + 1, H.z1 - 4], { tone: "lo" }, { r: 0.3 });
  });
  // bin: floor, an L of back walls (drawn before the parcels), front and right walls (after them)
  const B = BIN;
  const t = 1.2;
  ctx.box("bin.floor", [B.x, B.y, 0], [B.x + B.w, B.y + B.d, t], { tone: "lo" }, { r: 0.6 });
  const back = [[B.x, B.y], [B.x + B.w, B.y], [B.x + B.w, B.y + t], [B.x + t, B.y + t], [B.x + t, B.y + B.d - t], [B.x, B.y + B.d - t]];
  ctx.prism("bin.back", back, t, B.h - t, { tone: "mid" });
  ctx.box("bin.wallRight", [B.x + B.w - t, B.y + t, t], [B.x + B.w, B.y + B.d - t, B.h], { tone: "mid" }, { r: 0.3, extra: ctx.Dots([[B.x + B.w, B.y + 4, B.h - 2], [B.x + B.w, B.y + B.d - 4, B.h - 2]].map(ctx.at), { size: 0.45 }) });
  ctx.box("bin.wallFront", [B.x, B.y + B.d - t, t], [B.x + B.w, B.y + B.d, B.h], { tone: "mid" }, { r: 0.3, inner: ctx.Ln(kk.segment([B.x, B.y + B.d, B.h - 2.5], [B.x + B.w, B.y + B.d, B.h - 2.5], ctx.P), { tone: "faint" }) });
  ctx.slot("bin:items", { after: "bin.back" });
  ctx.data.bin = { x: B.x + B.w / 2, y: B.y + B.d / 2, z: t, w: B.w - 2 * t - 10, d: B.d - 2 * t - 8 };
}

const SINK = `
// the demo bin: a parcel tips off the end of belt C, falls in, rests, and fades as the next ones land
MACHINES.bin = (api) => {
  const g = api.slot("items");
  const D = api.data;
  const parts = [];
  let n = 0;
  return {
    accept(port, item, from) {
      if (api.calm()) return;
      delete item.v;
      const SPOTS = [[-4.8, -4.2], [4.8, 4.2], [4.8, -4.2], [-4.8, 4.2]];
      const [dx, dy] = SPOTS[n % 4];
      const spot = [D.x + dx, D.y + dy, D.z];
      n++;
      parts.push({ item, from, spot, tau: 0, age: 0 });
    },
    tick(dt) {
      if (api.calm()) return;
      const out = [];
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.tau = Math.min(1, p.tau + dt / 0.55);
        p.age += dt;
        const t = p.tau;
        // over the drum, then down: a quadratic curve with a horizontal start
        const c = [p.from[0], p.from[1] + 9, p.from[2] + 1];
        const pos = [0, 1, 2].map((d) => (1 - t) * (1 - t) * p.from[d] + 2 * (1 - t) * t * c[d] + t * t * p.spot[d]);
        const older = parts.length - 1 - i;
        if (older >= 3 && p.fade === undefined) p.fade = p.age;
        const alpha = p.fade === undefined ? 1 : Math.max(0, 1 - (p.age - p.fade) / 1.0);
        if (alpha <= 0) { parts.splice(i, 1); continue; }
        const svg = api.packetSvg(p.item.kind, pos);
        out.push({ key: pos[0] + pos[1] + pos[2], svg: alpha < 1 ? '<g opacity="' + alpha.toFixed(2) + '">' + svg + "</g>" : svg });
      }
      g.innerHTML = out.sort((a, b) => a.key - b.key).map((o) => o.svg).join("");
    },
  };
};`;

const boot = `
FACTORY.define("audio", MACHINES.conveyor);
FACTORY.define("beltB", MACHINES.conveyor);
FACTORY.define("beltC", MACHINES.conveyor);
FACTORY.define("bin", MACHINES.bin);
FACTORY.link("beltB", "out", "audio", "in");
FACTORY.link("audio", "drop", "beltC", "in");
FACTORY.link("beltC", "out", "bin", "in");
const MIX = ["control", "graph", "control", "data", "control", "graph", "garbage", "control", "data"];
let fed = 0;
FACTORY.feed("beltB", "in", 1.7, () => FACTORY.item(MIX[fed++ % MIX.length]), 0.3);
// live and true: one cleat gap passing the read point = one 128-frame quantum
FACTORY.readout(() => {
  const a = FACTORY.machines.audio;
  const s = a.stats();
  const q = a.quanta();
  return "q " + q.count + " · " + (1 / q.period).toFixed(2) + "/s · " + s.riding + " top · " + s.hanging + " hung · " + s.dropped + " out";
});`;

page(ctx, {
  out: join(HERE, "conveyor.html"),
  title: "Conveyors",
  fig: "Part",
  hint: "Belt → audio belt → belt",
  readout: "q 0",
  live: [LIVE, SINK],
  boot,
  caption: "Two conveyor variants. A single-sided belt (top run only, idlers between the rails, drive motor at the head) carries parcels to the audio belt: the render loop, a fast double-sided belt that never stops. Each cleat gap stands for one 128-frame render quantum (375 a second at 48 kHz; the readout counts them at the read lamp, about 200× slower). Parcels ride the top run, round the head drum, hang from cleats on the lower run, turn grey once the read head has passed and drop off at the head drum on their next lap.",
});
