// Elevator: a bucket elevator, the vertical hero. Mint `audio` packets (finished device buffers) slide down the in-feed
// chute into the boot, ride the front run up on cradles fixed to a twin roller chain, go over the head sprocket inside
// the head and are flung into a discharge hopper, whose duct and down-spout drop them into the speaker. Empty cradles
// return down the back. Local frame: `origin` is the centre of the tower's column on the floor (see NOTES.md);
// opts.lift sets the height (discharge port = foot + lift), opts.outDir / opts.outReach place the spout, and
// opts.access = false leaves off the ladder, cage, landings and side bracing so the mechanism shows.
import { k, G, A } from "../../shared/kit.mjs";
import { bar, slabAlong, faceScrews, pulseCable } from "./helpers.mjs";

// Internally the geometry is written in a design frame whose column centre is REF; build() shifts it onto `origin`.
const REF = [-107, -123, 0];
export const GEOMETRY = {
  zb: 26, r: 13.5, yc: -123,
  zBootTop: 42,
  posts: { x: [-116.7, -97.3], y: [-132.7, -113.3], half: 1.3 },
  strands: [-112, -102],
  speed: 30,
  in: [-107, -84, 24],
};

export function build(ctx, origin = REF, opts = {}) {
  const id = opts.id ?? "elevator";
  const [ox, oy, oz] = [origin[0] - REF[0], origin[1] - REF[1], origin[2] - REF[2]];
  const LIFT = opts.lift ?? 210;
  const OUT_DIR = opts.outDir ?? "-y";
  const OUT_REACH = opts.outReach ?? 14;
  const ACCESS = opts.access ?? true;
  const { P, S, Ln, Dots } = ctx;
  const n = (s) => `${id}.${s}`;
  const W = (x, y, z) => [x + ox, y + oy, z + oz];
  const box = (name, a, b, style = {}, o = {}) => ctx.box(n(name), W(...a), W(...b), { tone: "mid", ...style }, { r: 0.3, ...o });
  const plan = (x0, y0, x1, y1, r = 0.4) => ({ x: x0 + ox, y: y0 + oy, w: x1 - x0, d: y1 - y0, r });
  const g = GEOMETRY;
  const { zb: ZB, r: R, yc: YC } = g;
  const ZH = g.in[2] + LIFT + 7.5;
  const YF = YC + R, YB = YC - R;
  const ZBT = g.zBootTop, ZHB = ZH - 24, ZPT = ZH - 28;
  const levels = [];
  for (let L = 44; L <= ZH - 32; L += 36) levels.push(L);
  const landings = [], splices = [];
  for (let i = 0; i < levels.length - 1; i++) {
    const mid = levels[i] + 18;
    if (i % 3 === 2 && mid < ZHB - 40) landings.push(mid);
    else if (i % 3 === 1) splices.push(mid);
  }
  const total = 2 * (ZH - ZB) + 2 * Math.PI * R;
  const COUNT = Math.max(8, Math.round(total / 38));
  const [PXL, PXR] = g.posts.x, [PYB, PYF] = g.posts.y, PH = g.posts.half;
  const poly2 = (list) => k.pathOf(list.map((p) => ctx.at(W(...p))), true);

  // ================= boot: housing, top flange with the two run slots, door, feed opening, take-up
  ctx.material = "";
  const feedHole = [[-113, -97, 24.2], [-101, -97, 24.2], [-101, -97, 33], [-113, -97, 33]];
  box("boot.housing", [-114.5, -149, 0], [-99.5, -97, 40], {}, {
    r: 0.6, bevel: 0.4, steps: 3,
    inner: Ln(k.sideSeam(plan(-114.5, -149, -99.5, -97, 0.6), 4 + oz, P, 3), { tone: "faint" }),
    extra: `<path d="${poly2(feedHole)}" style="fill:var(--anatomy-mid);opacity:.5"/>` + Ln(poly2(feedHole), { tone: "lo" }),
  });
  const slotF = [[-113, -110.6, 42], [-101, -110.6, 42], [-101, -97.8, 42], [-113, -97.8, 42]];
  const slotB = [[-113, -147.6, 42], [-101, -147.6, 42], [-101, -135.4, 42], [-113, -135.4, 42]];
  const FL = plan(-115, -149.5, -99, -96.5, 0.8);
  ctx.slab(n("boot.flange"), FL, 40 + oz, 2, { tone: "mid" }, { steps: 3, bevel: 0.3, extra: `<path d="${poly2(slotF) + poly2(slotB)}" style="fill:var(--anatomy-mid);opacity:.5"/>` + Ln(poly2(slotF) + poly2(slotB), { tone: "lo" }) + ctx.screws([[-114, -148.5], [-100, -148.5], [-114, -97.5], [-100, -97.5], [-114, -123], [-100, -123]].map(([x, y]) => [x + ox, y + oy]), 42 + oz, { ring: 0.5, size: 0.3 }) });
  ctx.slot(`${id}:back`, { after: n("boot.flange") });
  box("boot.door", [-112, -97, 4], [-102, -96.4, 18], { tone: "mid" }, { r: 0.4, bevel: 0.2, extra: faceScrews(ctx, [W(-111, -96.4, 5.2), W(-103, -96.4, 5.2), W(-111, -96.4, 16.8), W(-103, -96.4, 16.8)], "y", { ring: 0.5, size: 0.3 }) });
  box("boot.handle", [-108.5, -96.4, 10.4], [-105.5, -95.2, 11.6], { tone: "hi" }, { r: 0.3 });
  // in-feed chute from belt D into the feed opening, on a leg
  box("feed.leg", [-108, -86, 0], [-106, -84, 22.8], { tone: "lo" });
  box("feed.floor", [-113.5, -97, 22.8], [-100.5, -83, 24], { tone: "mid" });
  box("feed.wallL", [-114.5, -97, 22.8], [-113.5, -83, 27.5], { tone: "mid" });
  ctx.slot(`${id}:feed`, { before: n("feed.wallR") });
  box("feed.wallR", [-100.5, -97, 22.8], [-99.5, -83, 27.5], { tone: "mid" }, { bevel: 0.2 });
  // take-up on the +x wall: guide bars, slide block carrying the boot bearing, screw rod and jam nut
  box("takeup.bottom", [-99.5, -128.5, 14], [-97.5, -117.5, 16]);
  box("takeup.guide", [-99.5, -128.5, 16], [-97.5, -127, 34]);
  box("takeup.guide", [-99.5, -119, 16], [-97.5, -117.5, 34]);
  box("takeup.top", [-99.5, -128.5, 34], [-97.5, -117.5, 36], {}, { extra: ctx.screws([[-98.5 + ox, -127.8 + oy], [-98.5 + ox, -118.2 + oy]], 36 + oz, { ring: 0.45, size: 0.28 }) });
  box("takeup.slide", [-99.5, -127, 22], [-97, -119, 30], { tone: "mid" }, { bevel: 0.2 });
  ctx.cyl(n("takeup.rod"), -98.25 + ox, -123 + oy, 0.6, 30 + oz, 1, { tone: "mid" }, { steps: 12 });
  ctx.cyl(n("takeup.rod"), -98.25 + ox, -123 + oy, 0.6, 32.2 + oz, 1.8, { tone: "mid" }, { steps: 12 });
  ctx.cyl(n("takeup.nut"), -98.25 + ox, -123 + oy, 1.2, 31 + oz, 1.2, { tone: "mid" }, { steps: 6 });
  {
    const F = G.frameAlong(W(-97, -123, ZB), [1, 0, 0]);
    ctx.turned(n("boot.bearing"), F, [[0, 2.7], [0.8, 2.7], [0.8, 2.1], [1.6, 2.1]], { tone: "mid" }, { extra: Dots(G.dotsOf(F, 0.8, 2.4, 6, P, { all: true }), { size: 0.28 }) });
    ctx.turned(n("boot.shaft"), G.frameAlong(W(-95.4, -123, ZB), [1, 0, 0]), [[0, 1.4], [1.2, 1.4]], { tone: "hi" }, { bevel: 0.2 });
  }

  // ================= tower: posts on base plates, girts, splice plates, gussets and diagonal braces
  for (const x of [PXL, PXR])
    for (const y of [PYB, PYF]) {
      const bx = x < -107 ? [-121, -115.4] : [-98.6, -93];
      box("post.base", [bx[0], y - 3, 0], [bx[1], y + 3, 1.5], { tone: "lo" }, { extra: ctx.screws([[(x < -107 ? bx[0] + 1.3 : bx[1] - 1.3) + ox, y - 1.8 + oy], [(x < -107 ? bx[0] + 1.3 : bx[1] - 1.3) + ox, y + 1.8 + oy]], 1.5 + oz, { ring: 0.55, size: 0.32 }) });
      box("post", [x - PH, y - PH, 1.5], [x + PH, y + PH, ZH + 22], { tone: "mid" }, { bevel: 0.2, inner: Ln(splices.map((z) => k.sideSeam(plan(x - PH, y - PH, x + PH, y + PH, 0.3), z + oz, P, 3)).join(""), { tone: "faint" }) });
    }
  // splice plates on the visible faces (front posts +y face, right posts +x face)
  for (const z of splices) {
    for (const x of [PXL, PXR]) box("splice", [x - PH, PYF + PH, z - 4], [x + PH, PYF + PH + 0.5, z + 4], { tone: "mid" }, { extra: faceScrews(ctx, [W(x, PYF + PH + 0.5, z - 2.6), W(x, PYF + PH + 0.5, z + 2.6)], "y", { ring: 0.45, size: 0.28 }) });
    for (const y of [PYB]) box("splice", [PXR + PH, y - PH, z - 4], [PXR + PH + 0.5, y + PH, z + 4], { tone: "mid" }, { extra: faceScrews(ctx, [W(PXR + PH + 0.5, y, z - 2.6), W(PXR + PH + 0.5, y, z + 2.6)], "x", { ring: 0.45, size: 0.28 }) });
  }
  for (const L of levels) {
    box("girt.front", [PXL + PH, PYF - 0.8, L - 1], [PXR - PH, PYF + 0.8, L + 1]);
    box("girt.back", [PXL + PH, PYB - PH, L - 1], [PXR - PH, PYB - PH + 1.6, L + 1]);
    box("girt.left", [PXL - PH, PYB + PH, L - 1], [PXL - PH + 1.6, PYF - PH, L + 1]);
    box("girt.right", [PXR + PH - 1.6, PYB + PH, L - 1], [PXR + PH, PYF - PH, L + 1]);
  }
  // gussets at every girt joint on the two side faces, diagonals alternating bay by bay
  for (const [face, xo, sign] of [["right", PXR + PH, 1], ["left", PXL - PH, -1]]) {
    for (const L of levels) {
      for (const [y0, y1] of [[PYB - PH, -127.8], [-118.2, PYF + PH]]) {
        const a = sign > 0 ? [xo, y0, L - 3.4] : [xo - 0.6, y0, L - 3.4];
        const b = sign > 0 ? [xo + 0.6, y1, L + 3.4] : [xo, y1, L + 3.4];
        const ym = (y0 + y1) / 2;
        const bolts = sign > 0 ? faceScrews(ctx, [[-1.6, -1.8], [1.6, -1.8], [-1.6, 1.8], [1.6, 1.8]].map(([dy, dz]) => W(xo + 0.6, ym + dy, L + dz)), "x", { ring: 0.42, size: 0.26 }) : "";
        box(`gusset.${face}`, a, b, { tone: "mid" }, { r: 0.2, extra: bolts });
      }
    }
    for (let i = 0; ACCESS && i < levels.length - 1; i++) {
      const L = levels[i], U = levels[i + 1];
      const yA = i % 2 ? -115.6 : -130.4, yB = i % 2 ? -130.4 : -115.6;
      const xb = xo + sign * 1.0;
      bar(ctx, n(`brace.${face}`), W(xb, yA, L + 1.8), W(xb, yB, U - 1.8), 1.6, 0.8, { tone: "mid" }, { u: [0, 1, 0] });
    }
  }

  // ================= chain: guide channels and link strands, front run and back run (pins are live)
  for (const x of g.strands) {
    box("chain.channel.front", [x - 1.4, PYF + 0.8, ZBT], [x + 1.4, YF - 0.7, ZH - 8], { tone: "mid" });
    box("chain.front", [x - 0.6, YF - 0.7, ZBT], [x + 0.6, YF + 0.7, ZH], { tone: "lo" }, { r: 0.2 });
    box("chain.channel.back", [x - 1.4, YB + 0.7, ZBT], [x + 1.4, PYB - PH, ZH - 8], { tone: "mid" });
    box("chain.back", [x - 0.6, YB - 0.7, ZBT], [x + 0.6, YB + 0.7, ZH], { tone: "lo" }, { r: 0.2 });
  }

  // ================= head: open frame on the posts, head sprocket with hub flanges and chain wraps, funnel + throat
  const ZTOP = ZH + 22;
  box("head.ring", [PXL - PH, PYB + PH, ZPT], [PXL + PH, PYF - PH, ZHB]);
  box("head.ring", [PXR - PH, PYB + PH, ZPT], [PXR + PH, PYF - PH, ZHB]);
  box("head.ring", [PXL + PH, PYB - PH, ZPT], [PXR - PH, PYB + PH, ZHB]);
  box("head.ring", [PXL + PH, PYF - PH, ZPT], [PXR - PH, PYF + 0.8, ZHB]);
  for (const x of [PXL, PXR]) {
    box("head.beam", [x - PH, PYB + PH, ZH - 6], [x + PH, PYF - PH, ZH - 3.5]);
    box("head.pillow", [x - PH, -126.5, ZH - 3.5], [x + PH, -119.5, ZH + 3.6], {}, { bevel: 0.2, extra: ctx.screws([[x + ox, -125.6 + oy], [x + ox, -120.4 + oy]], ZH + 3.6 + oz, { ring: 0.45, size: 0.28 }) + (x > -107 ? Ln(k.sideRing(W(x + PH, YC, ZH), 2.2, "x", P, 20), { tone: "lo" }) : "") });
    box("head.top", [x - PH, PYB + PH, ZTOP - 2], [x + PH, PYF - PH, ZTOP]);
  }
  const AX = (x0, x1, r, name, style = { tone: "mid" }, opts = {}) => ctx.disc(n(name), G.frameAlong(W(x0, YC, ZH), [1, 0, 0]), 0, x1 - x0, r, style, opts);
  AX(-119.6, PXL - PH, 1.5, "head.shaft", { tone: "hi" }, { bevel: 0.2 });
  AX(PXL + PH, -114.1, 1.5, "head.shaft", { tone: "hi" });
  AX(-114.1, -112.7, 5, "head.flange");
  {
    const F = G.frameAlong(W(-112.7, YC, ZH), [1, 0, 0]);
    ctx.disc(n("head.sprocket"), F, 0, 1.4, 12.4, { tone: "mid" }, { extra: k.fadedSvg(G.ribsOf(F, 0, 1.4, 12.4, 30, P, { fade: [0.1, 0.55] }), { tone: "lo" }) });
  }
  AX(-111.3, -102.7, 3.4, "head.hub", { tone: "mid" });
  {
    const F = G.frameAlong(W(-102.7, YC, ZH), [1, 0, 0]);
    ctx.disc(n("head.sprocketR"), F, 0, 1.4, 12.4, { tone: "mid" }, { extra: k.fadedSvg(G.ribsOf(F, 0, 1.4, 12.4, 30, P, { fade: [0.1, 0.55] }), { tone: "lo" }) + Ln(G.circleOf(F, 1.4, 9.6, P) + G.circleOf(F, 1.4, 4.6, P), { tone: "faint" }) + Dots(G.dotsOf(F, 1.4, 7.1, 6, P, { all: true }), { size: 0.3 }) });
  }
  ctx.slot(`${id}:front`, { after: n("head.sprocketR") });
  {
    const F = G.frameAlong(W(-101.3, YC, ZH), [1, 0, 0]);
    ctx.disc(n("head.flangeR"), F, 0, 1.4, 5, { tone: "mid" }, { bevel: 0.2, extra: Dots(G.dotsOf(F, 1.4, 3.8, 6, P, { all: true }), { size: 0.3 }) });
  }
  AX(-99.9, PXR - PH, 1.5, "head.shaft", { tone: "hi" });
  AX(PXR + PH, -94.6, 1.5, "head.shaft", { tone: "hi" });
  // discharge: an open hopper behind the head (on two arms from the back posts), a short duct and a down-spout
  const HOP = { x0: -118, x1: -96, y0: -164, y1: -148, z0: ZH + 2, z1: ZH + 14 };
  for (const x of [PXL, PXR]) box("hopper.arm", [x - PH, HOP.y1, HOP.z0], [x + PH, PYB - PH, HOP.z0 + 2.4], { tone: "mid" });
  const RIM = HOP.z1 + 1.2;
  const mouth = [[HOP.x0 + 1.4, HOP.y0 + 1.4, RIM], [HOP.x1 - 1.4, HOP.y0 + 1.4, RIM], [HOP.x1 - 1.4, HOP.y1 - 1.4, RIM], [HOP.x0 + 1.4, HOP.y1 - 1.4, RIM]];
  box("hopper", [HOP.x0, HOP.y0, HOP.z0], [HOP.x1, HOP.y1, HOP.z1], { tone: "mid" }, { r: 0.6, bevel: 0.3, inner: Ln(k.sideSeam(plan(HOP.x0, HOP.y0, HOP.x1, HOP.y1, 0.6), HOP.z0 + 3 + oz, P, 3) + k.sideSeam(plan(HOP.x0, HOP.y0, HOP.x1, HOP.y1, 0.6), HOP.z0 + 7 + oz, P, 3), { tone: "faint" }) });
  const HFL = plan(HOP.x0 - 0.8, HOP.y0 - 0.8, HOP.x1 + 0.8, HOP.y1 + 0.8, 0.8);
  ctx.slab(n("hopper.flange"), HFL, HOP.z1 + oz, 1.2, { tone: "mid" }, { steps: 3, bevel: 0.2, extra: `<path d="${poly2(mouth)}" style="fill:var(--anatomy-mid);opacity:.5"/>` + Ln(poly2(mouth), { tone: "lo" }) + ctx.screws([[HOP.x0 - 0.1, HOP.y0 - 0.1], [HOP.x1 + 0.1, HOP.y0 - 0.1], [HOP.x0 - 0.1, HOP.y1 + 0.1], [HOP.x1 + 0.1, HOP.y1 + 0.1], [-107, HOP.y1 + 0.1], [-107, HOP.y0 - 0.1]].map(([x, y]) => [x + ox, y + oy]), RIM + oz, { ring: 0.4, size: 0.26 }) });
  const DZ = [HOP.z0, HOP.z0 + 8];
  let spout;
  if (OUT_REACH < 12) spout = [-107, (HOP.y0 + HOP.y1) / 2];
  // duct with a bolted flange plate where it meets the hopper
  const ductFlangeX = (x0, x1) => box("duct.flange", [x0, -163.5, DZ[0] - 1.5], [x1, -148.5, DZ[1] + 1.5], { tone: "mid" }, { r: 0.4, extra: faceScrews(ctx, [W(x1 > -107 ? x1 : x0, -162, DZ[0] - 0.4), W(x1 > -107 ? x1 : x0, -150, DZ[0] - 0.4), W(x1 > -107 ? x1 : x0, -162, DZ[1] + 0.4), W(x1 > -107 ? x1 : x0, -150, DZ[1] + 0.4)], "x", { ring: 0.35, size: 0.24 }) });
  if (OUT_REACH < 12) spout = [-107, (HOP.y0 + HOP.y1) / 2];
  else if (OUT_DIR === "-x") { ductFlangeX(HOP.x0 - 1, HOP.x0); box("duct", [HOP.x0 - OUT_REACH, -162, DZ[0]], [HOP.x0 - 1, -150, DZ[1]], { tone: "mid" }, { r: 0.5, bevel: 0.3 }); spout = [HOP.x0 - OUT_REACH + 7, -156]; }
  else if (OUT_DIR === "+x") { ductFlangeX(HOP.x1, HOP.x1 + 1); box("duct", [HOP.x1 + 1, -162, DZ[0]], [HOP.x1 + OUT_REACH, -150, DZ[1]], { tone: "mid" }, { r: 0.5, bevel: 0.3 }); spout = [HOP.x1 + OUT_REACH - 7, -156]; }
  else {
    box("duct.flange", [-114.5, HOP.y0 - 1, DZ[0] - 1.5], [-99.5, HOP.y0, DZ[1] + 1.5], { tone: "mid" }, { r: 0.4, extra: faceScrews(ctx, [W(-113.2, HOP.y0 - 1, DZ[0] - 0.4), W(-100.8, HOP.y0 - 1, DZ[0] - 0.4), W(-113.2, HOP.y0 - 1, DZ[1] + 0.4), W(-100.8, HOP.y0 - 1, DZ[1] + 0.4)], "y", { ring: 0.35, size: 0.24 }) });
    box("duct", [-113, HOP.y0 - OUT_REACH, DZ[0]], [-101, HOP.y0 - 1, DZ[1]], { tone: "mid" }, { r: 0.5, bevel: 0.3 });
    spout = [-107, HOP.y0 - OUT_REACH + 7];
  }
  ctx.cyl(n("spout"), spout[0] + ox, spout[1] + oy, 6.5, ZH - 6 + oz, 8, { tone: "mid" }, { steps: 36, inner: Ln(k.sideArc(spout[0] + ox, spout[1] + oy, 6.5, ZH - 1 + oz, P, 28), { tone: "faint" }) });
  ctx.slot(`${id}:spout`, { before: n("spout.flange") });
  ctx.cyl(n("spout.flange"), spout[0] + ox, spout[1] + oy, 8, ZH - 7.5 + oz, 1.5, { tone: "mid" }, { steps: 44, bevel: 0.2 });
  const OUT = [spout[0], spout[1], ZH - 7.5];
  ctx.material = "fx-graphite";
  const GB = plan(-94.6, -133, -86, -117, 1);
  ctx.slab(n("gearbox"), GB, ZH - 6 + oz, 12, { tone: "mid" }, { steps: 4, bevel: 0.6, inner: Ln(k.sideSeam(GB, ZH + oz, P, 4), { tone: "faint" }), extra: ctx.screws(k.corners(GB, 1.6), ZH + 6 + oz, { ring: 0.6, size: 0.3 }) });
  box("gearbox.arm", [-92, -133, ZHB], [-89, -131, ZH - 6], { tone: "mid" });
  {
    const F = G.frameAlong(W(-90.3, -117, ZH), [0, 1, 0]);
    const ribs = G.ribsOf(F, 3, 13, 4.3, 28, P, { fade: [0.1, 0.55], seams: true });
    ctx.turned(n("motor"), F, [[0, 4.9], [1.2, 4.9], [1.2, 4.3], [13, 4.3], [13, 4.6], [15.4, 4.6, 1], [16.4, 3.6, 1], [16.9, 0]], { tone: "mid" }, { extra: k.fadedSvg(ribs, { tone: "lo" }) });
  }
  box("motor.terminal", [-92.6, -112, ZH + 4.1], [-88, -107, ZH + 7.4], { tone: "mid" }, { extra: ctx.screws([[-92, -111.4], [-88.6, -111.4], [-92, -107.6], [-88.6, -107.6]].map(([x, y]) => [x + ox, y + oy]), ZH + 7.4 + oz, { ring: 0.35, size: 0.24 }) });
  // drive lamp (the one lit accent) on the gearbox
  ctx.material = "";
  ctx.cyl(n("lamp.base"), -90.3 + ox, -129 + oy, 1.4, ZH + 6 + oz, 1, { tone: "mid" }, { steps: 16 });
  {
    const c = W(-90.3, -129, ZH + 8.6);
    ctx.put(n("lamp.lens"), c, S(G.sphereOf(c, 1.5, P), { tone: "hi", lit: true }), [ctx.record(A.ball(c, 1.5, { name: n("lamp.lens") }))]);
  }

  // without the access steel the gearbox's torque arm rests on a short cantilever from the right back post instead of
  // on the head platform
  if (!ACCESS) box("drive.beam", [PXR + PH, PYB - 0.8, ZHB - 2.4], [-88, -130.5, ZHB], { tone: "mid" });

  // ================= ladder, cage and landings on the +x face
  if (ACCESS) buildAccess();
  function buildAccess() {
    const SX = [-93, -91.6], SY = [[-127.5, -126.3], [-119.7, -118.5]];
    const bounds = [0, ...landings, ZHB + 12];
    const sections = bounds.slice(0, -1).map((z, i) => [z, bounds[i + 1]]);
    sections.forEach(([z0, z1], si) => {
      const rungs = [];
      const shapes = [];
      for (let z = z0 + 6; z < z1 - 2; z += 6) {
        const F = G.frameAlong(W(-92.3, SY[0][1], z), [0, 1, 0]);
        rungs.push(S(G.disc(0, SY[1][0] - SY[0][1], 0.45, F, P, { steps: 12 }), { tone: "mid" }));
        shapes.push(ctx.record(A.disc(F, 0, SY[1][0] - SY[0][1], 0.45, { name: n("ladder") })));
      }
      const stile = (ys) => {
        const pl = plan(SX[0], ys[0], SX[1], ys[1], 0.2);
        shapes.push(ctx.record(A.slab(pl, z0 + oz, z1 - z0, { name: n("ladder") }, 2)));
        return S(k.slabOf(pl, z0 + oz, z1 - z0, P, 2), { tone: "mid" });
      };
      const far = stile(SY[0]);
      const near = stile(SY[1]);
      ctx.put(n("ladder"), W(-92.3, -123, (z0 + z1) / 2), far + rungs.join("") + near, shapes);
    });
    for (const L of levels)
      for (const ys of SY) box("ladder.bracket", [PXR + PH, ys[0], L - 0.6], [SX[0], ys[1], L + 0.6], { tone: "mid" });
    // cage: flat-bar hoops from stile to stile, three straps outside them
    const hoopPath = (() => {
      const pts = [[-91.6, -126.9], [-87.6, -130]];
      for (let i = 0; i <= 12; i++) {
        const a = -Math.PI / 2 + (i / 12) * Math.PI;
        pts.push([-86 + 7 * Math.cos(a), -123 + 7 * Math.sin(a)]);
      }
      pts.push([-87.6, -116], [-91.6, -119.1]);
      return pts.filter((p, i, list) => i === 0 || Math.hypot(p[0] - list[i - 1][0], p[1] - list[i - 1][1]) > 0.3);
    })();
    const hoopRing = (() => {
      const off = (sgn) => hoopPath.map((p, i) => {
        const a = hoopPath[Math.max(0, i - 1)], b = hoopPath[Math.min(hoopPath.length - 1, i + 1)];
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
        return [p[0] + ox + (sgn * 0.25 * dy) / len, p[1] + oy - (sgn * 0.25 * dx) / len];
      });
      return [...off(1), ...off(-1).reverse()];
    })();
    for (const [c0, c1] of sections.map(([z0, z1], i) => [z0 === 0 ? 40 : z0 + 12, i === sections.length - 1 ? ZHB - 14 : z1 - 12]).filter(([a, b]) => b - a >= 16)) {
      const hoops = [];
      for (let z = c0; z <= c1; z += 16) hoops.push(z);
      for (const z of hoops) ctx.prism(n("cage.hoop"), hoopRing, z + oz, 1.6, { tone: "mid" });
      const top = hoops[hoops.length - 1] + 1.6;
      for (const deg of [-60, 0, 60]) {
        const a = (deg * Math.PI) / 180;
        const c = [-86 + 7.5 * Math.cos(a), -123 + 7.5 * Math.sin(a)];
        bar(ctx, n("cage.strap"), W(c[0], c[1], c0), W(c[0], c[1], top), 1.2, 0.5, { tone: "mid" }, { u: [-Math.sin(a), Math.cos(a), 0] });
      }
    }
    // landings: U-shaped grating plates round the ladder, beams from the posts, toe boards, posts and rails
    for (const Z of [...landings, ZHB]) {
      const ring = [[-94.2, -140], [-76, -140], [-76, -106], [-94.2, -106], [-94.2, -116], [-85, -116], [-85, -130], [-94.2, -130]].map(([x, y]) => [x + ox, y + oy]);
      const top = Z + oz;
      const grate = Ln([...Array(7)].map((_, i) => k.lineOnTop([-77.5 - i * 1.2 + ox, -139.2 + oy], [-77.5 - i * 1.2 + ox, -106.8 + oy], top, P)).join(""), { tone: "faint" });
      for (const y of [PYB, PYF]) box("landing.beam", [PXR + PH, y - 0.8, Z - 2.4], [-76, y + 0.8, Z - 1.2], { tone: "mid" });
      ctx.prism(n("landing"), ring, top - 1.2, 1.2, { tone: "mid" }, { extra: grate });
      const posts = [[-77, -140], [-77, -107], [-94.2, -140], [-94.2, -107]];
      for (const [x, y] of posts) box("landing.post", [x, y, Z], [x + 1, y + 1, Z + 14], { tone: "mid" });
      for (const zr of [Z + 7, Z + 13]) {
        box("landing.rail", [-77, -139, zr], [-76, -107, zr + 1], { tone: "mid" });
        box("landing.rail", [-93.2, -140, zr], [-77, -139, zr + 1], { tone: "mid" });
        box("landing.rail", [-93.2, -107, zr], [-77, -106, zr + 1], { tone: "mid" });
      }
      box("landing.toe", [-77, -139, Z], [-76, -107, Z + 2], { tone: "mid" });
      box("landing.toe", [-93.2, -140, Z], [-77, -139, Z + 2], { tone: "mid" });
      box("landing.toe", [-93.2, -107, Z], [-77, -106, Z + 2], { tone: "mid" });
    }
  }
  ctx.material = "";

  ctx.data[id] = {
    zb: ZB + oz, zh: ZH + oz, r: R, yf: YF + oy, yb: YB + oy, strands: g.strands.map((x) => x + ox),
    zLow: ZBT + oz, zHigh: 1e4, yc: YC + oy, count: COUNT, speed: g.speed, lift: LIFT,
    hopper: { rim: RIM + oz, edge: HOP.y1 + oy, land: W(-107, -156, HOP.z1 - 6) },
    cradle: { x0: -112.5 + ox, x1: -101.5 + ox },
    feed: { x: -107 + ox, mouth: -83 + oy, face: -97 + oy, z: 24 + oz },
    ports: { in: W(...g.in), out: W(...OUT) },
    outDir: [0, 0, -1],
  };
}

