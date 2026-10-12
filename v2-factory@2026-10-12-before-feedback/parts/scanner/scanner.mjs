// Scanner: a hard-disk read arm behind the audio belt. It is the platform audio callback (CoreAudio / Oboe): the head
// tracks each slat (one 128-frame render quantum) for a moment, flies back to the next one, and every read runs a pulse
// down the flex cable to the preamp. Four reads fill one device buffer (512 frames), and the preamp pushes one mint
// `audio` packet onto belt D.
// Local frame: `origin` is the foot of the arm's pivot axis on the floor (see NOTES.md for parts and ports).
import { k, G, A } from "../../shared/kit.mjs";
import { bar, pulseCable, faceScrews } from "./helpers.mjs";

export const GEOMETRY = {
  pivot: [-30, 32],
  armZ: [94.5, 96],
  headReach: 30.5,
  track: 9,
  belt: { y: 74, top: 92, farEdge: 61 },
  preamp: { x0: -116, x1: -98, y0: 39, y1: 53, z0: 16, z1: 30 },
  out: [-107, 37, 24],
};

// Internally the geometry is written in a design frame whose pivot foot is REF; build() shifts it onto `origin`.
const REF = [-30, 32, 0];
export function build(ctx, origin = REF, opts = {}) {
  const id = opts.id ?? "scanner";
  const [ox, oy, oz] = [origin[0] - REF[0], origin[1] - REF[1], origin[2] - REF[2]];
  const { P, S, Ln, Dots } = ctx;
  const W = (x, y, z) => [x + ox, y + oy, z + oz];
  const n = (s) => `${id}.${s}`;
  const [PVX, PVY] = GEOMETRY.pivot;
  const pv = [PVX + ox, PVY + oy];
  const polar = (r, deg) => [pv[0] + r * Math.sin(((deg + 180) * Math.PI) / 180), pv[1] + r * Math.cos(((deg + 180) * Math.PI) / 180)];
  const plan = (x0, y0, x1, y1, r = 0.6) => ({ x: x0 + ox, y: y0 + oy, w: x1 - x0, d: y1 - y0, r });

  // ---- base: floor plate on levelling feet, label plate
  ctx.material = "";
  const BASE = plan(-46, 6, -12, 40, 3);
  for (const [x, y] of k.corners(BASE, 4)) ctx.cyl(n("foot"), x, y, 2.4, oz, 2, { tone: "lo" }, { steps: 20, bevel: 0.2 });
  ctx.slab(n("plate"), BASE, oz + 2, 4, { tone: "lo" }, { steps: 6, bevel: 0.8, inner: Ln(k.sideSeam(BASE, oz + 4, P, 6), { tone: "faint" }), extra: Ln(k.planOutline(k.insetPlan(BASE, 2.6), oz + 6, P, 6), { tone: "faint" }) + ctx.screws(k.corners(BASE, 4.2), oz + 6) });
  const LABEL = plan(-22, 31, -14.5, 37.5, 0.6);
  ctx.slab(n("label"), LABEL, oz + 6, 0.6, { tone: "mid" }, { steps: 3, extra: Ln(k.planOutline(k.insetPlan(LABEL, 1), oz + 6.6, P, 3), { tone: "faint" }) + Ln([0, 1, 2].map((i) => k.lineOnTop([LABEL.x + 2, LABEL.y + 2 + i * 1.3], [LABEL.x + 2 + [4.2, 3.2, 2.2][i], LABEL.y + 2 + i * 1.3], oz + 6.6, P)).join(""), { tone: "lo", free: true }) + Dots([ctx.at([LABEL.x + 1, LABEL.y + LABEL.d - 1, oz + 6.6])], { size: 0.35 }) });

  // ---- pedestal: flange, turned column with seam rings, four gusset ribs, cap flange
  const CX = -29 + ox;
  const CY = 23 + oy;
  ctx.cyl(n("column.flange"), CX, CY, 8.5, oz + 6, 2.5, { tone: "mid" }, { steps: 40, bevel: 0.4, extra: ctx.screws([0, 1, 2, 3, 4, 5].map((i) => [CX + 7 * Math.cos((i * Math.PI) / 3 + 0.5), CY + 7 * Math.sin((i * Math.PI) / 3 + 0.5)]).filter(([x, y]) => (x - CX) + (y - CY) > -4), oz + 8.5, { ring: 0.8, size: 0.35 }) });
  for (const deg of [45, 135, 225, 315]) {
    const a = (deg * Math.PI) / 180;
    const F = { o: [CX, CY, oz + 8.5], a: [-Math.sin(a), Math.cos(a), 0], u: [Math.cos(a), Math.sin(a), 0], v: [0, 0, 1] };
    const poly = [[6, 0], [8.4, 0], [6, 9]];
    ctx.put(n("column.rib"), [CX + 7 * Math.cos(a), CY + 7 * Math.sin(a), oz + 11], S(G.prismOf(F, poly, -0.6, 0.6, P), { tone: "mid" }), [ctx.record(A.prism(F, poly, -0.6, 0.6, { name: n("column.rib") }))]);
  }
  ctx.cyl(n("column"), CX, CY, 6, oz + 8.5, 69.5, { tone: "mid" }, { steps: 40, inner: Ln(k.sideArc(CX, CY, 6, oz + 34, P, 28) + k.sideArc(CX, CY, 6, oz + 58, P, 28), { tone: "faint" }) });
  ctx.cyl(n("column.cap"), CX, CY, 8, oz + 78, 2, { tone: "mid" }, { steps: 40, bevel: 0.3 });

  // ---- deck casting
  const DECK = plan(-46, 6, -12, 40, 3);
  ctx.slab(n("deck"), DECK, oz + 80, 6, { tone: "mid" }, { steps: 6, bevel: 1, inner: Ln(k.sideSeam(DECK, oz + 82.5, P, 6), { tone: "faint" }), extra: Ln(k.planOutline(k.insetPlan(DECK, 2.4), oz + 86, P, 6), { tone: "faint" }) + ctx.screws(k.corners(DECK, 4), oz + 86) });

  // ---- pivot: base flange and bearing cartridge (the hub, arm and clamp nut are live)
  ctx.material = "fx-graphite";
  ctx.cyl(n("pivot.base"), pv[0], pv[1], 4.6, oz + 86, 2, { tone: "mid" }, { steps: 32, bevel: 0.3, extra: ctx.screws([0, 1, 2].map((i) => [pv[0] + 3.4 * Math.cos(i * 2.09 + 0.9), pv[1] + 3.4 * Math.sin(i * 2.09 + 0.9)]), oz + 88, { ring: 0.6, size: 0.3 }) });
  ctx.cyl(n("pivot.cartridge"), pv[0], pv[1], 3, oz + 88, 6, { tone: "mid" }, { steps: 28, inner: Ln(k.sideArc(pv[0], pv[1], 3, oz + 91, P, 20), { tone: "faint" }) });

  // ---- voice-coil motor: kidney plates (bottom on the deck, top on three standoffs), magnets, crash stops
  const sector = (r0, r1, a0, a1, count = 4) => [polar(r0, a0), ...Array.from({ length: count + 1 }, (_, i) => polar(r1, a0 + ((a1 - a0) * i) / count)), polar(r0, a1)];
  const PLATE = sector(7, 19.5, -46, 46, 6);
  ctx.prism(n("vcm.bottom"), PLATE, oz + 86, 2.5, { tone: "mid" }, { extra: ctx.screws([polar(17.5, -30), polar(17.5, 30)], oz + 88.5, { ring: 0.7, size: 0.3 }) });
  ctx.prism(n("vcm.magnet"), sector(9, 16, -30, -1, 3), oz + 88.5, 1.5, { tone: "lo" });
  ctx.prism(n("vcm.magnet"), sector(9, 16, 1, 30, 3), oz + 88.5, 1.5, { tone: "lo" });
  for (const [r, a] of [[16.5, -41], [16.5, 41], [18.2, 0]]) {
    const [x, y] = polar(r, a);
    ctx.cyl(n("vcm.standoff"), x, y, 1.1, oz + 88.5, 10, { tone: "mid" }, { steps: 16 });
  }
  for (const a of [-39, 39]) {
    const [x, y] = polar(12.5, a);
    ctx.cyl(n("vcm.stop"), x, y, 0.8, oz + 90, 8.5, { tone: "lo" }, { steps: 14 });
  }
  ctx.prism(n("vcm.top"), PLATE, oz + 98.5, 2.5, { tone: "mid" }, { extra: ctx.screws([polar(16.5, -41), polar(16.5, 41), polar(18.2, 0)], oz + 101, { ring: 0.8, size: 0.32 }) });
  ctx.slot(`${id}:coil`, { before: n("vcm.top") });

  // ---- flex bracket on the deck (the ribbon lands on its +y face; the round cable leaves its +x face)
  ctx.material = "";
  ctx.box(n("flex.bracket"), W(-16, 28, 86), W(-11, 37, 96.5), { tone: "mid" }, { r: 0.5, bevel: 0.3, extra: faceScrews(ctx, [W(-14.2, 37, 94.6), W(-12.8, 37, 94.6)], "y", { ring: 0.5, size: 0.3 }) });
  const BOSS = ctx.boss(n("flex.boss"), W(-11, 32.5, 90), [1, 0, 0], 1.5, 1.6, { tone: "mid" });

  // ---- park ramp: cantilevered from the deck front, its tongue reaching over the belt's far margin
  // (post kept at local y <= +23 so it clears the audio belt's far truss chord; the tongue cantilevers over it)
  ctx.box(n("ramp.bar"), W(-16, 40, 85), W(-14, 51, 88), { tone: "mid" }, { r: 0.3 });
  ctx.box(n("ramp.post"), W(-17, 51, 85), W(-13, 55, 96), { tone: "mid" }, { r: 0.4, bevel: 0.3 });
  ctx.box(n("ramp"), W(-16.6, 55, 94.2), W(-13.4, 63.5, 96), { tone: "hi" }, { r: 0.3, bevel: 0.2 });
  ctx.slot(`${id}:arm`, { after: n("ramp") });

  // ---- status lamp (the one lit accent): base and lens on the graphite VCM top plate, where the lit style reads
  const LAMP = polar(11.5, 24);
  ctx.material = "fx-graphite";
  ctx.cyl(n("lamp.base"), LAMP[0], LAMP[1], 1.6, oz + 101, 1.2, { tone: "mid" }, { steps: 20, bevel: 0.2 });
  ctx.material = "";
  {
    const c = [LAMP[0], LAMP[1], oz + 103.8];
    ctx.put(n("lamp.lens"), c, S(G.sphereOf(c, 1.7, P), { tone: "hi", lit: true }), [ctx.record(A.ball(c, 1.7, { name: n("lamp.lens") }))]);
  }
  ctx.slot(`${id}:lamp`, { after: n("lamp.lens") });

  // ---- preamp on four legs; fins on its +y face; input boss and a 4-cell buffer window on its +x face
  ctx.material = "fx-graphite";
  const PA = GEOMETRY.preamp;
  const PB = plan(PA.x0, PA.y0, PA.x1, PA.y1, 1);
  for (const [x, y] of k.corners(PB, 2)) {
    ctx.cyl(n("preamp.pad"), x, y, 1.9, oz, 1, { tone: "lo" }, { steps: 16 });
    ctx.cyl(n("preamp.leg"), x, y, 1.1, oz + 1, PA.z0 - 1, { tone: "mid" }, { steps: 14 });
  }
  const WIN = { y0: 40.4 + oy, y1: 48.4 + oy, z0: 22 + oz, z1: 27 + oz };
  const winLine = Ln(k.pathOf([[PA.x1 + ox, WIN.y0, WIN.z0], [PA.x1 + ox, WIN.y1, WIN.z0], [PA.x1 + ox, WIN.y1, WIN.z1], [PA.x1 + ox, WIN.y0, WIN.z1]].map(ctx.at), true), { tone: "lo" });
  ctx.slab(n("preamp.box"), PB, oz + PA.z0, PA.z1 - PA.z0, { tone: "mid" }, { steps: 4, bevel: 0.6, inner: Ln(k.sideSeam(PB, oz + PA.z1 - 2, P, 4), { tone: "faint" }), extra: winLine + faceScrews(ctx, [W(PA.x1, 51.2, 18), W(PA.x1, 41, 18.6)], "x", { ring: 0.5, size: 0.28 }) });
  ctx.slot(`${id}:buffer`, { after: n("preamp.box") });
  ctx.slot(`${id}:out`, { before: n("preamp.box") });
  const LID = plan(PA.x0 + 0.8, PA.y0 + 0.8, PA.x1 - 0.8, PA.y1 - 0.8, 0.8);
  ctx.slab(n("preamp.lid"), LID, oz + PA.z1, 1.2, { tone: "mid" }, { steps: 4, bevel: 0.3, extra: ctx.screws(k.corners(LID, 1.6), oz + PA.z1 + 1.2, { ring: 0.6, size: 0.3 }) });
  for (let i = 0; i < 7; i++) {
    const x = PA.x0 + 2.2 + i * 2.25;
    ctx.box(n("preamp.fin"), W(x, PA.y1, 18), W(x + 0.8, PA.y1 + 1.8, 28.4), { tone: "mid" }, { r: 0.2 });
  }
  const IN = ctx.boss(n("preamp.in"), W(PA.x1, 51, 24), [1, 0, 0], 1.6, 2, { tone: "mid" });
  ctx.box(n("preamp.lip"), W(-112.5, GEOMETRY.out[1] - 4, 23), W(-101.5, PA.y0, 24), { tone: "mid" }, { r: 0.3 });

  // ---- round cable from the flex bracket down to the floor and along to the preamp input
  ctx.material = "";
  const CABLE = n("cable");
  const cableRoute = pulseCable(ctx, CABLE, [BOSS, W(-6, 32.5, 90), W(-6, 32.5, 46), W(-6, 44, 46), W(-6, 44, 2.6), W(-88, 44, 2.6), W(-88, 51, 2.6), W(-88, 51, 24), IN], 0.9, { bend: 4, maxLength: 9 });

  ctx.data[id] = {
    origin: [ox, oy, oz],
    pivot: pv,
    armZ: GEOMETRY.armZ.map((z) => z + oz),
    reach: GEOMETRY.headReach,
    track: GEOMETRY.track,
    bracket: W(-13.5, 37, 0),
    flexZ: [92.4 + oz, 95.6 + oz],
    lamp: [LAMP[0], LAMP[1], oz + 103.8],
    oz,
    belt: opts.belt ?? "audio",
    cable: CABLE,
    cableLen: G.pathLength(cableRoute),
    preamp: { x: -107 + ox, y0: PA.y0 + oy, face: PA.x1 + ox, win: WIN, lipZ: 24 + oz, outY: GEOMETRY.out[1] + oy },
    ports: { out: W(...GEOMETRY.out), read: W(PVX, GEOMETRY.belt.farEdge + 2, GEOMETRY.belt.top) },
  };
}


