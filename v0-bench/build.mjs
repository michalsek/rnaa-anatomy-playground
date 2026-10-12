import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const KIT = "/Users/michalsek/.claude/skills/anatomy";
const k = await import(`${KIT}/kit/iso-kit.mjs`);
const G = await import(`${KIT}/kit/lathe.mjs`);
const { tubePieces, tubeSvg } = await import(`${KIT}/kit/tube.mjs`);
const A = await import(`${KIT}/kit/audit.mjs`);
const { kitScript } = await import(`${KIT}/scripts/inline-kit.mjs`);

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME = process.argv.includes("--light") ? "light" : "dark";

const W = 640;
const H = 392;
const AZIMUTH = 58;
const ELEVATION = 34;

// ---- world plan -------------------------------------------------------------
// x runs along the signal path (sources left, destination right), y toward the viewer.
// Back strip (y < FENCE_Y): the JS thread. Front strip: the audio thread. Right end: the deconstructor.
const PLATE = { x: -176, y: -112, w: 352, d: 216, r: 10 };
const PLATE_H = 12;
const FOOT_H = 5;
const FENCE_Y = -30;

const CASE = { x: -158, y: 10, w: 300, d: 74, r: 4 };
const CASE_FLOOR = 4;
const RAIL_H = 18;
const PANEL_Z = 16; // module panel tops sit here
const MODULES = [
  { id: "osc", x0: -152, x1: -106 },
  { id: "buf", x0: -104, x1: -50 },
  { id: "gain", x0: -48, x1: -10 },
  { id: "filter", x0: -8, x1: 32 },
  { id: "scope", x0: 34, x1: 74 },
  { id: "dest", x0: 76, x1: 136 },
];
const MOD_Y0 = CASE.y + 9;
const MOD_Y1 = CASE.y + CASE.d - 9;
const modOf = (id) => MODULES.find((m) => m.id === id);

// two SPSC rings straddle the fence: the event scheduler and the graph channel
const DRUM_R = 19;
const DRUMS = [
  { id: "sched", x: -60, y: FENCE_Y, inDeg: 315 },
  { id: "graph", x: -8, y: FENCE_Y, inDeg: 0 },
];
const DRUM_SLOTS = 12;
const PORT_Z = 6.4; // height of every pneumatic port on the console, drums and rack
const PORT_R = 2.4;
const CONSOLE = { x: -166, y: -104, w: 74, d: 68, r: 4 };
const BIN = { x: 108, y: -100, w: 56, d: 52, r: 5 };
const DISPATCH = { x: 34, y: -98, w: 36, d: 38 };
const PROMISE = { x: 78, y: -98, w: 22, d: 22 };
const BAY_X = 26;
const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [CASE.x, CASE.y, 40], [CASE.x + CASE.w, CASE.y + CASE.d, 40], [CONSOLE.x, CONSOLE.y, 30], [BIN.x + BIN.w, BIN.y, 40]],
  W,
  H,
  { pad: 22, azimuth: AZIMUTH, elevation: ELEVATION },
);
const V = G.viewOf(P);
const KS = G.scaleOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);
const f2 = (v) => Math.round(v * 100) / 100;
const UP = (x, y, z) => G.frameOf([x, y, z], [0, 0, 1], [1, 0, 0], [0, 1, 0]);