export const LIVE = `
MACHINES.elevator = (api) => {
  const D = api.data;
  const P = api.P;
  const g = { front: api.slot("front"), back: api.slot("back"), feed: api.slot("feed"), spout: api.slot("spout") };
  const Lf = D.zh - D.zb, wrap = Math.PI * D.r, total = 2 * Lf + 2 * wrap;
  const N = D.count, spacing = total / N, PITCH = 4;
  const X0 = D.cradle.x0, X1 = D.cradle.x1, XC = (X0 + X1) / 2;
  let travel = 0;
  const cradles = Array.from({ length: N }, (_, i) => ({ i, item: null, u: 0 }));
  const feed = [];
  const waiting = [];
  const self = { lifted: 0 };
  const uOf = (i) => (((travel + i * spacing) % total) + total) % total;
  // steady state at load: every other cradle on the front run already carries a packet
  cradles.forEach((c) => { c.u = uOf(c.i); if (c.u > 20 && c.u < Lf - 10 && c.i % 2 === 0) c.item = api.item("audio"); });

  const S = (plan, z0, z1, style) => {
    const lo = Math.max(z0, D.zLow), hi = Math.min(z1, D.zHigh);
    return hi - lo > 0.05 ? solidSvg(slabOf(plan, lo, hi - lo, P, 2), style) : "";
  };
  const pl = (x0, y0, x1, y1) => ({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r: 0.2 });
  // a packet cut where it passes through the boot top or the hood bottom (and through the boot's feed face)
  function packetPart(kind, x, y, z, { w = 9.2, d = 8, h = 7, yMin = -1e9, zMin = D.zLow, zMax = D.zHigh } = {}) {
    const lo = Math.max(z, zMin), hi = Math.min(z + h, zMax);
    const y0 = Math.max(y - d / 2, yMin);
    if (hi - lo < 0.05 || y + d / 2 - y0 < 0.05) return "";
    const whole = lo === z && hi === z + h && y0 === y - d / 2;
    if (whole) return api.packetSvg(kind, [x, y, z], { w, d, h });
    return '<g class="pk" data-kind="' + kind + '">' + solidSvg(slabOf({ x: x - w / 2, y: y0, w, d: y + d / 2 - y0, r: 0.6 }, lo, hi - lo, P, 2, 0.3), { tone: "hi" }) + '</g>';
  }
  function frontCradle(zc, item) {
    const YS = D.yf + 0.7;
    let s = '<g class="it">';
    s += S(pl(X0, YS, X1, YS + 1.2), zc + 1.2, zc + 10, { tone: "mid" });
    s += S(pl(X0, YS + 1.2, X0 + 0.8, YS + 8.3), zc + 1.2, zc + 4, { tone: "mid" });
    s += S(pl(X0, YS, X1, YS + 10.5), zc, zc + 1.2, { tone: "mid" });
    s += '</g>';
    if (item) s += packetPart(item.kind, XC, YS + 5.2, zc + 1.2);
    s += '<g class="it">' + S(pl(X1 - 0.8, YS + 1.2, X1, YS + 8.3), zc + 1.2, zc + 4, { tone: "mid" }) + S(pl(X0, YS + 9.3, X1, YS + 10.5), zc + 1.2, zc + 3, { tone: "mid" }) + '</g>';
    return s;
  }
  function backCradle(zc) {
    const YS = D.yb - 0.7;
    let s = '<g class="it">';
    s += S(pl(X0, YS - 10.5, X1, YS - 9.3), zc - 3, zc - 1.2, { tone: "mid" });
    s += S(pl(X0, YS - 9.3, X0 + 0.8, YS - 1.2), zc - 4, zc - 1.2, { tone: "mid" });
    s += S(pl(X0, YS - 1.2, X1, YS), zc - 10, zc - 1.2, { tone: "mid" });
    s += S(pl(X1 - 0.8, YS - 9.3, X1, YS - 1.2), zc - 4, zc - 1.2, { tone: "mid" });
    s += S(pl(X0, YS - 10.5, X1, YS), zc - 1.2, zc, { tone: "mid" });
    return s + '</g>';
  }
  // a prism along x of a convex (y, z) polygon, shaded by the kit's rules: cradles while they round the head sprocket
  const VW = G.viewOf(P), CAM = cameraOf(P), LX = -CAM.sinA, LY = CAM.cosA;
  function hull(points) {
    const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of pts.reverse()) { while (up.length > 1 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  const dpath = (pts) => "M" + pts.map(([x, y]) => x.toFixed(2) + " " + y.toFixed(2)).join("L") + "Z";
  function xprism(x0, x1, poly) {
    const cy = poly.reduce((a, p) => a + p[0], 0) / poly.length, cz = poly.reduce((a, p) => a + p[1], 0) / poly.length;
    const all = [], shades = [[], [], [], []], tops = [];
    const put = (nrm, quad) => {
      if (nrm[0] * VW[0] + nrm[1] * VW[1] + nrm[2] * VW[2] <= 1e-6) return;
      const d = dpath(quad.map((p) => iso(p, P)));
      if (nrm[2] > 0.7) { tops.push(d); return; }
      const h = Math.hypot(nrm[0], nrm[1]) || 1;
      const lit = ((nrm[0] / h) * LX + (nrm[1] / h) * LY + 1) / 2;
      shades[Math.min(3, Math.max(0, Math.floor(lit * 4)))].push(d);
    };
    put([1, 0, 0], poly.map(([y, z]) => [x1, y, z]));
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      let ny = b[1] - a[1], nz = -(b[0] - a[0]);
      const len = Math.hypot(ny, nz) || 1; ny /= len; nz /= len;
      if (ny * ((a[0] + b[0]) / 2 - cy) + nz * ((a[1] + b[1]) / 2 - cz) < 0) { ny = -ny; nz = -nz; }
      put([0, ny, nz], [[x0, a[0], a[1]], [x0, b[0], b[1]], [x1, b[0], b[1]], [x1, a[0], a[1]]]);
    });
    poly.forEach(([y, z]) => { all.push(iso([x0, y, z], P), iso([x1, y, z], P)); });
    const outline = dpath(hull(all));
    let svg = '<g class="iso-solid"><path class="iso-fill" d="' + outline + '"/>';
    shades.forEach((list, i) => { if (list.length) svg += '<path class="iso-shade" data-shade="' + i + '" d="' + list.join("") + '"/>'; });
    if (tops.length) svg += '<path class="iso-top" d="' + tops.join("") + '"/>';
    return svg + '<path class="iso-line iso-edge" data-tone="mid" d="' + outline + '"/></g>';
  }
  function wrapCradle(phi) {
    const c = Math.cos(phi), sn = Math.sin(phi);
    const Cy = D.yc + D.r * c, Cz = D.zh + D.r * sn;
    const yz = (nn, tt) => [Cy + c * nn - sn * tt, Cz + sn * nn + c * tt];
    const parts = [[X0, X1, 0.7, 1.9, 1.2, 10], [X0, X0 + 0.8, 1.9, 9, 1.2, 4], [X0, X1, 0.7, 11.2, 0, 1.2], [X1 - 0.8, X1, 1.9, 9, 1.2, 4], [X0, X1, 10, 11.2, 1.2, 3]];
    return '<g class="it">' + parts.map(([a, b, n0, n1, t0, t1]) => {
      const poly = [yz(n0, t0), yz(n1, t0), yz(n1, t1), yz(n0, t1)];
      const m = yz((n0 + n1) / 2, (t0 + t1) / 2);
      return { k: ((a + b) / 2) * VW[0] + m[0] * VW[1] + m[1] * VW[2], svg: xprism(a, b, poly) };
    }).sort((p, q) => p.k - q.k).map((p) => p.svg).join("") + '</g>';
  }
  const flights = [];
  const FLY = 0.75, DUCT = 0.5, EMERGE = 0.3;
  function pins(y, dir) {
    const ph = ((travel % PITCH) + PITCH) % PITCH;
    const pts = [];
    for (const x of D.strands) {
      for (let z = D.zLow + (dir > 0 ? ph : PITCH - ph); z < D.zh - 0.4; z += PITCH) pts.push(iso([x + 0.6, y, z], P));
    }
    return dotsSvg(pts, { size: 0.36, tone: "hi" });
  }
  self.accept = (port, item, from) => {
    feed.push({ item, x: from ? from[0] : D.feed.x, y: from ? from[1] : D.feed.mouth, x0: from ? from[0] : D.feed.x, t0: api.now() });
  };
  self.tick = (dt, t) => {
    const step = api.calm() ? 0 : D.speed * dt;
    // cradles
    for (const c of cradles) {
      const before = c.u;
      const after = (((before + step) % total) + total) % total;
      if (after < before && waiting.length && !c.item) c.item = waiting.shift();
      const launch = Lf;
      if (before < launch && after >= launch && c.item) {
        flights.push({ item: c.item, t0: t, from: [XC, D.yf + 5.9, D.zh + 1.2] });
        c.item = null;
      }
      c.u = after;
    }
    travel += step;
    // feed: slide from the belt end down the chute and in through the feed opening
    for (let i = feed.length - 1; i >= 0; i--) {
      const f = feed[i];
      if (!api.calm()) f.y -= 22 * dt;
      f.x = D.feed.x + (f.x0 - D.feed.x) * Math.exp(-(t - f.t0) / 0.15);
      if (f.y < D.feed.face - 4.2) { waiting.push(f.item); feed.splice(i, 1); }
    }
    let front = pins(D.yf, 1), back = pins(D.yb, -1);
    // chain wrapped round the head sprocket: short link segments and their pins, split front / back like the cradles
    const ph = ((travel % PITCH) + PITCH) % PITCH;
    let backChain = "";
    for (const x of D.strands) {
      const SEG = 16;
      for (let i = 0; i < SEG; i++) {
        const f0 = (i / SEG) * Math.PI, f1 = ((i + 1) / SEG) * Math.PI;
        const q = [[D.r - 0.7, f0], [D.r + 0.7, f0], [D.r + 0.7, f1], [D.r - 0.7, f1]].map(([rr, f]) => [D.yc + rr * Math.cos(f), D.zh + rr * Math.sin(f)]);
        const svg = '<g class="it">' + xprism(x - 0.6, x + 0.6, q).replace('data-tone="mid"', 'data-tone="lo"') + '</g>';
        if ((f0 + f1) / 2 < 2.255) front += svg; else backChain += svg;
      }
      const pts = [], ptsB = [];
      for (let sArc = ph; sArc < Math.PI * D.r; sArc += PITCH) {
        const f = sArc / D.r, pt = iso([x + 0.6, D.yc + D.r * Math.cos(f), D.zh + D.r * Math.sin(f)], P);
        (f < 2.255 ? pts : ptsB).push(pt);
      }
      front += dotsSvg(pts, { size: 0.36, tone: "hi" });
      backChain += dotsSvg(ptsB, { size: 0.36, tone: "hi" });
    }
    const order = cradles.slice().sort((a, b) => a.u - b.u);
    for (const c of order) {
      if (c.u < Lf) front += frontCradle(D.zb + c.u, c.item);
      else if (c.u <= Lf + wrap) { const phi = (c.u - Lf) / D.r; if (phi < 2.255) front += wrapCradle(phi); else back += wrapCradle(phi); }
      else if (c.u < 2 * Lf + wrap) back += backCradle(D.zh - (c.u - Lf - wrap));
    }
    let spout = "";
    // packets flung from the cradles as they round the sprocket, over into the discharge hopper (cut at its rim);
    // after the duct's transit time they leave the down-spout at the out port
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i];
      const s = api.clamp((t - f.t0) / FLY, 0, 1), e = s * s * (3 - 2 * s) * 0.35 + s * 0.65, u = 1 - e;
      const P1 = [XC, D.yc + 1, D.zh + 40], P2 = D.hopper.land;
      const p = [0, 1, 2].map((j) => u * u * f.from[j] + 2 * u * e * P1[j] + e * e * P2[j]);
      const age = t - f.t0 - FLY - DUCT;
      if (age >= EMERGE) {
        flights.splice(i, 1);
        self.lifted++;
        api.emit("out", f.item, [D.ports.out[0], D.ports.out[1], D.ports.out[2] - 7]);
        continue;
      }
      if (s < 1) front += packetPart(f.item.kind, p[0], p[1], p[2], { zMin: p[1] < D.hopper.edge ? D.hopper.rim : -1e9 });
      else if (age > 0) {
        const k2 = age / EMERGE;
        spout += packetPart(f.item.kind, D.ports.out[0], D.ports.out[1], D.ports.out[2] - 7 * k2 * k2, { zMin: -1e9, zMax: D.ports.out[2] });
      }
    }
    g.front.innerHTML = front;
    g.back.innerHTML = back + backChain;
    g.feed.innerHTML = feed.map((f) => packetPart(f.item.kind, f.x, f.y, D.feed.z, { w: 10, yMin: D.feed.face, zMin: -1e9 })).join("");
    g.spout.innerHTML = spout;
  };
  return self;
};`;
