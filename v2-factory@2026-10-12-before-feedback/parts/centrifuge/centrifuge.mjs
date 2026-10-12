// Centrifuge: the lock-free ring that holds events until the audio thread drains them at the next render quantum.
// An open-top basket centrifuge on a four-legged stand, driven from above. Packets drop from the intake funnel into
// the pockets of the rotor one at a time; once enough are held the rotor spins up until one pocket passes the
// release gate per audio-belt slat, and each slat pulse lets the packet in the gate pocket fall onto the belt.
const DEG = Math.PI / 180;

export const POCKETS = 10;
const Z = {
  flange: [100, 103],
  bowl: [103, 120],
  top: [120, 122.5],
  carousel: [122.5, 125],
  pocket: 125,
  vane: 5,
  rimTop: 129.6,
  knuckle: 109,
  packet: 7,
  envTop: 132.2,
  hub: 137,
  strobe: 139,
  spider: [159.6, 164.4],
  ring: 162,
  arm: [160.8, 163.2],
  plate: [163.8, 165.6],
  bearing: [164.4, 176.2],
  pulley: [178, 182],
  belt: 180,
  funnelFoot: 165.8,
  mouth: 186,
};
const R_ = {
  flange: 37,
  bowl: 34,
  top: 36,
  carousel: 29,
  hubCollar: 12,
  hubColumn: 7.5,
  strobe: 10.5,
  vaneIn: 12,
  vaneOut: 28.8,
  pocket: 23,
  rimIn: 29.6,
  rimOut: 31.4,
  envIn: 12.3,
  envOut: 29.3,
  post: 1.4,
  postAt: 33.5,
  ring: 1.8,
  shaft: 2.2,
};
const SPOUT_DEG = -90;
// the release gate faces the viewer's left; a spout carries the packet out over the bowl's rim and lets it fall
const GATE_DEG = 95;
const GATE_HALF = 9;
const SPOUT_SLOPE = 15 * DEG;
const SPOUT_LEN = 15;
const SPOUT_V = [42, 18];
const GRAVITY = 400;
const MOTOR = [46, 0];
const FUNNEL = [0, -R_.pocket];
const LEG = 24.5;
const TACH_DEG = 50;
const LAMP_DEG = 74;
const CRANK_DEG = 118;
const DRAIN_DEG = 20;
const COOL_DEGS = [-24, 4];

// Extra styles for this machine (strobe sectors, funnel interior, sync-lamp glow). The assembly appends it to its css.
export const CSS = `
.iso{--cf-void-0:#c9ccd1;--cf-void-1:#7d8188;--cf-void-2:#4a4d53;--cf-strobe:#7d8188;--cf-glow:#38c27a;--cf-glow-soft:#9fe8bd}
.iso[data-theme="dark"]{--cf-void-0:#3a3d43;--cf-void-1:#1a1c20;--cf-void-2:#0b0c0e;--cf-strobe:#8b8f97;--cf-glow:#7dffb4;--cf-glow-soft:#2f8a5a}
.cf-void-0{stop-color:var(--cf-void-0)}.cf-void-1{stop-color:var(--cf-void-1)}.cf-void-2{stop-color:var(--cf-void-2)}
.cf-strobe{fill:var(--cf-strobe);stroke:none}
.cf-glow{fill:var(--cf-glow);stroke:none;mix-blend-mode:multiply}
.iso[data-theme="dark"] .cf-glow{mix-blend-mode:screen}
.cf-glow-soft{fill:var(--cf-glow-soft);stroke:none}
`;

