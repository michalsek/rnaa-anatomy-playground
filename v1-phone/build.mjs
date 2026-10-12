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

const W = 680;
const H = 840;
const AZIMUTH = 32;
const ELEVATION = 36;

// ---- the phone, lying face up: x across, y along (top of the phone at −y), z out of the screen ----
const PHONE = { x: -76, y: -156, w: 152, d: 312, r: 26 };
const BAND_T = 3.4; // aluminium band wall
const INNER = k.insetPlan(PHONE, BAND_T);
const Z = { back: 2.4, tray: 4.4, band: 22, oled: 20.2, glass: 24.4 };

// assemblies: the display lifts and slides toward the top of the phone, the band follows, the chassis stays
const PIECES = {
  display: { move: [0, -30, 250], name: "Display" },
  engine: { move: [0, 0, 92], name: "Audio engine" },
  frame: { move: [0, 0, 0], name: "Frame and chassis" },
};
const STAGGER = ["display", "engine", "frame"];
const SPRING = { stagger: 0.06, stiffness: 46, damping: 12.6, substeps: 4 };

const fitPoints = [
  ...k.boxCorners(PHONE, 0, Z.glass),
  ...k.boxCorners({ ...PHONE, y: PHONE.y + PIECES.display.move[1] }, Z.glass + PIECES.display.move[2] - 4, Z.glass + PIECES.display.move[2]),
  ...k.boxCorners(PHONE, 92, 112),
];
const P = k.fitProjection(fitPoints, W, H, { pad: 26, azimuth: AZIMUTH, elevation: ELEVATION });
const V = G.viewOf(P);
const KS = G.scaleOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);
const f2 = (v) => Math.round(v * 100) / 100;
const UP = (x, y, z) => G.frameOf([x, y, z], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

const R = A.recorder(P, { order: STAGGER, spring: SPRING });
const record = R.solid;
let PIECE = "frame";
let MATERIAL = "";
function put(name, ref, svg, shapes = [], { bias = 0, piece = PIECE, attrs, material = MATERIAL } = {}) {
  return R.put({ name: R.nameFor(name), at: ref, bias, svg, shapes, piece, ride: piece, move: PIECES[piece].move, attrs, material });
}
function box(name, [x0, y0, z0], [x1, y1, z1], style = {}, { r = 0.6, steps = 3, bevel = 0, extra = "", inner = "", bias = 0, attrs } = {}) {
  const plan = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r };
  const shape = record(A.slab(plan, z0, z1 - z0, { name }, steps));
  put(name, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], S(k.slabOf(plan, z0, z1 - z0, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
  return plan;
}
function slab(name, plan, z0, h, style = {}, { steps = 6, bevel = 0, extra = "", inner = "", bias = 0, attrs } = {}) {
  const shape = record(A.slab(plan, z0, h, { name }, steps));
  put(name, [plan.x + plan.w / 2, plan.y + plan.d / 2, z0 + h / 2], S(k.slabOf(plan, z0, h, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
}
function prism(name, ring, z0, h, style = {}, { extra = "", inner = "", bias = 0, ref, attrs } = {}) {
  const shape = record(A.extruded(ring, z0, h, { name }));
  const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
  const cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  put(name, ref ?? [cx, cy, z0 + h / 2], S(k.extrude(ring, z0, h, P, { convex: false }), { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
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
function boss(name, base, dir, r, len, style = {}, opts = {}) {
  const F = G.frameAlong(base, dir);
  turned(name, F, [[-0.2, r], [len, r]], { tone: "mid", ...style }, { bevel: 0.2, ...opts });
  return G.add3(base, G.mul3(dir, len));
}
function screws(points, z, { ring = 1.2, size = 0.45 } = {}) {
  return Ln(points.map(([x, y]) => k.ring(x, y, ring, z, P, 12)).join(""), { tone: "lo" }) + Dots(points.map(([x, y]) => at([x, y, z])), { size });
}
const ROUTES = {};
function cable(name, points, r = 0.9, { tone = "mid", bend = 4, shells = [true, true], rings, maxLength = 12, bias = 0.05, limp = false, attrs } = {}) {
  const route = G.fillet(points, Math.max(bend, r * 2.6), 10, { P, tube: r });
  const total = G.pathLength(route);
  const SHELL = Math.max(1.8, r * 2.2);
  const gaps = [...(shells[0] ? [[0, SHELL]] : []), ...(shells[1] ? [[total - SHELL, total]] : [])];
  R.route(name, route, r, { gaps, limp, rims: shells.map((on) => (on ? r * 1.6 : r)), piece: PIECE, move: PIECES[PIECE].move, ride: PIECE });
  ROUTES[name] = route;
  tubePieces(route, r, P, { maxLength, spacing: Math.max(0.6, Math.min(1.6, r)), gaps, ...(rings ? { rings } : {}) }).forEach((piece, index) =>
    put(`${name}:${index}`, piece.mid, tubeSvg(piece, { tone }), [A.tube(piece.points, piece.radii)], { bias, attrs: ` data-route="${name}"` }),
  );
  [0, 1].forEach((index) => {
    if (!shells[index]) return;
    const end = index ? route[route.length - 1] : route[0];
    const tangent = G.tangentAlong(route, index ? total : 0);
    const F = G.frameAlong(end, tangent);
    const [s0, s1] = index ? [-SHELL, 0] : [0, SHELL];
    const shape = record(A.disc(F, s0, s1, r * 1.6, { name: `${name}.shell${index}`, owner: name }));
    put(`${name}.shell${index}`, G.add3(end, G.mul3(tangent, (s0 + s1) / 2)), S(G.disc(s0, s1, r * 1.6, F, P, { steps: 24, bevel: 0.2 }), { tone: "mid" }), [shape], { bias: bias + 0.1, attrs: ` data-route="${name}"` });
  });
  return route;
}

// ---- the bench under the phone (static, back layer) ------------------------------
const back = [];
back.push(`<path class="iso-halo" d="${k.haloOf(k.insetPlan(PHONE, -6), -1, 1, P)}"/>`);
record(A.slab(k.insetPlan(PHONE, -40), -1, 1, { name: "stand.bench", ground: true }, 8));

// ---- 1. CHASSIS: back glass and the inner tray (stays put) ------------------------
PIECE = "frame";
slab("chassis.back", k.insetPlan(PHONE, 0.6), 0, Z.back, { tone: "lo" }, { steps: 10, bevel: 0.5 });
const TRAY = k.insetPlan(INNER, 2.2);
MATERIAL = "rn-inside";
slab("chassis.tray", TRAY, Z.back, Z.tray - Z.back, { tone: "lo" }, {
  steps: 10,
  extra: Ln(k.planOutline(k.insetPlan(TRAY, 4), Z.tray, P, 10), { tone: "faint" }) + screws([[TRAY.x + 7, TRAY.y + 7], [TRAY.x + TRAY.w - 7, TRAY.y + 7], [TRAY.x + 7, TRAY.y + TRAY.d - 7], [TRAY.x + TRAY.w - 7, TRAY.y + TRAY.d - 7]], Z.tray),
});

MATERIAL = "";
// ---- 2. FRAME: the aluminium band, built as corner and side pieces -----------------
{
  const steps = 7;
  const outer = k.roundedPlan(PHONE, steps);
  const inner = k.roundedPlan({ ...INNER, r: PHONE.r - BAND_T }, steps);
  const per = steps + 1;
  const pieces = [];
  for (let c = 0; c < 4; c++) {
    const a = c * per;
    const b = a + steps;
    const m = a + Math.round(steps / 2);
    pieces.push({ name: "band.corner", ring: [...outer.slice(a, m + 1), ...inner.slice(a, m + 1).reverse()] });
    pieces.push({ name: "band.corner", ring: [...outer.slice(m, b + 1), ...inner.slice(m, b + 1).reverse()] });
    const n = ((c + 1) % 4) * per;
    pieces.push({ name: "band.side", ring: [outer[b], outer[n], inner[n], inner[b]] });
  }
  for (const piece of pieces) prism(piece.name, piece.ring, Z.back, Z.band - Z.back, { tone: "mid" }, { inner: "" });
}
// buttons on the near long side (+x): power and the SIM tray; volume on the far side
const SIDE_X = PHONE.x + PHONE.w;
box("band.power", [SIDE_X, -40, 8], [SIDE_X + 1.6, -6, 14], { tone: "hi" }, { r: 0.8, bevel: 0.3 });
box("band.sim", [SIDE_X - 0.2, 30, 7.4], [SIDE_X + 0.5, 62, 14.6], { tone: "mid" }, { r: 0.6, extra: Dots([at([SIDE_X + 0.5, 34, 11])], { size: 0.55, tone: "lo" }) });
box("band.volume.up", [PHONE.x - 1.6, -92, 8], [PHONE.x, -70, 14], { tone: "hi" }, { r: 0.8 });
box("band.volume.down", [PHONE.x - 1.6, -62, 8], [PHONE.x, -40, 14], { tone: "hi" }, { r: 0.8 });
// bottom end (+y): USB-C, speaker grilles and two pentalobe screws
const END_Y = PHONE.y + PHONE.d;
{
  const usb = [[-9, 9.4], [9, 9.4], [9, 12.6], [-9, 12.6]];
  const face = (x, z) => [x, END_Y + 0.02, z];
  const slot = (cx, cz, w, h) => path3(k.roundedPlan({ x: cx - w / 2, y: cz - h / 2, w, d: h, r: h / 2 }, 4).map(([x, z]) => face(x, z)), true);
  const grille = (x0) => Array.from({ length: 6 }, (_, i) => face(x0 + i * 4.2, 11));
  put("band.end", [0, END_Y + 0.02, 11], Ln(slot(0, 11, 20, 4.4), { tone: "lo" }) + Ln(slot(0, 11, 16, 2.4), { tone: "faint" }) + Dots([...grille(-44), ...grille(22)].map(at), { size: 0.85, tone: "lo" }) + Dots([face(-28, 11), face(28, 11)].map(at), { size: 0.6, tone: "mid" }), [record(A.box([-46, END_Y, 8], [46, END_Y + 0.04, 14], { name: "band.end" }))], { bias: 0.05 });
}

// ---- 3. DISPLAY: OLED stack and cover glass with the React logo ---------------------
PIECE = "display";
const OLED = k.insetPlan(INNER, 6);
slab("display.oled", OLED, Z.oled, Z.band - Z.oled, { tone: "lo" }, { steps: 10 });
const GLASS = k.insetPlan(PHONE, 0.8);
{
  const SCREEN = k.insetPlan(GLASS, 4.4);
  const m = k.topMatrix([SCREEN.x, SCREEN.y], Z.glass, P, "x");
  const cx = SCREEN.w / 2;
  const cy = SCREEN.d * 0.46;
  const orbit = (deg) => `<ellipse cx="${f2(cx)}" cy="${f2(cy)}" rx="44" ry="16.5" transform="rotate(${deg} ${f2(cx)} ${f2(cy)})"/>`;
  const island = `<rect class="rn-island" x="${f2(cx - 17)}" y="7" width="34" height="9.5" rx="4.75"/>`;
  const logo = `<g class="rn-logo">${orbit(90)}${orbit(30)}${orbit(150)}<circle class="rn-nucleus" cx="${f2(cx)}" cy="${f2(cy)}" r="7.4"/><circle class="rn-ripple" data-part="ripple" cx="${f2(cx)}" cy="${f2(cy)}" r="7.4"/></g>`;
  const home = `<rect class="rn-home" x="${f2(cx - 22)}" y="${f2(SCREEN.d - 9)}" width="44" height="2.6" rx="1.3"/>`;
  const art = `<clipPath id="rn-screen-clip"><rect x="0" y="0" width="${f2(SCREEN.w)}" height="${f2(SCREEN.d)}" rx="${f2(SCREEN.r)}"/></clipPath><g transform="${m}"><rect class="rn-screen" x="0" y="0" width="${f2(SCREEN.w)}" height="${f2(SCREEN.d)}" rx="${f2(SCREEN.r)}"/><g clip-path="url(#rn-screen-clip)">${logo}${island}${home}<path class="rn-glare" d="M${f2(SCREEN.w * 0.62)} 0L${f2(SCREEN.w)} 0L${f2(SCREEN.w)} ${f2(SCREEN.d * 0.2)}Z"/></g></g>`;
  slab("display.glass", GLASS, Z.band, Z.glass - Z.band, { tone: "hi" }, { steps: 10, bevel: 0.8, extra: art });
}

// ---- 4. FRAME INTERIOR: what stays in the phone when the engine lifts out ----------
PIECE = "frame";
MATERIAL = "rn-inside";
const SLED = { x: -64, y: -100, w: 128, d: 196, r: 12 };
Z.sled0 = 5.4;
Z.sled1 = 7.4;
const STANDOFFS = [[-56, -92], [56, -92], [-58, -8], [58, -8], [-56, 88], [56, 88]];
for (const [x, y] of byDepth(STANDOFFS)) cyl("frame.standoff", x, y, 2.6, Z.tray, Z.sled0 - Z.tray, { tone: "mid" }, { steps: 16 });
// top end: camera block (seen from inside), display socket, earpiece
const TOP = { y0: TRAY.y + 3, y1: SLED.y - 4 };
box("frame.camera.block", [-60, TOP.y0, Z.tray], [-14, TOP.y1, 13], { tone: "mid" }, { r: 3, bevel: 0.5, inner: Ln(k.sideSeam({ x: -60, y: TOP.y0, w: 46, d: TOP.y1 - TOP.y0, r: 3 }, 8, P, 3), { tone: "faint" }) });
for (const [i, [x, y]] of [[-48, -134], [-27, -134], [-37.5, -120]].entries()) {
  cyl("frame.camera.lens", x, y, 7.4, 13, 2.4, { tone: "hi" }, { steps: 36, bevel: 0.4, extra: Ln(k.ring(x, y, 5.2, 15.4, P, 32) + k.ring(x, y, 2.6, 15.4, P, 24), { tone: "lo" }) });
}
cyl("frame.camera.flash", -18.5, -140, 2.6, 13, 1.2, { tone: "hi" }, { steps: 16 });
const SOCKET = { x0: 12, x1: 34, y0: -137, y1: -122 };
box("frame.socket", [SOCKET.x0, SOCKET.y0, Z.tray], [SOCKET.x1, SOCKET.y1, 9.6], { tone: "mid" }, { r: 1, bevel: 0.3, extra: Ln(Array.from({ length: 7 }, (_, i) => k.planOutline({ x: SOCKET.x0 + 2.4 + i * 2.6, y: SOCKET.y0 + 4, w: 1.2, d: SOCKET.y1 - SOCKET.y0 - 8, r: 0.5 }, 9.6, P, 2)).join(""), { tone: "lo" }) + Ln(k.planOutline({ x: SOCKET.x0 + 1.6, y: SOCKET.y0 + 2.4, w: SOCKET.x1 - SOCKET.x0 - 3.2, d: SOCKET.y1 - SOCKET.y0 - 4.8, r: 0.8 }, 9.6, P, 2), { tone: "faint" }) });
box("frame.earpiece", [40, -146, Z.tray], [62, -138, 8.4], { tone: "lo" }, { r: 3.6, bevel: 0.3, extra: Ln(k.planOutline({ x: 43, y: -143.4, w: 16, d: 2.8, r: 1.4 }, 8.4, P, 4), { tone: "mid" }) });
// bottom end: loudspeaker (the destination), taptic engine, USB board
const SPEAKER = { x: 12, y: SLED.y + SLED.d + 5, w: 52, d: 44, r: 5 };
slab("frame.speaker", SPEAKER, Z.tray, 9, { tone: "mid" }, { steps: 5, bevel: 0.6, inner: Ln(k.sideSeam(SPEAKER, Z.tray + 4, P, 5), { tone: "faint" }) });
const SPK_C = [SPEAKER.x + SPEAKER.w / 2, SPEAKER.y + SPEAKER.d / 2 - 2];
cyl("frame.speaker.surround", SPK_C[0], SPK_C[1], 14, Z.tray + 9, 1, { tone: "lo" }, { steps: 48 });
cyl("frame.speaker.cone", SPK_C[0], SPK_C[1], 11.6, Z.tray + 10, 0.8, { tone: "hi" }, { steps: 48, attrs: ` data-part="cone"`, extra: Ln(k.ring(SPK_C[0], SPK_C[1], 8, Z.tray + 10.8, P, 40) + k.ring(SPK_C[0], SPK_C[1], 4.4, Z.tray + 10.8, P, 32), { tone: "faint" }) });
const TAPTIC = { x: -62, y: SLED.y + SLED.d + 8, w: 54, d: 20, r: 4 };
slab("frame.taptic", TAPTIC, Z.tray, 7, { tone: "mid" }, { steps: 5, bevel: 0.5, inner: Ln(k.sideSeam(TAPTIC, Z.tray + 3.5, P, 5), { tone: "faint" }) });
box("frame.usb.board", [-22, END_Y - 22, Z.tray], [10, END_Y - BAND_T - 2.4, 6.2], { tone: "lo" }, { r: 1, extra: screws([[-17, END_Y - 18], [5, END_Y - 18]], 6.2) });
// a printed label plate on the tray, visible once the engine is out
{
  const L = { x: -40, y: 10, w: 34, d: 14, r: 1.2 };
  put("frame.label", [L.x + 17, L.y + 7, Z.tray + 0.4], S(k.slabOf(L, Z.tray, 0.5, P, 3), { tone: "lo", crease: "none" }) + Ln(k.planOutline(k.insetPlan(L, 1.4), Z.tray + 0.5, P, 3), { tone: "faint" }) + Ln([22, 15, 18].map((w, i) => k.lineOnTop([L.x + 4, L.y + 3.6 + i * 3.2], [L.x + 4 + w, L.y + 3.6 + i * 3.2], Z.tray + 0.5, P)).join(""), { tone: "lo", free: true }), [record(A.slab(L, Z.tray, 0.5, { name: "frame.label" }, 3))], { bias: 0.05 });
}

// ---- 5. ENGINE: the reactor sled that lifts out ------------------------------------
PIECE = "engine";
MATERIAL = "rn-graphite";
slab("engine.sled", SLED, Z.sled0, Z.sled1 - Z.sled0, { tone: "mid" }, {
  steps: 6,
  bevel: 0.6,
  inner: Ln(k.sideSeam(SLED, Z.sled0 + 1, P, 6), { tone: "faint" }),
  extra: Ln(k.planOutline(k.insetPlan(SLED, 4), Z.sled1, P, 6), { tone: "faint" }) + screws(STANDOFFS, Z.sled1, { ring: 1.6 }),
});
const ZS = Z.sled1;
// side rails: heat spreaders along both long edges of the sled
for (const x0 of [SLED.x + 3, SLED.x + SLED.w - 7]) {
  const rail = { x: x0, y: SLED.y + 16, w: 4, d: SLED.d - 32, r: 0.8 };
  slab("engine.rail", rail, ZS, 3.2, { tone: "mid" }, { steps: 3, bevel: 0.3, extra: Ln(Array.from({ length: 12 }, (_, i) => k.lineOnTop([x0, rail.y + 8 + i * 12], [x0 + 4, rail.y + 8 + i * 12], ZS + 3.2, P)).join(""), { tone: "faint" }) });
}

// ---- the core: a finned render turbine at the centre --------------------------------
const CORE = [0, -4];
const CORE_R = 30;
const TOPZ = ZS + 6.6;
cyl("core.flange", CORE[0], CORE[1], CORE_R + 8, ZS, 1.4, { tone: "lo" }, { steps: 80, extra: Dots(G.dotsOf(UP(CORE[0], CORE[1], 0), ZS + 1.4, CORE_R + 5.6, 24, P, { all: true }), { size: 0.45, tone: "mid" }) });
{
  const F = UP(CORE[0], CORE[1], 0);
  const fins = k.fadedSvg(G.ribsOf(F, ZS + 1.4, TOPZ - 1.2, CORE_R, 56, P, { fade: [0.1, 0.55], seams: true }), { tone: "lo" });
  turned("core.housing", F, [[ZS + 1.4, CORE_R], [TOPZ - 0.8, CORE_R], [TOPZ, CORE_R - 0.8]], { tone: "hi" }, { extra: fins });
}
{
  const ticks = k.radialTicks(CORE[0], CORE[1], CORE_R - 1.4, 72, 9, TOPZ, [0.9, 2.2], P);
  const art = Ln(k.ring(CORE[0], CORE[1], CORE_R - 1.4, TOPZ, P, 96) + k.ring(CORE[0], CORE[1], 22, TOPZ, P, 80) + k.ring(CORE[0], CORE[1], 20.6, TOPZ, P, 80), { tone: "lo" }) + Ln(ticks.minor, { tone: "lo" }) + Ln(ticks.major, { tone: "mid" }) + `<g data-part="vanes">${vanesOf(0)}</g>`;
  put("core.face", [CORE[0], CORE[1], TOPZ + 0.01], art, [record(A.cylinder(CORE[0], CORE[1], CORE_R - 0.8, TOPZ, 0.02, { name: "core.face" }))], { bias: 0.05 });
}
function vanesOf(phase) {
  const F = UP(CORE[0], CORE[1], 0);
  return Ln(G.spokesOf(F, TOPZ, 5.4, 20.6, 20, P, { phase, sweep: 0.62 }), { tone: "mid" });
}
for (let i = 0; i < 3; i++) {
  const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const nx = -dy * 1.5;
  const ny = dx * 1.5;
  const r0 = 5.8;
  const r1 = CORE_R - 1.6;
  const ring = [[CORE[0] + dx * r0 + nx, CORE[1] + dy * r0 + ny], [CORE[0] + dx * r1 + nx, CORE[1] + dy * r1 + ny], [CORE[0] + dx * r1 - nx, CORE[1] + dy * r1 - ny], [CORE[0] + dx * r0 - nx, CORE[1] + dy * r0 - ny]];
  prism("core.spider", ring, TOPZ, 1.2, { tone: "mid" }, { extra: Dots([at([CORE[0] + dx * (r1 - 2.2), CORE[1] + dy * (r1 - 2.2), TOPZ + 1.2])], { size: 0.45 }) });
}
cyl("core.bearing", CORE[0], CORE[1], 5.8, TOPZ, 1.2, { tone: "mid" }, { steps: 36, bevel: 0.3 });
const PULLEY = { r: 4.6, z0: TOPZ + 1.2, z1: TOPZ + 4, grooves: [TOPZ + 2.0, TOPZ + 3.4] };
cyl("core.pulley", CORE[0], CORE[1], PULLEY.r, PULLEY.z0, PULLEY.z1 - PULLEY.z0, { tone: "mid" }, { steps: 32, extra: Ln(PULLEY.grooves.map((z) => k.sideArc(CORE[0], CORE[1], PULLEY.r, z, P, 20)).join(""), { tone: "lo" }) });
{
  const F = UP(CORE[0], CORE[1], PULLEY.z1);
  const H = 1.5;
  const RD = 3.6;
  const domeR = (s) => RD * Math.sqrt(Math.max(0, 1 - (s / H) ** 2));
  const domeSlope = (s) => (-RD * s) / (H * H * Math.max(0.04, Math.sqrt(Math.max(1e-4, 1 - (s / H) ** 2))));
  const prof = Array.from({ length: 14 }, (_, i) => [(H * i) / 13, domeR((H * i) / 13), 1]);
  prof[prof.length - 1][1] = 0;
  turned("core.hub", F, prof, { tone: "hi", lit: true }, { smooth: { slope: domeSlope, radius: domeR }, attrs: ` data-part="hub"` });
}

// ---- pods: nodes on round pedestals -------------------------------------------------
const PODS = [
  { id: "osc", x: -40, y: -70, r: 12 },
  { id: "ring", x: 40, y: -70, r: 12 },
  { id: "filter", x: -48, y: -4, r: 8 },
  { id: "gauge", x: 48, y: -4, r: 8 },
  { id: "buf", x: -40, y: 62, r: 12 },
  { id: "gain", x: 40, y: 62, r: 12 },
];
const POD_Z1 = ZS + 3.4;
for (const pod of PODS) {
  const n = pod.r > 10 ? 4 : 3;
  cyl(`pod.${pod.id}.base`, pod.x, pod.y, pod.r, ZS, POD_Z1 - ZS, { tone: "mid" }, { steps: 44, bevel: 0.4, inner: Ln(k.sideArc(pod.x, pod.y, pod.r, ZS + 1.4, P, 24), { tone: "faint" }), extra: screws(Array.from({ length: n }, (_, i) => [pod.x + Math.sin((i * Math.PI * 2) / n + 0.6) * (pod.r - 2.2), pod.y - Math.cos((i * Math.PI * 2) / n + 0.6) * (pod.r - 2.2)]), POD_Z1, { ring: 0.9, size: 0.4 }) });
}
const podOf = (id) => PODS.find((p) => p.id === id);
// oscillator: a flywheel that is also the belt's driven pulley
const OSC_WHEEL = { r: 8.4, z0: PULLEY.grooves[0] - 1.6, z1: PULLEY.grooves[0] + 1.6 };
{
  const p = podOf("osc");
  cyl("pod.osc.post", p.x, p.y, 2.4, POD_Z1, OSC_WHEEL.z0 - POD_Z1, { tone: "lo" }, { steps: 16 });
  cyl("pod.osc.wheel", p.x, p.y, OSC_WHEEL.r, OSC_WHEEL.z0, OSC_WHEEL.z1 - OSC_WHEEL.z0, { tone: "hi" }, { steps: 48, bevel: 0.3, extra: Ln(k.sideArc(p.x, p.y, OSC_WHEEL.r, PULLEY.grooves[0], P, 30), { tone: "lo" }) + `<g data-part="osc-wheel">${wheelOf(p, OSC_WHEEL.z1, OSC_WHEEL.r, 0)}</g>` });
}
function wheelOf(p, z, r, phase) {
  const spokes = Ln([0, 1, 2, 3, 4].map((i) => {
    const a = phase + (i * Math.PI * 2) / 5;
    return k.lineOnTop([p.x + Math.sin(a) * 2, p.y - Math.cos(a) * 2], [p.x + Math.sin(a) * (r - 1.8), p.y - Math.cos(a) * (r - 1.8)], z, P);
  }).join("") + k.ring(p.x, p.y, r - 1.8, z, P, 40) + k.ring(p.x, p.y, 2, z, P, 16), { tone: "lo" });
  const pin = at([p.x + Math.sin(phase) * (r - 3.6), p.y - Math.cos(phase) * (r - 3.6), z]);
  return spokes + Dots([pin], { size: 1.3, tone: "hi" });
}
// command ring (SPSC): eight pockets on an indexing table
const RING_TOP = POD_Z1 + 2.4;
{
  const p = podOf("ring");
  cyl("pod.ring.table", p.x, p.y, 9.6, POD_Z1, 2.4, { tone: "mid" }, { steps: 48, bevel: 0.3, extra: Ln(k.radialTicks(p.x, p.y, 9.6, 8, 1, RING_TOP, [1.2, 1.2], P).major, { tone: "faint" }) + `<g data-part="ring-table">${ringTableOf(p, 0)}</g><g data-part="ring-caps"></g>` });
  cyl("pod.ring.hub", p.x, p.y, 2.4, RING_TOP, 3, { tone: "lo" }, { steps: 18 });
  box("pod.ring.pawl", [p.x - 1.2, p.y + 9.6, POD_Z1], [p.x + 1.2, p.y + 12.2, RING_TOP + 1.2], { tone: "mid" }, { r: 0.4 });
}
function ringTableOf(p, phase) {
  return Ln(Array.from({ length: 8 }, (_, i) => {
    const a = phase + ((i + 0.5) * Math.PI * 2) / 8;
    return k.ring(p.x + Math.sin(a) * 6.2, p.y - Math.cos(a) * 6.2, 1.6, RING_TOP, P, 12);
  }).join(""), { tone: "lo" });
}
// filter: two wound coils
{
  const p = podOf("filter");
  for (const [i, dy] of [-3, 3].entries()) {
    const cx = p.x - 0.6;
    const cy = p.y + dy;
    cyl(`pod.filter.coil${i}`, cx, cy, 2.6, POD_Z1, 6, { tone: "hi" }, { steps: 24, extra: Ln([1.2, 2.4, 3.6, 4.8].map((h) => k.sideArc(cx, cy, 2.6, POD_Z1 + h, P, 16)).join(""), { tone: "faint" }) });
    cyl(`pod.filter.cap${i}`, cx, cy, 2.9, POD_Z1 + 6, 0.7, { tone: "mid" }, { steps: 24 });
  }
}
// analyser: a dial gauge whose needle follows the output level
const GAUGE_TOP = POD_Z1 + 4.2;
{
  const p = podOf("gauge");
  cyl("pod.gauge.case", p.x, p.y, 7.4, POD_Z1, 4.2, { tone: "hi" }, { steps: 48, bevel: 0.4, extra: Ln(k.knurl(p.x, p.y, 7.4, POD_Z1 + 1.4, GAUGE_TOP - 0.3, 44, P, 0.3), { tone: "lo" }) });
  const t = k.radialTicks(p.x, p.y, 5.8, 24, 4, GAUGE_TOP, [0.7, 1.5], P, -Math.PI * 0.7, Math.PI * 1.4);
  const arc = Array.from({ length: 33 }, (_, i) => {
    const a = -Math.PI * 0.7 + (Math.PI * 1.4 * i) / 32;
    return [p.x + Math.sin(a) * 5.8, p.y - Math.cos(a) * 5.8];
  });
  put("pod.gauge.face", [p.x, p.y, GAUGE_TOP + 0.01], Ln(k.onTop(arc, GAUGE_TOP, P), { tone: "lo" }) + Ln(t.minor, { tone: "lo" }) + Ln(t.major, { tone: "mid" }) + `<path class="iso-line" data-tone="lit" data-free="" data-part="needle" style="stroke-width:1.1" d="${needleOf(p, GAUGE_TOP, 0)}"/>` + Dots([at([p.x, p.y, GAUGE_TOP])], { size: 0.9, tone: "hi" }), [record(A.cylinder(p.x, p.y, 6, GAUGE_TOP, 0.02, { name: "pod.gauge.face" }))], { bias: 0.1 });
}
function needleOf(p, z, level) {
  const a = -Math.PI * 0.7 + Math.PI * 1.4 * Math.max(0, Math.min(1, level));
  return k.lineOnTop([p.x - Math.sin(a) * 1.2, p.y + Math.cos(a) * 1.2], [p.x + Math.sin(a) * 5, p.y - Math.cos(a) * 5], z, P);
}
// buffer source: a pulley driving two tape reels
const BUF_PULLEY = { r: 5, z0: PULLEY.grooves[1] - 1.3, z1: PULLEY.grooves[1] + 1.3 };
{
  const p = podOf("buf");
  for (const [i, dx] of [-6.2, 6.2].entries()) {
    const c = [p.x + dx, p.y + 2.6];
    cyl(`pod.buf.reel${i}`, c[0], c[1], 4.4, POD_Z1, 1.6, { tone: "hi" }, { steps: 28, extra: `<g data-part="reel${i}">${reelOf(c, POD_Z1 + 1.6, 4.4, 0)}</g>` });
  }
  const c = [p.x, p.y - 5.4];
  cyl("pod.buf.post", c[0], c[1], 1.8, POD_Z1, BUF_PULLEY.z0 - POD_Z1, { tone: "lo" }, { steps: 16 });
  cyl("pod.buf.pulley", c[0], c[1], BUF_PULLEY.r, BUF_PULLEY.z0, BUF_PULLEY.z1 - BUF_PULLEY.z0, { tone: "mid" }, { steps: 32, extra: Ln(k.sideArc(c[0], c[1], BUF_PULLEY.r, PULLEY.grooves[1], P, 20), { tone: "lo" }) + `<g data-part="buf-pulley">${wheelOf({ x: c[0], y: c[1] }, BUF_PULLEY.z1, BUF_PULLEY.r, 0)}</g>` });
  podOf("buf").pulley = c;
}
function reelOf([x, y], z, r, phase) {
  return Ln([0, 1, 2].map((i) => {
    const a = phase + (i * Math.PI * 2) / 3;
    return k.lineOnTop([x + Math.sin(a) * 1.2, y - Math.cos(a) * 1.2], [x + Math.sin(a) * (r - 0.7), y - Math.cos(a) * (r - 0.7)], z, P);
  }).join("") + k.ring(x, y, 1.2, z, P, 12), { tone: "lo" });
}
// gain: a knurled knob, turned by a solenoid when a command arrives
let GAIN_TOP;
{
  const p = podOf("gain");
  cyl("pod.gain.skirt", p.x, p.y, 7.4, POD_Z1, 1, { tone: "lo" }, { steps: 36, extra: Ln(k.radialTicks(p.x, p.y, 7.4, 12, 3, POD_Z1 + 1, [0.8, 1.4], P, -Math.PI * 0.75, Math.PI * 1.5).major, { tone: "mid" }) });
  GAIN_TOP = POD_Z1 + 6;
  cyl("pod.gain.knob", p.x, p.y, 5.6, POD_Z1 + 1, 5, { tone: "hi" }, { steps: 36, bevel: 0.4, extra: Ln(k.knurl(p.x, p.y, 5.6, POD_Z1 + 1, GAIN_TOP - 0.6, 40, P), { tone: "lo" }) + `<path class="iso-line" data-tone="hi" data-free="end" data-part="gain-pointer" style="stroke-width:1" d="${gainPointerOf(p, 1)}"/>` });
}
function gainPointerOf(p, value) {
  const a = -Math.PI * 0.75 + Math.PI * 1.5 * value;
  return k.lineOnTop([p.x, p.y], [p.x + Math.sin(a) * 4.8, p.y - Math.cos(a) * 4.8], GAIN_TOP, P);
}

// ---- conduits from the corner pods to the core, couplings to the side pods ---------
const PORT_Z = ZS + 3.4;
for (const pod of PODS) {
  const dx = pod.x - CORE[0];
  const dy = pod.y - CORE[1];
  const len = Math.hypot(dx, dy);
  const dir = [dx / len, dy / len, 0];
  if (pod.r > 10) {
    const corePort = boss(`core.port.${pod.id}`, [CORE[0] + dir[0] * CORE_R, CORE[1] + dir[1] * CORE_R, PORT_Z], dir, 1.9, 2.2);
    const podPort = boss(`pod.${pod.id}.port`, [pod.x - dir[0] * pod.r, pod.y - dir[1] * pod.r, ZS + 1.8], G.mul3(dir, -1), 1.8, 2);
    pod.conduit = `conduit.${pod.id}`;
    cable(pod.conduit, [corePort, [corePort[0] + dir[0] * 4, corePort[1] + dir[1] * 4, PORT_Z], [podPort[0] - dir[0] * 4, podPort[1] - dir[1] * 4, ZS + 1.8], podPort], 1.1, { tone: "mid", maxLength: 10, bend: 6 });
  } else {
    // side pods couple straight to the housing with a short ribbed sleeve
    const F = G.frameAlong([CORE[0] + dir[0] * CORE_R, CORE[1] + dir[1] * CORE_R, PORT_Z], dir);
    const gap = len - CORE_R - pod.r;
    turned(`pod.${pod.id}.coupling`, F, [[-0.2, 1.9], [gap + 0.2, 1.9]], { tone: "mid" }, { extra: k.fadedSvg(G.ribsOf(F, 0.6, gap - 0.6, 1.9, 10, P, { fade: [0.1, 0.55], seams: true }), { tone: "lo" }) });
  }
}

// ---- timing belts: the core's double pulley drives the oscillator wheel and the buffer pulley ----
const BELT_R = 0.5;
function beltLoop(c1, r1, c2, r2, z, steps = 18) {
  const d = Math.hypot(c2[0] - c1[0], c2[1] - c1[1]);
  const th = Math.atan2(c2[1] - c1[1], c2[0] - c1[0]);
  const b = Math.acos((r1 - r2) / d);
  const arc = (c, r, a0, a1) => Array.from({ length: steps + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / steps;
    return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, z];
  });
  const big = arc(c1, r1, th + b, th + 2 * Math.PI - b);
  const small = arc(c2, r2, th - b, th + b);
  return [...big, ...small];
}
const BELTS = [];
function belt(name, c2, r2, z, touch) {
  const pts = beltLoop(CORE, PULLEY.r + BELT_R, c2, r2 + BELT_R, z, 36);
  R.route(name, pts, BELT_R, { closed: true, touch, piece: PIECE, move: PIECES[PIECE].move, ride: PIECE, limp: true });
  // break the loop where it crosses each pulley's silhouette, so near and far runs sort apart
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const side = [-V[1], V[0]];
  const breaks = [];
  for (const [c, r] of [[CORE, PULLEY.r + BELT_R], [c2, r2 + BELT_R]]) {
    for (const sgn of [-1, 1]) {
      const q = [c[0] + side[0] * r * sgn, c[1] + side[1] * r * sgn];
      let best = 0;
      pts.forEach((p, i) => { if (Math.hypot(p[0] - q[0], p[1] - q[1]) < Math.hypot(pts[best][0] - q[0], pts[best][1] - q[1])) best = i; });
      if (Math.hypot(pts[best][0] - q[0], pts[best][1] - q[1]) < 1) breaks.push(cum[best]);
    }
  }
  tubePieces(pts, BELT_R, P, { closed: true, maxLength: 4, spacing: 0.6, breaks }).forEach((piece, index) =>
    put(`${name}:${index}`, piece.mid, tubeSvg(piece, { tone: "lo" }), [A.tube(piece.points, piece.radii, { touch })], { bias: 0.05, attrs: ` data-route="${name}"` }),
  );
  BELTS.push({ name, pts });
}
belt("belt.osc", [podOf("osc").x, podOf("osc").y], OSC_WHEEL.r, PULLEY.grooves[0], ["core.pulley", "pod.osc.wheel"]);
belt("belt.buf", podOf("buf").pulley, BUF_PULLEY.r, PULLEY.grooves[1], ["core.pulley", "pod.buf.pulley"]);

// ---- connectors: the display line comes in at the top, the speaker line leaves at the bottom ----
const TOPCON = { x0: -6, x1: 14, y0: SLED.y + 1, y1: SLED.y + 8, z1: ZS + 4.4 };
box("engine.topcon", [TOPCON.x0, TOPCON.y0, ZS], [TOPCON.x1, TOPCON.y1, TOPCON.z1], { tone: "mid" }, { r: 0.8, bevel: 0.3, extra: Dots(Array.from({ length: 6 }, (_, i) => at([TOPCON.x0 + 3 + i * 2.8, TOPCON.y0 + 3.5, TOPCON.z1])), { size: 0.4, tone: "lo" }) });
// the event latch: a semaphore arm on the connector, raised when an event leaves for JS
const LATCH = [TOPCON.x0 + 3, TOPCON.y0 + 3.5];
cyl("engine.latch.post", LATCH[0], LATCH[1], 0.9, TOPCON.z1, 4.6, { tone: "mid" }, { steps: 12 });
const LATCH_TOP = TOPCON.z1 + 4.6;
put("engine.latch.arm", [LATCH[0], LATCH[1], LATCH_TOP], `<g data-part="latch">${latchOf(0)}</g>`, [record(A.tube([[LATCH[0], LATCH[1], LATCH_TOP], [LATCH[0] + 5, LATCH[1], LATCH_TOP]], 0.6, { name: "engine.latch.arm" }))], { bias: 0.3 });
function latchOf(t) {
  const a = (t * Math.PI) / 2.6;
  const tip = [LATCH[0] + Math.cos(a) * 5, LATCH[1], LATCH_TOP + Math.sin(a) * 5];
  const p0 = at([LATCH[0], LATCH[1], LATCH_TOP]);
  const p1 = at(tip);
  return `<path class="iso-line rn-js" data-free="end" style="stroke-width:1.6" d="M${f2(p0[0])} ${f2(p0[1])}L${f2(p1[0])} ${f2(p1[1])}"/><circle class="rn-js-dot" cx="${f2(p1[0])}" cy="${f2(p1[1])}" r="${f2(0.9 * KS)}"/>`;
}
const BOTCON = { x0: 32, x1: 48, y0: SLED.y + SLED.d - 9, y1: SLED.y + SLED.d - 1, z1: ZS + 4 };
box("engine.botcon", [BOTCON.x0, BOTCON.y0, ZS], [BOTCON.x1, BOTCON.y1, BOTCON.z1], { tone: "mid" }, { r: 0.8, bevel: 0.3, extra: Dots(Array.from({ length: 4 }, (_, i) => at([BOTCON.x0 + 3 + i * 3.3, BOTCON.y0 + 4, BOTCON.z1])), { size: 0.4, tone: "lo" }) });
// heatsink between the lower pods
{
  const HS = { x: -18, y: 52, w: 36, d: 26, r: 1.4 };
  slab("engine.heatsink", HS, ZS, 4.6, { tone: "mid" }, { steps: 3, bevel: 0.4, extra: Ln(Array.from({ length: 7 }, (_, i) => k.planOutline({ x: HS.x + 3 + i * 4.6, y: HS.y + 3, w: 1.6, d: HS.d - 6, r: 0.8 }, ZS + 4.6, P, 2)).join(""), { tone: "lo" }) });
}
// harness from the top connector to the command ring; event line from the core to the connector;
// output line from the gain pod to the bottom connector
{
  const ring = podOf("ring");
  const portBase = [ring.x, ring.y - ring.r, ZS + 1.8];
  const ringPort = boss("pod.ring.port.in", portBase, [0, -1, 0], 1.6, 2);
  const start = boss("engine.topcon.out", [TOPCON.x1, (TOPCON.y0 + TOPCON.y1) / 2, ZS + 1.8], [1, 0, 0], 1.4, 1.6);
  cable("harness.cmd", [start, [ring.x, start[1], start[2]], ringPort], 0.9, { tone: "mid", bend: 5, rings: { pitch: 1.1, twist: 0.8, cross: true, fade: [0.1, 0.55] } });
}
{
  const dir = G.unit3([TOPCON.x0 + 8 - CORE[0], TOPCON.y1 - CORE[1], 0]);
  const corePort = boss("core.port.event", [CORE[0] + dir[0] * CORE_R, CORE[1] + dir[1] * CORE_R, PORT_Z], dir, 1.3, 2);
  const conPort = boss("engine.topcon.in", [TOPCON.x0 + 8, TOPCON.y1, ZS + 2.2], [0, 1, 0], 1.2, 1.6);
  cable("line.event", [corePort, [corePort[0] + dir[0] * 4, corePort[1] + dir[1] * 4, PORT_Z], [conPort[0], conPort[1] + 8, conPort[2]], conPort], 0.7, { tone: "lo", bend: 4 });
}
{
  const gain = podOf("gain");
  const out = boss("pod.gain.port.out", [gain.x, gain.y + gain.r, ZS + 1.8], [0, 1, 0], 1.6, 2);
  cable("line.out", [out, [gain.x, BOTCON.y0, ZS + 1.8]], 1, { tone: "mid", maxLength: 12 });
}


// ---- detail on the sled: capacitors, chips, a solenoid by the gain pod -------------------
for (const side of [-1, 1]) {
  for (const y of [-48, -38, -28, 18, 28, 38]) {
    const x = side * 53;
    cyl("engine.cap", x, y, 2.2, ZS, 4.6, { tone: "hi" }, { steps: 20, bevel: 0.3, extra: Ln(k.lineOnTop([x - 1.2, y], [x + 1.2, y], ZS + 4.6, P) + k.lineOnTop([x, y - 1.2], [x, y + 1.2], ZS + 4.6, P), { tone: "lo" }) });
  }
}
function chip(name, x0, y0, w, d) {
  const pins = [];
  for (let x = x0 + 1.2; x < x0 + w - 0.6; x += 1.6) pins.push(at([x, y0 - 0.2, ZS]), at([x, y0 + d + 0.2, ZS]));
  box(name, [x0, y0, ZS], [x0 + w, y0 + d, ZS + 1.4], { tone: "lo" }, { r: 0.3, steps: 1, extra: Dots(pins, { size: 0.28, tone: "mid" }) + Dots([at([x0 + 1.4, y0 + 1.4, ZS + 1.4])], { size: 0.35, tone: "mid" }) });
}
chip("engine.chip", -34, -97, 14, 7);
chip("engine.chip", 4, 83, 18, 8);
chip("engine.chip", -26, 82, 8, 6);
const SOL = [22, 58];
cyl("engine.solenoid.base", SOL[0], SOL[1], 3.2, ZS, 1.2, { tone: "lo" }, { steps: 24 });
cyl("engine.solenoid.coil", SOL[0], SOL[1], 2.6, ZS + 1.2, 5.2, { tone: "hi" }, { steps: 24, extra: Ln([1.2, 2.2, 3.2, 4.2].map((h) => k.sideArc(SOL[0], SOL[1], 2.6, ZS + 1.2 + h, P, 16)).join(""), { tone: "faint" }) });
const SOL_TOP = ZS + 6.4;
put("engine.solenoid.plunger", [SOL[0], SOL[1], SOL_TOP + 1.6], `<g data-part="plunger">${S(k.cylinder(SOL[0], SOL[1], 0.9, SOL_TOP, 3, P, 14), { tone: "hi", lit: false })}${S(k.cylinder(SOL[0], SOL[1], 1.6, SOL_TOP + 3, 0.8, P, 16), { tone: "mid" })}</g>`, [record(A.cylinder(SOL[0], SOL[1], 1.6, SOL_TOP, 3.8, { name: "engine.solenoid.plunger" }))], { bias: 0.2 });

// ---- foundation details: the vapour chamber and the display flex under the sled ----------
PIECE = "frame";
MATERIAL = "rn-inside";
{
  const VC = { x: -46, y: -78, w: 92, d: 150, r: 6 };
  put("frame.vapour", [0, -3, Z.tray + 0.3], S(k.slabOf(VC, Z.tray, 0.5, P, 6), { tone: "mid", crease: "none" }) + Ln(k.planOutline(k.insetPlan(VC, 3), Z.tray + 0.5, P, 6), { tone: "faint" }), [record(A.slab(VC, Z.tray, 0.5, { name: "frame.vapour" }, 6))], { bias: 0.02 });
  const FLEX = { x: 16, y: -122, w: 14, d: 22, r: 0.8 };
  put("frame.flex", [23, -111, Z.tray + 0.2], S(k.slabOf(FLEX, Z.tray, 0.3, P, 2), { tone: "lo", crease: "none" }) + Ln(Array.from({ length: 4 }, (_, i) => k.lineOnTop([FLEX.x + 3 + i * 2.6, FLEX.y], [FLEX.x + 3 + i * 2.6, FLEX.y + FLEX.d], Z.tray + 0.3, P)).join(""), { tone: "faint" }), [record(A.slab(FLEX, Z.tray, 0.3, { name: "frame.flex" }, 2))], { bias: 0.02 });
}

// ---- assemble ---------------------------------------------------------------------
A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);
const groups = R.items.map((item, index) => {
  const [mx, my, mz] = item.move;
  return `<g class="it${item.material ? ` ${item.material}` : ""}" data-name="${item.name}" data-piece="${item.piece}" data-k="${item.key.toFixed(2)}" data-m="${mx},${my},${mz}" data-i="${index}"${item.attrs ?? ""}>${item.svg}</g>`;
});
const svg = k.figureSvg({ width: W, height: H, label: "An exploded smartphone with an audio engine inside.", body: [...back, `<g class="rn-parts">${groups.join("")}</g>`, `<g data-part="tokens"></g>`] });
const unit = (v) => {
  const o = at([0, 0, 0]);
  const p = at(v);
  return [p[0] - o[0], p[1] - o[1]];
};
const routeScreen = (name) => ROUTES[name].map((p) => at(p).map(f2));
const DATA = {
  P,
  KS,
  V,
  EX: unit([1, 0, 0]),
  EY: unit([0, 1, 0]),
  EZ: unit([0, 0, 1]),
  stagger: STAGGER,
  spring: SPRING,
  moves: Object.fromEntries(Object.entries(PIECES).map(([id, p]) => [id, p.move])),
  core: { x: CORE[0], y: CORE[1], top: TOPZ, vanes: 20 },
  pulley: { r: PULLEY.r },
  osc: { x: podOf("osc").x, y: podOf("osc").y, z: OSC_WHEEL.z1, r: OSC_WHEEL.r },
  bufPulley: { x: podOf("buf").pulley[0], y: podOf("buf").pulley[1], z: BUF_PULLEY.z1, r: BUF_PULLEY.r },
  reels: [-6.2, 6.2].map((dx) => ({ x: podOf("buf").x + dx, y: podOf("buf").y + 2.6, z: POD_Z1 + 1.6, r: 4.4 })),
  ring: { x: podOf("ring").x, y: podOf("ring").y, z: RING_TOP },
  gauge: { x: podOf("gauge").x, y: podOf("gauge").y, z: GAUGE_TOP },
  gain: { x: podOf("gain").x, y: podOf("gain").y, z: GAIN_TOP },
  latch: { x: LATCH[0], y: LATCH[1], z: LATCH_TOP },
  routes: Object.fromEntries(["conduit.osc", "conduit.ring", "conduit.buf", "conduit.gain", "harness.cmd", "line.event", "line.out"].map((n) => [n, routeScreen(n)])),
};
const CSS = `
.rn-screen{fill:var(--rn-screen)}
.rn-logo ellipse{fill:none;stroke:var(--rn-react);stroke-width:4.2}
.rn-nucleus{fill:var(--rn-react)}
.rn-island{fill:#000}
.rn-home{fill:var(--rn-glass-line)}
.rn-glare{fill:#fff;opacity:.05}
.iso{--rn-screen:#0d0e11;--rn-react:#61dafb;--rn-glass-line:#3a3d44}
.it.rn-graphite{--anatomy-paper:#2a2c31;--anatomy-face:#34363c;--anatomy-top:#3b3e44;--anatomy-shade-0:#1e2024;--anatomy-shade-1:#24262a;--anatomy-shade-2:#2a2c31;--anatomy-shade-3:#303338;--anatomy-hi:#e6e8ec;--anatomy-mid:#8b8f97;--anatomy-lo:#5c6068;--anatomy-faint:#43464d;--anatomy-lit:#ffffff;--anatomy-lit-top:#50545c;--anatomy-lit-shade:#42454c;--anatomy-dot:#c8cbd1}
.it.rn-inside{--anatomy-paper:#d8dade;--anatomy-face:#e2e4e8;--anatomy-top:#e8e9ec;--anatomy-shade-0:#c3c6cb;--anatomy-shade-1:#cbced3;--anatomy-shade-2:#d2d4d9;--anatomy-shade-3:#d9dbdf;--anatomy-hi:#2a2c31;--anatomy-mid:#7c8088;--anatomy-lo:#a3a6ad;--anatomy-faint:#bdc0c6}
.iso[data-theme="dark"] .it.rn-inside{--anatomy-paper:#1c1d20;--anatomy-face:#232428;--anatomy-top:#26282c;--anatomy-shade-0:#141518;--anatomy-shade-1:#18191c;--anatomy-shade-2:#1c1d20;--anatomy-shade-3:#202124;--anatomy-hi:#c9ccd2;--anatomy-mid:#6a6d74;--anatomy-lo:#45484e;--anatomy-faint:#2f3135}
.rn-ripple{fill:none;stroke:var(--rn-react);stroke-width:1.6;opacity:0}
.rn-token{fill:#ffffff;stroke:#2a2c31;stroke-width:.6px}
.rn-token.rn-cmd{fill:var(--rn-react)}
.rn-capsule{fill:var(--rn-react);stroke:#2a2c31;stroke-width:.5px}
.iso-stage{position:relative;touch-action:pan-y}
.iso-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.rn-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.rn-js{stroke:var(--rn-react)}
.rn-js-dot{fill:var(--rn-react)}
`;
const latheSource = readFileSync(join(KIT, "kit", "lathe.mjs"), "utf8").replace(/^import .*$/m, "").replace(/^export /gm, "");
const latheScript = `const G = (() => {${latheSource}\nreturn { spokesOf, frameOf };})();\n`;
const LIVE = latheScript + readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA));
const body = `<style>${CSS}</style>` + k.plateHtml({ fig: "Fig 2", title: "Inside a React Native app", hint: "click or space · 1–3 send calls", readout: "closed", keys: [], caption: "", body: `<div class="iso-stage" tabindex="0" role="group" aria-label="Exploded phone with an audio engine inside. Space or click opens and closes it. Key 1 sends a gain change, 2 toggles the buffer source, 3 sends an ended event back to JavaScript.">${svg}<span class="rn-sr" role="status" aria-live="polite" data-status></span></div>` });
const page = k.pageHtml({ title: "Audio reactor", theme: THEME, body, script: kitScript() + LIVE, width: 820 });
const name = THEME === "light" ? "phone-light.html" : "phone.html";
writeFileSync(join(HERE, name), page);
console.log("wrote", name, `${(page.length / 1024).toFixed(0)} KB`, `${R.items.length} items`);
A.auditOrExit(R, P, {});
