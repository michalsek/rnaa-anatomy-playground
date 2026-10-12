// Packer: boxes fluff (3 beads) into post-style packets and drops them onto belt B.
// Geometry is written in plan coordinates (BRIEF scene plan) and shifted by `origin`; the stand's legs
// always reach the floor at world z = 0.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRig } from "./rig.mjs";

export const PLAN = {
  deck: { x: 70, y: -150, w: 60, d: 46, z: 176, top: 182 },
  legs: [[73, -147], [127, -147], [73, -107], [127, -107]],
  lane: { x: 100, x0: 93, x1: 107, y0: -140, y1: -95.3, z: 200, stations: [-124, -113, -102], pitch: 11, emitY: -94.5, slot: [-131.6, -96] },
  gutter: { x0: 74.6, x1: 92, y: -118, z: 228, pockets: [88.8, 84, 79.2], queue: 75.6 },
  magazine: { x: 100, y: -135, hopperZ: 207 },
  picker: { base: [78, -103.5], yokeZ: 224.5, L1: 17, L2: 16 },
  folder: { base: [121, -99.5], yokeZ: 206, L1: 16, L2: 15 },
};

// Local frame: origin is the floor point under the lane axis at the gutter line (plan [100, -118, 0]);
// PLAN coordinates are the BRIEF's plan and are shifted so that only `origin` places the machine.
export const ANCHOR = [100, -118, 0];
export function build(ctx, origin = ANCHOR, opts = {}) {
  const id = opts.id ?? "packer";
  const { k, G, P } = ctx;
  const ox = origin[0] - ANCHOR[0];
  const oy = origin[1] - ANCHOR[1];
  const oz = origin[2] - ANCHOR[2];
  const w = (x, y, z) => [x + ox, y + oy, z + oz];
  const n = (s) => `${id}.${s}`;
  const box = (name, a, b, style = {}, o = {}) => ctx.box(n(name), w(...a), w(...b), style, o);
  const slab = (name, plan, z0, h, style = {}, o = {}) => ctx.slab(n(name), { ...plan, x: plan.x + ox, y: plan.y + oy }, z0 + oz, h, style, o);
  const cyl = (name, cx, cy, r, z0, h, style = {}, o = {}) => ctx.cyl(n(name), cx + ox, cy + oy, r, z0 + oz, h, style, o);
  const up = (x, y, z) => ctx.UP(x + ox, y + oy, z + oz);
  const along = (p, a) => G.frameAlong(w(...p), a);
  const turned = (name, F, profile, style = {}, o = {}) => ctx.turned(n(name), F, profile, style, o);
  const screws = (pts, z, o) => ctx.screws(pts.map(([x, y]) => [x + ox, y + oy]), z + oz, o);
  const plan = (x, y, wd, d, r = 0.6) => ({ x: x + ox, y: y + oy, w: wd, d, r });
  const faint = (d) => ctx.Ln(d, { tone: "faint" });
  const lo = (d) => ctx.Ln(d, { tone: "lo" });
  const bolts = (F, s, r, count, size = 0.42) => ctx.Dots(G.dotsOf(F, s, r, count, P, { all: true }), { size });
  const material = (m) => (ctx.material = m);
  // a stepped turned part: one disc item per constant-radius run, so nothing is drawn as a hull
  const stepped = (name, F, segs, style = {}, extras = {}, inners = {}) =>
    segs.forEach(([s0, s1, r], i) => ctx.disc(n(`${name}.${i}`), F, s0, s1, r, style, { extra: extras[i] ?? "", inner: inners[i] ?? "" }));

  // ---- stand: four legs to the floor, stringers, deck --------------------------------------------
  const D = PLAN.deck;
  const floorZ = opts.floor ?? 0; // local z the legs stand on (the case floor); a standalone page may raise it
  const legTop = D.z;
  const lowZ = floorZ + Math.max(6.5, (legTop - floorZ) * 0.22);
  const highZ = legTop - 1 - 8;
  const stringerZ = lowZ;
  material("fx-graphite");
  for (const [x, y] of PLAN.legs) {
    box(`stand.foot`, [x - 3.6, y - 3.6, floorZ], [x + 3.6, y + 3.6, floorZ + 1.2], { tone: "lo" }, { r: 0.8, bevel: 0.3, extra: screws([[x - 2.4, y - 2.4], [x + 2.4, y - 2.4], [x - 2.4, y + 2.4], [x + 2.4, y + 2.4]], floorZ + 1.2, { ring: 0.6, size: 0.35 }) });
    box(`stand.leg`, [x - 1.8, y - 1.8, floorZ + 1.2], [x + 1.8, y + 1.8, legTop - 1], { tone: "mid" }, { r: 0.3 });
    box(`stand.head`, [x - 3, y - 3, legTop - 1], [x + 3, y + 3, legTop], { tone: "mid" }, { r: 0.5 });
  }
  // two rings of stringers (the upper one only when the legs are tall), flush with the leg faces
  const [[ax, ay], [bx], , [, dy]] = PLAN.legs;
  const tall = highZ - lowZ > 30;
  const ring = (z, tag) => {
    box(`stand.${tag}`, [ax + 1.8, ay - 1, z], [bx - 1.8, ay + 1, z + 2], { tone: "mid" }, { r: 0.3 });
    box(`stand.${tag}`, [ax + 1.8, dy - 1, z], [bx - 1.8, dy + 1, z + 2], { tone: "mid" }, { r: 0.3 });
    box(`stand.${tag}`, [bx - 1, ay + 1.8, z + 2], [bx + 1, dy - 1.8, z + 4], { tone: "mid" }, { r: 0.3 });
    box(`stand.${tag}`, [ax - 1, ay + 1.8, z + 2], [ax + 1, dy - 1.8, z + 4], { tone: "mid" }, { r: 0.3 });
  };
  ring(lowZ, "stringer");
  if (tall) {
    ring(highZ, "rail");
    // diagonal braces on every face, landing on the leg faces between the rings
    const brace = (name, a, b) => {
      const dir = G.sub3(w(...b), w(...a));
      const len = G.len3(dir);
      ctx.turned(n(name), G.frameAlong(w(...a), dir), [[0, 0.45], [len, 0.45]], { tone: "mid" });
    };
    const z0 = lowZ + 4.5;
    const z1 = highZ - 0.5;
    brace("stand.brace", [ax + 1.8, ay, z0], [bx - 1.8, ay, z1]);
    brace("stand.brace", [ax + 1.8, dy, z1], [bx - 1.8, dy, z0]);
    const zs = lowZ + 6.4; // the side braces start above the shelf that rests on the side stringers
    brace("stand.brace", [bx, ay + 1.8, z1], [bx, dy - 1.8, zs]);
    brace("stand.brace", [ax, ay + 1.8, zs], [ax, dy - 1.8, z1]);
  }
  material("");
  // deck: a plate with a tab at the front-left corner for the picker pedestal
  const R = 1.6;
  const corner = (cx, cy, a0) => Array.from({ length: 5 }, (_, i) => [cx + R * Math.cos(a0 + (i * Math.PI) / 8), cy + R * Math.sin(a0 + (i * Math.PI) / 8)]);
  const X0 = D.x, X1 = D.x + D.w, Y0 = D.y, Y1 = D.y + D.d, TX = 88, TY = -97.5, RX = 112, RY = -93.5;
  // tabs at both front corners carry the two arm pedestals; belt B's tail passes between them
  const deckRing = [...corner(X1 - R, Y0 + R, -Math.PI / 2), ...corner(X1 - R, RY - R, 0), ...corner(RX + R, RY - R, Math.PI / 2), [RX, Y1], [TX, Y1], ...corner(TX - R, TY - R, 0), ...corner(X0 + R, TY - R, Math.PI / 2), ...corner(X0 + R, Y0 + R, Math.PI)].map(([x, y]) => [x + ox, y + oy]);
  const deckBolts = [];
  for (let x = TX + 4; x <= RX - 3; x += 6) deckBolts.push([x, Y1 - 1.8]);
  for (let y = Y0 + 4; y <= RY - 3; y += 6.5) deckBolts.push([X1 - 1.8, y]);
  for (let x = X0 + 4; x <= TX - 3; x += 6.5) deckBolts.push([x, TY - 1.8]);
  for (let x = RX + 4; x <= X1 - 4; x += 6.5) deckBolts.push([x, RY - 1.8]);
  const tslot = (x0, x1, y) => k.planOutline(plan(x0, y - 0.8, x1 - x0, 1.6, 0.8), D.top + oz, P, 4);
  ctx.prism(n("deck"), deckRing, D.z + oz, D.top - D.z, { tone: "mid" }, { inner: faint(k.ringSeam(deckRing, D.z + 3 + oz, P)), extra: lo([-128, -121, -114].map((y) => tslot(X0 + 4, X1 - 4, y)).join("")) + screws(deckBolts, D.top, { ring: 0.7, size: 0.35 }) });

  // lower shelf on the side stringers: air receiver and vacuum pump
  const shelfZ = stringerZ + 4;
  material("fx-graphite");
  box("shelf", [ax - 1, ay + 2, shelfZ], [bx + 1, dy - 2, shelfZ + 1.2], { tone: "mid" }, { r: 0.4, extra: screws([[ax + 3, ay + 4.5], [bx - 3, ay + 4.5], [ax + 3, dy - 4.5], [bx - 3, dy - 4.5]], shelfZ + 1.2, { ring: 0.6, size: 0.32 }) });
  material("");
  const TR = 4.5;
  const tankZ = shelfZ + 1.2 + 2 + TR;
  for (const x of [88, 104]) box("tank.saddle", [x - 1.5, -131.5, shelfZ + 1.2], [x + 1.5, -122.5, shelfZ + 3.2], { tone: "lo" }, { r: 0.3 });
  const TF = along([82, -127, tankZ], [1, 0, 0]);
  stepped("tank.nozzle", TF, [[0, 0.8, 1.2]], { tone: "mid" });
  turned("tank", TF, [[0.8, 2.6, 1], [1.5, 3.7, 1], [2.3, 4.3, 1], [3.2, TR], [28.8, TR, 1], [29.7, 4.3, 1], [30.5, 3.7, 1], [31.2, 2.6, 1]], { tone: "hi" }, { inner: faint(G.arcOf(TF, 9, TR, P) + G.arcOf(TF, 23, TR, P)) });
  stepped("tank.drain", TF, [[31.2, 32, 1.2]], { tone: "mid" });
  const neckBase = w(96, -127 + Math.sqrt(TR * TR - 0.49), tankZ);
  ctx.turned(n("tank.neck"), G.frameAlong(neckBase, [0, 1, 0]), [[0, 0.7], [1.8, 0.7]], { tone: "mid" });
  const gaugeEnd = G.add3(neckBase, [0, 1.8, 0]);
  const GAF = G.frameAlong(gaugeEnd, [0, 1, 0]);
  ctx.turned(n("tank.gauge"), GAF, [[0, 2.2], [1.2, 2.2]], { tone: "hi" }, { extra: ctx.Ln(G.circleOf(GAF, 1.2, 1.6, P, 32), { tone: "faint" }) + ctx.Ln(k.pathOf([k.iso(G.add3(gaugeEnd, [0, 1.2, 0]), P), k.iso(G.add3(gaugeEnd, [0.9, 1.2, 0.9]), P)]), { tone: "hi", free: true }) });
  const PF0 = up(116, -116, shelfZ + 1.2);
  stepped("pump", PF0, [[0, 1, 3.8], [1, 7.5, 3], [7.5, 9, 2.2]], { tone: "mid" }, {}, { 1: k.fadedSvg(G.ribsOf(PF0, 1, 7.5, 3, 28, P, { fade: [0.1, 0.55] }), { tone: "faint" }) });
  stepped("pump.motor", along([116, -119, shelfZ + 5], [0, -1, 0]), [[0, 7, 2.2], [7, 8, 1.6]], { tone: "hi" });

  // ---- lane: bed on two turned columns, far guide rail, walking-beam slot -------------------------
  const Ln = PLAN.lane;
  for (const y of [-136, -112]) {
    const F = up(Ln.x, y, D.top);
    stepped("lane.column", F, [[0, 1.4, 5.4], [1.4, 12.6, 3], [12.6, 14, 5.4]], { tone: "mid" }, { 0: bolts(F, 1.4, 4.4, 8), 2: bolts(F, 14, 4.4, 8) });
  }
  const bedPlan = plan(Ln.x0, Ln.y0, Ln.x1 - Ln.x0, Ln.y1 - Ln.y0, 0.8);
  const slotPlan = plan(Ln.x - 1, Ln.slot[0], 2, Ln.slot[1] - Ln.slot[0], 1);
  ctx.slab(n("lane.bed"), bedPlan, 196 + oz, 4, { tone: "mid" }, { steps: 4, bevel: 0.4, inner: faint(k.sideSeam(bedPlan, 198 + oz, P, 4)), extra: lo(k.planOutline(slotPlan, Ln.z + oz, P, 6)) });
  for (const y of [-126, -112, -99]) cyl("lane.railpost", 93.6, y, 0.5, Ln.z, 3.5, { tone: "mid" }, { steps: 16 });
  box("lane.rail", [93.1, -128.5, 203.5], [94.1, -97.5, 205], { tone: "hi" }, { r: 0.3 });

  // ---- magazine: four posts, closed hopper, gate bar; blank pusher behind it -----------------------
  const M = PLAN.magazine;
  for (const [x, y] of [[94.4, -139.5], [105.6, -139.5], [94.4, -130.5], [105.6, -130.5]]) box("mag.post", [x - 0.5, y - 0.5, Ln.z], [x + 0.5, y + 0.5, M.hopperZ], { tone: "mid" }, { r: 0.15 });
  ctx.slot(`${id}:stack`, { after: n("mag.post#2") });
  box("mag.gate", [94.9, -130.9, 201.4], [105.1, -130.1, 202.6], { tone: "hi" }, { r: 0.2 });
  const hopper = plan(93.9, -140, 12.2, 10, 0.6);
  const windowPts = [[96, -130, 209], [104, -130, 209], [104, -130, 215.5], [96, -130, 215.5]];
  ctx.slab(n("mag.hopper"), hopper, M.hopperZ + oz, 11, { tone: "mid" }, { steps: 3, bevel: 0.4, inner: faint(k.sideSeam(hopper, M.hopperZ + 1.2 + oz, P, 3)), extra: lo(ctx.path3(windowPts.map((p) => w(...p)), true)) + screws([[94.8, -130.9], [105.2, -130.9], [94.8, -139.1], [105.2, -139.1]], M.hopperZ + 11, { ring: 0.5, size: 0.3 }) });
  box("mag.cap", [95, -138.6, M.hopperZ + 11], [105, -131.4, M.hopperZ + 12], { tone: "hi" }, { r: 0.6, bevel: 0.3 });
  cyl("mag.knob", 100, -135, 1.2, M.hopperZ + 12, 1.4, { tone: "mid" }, { steps: 20, bevel: 0.2 });
  // pusher cylinder on a pedestal behind the bed
  box("pusher.block", [98, -146.6, D.top], [102, -141.6, 198.7], { tone: "mid" }, { r: 0.4, inner: faint(k.sideSeam(plan(98, -146.6, 4, 5, 0.4), 190 + oz, P, 3)) });
  const PF = along([100, -147.2, 200.5], [0, 1, 0]);
  stepped("pusher.body", PF, [[0, 0.7, 1.3], [0.7, 5.5, 1.8], [5.5, 6.2, 1.3]], { tone: "hi" });
  turned("pusher.gland", along([100, -141, 200.5], [0, 1, 0]), [[0, 0.95], [0.6, 0.95]], { tone: "mid" });
  const portA = ctx.boss(n("pusher.portA"), w(101.8, -145.6, 200.5), [1, 0, 0], 0.9, 1.2, { tone: "mid" });
  const portB = ctx.boss(n("pusher.portB"), w(101.8, -142.4, 200.5), [1, 0, 0], 0.9, 1.2, { tone: "mid" });

  // ---- erector bridge over S0 -----------------------------------------------------------------------
  const S0 = Ln.stations[0];
  for (const x of [90.5, 109.5]) {
    const F = up(x, S0, D.top);
    stepped("bridge.post", F, [[0, 1, 2.2], [1, 32, 1.1]], { tone: "mid" }, { 0: bolts(F, 1, 1.7, 4, 0.32) });
  }
  box("bridge.beam", [89.2, S0 - 1.3, 214], [110.8, S0 + 1.3, 216.4], { tone: "mid" }, { r: 0.4, bevel: 0.3, extra: screws([[90.5, S0], [109.5, S0]], 216.4, { ring: 0.6, size: 0.3 }) });
  const EF = up(100, S0, 216.4);
  stepped("bridge.cyl", EF, [[0, 0.7, 1.5], [0.7, 6.4, 2], [6.4, 7.4, 1.4]], { tone: "hi" }, {}, { 1: faint(G.arcOf(EF, 3.6, 2, P)) });
  turned("bridge.gland", along([100, S0, 214], [0, 0, -1]), [[0, 0.9], [0.7, 0.9]], { tone: "mid" });

  // ---- gutter at the end of belt A -----------------------------------------------------------------
  const Gt = PLAN.gutter;
  const gz = Gt.z;
  const GF = up(86, Gt.y, D.top);
  stepped("gutter.post", GF, [[0, 0.9, 2.6], [0.9, 43.6, 1.3], [43.6, 44.6, 2.2]], { tone: "mid" }, { 0: bolts(GF, 0.9, 2, 4, 0.32) });
  const pocketRings = Gt.pockets.map((x) => k.ring(x + ox, Gt.y + oy, 2.1, gz + oz, P, 28)).join("");
  box("gutter.floor", [Gt.x0, Gt.y - 3, gz - 1.4], [Gt.x1, Gt.y + 3, gz], { tone: "mid" }, { r: 0.2, extra: faint(pocketRings) });
  const eyes = Gt.pockets.map((x) => ctx.S(k.slabOf(plan(x - 0.7, Gt.y - 3.5, 1.4, 0.4, 0.1), gz + 3.6 + oz, 1, P, 1), { tone: "hi" })).join("");
  box("gutter.wall", [Gt.x0, Gt.y - 3.6, gz - 1.4], [Gt.x1, Gt.y - 3, gz + 3.6], { tone: "mid" }, { r: 0.1, extra: eyes });
  box("gutter.stop", [Gt.x1, Gt.y - 3.6, gz - 1.4], [Gt.x1 + 0.8, Gt.y + 3.6, gz + 3.6], { tone: "mid" }, { r: 0.1 });
  turned("gutter.lip", along([Gt.x0 - 0.8, Gt.y - 3, gz - 0.8], [0, 1, 0]), [[0, 0.8], [6, 0.8]], { tone: "hi" });
  ctx.slot(`${id}:gutter`, { before: n("gutter.near") });
  const receivers = Gt.pockets.map((x) => ctx.S(k.slabOf(plan(x - 0.8, Gt.y + 3, 1.6, 0.8, 0.15), gz + 1.4 + oz, 1.4, P, 1), { tone: "mid" })).join("");
  box("gutter.near", [Gt.x0, Gt.y + 3, gz - 1.4], [Gt.x1, Gt.y + 3.6, gz + 1.4], { tone: "hi" }, { r: 0.1, extra: receivers });

  // ---- arm bases: turned pedestal, turret, slewing ring ---------------------------------------------
  const pedestal = (key, [x, y], yokeZ, foot, col, tr) => {
    const F = up(x, y, D.top);
    const top = yokeZ - D.top;
    const mid = Math.round(top * 0.45);
    stepped(`${key}.pedestal`, F, [[0, 1.4, foot], [1.4, 2.6, col + 0.9], [2.6, mid - 0.7, col], [mid - 0.7, mid + 0.7, col + 0.7], [mid + 0.7, top - 10.2, col - 0.5], [top - 10.2, top - 9, col + 0.3], [top - 9, top - 8, tr + 0.4]], { tone: "mid" }, { 0: bolts(F, 1.4, foot - 1.1, 10), 3: bolts(F, mid + 0.7, col + 0.2, 6, 0.3), 6: bolts(F, top - 8, tr - 0.5, 8, 0.34) });
    material("fx-graphite");
    turned(`${key}.turret`, up(x, y, yokeZ - 8), [[0, tr], [7.2, tr]], { tone: "mid" }, { inner: faint(G.arcOf(up(x, y, yokeZ - 8), 3.6, tr, P)) });
    material("");
    turned(`${key}.slew`, up(x, y, yokeZ - 0.8), [[0, tr + 0.4], [0.8, tr + 0.4]], { tone: "hi" });
  };
  pedestal("picker", PLAN.picker.base, PLAN.picker.yokeZ, 5.4, 2.9, 4.6);
  pedestal("folder", PLAN.folder.base, PLAN.folder.yokeZ, 5.4, 2.9, 4.6);
  // cable bosses on the pedestal columns
  const pk = PLAN.picker.base;
  const fd = PLAN.folder.base;
  const pickerPort = ctx.boss(n("picker.port"), w(pk[0], pk[1] - 2.9, 190), [0, -1, 0], 1.1, 1.4, { tone: "mid" });
  const folderPort = ctx.boss(n("folder.port"), w(fd[0], fd[1] - 2.9, 190), [0, -1, 0], 1.1, 1.4, { tone: "mid" });

  // ---- control cabinet, valve manifold, cables --------------------------------------------------------
  material("fx-graphite");
  // picker drive at the back-left, control cabinet (folder drive, valves) at the back-right
  const drive = plan(71.5, -147, 9, 10, 0.6);
  ctx.slab(n("drive"), drive, D.top + oz, 13, { tone: "mid" }, { steps: 3, bevel: 0.4, inner: faint(k.sideSeam(drive, D.top + 10 + oz, P, 3)), extra: screws([[72.5, -146], [79.5, -146], [72.5, -138], [79.5, -138]], D.top + 13, { ring: 0.5, size: 0.3 }) });
  const cab = plan(115, -148, 13, 16, 0.8);
  const door = [[116.4, -132, 184], [126.6, -132, 184], [126.6, -132, 197], [116.4, -132, 197]];
  ctx.slab(n("cabinet"), cab, D.top + oz, 17, { tone: "mid" }, { steps: 3, bevel: 0.5, extra: lo(ctx.path3(door.map((p) => w(...p)), true)) + screws([[116, -147], [127, -147], [116, -133], [127, -133]], D.top + 17, { ring: 0.5, size: 0.3 }) });
  box("cabinet.handle", [124.6, -132, 189.2], [125.6, -131.4, 192.4], { tone: "hi" }, { r: 0.2 });
  box("cabinet.hinge", [116.8, -132, 186], [117.6, -131.6, 188], { tone: "lo" }, { r: 0.1 });
  box("cabinet.hinge", [116.8, -132, 193], [117.6, -131.6, 195], { tone: "lo" }, { r: 0.1 });
  box("cabinet.label", [128, -145, 192], [128.3, -137, 196], { tone: "hi" }, { r: 0, extra: ctx.Ln(ctx.path3([w(128.3, -144.2, 194.9), w(128.3, -137.8, 194.9)]) + ctx.path3([w(128.3, -144.2, 193.7), w(128.3, -139.6, 193.7)]) + ctx.path3([w(128.3, -144.2, 192.6), w(128.3, -141.4, 192.6)]), { tone: "lo", free: true }) });
  const louvre = (z) => ctx.path3([w(128.3, -146, z), w(128.3, -138, z), w(128.3, -138, z + 0.7), w(128.3, -146, z + 0.7)], true);
  box("cabinet.vent", [128, -146.6, 183.4], [128.3, -137.4, 189.6], { tone: "mid" }, { r: 0, extra: lo([184.2, 185.6, 187, 188.4].map(louvre).join("")) });
  ctx.boss(n("cabinet.lamp"), w(128, -134.6, 196.6), [1, 0, 0], 0.7, 0.6, { tone: "hi" });
  const cabPortA = ctx.boss(n("drive.gland"), w(78, -137, 190), [0, 1, 0], 1.1, 1.2, { tone: "mid" });
  const cabPortB = ctx.boss(n("cabinet.gland"), w(121, -132, 190), [0, 1, 0], 1.1, 1.2, { tone: "mid" });
  box("manifold", [105, -147.4, D.top], [111, -141.4, 185.4], { tone: "mid" }, { r: 0.4, extra: screws([[105.8, -146.6], [110.2, -146.6], [105.8, -142.2], [110.2, -142.2]], 185.4, { ring: 0.4, size: 0.28 }) });
  material("");
  const valveA = w(108, -145.6, 188.6);
  const valveB = w(108, -142.4, 188.6);
  for (const [y, i] of [[-145.6, "A"], [-142.4, "B"]]) {
    box(`manifold.valve${i}`, [106.2, y - 1.2, 185.4], [109.8, y + 1.2, 187.6], { tone: "hi" }, { r: 0.3 });
    cyl(`manifold.coil${i}`, 108, y, 1, 187.6, 1, { tone: "mid" }, { steps: 18 });
  }
  ctx.cable(n("cable.picker"), [cabPortA, pickerPort], 0.75, { shells: [true, true] });
  ctx.cable(n("cable.folder"), [cabPortB, folderPort], 0.75, { shells: [true, true] });
  ctx.cable(n("hose.pushA"), [valveA, w(108, -145.6, 195), w(108, -145.6, 200.5), w(105, -145.6, 200.5), portA], 0.5, { shells: [true, true] });
  ctx.cable(n("hose.pushB"), [valveB, w(108, -142.4, 195), w(108, -142.4, 200.5), w(105, -142.4, 200.5), portB], 0.5, { shells: [true, true] });

  // ---- arms at rest, recorded for the audit (the live page draws them; these shapes let --audit see the links) ----
  const restShapes = (key, spec, W, tool) => {
    const q = makeRig(k, G, P).solve(spec, W);
    const owner = n(`${key}.arm`);
    const rec = (shape) => ctx.record({ ...shape, name: n(`${key}.rest.${shape.part}`), owner });
    const Z = [0, 0, 1];
    const vOf = (e) => G.unit3(G.cross3(e, q.n));
    rec({ ...ctx.A.disc(G.frameAlong([spec.S[0], spec.S[1], spec.yokeZ], Z), 0, 1.1, spec.yokeR), part: "yoke" });
    rec({ ...ctx.A.orientedBox(G.add3(spec.S, [0, 0, (spec.yokeZ + 1.1 - spec.S[2]) / 2]), [q.dir, q.n, Z], [2.6, 3.0, (spec.S[2] - spec.yokeZ - 1.1) / 2]), part: "cheeks" });
    rec({ ...ctx.A.disc(G.frameAlong(spec.S, q.n), -6.8, 3.6, 1.5), part: "shoulder" });
    rec({ ...ctx.A.orientedBox(G.add3(spec.S, G.mul3(q.e1, spec.L1 / 2)), [q.e1, q.n, vOf(q.e1)], [spec.L1 / 2 + spec.r1 * 0.5, 1.6, spec.r1]), part: "link1" });
    rec({ ...ctx.A.disc(G.frameAlong(q.E, q.n), -4.9, 5.0, 1.6), part: "elbow" });
    const L2 = G.len3(G.sub3(q.Wp, q.E));
    rec({ ...ctx.A.orientedBox(G.add3(q.E, G.mul3(q.e2, L2 / 2), G.mul3(q.n, 3.1)), [q.e2, q.n, vOf(q.e2)], [L2 / 2 + spec.r2 * 0.5, 1.3, spec.r2]), part: "link2" });
    rec({ ...ctx.A.disc(G.frameAlong(q.Wp, q.n), 1.2, 7.0, 1.3), part: "wrist" });
    rec({ ...ctx.A.disc(G.frameAlong(G.add3(q.W, [0, 0, -1.9]), [0, 0, -1]), -0.8, 5.7, 1.3), part: "spindle" });
    rec({ ...ctx.A.orientedBox(G.add3(q.W, [0, 0, tool.z]), [[1, 0, 0], [0, 1, 0], Z], tool.half), part: "tool" });
  };
  const pd = { S: w(PLAN.picker.base[0], PLAN.picker.base[1], PLAN.picker.yokeZ + 5.5), yokeZ: PLAN.picker.yokeZ + oz, yokeR: 4.6, L1: PLAN.picker.L1, L2: PLAN.picker.L2, off: 3.1, side: 1, r1: 2.1, r2: 1.8 };
  const fdd = { S: w(PLAN.folder.base[0], PLAN.folder.base[1], PLAN.folder.yokeZ + 5.5), yokeZ: PLAN.folder.yokeZ + oz, yokeR: 4.6, L1: PLAN.folder.L1, L2: PLAN.folder.L2, off: 3.1, side: -1, r1: 2, r2: 1.8 };
  restShapes("picker", pd, w(Gt.pockets[1], Gt.y, gz + 23.4), { z: -8.3, half: [6.6, 0.9, 0.75] });
  restShapes("folder", fdd, w(123, -104, 229), { z: -5.9, half: [3.4, 1.5, 1.5] });

  // ---- live slots -------------------------------------------------------------------------------------
  ctx.slot(`${id}:lane`, { after: n("mag.hopper") });
  ctx.slot(`${id}:picker`, { after: n("folder.slew") });
  ctx.slot(`${id}:folder`, { after: n("folder.slew") });

  // ---- live data (world coordinates) --------------------------------------------------------------------
  const pv = PLAN.picker;
  const fv = PLAN.folder;
  ctx.data[id] = {
    origin,
    prefill: Boolean(opts.prefill),
    gutter: { y: Gt.y + oy, z: gz + oz, pockets: Gt.pockets.map((x) => x + ox), queue: Gt.queue + ox, entry: Gt.x0 + 1.2 + ox, eyes: Gt.pockets.map((x) => w(x, Gt.y + 3.8, gz + 2.1)) },
    lane: { x: Ln.x + ox, z: Ln.z + oz, stations: Ln.stations.map((y) => y + oy), pitch: Ln.pitch, emitY: Ln.emitY + oy, edge: Ln.y1 + oy },
    magazine: { x: M.x + ox, y: M.y + oy, z: Ln.z + oz, hopperZ: M.hopperZ + oz, gateZ: 201.4 + oz },
    pusher: { glandY: -140.4 + oy, z: 200.5 + oz, rest: -139 + oy, out: -128 + oy },
    erector: { x: 100 + ox, y: S0 + oy, glandZ: 213.3 + oz, rest: 212 + oz },
    folderHome: w(123, -104, 229),
    picker: pd,
    folder: fdd,
    ports: { in: w(72, Gt.y, 232), out: w(100, -92, 196) },
    portsLocal: { in: [72 - ANCHOR[0], Gt.y - ANCHOR[1], 232], out: [100 - ANCHOR[0], -92 - ANCHOR[1], 196] },
  };
}

export const CSS = "";

// the page code lives in live.src.js; the rig is injected so build and page share one implementation
export const LIVE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "live.src.js"), "utf8").replace("__MAKE_RIG__", makeRig.toString());