export function build(ctx, origin = [100, 66, 0], opts = {}) {
  const id = opts.id ?? "centrifuge";
  // `stand: false`: no stand, cooler shelf or coolant loop; the machine hangs from its base flange (grounded)
  const stand = opts.stand ?? true;
  const { k, G, T, A, P, V, KS, R, at, S, Ln, Dots } = ctx;
  const [ox, oy, oz] = origin;
  const L = (x, y, z) => [ox + x, oy + y, oz + z];
  const polar = (deg, r, z) => L(r * Math.cos(deg * DEG), r * Math.sin(deg * DEG), z);
  const dir = (deg) => [Math.cos(deg * DEG), Math.sin(deg * DEG), 0];
  const N = (s) => `${id}.${s}`;
  const AXIS = G.frameOf(L(0, 0, 0), [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  const axisAt = (x, y) => G.frameOf(L(x, y, 0), [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  const toward = k.towardViewer(P);
  const FADE = [0.04, 0.42];
  const saved = ctx.material;

  // ---------- local helpers (kept here, not in shared/) ----------
  function turned(name, F, profile, style = {}, { extra = "", inner = "", bias = 0, smooth, steps, bevel = 0, owner, attrs, material } = {}) {
    const paths = G.solidOf(profile, F, P, { bevel, ...(smooth !== undefined ? { smooth } : {}), ...(steps ? { steps } : {}) });
    const mid = (profile[0][0] + profile[profile.length - 1][0]) / 2;
    const shape = ctx.record(A.solid(F, profile, { name, owner, radius: smooth && smooth.radius ? smooth.radius : null }));
    ctx.put(name, G.add3(F.o, G.mul3(F.a, mid)), S(paths, { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs, ...(material !== undefined ? { material } : {}) });
    return shape;
  }
  function flangeAt(name, centre, axis, r, thick, { bolts = 6, boltR, tone = "mid", owner, bias = 0 } = {}) {
    const F = G.frameAlong(centre, axis);
    const towardS = G.dot3(F.a, V) > 0 ? thick / 2 : -thick / 2;
    const face = bolts && Math.abs(G.dot3(F.a, V)) > 0.12 ? Dots(G.dotsOf(F, towardS, boltR ?? r * 0.72, bolts, P, { all: true }), { size: 0.36, tone: "mid" }) : "";
    const shape = ctx.record(A.disc(F, -thick / 2, thick / 2, r, { name, owner }));
    ctx.put(name, centre, S(G.disc(-thick / 2, thick / 2, r, F, P, { bevel: 0.2 }), { tone }) + face, [shape], { bias });
    return shape;
  }
  // a pipe between two real ports, a flange on each end (its back face on the port), chunked for depth
  function pipe(name, control, r, { bend = 2.6, flangeR = 1.6, tone = "mid", touch, maxLength = 10 } = {}) {
    const line = G.fillet(control, Math.max(r * bend, 3), 12, { P, tube: r });
    const total = G.pathLength(line);
    const thick = Math.max(0.9, r * 0.6);
    const gaps = [[0, thick], [total - thick, total]];
    R.route(name, line, r, { gaps, rims: [r * flangeR, r * flangeR], touch, owner: name });
    ctx.routes[name] = line;
    T.tubePieces(line, r, P, { maxLength, spacing: Math.max(0.6, Math.min(1.6, r)), gaps }).forEach((piece) =>
      ctx.put(`${name}:chunk`, piece.mid, T.tubeSvg(piece, { tone }), [A.tube(piece.points, piece.radii, { touch })], { attrs: ` data-route="${name}"` }),
    );
    [[0, 1], [total, -1]].forEach(([along, sign]) => {
      const tangent = G.tangentAlong(line, along);
      const centre = G.add3(G.pointAlong(line, along), G.mul3(tangent, (sign * thick) / 2));
      flangeAt(`${name}.flange`, centre, tangent, r * flangeR, thick, { bolts: 6, owner: name });
    });
    return line;
  }
  // a saddle pad on a cylinder whose axis is F.v (F.o on that axis, F.a the pad's outward axis)
  function saddle(name, F, a, hostR, s1, host, { tone = "mid", extra = "" } = {}) {
    const low = Math.sqrt(Math.max(0, hostR * hostR - a * a));
    const shape = ctx.record(A.disc(F, low - 0.05, s1, a, { name, seated: true, cut: [host] }));
    ctx.put(name, G.pointOf(F, (hostR + s1) / 2, 0, 0), S(G.saddleOf(F, a, hostR, s1, P), { tone }) + extra, [shape]);
    return G.pointOf(F, s1, 0, 0);
  }
  // a frame on the bowl wall at angle deg, height z: F.a radial, F.v up (the bowl's axis), angle 0 = horizontal
  const bowlFrame = (deg, z) => G.frameOf(L(0, 0, z), dir(deg), dir(deg + 90), [0, 0, 1]);
  // a frame for a face on the bowl: angle 0 = up, angles grow to the viewer's right
  const faceFrame = (deg, z) => {
    const a = dir(deg);
    return G.frameOf(L(0, 0, z), a, [0, 0, 1], G.cross3(a, [0, 0, 1]));
  };
  const rect = (cx, cy, deg, r0, r1, half) => {
    const u = dir(deg);
    const v = [-u[1], u[0]];
    return [[r0, -half], [r1, -half], [r1, half], [r0, half]].map(([s, t]) => [ox + cx + u[0] * s + v[0] * t, oy + cy + u[1] * s + v[1] * t]);
  };

  // ---------- stand (`stand: false` leaves it out; the base flange then hangs as the grounded item) ----------
  const SHELF_TOP = 74.1;
  if (stand) {
    const LEGS = [[-LEG, -LEG], [LEG, -LEG], [-LEG, LEG], [LEG, LEG]].sort((a, b) => k.depthOf(L(a[0], a[1], 0), P) - k.depthOf(L(b[0], b[1], 0), P));
    ctx.back.push(`<path class="iso-halo" d="${k.haloOf({ x: ox - 34, y: oy - 34, w: 68, d: 68, r: 30 }, oz, 0.1, P)}"/>`);
    // two floor skids along x carry the feet; lifting eyes at their ends
    const SKID = 4;
    for (const y of [-LEG, LEG]) {
      const plan = { x: ox - 40, y: oy + y - 3.5, w: 80, d: 7, r: 0.6 };
      ctx.slab(N("skid"), plan, oz, SKID, { tone: "lo" }, { steps: 3, bevel: 0.4, inner: Ln(k.sideSeam(plan, oz + SKID / 2, P, 3), { tone: "faint" }) });
      for (const x of [-36.5, 36.5]) {
        const F = G.frameOf(L(x, y, SKID + 2.3), [0, 1, 0], [1, 0, 0], [0, 0, 1]);
        const name = N("eye");
        ctx.put(name, L(x, y, SKID + 2.3), S(G.ringBand(-0.6, 0.6, 1.25, 2.3, F, P), { tone: "mid" }), [ctx.record(A.ring(F, -0.6, 0.6, 1.25, 2.3, { name }))]);
      }
    }
    for (const [x, y] of LEGS) {
      const [wx, wy] = [ox + x, oy + y];
      const z0 = oz + SKID;
      ctx.cyl(N("foot"), wx, wy, 5, z0, 1.6, { tone: "lo" }, { steps: 28, bevel: 0.3, extra: Dots([0, 1, 2, 3].map((i) => at([wx + 3.8 * Math.cos((i + 0.5) * Math.PI / 2), wy + 3.8 * Math.sin((i + 0.5) * Math.PI / 2), z0 + 1.6])), { size: 0.4 }) });
      ctx.cyl(N("leveller"), wx, wy, 3.2, z0 + 1.6, 3.4, { tone: "mid" }, { steps: 24, inner: Ln(k.sideArc(wx, wy, 3.2, z0 + 3.3, P, 16), { tone: "faint" }) });
      const plan = { x: wx - 2.5, y: wy - 2.5, w: 5, d: 5, r: 0.6 };
      ctx.slab(N("leg"), plan, z0 + 5, 96 - SKID - 5, { tone: "mid" }, { steps: 3, bevel: 0.4, inner: Ln([34, 70].map((z) => k.sideSeam(plan, oz + z, P, 3)).join(""), { tone: "faint" }) });
      const pad = { x: wx - 4.5, y: wy - 4.5, w: 9, d: 9, r: 0.8 };
      const outer = [wx + Math.sign(x) * 2.6, wy + Math.sign(y) * 2.6];
      ctx.slab(N("leg-pad"), pad, oz + 96, 2.2, { tone: "mid" }, { steps: 3, bevel: 0.4, extra: ctx.screws([outer, [wx - Math.sign(x) * 2.6, wy + Math.sign(y) * 2.6], [wx + Math.sign(x) * 2.6, wy - Math.sign(y) * 2.6]], oz + 98.2, { ring: 0.9, size: 0.4 }) });
      // a rubber isolator between the pad and the base flange
      const iso = (s) => 2.4 + 0.7 * Math.sin((Math.PI * (s - 98.2)) / 1.8);
      const isoSlope = (s) => ((0.7 * Math.PI) / 1.8) * Math.cos((Math.PI * (s - 98.2)) / 1.8);
      turned(N("isolator"), axisAt(x, y), Array.from({ length: 13 }, (_, i) => {
        const s = 98.2 + (1.8 * i) / 12;
        return [s, iso(s), i && i < 12 ? 1 : 0];
      }), { tone: "lo" }, { smooth: { slope: isoSlope, rows: 3 } });
    }
    const rail = (name, x0, y0, x1, y1, z0, h) => ctx.box(N(name), [ox + x0, oy + y0, oz + z0], [ox + x1, oy + y1, oz + z0 + h], { tone: "mid" }, { r: 0.4, bevel: 0.3 });
    const IN = LEG - 2.5;
    rail("rail", -IN, -LEG - 1.5, IN, -LEG + 1.5, 22, 4);
    rail("rail", -IN, LEG - 1.5, IN, LEG + 1.5, 22, 4);
    rail("rail", -LEG - 1.5, -IN, -LEG + 1.5, IN, 22, 4);
    rail("rail", LEG - 1.5, -IN, LEG + 1.5, IN, 22, 4);
    rail("rail-upper", -IN, -LEG - 1.5, IN, -LEG + 1.5, 58, 3);
    rail("rail-upper", -IN, LEG - 1.5, IN, LEG + 1.5, 58, 3);

    // cooler shelf between the +x legs, with two gussets and a label plate
    const SHELF = { x: ox + LEG + 2.5, y: oy - LEG - 2.5, w: 21.5, d: 2 * LEG + 5, r: 0.8 };
    ctx.slab(N("shelf"), SHELF, oz + SHELF_TOP - 2.5, 2.5, { tone: "mid" }, { steps: 3, bevel: 0.4, inner: Ln(k.sideSeam(SHELF, oz + SHELF_TOP - 1.25, P, 3), { tone: "faint" }), extra: ctx.screws([[SHELF.x + 2.4, SHELF.y + 2.4], [SHELF.x + 2.4, SHELF.y + SHELF.d - 2.4]], oz + SHELF_TOP, { ring: 0.9, size: 0.4 }) });
    for (const y of [-LEG, LEG]) {
      const F = G.frameOf(L(0, 0, 0), [0, 1, 0], [1, 0, 0], [0, 0, 1]);
      const poly = [[LEG + 2.5, SHELF_TOP - 2.5], [LEG + 15, SHELF_TOP - 2.5], [LEG + 2.5, SHELF_TOP - 16]];
      const name = N("gusset");
      ctx.put(name, L(LEG + 6.7, y, SHELF_TOP - 7), S(G.prismOf(F, poly, y - 1, y + 1, P), { tone: "mid" }), [ctx.record(A.prism(F, poly, y - 1, y + 1, { name }))]);
    }
    {
      const plate = { x: SHELF.x + 1.2, y: oy - 9, w: 4.6, d: 18, r: 0.6 };
      const z = oz + SHELF_TOP;
      ctx.slab(N("label"), plate, z, 0.6, { tone: "mid" }, {
        steps: 3,
        extra:
          Ln(k.planOutline(k.insetPlan(plate, 0.8), z + 0.6, P, 3), { tone: "faint" }) +
          Ln([0, 1, 2].map((i) => k.onTop([[plate.x + 1.6 + i * 1.1, plate.y + 3], [plate.x + 1.6 + i * 1.1, plate.y + [12, 9, 13][i]]], z + 0.6, P)).join(""), { tone: "lo", free: true }) +
          Dots([at([plate.x + plate.w / 2, plate.y + 1.4, z + 0.6]), at([plate.x + plate.w / 2, plate.y + plate.d - 1.4, z + 0.6])], { size: 0.38 }),
      });
    }
  }

  // ---------- bowl: base flange, turned body, top flange ----------
  // the bowl: a rounded knuckle (quarter ellipse) from r 30 at the base flange out to the r 34 wall
  const KN = Z.knuckle - Z.bowl[0];
  const R0 = 30;
  const bowlR = (s) => {
    if (s >= Z.knuckle) return R_.bowl;
    const q = Math.min(1, (Z.knuckle - s) / KN);
    return R0 + (R_.bowl - R0) * Math.sqrt(1 - q * q);
  };
  const bowlSlope = (s) => {
    if (s >= Z.knuckle) return 0;
    const q = Math.min(0.995, (Z.knuckle - s) / KN);
    return ((R_.bowl - R0) / KN) * (q / Math.sqrt(1 - q * q));
  };
  const BASE_FLANGE = turned(N("base-flange"), AXIS, [[Z.flange[0], R_.flange], [Z.flange[1], R_.flange]], { tone: "mid" }, {
    bevel: 0.5,
    extra: Dots(G.dotsOf(AXIS, Z.flange[1], 35.6, 24, P, { all: true }), { size: 0.42, tone: "mid" }),
  });
  if (!stand) BASE_FLANGE.ground = true;
  const BOWL_PROFILE = [
    [Z.bowl[0], R0],
    ...Array.from({ length: 19 }, (_, i) => {
      const s = Z.bowl[0] + KN * Math.sin(((i + 1) / 20) * (Math.PI / 2));
      return [s, bowlR(s), 1];
    }),
    [Z.knuckle, R_.bowl, 1],
    [Z.bowl[1], R_.bowl],
  ];
  const BOWL = turned(N("bowl"), AXIS, BOWL_PROFILE, { tone: "mid" }, {
    smooth: { slope: bowlSlope, rows: 4 },
    inner: Ln([Z.knuckle + 0.6, 116].map((s) => G.arcOf(AXIS, s, R_.bowl, P)).join(""), { tone: "faint" }),
  });
  for (const deg of [32, 95, 140, 175, 210, 245, 280, 312]) {
    const ring = rect(0, 0, deg, R_.bowl - 0.05, R_.bowl + 2.2, 0.7);
    ctx.prism(N("bowl-rib"), ring, oz + Z.bowl[0], Z.bowl[1] - Z.bowl[0], { tone: "mid" }, { ref: polar(deg, R_.bowl + 1.1, (Z.bowl[0] + Z.bowl[1]) / 2) });
  }
  turned(N("top-flange"), AXIS, [[Z.top[0], R_.top], [Z.top[1], R_.top]], { tone: "mid" }, {
    bevel: 0.5,
    extra: Dots(G.dotsOf(AXIS, Z.top[1], 34.9, 32, P, { all: true, phase: Math.PI / 32 }), { size: 0.38, tone: "mid" }),
  });

  // ---------- rotor: carousel, envelopes for the live vanes and packets, hub, strobe disc, shaft ----------
  ctx.material = "";
  turned(N("carousel"), AXIS, [[Z.carousel[0], R_.carousel], [Z.carousel[1], R_.carousel]], { tone: "mid" }, { bevel: 0.4, inner: Ln(G.arcOf(AXIS, Z.carousel[0] + 1.25, R_.carousel, P), { tone: "faint" }) });
  const AZ = Math.atan2(toward[1], toward[0]) / DEG;
  const halfAnnulus = (from) => {
    const n = 24;
    const outer = Array.from({ length: n + 1 }, (_, i) => polar(from + (180 * i) / n, R_.envOut, 0).slice(0, 2));
    const inner = Array.from({ length: n + 1 }, (_, i) => polar(from + 180 - (180 * i) / n, R_.envIn, 0).slice(0, 2));
    return [...outer, ...inner];
  };
  for (const [name, from, ref] of [["env-back", AZ + 90, polar(AZ + 180, 20, 128)], ["env-front", AZ - 90, polar(AZ, 20, 128)]]) {
    const full = N(name);
    ctx.put(full, ref, "", [ctx.record(A.extruded(halfAnnulus(from), oz + Z.pocket, Z.envTop - Z.pocket, { name: full }))]);
  }
  ctx.slot(`${id}:rotorBack`, { after: N("env-back") });
  ctx.slot(`${id}:rotorFront`, { after: N("env-front") });

  // the stationary rim the packets ride against, open at the gate; a sill fills the opening up to the pocket floor
  const sector = (a0, a1, r0, r1, n = 16) => [
    ...Array.from({ length: n + 1 }, (_, i) => polar(a0 + ((a1 - a0) * i) / n, r1, 0).slice(0, 2)),
    ...Array.from({ length: n + 1 }, (_, i) => polar(a1 - ((a1 - a0) * i) / n, r0, 0).slice(0, 2)),
  ];
  const RIM_H = Z.rimTop - Z.top[1];
  const rimPiece = (name, a0, a1, ref) => {
    const n = Math.max(4, Math.round((a1 - a0) / 6));
    ctx.prism(N(name), sector(a0, a1, R_.rimIn, R_.rimOut, n), oz + Z.top[1], RIM_H, { tone: "mid" }, {
      ref,
      extra: Dots(Array.from({ length: Math.floor((a1 - a0) / 20) }, (_, i) => at(polar(a0 + 10 + i * 20, (R_.rimIn + R_.rimOut) / 2, Z.rimTop))), { size: 0.36 }),
    });
  };
  const G0 = GATE_DEG - GATE_HALF;
  const G1 = GATE_DEG + GATE_HALF;
  rimPiece("rim-back", AZ + 90, AZ + 270, polar(AZ + 180, 30.5, 126));
  rimPiece("rim-front", AZ - 90, G0, polar((AZ - 90 + G0) / 2, 30.5, 126));
  rimPiece("rim-front", G1, AZ + 90, polar((G1 + AZ + 90) / 2, 30.5, 126));
  ctx.prism(N("gate-sill"), sector(G0, G1, R_.rimIn - 0.2, R_.rimOut, 4), oz + Z.top[1], Z.pocket - Z.top[1], { tone: "mid" }, { ref: polar(GATE_DEG, 30.5, 123.7) });
  // a guillotine gate in two guides with a lintel; the plate lifts while a packet leaves
  const GUIDE = [R_.rimOut, R_.rimOut + 1.4];
  const LINTEL = [138.2, 139.6];
  for (const sgn of [-1, 1]) {
    const deg = GATE_DEG + sgn * (GATE_HALF + 1.5);
    ctx.prism(N("gate-guide"), rect(0, 0, deg, GUIDE[0], GUIDE[1], 0.7), oz + Z.top[1], LINTEL[0] - Z.top[1], { tone: "mid" }, { ref: polar(deg, 32.1, 130) });
  }
  ctx.prism(N("gate-lintel"), sector(G0 - 3, G1 + 3, GUIDE[0], GUIDE[1], 6), oz + LINTEL[0], LINTEL[1] - LINTEL[0], { tone: "mid" }, {
    ref: polar(GATE_DEG, 32.1, LINTEL[1]),
    extra: Dots([at(polar(GATE_DEG - 6, 32.1, LINTEL[1])), at(polar(GATE_DEG + 6, 32.1, LINTEL[1]))], { size: 0.36 }),
  });
  {
    const name = N("env-gate");
    ctx.put(name, polar(GATE_DEG, 31.9, 131), "", [ctx.record(A.extruded(sector(G0 + 0.4, G1 - 0.4, R_.rimOut + 0.1, R_.rimOut + 0.9, 4), oz + Z.pocket, 137.9 - Z.pocket, { name }))]);
  }
  ctx.slot(`${id}:gate`, { after: N("env-gate") });
  // the discharge spout: floor and two low walls, sloping out and down over the top flange
  const SD = [Math.cos(GATE_DEG * DEG) * Math.cos(SPOUT_SLOPE), Math.sin(GATE_DEG * DEG) * Math.cos(SPOUT_SLOPE), -Math.sin(SPOUT_SLOPE)];
  const SU = dir(GATE_DEG + 90);
  const SV = G.cross3(SD, SU);
  const S0 = polar(GATE_DEG, R_.rimOut, Z.pocket);
  const SF = G.frameOf(S0, SD, SU, SV);
  const spoutPiece = (name, poly, s0 = 0, s1 = SPOUT_LEN) => {
    const full = N(name);
    ctx.put(full, G.pointOf(SF, (s0 + s1) / 2, 0, 0), S(G.prismOf(SF, poly, s0, s1, P), { tone: "mid" }), [ctx.record(A.prism(SF, poly, s0, s1, { name: full }))]);
  };
  spoutPiece("spout-floor", [[-5, -1], [5, -1], [5, 0], [-5, 0]]);
  {
    const name = N("env-spout");
    ctx.put(name, G.pointOf(SF, SPOUT_LEN / 2, 0, 4), "", [ctx.record(A.prism(SF, [[-4.3, 0.05], [4.3, 0.05], [4.3, 8.4], [-4.3, 8.4]], 0.3, SPOUT_LEN, { name }))]);
  }
  ctx.slot(`${id}:spout`, { after: N("env-spout") });
  spoutPiece("spout-wall", [[4.4, 0], [5, 0], [5, 2.4], [4.4, 2.4]], 1.6);
  spoutPiece("spout-wall", [[-5, 0], [-4.4, 0], [-4.4, 2.4], [-5, 2.4]], 1.6);
  // where a packet leaves the lip and where it is handed on (bottom at z 100, still falling)
  const LIP = G.add3(S0, G.mul3(SD, SPOUT_LEN));
  const vx = SPOUT_V[1] * Math.cos(SPOUT_SLOPE);
  const vz0 = SPOUT_V[1] * Math.sin(SPOUT_SLOPE);
  const HAND_Z = 100;
  const tFall = (-vz0 + Math.sqrt(vz0 * vz0 + 2 * GRAVITY * (LIP[2] - oz - HAND_Z))) / GRAVITY;
  const HAND = [LIP[0] + Math.cos(GATE_DEG * DEG) * vx * tFall, LIP[1] + Math.sin(GATE_DEG * DEG) * vx * tFall, oz + HAND_Z];
  {
    const name = N("env-fall");
    const r0 = Math.hypot(LIP[0] - ox, LIP[1] - oy) + 1.7;
    ctx.put(name, polar(GATE_DEG, r0 + 5, 114), "", [ctx.record(A.extruded(rect(0, 0, GATE_DEG, r0, r0 + 10, 5.2), oz + HAND_Z, LIP[2] - oz + 8 - HAND_Z, { name }))]);
  }
  ctx.slot(`${id}:fall`, { after: N("env-fall") });
  // the hub as two turned items (a stepped lathe would be drawn as its hull)
  turned(N("hub-collar"), AXIS, [[Z.pocket, R_.hubCollar], [Z.pocket + 4, R_.hubCollar]], { tone: "hi" }, {
    bevel: 0.3,
    extra: Dots(G.dotsOf(AXIS, Z.pocket + 4, 9.8, 10, P, { all: true }), { size: 0.36, tone: "mid" }),
  });
  turned(N("hub-column"), AXIS, [[Z.pocket + 4, R_.hubColumn], [Z.hub, R_.hubColumn]], { tone: "hi" }, { inner: Ln(G.arcOf(AXIS, Z.pocket + 8, R_.hubColumn, P), { tone: "faint" }) });
  {
    const c = L(0, 0, Z.strobe);
    turned(N("strobe"), AXIS, [[Z.hub, R_.strobe], [Z.strobe, R_.strobe]], { tone: "hi" }, {
      bevel: 0.3,
      extra: Ln(k.ring(c[0], c[1], R_.strobe - 0.7, c[2], P, 64) + k.ring(c[0], c[1], 2.8, c[2], P, 24), { tone: "lo" }),
    });
  }
  ctx.slot(`${id}:hubtop`, { after: N("strobe") });
  turned(N("shaft"), AXIS, [[Z.strobe, R_.shaft], [Z.spider[0], R_.shaft]], { tone: "mid" }, { inner: Ln(G.arcOf(AXIS, 149, R_.shaft, P), { tone: "faint" }) });

  // ---------- cage: post feet, posts, top ring (a closed tube), spider, bearing housing, pulley ----------
  const POST_TOP = Z.ring - Math.sqrt(R_.ring ** 2 - R_.post ** 2);
  const POSTS = Array.from({ length: 8 }, (_, i) => 22.5 + 45 * i);
  for (const deg of POSTS) {
    const p = polar(deg, R_.postAt, 0);
    ctx.cyl(N("post-foot"), p[0], p[1], 2.3, oz + Z.top[1], 1, { tone: "mid" }, { steps: 20, bevel: 0.2 });
    ctx.cyl(N("post"), p[0], p[1], R_.post, oz + Z.top[1] + 1, POST_TOP - Z.top[1] - 1, { tone: "mid" }, { steps: 16, inner: Ln(k.sideArc(p[0], p[1], R_.post, oz + 141, P, 10), { tone: "faint" }) });
  }
  {
    const name = N("ring");
    const F = G.frameOf(L(0, 0, Z.ring), [0, 0, 1], [1, 0, 0], [0, 1, 0]);
    const points = G.arcPoints(F, 0, R_.postAt, 0, Math.PI * 2, 120);
    const touch = [N("post*"), N("arm*"), N("funnel-bar*"), N("motor-plate*"), N("env-drop")];
    R.route(name, points, R_.ring, { closed: true, touch, owner: name });
    T.tubePieces(points, R_.ring, P, { closed: true, maxLength: 9, spacing: 1.2 }).forEach((piece) =>
      ctx.put(`${name}:chunk`, piece.mid, T.tubeSvg(piece, { tone: "mid" }), [A.tube(piece.points, piece.radii, { touch })], { attrs: ` data-route="${name}"` }),
    );
  }
  ctx.material = "fx-graphite";
  turned(N("spider"), AXIS, [[Z.spider[0], 8], [Z.spider[1], 8]], { tone: "mid" }, { bevel: 0.4, extra: Dots(G.dotsOf(AXIS, Z.spider[1], 6.6, 6, P, { all: true, phase: Math.PI / 6 }), { size: 0.4 }) });
  ctx.material = "";
  for (const deg of [0, 120, 240]) {
    const ring = rect(0, 0, deg, 8, R_.postAt - R_.ring, 1.5);
    const tip = polar(deg, 28, Z.arm[1]);
    ctx.prism(N("arm"), ring, oz + Z.arm[0], Z.arm[1] - Z.arm[0], { tone: "mid" }, { extra: Dots([at(tip)], { size: 0.4 }), ref: polar(deg, 20, (Z.arm[0] + Z.arm[1]) / 2) });
  }
  // the shaft's bearing cartridge: a bolted base flange, a bright body, a collar and a cap (separate turned items)
  turned(N("bearing-flange"), AXIS, [[Z.bearing[0], 7.2], [165.6, 7.2]], { tone: "mid" }, { bevel: 0.3, extra: Dots(G.dotsOf(AXIS, 165.6, 6.3, 6, P, { all: true }), { size: 0.38 }) });
  const BEARING_BODY = turned(N("bearing-body"), AXIS, [[165.6, 5], [172.6, 5]], { tone: "hi" }, { inner: Ln(G.arcOf(AXIS, 169.6, 5, P), { tone: "faint" }) });
  turned(N("bearing-collar"), AXIS, [[172.6, 5.8], [174, 5.8]], { tone: "hi" }, { bevel: 0.2 });
  turned(N("bearing-cap"), AXIS, [[174, 4.2], [Z.bearing[1], 4.2]], { tone: "mid" }, { bevel: 0.3 });
  {
    const nippleDeg = 20;
    const F = G.frameAlong(polar(nippleDeg, 4.9, 170.6), dir(nippleDeg));
    const name = N("grease-nipple");
    ctx.put(name, G.pointOf(F, 0.8, 0, 0), S(G.disc(0, 1.5, 0.55, F, P), { tone: "mid" }), [ctx.record(A.disc(F, 0, 1.5, 0.55, { name, seated: true, cut: [BEARING_BODY] }))]);
    const tip = G.pointOf(F, 1.5 + Math.sqrt(0.75 ** 2 - 0.45 ** 2), 0, 0);
    ctx.put(`${name}-ball`, tip, S(G.sphereOf(tip, 0.75, P, { steps: 16 }), { tone: "mid" }), [ctx.record(A.ball(tip, 0.75, { name: `${name}-ball`, seated: true }))], { bias: 0.05 });
  }
  turned(N("shaft-neck"), AXIS, [[Z.bearing[1], 2], [Z.pulley[0], 2]], { tone: "mid" });
  const pulleyProfile = (r) => [[Z.pulley[0], r - 0.4], [Z.pulley[0] + 0.4, r], [Z.pulley[1] - 0.4, r], [Z.pulley[1], r - 0.4]];
  {
    const c = L(0, 0, Z.pulley[1]);
    turned(N("shaft-pulley"), AXIS, pulleyProfile(5.5), { tone: "hi" }, { bevel: 0.2, extra: Ln(k.ring(c[0], c[1], 5, c[2], P, 40) + k.ring(c[0], c[1], 1.8, c[2], P, 16), { tone: "lo" }) });
  }
  ctx.slot(`${id}:shaftPulley`, { after: N("shaft-pulley") });

  // ---------- drive: motor plate and spacer, motor, pulley, belt ----------
  ctx.box(N("motor-spacer"), L(26, -1.5, Z.arm[1]), L(30, 1.5, Z.plate[0]), { tone: "mid" }, { r: 0.3 });
  {
    const plate = { x: ox + 26, y: oy - 9, w: 30, d: 18, r: 1.2 };
    ctx.slab(N("motor-plate"), plate, oz + Z.plate[0], Z.plate[1] - Z.plate[0], { tone: "mid" }, {
      steps: 4,
      bevel: 0.4,
      inner: Ln(k.sideSeam(plate, oz + (Z.plate[0] + Z.plate[1]) / 2, P, 4), { tone: "faint" }),
      extra: ctx.screws([[ox + 28.5, oy - 6.5], [ox + 28.5, oy + 6.5]], oz + Z.plate[1], { ring: 1, size: 0.4 }),
    });
  }
  const MF = axisAt(MOTOR[0], MOTOR[1]);
  ctx.material = "fx-graphite";
  turned(N("motor-flange"), MF, [[Z.plate[1], 8.5], [Z.plate[1] + 1.4, 8.5]], { tone: "mid" }, { bevel: 0.3, extra: Dots(G.dotsOf(MF, Z.plate[1] + 1.4, 7.6, 6, P, { all: true, phase: Math.PI / 6 }), { size: 0.4 }) });
  const CAN = [167, 177];
  turned(N("motor"), MF, [[CAN[0], 7], [CAN[1] - 0.6, 7], [CAN[1], 6.4], [CAN[1] + 0.6, 6.4]], { tone: "mid" }, {
    extra: k.fadedSvg(G.ribsOf(MF, CAN[0] + 1, CAN[1] - 1.4, 7, 36, P, { fade: [0.1, 0.55], seams: true }), { tone: "lo" }),
  });
  ctx.material = "";
  turned(N("motor-shaft"), MF, [[CAN[1] + 0.6, 1], [Z.pulley[0], 1]], { tone: "mid" });
  {
    const c = L(MOTOR[0], MOTOR[1], Z.pulley[1]);
    turned(N("motor-pulley"), MF, pulleyProfile(4), { tone: "hi" }, { bevel: 0.2, extra: Ln(k.ring(c[0], c[1], 3.5, c[2], P, 32) + k.ring(c[0], c[1], 1.3, c[2], P, 12), { tone: "lo" }) });
  }
  ctx.slot(`${id}:motorPulley`, { after: N("motor-pulley") });
  {
    const box = { x: ox + MOTOR[0] - 4, y: oy + 7, w: 8, d: 4, r: 0.5 };
    const z0 = oz + 168.5;
    ctx.material = "fx-graphite";
    ctx.slab(N("terminal-box"), box, z0, 6, { tone: "mid" }, {
      steps: 2,
      bevel: 0.3,
      extra: Ln(k.planOutline(k.insetPlan(box, 0.7), z0 + 6, P, 2), { tone: "faint" }) + Dots([at([box.x + 1.2, box.y + 1, z0 + 6]), at([box.x + box.w - 1.2, box.y + box.d - 1, z0 + 6])], { size: 0.38 }),
    });
    ctx.cyl(N("gland"), box.x + box.w / 2, box.y + box.d / 2, 1.1, z0 + 6, 1.4, { tone: "mid" }, { steps: 16 });
    ctx.material = "";
  }
  {
    const name = N("belt");
    const c1 = L(0, 0, Z.belt);
    const c2 = L(MOTOR[0], MOTOR[1], Z.belt);
    const BR = 1.0;
    const r1 = 5.5 + BR;
    const r2 = 4 + BR;
    const d = Math.hypot(c2[0] - c1[0], c2[1] - c1[1]);
    const th = Math.atan2(c2[1] - c1[1], c2[0] - c1[0]);
    const b = Math.acos((r1 - r2) / d);
    const arc = (c, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => {
      const a = a0 + ((a1 - a0) * i) / n;
      return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, c[2]];
    });
    const points = [...arc(c1, r1, th + b, th + 2 * Math.PI - b, 36), ...arc(c2, r2, th - b, th + b, 20)];
    const touch = [N("shaft-pulley"), N("motor-pulley")];
    R.route(name, points, BR, { closed: true, touch, limp: true, owner: name });
    const cum = [0];
    for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    const side = [-toward[1], toward[0]];
    const breaks = [];
    for (const [c, r] of [[c1, r1], [c2, r2]])
      for (const sgn of [-1, 1]) {
        const q = [c[0] + side[0] * r * sgn, c[1] + side[1] * r * sgn];
        let best = 0;
        points.forEach((p, i) => {
          if (Math.hypot(p[0] - q[0], p[1] - q[1]) < Math.hypot(points[best][0] - q[0], points[best][1] - q[1])) best = i;
        });
        breaks.push(cum[best]);
      }
    T.tubePieces(points, BR, P, { closed: true, maxLength: 5, spacing: 0.8, breaks }).forEach((piece) =>
      ctx.put(`${name}:chunk`, piece.mid, T.tubeSvg(piece, { tone: "mid" }), [A.tube(piece.points, piece.radii, { touch })], { bias: 0.05, attrs: ` data-route="${name}"`, material: "fx-graphite" }),
    );
  }

  // ---------- intake: two bars on the ring, funnel flange, flared funnel, lip ----------
  for (const sx of [-1, 1]) {
    ctx.box(N("funnel-bar"), L(sx > 0 ? 7.5 : -10.5, FUNNEL[1] - 11, Z.plate[0]), L(sx > 0 ? 10.5 : -7.5, FUNNEL[1] + 6, Z.funnelFoot), { tone: "mid" }, {
      r: 0.4,
      bevel: 0.3,
      extra: Dots([at(L(sx * 9, FUNNEL[1] - 8.4, Z.funnelFoot)), at(L(sx * 9, FUNNEL[1] + 4, Z.funnelFoot))], { size: 0.38 }),
    });
  }
  const FF = axisAt(FUNNEL[0], FUNNEL[1]);
  {
    const name = N("env-drop");
    const c = L(FUNNEL[0], FUNNEL[1], 0);
    ctx.put(name, L(FUNNEL[0], FUNNEL[1], (Z.envTop + Z.funnelFoot) / 2), "", [ctx.record(A.cylinder(c[0], c[1], 6.5, oz + Z.envTop, Z.funnelFoot - Z.envTop, { name }))]);
  }
  ctx.slot(`${id}:drop`, { after: N("env-drop") });
  turned(N("funnel-flange"), FF, [[Z.funnelFoot, 9.5], [Z.funnelFoot + 1.2, 9.5]], { tone: "mid" }, { bevel: 0.3, extra: Dots(G.dotsOf(FF, Z.funnelFoot + 1.2, 8.4, 8, P, { all: true, phase: Math.PI / 8 }), { size: 0.38 }) });
  const SPOUT = [Z.funnelFoot + 1.2, 171];
  const FLARE = [171, 184];
  const flare = (s) => 7 + 4.5 * Math.pow(Math.max(0, (s - FLARE[0]) / (FLARE[1] - FLARE[0])), 1.7);
  const flareSlope = (s) => (s <= FLARE[0] ? 0 : ((4.5 * 1.7) / (FLARE[1] - FLARE[0])) * Math.pow((s - FLARE[0]) / (FLARE[1] - FLARE[0]), 0.7));
  const FUNNEL_PROFILE = [
    [SPOUT[0], 7],
    [FLARE[0], 7, 1],
    ...Array.from({ length: 21 }, (_, i) => {
      const s = FLARE[0] + ((FLARE[1] - FLARE[0]) * (i + 1)) / 22;
      return [s, flare(s), 1];
    }),
    [FLARE[1], flare(FLARE[1])],
  ];
  turned(N("funnel"), FF, FUNNEL_PROFILE, { tone: "mid" }, { smooth: { slope: flareSlope, rows: 4 }, inner: Ln(G.arcOf(FF, FLARE[0], 7, P), { tone: "faint" }) });
  {
    const name = N("funnel-lip");
    const shape = ctx.record(A.ring(FF, FLARE[1], Z.mouth, 11, 12.2, { name }));
    ctx.put(name, G.pointOf(FF, (FLARE[1] + Z.mouth) / 2, 0, 0),
      S(G.ringBand(FLARE[1], Z.mouth, 11, 12.2, FF, P), { tone: "mid" }) +
        (() => {
          const back = at(G.pointOf(FF, Z.mouth, 11, (AZ + 180) * DEG));
          const front = at(G.pointOf(FF, Z.mouth, 11, AZ * DEG));
          const gid = `${id}-void`;
          return `<defs><linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${back[0].toFixed(1)}" y1="${back[1].toFixed(1)}" x2="${front[0].toFixed(1)}" y2="${front[1].toFixed(1)}"><stop offset="0" class="cf-void-0"/><stop offset="0.55" class="cf-void-1"/><stop offset="1" class="cf-void-2"/></linearGradient></defs><path class="cf-void" fill="url(#${gid})" d="${G.circleOf(FF, Z.mouth, 11, P)}"/>`;
        })() +
        Ln(G.arcOf(FF, Z.mouth, 11, P, { inward: true, least: -1 }), { tone: "lo" }) +
        Dots(G.dotsOf(FF, Z.mouth, 11.6, 16, P, { all: true }), { size: 0.36, tone: "mid" }),
      [shape]);
  }
  ctx.slot(`${id}:intake`, { after: N("funnel-lip") });

  // ---------- instruments on the bowl: tachometer, sync lamp, gate crank ----------
  const TZ = 114.7;
  const TF = faceFrame(TACH_DEG, TZ);
  saddle(N("tach-pad"), bowlFrame(TACH_DEG, TZ), 5.4, R_.bowl, 35.4, BOWL);
  const FACE_S = 37.3;
  const TICKS = 18;
  const tickAngle = (i) => (-135 + (270 * i) / TICKS) * DEG;
  const SYNC_SHARE = 0.7;
  const syncAngle = (-135 + 270 * SYNC_SHARE) * DEG;
  {
    const P3 = (r, a) => at(G.pointOf(TF, FACE_S, r, a));
    const tick = (i) => k.pathOf([P3(3.2, tickAngle(i)), P3(4.6, tickAngle(i))]);
    const arc = k.pathOf(Array.from({ length: 49 }, (_, i) => P3(3.2, (-135 + (270 * i) / 48) * DEG)));
    const all = Array.from({ length: TICKS + 1 }, (_, i) => i);
    const minor = all.filter((i) => i % 3).map(tick).join("");
    const major = all.filter((i) => i % 3 === 0).map(tick).join("");
    const sync = k.pathOf([P3(3.2, syncAngle), P3(4.6, syncAngle)]);
    ctx.material = "fx-graphite";
    turned(N("tach"), TF, [[35.4, 5.4], [37.8, 5.4], [37.8, 4.6], [FACE_S, 4.6]], { tone: "mid" }, {
      bevel: 0.3,
      extra: Ln(arc, { tone: "mid" }) + Ln(minor, { tone: "mid" }) + Ln(major, { tone: "hi" }) + `<path class="iso-line" data-tone="hi" style="stroke-width:1.3" d="${sync}"/>`,
    });
    ctx.material = "";
  }
  ctx.slot(`${id}:tach`, { after: N("tach") });
  const LZ = 115.5;
  const LF = faceFrame(LAMP_DEG, LZ);
  saddle(N("lamp-pad"), bowlFrame(LAMP_DEG, LZ), 3, R_.bowl, 35.2, BOWL);
  ctx.material = "fx-graphite";
  const LAMP_BODY = turned(N("lamp-housing"), LF, [[35.2, 2.7], [37.2, 2.7]], { tone: "mid" }, { bevel: 0.2 });
  const LAMP_HOUSING = turned(N("lamp-bezel"), LF, [[37.2, 1.9], [37.8, 1.9]], { tone: "mid" });
  ctx.material = "";
  const LENS_S = 37.8 + Math.sqrt(2.1 ** 2 - 1.9 ** 2);
  const LENS = G.pointOf(LF, LENS_S, 0, 0);
  {
    const name = N("lamp-lens");
    ctx.put(name, LENS, S(G.sphereOf(LENS, 2.1, P, { steps: 32 }), { tone: "hi", lit: true }), [ctx.record(A.ball(LENS, 2.1, { name, seated: true, cut: [LAMP_HOUSING, LAMP_BODY] }))], { bias: 0.1 });
  }
  ctx.slot(`${id}:lamp`, { after: N("lamp-lens") });
  const CZ = 114;
  saddle(N("crank-pad"), bowlFrame(CRANK_DEG, CZ), 2.8, R_.bowl, 35.4, BOWL);
  ctx.material = "fx-graphite";
  turned(N("crank-boss"), faceFrame(CRANK_DEG, CZ), [[35.4, 2], [37.6, 2]], { tone: "mid" }, { bevel: 0.2 });
  ctx.material = "";
  ctx.slot(`${id}:crank`, { after: N("crank-boss") });

  // ---------- drain valve with a handwheel, front-left on the bowl ----------
  {
    const deg = DRAIN_DEG;
    const VZ = 113;
    const VF = G.frameOf(L(0, 0, VZ), dir(deg), dir(deg + 90), [0, 0, 1]);
    saddle(N("drain-pad"), VF, 2, R_.bowl, 35.4, BOWL);
    turned(N("drain-stub"), VF, [[35.4, 1.2], [39.6, 1.2]], { tone: "mid" });
    const bulge = (x) => 1.5 + 0.8 * Math.sqrt(Math.max(0, 1 - (x / 1.8) ** 2));
    const bulgeSlope = (x) => (Math.abs(x) >= 1.8 - 1e-6 ? 0 : (-0.8 * (x / 1.8)) / (1.8 * Math.sqrt(1 - (x / 1.8) ** 2)));
    const mid = 41.8;
    const body = [[39.6, 1.5], ...Array.from({ length: 15 }, (_, i) => {
      const x = 1.8 * Math.sin(((i - 7) / 7) * (Math.PI / 2));
      return [mid + x, bulge(x), i && i < 14 ? 1 : 0];
    }), [44, 1.5]];
    const BODY = turned(N("drain-valve"), VF, body, { tone: "mid" }, { smooth: { slope: (s) => bulgeSlope(s - mid), rows: 3 } });
    turned(N("drain-outlet"), VF, [[44, 1.2], [46, 1.2]], { tone: "mid" });
    turned(N("drain-plug"), VF, [[46, 1.6], [47, 1.6]], { tone: "mid" }, { bevel: 0.2 });
    const top = G.pointOf(VF, mid, 0, 0);
    const SF = G.frameOf([top[0], top[1], top[2]], [0, 0, 1], dir(deg), dir(deg + 90));
    const stemFrom = bulge(0) - 0.15;
    const stemShape = ctx.record(A.disc(SF, stemFrom, 4.2, 0.45, { name: N("drain-stem"), seated: true, cut: [BODY] }));
    ctx.put(N("drain-stem"), G.pointOf(SF, 3.2, 0, 0), S(G.disc(stemFrom, 4.2, 0.45, SF, P), { tone: "mid" }), [stemShape]);
    const wheelS = 4.2;
    const wheel = ctx.record(A.disc(SF, wheelS, wheelS + 0.6, 2.6, { name: N("drain-wheel") }));
    const face = wheelS + 0.6;
    const spokes = [0, 1, 2].map((i) => k.pathOf([at(G.pointOf(SF, face, 0.6, (i * 2 * Math.PI) / 3 + 0.4)), at(G.pointOf(SF, face, 1.9, (i * 2 * Math.PI) / 3 + 0.4))])).join("");
    ctx.put(N("drain-wheel"), G.pointOf(SF, wheelS + 0.3, 0, 0), S(G.disc(wheelS, face, 2.6, SF, P, { bevel: 0.2 }), { tone: "mid" }) + Ln(spokes + G.circleOf(SF, face, 1.9, P, 24) + G.circleOf(SF, face, 0.6, P, 12), { tone: "lo" }), [wheel]);
  }

  // ---------- coolant: bowl bosses, two pipes, finned cooler on the stand's shelf (no shelf, no cooler) ----------
  if (stand) {
    const COOLER_X = 41.5;
    const COOLER_Y = -22;
    const CRADLE = 2.4;
    const COOLER_Z = SHELF_TOP + CRADLE + 5.5;
    const CF = G.frameOf(L(COOLER_X, COOLER_Y, COOLER_Z), [0, 1, 0], [1, 0, 0], [0, 0, 1]);
    turned(N("cooler-cap"), CF, [[0, 5.9], [1.2, 5.9]], { tone: "mid" }, { bevel: 0.2 });
    const COOLER = turned(N("cooler"), CF, [[1.2, 5.5], [30.8, 5.5]], { tone: "mid" }, {
      inner: Ln(Array.from({ length: 13 }, (_, i) => G.arcOf(CF, 3.6 + i * 2, 5.5, P)).join(""), { tone: "faint" }),
    });
    turned(N("cooler-cap"), CF, [[30.8, 5.9], [32, 5.9]], { tone: "mid" }, { bevel: 0.2, extra: Dots(G.dotsOf(CF, 32, 4.8, 8, P, { all: true, phase: Math.PI / 8 }), { size: 0.38 }) });
    for (const s of [5, 27]) {
      const c = [ox + COOLER_X, oy + COOLER_Y + s];
      ctx.box(N("cooler-cradle"), [c[0] - 4.6, c[1] - 1.2, oz + SHELF_TOP], [c[0] + 4.6, c[1] + 1.2, oz + SHELF_TOP + CRADLE], { tone: "mid" }, { r: 0.3, bevel: 0.2, extra: Dots([at([c[0] - 3.6, c[1], oz + SHELF_TOP + CRADLE]), at([c[0] + 3.6, c[1], oz + SHELF_TOP + CRADLE])], { size: 0.36 }) });
    }
    for (const deg of COOL_DEGS) {
      const face = saddle(N("coolant-pad"), bowlFrame(deg, 114), 2.6, R_.bowl, 35.6, BOWL);
      const reach = (COOLER_X + ox - face[0]) / Math.cos(deg * DEG);
      const out = G.add3(face, G.mul3(dir(deg), reach));
      const portF = G.frameOf([out[0], out[1], oz + COOLER_Z], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
      const port = saddle(N("cooler-port"), portF, 2.4, 5.5, 6.9, COOLER);
      pipe(N("coolant"), [face, out, [out[0], out[1], port[2]]], 1.5, { flangeR: 1.6 });
    }
  }

  // ---------- lubrication: oiler on the 120° arm, oil line to the bearing housing ----------
  {
    const deg = 120;
    const c = polar(deg, 20, 0);
    ctx.cyl(N("oiler-base"), c[0], c[1], 1.6, oz + Z.arm[1], 168.8 - Z.arm[1], { tone: "mid" }, { steps: 18 });
    ctx.cyl(N("oiler-glass"), c[0], c[1], 1.3, oz + 168.8, 3.2, { tone: "hi" }, { steps: 18, inner: Ln(k.sideArc(c[0], c[1], 1.3, oz + 170.1, P, 10), { tone: "faint" }) });
    ctx.cyl(N("oiler-cap"), c[0], c[1], 1.6, oz + 172, 0.8, { tone: "mid" }, { steps: 18, bevel: 0.2 });
    ctx.cable(N("oil-line"), [polar(deg, 18.4, 168), polar(deg, 5, 168)], 0.5, { tone: "mid", shells: [false, false] });
  }

  // ---------- drive cabinet on the floor at +x, its cable up to the motor's terminal box ----------
  {
    const C = { x0: 52, x1: 62, y0: -6, y1: 16, z0: 2, z1: 40 };
    ctx.slab(N("cabinet-plinth"), { x: ox + C.x0 - 1, y: oy + C.y0 - 1, w: C.x1 - C.x0 + 2, d: C.y1 - C.y0 + 2, r: 0.6 }, oz, C.z0, { tone: "lo" }, { steps: 3, bevel: 0.3 });
    const fx = ox + C.x1;
    const face = (pts) => k.pathOf(pts.map(([y, z]) => at([fx, oy + y, oz + z])), true);
    const door = face([[C.y0 + 1.6, C.z0 + 1.6], [C.y1 - 1.6, C.z0 + 1.6], [C.y1 - 1.6, C.z1 - 1.6], [C.y0 + 1.6, C.z1 - 1.6]]);
    const vents = [0, 1, 2, 3].map((i) => face([[C.y0 + 4, C.z1 - 7 - i * 2.4], [C.y1 - 7, C.z1 - 7 - i * 2.4], [C.y1 - 7, C.z1 - 6 - i * 2.4], [C.y0 + 4, C.z1 - 6 - i * 2.4]])).join("");
    const plate = face([[C.y0 + 4, C.z0 + 8], [C.y0 + 12, C.z0 + 8], [C.y0 + 12, C.z0 + 14], [C.y0 + 4, C.z0 + 14]]);
    const rules = [0, 1, 2].map((i) => k.pathOf([at([fx, oy + C.y0 + 5.2, oz + C.z0 + 12.6 - i * 1.6]), at([fx, oy + C.y0 + [11, 9.2, 10.2][i], oz + C.z0 + 12.6 - i * 1.6])])).join("");
    ctx.material = "fx-graphite";
    ctx.box(N("cabinet"), L(C.x0, C.y0, C.z0), L(C.x1, C.y1, C.z1), { tone: "mid" }, {
      r: 0.8,
      bevel: 0.4,
      extra: Ln(door + vents + plate, { tone: "lo" }) + Ln(rules, { tone: "lo", free: true }) + Dots([[C.y0 + 3.2, C.z1 - 3.2], [C.y1 - 3.2, C.z1 - 3.2], [C.y0 + 3.2, C.z0 + 3.2], [C.y1 - 3.2, C.z0 + 3.2]].map(([y, z]) => at([fx, oy + y, oz + z])), { size: 0.4 }),
    });
    ctx.box(N("cabinet-handle"), L(C.x1, C.y1 - 4.4, 20), L(C.x1 + 1.4, C.y1 - 3, 27), { tone: "mid" }, { r: 0.3 });
    for (const z of [10, 30]) ctx.cyl(N("cabinet-hinge"), ox + C.x1 + 0.6, oy + C.y0 + 2.4, 0.6, oz + z, 3.5, { tone: "mid" }, { steps: 12 });
    const GL = [57.5, 14];
    ctx.cyl(N("cabinet-gland"), ox + GL[0], oy + GL[1], 1.2, oz + C.z1, 1.4, { tone: "mid" }, { steps: 16 });
    ctx.material = "";
    const top = [ox + MOTOR[0], oy + 9, oz + 175.9];
    ctx.cable(N("motor-cable"), [L(GL[0], GL[1], C.z1 + 1.4), L(GL[0], GL[1], 183), [top[0], top[1], oz + 183], top], 0.7, { tone: "lo", shells: [true, true], limp: true, bend: 3 });
  }

  ctx.material = saved;

  // ---------- live data ----------
  ctx.data[id] = {
    centre: L(0, 0, 0),
    toward,
    pockets: POCKETS,
    z: { pocket: oz + Z.pocket, vane: Z.vane, packet: Z.packet, strobe: oz + Z.strobe, pulley: oz + Z.pulley[1], mouth: oz + Z.mouth, head: oz + Z.mouth - 5 },
    r: { vaneIn: R_.vaneIn, vaneOut: R_.vaneOut, pocket: R_.pocket, strobe: R_.strobe - 0.7, strobeIn: 2.8, rimIn: R_.rimIn, rimOut: R_.rimOut },
    spoutDeg: SPOUT_DEG,
    gateDeg: GATE_DEG,
    gateHalf: GATE_HALF,
    gateLift: 8.3,
    spout: { start: S0, dir: SD, len: SPOUT_LEN, v: SPOUT_V, lip: LIP, tFall, hand: HAND },
    gravity: GRAVITY,
    funnel: L(FUNNEL[0], FUNNEL[1], 0),
    motor: L(MOTOR[0], MOTOR[1], 0),
    pulleys: { shaft: [5, 1.8], motor: [3.5, 1.3] },
    tach: { frame: TF, s: FACE_S + 0.05, syncAngle, from: -135 * DEG, span: 270 * DEG, syncShare: SYNC_SHARE, r: 3.9 },
    lens: LENS,
    crank: { frame: faceFrame(CRANK_DEG, CZ), s: 38.4 },
    ports: { in: L(0, -32, Z.mouth), out: HAND },
    portsLocal: { in: [0, -32, Z.mouth], out: [HAND[0] - ox, HAND[1] - oy, HAND[2] - oz] },
    origin: [ox, oy, oz],
    slatPeriod: 0.42,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The page side. Stringified into LIVE, so it may only use page globals (kit functions, G, api).
function centrifugeLive(api) {
  const D = api.data;
  const P = api.P;
  const TAU = Math.PI * 2;
  const DEGR = Math.PI / 180;
  const N = D.pockets;
  const ALPHA = TAU / N;
  const [cx, cy] = D.centre;
  const [tx, ty] = D.toward;
  const HOLD = 6;
  const QMAX = 2;
  const GRAV = D.gravity;
  const IDX_TAU = 0.22;
  const PK = D.z.packet;
  // release kinematics: leave the pocket (TA), slide down the spout (TS), fall from the lip to the hand-over (TF)
  const SP = D.spout;
  const TA = 0.28;
  const DECEL = (SP.v[0] * SP.v[0] - SP.v[1] * SP.v[1]) / (2 * SP.len);
  const TS = (SP.v[0] - SP.v[1]) / DECEL;
  const TF = SP.tFall;
  const LEAD = TA + TS + TF;
  const slots = {};
  for (const name of ["rotorBack", "rotorFront", "drop", "intake", "hubtop", "tach", "lamp", "crank", "shaftPulley", "motorPulley", "gate", "spout", "fall"]) slots[name] = api.slot(name);
  const SPOUT = D.spoutDeg * DEGR;
  const GATE = D.gateDeg * DEGR;
  const wrapHalf = (x) => x - Math.round(x);
  const mod = (a, n) => ((a % n) + n) % n;
  const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const burst = (age, rise, fall) => (age < 0 ? 0 : age < rise ? ease(age / rise) : Math.exp(-(age - rise) / fall));
  function settle(s, target, dt, tau, calm) {
    if (calm) {
      s.x = target;
      s.v = 0;
      return;
    }
    const w = 1 / tau;
    const h = dt / 4;
    for (let i = 0; i < 4; i++) {
      s.v += (w * w * (target - s.x) - 2 * w * s.v) * h;
      s.x += s.v * h;
    }
  }
  const at3 = (r, a, z) => [cx + r * Math.cos(a), cy + r * Math.sin(a), z];
  const depth = (r, a) => r * (Math.cos(a) * tx + Math.sin(a) * ty);

  // rotor state: angle A, speed w; index mode settles the angle, spin and down settle the speed
  let A = SPOUT - 0.5 * ALPHA;
  let Ad = A;
  const ang = { x: A, v: 0 };
  const spd = { x: 0, v: 0 };
  let w = 0;
  let mode = "index";
  let target = A;
  let inSync = false;
  let syncFor = 0;
  let lastLanding = -10;
  let phaseWord = "";
  let draining = false;
  const pockets = Array(N).fill(null);
  const reserved = Array(N).fill(false);
  const order = [];
  const queue = [];
  const falling = [];
  const releasing = [];
  let releaseAt = -10;
  let lastDrop = -10;
  let emptyFor = 0;
  let prevRel = null;
  const lampLevel = { x: 0, v: 0 };
  const needle = { x: 0, v: 0 };
  let phaseFn = null;
  let fixedPeriod = null;
  let S = 0;
  let prevP = null;
  let rate = 1 / D.slatPeriod;
  let motorA = 0;

  const pocketAngle = (k) => A + (k + 0.5) * ALPHA;
  const atSpout = () => mod(Math.round((SPOUT - A) / ALPHA - 0.5), N);
  const held = () => pockets.filter(Boolean).length;
  const busy = () => falling.length > 0;
  const restZ = (i) => D.z.head + PK * i;
  const put = (k, item) => {
    pockets[k] = item;
    order.push(k);
  };
  const take = (k) => {
    const item = pockets[k];
    pockets[k] = null;
    const i = order.indexOf(k);
    if (i >= 0) order.splice(i, 1);
    return item;
  };
  const freePocket = () => {
    for (let k = 0; k < N; k++) if (!pockets[k] && !reserved[k]) return k;
    return -1;
  };

  // a packet turned to angle a about the axis, 10 long and 8 wide; z0 its bottom, h its visible height
  function packet(kind, c, a, z0, h, opacity = 1) {
    if (h <= 0.25 || opacity <= 0.01) return "";
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const ring = roundedPlan({ x: -5, y: -4, w: 10, d: 8, r: 0.6 }, 2).map(([u, v]) => [c[0] + u * ca - v * sa, c[1] + u * sa + v * ca]);
    const strap = onTop([[c[0] - 5 * ca, c[1] - 5 * sa], [c[0] + 5 * ca, c[1] + 5 * sa]], z0 + h, P);
    const band = h > PK * 0.55 ? ringSeam(ring, z0 + h - PK * 0.45, P) : "";
    return `<g class="pk" data-kind="${kind}"${opacity < 1 ? ` opacity="${opacity.toFixed(2)}"` : ""}>${solidSvg(extrude(ring, z0, h, P, { bevel: 0.3 }), { tone: "hi" })}${lineSvg(band + strap, { tone: "lo" })}</g>`;
  }
  function vane(a) {
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const t = 0.6;
    const ring = [[D.r.vaneIn, -t], [D.r.vaneOut, -t], [D.r.vaneOut, t], [D.r.vaneIn, t]].map(([u, v]) => [cx + u * ca - v * sa, cy + u * sa + v * ca]);
    return solidSvg(extrude(ring, D.z.pocket, D.z.vane, P), { tone: "mid" });
  }
  // where a released packet is, age seconds after its release began: { stage, pos, a, z }
  function releasePose(r, age) {
    if (age < TA) {
      const rr = age < 0.08 ? D.r.pocket : D.r.pocket + (D.r.rimOut - D.r.pocket) * ((age - 0.08) / (TA - 0.08));
      const a = r.a0 + (GATE - r.a0) * ease(age / TA);
      return { stage: "rotor", pos: at3(rr, a, 0), a, z: D.z.pocket };
    }
    if (age < TA + TS) {
      const t = age - TA;
      const s = SP.v[0] * t - 0.5 * DECEL * t * t;
      const p = G.add3(SP.start, G.mul3(SP.dir, s));
      return { stage: "spout", pos: p, a: GATE, z: p[2] };
    }
    const t = age - TA - TS;
    const h = SP.v[1] * Math.hypot(SP.dir[0], SP.dir[1]);
    const vz = SP.v[1] * SP.dir[2];
    const p = [SP.lip[0] + Math.cos(GATE) * h * t, SP.lip[1] + Math.sin(GATE) * h * t, SP.lip[2] + vz * t - 0.5 * GRAV * t * t];
    return { stage: "fall", pos: p, a: GATE, z: p[2], v: [Math.cos(GATE) * h, Math.sin(GATE) * h, vz - GRAV * t] };
  }

  function drawRotor(now) {
    const parts = [];
    for (let i = 0; i < N; i++) {
      const a = Ad + i * ALPHA;
      parts.push({ d: depth(20.4, a), svg: vane(a) });
      const item = pockets[i];
      if (item) {
        const pa = Ad + (i + 0.5) * ALPHA;
        parts.push({ d: depth(D.r.pocket, pa) + 0.1, svg: packet(item.kind, at3(D.r.pocket, pa, 0), pa, D.z.pocket, PK) });
      }
    }
    let spout = "";
    let fall = "";
    for (const r of releasing) {
      const q = releasePose(r, now - r.t0);
      const svg = packet(r.item.kind, q.pos, q.a, q.z, PK);
      if (q.stage === "rotor") parts.push({ d: depth(Math.hypot(q.pos[0] - cx, q.pos[1] - cy), q.a) + 0.1, svg });
      else if (q.stage === "spout") spout += svg;
      else fall += svg;
    }
    parts.sort((p, q) => p.d - q.d);
    slots.rotorBack.innerHTML = parts.filter((p) => p.d < 0).map((p) => p.svg).join("");
    slots.rotorFront.innerHTML = parts.filter((p) => p.d >= 0).map((p) => p.svg).join("");
    slots.spout.innerHTML = spout;
    slots.fall.innerHTML = fall;
  }
  function drawStrobe() {
    let d = "";
    // ten dark sectors of half a pocket each: the pattern repeats every pocket, so it looks the same at every quantum
    for (let i = 0; i < N; i++) {
      const a0 = Ad + i * ALPHA;
      const pts = [];
      for (let j = 0; j <= 4; j++) pts.push(at3(D.r.strobe - 0.3, a0 + (ALPHA * j) / 8, 0).slice(0, 2));
      for (let j = 4; j >= 0; j--) pts.push(at3(D.r.strobeIn + 0.3, a0 + (ALPHA * j) / 8, 0).slice(0, 2));
      d += onTop(pts, D.z.strobe, P, true);
    }
    slots.hubtop.innerHTML = `<path class="cf-strobe" d="${d}"/>`;
  }
  function spokes(c, z, [rim, hub], a) {
    let d = "";
    for (let i = 0; i < 4; i++) {
      const t = a + (i * Math.PI) / 2;
      d += onTop([[c[0] + Math.cos(t) * hub, c[1] + Math.sin(t) * hub], [c[0] + Math.cos(t) * rim, c[1] + Math.sin(t) * rim]], z, P);
    }
    return lineSvg(d, { tone: "lo" });
  }
  function drawTach(share) {
    const T = D.tach;
    const a = T.from + T.span * Math.min(1, Math.max(0, share * T.syncShare));
    const p = (r, t) => iso(G.pointOf(T.frame, T.s, r, t), P);
    const d = pathOf([p(0.9, a + Math.PI), p(T.r, a)]);
    slots.tach.innerHTML = `<g class="it fx-graphite"><path class="iso-line" data-tone="hi" data-free="" style="stroke-width:1" d="${d}"/>${dotsSvg([p(0, 0)], { size: 0.8, tone: "hi" })}</g>`;
  }
  function drawLamp(level) {
    if (level < 0.01) {
      slots.lamp.innerHTML = "";
      return;
    }
    const c = iso(D.lens, P);
    const k = api.KS;
    slots.lamp.innerHTML = `<circle class="cf-glow-soft" cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="${(k * (2.4 + 3.2 * level)).toFixed(2)}" opacity="${(0.35 * level).toFixed(3)}"/><circle class="cf-glow" cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="${(k * 1.6).toFixed(2)}" opacity="${(0.85 * Math.min(1, level)).toFixed(3)}"/>`;
  }
  function drawCrank(kick) {
    const F = D.crank.frame;
    const phi = (25 - 60 * kick) * DEGR;
    const pivot = G.pointOf(F, D.crank.s, 0, 0);
    const d = G.add3(G.mul3(F.u, Math.cos(phi)), G.mul3(F.v, Math.sin(phi)));
    const AF = G.frameAlong(pivot, d);
    const tip = G.add3(pivot, G.mul3(d, 7.4));
    const HF = G.frameAlong(pivot, F.a);
    slots.crank.innerHTML = solidSvg(G.disc(0, 7, 0.75, AF, P), { tone: "mid" }) + solidSvg(G.sphereOf(tip, 1.4, P, { steps: 24 }), { tone: "mid" }) + solidSvg(G.disc(-0.8, 1, 1.3, HF, P), { tone: "mid" });
  }
  function drawGate(open) {
    const a0 = (D.gateDeg - D.gateHalf + 0.4) * DEGR;
    const a1 = (D.gateDeg + D.gateHalf - 0.4) * DEGR;
    const r0 = D.r.rimOut + 0.1;
    const r1 = D.r.rimOut + 0.9;
    const n = 6;
    const ring = [...Array.from({ length: n + 1 }, (_, i) => at3(r1, a0 + ((a1 - a0) * i) / n, 0).slice(0, 2)), ...Array.from({ length: n + 1 }, (_, i) => at3(r0, a1 - ((a1 - a0) * i) / n, 0).slice(0, 2))];
    const z = D.z.pocket + 0.05 + D.gateLift * open;
    const mid = (r0 + r1) / 2;
    slots.gate.innerHTML = solidSvg(extrude(ring, z, 4.5, P, { convex: false }), { tone: "mid" }) + dotsSvg([iso(at3(mid, GATE - 0.07, z + 4.5), P), iso(at3(mid, GATE + 0.07, z + 4.5), P)], { size: 0.36 });
  }
  function drawFunnel(now) {
    let drop = "";
    let top = "";
    for (const f of falling) {
      const z = Math.max(D.z.pocket, f.z0 - 0.5 * GRAV * (now - f.t0) ** 2);
      drop += packet(f.item.kind, D.funnel, SPOUT, z, PK);
      if (z + PK > D.z.mouth) top += packet(f.item.kind, D.funnel, SPOUT, D.z.mouth, z + PK - D.z.mouth);
    }
    slots.drop.innerHTML = drop;
    // the queue: parcels arcing in, then resting in the throat (only what stands above the mouth plane shows)
    for (const q of queue) {
      let pos;
      let opacity = 1;
      let a = 0;
      if (q.arc) {
        const t = Math.min(1, (now - q.arc.t0) / q.arc.dur);
        pos = api.lerp3(q.arc.from, q.arc.to, t);
        pos[2] += 6 * Math.sin(Math.PI * t);
        if (q.arc.fade) opacity = Math.min(1, (now - q.arc.t0) / 0.18);
      } else {
        pos = [D.funnel[0], D.funnel[1], q.z];
        a = SPOUT;
      }
      const z0 = Math.max(pos[2], D.z.mouth);
      top += packet(q.item.kind, pos, a, z0, pos[2] + PK - z0, opacity);
    }
    slots.intake.innerHTML = top;
  }

  // drop the head of the queue so that it lands in pocket k
  function dropInto(k, now) {
    const q = queue.shift();
    reserved[k] = true;
    falling.push({ item: q.item, k, t0: now, z0: q.z, fall: Math.sqrt((2 * (q.z - D.z.pocket)) / GRAV) });
    lastDrop = now;
  }
  const fallOf = (q) => Math.sqrt((2 * Math.max(0, q.z - D.z.pocket)) / GRAV);
  const resting = (q) => q && !q.arc && Math.abs(q.z - restZ(0)) < 0.3 && q.vz === 0;
  function release(k, now) {
    releasing.push({ item: take(k), t0: now, a0: pocketAngle(k) });
    releaseAt = now;
  }
  function setPhase(word) {
    if (word !== phaseWord) {
      phaseWord = word;
      api.announce(word);
    }
  }
  let releaseGate = null;
  function readPhase() {
    if (!phaseFn) return { phase: (api.now() / D.slatPeriod) % 1, period: D.slatPeriod };
    const q = phaseFn();
    return typeof q === "number" ? { phase: q, period: fixedPeriod } : { phase: q.phase, period: q.period ?? fixedPeriod };
  }

  return {
    // fn() returns the audio belt's quantum phase (0..1, wrapping once per cleat gap) or { phase, period }
    // (e.g. the conveyor's quanta()); period, when known, sets the rotor speed and the release lead exactly
    syncTo(fn, period) {
      phaseFn = fn;
      fixedPeriod = period ?? null;
    },
    // fn(lead) → true when the receiver can take a packet that reaches it "lead" seconds after the gate opens
    releaseWhen(fn) {
      releaseGate = fn;
    },
    canAccept() {
      return queue.length < QMAX;
    },
    status() {
      return { held: held(), rpm: api.calm() ? 0 : (Math.max(0, w) * 60) / TAU, phase: phaseWord, queued: queue.length, inSync, full: queue.length >= QMAX, lead: LEAD };
    },
    accept(port, item, from) {
      const to = [D.funnel[0], D.funnel[1], D.z.mouth + 1];
      const i = queue.length;
      if (api.calm()) {
        queue.push({ item, z: restZ(i), vz: 0, arc: null });
        return;
      }
      queue.push({ item, z: to[2], vz: 0, arc: { from: from ?? [to[0], to[1], to[2] + 12], to, t0: api.now(), dur: from ? 0.32 : 0.22, fade: !from } });
    },
    tick(dt, now) {
      const calm = api.calm();
      // the belt's quantum phase, unwrapped into S; one pulse per quantum
      const ph = readPhase();
      let dp = prevP === null ? 0 : ph.phase - prevP;
      if (dp < -0.5) dp += 1;
      if (dp > 0.5) dp -= 1;
      prevP = ph.phase;
      const Sprev = S;
      S += dp;
      if (ph.period) rate = 1 / ph.period;
      else if (dt > 0) rate += (dp / dt - rate) * (1 - Math.exp(-dt / 0.4));
      const pulse = Math.floor(S) > Math.floor(Sprev);
      const period = 1 / Math.max(0.1, rate);

      // the queue: arcs end in the mouth, parcels fall to their resting place (head at the throat, the next on top)
      queue.forEach((q, i) => {
        if (q.arc && now - q.arc.t0 >= q.arc.dur) {
          q.arc = null;
          q.vz = 0;
          q.ready = now + 0.1;
        }
        if (q.arc) return;
        const rest = restZ(i);
        if (calm) {
          q.z = rest;
          q.vz = 0;
        } else if (q.z > rest + 1e-3) {
          q.vz -= GRAV * dt;
          q.z += q.vz * dt;
          if (q.z <= rest) {
            q.z = rest;
            q.vz = 0;
          }
        } else {
          q.z = rest;
          q.vz = 0;
        }
      });

      if (calm) {
        // reduced motion: no arcs or falls; the ring takes and passes packets in place, the rotor stands still
        for (const f of falling.splice(0)) {
          reserved[f.k] = false;
          put(pockets[f.k] ? Math.max(0, freePocket()) : f.k, f.item);
        }
        for (const r of releasing.splice(0)) api.emit("out", r.item, D.ports.out);
        while (queue.length && freePocket() >= 0) {
          put(freePocket(), queue.shift().item);
          lastLanding = now;
        }
        if (!draining && (held() >= HOLD || (held() > 0 && now - lastLanding > 4))) draining = true;
        // one packet per quantum, timed by the clock (the belt may be standing still under reduced motion too)
        const beat = Math.floor(now / period) > Math.floor((now - dt) / period);
        if (draining && beat && order.length) api.emit("out", take(order[0]), D.ports.out);
        if (draining && !held()) draining = false;
        mode = "index";
        w = 0;
        spd.x = 0;
        ang.v = 0;
        inSync = false;
        setPhase(draining ? "passing packets" : held() || queue.length ? "filling" : "idle");
      } else {
        draining = false;
        // falling packets land in their pocket
        for (let i = falling.length - 1; i >= 0; i--) {
          const f = falling[i];
          if (now - f.t0 >= f.fall) {
            falling.splice(i, 1);
            let k = f.k;
            const lead = wrapHalf((SPOUT - pocketAngle(k)) / TAU) * N;
            if (Math.abs(lead) > 0.5 || pockets[k]) {
              const near = atSpout();
              if (!pockets[near]) k = near;
            }
            reserved[f.k] = false;
            put(k, f.item);
            lastLanding = now;
          }
        }
        // released packets are handed on as they fall past z 100 below the spout lip, still falling
        for (let i = releasing.length - 1; i >= 0; i--) {
          const q = releasePose(releasing[i], now - releasing[i].t0);
          if (q.stage === "fall" && q.z <= SP.hand[2]) {
            const r = releasing.splice(i, 1)[0];
            api.emit("out", { ...r.item, v: q.v }, [q.pos[0], q.pos[1], q.z]);
          }
        }

        const syncW = ALPHA * rate;
        // the release starts with the pocket a little before the gate, so the packet is centred on it as it leaves
        const delta = (w * TA) / 2;
        const uRel = (A - (GATE - delta)) / ALPHA + 0.5;
        const e = wrapHalf(S + LEAD / period - uRel);
        if (mode === "index") {
          const head = resting(queue[0]) && queue[0].ready <= now ? queue[0] : null;
          if (head && head.want === undefined && !busy()) {
            let best = null;
            for (let k = 0; k < N; k++) {
              if (pockets[k] || reserved[k]) continue;
              const ahead = mod(SPOUT - pocketAngle(k), TAU);
              const need = ahead > TAU - 0.02 ? 0 : ahead;
              if (best === null || need < best.need) best = { k, need };
            }
            if (best) {
              head.want = best.k;
              target = A + best.need;
            }
          }
          if (head && head.want !== undefined && !busy()) {
            const FALL = fallOf(head);
            const e0 = A - target;
            const eLand = (e0 + (ang.v + e0 / IDX_TAU) * FALL) * Math.exp(-FALL / IDX_TAU);
            if (Math.abs(eLand) < 0.02) dropInto(head.want, now);
          }
          const idle = !queue.length && !busy() && !reserved.some(Boolean);
          if (idle) target += 0.12 * dt;
          ang.x = A;
          settle(ang, target, dt, IDX_TAU, false);
          A = ang.x;
          w = ang.v;
          const quiet = now - lastLanding > 4;
          if (!busy() && !reserved.some(Boolean) && (held() >= HOLD || (held() > 0 && quiet && !queue.length))) {
            mode = "spin";
            spd.x = w;
            spd.v = 0;
          }
          setPhase(held() || queue.length ? "filling" : "idle");
        } else if (mode === "spin") {
          const rel = Math.abs(w - syncW) / syncW;
          const lock = ease((0.18 - rel) / 0.12);
          settle(spd, syncW + ALPHA * 1.4 * e * lock, dt, 0.4, false);
          w = spd.x;
          A += w * dt;
          syncFor = rel < 0.04 && Math.abs(e) < 0.05 ? syncFor + dt : 0;
          if (!inSync && syncFor > 0.35) inSync = true;
          if (inSync && (Math.abs(e) > 0.15 || rel > 0.12)) inSync = false;
          const uNow = (A - (GATE - (w * TA) / 2)) / ALPHA + 0.5;
          if (inSync && prevRel !== null && Math.floor(uNow) > Math.floor(prevRel)) {
            const k = mod(-Math.round(uNow), N);
            // backpressure from the receiver: with no room at the landing point the packet stays in its pocket
            // and comes round again (the ring keeps it; nothing is dropped)
            if (pockets[k] && (!releaseGate || releaseGate(LEAD))) release(k, now);
          }
          prevRel = uNow;
          if (inSync) {
            // queued packets drop in timed to land as a free pocket passes under the spout
            const head = resting(queue[0]) ? queue[0] : null;
            if (head && now - lastDrop > 0.2) {
              const FALL = fallOf(head);
              const us = (A - SPOUT) / ALPHA + 0.5;
              const per = w / ALPHA;
              for (let n = Math.ceil(us + per * FALL + 1e-6); n < us + per * FALL + N; n++) {
                const k = mod(-n, N);
                if (pockets[k] || reserved[k]) continue;
                if ((n - us) / per - FALL <= dt) dropInto(k, now);
                break;
              }
            }
            setPhase("in sync");
          } else setPhase("spinning up");
          emptyFor = !held() && !busy() && !queue.length && !releasing.length ? emptyFor + dt : 0;
          if (inSync && emptyFor > 0.6) {
            mode = "down";
            inSync = false;
            prevRel = null;
          }
        } else {
          settle(spd, 0, dt, 0.7, false);
          w = spd.x;
          A += w * dt;
          setPhase("spinning down");
          if (w < 0.5) {
            mode = "index";
            ang.x = A;
            ang.v = w;
            const coast = A + w * IDX_TAU;
            const base = SPOUT - 0.5 * ALPHA;
            target = base + Math.ceil((coast - base) / ALPHA) * ALPHA;
          }
        }
      }

      Ad = calm ? SPOUT - 0.5 * ALPHA : A;
      motorA = calm ? 0 : motorA + w * (5.5 / 4) * dt;
      const age = now - releaseAt;
      const open = calm ? 0 : age < 0 ? 0 : age < 0.08 ? ease(age / 0.08) : age < TA + 0.12 ? 1 : 1 - ease((age - TA - 0.12) / 0.25);
      settle(lampLevel, inSync || draining ? 0.45 : 0, dt, 0.25, calm);
      settle(needle, calm ? 0 : w / (ALPHA * rate), dt, 0.25, calm);
      drawRotor(now);
      drawFunnel(now);
      drawStrobe();
      drawGate(open);
      slots.shaftPulley.innerHTML = spokes(D.centre, D.z.pulley, D.pulleys.shaft, Ad);
      slots.motorPulley.innerHTML = spokes(D.motor, D.z.pulley, D.pulleys.motor, motorA);
      drawTach(needle.x);
      drawLamp(Math.min(1.2, lampLevel.x + (calm ? 0 : 0.5 * burst(age, 0.05, 0.2))));
      drawCrank(open);
    },
  };
}

export const LIVE = `MACHINES.centrifuge = ${centrifugeLive.toString()};`;
