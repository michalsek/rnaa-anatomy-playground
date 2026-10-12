// QA: sample the live arm volumes along a simulated run and test them against static solids, cartons and each other.
import { simulate } from "./sim.mjs";
const OZ = -150;
const add = (...v) => v.reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
const mul = (a, s) => a.map((x) => x * s);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const len = (a) => Math.hypot(...a);
const unit = (a) => mul(a, 1 / len(a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const box = (name, x0, y0, z0, x1, y1, z1) => ({ name, kind: "box", lo: [x0, y0, z0 + OZ], hi: [x1, y1, z1 + OZ] });
const cyl = (name, x, y, r, z0, z1) => ({ name, kind: "cyl", x, y, r, z0: z0 + OZ, z1: z1 + OZ });
const statics = [
  box("gutter.floor", 74.6, -121, 226.6, 92, -115, 228), box("gutter.wall", 74.6, -121.6, 226.6, 92, -121, 232.6), box("gutter.stop", 92, -121.6, 226.6, 92.8, -114.4, 231.6), box("gutter.near", 74.6, -115, 226.6, 92, -114.2, 230.8), cyl("gutter.post", 86, -118, 1.3, 182, 226.6),
  box("stubA", 36, -122.6, 224, 71, -113.4, 232),
  box("lane.bed", 93, -140, 196, 107, -95.3, 200), box("lane.rail", 93.1, -128.5, 203.5, 94.1, -97.5, 205),
  box("mag.hopper", 93.9, -140, 207, 106.1, -130, 219.4),
  cyl("bridge.postL", 90.5, -124, 1.1, 182, 214), cyl("bridge.postR", 109.5, -124, 1.1, 182, 214), box("bridge.beam", 89.2, -125.3, 214, 110.8, -122.7, 216.4), cyl("bridge.cyl", 100, -124, 2, 216.4, 223.8),
  cyl("picker.pedestal", 78, -103.5, 3.8, 182, 216.5), cyl("picker.turret", 78, -103.5, 5, 216.5, 224.5),
  cyl("folder.pedestal", 121, -99.5, 3.8, 182, 198), cyl("folder.turret", 121, -99.5, 5, 198, 206),
  box("drive", 71.5, -147, 182, 80.5, -137, 195), box("cabinet", 115, -148, 182, 128, -132, 199), box("manifold", 105, -147.4, 182, 111, -141.4, 188.6), box("pusher", 98, -147.2, 182, 102, -141, 202.3),
];
function inside(p, s, pad = 0) {
  if (s.kind === "box") return p.every((v, i) => v > s.lo[i] + pad && v < s.hi[i] - pad);
  return p[2] > s.z0 + pad && p[2] < s.z1 - pad && Math.hypot(p[0] - s.x, p[1] - s.y) < s.r - pad;
}
// sample a slab: from A along a (length L) with half-width w along v, thickness u0..u1 along n
function slab(name, A, a, n, L, w, u0, u1, out) {
  const v = unit(cross(n, a));
  for (let i = 0; i <= 12; i++) for (let j = -2; j <= 2; j++) for (const u of [u0, (u0 + u1) / 2, u1]) out.push({ name, p: add(A, mul(a, (L * i) / 12), mul(v, (w * j) / 2), mul(n, u)) });
}
function armPoints(tag, q, spec, tool) {
  const pts = [];
  const { S } = spec;
  slab(tag + ".link1", S, q.e1, q.n, spec.L1, spec.r1, -1.6, 1.6, pts);
  const L2 = len(sub(q.Wp, q.E));
  slab(tag + ".link2", q.E, q.e2, q.n, L2, spec.r2, 1.8, 4.4, pts);
  slab(tag + ".chain1", S, q.e1, q.n, spec.L1, 1.1, -3.0, -1.8, pts);
  slab(tag + ".chain2", q.E, q.e2, q.n, L2, 1.1, 4.4, 5.6, pts);
  slab(tag + ".elbowServo", add(q.E, mul(q.n, -4.9)), q.n, q.e1, 2.7, 4, 0, 0, pts);
  slab(tag + ".wristCap", add(q.Wp, mul(q.n, 5)), q.n, q.e2, 2, 3.4, 0, 0, pts);
  const W = q.W;
  if (tool === "picker") {
    for (let x = -6.6; x <= 6.6; x += 1.1) for (const y of [-0.9, 0, 0.9]) for (const z of [-9, -7.6]) pts.push({ name: tag + ".bar", p: add(W, [x, y, z]) });
    for (const dx of [-5, 0, 5]) for (let z = -9; z >= -12.6; z -= 0.6) for (let a = 0; a < 6; a++) pts.push({ name: tag + ".cup", p: add(W, [dx + Math.cos(a) * 1.1, Math.sin(a) * 1.1, z]) });
    for (let z = -1.9; z >= -7.6; z -= 0.5) pts.push({ name: tag + ".spindle", p: add(W, [0, 0, z]) });
  } else {
    for (let x = -3.4; x <= 3.4; x += 0.85) for (const y of [-1.5, 0, 1.5]) for (const z of [-7.4, -6, -4.4]) pts.push({ name: tag + ".block", p: add(W, [x, y, z]) });
    for (let x = 0.3; x <= 4.5; x += 0.6) for (const z of [-8.1, -9]) pts.push({ name: tag + ".roller", p: add(W, [x, 0, z]) });
    for (const x of [-3, 3]) pts.push({ name: tag + ".finger", p: add(W, [x, 0, -8.6]) });
  }
  return pts;
}
function cartonBoxes(c) {
  const out = [box("carton", c.x - 5, c.y - 4, c.z - OZ, c.x + 5, c.y + 4, c.z - OZ + c.H)];
  return out;
}
const run = simulate({ seconds: Number(process.argv[2] ?? 14) });
const D = run.data;
const hits = new Map();
const note = (key, t, depth, phaseInfo) => { const h = hits.get(key) ?? { n: 0, t0: t, t1: t, worst: 0, phases: new Set() }; h.n++; h.t1 = t; h.worst = Math.max(h.worst, depth); h.phases.add(phaseInfo); hits.set(key, h); };
let minArmGap = Infinity, minAt = null;
for (const s of run.poses) {
  const pp = armPoints("picker", s.picker, D.picker, "picker");
  const fp = armPoints("folder", s.folder, D.folder, "folder");
  const solids = [...statics, ...s.cartons.filter((c) => c.stage !== "blank").flatMap(cartonBoxes)];
  for (const [pts, ph] of [[pp, "picker:" + s.picker.phase], [fp, "folder:" + s.folder.phase]]) {
    for (const { name, p } of pts) for (const so of solids) if (inside(p, so, 0.05)) note(name + " × " + so.name, s.t, 0, ph);
  }
  // arm against arm: closest sample distance
  for (const a of pp) for (const b of fp) { const d = len(sub(a.p, b.p)); if (d < minArmGap) { minArmGap = d; minAt = { t: s.t, a: a.name, b: b.name, pp: s.picker.phase, fp: s.folder.phase }; } }
}
for (const [k, h] of hits) console.log(k.padEnd(40), "frames", h.n, "t", h.t0.toFixed(2), "…", h.t1.toFixed(2), [...h.phases].join(","));
console.log("closest picker↔folder sample gap", minArmGap.toFixed(2), JSON.stringify(minAt));