export const LIVE = `
MACHINES.scanner = (api) => {
  const D = api.data;
  const P = api.P;
  const g = { coil: api.slot("coil"), arm: api.slot("arm"), lamp: api.slot("lamp"), out: api.slot("out"), buffer: api.slot("buffer") };
  const SEEK = 0.16, SPEED = 140, PER_PACKET = 4;
  const chunks = api.els('[data-route="' + D.cable + '"]').map((el) => {
    const [a, b] = el.dataset.span.split(",").map(Number);
    return { el: el.querySelector(".fx-pulse"), a, b, on: 0 };
  });
  const cableLen = D.cableLen;
  let ribbonLen = 40;
  const [px, py] = D.pivot;
  const [z0, z1] = D.armZ;
  const hx0 = px;
  let head = hx0, lock = null, seekFrom = null, seekAt = -9, readAt = -9;
  const pulses = [];
  const outgoing = [];
  let buffered = 0;
  const levels = [0, 0, 0, 0];
  const self = { reads: 0, packets: 0 };
  const S = (paths, style) => solidSvg(paths, style);
  const pts = (list) => list.map((p) => iso(p, P));
  const poly = (list) => "M" + pts(list).map(([x, y]) => x.toFixed(2) + " " + y.toFixed(2)).join("L") + "Z";

  // the belt being read (opts.belt, default "audio"): one cleat gap = one 128-frame render quantum. Prefers the belt's
  // quanta() (cleat positions), falls back to geometry() + slatPhase() (the conveyor's own path maths), then to slats().
  function cleats() {
    const belt = FACTORY.machines[D.belt];
    if (!belt) return null;
    const g = belt.geometry ? belt.geometry() : null;
    const loop = g ? 2 * g.L + 2 * Math.PI * g.RW : 0;
    const gapOf = () => (g ? (g.cleatGap ?? loop / Math.floor(loop / (g.pitch * g.cleatEvery))) : belt.pitch || 12);
    if (belt.quanta) {
      const q = belt.quanta();
      const xs = q.cleats.filter((c) => c.run === "top").map((c) => c.pos[0]);
      return { xs, gap: gapOf(), dir: g ? g.dir : -1, axis: g ? g.axis : "x" };
    }
    if (g && belt.slatPhase) {
      const gap = gapOf(), sTail = g.dir > 0 ? 0 : g.L, travel = belt.slatPhase() * g.pitch, xs = [];
      for (let i = 0; i < Math.round(loop / gap); i++) {
        const u = (((i * gap + travel) % loop) + loop) % loop;
        if (u < g.L) xs.push(g.origin[0] + sTail + g.dir * u);
      }
      return { xs, gap, dir: g.dir, axis: g.axis };
    }
    if (belt.slats) return { xs: belt.slats(), gap: belt.pitch || 12, dir: -1, axis: "x" };
    return null;
  }
  const nearest = (list, x) => list.reduce((best, v) => (Math.abs(v - x) < Math.abs(best - x) ? v : best), list[0]);

  function armAt(theta) {
    const a = [Math.sin(theta), Math.cos(theta)], c = [Math.cos(theta), -Math.sin(theta)];
    const L = (s, cc) => [px + a[0] * s + c[0] * cc, py + a[1] * s + c[1] * cc];
    const ring = (list) => list.map(([s, cc]) => L(s, cc));
    const atZ = (p, z) => [p[0], p[1], z];
    // coil and fork (drawn under the VCM top plate)
    const coilRing = [180 - 17, 180 + 17].flatMap((d, i) => {
      const r = i ? [16, 9] : [9, 16];
      return r.map((rr) => [px + rr * Math.sin(theta + (d * Math.PI) / 180), py + rr * Math.cos(theta + (d * Math.PI) / 180)]);
    });
    const coilIn = [180 - 9, 180 + 9].flatMap((d, i) => {
      const r = i ? [14, 11] : [11, 14];
      return r.map((rr) => [px + rr * Math.sin(theta + (d * Math.PI) / 180), py + rr * Math.cos(theta + (d * Math.PI) / 180), D.oz + 96.5]);
    });
    const coil = '<g class="it fx-graphite">' + S(extrude(ring([[-3.4, -2.6], [-9.6, -2.2], [-9.6, 2.2], [-3.4, 2.6]]), z0, z1 - z0, P), { tone: "mid" }) + '</g>' +
      '<g class="it">' + S(extrude(coilRing, D.oz + 91, 5.5, P), { tone: "hi", inner: lineSvg(poly(coilIn), { tone: "lo" }) }) + '</g>';
    // arm, slots, trace, load beam, slider, hub and clamp nut
    const slotA = [[7, -1.3], [12, -1.05], [12, 1.05], [7, 1.3]].map(([s, cc]) => atZ(L(s, cc), z1));
    const slotB = [[14, -0.95], [18, -0.75], [18, 0.75], [14, 0.95]].map(([s, cc]) => atZ(L(s, cc), z1));
    const t0 = atZ(L(5, 2.1), z1), t1 = atZ(L(21.5, 0.8), z1);
    const armSvg = S(extrude(ring([[2, -3.6], [23, -1.2], [23, 1.2], [2, 3.6]]), z0, z1 - z0, P), { tone: "hi", inner: lineSvg(poly(slotA) + poly(slotB), { tone: "lo" }) + lineSvg("M" + pts([t0, t1]).map(([x, y]) => x.toFixed(2) + " " + y.toFixed(2)).join("L"), { tone: "faint" }) + dotsSvg(pts([t0, t1]), { size: 0.32, tone: "mid" }) });
    const beam = S(extrude(ring([[22.4, -1.1], [29.6, -0.55], [29.6, 0.55], [22.4, 1.1]]), D.oz + 95.0, 0.4, P), { tone: "mid" });
    const sl = L(D.reach, 0);
    const slider = S(extrude(ring([[D.reach - 0.8, -0.9], [D.reach + 0.8, -0.9], [D.reach + 0.8, 0.9], [D.reach - 0.8, 0.9]]), D.oz + 93.6, 1.4, P), { tone: "hi" });
    const hub = S(cylinder(px, py, 4.2, D.oz + 94, 2.5, P, 28), { tone: "mid" });
    const nut = S(cylinder(px, py, 2.6, D.oz + 96.5, 1.5, P, 6), { tone: "mid" }) + dotsSvg(pts([[px, py, D.oz + 98]]), { size: 0.4 });
    return { coil, arm: '<g class="it">' + armSvg + beam + slider + '</g><g class="it fx-graphite">' + hub + nut + '</g>', attach: [L(1.5, 4.4), a], head: sl };
  }

  // flex ribbon: a vertical strip from the arm's side to the bracket's +y face, as a cubic in plan
  function ribbon(attach, dir) {
    const [A0, a] = [attach, dir];
    const B = D.bracket;
    const P1 = [A0[0] + a[0] * 7, A0[1] + a[1] * 7], P2 = [B[0], B[1] + 7];
    const N = 18;
    const curve = Array.from({ length: N + 1 }, (_, i) => {
      const t = i / N, u = 1 - t;
      return [u * u * u * A0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t * t * t * B[0], u * u * u * A0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t * t * t * B[1]];
    });
    const lens = [0];
    for (let i = 1; i < curve.length; i++) lens.push(lens[i - 1] + Math.hypot(curve[i][0] - curve[i - 1][0], curve[i][1] - curve[i - 1][1]));
    const [za, zb] = D.flexZ;
    const band = (from, to) => {
      const sel = curve.filter((_, i) => lens[i] >= from && lens[i] <= to);
      if (sel.length < 2) return "";
      return poly([...sel.map((p) => [p[0], p[1], zb]), ...sel.reverse().map((p) => [p[0], p[1], za])]);
    };
    return { curve, total: lens[lens.length - 1], band, shape: band(0, lens[lens.length - 1]) };
  }

  function draw(t) {
    const theta = Math.asin(api.clamp((head - px) / D.reach, -0.6, 0.6));
    const arm = armAt(theta);
    const rb = ribbon(arm.attach[0], arm.attach[1]);
    ribbonLen = rb.total;
    let flex = '<g class="it"><path class="iso-fill" d="' + rb.shape + '"/><path class="iso-shade" data-shade="2" d="' + rb.shape + '"/>';
    for (const p of pulses) {
      const s = (t - p.t0) * SPEED;
      if (s < rb.total + 3) flex += '<path d="' + rb.band(Math.max(0, s - 3), Math.min(rb.total, s + 3)) + '" style="fill:var(--pk-audio-face)"/>';
    }
    flex += '<path class="iso-line iso-edge" data-tone="mid" d="' + rb.shape + '"/></g>';
    g.coil.innerHTML = arm.coil;
    g.arm.innerHTML = flex + arm.arm;
    // pulses along the round cable, chunk by chunk
    for (const c of chunks) {
      let o = 0;
      for (const p of pulses) {
        const s = ((t - p.t0) * SPEED - rb.total) / cableLen;
        const mid = (c.a + c.b) / 2;
        o = Math.max(o, Math.exp(-(((mid - s) / 0.05) ** 2)));
      }
      if (Math.abs(o - c.on) > 0.01) { c.on = o; c.el.style.opacity = (o * 0.9).toFixed(2); }
    }
    // lamp glow
    const age = t - readAt;
    const glow = api.calm() ? 0 : api.smooth(0, 0.05, age) * Math.exp(-Math.max(0, age - 0.05) / 0.16);
    const lc = iso(D.lamp, P);
    g.lamp.innerHTML = glow > 0.02 ? '<circle cx="' + lc[0].toFixed(2) + '" cy="' + lc[1].toFixed(2) + '" r="' + (3.2 * api.KS).toFixed(2) + '" style="fill:var(--pk-audio-top);opacity:' + (glow * 0.6).toFixed(2) + '"/>' : "";
    // buffer window: one cell per quantum read since the last packet
    const W = D.preamp.win, fx = D.preamp.face;
    let cells = "";
    for (let i = 0; i < PER_PACKET; i++) {
      const y0 = W.y0 + 0.5 + i * 1.95, y1 = y0 + 1.45;
      const d = poly([[fx, y0, W.z0 + 0.5], [fx, y1, W.z0 + 0.5], [fx, y1, W.z1 - 0.5], [fx, y0, W.z1 - 0.5]]);
      cells += '<path d="' + d + '" style="fill:var(--anatomy-shade-0)"/>' + (levels[i] > 0.01 ? '<path d="' + d + '" style="fill:var(--pk-audio-top);opacity:' + levels[i].toFixed(2) + '"/>' : "");
    }
    g.buffer.innerHTML = cells;
    // packets pushed out of the preamp's back face onto the lip (drawn behind the box, so the box hides the start)
    g.out.innerHTML = outgoing.map((o) => api.packetSvg("audio", o.p)).join("");
  }

  self.tick = (dt, t) => {
    const calm = api.calm();
    const belt = cleats();
    if (!calm && belt && belt.axis === "x" && belt.xs.length) {
      const list = belt.xs, sgn = belt.dir >= 0 ? 1 : -1;
      lock = lock === null ? nearest(list, hx0 - sgn * D.track) : nearest(list, lock);
      if ((lock - hx0) * sgn > D.track) {
        self.reads++;
        readAt = t;
        pulses.push({ t0: t });
        seekFrom = head;
        seekAt = t;
        lock = nearest(list, lock - sgn * belt.gap);
      }
      const target = api.clamp(lock, hx0 - D.track, hx0 + D.track);
      head = t - seekAt < SEEK && seekFrom !== null ? seekFrom + (target - seekFrom) * api.smooth(0, SEEK, t - seekAt) : target;
    }
    for (let i = 0; i < PER_PACKET; i++) {
      const want = i < buffered ? 1 : 0;
      levels[i] = calm ? want : levels[i] + (want - levels[i]) * (1 - Math.exp(-dt / (want > levels[i] ? 0.05 : 0.1)));
    }
    for (let i = pulses.length - 1; i >= 0; i--) {
      if ((t - pulses[i].t0) * SPEED > ribbonLen + cableLen + 4) {
        pulses.splice(i, 1);
        buffered++;
        if (buffered >= PER_PACKET) {
          buffered = 0;
          outgoing.push({ item: api.item("audio"), t0: t, p: [D.preamp.x, D.preamp.y0 + 4, D.preamp.lipZ] });
        }
      }
    }
    for (let i = outgoing.length - 1; i >= 0; i--) {
      const o = outgoing[i];
      const u = api.smooth(0, 1.1, t - o.t0);
      o.p = [D.preamp.x, D.preamp.y0 + 4 + (D.preamp.outY - D.preamp.y0 - 4) * u, D.preamp.lipZ];
      if (u >= 1) {
        outgoing.splice(i, 1);
        self.packets++;
        api.emit("out", o.item, o.p);
      }
    }
    draw(t);
  };
  return self;
};`;
