// Conveyors: "top" (single-sided belt on legs) and "loop" (the audio belt: double sided, items ride on top and come
// back hanging underneath). One module, built relative to its origin with the shared kit; moving parts are drawn live
// into slots.
import { k, G, A } from "../../shared/kit.mjs";

// Parcel size (runtime packetSvg default) and the loop's hanging geometry, shared by the build and the page.
const PK = { w: 10, d: 8, h: 7 };
const CH = 1.2; // cleat height
const HOOK = 6; // a hanging parcel's top sits this far below its cleat

// A belt frame: s along the axis from the origin, c across (+c toward the viewer), z up from the origin's floor.
function frameOf(ctx, [ox, oy, oz = 0], axis) {
  const sV = axis === "y" ? [0, 1, 0] : [1, 0, 0];
  const cV = axis === "y" ? [1, 0, 0] : [0, 1, 0];
  const w = (s, c, z) => (axis === "y" ? [ox + c, oy + s, oz + z] : [ox + s, oy + c, oz + z]);
  const UPV = [0, 0, 1];
  const { P, S, Ln } = ctx;
  // an axis-aligned block given in belt coordinates; owner lets a part sit inside its own assembly
  const box = (name, [s0, s1], [c0, c1], [z0, z1], style = {}, { owner, ground = false, r = 0.4, steps = 3, bevel = 0, extra = "", inner = "", seams = [], bias = 0 } = {}) => {
    const a = w(Math.min(s0, s1), Math.min(c0, c1), z0);
    const b = w(Math.max(s0, s1), Math.max(c0, c1), z1);
    const plan = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), d: Math.abs(b[1] - a[1]), r };
    const Z0 = oz + z0;
    const H = z1 - z0;
    const shape = ctx.record(A.slab(plan, Z0, H, { name, ...(owner ? { owner } : {}), ...(ground ? { ground } : {}) }, steps));
    const seamLines = seams.map((z) => k.sideSeam(plan, oz + z, P, steps)).join("");
    ctx.put(name, [plan.x + plan.w / 2, plan.y + plan.d / 2, Z0 + H / 2], S(k.slabOf(plan, Z0, H, P, steps, bevel), { tone: "mid", ...style, inner: inner + (seamLines ? Ln(seamLines, { tone: "faint" }) : "") }) + extra, [shape], { bias });
    return plan;
  };
  const alongC = (s, c, z) => G.frameOf(w(s, c, z), cV, sV, UPV);
  const alongS = (s, c, z, sign = 1) => G.frameOf(w(s, c, z), G.mul3(sV, sign), cV, UPV);
  const up = (s, c, z) => G.frameOf(w(s, c, z), UPV, sV, cV);
  // a convex prism across the belt (c from c0 to c1) of a polygon in the (s, z) plane
  const prism = (name, polygon, [c0, c1], [s, z], style = {}, { owner, extra = "", inner = "", bias = 0 } = {}) => {
    const F = alongC(s, 0, z);
    const shape = ctx.record(A.prism(F, polygon, c0, c1, { name, ...(owner ? { owner } : {}) }));
    const mid = polygon.reduce((acc, p) => [acc[0] + p[0] / polygon.length, acc[1] + p[1] / polygon.length], [0, 0]);
    ctx.put(name, w(s + mid[0], (c0 + c1) / 2, z + mid[1]), S(G.prismOf(F, polygon, c0, c1, P), { tone: "mid", ...style, inner }) + extra, [shape], { bias });
  };
  // screw heads on a horizontal face at height z (belt coordinates)
  const screws = (points, z, opts) => ctx.screws(points.map(([s, c]) => w(s, c, z)), oz + z, opts);
  return { sV, cV, w, oz, box, alongC, alongS, up, prism, screws };
}

const arc = (r, a0, a1, n = 24) => Array.from({ length: n + 1 }, (_, i) => {
  const a = a0 + ((a1 - a0) * i) / n;
  return [r * Math.cos(a), r * Math.sin(a)];
});
const clampOpt = (id, name, value, least) => {
  if (value >= least) return value;
  console.warn(`${id}: ${name} ${value} raised to ${least}`);
  return least;
};

// The belt itself: top run, return run, half-drum wraps (D prisms), half drum cores, flanges and hubs.
function beltBody(ctx, id, f, { L, W, T, RD, BT, flangeR, flangeT, hubR, hubL, bolts }) {
  const RW = RD + BT;
  const zc = T - RW;
  const owner = `${id}.belt`;
  const half = W / 2;
  // only the inner half of each core shows: the outer half is inside its wrap
  f.prism(`${id}.drum0.core`, arc(RD, -Math.PI / 2, Math.PI / 2, 28), [-half, half], [0, zc], { tone: "lo" }, { owner });
  f.prism(`${id}.drum1.core`, arc(RD, Math.PI / 2, (3 * Math.PI) / 2, 28), [-half, half], [L, zc], { tone: "lo" }, { owner });
  // runs: thin slabs between the drum centres
  f.box(`${id}.belt`, [0, L], [-half, half], [T - BT, T], { tone: "mid" }, { owner, r: 0.2, steps: 2 });
  f.box(`${id}.belt.bottom`, [0, L], [-half, half], [zc - RW, zc - RD], { tone: "mid" }, { owner, r: 0.2, steps: 2 });
  // wraps: the back half of the s=0 drum, the front half of the s=L drum
  f.prism(`${id}.wrap0`, arc(RW, Math.PI / 2, (3 * Math.PI) / 2, 28), [-half, half], [0, zc], { tone: "mid" }, { owner });
  f.prism(`${id}.wrap1`, arc(RW, -Math.PI / 2, Math.PI / 2, 28), [-half, half], [L, zc], { tone: "mid" }, { owner });
  // flanges with bolt circles and hubs, both sides of both drums
  [0, L].forEach((s, i) => {
    [-1, 1].forEach((side) => {
      const near = side > 0;
      const face = f.alongC(s, half, zc);
      const extra = near ? ctx.Ln(G.circleOf(face, flangeT, hubR + 1.2, ctx.P) + G.circleOf(face, flangeT, flangeR - 0.6, ctx.P), { tone: "faint" }) + ctx.Dots(G.dotsOf(face, flangeT, flangeR - 1.6, bolts, ctx.P, { all: true }), { size: 0.45 }) : "";
      const Fl = near ? f.alongC(s, half, zc) : f.alongC(s, -half - flangeT, zc);
      ctx.turned(`${id}.drum${i}.flange${near ? "N" : "F"}`, Fl, [[0, flangeR], [flangeT, flangeR]], { tone: "mid" }, { owner, bevel: 0.25, extra });
      const Fh = near ? f.alongC(s, half + flangeT, zc) : f.alongC(s, -half - flangeT - hubL, zc);
      ctx.turned(`${id}.drum${i}.hub${near ? "N" : "F"}`, Fh, [[0, hubR], [hubL, hubR]], { tone: "lo" }, { owner });
    });
  });
  return { RW, zc };
}

// a small hex nut (drawn as a short turned part) on a face whose outward normal is +c
function nutOnC(ctx, f, name, s, c, z, r = 0.9, t = 0.6) {
  ctx.turned(name, f.alongC(s, c, z), [[0, r], [t, r]], { tone: "mid" }, { steps: 6, extra: ctx.Dots([ctx.at(f.w(s, c + t, z))], { size: 0.35 }) });
}

// the lit accent: a lens in a bezel on a small steel plate, on a face whose outward normal is +c
function lamp(ctx, f, id, s, c, z, r = 1.5) {
  const plateH = r * 2 + 2.2;
  f.box(`${id}.lamp.plate`, [s - r - 1.6, s + r + 1.6], [c, c + 0.5], [z - plateH / 2, z + plateH / 2], { tone: "mid" }, { r: 0.3, steps: 2, bevel: 0.15, extra: ctx.Dots([s - r - 0.9, s + r + 0.9].map((ss) => ctx.at(f.w(ss, c + 0.5, z))), { size: 0.4 }) });
  ctx.turned(`${id}.lamp.bezel`, f.alongC(s, c + 0.5, z), [[0, r + 0.6], [0.5, r + 0.6]], { tone: "mid" }, { bevel: 0.15 });
  ctx.turned(`${id}.lamp.lens`, f.alongC(s, c + 1.0, z), [[0, r, 1], [0.35, r * 0.85, 1], [0.6, r * 0.45, 1], [0.7, 0.01, 1]], { tone: "hi", lit: true });
}