const R = A.recorder(P);
const record = R.solid;
function put(name, ref, svg, shapes = [], { bias = 0, ...rest } = {}) {
  return R.put({ name, at: ref, bias, svg, shapes, piece: "bench", ...rest });
}
function box(name, [x0, y0, z0], [x1, y1, z1], style = {}, { r = 0.6, steps = 3, bevel = 0, extra = "", inner = "", bias = 0, attrs } = {}) {
  const plan = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r };
  const shape = record(A.slab(plan, z0, z1 - z0, { name }, steps));
  put(name, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], S(k.slabOf(plan, z0, z1 - z0, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
  return plan;
}
function cyl(name, cx, cy, r, z0, h, style = {}, { steps = 32, bevel = 0, extra = "", inner = "", bias = 0, attrs, owner } = {}) {
  const shape = record(A.cylinder(cx, cy, r, z0, h, { name, owner }));
  put(name, [cx, cy, z0 + h / 2], S(k.cylinder(cx, cy, r, z0, h, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
}
function turned(name, F, profile, style = {}, { extra = "", inner = "", bias = 0, smooth, steps, bevel = 0, owner, attrs } = {}) {
  const opts = { bevel, ...(smooth !== undefined ? { smooth } : {}), ...(steps ? { steps } : {}) };
  const paths = G.solidOf(profile, F, P, opts);
  const mid = (profile[0][0] + profile[profile.length - 1][0]) / 2;
  const shape = record(A.solid(F, profile, { name, owner, radius: smooth && smooth.radius ? smooth.radius : null }));
  put(name, G.add3(F.o, G.mul3(F.a, mid)), S(paths, { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
}
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

// ---- cables and pneumatic tubes --------------------------------------------
const ROUTES = {};
function cable(name, points, r = 0.9, { tone = "mid", bend = 4, ends = [true, true], shells = [false, false], rings, maxLength = 14, bias = 0.05, limp = true, touch } = {}) {
  const route = G.fillet(points, Math.max(bend, r * 2.6), 10, { P, tube: r });
  const total = G.pathLength(route);
  const SHELL = Math.max(2.4, r * 2.6);
  const gaps = [...(shells[0] ? [[0, SHELL]] : []), ...(shells[1] ? [[total - SHELL, total]] : [])];
  R.route(name, route, r, { gaps, limp, touch, rims: shells.map((on) => (on ? r * 1.7 : r)), piece: "bench" });
  ROUTES[name] = route;
  tubePieces(route, r, P, { maxLength, spacing: Math.max(0.6, Math.min(1.6, r)), gaps, ...(rings ? { rings } : {}) }).forEach((piece, index) =>
    put(`${name}:${index}`, piece.mid, tubeSvg(piece, { tone }), [A.tube(piece.points, piece.radii)], { bias, route: name, chunk: index, attrs: ` data-route="${name}"` }),
  );
  [0, 1].forEach((index) => {
    const end = index ? route[route.length - 1] : route[0];
    if (shells[index]) {
      const tangent = G.tangentAlong(route, index ? total : 0);
      const F = G.frameAlong(end, tangent);
      const [s0, s1] = index ? [-SHELL, 0] : [0, SHELL];
      const shape = record(A.disc(F, s0, s1, r * 1.7, { name: `${name}.shell${index}`, owner: name }));
      put(`${name}.shell${index}`, G.add3(end, G.mul3(tangent, (s0 + s1) / 2)), S(G.disc(s0, s1, r * 1.7, F, P, { steps: 24, bevel: 0.2 }), { tone: "mid" }), [shape], { bias: bias + 0.1, attrs: ` data-route="${name}"` });
    } else if (ends[index]) {
      const size = Math.max(0.5, r * KS * 0.9);
      put(`${name}.end${index}`, end, Dots([at(end)], { size, tone: "hi" }), [A.ball(end, size / KS, { name: `${name}.end${index}`, owner: name })], { bias: bias + 0.15 });
    }
  });
  return route;
}

// ---- base plate ---------------------------------------------------------------
const back = [];
back.push(`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`);
for (const [x, y] of byDepth(k.corners(PLATE, 22))) {
  back.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
  back.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
}
back.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid", inner: Ln(k.sideSeam(PLATE, -4, P, 8), { tone: "faint" }) }));
back.push(Ln(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
const plateScrews = k.corners(PLATE, 10);
back.push(Ln(plateScrews.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
back.push(Dots(plateScrews.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
record(A.slab(PLATE, -PLATE_H, PLATE_H, { name: "stand.plate", ground: true }, 8));

// ruler strip along the front edge: one tick per render quantum of the shown bus
const STRIP = { x: PLATE.x + 16, y: PLATE.y + PLATE.d - 13, w: PLATE.w - 32, d: 6, r: 1 };
back.push(S(k.slabOf(STRIP, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
{
  const ticks = k.topTicks(STRIP.x + 4, STRIP.x + STRIP.w - 4, 4, 8, STRIP.y, 0.6, [1.8, 3.4], P);
  back.push(Ln(ticks.minor, { tone: "lo" }), Ln(ticks.major, { tone: "mid" }));
}
// label plate (bottom left of the bench)
const LABEL = { x: -42, y: -88, w: 34, d: 14, r: 1.2 };
back.push(S(k.slabOf(LABEL, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
back.push(Ln(k.planOutline(k.insetPlan(LABEL, 1.4), 0.8, P, 3), { tone: "faint" }));
back.push(Ln([22, 15, 18].map((w, i) => k.lineOnTop([LABEL.x + 4, LABEL.y + 3.6 + i * 3.2], [LABEL.x + 4 + w, LABEL.y + 3.6 + i * 3.2], 0.8, P)).join(""), { tone: "lo", free: true }));
back.push(Dots([at([LABEL.x + LABEL.w - 2.6, LABEL.y + 2.4, 0.8]), at([LABEL.x + LABEL.w - 2.6, LABEL.y + LABEL.d - 2.4, 0.8])], { size: 0.45 }));
// zone grooves: the thread boundary (JS | audio) and the deconstructor bay
back.push(Ln(path3([[PLATE.x + 5, FENCE_Y, 0], [PLATE.x + PLATE.w - 5, FENCE_Y, 0]]) + path3([[BAY_X, PLATE.y + 5, 0], [BAY_X, FENCE_Y, 0]]), { tone: "faint" }));

// ---- the fence between threads: low rails on posts --------------------------
// a run of posts and a rail; `along` is "x" (at y = at) or "y" (at x = at)
function fence(from, to, at = FENCE_Y, along = "x", skip = []) {
  const span = (a0, a1, c0, c1) => (along === "x" ? [[a0, c0], [a1, c1]] : [[c0, a0], [c1, a1]]);
  const [[x0, y0], [x1, y1]] = span(from, to, at - 1.2, at + 1.2);
  box("fence.rail", [x0, y0, 7], [x1, y1, 9], { tone: "mid" }, { r: 0.6, bevel: 0.3 });
  const count = Math.max(1, Math.round((to - from - 4) / 18));
  for (let i = 0; i <= count; i++) {
    const a = from + 2 + ((to - from - 4) * i) / count;
    if (skip.some(([s0, s1]) => a > s0 && a < s1)) continue;
    const [[fx0, fy0], [fx1, fy1]] = span(a - 2.4, a + 2.4, at - 2.4, at + 2.4);
    box("fence.foot", [fx0, fy0, 0], [fx1, fy1, 1], { tone: "lo" }, { r: 0.8 });
    const [[px0, py0], [px1, py1]] = span(a - 1, a + 1, at - 1, at + 1);
    box("fence.post", [px0, py0, 1], [px1, py1, 7], { tone: "mid" }, { r: 0.4 });
  }
}
fence(PLATE.x + 14, DRUMS[0].x - DRUM_R - 9);
fence(DRUMS[1].x + DRUM_R + 9, PLATE.x + PLATE.w - 14);
fence(PLATE.y + 14, FENCE_Y - 1.2, BAY_X, "y");

// ---- the rack case: a tabletop skiff holding the audio graph ------------------
box("case.floor", [CASE.x, CASE.y, 0], [CASE.x + CASE.w, CASE.y + CASE.d, CASE_FLOOR], { tone: "lo" }, { r: CASE.r, steps: 5, bevel: 0.5 });
for (const [y0, y1] of [[CASE.y, CASE.y + 7], [CASE.y + CASE.d - 7, CASE.y + CASE.d]]) {
  box("case.rail", [CASE.x + 6, y0, CASE_FLOOR], [CASE.x + CASE.w - 6, y1, RAIL_H - 4], { tone: "mid" }, {
    r: 0.8,
    bevel: 0.4,
    inner: Ln(k.sideSeam({ x: CASE.x + 6, y: y0, w: CASE.w - 12, d: y1 - y0, r: 0.8 }, 8, P, 3), { tone: "faint" }),
    extra: Ln(path3([[CASE.x + 6, (y0 + y1) / 2, RAIL_H - 4], [CASE.x + CASE.w - 6, (y0 + y1) / 2, RAIL_H - 4]]), { tone: "faint" }),
  });
}
for (const x0 of [CASE.x, CASE.x + CASE.w - 6]) {
  box("case.cheek", [x0, CASE.y, CASE_FLOOR], [x0 + 6, CASE.y + CASE.d, RAIL_H + 2], { tone: "mid" }, {
    r: 1.4,
    bevel: 0.5,
    extra: Dots([CASE.y + 6, CASE.y + CASE.d - 6].map((y) => at([x0 + 3, y, RAIL_H + 2])), { size: 0.5 }),
  });
}

// module panels: each a slab between the rails with four rail screws
function panel(m, extraTop = "") {
  const plan = { x: m.x0, y: CASE.y + 7, w: m.x1 - m.x0, d: CASE.d - 14, r: 1.2 };
  const screws = [[m.x0 + 3, MOD_Y0], [m.x1 - 3, MOD_Y0], [m.x0 + 3, MOD_Y1], [m.x1 - 3, MOD_Y1]];
  box(`mod.${m.id}.panel`, [plan.x, plan.y, CASE_FLOOR], [plan.x + plan.w, plan.y + plan.d, PANEL_Z], { tone: "mid" }, {
    r: 1.2,
    bevel: 0.6,
    extra: Ln(screws.map(([x, y]) => k.ring(x, y, 1.3, PANEL_Z, P, 12)).join(""), { tone: "lo" }) + Dots(screws.map(([x, y]) => at([x, y, PANEL_Z])), { size: 0.45 }) + extraTop,
  });
}
function jack(name, x, y) {
  cyl(`${name}.nut`, x, y, 2.6, PANEL_Z, 1, { tone: "lo" }, { steps: 6 });
  cyl(`${name}`, x, y, 1.9, PANEL_Z + 1, 1.4, { tone: "mid" }, { steps: 20, extra: Dots([at([x, y, PANEL_Z + 2.4])], { size: 1.1, tone: "faint" }) });
  return [x, y, PANEL_Z + 2.4];
}
function knob(name, x, y, r, h, { lit = false, angle = 0, ticks = 0 } = {}) {
  if (ticks) {
    const t = k.radialTicks(x, y, r + 4.2, ticks, ticks / 2, PANEL_Z, [1.2, 2.2], P, -Math.PI * 0.75, Math.PI * 1.5);
    const arc = Array.from({ length: 49 }, (_, i) => {
      const a = -Math.PI * 0.75 + (Math.PI * 1.5 * i) / 48;
      return [x + Math.sin(a) * (r + 4.2), y - Math.cos(a) * (r + 4.2)];
    });
    put(`${name}.scale`, [x, y, PANEL_Z + 0.01], Ln(k.onTop(arc, PANEL_Z, P), { tone: "lo" }) + Ln(t.minor, { tone: "lo" }) + Ln(t.major, { tone: "mid" }), [record(A.cylinder(x, y, r + 4.2, PANEL_Z, 0.02, { name: `${name}.scale` }))], { bias: 0.05 });
  }
  cyl(`${name}.skirt`, x, y, r + 1.2, PANEL_Z, 1.2, { tone: "lo" }, { steps: 32 });
  const top = PANEL_Z + 1.2 + h;
  cyl(name, x, y, r, PANEL_Z + 1.2, h, { tone: "hi", lit }, {
    steps: 32,
    bevel: 0.4,
    extra: Ln(k.knurl(x, y, r, PANEL_Z + 1.2, top - 0.6, Math.round(r * 7), P), { tone: "lo" }) + `<path class="iso-line" data-tone="${lit ? "lit" : "hi"}" data-free="end" data-pointer="${name}" d="${pointerOf(x, y, r, top, angle)}" style="stroke-width:1"/>`,
  });
  return top;
}
function pointerOf(x, y, r, top, angle) {
  return k.lineOnTop([x, y], [x + Math.sin(angle) * (r - 0.8), y - Math.cos(angle) * (r - 0.8)], top, P);
}

for (const m of MODULES) panel(m);
const MID_Y = (MOD_Y0 + MOD_Y1) / 2;

// OSC: a wavetable dial and a frequency knob
const OSC = modOf("osc");
const OSC_DIAL = [OSC.x0 + 23, MID_Y - 8];
const oscOut = jack("mod.osc.out", OSC.x1 - 9, MOD_Y1 - 4);
knob("mod.osc.freq", OSC.x0 + 23, MID_Y - 8, 7, 4, { angle: 0.6, ticks: 20 });
knob("mod.osc.detune", OSC.x0 + 12, MOD_Y1 - 6, 3.4, 3, { angle: -0.4 });

// BUF: two tape reels on spindles
const BUF = modOf("buf");
const REELS = [[BUF.x0 + 15, MID_Y - 6], [BUF.x1 - 15, MID_Y - 6]];
for (const [i, [x, y]] of REELS.entries()) {
  cyl(`mod.buf.reel${i}.flange`, x, y, 11, PANEL_Z, 1, { tone: "lo" }, { steps: 48 });
  cyl(`mod.buf.reel${i}.pack`, x, y, i ? 6.6 : 9.4, PANEL_Z + 1, 2.4, { tone: "hi" }, { steps: 48, extra: `<g data-part="reel${i}">${reelSpokes(x, y, i ? 6.6 : 9.4, PANEL_Z + 3.4, 0)}</g>` });
  cyl(`mod.buf.reel${i}.hub`, x, y, 2.2, PANEL_Z + 3.4, 1.4, { tone: "mid" }, { steps: 20 });
}
function reelSpokes(x, y, r, z, phase) {
  return Ln([0, 1, 2].map((i) => {
    const a = phase + (i * Math.PI * 2) / 3;
    return k.lineOnTop([x + Math.sin(a) * 2.6, y - Math.cos(a) * 2.6], [x + Math.sin(a) * (r - 1), y - Math.cos(a) * (r - 1)], z, P);
  }).join("") + k.ring(x, y, r - 1, z, P, 40), { tone: "lo" });
}
box("mod.buf.head", [BUF.x0 + 22, MOD_Y1 - 8, PANEL_Z], [BUF.x1 - 22, MOD_Y1 - 3, PANEL_Z + 3.4], { tone: "hi" }, { r: 1, bevel: 0.3 });
const bufOut = jack("mod.buf.out", BUF.x1 - 7, MOD_Y1 - 4);

// GAIN: one big knob, the AudioParam the reader turns
const GAIN = modOf("gain");
const GAIN_KNOB = [(GAIN.x0 + GAIN.x1) / 2, MID_Y - 6];
const gainTop = knob("mod.gain.knob", GAIN_KNOB[0], GAIN_KNOB[1], 8, 5, { lit: true, angle: -0.6, ticks: 20 });
const gainIn = jack("mod.gain.in", GAIN.x0 + 7, MOD_Y1 - 4);
const gainIn2 = jack("mod.gain.in2", GAIN.x0 + 7, MOD_Y1 - 13);
const gainOut = jack("mod.gain.out", GAIN.x1 - 7, MOD_Y1 - 4);

// FILTER: cutoff and Q
const FIL = modOf("filter");
knob("mod.filter.cutoff", (FIL.x0 + FIL.x1) / 2, MID_Y - 10, 5.4, 4, { angle: 0.9, ticks: 10 });
knob("mod.filter.q", FIL.x0 + 9, MID_Y + 6, 3.4, 3, { angle: -1.2 });
const filIn = jack("mod.filter.in", FIL.x0 + 7, MOD_Y1 - 4);
const filOut = jack("mod.filter.out", FIL.x1 - 7, MOD_Y1 - 4);

// SCOPE: an analyser window on top
const SCO = modOf("scope");
const SCOPE_WIN = { x: SCO.x0 + 5, y: MOD_Y0 + 2, w: SCO.x1 - SCO.x0 - 10, d: 26, r: 1.5 };
box("mod.scope.bezel", [SCOPE_WIN.x - 1.4, SCOPE_WIN.y - 1.4, PANEL_Z], [SCOPE_WIN.x + SCOPE_WIN.w + 1.4, SCOPE_WIN.y + SCOPE_WIN.d + 1.4, PANEL_Z + 1.2], { tone: "lo" }, { r: 2.4 });
const scopeIn = jack("mod.scope.in", SCO.x0 + 7, MOD_Y1 - 4);
const scopeThru = jack("mod.scope.thru", SCO.x1 - 7, MOD_Y1 - 4);

// DEST: speaker (the AudioDestinationNode) and the clock that pulls a quantum
const DST = modOf("dest");
const SPK = [DST.x0 + 22, MID_Y - 4];
cyl("mod.dest.basket", SPK[0], SPK[1], 17, PANEL_Z, 1.6, { tone: "lo" }, { steps: 64, extra: Ln(k.ring(SPK[0], SPK[1], 15.4, PANEL_Z + 1.6, P, 64), { tone: "lo" }) });
cyl("mod.dest.cone", SPK[0], SPK[1], 14, PANEL_Z + 1.6, 0.8, { tone: "hi" }, { steps: 64, attrs: ` data-part="cone"`, extra: Ln([11, 8].map((r) => k.ring(SPK[0], SPK[1], r, PANEL_Z + 2.4, P, 56)).join(""), { tone: "faint" }) });
const destIn = jack("mod.dest.in", DST.x0 + 8, MOD_Y1 - 4);
const CLOCK = [DST.x1 - 13, MID_Y + 2];
cyl("mod.dest.motor", CLOCK[0], CLOCK[1] - 14, 5, PANEL_Z, 6, { tone: "mid" }, { steps: 28, bevel: 0.4, extra: Ln(k.sideArc(CLOCK[0], CLOCK[1] - 14, 5, PANEL_Z + 3, P, 20), { tone: "faint" }) });
cyl("mod.dest.gear", CLOCK[0], CLOCK[1], 9, PANEL_Z, 2.6, { tone: "hi" }, { steps: 56, extra: `<g data-part="gear">${gearTeeth(0)}</g>` });
cyl("mod.dest.arbor", CLOCK[0], CLOCK[1], 1.6, PANEL_Z + 2.6, 1.8, { tone: "mid" }, { steps: 16 });
function gearTeeth(phase) {
  const t = k.radialTicks(CLOCK[0], CLOCK[1], 9, 32, 8, PANEL_Z + 2.6, [1.4, 3.2], P, phase);
  return Ln(t.minor, { tone: "lo" }) + Ln(t.major, { tone: "mid" });
}

// module LEDs: lit in toposort order while the audio thread processes each node
for (const m of MODULES) {
  const x = m.x1 - 9;
  const y = MOD_Y0 + 0.6;
  put(`mod.${m.id}.led`, [x, y, PANEL_Z + 0.3], Ln(k.ring(x, y, 1.5, PANEL_Z, P, 14), { tone: "lo" }) + `<circle class="rn-led" data-led="${m.id}" cx="${f2(at([x, y, PANEL_Z])[0])}" cy="${f2(at([x, y, PANEL_Z])[1])}" r="${f2(0.9 * KS)}"/>`, [record(A.cylinder(x, y, 1.5, PANEL_Z, 0.3, { name: `mod.${m.id}.led` }))], { bias: 0.2 });
}

// a short turned boss standing out of a face along `dir`
function boss(name, base, dir, r, len, style = {}, opts = {}) {
  const F = G.frameAlong(base, dir);
  turned(name, F, [[-0.2, r], [len, r]], { tone: "mid", ...style }, { bevel: 0.2, ...opts });
  return G.add3(base, G.mul3(dir, len));
}

// ---- JS console (back left): keys that issue commands, a bell for events --------
const C = CONSOLE;
const C_TOP = 14;
const C_FACE = C.x + C.w - 3;
box("console.base", [C.x, C.y, 0], [C.x + C.w, C.y + C.d, 2], { tone: "lo" }, { r: C.r, steps: 4 });
box("console.body", [C.x + 3, C.y + 3, 2], [C_FACE, C.y + C.d - 3, C_TOP], { tone: "mid" }, {
  r: 3,
  bevel: 0.6,
  steps: 4,
  inner: Ln(k.sideSeam({ x: C.x + 3, y: C.y + 3, w: C.w - 6, d: C.d - 6, r: 3 }, 6, P, 4), { tone: "faint" }),
  extra: Dots([[C.x + 6, C.y + 6], [C_FACE - 3, C.y + 6], [C.x + 6, C.y + C.d - 6], [C_FACE - 3, C.y + C.d - 6]].map(([x, y]) => at([x, y, C_TOP])), { size: 0.5 }),
});
const KEY_WELL = { x: C.x + 7, y: C.y + 44, w: 62, d: 16, r: 2 };
put("console.well", [KEY_WELL.x + 31, KEY_WELL.y + 8, C_TOP + 0.02], Ln(k.planOutline(KEY_WELL, C_TOP, P, 4), { tone: "lo" }), [record(A.slab(KEY_WELL, C_TOP, 0.02, { name: "console.well" }))], { bias: 0.02 });
const KEYS = [0, 1, 2, 3, 4].map((i) => ({ i, x: KEY_WELL.x + 2.4 + i * 11.6, y: KEY_WELL.y + 2.4, w: 10, d: 11.2 }));
for (const key of KEYS) {
  box(`console.key${key.i}`, [key.x, key.y, C_TOP], [key.x + key.w, key.y + key.d, C_TOP + 3.2], { tone: "hi" }, {
    r: 1.6,
    bevel: 0.5,
    attrs: ` data-key="${key.i}"`,
    extra: Ln(k.planOutline(k.insetPlan({ x: key.x, y: key.y, w: key.w, d: key.d, r: 1.6 }, 2), C_TOP + 3.2, P, 3), { tone: "faint" }),
  });
}
// tape reader: the window where the typed call shows
const TAPE = { x: C.x + 8, y: C.y + 22, w: 57, d: 15, r: 1.5 };
box("console.tape.bezel", [TAPE.x - 1.4, TAPE.y - 1.4, C_TOP], [TAPE.x + TAPE.w + 1.4, TAPE.y + TAPE.d + 1.4, C_TOP + 1], { tone: "lo" }, { r: 2.6 });
// bell: the JS event handler rings when an event arrives
const BELL = [C.x + C.w - 16, C.y + 13];
cyl("console.bell.foot", BELL[0], BELL[1], 4.4, C_TOP, 1.2, { tone: "lo" }, { steps: 28 });
cyl("console.bell.post", BELL[0], BELL[1], 1.4, C_TOP + 1.2, 6.8, { tone: "mid" }, { steps: 16 });
turned("console.bell", UP(BELL[0], BELL[1], C_TOP + 8), [[0, 6.6], [0.7, 6.6, 1], [2.2, 5.9, 1], [3.8, 4.8, 1], [5.1, 3.3, 1], [5.8, 1.5, 1], [6, 0]], { tone: "hi" }, { attrs: ` data-part="bell"` });
// pneumatic stations on the right face: two outgoing lines and one incoming
const ST_S = boss("console.station.sched", [C_FACE, -56, PORT_Z], [1, 0, 0], PORT_R, 3);
const ST_G = boss("console.station.graph", [C_FACE, -68, PORT_Z], [1, 0, 0], PORT_R, 3);
const ST_E = boss("console.station.events", [C_FACE, -92, 11.4], [1, 0, 0], PORT_R, 3);

// ---- the two SPSC drums straddling the fence ----------------------------------
const DRUM_BASE_H = 9.2;
const DRUM_TOP = 14;
const SLOT_R = 13;
const HUB_TOP = DRUM_TOP + 3;
const radial = (deg) => [Math.sin((deg * Math.PI) / 180), -Math.cos((deg * Math.PI) / 180), 0];
const DRUM_OUT_DEG = 180;
for (const D of DRUMS) {
  const slotAt = (i) => {
    const a = (i / DRUM_SLOTS) * Math.PI * 2;
    return [D.x + Math.sin(a) * SLOT_R, D.y - Math.cos(a) * SLOT_R];
  };
  D.slots = Array.from({ length: DRUM_SLOTS }, (_, i) => slotAt(i));
  cyl(`drum.${D.id}.base`, D.x, D.y, DRUM_R + 3, 0, DRUM_BASE_H, { tone: "lo" }, { steps: 72, inner: Ln(k.sideArc(D.x, D.y, DRUM_R + 3, 2.2, P, 48), { tone: "faint" }), bevel: 0.5 });
  // platter with pockets; capsules on the far half are drawn with it, the near half after the hub
  const caps = (near) =>
    D.slots
      .map(([x, y], i) => ({ x, y, i }))
      .filter(({ y }) => (y > D.y) === near)
      .sort((a, b) => k.depthOf([a.x, a.y, 0], P) - k.depthOf([b.x, b.y, 0], P))
      .map(({ x, y, i }) => `<g class="rn-cap" data-cap="${D.id}-${i}">${S(k.cylinder(x, y, 2.1, DRUM_TOP, 3.6, P, 18, 0.3), { tone: "hi" })}</g>`)
      .join("");
  cyl(`drum.${D.id}.platter`, D.x, D.y, DRUM_R, DRUM_BASE_H, DRUM_TOP - DRUM_BASE_H, { tone: "mid" }, {
    steps: 72,
    bevel: 0.6,
    extra:
      Ln(D.slots.map(([x, y]) => k.ring(x, y, 2.7, DRUM_TOP, P, 16)).join(""), { tone: "lo" }) +
      Ln(k.ring(D.x, D.y, SLOT_R + 4.4, DRUM_TOP, P, 72) + k.ring(D.x, D.y, SLOT_R - 4.4, DRUM_TOP, P, 56), { tone: "faint" }) +
      caps(false),
  });
  cyl(`drum.${D.id}.hub`, D.x, D.y, 4, DRUM_TOP, HUB_TOP - DRUM_TOP, { tone: "mid" }, { steps: 28, bevel: 0.3 });
  put(`drum.${D.id}.caps`, [D.x, D.y + SLOT_R, DRUM_TOP + 1.8], caps(true), D.slots.filter(([, y]) => y > D.y).map(([x, y], i) => record(A.cylinder(x, y, 2.1, DRUM_TOP, 3.6, { name: `drum.${D.id}.cap` }))), { bias: 0.4 });
  cyl(`drum.${D.id}.spindle`, D.x, D.y, 1.5, HUB_TOP, 6, { tone: "mid" }, { steps: 16, bias: 0.6, extra: `<g data-part="hands-${D.id}"></g>` });
  // ports: in from the JS side, out to the audio side
  D.in = boss(`drum.${D.id}.port.in`, [D.x + radial(D.inDeg)[0] * (DRUM_R + 3), D.y + radial(D.inDeg)[1] * (DRUM_R + 3), PORT_Z], radial(D.inDeg), PORT_R, 2.4);
  D.out = boss(`drum.${D.id}.port.out`, [D.x, D.y + DRUM_R + 3, PORT_Z], radial(DRUM_OUT_DEG), PORT_R, 2.4);
}

// ---- worker bay (back right): promise worker, event dispatcher, disposer -------
// T5 promise worker: resume() starts the platform driver
const PW = PROMISE;
box("promise.case", [PW.x, PW.y, 0], [PW.x + PW.w, PW.y + PW.d, 14], { tone: "mid" }, {
  r: 1.6,
  bevel: 0.5,
  inner: Ln(k.sideSeam({ x: PW.x, y: PW.y, w: PW.w, d: PW.d, r: 1.6 }, 4, P, 3), { tone: "faint" }),
  extra: Dots([[PW.x + 2.6, PW.y + 2.6], [PW.x + PW.w - 2.6, PW.y + 2.6], [PW.x + 2.6, PW.y + PW.d - 2.6], [PW.x + PW.w - 2.6, PW.y + PW.d - 2.6]].map(([x, y]) => at([x, y, 14])), { size: 0.45 }),
});
const LEVER = [PW.x + PW.w / 2, PW.y + PW.d / 2];
box("promise.boot", [LEVER[0] - 4, LEVER[1] - 3, 14], [LEVER[0] + 4, LEVER[1] + 3, 15.6], { tone: "lo" }, { r: 1.2 });
put("promise.lever", [LEVER[0], LEVER[1], 18], `<g data-part="lever">${leverOf(-0.5)}</g>`, [record(A.tube([[LEVER[0], LEVER[1], 15.6], leverTip(-0.5)], 0.9, { name: "promise.lever" }))], { bias: 0.3 });
function leverTip(t) {
  return [LEVER[0] + t * 3.4, LEVER[1], 15.6 + Math.sqrt(36 - t * t * 11.56)];
}
function leverOf(t) {
  const tip = leverTip(t);
  return Ln(path3([[LEVER[0], LEVER[1], 15.6], tip]), { tone: "hi" }).replace('class="iso-line"', 'class="iso-line" style="stroke-width:1.6"') + Dots([at(tip)], { size: 1.3, tone: "hi" });
}
const PW_OUT = boss("promise.port", [PW.x + PW.w / 2, PW.y + PW.d, 11.6], [0, 1, 0], 1.6, 2.4);

// T8 event dispatcher: drains the event queue and calls into JS through the CallInvoker
const DP = DISPATCH;
const DP_TOP = 18;
box("dispatch.case", [DP.x, DP.y, 0], [DP.x + DP.w, DP.y + DP.d, DP_TOP], { tone: "mid" }, {
  r: 2,
  bevel: 0.6,
  steps: 4,
  inner: Ln(k.sideSeam({ x: DP.x, y: DP.y, w: DP.w, d: DP.d, r: 2 }, 6, P, 4), { tone: "faint" }),
  extra: Dots([[DP.x + 3, DP.y + 3], [DP.x + DP.w - 3, DP.y + 3], [DP.x + 3, DP.y + DP.d - 3], [DP.x + DP.w - 3, DP.y + DP.d - 3]].map(([x, y]) => at([x, y, DP_TOP])), { size: 0.45 }),
});
// queue magazine: eight visible slots of the 256-entry ConcurrentQueue
const MAG = { x: DP.x + 5, y: DP.y + DP.d - 13, w: DP.w - 10, d: 8, r: 1 };
box("dispatch.mag", [MAG.x, MAG.y, DP_TOP], [MAG.x + MAG.w, MAG.y + MAG.d, DP_TOP + 1.6], { tone: "lo" }, {
  r: 1,
  extra: Ln(Array.from({ length: 8 }, (_, i) => k.ring(MAG.x + 2.4 + i * ((MAG.w - 4.8) / 7), MAG.y + MAG.d / 2, 1.1, DP_TOP + 1.6, P, 12)).join(""), { tone: "faint" }) +
    Array.from({ length: 8 }, (_, i) => { const p = at([MAG.x + 2.4 + i * ((MAG.w - 4.8) / 7), MAG.y + MAG.d / 2, DP_TOP + 1.6]); return `<circle class="rn-qdot" data-q="${i}" cx="${f2(p[0])}" cy="${f2(p[1])}" r="${f2(0.75 * KS)}"/>`; }).join(""),
});
// relay coil and armature: the semaphore the worker waits on
const COIL = [DP.x + 11, DP.y + 11];
cyl("dispatch.coil.base", COIL[0], COIL[1], 5, DP_TOP, 1, { tone: "lo" }, { steps: 28 });
cyl("dispatch.coil", COIL[0], COIL[1], 3.6, DP_TOP + 1, 6, { tone: "hi" }, { steps: 28, extra: Ln([3, 5].map((z) => k.sideArc(COIL[0], COIL[1], 3.6, DP_TOP + z, P, 20)).join(""), { tone: "faint" }) });
box("dispatch.yoke", [COIL[0] + 5, COIL[1] - 2, DP_TOP], [COIL[0] + 8, COIL[1] + 2, DP_TOP + 8], { tone: "mid" }, { r: 0.5 });
put("dispatch.armature", [COIL[0] + 2, COIL[1], DP_TOP + 8.6], `<g data-part="armature">${S(k.slabOf({ x: COIL[0] - 3, y: COIL[1] - 1.8, w: 11, d: 3.6, r: 0.6 }, DP_TOP + 8, 1.2, P, 2), { tone: "mid" })}</g>`, [record(A.slab({ x: COIL[0] - 3, y: COIL[1] - 1.8, w: 11, d: 3.6, r: 0.6 }, DP_TOP + 8, 1.2, { name: "dispatch.armature" }, 2))], { bias: 0.3 });
// vents on the dispatcher's +x face: closed slots
put("dispatch.vents", [DP.x + DP.w + 0.02, DP.y + DP.d / 2, 9], Ln(Array.from({ length: 5 }, (_, i) => {
  const y0 = DP.y + 8 + i * 5;
  return path3([[DP.x + DP.w + 0.02, y0, 5], [DP.x + DP.w + 0.02, y0 + 2.2, 5], [DP.x + DP.w + 0.02, y0 + 2.2, 13], [DP.x + DP.w + 0.02, y0, 13]], true);
}).join(""), { tone: "faint" }), [record(A.box([DP.x + DP.w, DP.y + 8, 5], [DP.x + DP.w + 0.04, DP.y + 32, 13], { name: "dispatch.vents" }))], { bias: 0.05 });
// task window on the promise worker: four of its 64 queue slots
put("promise.slots", [PW.x + PW.w / 2, PW.y + 4, 14.02], Ln([0, 1, 2, 3].map((i) => k.ring(PW.x + 5 + i * 4, PW.y + 4.2, 1, 14, P, 10)).join(""), { tone: "lo" }), [record(A.slab({ x: PW.x + 3, y: PW.y + 3, w: 16, d: 2.4, r: 0.4 }, 14, 0.02, { name: "promise.slots" }))], { bias: 0.05 });
const DP_IN = boss("dispatch.port.in", [DP.x + 14, DP.y + DP.d, 12], [0, 1, 0], PORT_R, 2.4);
const DP_OUT = boss("dispatch.port.out", [DP.x, -92, 11.4], [-1, 0, 0], PORT_R, 2.4);

// T7 disposer: a shredder that destroys what the audio thread swapped out
const B = BIN;
const BIN_TOP = 22;
box("bin.base", [B.x, B.y, 0], [B.x + B.w, B.y + B.d, 2], { tone: "lo" }, { r: B.r, steps: 4 });
box("bin.body", [B.x + 4, B.y + 4, 2], [B.x + B.w - 4, B.y + B.d - 4, BIN_TOP], { tone: "mid" }, {
  r: 2.4,
  bevel: 0.6,
  steps: 4,
  inner: Ln(k.sideSeam({ x: B.x + 4, y: B.y + 4, w: B.w - 8, d: B.d - 8, r: 2.4 }, 12, P, 4), { tone: "faint" }),
});
const THROAT = { x: B.x + 14, y: B.y + 12, w: B.w - 28, d: B.d - 26 };
const HW = 2.4;
const HOP_TOP = BIN_TOP + 11;
box("bin.wall.back", [THROAT.x - HW, THROAT.y - HW, BIN_TOP], [THROAT.x + THROAT.w + HW, THROAT.y, HOP_TOP], { tone: "mid" }, { r: 0.4, bevel: 0.3 });
box("bin.wall.left", [THROAT.x - HW, THROAT.y, BIN_TOP], [THROAT.x, THROAT.y + THROAT.d, HOP_TOP], { tone: "mid" }, { r: 0.3, bevel: 0.3 });
const ROLLER_R = 4.2;
const ROLLER_Z = BIN_TOP + ROLLER_R + 0.3;
const ROLLERS = [THROAT.y + THROAT.d * 0.29, THROAT.y + THROAT.d * 0.71];
const rollerFrame = (y) => G.frameOf([THROAT.x, y, ROLLER_Z], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
function rollerRibs(F, phase) {
  return k.fadedSvg(G.ribsOf(F, 0, THROAT.w, ROLLER_R, 14, P, { phase, fade: [0.1, 0.55] }), { tone: "lo" });
}
for (const [i, y] of ROLLERS.entries()) {
  turned(`bin.roller${i}`, rollerFrame(y), [[0, ROLLER_R], [THROAT.w, ROLLER_R]], { tone: "hi" }, { extra: `<g data-part="roller${i}">${rollerRibs(rollerFrame(y), 0)}</g>` });
}
box("bin.wall.right", [THROAT.x + THROAT.w, THROAT.y, BIN_TOP], [THROAT.x + THROAT.w + HW, THROAT.y + THROAT.d, HOP_TOP], { tone: "mid" }, { r: 0.3, bevel: 0.3 });
box("bin.wall.front", [THROAT.x - HW, THROAT.y + THROAT.d, BIN_TOP], [THROAT.x + THROAT.w + HW, THROAT.y + THROAT.d + HW, HOP_TOP], { tone: "mid" }, { r: 0.4, bevel: 0.3 });
box("bin.motor", [B.x + B.w - 4, B.y + 16, 6], [B.x + B.w + 2, B.y + 34, 18], { tone: "mid" }, { r: 1.4, bevel: 0.4, extra: Dots([at([B.x + B.w + 2, B.y + 19, 15]), at([B.x + B.w + 2, B.y + 31, 9])], { size: 0.45 }) });
box("bin.intake.plate", [118 - 5, B.y + B.d - 4, 7], [118 + 5, B.y + B.d - 3.2, 17], { tone: "lo" }, { r: 0.8, extra: Dots([[114.6, 8.6], [121.4, 8.6], [114.6, 15.4], [121.4, 15.4]].map(([x, z]) => at([x, B.y + B.d - 3.2, z])), { size: 0.45 }) });
put("bin.label", [140, B.y + B.d - 3.98, 12], Ln(path3([[131, B.y + B.d - 3.98, 9], [151, B.y + B.d - 3.98, 9], [151, B.y + B.d - 3.98, 16], [131, B.y + B.d - 3.98, 16]], true), { tone: "lo" }) + Ln([[134, 14, 145], [134, 12, 141], [134, 10.4, 148]].map(([x0, z, x1]) => path3([[x0, B.y + B.d - 3.98, z], [x1, B.y + B.d - 3.98, z]])).join(""), { tone: "lo", free: true }), [record(A.box([131, B.y + B.d - 4, 9], [151, B.y + B.d - 3.96, 16], { name: "bin.label" }))], { bias: 0.05 });
const BIN_IN = boss("bin.port.in", [118, B.y + B.d - 3.2, 12], [0, 1, 0], PORT_R, 2.4);

// ---- connectors on the rack's back: where the audio thread meets the lines ----
const RACK_BACK = CASE.y;
const RK_S = boss("case.port.sched", [DRUMS[0].x, RACK_BACK, PORT_Z], [0, -1, 0], PORT_R, 2);
const RK_G = boss("case.port.graph", [DRUMS[1].x, RACK_BACK, PORT_Z], [0, -1, 0], PORT_R, 2);
const RK_E = boss("case.port.events", [DP_IN[0], RACK_BACK, 11.6], [0, -1, 0], PORT_R, 2.4);
const RK_P = boss("case.port.driver", [PW_OUT[0], RACK_BACK, 11.6], [0, -1, 0], 1.6, 2.4);
const RK_D = boss("case.port.dispose", [BIN_IN[0], RACK_BACK, 11.6], [0, -1, 0], PORT_R, 2.4);

// ---- pneumatic lines --------------------------------------------------------
const TUBE_R = 1.3;
const pneu = (name, points, opts = {}) => cable(name, points, TUBE_R, { tone: "mid", bend: 3.6, shells: [true, true], maxLength: 12, limp: false, ...opts });
const S0 = DRUMS[0].in;
const sDir = radial(DRUMS[0].inDeg);
pneu("line.sched.in", [ST_S, [ST_S[0] + 3, ST_S[1], PORT_Z], [S0[0] + sDir[0] * 6, S0[1] + sDir[1] * 6, PORT_Z], S0]);
const G0 = DRUMS[1].in;
pneu("line.graph.in", [ST_G, [G0[0], ST_G[1], ST_G[2]], [G0[0], G0[1], G0[2]]]);
pneu("line.sched.out", [DRUMS[0].out, RK_S], { maxLength: 30 });
pneu("line.graph.out", [DRUMS[1].out, RK_G], { maxLength: 30 });
pneu("line.events", [RK_E, DP_IN], { maxLength: 14 });
pneu("line.invoke", [DP_OUT, ST_E], { maxLength: 14 });
pneu("line.dispose", [RK_D, BIN_IN], { maxLength: 14 });
cable("line.driver", [PW_OUT, RK_P], 0.7, { tone: "lo", bend: 3, shells: [true, true], maxLength: 14 });


// ---- screens drawn in the plane of their top faces ------------------------------
function screen(name, plan, z, inner) {
  const m = k.topMatrix([plan.x, plan.y], z, P, "x");
  const id = `clip-${name.replace(/\./g, "-")}`;
  const body = `<clipPath id="${id}"><rect x="0" y="0" width="${plan.w}" height="${plan.d}" rx="${plan.r}"/></clipPath><g transform="${m}"><rect class="rn-screen" x="0" y="0" width="${plan.w}" height="${plan.d}" rx="${plan.r}"/><g clip-path="url(#${id})">${inner}</g><rect class="rn-glass" x="0" y="0" width="${plan.w}" height="${plan.d}" rx="${plan.r}"/></g>`;
  put(name, [plan.x + plan.w / 2, plan.y + plan.d / 2, z + 0.01], body, [record(A.slab(plan, z, 0.02, { name }, 3))], { bias: 0.1 });
  return m;
}
const scopeGrid = [1, 2, 3].map((i) => `<path class="rn-grid" d="M${f2((SCOPE_WIN.w * i) / 4)} 0V${SCOPE_WIN.d}"/>`).join("") + `<path class="rn-grid" d="M0 ${f2(SCOPE_WIN.d / 2)}H${SCOPE_WIN.w}"/>`;
screen("mod.scope.window", SCOPE_WIN, PANEL_Z + 1.2, `${scopeGrid}<path class="rn-wave" data-part="wave" d="M1 ${f2(SCOPE_WIN.d / 2)}H${SCOPE_WIN.w - 1}"/>`);
screen("console.tape.window", TAPE, C_TOP + 1, `<text class="rn-tape" data-part="tape0" x="2.4" y="6.4" font-size="3.6"></text><text class="rn-tape" data-part="tape1" x="2.4" y="12" font-size="3.6"></text>`);

// ---- patch cables: the audio graph ---------------------------------------------
const PATCH_Z = 30;
const patch = (name, a, b, lift = 12) => {
  const up = (p, dz) => [p[0], p[1], p[2] + dz];
  return cable(name, [a, up(a, lift), up(b, lift), b], 1.1, { tone: "hi", bend: 5, shells: [true, true] });
};
patch("patch.osc-gain", oscOut, gainIn2, 20);
patch("patch.buf-gain", bufOut, gainIn, 9);
patch("patch.gain-filter", gainOut, filIn, 9);
patch("patch.filter-scope", filOut, scopeIn, 9);
patch("patch.scope-dest", scopeThru, destIn, 9);

// ---- assemble ---------------------------------------------------------------
A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);
const groups = R.items.map((item) => `<g class="it" data-name="${item.name}"${item.attrs ?? ""}>${item.svg}</g>`);

const LABEL_TEXT =
  "A tabletop modular synthesizer on a bench, standing in for react-native-audio-api. At the back left a JS console with five keys sends commands down two pneumatic lines into two slotted drums that straddle a low fence: the event-scheduler ring and the graph ring, the only way across from the JS thread to the audio thread. In front, a rack of patched modules is the audio graph: oscillator, tape-reel buffer source, gain, filter, analyser scope and a speaker whose clock wheel turns once per 128-frame render quantum. Behind the fence at the right, a worker bay holds the promise worker, the event dispatcher whose line runs back to a bell on the console, and the disposer, a shredder that destroys buffers the audio thread swapped out.";
const svg = k.figureSvg({
  width: W,
  height: H,
  label: LABEL_TEXT,
  body: [...back, `<g class="rn-bench">${groups.join("")}</g>`, `<g data-part="flows"></g>`, `<g data-part="tokens"></g>`],
});

const routeScreen = (name) => R.routes.find((r) => r.name === name).points.map((p) => at(p).map(f2));
const DATA = {
  P,
  KS,
  quantumSeconds: 1.28,
  sampleRate: 48000,
  quantum: 128,
  slots: DRUM_SLOTS,
  drums: DRUMS.map((D) => ({ id: D.id, x: D.x, y: D.y, slotR: SLOT_R, write: HUB_TOP + 2.2, read: HUB_TOP + 4.4 })),
  routes: Object.fromEntries(
    ["line.sched.in", "line.graph.in", "line.sched.out", "line.graph.out", "line.events", "line.invoke", "line.dispose", "line.driver", "patch.osc-gain", "patch.buf-gain", "patch.gain-filter", "patch.filter-scope", "patch.scope-dest"].map((name) => [name, routeScreen(name)]),
  ),
  gain: { x: GAIN_KNOB[0], y: GAIN_KNOB[1], r: 8, top: gainTop },
  gear: { x: CLOCK[0], y: CLOCK[1], r: 9, z: PANEL_Z + 2.6 },
  reels: REELS.map(([x, y], i) => ({ x, y, r: i ? 6.6 : 9.4, z: PANEL_Z + 3.4 })),
  rollers: ROLLERS.map((y) => ({ F: rollerFrame(y), w: THROAT.w, r: ROLLER_R })),
  lever: { x: LEVER[0], y: LEVER[1], z: 15.6 },
  scope: { w: SCOPE_WIN.w, d: SCOPE_WIN.d },
};

const CSS = `
.rn-led{fill:var(--anatomy-paper);stroke:var(--anatomy-lo);stroke-width:var(--anatomy-weight);transition:fill 120ms linear}
.rn-led[data-on]{fill:var(--anatomy-lit);stroke:var(--anatomy-lit)}
.rn-qdot{fill:var(--anatomy-paper);stroke:none;transition:fill 160ms linear}
.rn-qdot[data-on]{fill:var(--anatomy-lit)}
.rn-cap{opacity:0;transition:opacity 220ms linear}
.rn-cap[data-on]{opacity:1}
.rn-cap[data-on] .iso-edge{stroke:var(--anatomy-lit)}
.rn-screen{fill:var(--anatomy-shade-0);stroke:var(--anatomy-lo);stroke-width:var(--anatomy-weight)}
.rn-glass{fill:none;stroke:var(--anatomy-mid);stroke-width:var(--anatomy-weight)}
.rn-grid{stroke:var(--anatomy-faint);stroke-width:var(--anatomy-weight);fill:none}
.rn-wave{stroke:var(--anatomy-lit);stroke-width:1px;fill:none;stroke-linejoin:round}
.rn-tape{fill:var(--anatomy-hi);font-family:var(--anatomy-mono);letter-spacing:-.02em}
.rn-token{fill:var(--anatomy-lit);stroke:var(--anatomy-paper);stroke-width:.8px}
.rn-flow{stroke:var(--anatomy-lit);stroke-width:1.6px;fill:none;stroke-linecap:round}
.rn-hand{stroke-linecap:round}
[data-route="patch.buf-gain"]{transition:opacity 420ms var(--anatomy-ease),transform 420ms var(--anatomy-ease)}
.rn-unplugged [data-route="patch.buf-gain"]{opacity:0;transform:translateY(-10px)}
.it[data-key]{cursor:pointer}
.it[data-key][data-down] .iso-edge{stroke:var(--anatomy-lit)}
.rn-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.iso-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.iso-stage{touch-action:pan-y;position:relative}
`;

const latheSource = readFileSync(join(KIT, "kit", "lathe.mjs"), "utf8").replace(/^import .*$/m, "").replace(/^export /gm, "");
const latheScript = `const G = (() => {${latheSource}\nreturn { ribsOf };})();\n`;
const LIVE = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA));

const body =
  `<style>${CSS}</style>` +
  k.plateHtml({
    fig: "Fig 1",
    title: "react-native-audio-api",
    hint: "keys 1–5 or tap the console · space",
    readout: "suspended · quantum 0",
    keys: [
      { mark: "lit", label: "The audio thread: read hands on the rings, module lamps lit in toposort order, the copy to the speaker" },
      { mark: "raised", label: "Keys 1–5: start · gain · connect a buffer source · swap its buffer · stop" },
      { mark: "edge", label: "Lines: JS → rings → rack; rack → dispatcher → bell; rack → disposer; promise worker → driver" },
    ],
    caption:
      "Every JS call becomes a closure dropped into one of two lock-free single-producer rings (1,024 slots each; 12 drawn): node properties, params, start and stop go to the event scheduler, connect and disconnect to the graph channel. The audio thread never waits for JS. Once per render quantum, when CoreAudio or Oboe asks for 128 frames (2.67 ms at 48 kHz, shown 480× slower), it drains the scheduler, then the graph channel, re-sorts the graph if it changed, marks everything upstream of the speaker and the analyser as processable, runs those nodes in topological order and copies the speaker's buffer out. Ended and other events go into a wait-free queue that a dispatcher thread hands to JS through the CallInvoker. Buffers the audio thread swaps out are destroyed on the per-context disposer thread, and a node itself is freed on the JS or GC thread only after the audio graph has let go of it. Pressing start on a suspended context runs the call on the JS thread and asks the promise worker to start the driver.",
    body: `<div class="iso-stage rn-unplugged" tabindex="0" role="group" aria-label="Audio engine bench. Keys 1 to 5: start the oscillator, change the gain, connect and start a buffer source, swap its buffer, stop the oscillator. Space suspends or resumes the context.">${svg}<span class="rn-sr" role="status" aria-live="polite" data-status></span></div>`,
  });

// artifact variant: no document skeleton, theme follows the viewer (light first, dark via media query or data-theme)
{
  const css = k.ISO_CSS;
  const darkStart = css.indexOf(".iso{");
  const darkEnd = css.indexOf("}", darkStart) + 1;
  const lightStart = css.indexOf('.iso[data-theme="light"]{');
  const lightEnd = css.indexOf("}", lightStart) + 1;
  const dark = css.slice(darkStart + 5, darkEnd - 1);
  const light = css.slice(lightStart + '.iso[data-theme="light"]{'.length, lightEnd - 1);
  const rest = css.slice(0, darkStart) + css.slice(darkEnd, lightStart) + css.slice(lightEnd);
  const pageVars = (v) => `--page-bg:${/--anatomy-page:([^;]+);/.exec(v)[1]};`;
  const themed = `:root{${pageVars(light)}}.iso{${dark}${light}}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${pageVars(dark)}color-scheme:dark}:root:not([data-theme="light"]) .iso{${dark}}}
:root[data-theme="dark"]{${pageVars(dark)}color-scheme:dark}:root[data-theme="dark"] .iso{${dark}}
body{background:var(--page-bg)}
.iso-page{box-sizing:border-box;width:100%;max-width:792px;margin:0 auto;padding-inline:16px;padding-block:40px 64px;color:var(--anatomy-text);font:14px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.iso-page *{box-sizing:border-box}`;
  const artifact = `<title>Audio API Engine Bench</title><style>${themed}${rest}</style><main class="iso iso-page">${body}</main><script type="module">${(kitScript() + latheScript + LIVE).replace(/<\/(script)/gi, "<\\/$1")}</script>`;
  writeFileSync(join(HERE, "rnaa-artifact.html"), artifact);
}
const page = k.pageHtml({ title: "Audio engine anatomy", theme: THEME, body, script: kitScript() + latheScript + LIVE, width: 760 });
const name = THEME === "light" ? "rnaa-light.html" : "rnaa.html";
writeFileSync(join(HERE, name), page);
console.log("wrote", name, `${(page.length / 1024).toFixed(0)} KB`, `${R.items.length} items`, `scale ${KS.toFixed(3)}`);
A.auditOrExit(R, P, { crowd: [["patch.*", "case.floor"]] });
