import { simulate } from "./sim.mjs";
const r = simulate({ seconds: 20 });
const add = (...v) => v.reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
const mul = (a, s) => a.map((x) => x * s);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const len = (a) => Math.hypot(...a);
const unit = (a) => mul(a, 1 / len(a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// dense volume samples of the folder's elbow + link parts as cylinders/slabs
function cylPts(c, axis, s0, s1, rad) { const a = unit(axis); const u = unit(cross(a, Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])); const v = cross(a, u); const out = []; for (let s = s0; s <= s1 + 1e-9; s += (s1 - s0) / 6) for (let rr = 0; rr <= rad; rr += rad / 3) for (let k = 0; k < 16; k++) { const t = (k / 16) * 2 * Math.PI; out.push(add(c, mul(a, s), mul(u, rr * Math.cos(t)), mul(v, rr * Math.sin(t)))); } return out; }
function slabPts(A, a, n, L, w, u0, u1) { const v = unit(cross(n, a)); const out = []; for (let i = 0; i <= 40; i++) for (let j = -4; j <= 4; j++) for (let k = 0; k <= 4; k++) { const s = -w + ((L + 2 * w) * i) / 40; const q = (w * j) / 4; const ds = s < 0 ? s : s > L ? s - L : 0; if (Math.hypot(ds, q) > w) continue; out.push(add(A, mul(a, s), mul(v, q), mul(n, u0 + ((u1 - u0) * k) / 4))); } return out; }
function folderParts(q, spec) { const L2 = len(sub(q.Wp, q.E)); return {
  elbowServo: cylPts(q.E, q.n, -4.9, -2.2, 2.0), elbowCapFar: cylPts(q.E, q.n, -2.2, -1.6, 1.6), elbowCapNear: cylPts(q.E, q.n, 4.4, 5.0, 1.4),
  link1: slabPts(spec.S, q.e1, q.n, spec.L1, spec.r1, -1.6, 1.6).filter((p, i) => true), link2: slabPts(q.E, q.e2, q.n, L2, spec.r2, 1.8, 4.4), wristCap: cylPts(q.Wp, q.n, 5.0, 7.0, 1.7) }; }
const inBox = (p, lo, hi) => p.every((v, i) => v > lo[i] && v < hi[i]);
const res = {};
for (const s of r.poses) {
  const W = s.picker.W;
  const boxes = { bar: [add(W, [-6.6, -0.9, -9]), add(W, [6.6, 0.9, -7.6])], cups: [add(W, [-6.35, -1.35, -12.6]), add(W, [6.35, 1.35, -9])], spindle: [add(W, [-1.8, -1.8, -7.6]), add(W, [1.8, 1.8, -1.9])] };
  const fp = folderParts(s.folder, r.data.folder);
  for (const [bn, [lo, hi]] of Object.entries(boxes)) for (const [pn, pts] of Object.entries(fp)) {
    let n = 0; for (const p of pts) if (inBox(p, lo, hi)) n++;
    if (n) { const key = "picker." + bn + " × folder." + pn; const e = (res[key] ??= { frames: 0, maxPts: 0, t: [], ph: new Set() }); e.frames++; e.maxPts = Math.max(e.maxPts, n); e.t.push(s.t); e.ph.add(s.picker.phase + "/" + s.folder.phase); }
  }
}
for (const [k, e] of Object.entries(res)) console.log(k, "frames", e.frames, "max samples inside", e.maxPts, "t", e.t[0].toFixed(2), "…", e.t.at(-1).toFixed(2), [...e.ph].join(" "));
if (!Object.keys(res).length) console.log("no picker-tool × folder overlap");