// a label plate on the near face (outward normal +c) with three rule lines and two screws
function labelPlate(ctx, f, id, sMid, c, z0, z1, len = 16) {
  if (!(len > 7)) return;
  const face = c + 0.4;
  const zs = [z1 - 1.3, z1 - 2.4, z1 - 3.5].filter((z) => z > z0 + 0.9);
  const lens = [0.62, 0.8, 0.45];
  const rules = zs.map((z, i) => k.segment(f.w(sMid - len / 2 + 2.8, face, z), f.w(sMid - len / 2 + 2.8 + (len - 5.6) * lens[i], face, z), ctx.P)).join("");
  const screws = [sMid - len / 2 + 1.3, sMid + len / 2 - 1.3].map((s) => ctx.at(f.w(s, face, (z0 + z1) / 2)));
  f.box(`${id}.label`, [sMid - len / 2, sMid + len / 2], [c, face], [z0, z1], { tone: "mid" }, { r: 0.2, steps: 2, extra: ctx.Ln(rules, { tone: "lo", free: true }) + ctx.Dots(screws, { size: 0.45 }) });
}

// a drive motor along the s axis (sign ±1 away from the gearbox face at s), axis at (c, z)
function motor(ctx, f, id, s, c, z, sign, { r = 2.9, len = 14 } = {}) {
  const F = f.alongS(s, c, z, sign);
  const profile = [[0, r + 0.4], [0.8, r + 0.4], [0.8, r], [len - 3, r], [len - 3, r - 0.25], [len, r - 0.25]];
  const ribs = k.fadedSvg(G.ribsOf(F, 1.6, len - 3.8, r, 26, ctx.P, { fade: [0.1, 0.55], seams: true }), { tone: "lo" });
  const vents = ctx.Ln([len - 2.2, len - 1.4, len - 0.6].map((t) => G.arcOf(F, t, r - 0.25, ctx.P)).join(""), { tone: "faint" });
  ctx.turned(`${id}.motor`, F, profile, { tone: "mid" }, { inner: ribs + vents, bevel: 0.2 });
  // terminal box on top of the motor
  const tb0 = s + sign * 3;
  const tb1 = s + sign * 7.4;
  f.box(`${id}.motor.tbox`, [tb0, tb1], [c - 1.5, c + 1.5], [z + r, z + r + 2.2], { tone: "mid" }, { r: 0.3, steps: 2, bevel: 0.2, extra: ctx.Dots([f.w((tb0 + tb1) / 2 - sign * 1.2, c - 0.8, z + r + 2.2), f.w((tb0 + tb1) / 2 + sign * 1.2, c + 0.8, z + r + 2.2)].map(ctx.at), { size: 0.4 }) });
}

export function build(ctx, origin, opts = {}) {
  const material = ctx.material;
  const result = (opts.type ?? "top") === "loop" ? buildLoop(ctx, origin, opts) : buildTop(ctx, origin, opts);
  ctx.material = material;
  return result;
}

// a feedFrom offset from the origin → world point
const worldOffset = ([ox, oy, oz = 0], d) => (d ? [ox + d[0], oy + d[1], oz + d[2]] : null);

// ---------------------------------------------------------------------------------------------------------------
// "top": a single-sided belt on legs
function buildTop(ctx, origin, opts) {
  const id = opts.id ?? "belt";
  const axis = opts.axis ?? "x";
  const dir = opts.dir ?? 1;
  const L = clampOpt(id, "length", opts.length ?? 120, 30);
  const T = clampOpt(id, "top", opts.top ?? 60, 20);
  // the parcel lane (10 across on a y belt, 8 on an x belt) must clear the guide bars by a unit each side
  const W = clampOpt(id, "width", opts.width ?? 16, (axis === "y" ? PK.w : PK.d) + 4);
  const half = W / 2;
  // legs: false leaves the frame hanging (the assembly hangs machines in the air): the rails become its ground
  const standing = opts.legs ?? true;
  const f = frameOf(ctx, origin, axis);
  const RD = 3.6;
  const BT = 1.2;
  ctx.material = "";
  const { RW, zc } = beltBody(ctx, id, f, { L, W, T, RD, BT, flangeR: 5.4, flangeT: 0.8, hubR: 1.5, hubL: 1.6, bolts: 6 });
  const cWebIn = half + 2.4;
  const cWebOut = half + 4.0;
  const zRail0 = T - 13;
  const zRail1 = T - 2.2;
  const sR0 = -7;
  const sR1 = L + 7;
  // side channels: web plus an outward bottom lip
  for (const side of [-1, 1]) {
    const tag = side > 0 ? "N" : "F";
    f.box(`${id}.rail${tag}`, [sR0, sR1], [side * cWebIn, side * cWebOut], [zRail0 + 0.8, zRail1], { tone: "mid" }, { r: 0.2, steps: 2, bevel: 0.2, ground: !standing });
    f.box(`${id}.rail${tag}.lip`, [sR0, sR1], [side * cWebIn, side * (cWebOut + 1.6)], [zRail0, zRail0 + 0.8], { tone: "lo" }, { r: 0.2, steps: 2 });
  }
  // carrying idlers under the top run: their ends show beside the belt between the rails
  const idlerR = 1.8;
  const idlerZ = T - BT - idlerR;
  const idlers = [];
  const idlerStep = (L - 20) / Math.max(1, Math.round((L - 20) / 9));
  for (let s = 10; s <= L - 10 + 1e-6; s += idlerStep) idlers.push(s);
  idlers.forEach((s) => {
    ctx.turned(`${id}.idler`, f.alongC(s, -cWebIn, idlerZ), [[0, idlerR], [2 * cWebIn, idlerR]], { tone: "hi" }, { inner: ctx.Ln([2.4, 2 * cWebIn - 2.4].map((t) => G.arcOf(f.alongC(s, -cWebIn, idlerZ), t, idlerR, ctx.P)).join(""), { tone: "faint" }) });
    nutOnC(ctx, f, `${id}.idler.nut`, s, cWebOut, idlerZ, 0.9, 0.5);
  });
  // return idlers under the return run
  const retR = 1.3;
  const retZ = zc - RW - retR;
  for (let s = 14; s <= L - 14 + 1e-6; s += Math.max(20, (L - 28) / Math.max(1, Math.round((L - 28) / 26)))) {
    ctx.turned(`${id}.return`, f.alongC(s, -cWebIn, retZ), [[0, retR], [2 * cWebIn, retR]], { tone: "lo" });
    nutOnC(ctx, f, `${id}.return.nut`, s, cWebOut, retZ, 0.8, 0.5);
  }
  // bearings: pillow blocks on the near rail at the idle drum, both drums on the far rail (hidden, but held)
  const sDrive = dir > 0 ? L : 0;
  const sIdle = dir > 0 ? 0 : L;
  const pillow = (name, s, side) => {
    const c0 = side * cWebOut;
    const c1 = side * (cWebOut + 2.0);
    f.box(name, [s - 3.2, s + 3.2], [c0, c1], [zc - 2.6, zc + 2.2], { tone: "mid" }, { r: 0.5, steps: 3, bevel: 0.25, extra: side > 0 ? ctx.Dots([f.w(s - 2.1, (c0 + c1) / 2, zc + 2.2), f.w(s + 2.1, (c0 + c1) / 2, zc + 2.2)].map(ctx.at), { size: 0.45 }) : "" });
    if (side > 0) ctx.turned(`${name}.cap`, f.alongC(s, c1, zc), [[0, 1.5], [0.7, 1.5], [0.7, 0.9], [1.2, 0.9]], { tone: "lo" }, { extra: ctx.Dots([ctx.at(f.w(s, c1 + 1.2, zc))], { size: 0.4 }) });
  };
  pillow(`${id}.bearing.idle`, sIdle, 1);
  pillow(`${id}.bearing.idleF`, sIdle, -1);
  pillow(`${id}.bearing.driveF`, sDrive, -1);
  // the lit accent: a run lamp on the near rail, just inside the idle drum's bearing
  lamp(ctx, f, id, sIdle + dir * 6.4, cWebOut, T - 7.2, 1.0);
  // drive: gearbox on the near rail at the drive drum, motor along the rail toward the middle
  ctx.material = "fx-graphite";
  const gbC0 = cWebOut;
  const gbC1 = cWebOut + 6.0;
  f.box(`${id}.gearbox`, [sDrive - 4, sDrive + 4], [gbC0, gbC1], [zc - 4.6, zc + 2.4], { tone: "mid" }, { r: 0.9, steps: 4, bevel: 0.3, seams: [zc - 1.2] });
  ctx.turned(`${id}.gearbox.cover`, f.alongC(sDrive, gbC1, zc), [[0, 2.3], [0.7, 2.3], [0.7, 1.2], [1.3, 1.2]], { tone: "mid" }, { extra: ctx.Dots(G.dotsOf(f.alongC(sDrive, gbC1, zc), 0.7, 1.75, 6, ctx.P, { all: true }), { size: 0.4 }) });
  ctx.turned(`${id}.gearbox.breather`, f.up(sDrive + 1.6 * -dir, (gbC0 + gbC1) / 2 + 0.8, zc + 2.4), [[0, 0.7], [0.7, 0.7], [0.7, 0.45], [1.3, 0.45]], { tone: "lo" });
  const mSign = dir > 0 ? -1 : 1;
  motor(ctx, f, id, sDrive + mSign * 4, (gbC0 + gbC1) / 2, zc - 1.4, mSign, { r: 2.8, len: Math.min(14, L * 0.4) });
  ctx.material = "";
  // side guides: bars over the belt edges on arms and posts. The near bar stops 12 short of the front drum, so a
  // parcel moving into the front drum's slot is already clear of it.
  for (const side of [-1, 1]) {
    const tag = side > 0 ? "N" : "F";
    const cp = side * (half + 3.2);
    const b0 = 2;
    const b1 = side > 0 ? L - 12 : L - 2;
    const n = Math.max(2, Math.round((b1 - b0 - 4) / 24) + 1);
    for (let i = 0; i < n; i++) {
      const s = b0 + 2 + ((b1 - b0 - 4) * i) / (n - 1);
      ctx.turned(`${id}.guide${tag}.post`, f.up(s, cp, zRail1), [[0, 0.6], [T + 4.2 - zRail1, 0.6]], { tone: "mid" });
      f.box(`${id}.guide${tag}.arm`, [s - 0.5, s + 0.5], [side * (half + 0.2), side * (half + 2.6)], [T + 2.8, T + 3.8], { tone: "mid" }, { r: 0.15, steps: 2 });
    }
    f.box(`${id}.guide${tag}`, [b0, b1], [side * (half - 1.0), side * (half + 0.2)], [T + 2.4, T + 4.2], { tone: "mid" }, { r: 0.3, steps: 2, bevel: 0.2 });
  }
  // legs with feet, cross braces and a near longitudinal brace
  const legs = [];
  const nLegs = standing ? Math.max(2, Math.ceil((L - 12) / 54) + 1) : 0;
  for (let i = 0; i < nLegs; i++) legs.push(6 + ((L - 12) * i) / (nLegs - 1));
  const cLeg0 = half + 2.0;
  const cLeg1 = half + 4.4;
  const braceZ = [Math.max(4, zRail0 * 0.18), zRail0 * 0.62].filter((z, i, a) => (i === 0 ? z + 4 < zRail0 : z - a[0] > 10));
  legs.forEach((s) => {
    for (const side of [-1, 1]) {
      const tag = side > 0 ? "N" : "F";
      f.box(`${id}.leg${tag}`, [s - 1.2, s + 1.2], [side * cLeg0, side * cLeg1], [1.2, zRail0], { tone: "mid" }, { r: 0.3, steps: 2, bevel: 0.2 });
      f.box(`${id}.foot${tag}`, [s - 2.6, s + 2.6], [side * (cLeg0 - 1.4), side * (cLeg1 + 1.4)], [0, 1.2], { tone: "lo" }, { r: 0.6, steps: 3, bevel: 0.2, extra: side > 0 ? f.screws([[s - 1.9, (cLeg0 + cLeg1) / 2], [s + 1.9, (cLeg0 + cLeg1) / 2]], 1.2, { ring: 0.6, size: 0.35 }) : "" });
    }
    braceZ.forEach((z) => f.box(`${id}.brace`, [s - 0.7, s + 0.7], [-cLeg0, cLeg0], [z, z + 1.4], { tone: "lo" }, { r: 0.2, steps: 2 }));
  });
  if (braceZ.length)
    for (let i = 0; i + 1 < legs.length; i++) {
      const z = braceZ[0] + 3;
      f.box(`${id}.stretcherN`, [legs[i] + 1.2, legs[i + 1] - 1.2], [half + 2.6, half + 3.8], [z, z + 1.2], { tone: "lo" }, { r: 0.2, steps: 2 });
    }
  // label plate on the near rail between two idlers in the middle
  if (idlers.length > 3) {
    const m = Math.floor(idlers.length / 2);
    labelPlate(ctx, f, id, (idlers[m - 1] + idlers[m]) / 2, cWebOut, T - 9.4, T - 4.4, Math.min(14, idlerStep * 1.6));
  }

  // slots: slats then items on the top run; slats on each visible wrap
  ctx.slot(`${id}:slats`, { after: `${id}.belt` });
  ctx.slot(`${id}:top`, { after: `${id}.belt` });
  ctx.slot(`${id}:wrapSlats0`, { after: `${id}.wrap0` });
  ctx.slot(`${id}:wrapSlats1`, { after: `${id}.wrap1` });
  ctx.slot(`${id}:end1`, { after: `${id}.wrap1` }); // parcels over the front drum: it is drawn after the top run
  const inS = opts.inAt ?? (dir > 0 ? 8 : L - 8);
  const outS = opts.outAt ?? (dir > 0 ? L : 0);
  const tip = (opts.tip ?? true) && (dir > 0 ? outS >= L - 0.01 : outS <= 0.01);
  ctx.data[id] = {
    id, type: "top", axis, origin: [origin[0], origin[1], origin[2] ?? 0], dir, L, W, T, BT, RW, zc, speed: opts.speed ?? 14, pitch: opts.pitch ?? 4,
    inS, outS, tip, feedFrom: worldOffset(origin, opts.feedFrom), light: G.lightOf(ctx.P),
    ports: { in: f.w(inS, 0, T), out: tip ? f.w(outS + dir * (RW + 6), 0, T - 16) : f.w(outS, 0, T) },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// "loop": the audio belt
function buildLoop(ctx, origin, opts) {
  const id = opts.id ?? "audio";
  const axis = opts.axis ?? "x";
  const dir = opts.dir ?? -1;
  const L = clampOpt(id, "length", opts.length ?? 216, 110);
  const BT = 1.2;
  const RW = clampOpt(id, "drum", opts.drum ?? 15, 10);
  const RD = RW - BT;
  // hanging parcels (cleat, hook, parcel) must clear the floor by 8
  const T = clampOpt(id, "top", opts.top ?? 92, 2 * RW + CH + HOOK + PK.h + 8);
  // the bail straps sit outside the parcel lane: keep them on the belt
  const W = clampOpt(id, "width", opts.width ?? 18, (axis === "y" ? PK.w : PK.d) + 4);
  const half = W / 2;
  // legs: false leaves the truss hanging (the assembly hangs machines in the air): the chords become its ground
  const standing = opts.legs ?? true;
  const f = frameOf(ctx, origin, axis);
  ctx.material = "";
  const flangeR = RW + 2.2;
  const { zc } = beltBody(ctx, id, f, { L, W, T, RD, BT, flangeR, flangeT: 1.2, hubR: 0.21 * RW, hubL: 1.8, bolts: 12 });
  const zHang = zc - RW - CH - HOOK - PK.h; // bottom of a hanging parcel
  const cIn = half + 1.2 + 1.8; // stringer inner face: flange + hub
  const cOut = cIn + 1.6;
  const zBot0 = zc - RW + 3.0; // bottom chord, above the lower run
  const zBot1 = zBot0 + 3.2;
  const zTop1 = T - BT - 0.8;
  const zTop0 = zTop1 - 3.6;
  const sEnd = 9;
  const sHead = dir > 0 ? L : 0;
  const sTail = dir > 0 ? 0 : L;
  const inward = dir > 0 ? 1 : -1; // from the tail drum toward the middle
  const toMid = -inward; // from the head drum toward the middle
  const TAKEUP = 19; // the take-up reaches this far in from the tail drum
  // truss stringers: top chord, bottom chord, end plates at the drums (the tail one carries the take-up), verticals
  const verts = [];
  const nV = Math.max(2, Math.round((L - 2 * sEnd) / 30));
  for (let i = 1; i < nV; i++) {
    const s = sEnd + ((L - 2 * sEnd) * i) / nV;
    if (Math.abs(s - sTail) > TAKEUP + 2) verts.push(s);
  }
  for (const side of [-1, 1]) {
    const tag = side > 0 ? "N" : "F";
    const cc = [side * cIn, side * cOut];
    f.box(`${id}.chordTop${tag}`, [-sEnd, L + sEnd], cc, [zTop0, zTop1], { tone: "mid" }, { r: 0.2, steps: 2, bevel: 0.2, ground: !standing });
    f.box(`${id}.chordBot${tag}`, [-sEnd, L + sEnd], cc, [zBot0, zBot1], { tone: "mid" }, { r: 0.2, steps: 2, bevel: 0.2, ground: !standing });
    [0, L].forEach((s, i) => {
      const [a, b] = s === sTail ? [s - inward * sEnd, s + inward * TAKEUP] : [s - sEnd, s + sEnd];
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const rivets = side > 0 ? ctx.Dots([lo + 1.6, (lo + hi) / 2, hi - 1.6].flatMap((ss) => [zBot1 + 1.4, zTop0 - 1.4].map((z) => ctx.at(f.w(ss, cOut, z)))), { size: 0.45 }) : "";
      f.box(`${id}.endPlate${i}${tag}`, [lo, hi], cc, [zBot1, zTop0], { tone: "mid" }, { r: 0.6, steps: 3, extra: rivets });
    });
    // verticals, riveted to the chords at both ends
    verts.forEach((s) => f.box(`${id}.vert${tag}`, [s - 1.0, s + 1.0], cc, [zBot1, zTop0], { tone: "lo" }, { r: 0.2, steps: 2, extra: side > 0 ? ctx.Dots([zBot1 + 1.1, zBot1 + 2.3, zTop0 - 2.3, zTop0 - 1.1].map((z) => ctx.at(f.w(s, cOut, z))), { size: 0.4 }) : "" }));
  }
  // carrying idlers under the top run, axle stubs into the top chords
  const idlerR = 2.2;
  const idlerZ = T - BT - idlerR;
  const i0 = flangeR + 6;
  const idlers = [];
  for (let s = i0; s <= L - i0 + 1e-6; s += (L - 2 * i0) / Math.max(1, Math.round((L - 2 * i0) / 16))) idlers.push(s);
  idlers.forEach((s) => {
    ctx.turned(`${id}.idler`, f.alongC(s, -half, idlerZ), [[0, idlerR], [W, idlerR]], { tone: "hi" }, { inner: ctx.Ln([1.6, W - 1.6].map((t) => G.arcOf(f.alongC(s, -half, idlerZ), t, idlerR, ctx.P)).join(""), { tone: "faint" }) });
    for (const side of [-1, 1]) ctx.turned(`${id}.idler.stub`, f.alongC(s, side > 0 ? half : -cIn, idlerZ), [[0, 0.7], [cIn - half, 0.7]], { tone: "lo" });
  });
  // return rollers under the lower run's edges, outside the bail straps, on hangers from the bottom chords
  const legs = [24, L - 24];
  if (L > 150) legs.splice(1, 0, L / 2);
  {
    const rr = 1.2;
    const rz = zc - RW - rr;
    const c0 = (axis === "y" ? PK.w : PK.d) / 2 + 0.45 + 0.35 + 0.9; // clear of the bail straps
    const n = Math.max(2, Math.round(L / 60));
    for (let i = 0; i < n; i++) {
      let s = (L * (i + 0.5)) / n;
      if (legs.some((x) => Math.abs(x - s) < 5)) s += 8;
      for (const side of [-1, 1]) {
        const tag = side > 0 ? "N" : "F";
        ctx.turned(`${id}.retRoller${tag}`, f.alongC(s, side > 0 ? c0 : -half, rz), [[0, rr], [half - c0, rr]], { tone: "hi" });
        const hc = [side * (cIn - 1.2), side * cIn];
        ctx.turned(`${id}.retRoller${tag}.axle`, f.alongC(s, side > 0 ? half : -(cIn - 1.2), rz), [[0, 0.5], [cIn - 1.2 - half, 0.5]], { tone: "lo" });
        f.box(`${id}.retHanger${tag}`, [s - 1.2, s + 1.2], hc, [rz - 1.8, zBot0 + 2.2], { tone: "lo" }, { r: 0.3, steps: 2, extra: side > 0 ? ctx.Dots([ctx.at(f.w(s, cIn, rz)), ctx.at(f.w(s, cIn, zBot0 + 1.2))], { size: 0.4 }) : "" });
      }
    }
  }
  // pillow blocks on the outside of the end plates
  const pbH = Math.min(3.6, 0.26 * RW);
  const pb = (name, s, side) => {
    const c0 = side * cOut;
    const c1 = side * (cOut + 3.0);
    f.box(name, [s - 4, s + 4], [c0, c1], [zc - pbH, zc + pbH], { tone: "mid" }, { r: 0.8, steps: 3, bevel: 0.3, seams: side > 0 ? [zc] : [], extra: side > 0 ? ctx.Dots([f.w(s - 2.6, (c0 + c1) / 2, zc + pbH), f.w(s + 2.6, (c0 + c1) / 2, zc + pbH)].map(ctx.at), { size: 0.5 }) : "" });
  };
  pb(`${id}.bearing.headF`, sHead, -1);
  pb(`${id}.bearing.tailF`, sTail, -1);
  pb(`${id}.bearing.head`, sHead, 1);
  // take-up at the tail: the bearing slides between two guide rails, pushed by a coil spring from a fixed bracket
  const tuC0 = cOut;
  const tuC1 = cOut + 3.0;
  const rail = (name, z0, z1) => f.box(name, [sTail + inward * (TAKEUP - 1), sTail - inward * 6], [tuC0, tuC1 - 0.6], [z0, z1], { tone: "lo" }, { r: 0.2, steps: 2, bevel: 0.15 });
  rail(`${id}.takeup.railTop`, zc + pbH, zc + pbH + 1.4);
  rail(`${id}.takeup.railBot`, zc - pbH - 1.4, zc - pbH);
  pb(`${id}.bearing.tail`, sTail, 1);
  const brS0 = sTail + inward * (TAKEUP - 3);
  const brS1 = sTail + inward * (TAKEUP - 1);
  f.box(`${id}.takeup.bracket`, [brS0, brS1], [tuC0, tuC1], [zc - pbH, zc + pbH], { tone: "mid" }, { owner: `${id}.takeup`, r: 0.4, steps: 2, bevel: 0.2 });
  const rodC = (tuC0 + tuC1) / 2;
  const springFrom = sTail + inward * 4; // bearing face
  const springTo = brS0;
  ctx.turned(`${id}.takeup.rod`, f.alongS(brS0, rodC, zc, -inward), [[0, 0.55], [Math.abs(brS0 - springFrom), 0.55]], { tone: "hi" }, { owner: `${id}.takeup` });
  ctx.turned(`${id}.takeup.nut`, f.alongS(brS1, rodC, zc, inward), [[0, 1.1], [1.0, 1.1]], { tone: "mid" }, { steps: 6, owner: `${id}.takeup` });
  // coil spring split around the rod; each half recorded as the half box it occupies; its two ends are hooked
  // into the bearing and the bracket (terminal dots), so neither stops in the air
  {
    const R0 = 1.25;
    const turns = 7;
    const [wa, wb] = [f.w(springFrom, rodC, zc), f.w(springTo, rodC, zc)];
    const axisKey = axis === "y" ? "y" : "x";
    const from = axis === "y" ? wa[1] : wa[0];
    const to = axis === "y" ? wb[1] : wb[0];
    const centre = axis === "y" ? [wa[0], wa[2]] : [wa[1], wa[2]];
    const c = k.coil(from, to, centre, R0, turns, axisKey, ctx.P);
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const V = G.viewOf(ctx.P);
    const Z = wa[2];
    const cross = axis === "y" ? [V[0], V[2]] : [V[1], V[2]];
    const n = Math.hypot(cross[0], cross[1]);
    const dirC = [cross[0] / n, cross[1] / n];
    const halfBox = (sign) => {
      const ctr = axis === "y" ? [centre[0] + sign * dirC[0] * R0 * 0.5, (lo + hi) / 2, Z + sign * dirC[1] * R0 * 0.5] : [(lo + hi) / 2, centre[0] + sign * dirC[0] * R0 * 0.5, Z + sign * dirC[1] * R0 * 0.5];
      const along = axis === "y" ? [0, 1, 0] : [1, 0, 0];
      const across = axis === "y" ? [dirC[0], 0, dirC[1]] : [0, dirC[0], dirC[1]];
      const third = G.cross3(along, across);
      return A.orientedBox(ctr, [along, across, third], [(hi - lo) / 2, R0 * 0.5, R0], { name: `${id}.takeup.spring`, owner: `${id}.takeup` });
    };
    const endOf = (along) => (axis === "y" ? [centre[0] + R0, along, Z] : [along, centre[0] + R0, Z]);
    const hooks = ctx.Dots([ctx.at(endOf(from)), ctx.at(endOf(to))], { size: 0.55 });
    ctx.put(`${id}.takeup.springBack`, f.w((springFrom + springTo) / 2, rodC, zc), ctx.Ln([].concat(c.back).join(""), { tone: "lo" }), [ctx.record(halfBox(-1))], {});
    ctx.put(`${id}.takeup.springFront`, f.w((springFrom + springTo) / 2, rodC, zc), ctx.Ln([].concat(c.front).join(""), { tone: "mid" }) + hooks, [ctx.record(halfBox(1))], {});
  }
  // the lit accent: the read station's lamp on the near bottom chord at readAt
  const readS = opts.readAt ?? L / 2;
  lamp(ctx, f, id, Math.abs(readS - sHead) < 30 || Math.abs(readS - sTail) < TAKEUP + 4 ? L / 2 : readS, cOut, (zBot0 + zBot1) / 2, 1.5);
  // drive: shaft-mounted gear motor on the head drum axle; its motor and torque arm run toward the middle, so the
  // whole drive stays inside the belt's own length. Sizes follow the drum.
  ctx.material = "fx-graphite";
  const gC0 = cOut + 3.0;
  const shaftEnd = gC0 + 1.2;
  const gbS = 0.43 * RW; // half length along the belt
  const gbDown = 0.53 * RW;
  const gbUp = 0.43 * RW;
  const gbDepth = 0.53 * RW;
  ctx.turned(`${id}.shaft`, f.alongC(sHead, gC0, zc), [[0, 1.6], [1.2, 1.6]], { tone: "lo" });
  const gC1 = shaftEnd + gbDepth;
  f.box(`${id}.gearbox`, [sHead - gbS, sHead + gbS], [shaftEnd, gC1], [zc - gbDown, zc + gbUp], { tone: "mid" }, { r: 1.6, steps: 5, bevel: 0.4, seams: [zc - 1.5] });
  const coverR = Math.min(4.2, gbS - 1);
  ctx.turned(`${id}.gearbox.cover`, f.alongC(sHead, gC1, zc), [[0, coverR], [0.9, coverR], [0.9, coverR * 0.57], [1.8, coverR * 0.57]], { tone: "mid" }, { extra: ctx.Dots(G.dotsOf(f.alongC(sHead, gC1, zc), 0.9, coverR * 0.8, 8, ctx.P, { all: true }), { size: 0.45 }) + ctx.Ln(G.circleOf(f.alongC(sHead, gC1, zc), 1.8, coverR * 0.28, ctx.P), { tone: "faint" }) });
  ctx.turned(`${id}.gearbox.breather`, f.up(sHead + 3 * toMid, (shaftEnd + gC1) / 2 + 1.2, zc + gbUp), [[0, 0.9], [0.8, 0.9], [0.8, 0.55], [1.6, 0.55]], { tone: "lo" });
  // torque arm: from under the gearbox to the outer face of the bottom chord (with a drop when the gearbox is higher)
  {
    const zGb0 = zc - gbDown;
    const a0 = sHead + toMid * 1.6;
    const a1 = sHead + toMid * Math.min(4.4, gbS - 0.8);
    if (zGb0 >= zBot1 + 0.2) {
      f.box(`${id}.torqueArm`, [a0, a1], [cOut, gC1 - 1.5], [zBot1 - 2.6, zBot1 - 0.4], { tone: "lo" }, { r: 0.3, steps: 2 });
      f.box(`${id}.torqueArm.drop`, [a0, a1], [shaftEnd + 1.5, gC1 - 1.5], [zBot1 - 0.4, zGb0], { tone: "lo" }, { r: 0.3, steps: 2 });
    } else f.box(`${id}.torqueArm`, [a0, a1], [cOut, gC1 - 1.5], [Math.max(zBot0 - 1, zGb0 - 2.2), zGb0], { tone: "lo" }, { r: 0.3, steps: 2 });
  }
  const mR = Math.max(3.2, 0.3 * RW);
  motor(ctx, f, id, sHead + toMid * gbS, (shaftEnd + gC1) / 2, zc - 1.0, toMid, { r: mR, len: Math.max(16, 1.6 * RW) });
  ctx.material = "";
  // legs, feet and cross beams (kept below the hanging parcels)
  const cLeg0 = cIn - 0.4;
  const cLeg1 = cOut + 0.4;
  const beams = [Math.min(8, zHang - 5)];
  if (zHang - 6 > beams[0] + 12) beams.push(Math.min(30, zHang - 6));
  (standing ? legs : []).forEach((s) => {
    for (const side of [-1, 1]) {
      const tag = side > 0 ? "N" : "F";
      f.box(`${id}.leg${tag}`, [s - 1.4, s + 1.4], [side * cLeg0, side * cLeg1], [1.4, zBot0], { tone: "mid" }, { r: 0.3, steps: 2, bevel: 0.2 });
      f.box(`${id}.foot${tag}`, [s - 3, s + 3], [side * (cLeg0 - 1.6), side * (cLeg1 + 1.6)], [0, 1.4], { tone: "lo" }, { r: 0.6, steps: 3, bevel: 0.2, extra: side > 0 ? f.screws([[s - 2.1, (cLeg0 + cLeg1) / 2], [s + 2.1, (cLeg0 + cLeg1) / 2]], 1.4, { ring: 0.6, size: 0.35 }) : "" });
    }
    for (const z of beams) f.box(`${id}.beam`, [s - 0.8, s + 0.8], [-cLeg0, cLeg0], [z, z + 1.8], { tone: "lo" }, { r: 0.2, steps: 2 });
  });
  if (verts.length > 1) {
    const m = Math.floor(verts.length / 2);
    labelPlate(ctx, f, id, (verts[m - 1] + verts[m]) / 2, cOut, zTop0 + 0.3, zTop1 - 0.3, 14);
  }

  // slots
  ctx.slot(`${id}:slats`, { after: `${id}.belt` });
  ctx.slot(`${id}:top`, { after: `${id}.belt` });
  ctx.slot(`${id}:wrap0`, { before: `${id}.wrap0` });
  ctx.slot(`${id}:wrapSlats0`, { after: `${id}.wrap0` });
  ctx.slot(`${id}:wrapSlats1`, { after: `${id}.wrap1` });
  ctx.slot(`${id}:wrap1`, { after: `${id}.wrap1` });
  ctx.slot(`${id}:bottom`, { before: `${id}.belt.bottom` });
  ctx.slot(`${id}:bottomSlats`, { after: `${id}.belt.bottom` });
  const inS = opts.inAt ?? (dir > 0 ? 12 : L - 12);
  const pitch = opts.pitch ?? 3;
  const cleatEvery = opts.cleatEvery ?? 6;
  const total = 2 * L + 2 * Math.PI * RW;
  const nCleats = Math.floor(total / (pitch * cleatEvery));
  ctx.data[id] = {
    id, type: "loop", axis, origin: [origin[0], origin[1], origin[2] ?? 0], dir, L, W, T, BT, RW, RD, zc, speed: opts.speed ?? 32, pitch,
    cleatEvery, nCleats, cleatGap: total / nCleats, total, PK, CH, HOOK, inS, readS, drop: opts.drop ?? true, autoSpend: opts.autoSpend ?? true,
    feedFrom: worldOffset(origin, opts.feedFrom), light: G.lightOf(ctx.P),
    ports: { in: f.w(inS, 0, T), drop: f.w(sHead, 0, zHang), read: f.w(readS, 0, zc - RW) },
  };
}

export const LIVE = String.raw`
// ---- conveyor: shared belt geometry and drawing --------------------------------------------------------------------
const CONVEYOR = (() => {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const f1 = (v) => Math.round(v * 10) / 10;
  const P2 = (pts) => pts.map((p, i) => (i ? "L" : "M") + f1(p[0]) + " " + f1(p[1])).join("");
  // belt frame mapping (same as the build): s along, c across, z up from the origin's floor
  function frame(D) {
    const sV = D.axis === "y" ? [0, 1, 0] : [1, 0, 0];
    const cV = D.axis === "y" ? [1, 0, 0] : [0, 1, 0];
    const [ox, oy, oz] = D.origin;
    const w = (s, c, z) => (D.axis === "y" ? [ox + c, oy + s, oz + z] : [ox + s, oy + c, oz + z]);
    return { sV, cV, w };
  }
  // the loop coordinate u (along travel, from the tail tangent on the top run) → s, z and outward normal
  function path(D) {
    const R = D.RW;
    const L = D.L;
    const total = 2 * L + 2 * Math.PI * R;
    const sHead = D.dir > 0 ? L : 0;
    const sTail = D.dir > 0 ? 0 : L;
    function at(u, r = R) {
      u = ((u % total) + total) % total;
      if (u < L) return { run: "top", s: sTail + D.dir * u, z: D.zc + r, ns: 0, nz: 1, ts: D.dir, tz: 0 };
      u -= L;
      if (u < Math.PI * R) {
        const th = Math.PI / 2 - D.dir * (u / R);
        return { run: "head", s: sHead + r * Math.cos(th), z: D.zc + r * Math.sin(th), ns: Math.cos(th), nz: Math.sin(th), ts: D.dir * Math.sin(th), tz: -D.dir * Math.cos(th) };
      }
      u -= Math.PI * R;
      if (u < L) return { run: "bottom", s: sHead - D.dir * u, z: D.zc - r, ns: 0, nz: -1, ts: -D.dir, tz: 0 };
      u -= L;
      const th = -Math.PI / 2 - D.dir * (u / R);
      return { run: "tail", s: sTail + r * Math.cos(th), z: D.zc + r * Math.sin(th), ns: Math.cos(th), nz: Math.sin(th), ts: D.dir * Math.sin(th), tz: -D.dir * Math.cos(th) };
    }
    return { at, total, sHead, sTail };
  }
  // an oriented box (any rotation) drawn like a kit solid: hull fill, four side tones by light, top, creases, edge.
  // inner(local → screen, visible(d, sg)) may add lines drawn under the edge.
  function obbSvg(api, D, c, ax, h, tone = "hi", inner = null) {
    const P = api.P;
    const V = api.V;
    const Lt = D.light;
    const local = (l) => iso([0, 1, 2].map((d) => c[d] + ax[0][d] * h[0] * l[0] + ax[1][d] * h[1] * l[1] + ax[2][d] * h[2] * l[2]), P);
    const signs = [-1, 1];
    const pts = {};
    for (const i of signs) for (const j of signs) for (const kk of signs) pts[i + "," + j + "," + kk] = local([i, j, kk]);
    const flat = (i, j, kk) => pts[i + "," + j + "," + kk];
    const visible = (d, sg) => dot(ax[d], V) * sg > 1e-4;
    const faces = [];
    for (let d = 0; d < 3; d++) for (const sg of signs) {
      if (!visible(d, sg)) continue;
      const n = ax[d].map((v) => v * sg);
      const a = (d + 1) % 3;
      const b = (d + 2) % 3;
      const idxs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => { const idx = [0, 0, 0]; idx[d] = sg; idx[a] = u; idx[b] = v; return idx; });
      const score = dot(n, Lt);
      let t = 0;
      for (const th of [0, 0.2, 0.42, 0.62]) if (score >= th) t++;
      faces.push({ quad: idxs.map((q) => flat(q[0], q[1], q[2])), tone: n[2] > 0.72 ? 4 : Math.min(t, 3), corners: idxs.map((q) => q.join(",")) });
    }
    const all = Object.values(pts).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of all) { while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    const upper = [];
    for (const p of all.slice().reverse()) { while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    const hullD = P2(lower.slice(0, -1).concat(upper.slice(0, -1))) + "Z";
    const creases = [];
    for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
      const shared = faces[i].corners.filter((q) => faces[j].corners.includes(q));
      if (shared.length === 2) creases.push(P2(shared.map((q) => pts[q])));
    }
    let out = '<g class="iso-solid"><path class="iso-fill" d="' + hullD + '"/>';
    for (let t = 0; t < 4; t++) {
      const dd = faces.filter((fc) => fc.tone === t).map((fc) => P2(fc.quad) + "Z").join("");
      if (dd) out += '<path class="iso-shade" data-shade="' + t + '" d="' + dd + '"/>';
    }
    const top = faces.filter((fc) => fc.tone === 4).map((fc) => P2(fc.quad) + "Z").join("");
    if (top) out += '<path class="iso-top" d="' + top + '"/>';
    if (creases.length) out += '<path class="iso-line iso-crease" data-tone="faint" d="' + creases.join("") + '"/>';
    if (inner) out += inner((l) => local(l), visible);
    out += '<path class="iso-line iso-edge" data-tone="' + tone + '" d="' + hullD + '"/></g>';
    return out;
  }
  // a parcel in any orientation (axes t, c, n with n its "up"), taped like packetSvg: a band round the sides at
  // 0.55 of its height from whichever face is lower (seamN follows the normal, so it never jumps), and a strap
  // over both broad faces along world x
  function packetObb(api, D, kind, c, ax, half, seamN) {
    const strapAxis = D.axis === "y" ? 1 : 0;
    const inner = (local, visible) => {
      let d = "";
      const sn = seamN / half[2];
      // side band: on every visible side face (t and c faces) at local n = sn
      for (const dd of [0, 1]) for (const sg of [-1, 1]) {
        if (!visible(dd, sg)) continue;
        const o = 1 - dd;
        const a = [0, 0, sn];
        const b = [0, 0, sn];
        a[dd] = sg; b[dd] = sg; a[o] = -1; b[o] = 1;
        d += P2([local(a), local(b)]);
      }
      for (const sg of [-1, 1]) {
        if (!visible(2, sg)) continue;
        const a = [0, 0, sg];
        const b = [0, 0, sg];
        a[strapAxis] = -1; b[strapAxis] = 1;
        d += P2([local(a), local(b)]);
      }
      return d ? '<path class="iso-line" data-tone="lo" d="' + d + '"/>' : "";
    };
    return '<g class="pk" data-kind="' + kind + '">' + obbSvg(api, D, c, ax, half, "hi", inner) + "</g>";
  }
  // slat lines on the belt: top run, both wraps (where they face the viewer) and, for the loop, the lower run's inner face
  function slats(api, D, F, B, travel, pitch) {
    const out = { top: "", w0: "", w1: "", bottom: "" };
    const n = Math.ceil(B.total / pitch);
    const phase = ((travel % pitch) + pitch) % pitch;
    const half = D.W / 2;
    for (let i = 0; i < n; i++) {
      const u = phase + i * pitch;
      const q = B.at(u);
      const nw = [F.sV[0] * q.ns, F.sV[1] * q.ns, q.nz];
      if (q.run === "bottom") {
        if (D.type !== "loop") continue;
        const z = D.zc - D.RD;
        out.bottom += P2([iso(F.w(q.s, -half, z), api.P), iso(F.w(q.s, half, z), api.P)]);
        continue;
      }
      if (q.run !== "top" && dot(nw, api.V) < 0.06) continue;
      if (q.run === "top" && (q.s <= 0.05 || q.s >= D.L - 0.05)) continue;
      const seg = P2([iso(F.w(q.s, -half, q.z), api.P), iso(F.w(q.s, half, q.z), api.P)]);
      if (q.run === "top") out.top += seg;
      else if ((q.run === "head" ? B.sHead : B.sTail) === 0) out.w0 += seg;
      else out.w1 += seg;
    }
    return out;
  }
  const line = (d, tone) => (d ? '<path class="iso-line" data-tone="' + tone + '" d="' + d + '"/>' : "");
  const copy = (D) => JSON.parse(JSON.stringify(D));
  return { frame, path, obbSvg, packetObb, slats, line, dot, copy };
})();

// ---- falls --------------------------------------------------------------------------------------------------------
// A parcel handed on mid-fall may carry item.v (its world velocity, units/s): the fall starts with exactly that
// velocity, then bends (in a quadratic) to land on the target, which may be moving.
const CONVEYOR_G = 420; // world units / s², the fall
function conveyorFall(item, start, target) {
  const v = item.v ?? [0, 0, 0];
  delete item.v;
  const dz = Math.max(0.5, start[2] - target[2]);
  const dur = Math.max(0.18, (v[2] + Math.sqrt(v[2] * v[2] + 2 * CONVEYOR_G * dz)) / CONVEYOR_G);
  return { from: start, v, dur, tau: 0 };
}
function conveyorFallAt(f, to) {
  const tt = Math.min(1, f.tau);
  const t = tt * f.dur;
  const T = f.dur;
  const out = [0, 0, 0];
  for (let d = 0; d < 3; d++) {
    const g = d === 2 ? CONVEYOR_G : 0;
    const free = f.from[d] + f.v[d] * t - 0.5 * g * t * t;
    const freeEnd = f.from[d] + f.v[d] * T - 0.5 * g * T * T;
    out[d] = free + (to[d] - freeEnd) * tt * tt;
  }
  return out;
}

// ---- "top": items land, ease up to belt speed, ride to outAt and leave --------------------------------------------
function conveyorTop(api, D) {
  const F = CONVEYOR.frame(D);
  const B = CONVEYOR.path(D);
  const g = { slats: api.slot("slats"), top: api.slot("top"), w0: api.slot("wrapSlats0"), w1: api.slot("wrapSlats1"), end1: api.slot("end1") };
  const items = [];
  let travel = 0;
  let still = false;
  // an outAt at the head drum means "off the end": the parcel rides on until its rear edge reaches the drum top,
  // slides round the drum and drops clear of the frame before it is handed on (with its velocity)
  const halfOf = (kind) => (kind === "fluff" ? 2.4 : D.axis === "y" ? 4 : 5);
  const R = D.RW;
  const DROP = 16; // below the top of the belt, the frame is clear
  const KINDS = ["control", "graph", "data"];
  // reduced motion: a representative still, three parcels riding
  function seed() {
    if (items.length) return;
    [0.3, 0.5, 0.7].forEach((f, i) => items.push({ item: { id: -1 - i, kind: KINDS[i], born: 0 }, phase: "ride", s: D.L * f, v: D.speed, bounce: 9, z: D.T, vz: 0, pos: null }));
  }
  const self = {
    accept(port, item, from) {
      if (api.calm()) return; // still: nothing arrives
      const to = F.w(D.inS, 0, D.T);
      const start = from ?? D.feedFrom ?? [to[0], to[1], to[2] + 24];
      items.push({ item, phase: "fall", fall: conveyorFall(item, start, to), s: D.inS, v: 0, bounce: 0, z: D.T, vz: 0, pos: start });
    },
    tick(dt) {
      if (api.calm()) {
        if (still) return;
        still = true;
        seed();
        dt = 0;
      } else still = false;
      travel += D.speed * dt;
      const sl = CONVEYOR.slats(api, D, F, B, travel, D.pitch);
      g.slats.innerHTML = CONVEYOR.line(sl.top, "faint");
      g.w0.innerHTML = CONVEYOR.line(sl.w0, "faint");
      g.w1.innerHTML = CONVEYOR.line(sl.w1, "faint");
      const draw = [];
      // backpressure: while self.hold() is true the front parcel waits just short of where it would leave and the
      // ones behind queue a parcel length apart (set by the assembly, e.g. hold = () => !centrifuge.canAccept())
      const held = !!(self.hold && self.hold());
      {
        let lim = Infinity;
        const riding = items.filter((it) => it.phase === "ride").sort((a, b) => (b.s - a.s) * D.dir);
        riding.forEach((it, i) => {
          const half = halfOf(it.item.kind);
          if (i === 0 && held) lim = D.outS * D.dir + (D.tip ? half : 0) - 0.01;
          it.lim = lim;
          if (Number.isFinite(lim)) lim = Math.min(lim, it.s * D.dir) - (2 * half + 1.5);
        });
      }
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        const half = halfOf(it.item.kind);
        let p;
        if (it.phase === "fall") {
          it.fall.tau += dt / it.fall.dur;
          p = conveyorFallAt(it.fall, F.w(it.s, 0, D.T));
          if (it.fall.tau >= 1) { it.phase = "ride"; it.bounce = 0; }
        } else if (it.phase === "ride") {
          it.bounce += dt;
          it.v += (D.speed - it.v) * (1 - Math.exp(-dt * 5));
          it.s += D.dir * it.v * dt;
          if (it.lim !== undefined && it.s * D.dir > it.lim) { it.s = it.lim * D.dir; it.v = 0; }
          const hop = 0.9 * Math.exp(-it.bounce * 9) * Math.abs(Math.sin(it.bounce * 22));
          p = F.w(it.s, 0, D.T + hop);
          const past = (it.s - D.outS) * D.dir;
          if (D.tip && past >= half) { it.phase = "tip"; it.z = D.T; it.vz = 0; }
          else if (!D.tip && past >= 0) {
            items.splice(i, 1);
            it.item.v = [F.sV[0] * D.dir * it.v, F.sV[1] * D.dir * it.v, 0];
            api.emit("out", it.item, F.w(D.outS, 0, D.T));
            continue;
          }
        } else {
          // tip: the rear edge slides down the drum until the slope is 45°, then it falls free
          it.s += D.dir * it.v * dt;
          const dx = (it.s - D.outS) * D.dir - half;
          if (dx < R * Math.SQRT1_2 && it.vz === 0) it.z = D.zc + Math.sqrt(Math.max(0, R * R - dx * dx));
          else {
            if (it.vz === 0) it.vz = -it.v;
            it.vz -= CONVEYOR_G * dt;
            it.z += it.vz * dt;
          }
          p = F.w(it.s, 0, it.z);
          if (it.z <= D.T - DROP) {
            items.splice(i, 1);
            it.item.v = [F.sV[0] * D.dir * it.v, F.sV[1] * D.dir * it.v, it.vz];
            api.emit("out", it.item, p);
            continue;
          }
        }
        it.pos = p;
        draw.push({ end: it.s > D.L - 6, key: CONVEYOR.dot([p[0], p[1], p[2] + 3.5], api.V), svg: it.item.kind === "fluff" ? api.fluffSvg(p, 2.4) : api.packetSvg(it.item.kind, p) });
      }
      draw.sort((a, b) => a.key - b.key);
      g.top.innerHTML = draw.filter((d) => !d.end).map((d) => d.svg).join("");
      g.end1.innerHTML = draw.filter((d) => d.end).map((d) => d.svg).join("");
    },
    // where each item really is: run "air" while it falls onto the belt or tips off it
    items: () => items.map((it) => ({ id: it.item.id, kind: it.item.kind, pos: it.pos ?? F.w(it.s, 0, D.T), run: it.phase === "ride" ? "top" : "air" })),
    slatPhase: () => travel / D.pitch,
    geometry: () => CONVEYOR.copy(D),
    held: () => (self.hold ? !!self.hold() : false),
  };
  return self;
}

// ---- "loop": the audio belt ------------------------------------------------------------------------------------
// One cleat gap is one 128-frame render quantum; quanta() gives the phase at the read point for the machines that
// sync to the belt (scanner, centrifuge).
function conveyorLoop(api, D) {
  const F = CONVEYOR.frame(D);
  const B = CONVEYOR.path(D);
  const g = { slats: api.slot("slats"), top: api.slot("top"), w0: api.slot("wrap0"), w1: api.slot("wrap1"), ws0: api.slot("wrapSlats0"), ws1: api.slot("wrapSlats1"), bottom: api.slot("bottom"), bs: api.slot("bottomSlats") };
  const nCleats = D.nCleats;
  const cleatGap = D.cleatGap;
  const { CH, HOOK, PK } = D;
  const items = [];
  const bails = []; // empty bails folding back after a release
  const taken = new Set();
  let travel = 0;
  let dropped = 0;
  let spent = 0;
  let still = false;
  const uIn = D.dir > 0 ? D.inS : D.L - D.inS;
  const uHeadEnd = D.L + Math.PI * D.RW; // start of the lower run
  const uRead = uHeadEnd + Math.abs(D.readS - B.sHead);
  const cleatU = (kk, tr = travel) => ((kk * cleatGap + tr) % B.total + B.total) % B.total;
  // where something riding cleat kk is, and its axes
  function pose(u, lift) {
    const q = B.at(u);
    const tW = [F.sV[0] * q.ts, F.sV[1] * q.ts, q.tz];
    const nW = [F.sV[0] * q.ns, F.sV[1] * q.ns, q.nz];
    const base = F.w(q.s, 0, q.z);
    return { q, tW, nW, base, at: (h) => [base[0] + nW[0] * (lift + h), base[1] + nW[1] * (lift + h), base[2] + nW[2] * (lift + h)] };
  }
  function planAround(c) {
    const along = 1.6;
    const across = D.W - 1.2;
    return D.axis === "y" ? { x: c[0] - across / 2, y: c[1] - along / 2, w: across, d: along, r: 0.2 } : { x: c[0] - along / 2, y: c[1] - across / 2, w: along, d: across, r: 0.2 };
  }
  function cleatSvg(o) {
    if (o.q.run === "top") return solidSvg(slabOf(planAround(o.base), o.base[2], CH, api.P, 2, 0.2), { tone: "lo" });
    if (o.q.run === "bottom") return solidSvg(slabOf(planAround(o.base), o.base[2] - CH, CH, api.P, 2, 0), { tone: "lo" });
    return CONVEYOR.obbSvg(api, D, o.at(CH / 2), [o.tW, F.cV, o.nW], [0.8, D.W / 2 - 0.6, CH / 2], "lo");
  }
  // a hinged bail: folded flat on the top run, it swings out as the parcel goes under and hangs it HOOK below
  const hookOf = (q) => HOOK * api.smooth(0.05, 0.95, -q.nz);
  const ACROSS = (D.axis === "y" ? PK.w : PK.d) / 2 + 0.45;
  // the bail's two side straps from the cleat ends down to pivots on the parcel's sides; fold (0..1) shortens them
  function strapSvg(o, hook, side, fold = 1) {
    const len = (hook / HOOK) * (HOOK + PK.h / 2) * fold;
    if (len < 0.3) return "";
    const m = o.at(len / 2);
    const c = [m[0] + F.cV[0] * side * ACROSS, m[1] + F.cV[1] * side * ACROSS, m[2]];
    return CONVEYOR.obbSvg(api, D, c, [o.tW, F.cV, o.nW], [0.7, 0.35, len / 2], "lo");
  }
  const HALF = D.axis === "y" ? [PK.d / 2, PK.w / 2, PK.h / 2] : [PK.w / 2, PK.d / 2, PK.h / 2];
  function packetAt(kind, o, alpha, hook) {
    const run = o.q.run;
    let svg;
    if (run === "top") svg = api.packetSvg(kind, o.at(0), PK);
    else if (run === "bottom") { const p = o.at(hook); svg = api.packetSvg(kind, [p[0], p[1], p[2] - PK.h], PK); }
    else svg = CONVEYOR.packetObb(api, D, kind, o.at(hook + PK.h / 2), [o.tW, F.cV, o.nW], HALF, 0.05 * PK.h * o.q.nz);
    return alpha < 1 ? '<g opacity="' + alpha.toFixed(3) + '">' + svg + "</g>" : svg;
  }
  const posOf = (o, hook) => (o.q.run === "bottom" ? o.at(hook).map((v, i) => (i === 2 ? v - PK.h : v)) : o.at(hook));
  // parcels on the top run over the front drum go with the front wrap (drawn after the top run)
  const slotOf = (q) => (q.run === "top" ? (q.s > D.L - 6 ? "w1" : "top") : q.run === "bottom" ? "bottom" : (q.run === "head" ? B.sHead : B.sTail) === 0 ? "w0" : "w1");
  const KINDS = ["control", "graph", "data"];
  // reduced motion: a representative still — parcels on every third cleat, the ones past the read point spent
  function seed() {
    if (items.length) return;
    for (let kk = 0; kk < nCleats; kk += 3) {
      const u = cleatU(kk);
      const spentAlready = u > uRead || u < uIn;
      items.push({ item: { id: -1 - kk, kind: KINDS[(kk / 3) % 3], born: 0 }, kind: KINDS[(kk / 3) % 3], cleat: kk, phase: "ride", lastU: u, spend: spentAlready ? 1 : 0, spending: false });
      taken.add(kk);
    }
  }
  return {
    accept(port, item, from) {
      if (api.calm()) return; // still: nothing arrives
      const to = F.w(D.inS, 0, D.T + CH);
      const start = from ?? D.feedFrom ?? [to[0], to[1], to[2] + 24];
      const fall = conveyorFall(item, start, to);
      // the free cleat that will be nearest the landing point when the item gets there
      let best = -1;
      let bestD = 1e9;
      for (let kk = 0; kk < nCleats; kk++) {
        if (taken.has(kk)) continue;
        const dd = uIn - cleatU(kk, travel + D.speed * fall.dur);
        if (dd > -cleatGap * 0.5 && dd < cleatGap * 2.5 && Math.abs(dd) < bestD) { best = kk; bestD = Math.abs(dd); }
      }
      if (best < 0) { console.warn(D.id ?? "loop", "belt full: parcel refused"); return; }
      taken.add(best);
      items.push({ item, kind: item.kind, cleat: best, phase: "fall", fall, lastU: null, spend: item.kind === "garbage" ? 1 : 0, spending: false, pos: start });
    },
    tick(dt) {
      if (api.calm()) {
        if (still) return;
        still = true;
        seed();
        dt = 0;
      } else still = false;
      travel += D.speed * dt;
      const sl = CONVEYOR.slats(api, D, F, B, travel, D.pitch);
      g.slats.innerHTML = CONVEYOR.line(sl.top, "lo");
      g.ws0.innerHTML = CONVEYOR.line(sl.w0, "lo");
      g.ws1.innerHTML = CONVEYOR.line(sl.w1, "lo");
      g.bs.innerHTML = CONVEYOR.line(sl.bottom, "faint");
      const draw = { top: [], w0: [], w1: [], bottom: [] };
      for (let kk = 0; kk < nCleats; kk++) {
        const o = pose(cleatU(kk), 0);
        draw[slotOf(o.q)].push({ key: CONVEYOR.dot(o.at(CH / 2), api.V), svg: cleatSvg(o) });
      }
      for (let i = bails.length - 1; i >= 0; i--) {
        const b = bails[i];
        b.t += dt / 0.3;
        if (b.t >= 1) { bails.splice(i, 1); continue; }
        const o = pose(cleatU(b.cleat), CH);
        const hook = hookOf(o.q);
        const fold = 1 - api.smooth(0, 1, b.t);
        draw[slotOf(o.q)].push({ key: CONVEYOR.dot(o.at(hook / 2), api.V) + 0.4, svg: strapSvg(o, hook, -1, fold) + strapSvg(o, hook, 1, fold) });
      }
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        const u = cleatU(it.cleat);
        const o = pose(u, CH);
        if (it.phase === "fall") {
          it.fall.tau += dt / it.fall.dur;
          const p = conveyorFallAt(it.fall, o.at(0));
          it.pos = p;
          if (it.fall.tau >= 1) { it.phase = "ride"; it.lastU = u; }
          draw.top.push({ key: CONVEYOR.dot([p[0], p[1], p[2] + 3.5], api.V) + 50, svg: api.packetSvg(it.kind, p, PK) });
          continue;
        }
        // station bookkeeping (u only grows, modulo the loop)
        const prev = it.lastU;
        const passed = (mark) => (prev <= u ? prev < mark && u >= mark : prev < mark || u >= mark);
        const hook = hookOf(o.q);
        if (passed(uHeadEnd) && it.spend >= 1 && D.drop) {
          // release at the bottom of the head drum: the parcel leaves with the belt's speed, its bail folds back
          items.splice(i, 1);
          taken.delete(it.cleat);
          bails.push({ cleat: it.cleat, t: 0 });
          dropped++;
          const v = [o.tW[0] * D.speed, o.tW[1] * D.speed, o.tW[2] * D.speed];
          api.emit("drop", { ...it.item, kind: "garbage", was: it.item.kind, v }, posOf(o, hook));
          continue;
        }
        if (D.autoSpend && !it.spending && it.spend < 1 && passed(uRead)) it.spending = true;
        if (it.spending) {
          it.spend = Math.min(1, it.spend + dt / 0.6);
          if (it.spend >= 1) { it.spending = false; spent++; }
        }
        it.lastU = u;
        it.pos = posOf(o, hook);
        const key = CONVEYOR.dot(o.at(hook + PK.h / 2), api.V) + 0.5;
        let svg = packetAt(it.kind, o, 1, hook);
        if (it.spend > 0) svg = it.spend >= 1 ? packetAt("garbage", o, 1, hook) : svg + packetAt("garbage", o, it.spend, hook);
        draw[slotOf(o.q)].push({ key, svg: strapSvg(o, hook, -1) + svg + strapSvg(o, hook, 1) });
      }
      for (const name of ["top", "w0", "w1", "bottom"]) {
        const list = draw[name].sort((a, b) => a.key - b.key);
        g[name].innerHTML = list.map((d) => d.svg).join("");
      }
    },
    // read access for the scanner and centrifuge (FACTORY.machines.<id>)
    items: () => items.map((it) => ({ id: it.item.id, kind: it.spend >= 1 ? "garbage" : it.kind, pos: it.pos ?? F.w(D.inS, 0, D.T), run: it.phase === "fall" ? "air" : B.at(cleatU(it.cleat)).nz >= 0 ? "top" : "bottom" })),
    slatPhase: () => travel / D.pitch,
    // one cleat gap = one render quantum: phase 0 when a cleat is at the read point, rising to 1 as the next arrives
    quanta: () => {
      const rel = (((travel - uRead) % cleatGap) + cleatGap) % cleatGap;
      return {
        phase: rel / cleatGap,
        period: cleatGap / D.speed,
        count: Math.floor((travel - uRead) / cleatGap) + nCleats,
        cleats: Array.from({ length: nCleats }, (_, kk) => { const o = pose(cleatU(kk), 0); return { pos: o.base, run: o.q.nz >= 0 ? "top" : "bottom" }; }),
      };
    },
    geometry: () => CONVEYOR.copy(D),
    // will a free cleat be under the in point for a parcel arriving "after" seconds from now (falling ≈ 0.2 s)?
    // A sender that asks first never has a parcel refused (the centrifuge holds it for another turn instead).
    canTake: (after = 0) => {
      const at = travel + D.speed * (after + 0.2);
      for (let kk = 0; kk < nCleats; kk++) {
        if (taken.has(kk)) continue;
        const dd = uIn - cleatU(kk, at);
        if (dd > -cleatGap * 0.5 && dd < cleatGap * 2.5) return true;
      }
      return false;
    },
    spend: (id) => { const it = items.find((x) => x.item.id === id); if (it && it.spend < 1) it.spending = true; },
    stats: () => ({ riding: items.filter((it) => it.phase === "ride" && B.at(cleatU(it.cleat)).nz > 0).length, hanging: items.filter((it) => B.at(cleatU(it.cleat)).run === "bottom").length, dropped, spent }),
  };
}

MACHINES.conveyor = (api) => (api.data.type === "loop" ? conveyorLoop(api, api.data) : conveyorTop(api, api.data));
`;
