// The speaker: a bare driver like one in a car door, membrane facing up toward the screen. Stamped-steel basket with
// four arms and open windows, magnet between a back plate and a top plate, spider, cone with a roll surround and dust
// cap (the lit accent, in the audio mint), a mounting ring screwed to a baffle on a small four-post stand, terminals
// with two wires. Mint audio packets slide into a throat on the basket's +x side; each one pumps the cone up (+z)
// with a decaying wobble and lights the level LEDs in a dark window on the baffle.
// Built relative to `origin` = the centre of the stand's base plate (its underside).
import { planes } from "./planes.mjs";

export function build(ctx, origin = [0, 0, 0], opts = {}) {
  const id = opts.id ?? "speaker";
  const { k, G, P, at, S, Ln, Dots, f2 } = ctx;
  const pl = planes(ctx);
  const [ox, oy, oz] = origin;
  const ZB = opts.height ?? 64; // baffle top
  const HB = 46; // baffle half size
  const T = (x, y, z) => [ox + x, oy + y, oz + z];
  const N = (name) => `${id}.${name}`;
  const box = (name, a, b, style, o) => ctx.box(N(name), T(...a), T(...b), style, o);
  const plan = (x0, y0, x1, y1, r = 0.6) => ({ x: ox + x0, y: oy + y0, w: x1 - x0, d: y1 - y0, r });
  const AX = G.frameOf(T(0, 0, 0), [0, 0, 1], [1, 0, 0], [0, 1, 0]); // the driver axis, s = z
  const Zs = (z) => oz + z;
  const ringX = (X, [y, z], r, n = 12) => k.pathOf(Array.from({ length: n + 1 }, (_, i) => at(T(X, y + r * Math.cos((i / n) * 2 * Math.PI), z + r * Math.sin((i / n) * 2 * Math.PI)))), true);

  // ---------------------------------------------------------------- stand: base plate, posts, baffle
  const BASE = plan(-HB, -HB, HB, HB, 4);
  ctx.back.push(`<path class="iso-halo" d="${k.haloOf(k.insetPlan(BASE, -4), oz, 1, P)}"/>`);
  ctx.slab(N("base"), BASE, oz, 3, { tone: "lo" }, { steps: 4, bevel: 0.5, inner: Ln(k.sideSeam(BASE, oz + 1.5, P, 4), { tone: "faint" }) });
  for (const [x, y] of k.corners(BASE, 6)) {
    const F = G.frameOf([x, y, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
    ctx.turned(N("post.foot"), F, [[oz + 3, 4.2], [oz + 5, 4.2]], { tone: "mid" }, { bevel: 0.2 });
    ctx.turned(N("post"), F, [[oz + 5, 2.4], [oz + ZB - 2, 2.4]], { tone: "mid" }, { inner: Ln(G.arcOf(F, oz + 8, 2.4, P) + G.arcOf(F, oz + ZB - 5, 2.4, P), { tone: "faint" }) });
  }
  // the baffle: an open frame, so the basket shows: a ring plate in four quarters round the driver's hole and four
  // tabs out to the posts
  const HOLE = 29;
  const RING_OUT = 34;
  ctx.material = "fx-graphite";
  for (let q = 0; q < 4; q++) {
    const a0 = (q * Math.PI) / 2;
    const arc = (r, rev) => {
      const pts = Array.from({ length: 13 }, (_, i) => {
        const a = a0 + (i / 12) * (Math.PI / 2);
        return [ox + r * Math.cos(a), oy + r * Math.sin(a)];
      });
      return rev ? pts.reverse() : pts;
    };
    ctx.prism(N(`baffle.q${q}`), [...arc(RING_OUT, false), ...arc(HOLE, true)], Zs(ZB - 2), 2, { tone: "mid" });
    const ad = a0 + Math.PI / 4;
    const [c, sn] = [Math.cos(ad), Math.sin(ad)];
    const tab = [[RING_OUT, -4], [Math.SQRT2 * (HB - 6) + 4.5, -4], [Math.SQRT2 * (HB - 6) + 4.5, 4], [RING_OUT, 4]].map(([r, t]) => [ox + r * c - t * sn, oy + r * sn + t * c]);
    const post = [ox + Math.SQRT2 * (HB - 6) * c, oy + Math.SQRT2 * (HB - 6) * sn];
    ctx.prism(N(`baffle.tab${q}`), tab, Zs(ZB - 2), 2, { tone: "mid" }, { extra: Ln(k.ring(post[0], post[1], 1.6, Zs(ZB), P, 12), { tone: "lo" }) + Dots([at([post[0], post[1], Zs(ZB)])], { size: 0.5 }) });
  }
  ctx.material = "";

  // ---------------------------------------------------------------- the driver, bottom to top
  const BK = 28; // basket depth: dish top below the ring
  const DISH = { r0: 8.8, r1: 17.4, z0: ZB - BK - 1.4, z1: ZB - BK };
  const M0 = DISH.z0; // top of the top plate
  ctx.turned(N("backplate"), AX, [[Zs(M0 - 12), 14.6], [Zs(M0 - 10), 14.6]], { tone: "mid" }, { bevel: 0.2 });
  ctx.material = "fx-graphite";
  ctx.turned(N("magnet"), AX, [[Zs(M0 - 10), 14], [Zs(M0 - 2), 14]], { tone: "mid" }, { inner: Ln(G.arcOf(AX, Zs(M0 - 6), 14, P), { tone: "faint" }) });
  ctx.material = "";
  ctx.turned(N("topplate"), AX, [[Zs(M0 - 2), 14.6], [Zs(M0), 14.6]], { tone: "mid" }, { bevel: 0.2 });
  // stamped basket: a flat dish, four arms up to the mounting ring, the voice-coil former and the spider inside
  {
    const shape = ctx.record(ctx.A.ring(AX, Zs(DISH.z0), Zs(DISH.z1), DISH.r0, DISH.r1, { name: N("basket.dish") }));
    const paths = G.ringBand(Zs(DISH.z0), Zs(DISH.z1), DISH.r0, DISH.r1, AX, P);
    ctx.put(N("basket.dish"), T(0, 0, (DISH.z0 + DISH.z1) / 2), S(paths, { tone: "mid" }) + Dots(G.dotsOf(AX, Zs(DISH.z1), 15.6, 6, P, { all: true }), { size: 0.4, tone: "lo" }), [shape]);
  }

  {
    const Z = ZB - 9;
    ctx.material = "fx-graphite";
    const RS = 16 + ((Z - DISH.z1) / BK) * 11.6 - 0.5; // reaches the arms
    const shape = ctx.record(ctx.A.ring(AX, Zs(Z - 0.8), Zs(Z), 8.6, RS, { name: N("spider") }));
    const paths = G.ringBand(Zs(Z - 0.8), Zs(Z), 8.6, RS, AX, P);
    ctx.put(N("spider"), T(0, 0, Z), S(paths, { tone: "lo", inner: "" }) + Ln([11.2, 13.8, 16.4, 19, 21.4].map((r) => G.circleOf(AX, Zs(Z), r, P, 48)).join(""), { tone: "faint" }), [shape]);
  }
  // the voice-coil former: stands on the spider, carries the cone's apex
  ctx.turned(N("former"), AX, [[Zs(ZB - 9), 9.4], [Zs(ZB - 4.1), 9.4]], { tone: "lo" });
  ctx.material = "";
  const ARM = { r0: 16, z0: DISH.z1, r1: 27.6, z1: ZB };
  for (const deg of [45, 135, 225, 315]) {
    const a = (deg * Math.PI) / 180;
    const radial = [Math.cos(a), Math.sin(a), 0];
    const p0 = G.add3(T(0, 0, ARM.z0), G.mul3(radial, ARM.r0));
    const p1 = G.add3(T(0, 0, ARM.z1), G.mul3(radial, ARM.r1));
    const dir = G.unit3(G.sub3(p1, p0));
    const u = [-Math.sin(a), Math.cos(a), 0];
    const v = G.cross3(dir, u);
    const F = { o: p0, a: dir, u, v };
    const len = G.len3(G.sub3(p1, p0));
    pl.prism(N("basket.arm"), F, [[-3, -0.6], [3, -0.6], [3, 0.6], [-3, 0.6]], 0, len, { tone: "mid" }, { extra: Dots([at(G.add3(p0, G.mul3(dir, len * 0.5)))].map((p) => p), { size: 0.4, tone: "lo" }) });
  }
  // the mounting ring with four screw slots, screwed to the baffle
  {
    const Z0 = ZB;
    const Z1 = ZB + 1.4;
    const shape = ctx.record(ctx.A.ring(AX, Zs(Z0), Zs(Z1), 27, 32.5, { name: N("ring") }));
    const paths = G.ringBand(Zs(Z0), Zs(Z1), 27, 32.5, AX, P);
    const slots = [45, 135, 225, 315].map((deg) => {
      const a = (deg * Math.PI) / 180;
      const pts = Array.from({ length: 17 }, (_, i) => {
        const t = (i / 16) * Math.PI * 2;
        const rr = 30.6 + 1.0 * Math.cos(t);
        const aa = a + (2.4 / 30.6) * Math.sin(t);
        return at(T(rr * Math.cos(aa), rr * Math.sin(aa), Z1));
      });
      return k.pathOf(pts, true);
    }).join("");
    const heads = [45, 135, 225, 315].map((deg) => at(T(30.6 * Math.cos((deg * Math.PI) / 180), 30.6 * Math.sin((deg * Math.PI) / 180), Z1)));
    ctx.put(N("ring"), T(0, 0, (Z0 + Z1) / 2), S(paths, { tone: "hi" }) + `<path class="iso-fill" style="fill:#16171b" d="${slots}"/>` + Ln(slots, { tone: "lo" }) + Dots(heads, { size: 0.6, tone: "mid" }), [shape]);
  }
  // roll surround: a rubber half-torus on the ring (a closed tube resting on the ring top)
  const SUR = { r: 27.4, tube: 2.4, z: ZB + 1.4 + 2.4 };
  ctx.material = "fx-graphite";
  ctx.cable(N("surround"), Array.from({ length: 64 }, (_, i) => T(SUR.r * Math.cos((i / 64) * Math.PI * 2), SUR.r * Math.sin((i / 64) * Math.PI * 2), SUR.z)), SUR.tube, { closed: true, shells: [false, false], maxLength: 10, touch: [N("cone"), N("ring"), N("basket.arm")] });
  ctx.material = "";
  // the cone: a shallow concave paper cone (slope under the 30° view, so you see all of its inside), mint, lit rim
  const CONE = { r0: 8.6, z0: ZB - 3.4, r1: SUR.r - SUR.tube + 0.1, z1: SUR.z };
  {
    const zAt = (r) => CONE.z0 + ((r - CONE.r0) / (CONE.r1 - CONE.r0)) * (CONE.z1 - CONE.z0);
    const circle = (r, z, n = 72) => Array.from({ length: n }, (_, i) => at(T(r * Math.cos((i / n) * Math.PI * 2), r * Math.sin((i / n) * Math.PI * 2), z)));
    const rim = k.pathOf(circle(CONE.r1, CONE.z1), true);
    const inner = [0.78, 0.58, 0.4].map((f) => {
      const r = CONE.r0 + (CONE.r1 - CONE.r0) * f;
      return k.pathOf(circle(r, zAt(r)), true);
    }).join("");
    const apex = k.pathOf(circle(CONE.r0, CONE.z0), true);
    const gid = `${id}-cone-grad`;
    const [gx0, gy0] = at(T(-CONE.r1 * 0.7, -CONE.r1 * 0.7, CONE.z1));
    const [gx1, gy1] = at(T(CONE.r1 * 0.7, CONE.r1 * 0.7, CONE.z0));
    const art = `<defs><linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${f2(gx0)}" y1="${f2(gy0)}" x2="${f2(gx1)}" y2="${f2(gy1)}"><stop offset="0" style="stop-color:var(--pk-audio-s1)"/><stop offset=".55" style="stop-color:var(--pk-audio-face)"/><stop offset="1" style="stop-color:var(--pk-audio-top)"/></linearGradient></defs>` +
      `<path d="${rim}" style="fill:url(#${gid});stroke:none"/><path class="iso-line" data-tone="lo" d="${inner}" style="stroke:var(--pk-audio-s0);opacity:.7"/><path d="${apex}" style="fill:var(--pk-audio-s2);stroke:none"/>` +
      `<path class="iso-line" data-tone="lit" d="${rim}" style="stroke-width:1.1px"/>`;
    // recorded as the true thin shell: outer surface up from the apex, back down the inside
    const shape = ctx.record(ctx.A.body(AX, [[Zs(CONE.z0 - 1), 0], [Zs(CONE.z0 - 1), CONE.r0], [Zs(CONE.z1), CONE.r1], [Zs(CONE.z1), CONE.r1 - 1], [Zs(CONE.z0), CONE.r0], [Zs(CONE.z0), 0]], { name: N("cone") }));
    ctx.put(N("cone"), T(0, 0, CONE.z1 - 1), art, [shape], { attrs: ` data-part="${id}-cone"` });
  }
  {
    // dust cap: a mint dome on the apex, outlined in the lit tone
    const prof = [[Zs(CONE.z0), CONE.r0], [Zs(CONE.z0 + 1), CONE.r0 - 0.3, 1], [Zs(CONE.z0 + 2.2), CONE.r0 - 1.8, 1], [Zs(CONE.z0 + 3.1), CONE.r0 - 4.2, 1], [Zs(CONE.z0 + 3.5), 0, 1]];
    const shape = ctx.record(ctx.A.solid(AX, prof, { name: N("cap") }));
    const paths = G.solidOf(prof, AX, P);
    ctx.put(N("cap"), T(0, 0, CONE.z0 + 1.5), `<g class="pk" data-kind="audio">${S(paths, { tone: "hi" })}</g>` + Ln(paths.outline, { tone: "lit" }), [shape], { attrs: ` data-part="${id}-cap"` });
  }

  // ---------------------------------------------------------------- the throat on the +x side, with a feed ledge
  const DU = { x0: 25, x1: HB + 6, y0: -6.5, y1: 6.5, z0: ZB - 17, z1: ZB - 2 };
  const MOUTH = { u0: -4.8, u1: 4.8, z0: DU.z0 + 2, z1: DU.z1 - 2.4 };
  const mouth = pl.recess("x", { u0: oy + MOUTH.u0, u1: oy + MOUTH.u1, z0: oz + MOUTH.z0, z1: oz + MOUTH.z1, r: 1.4, depth: 12 }, ox + DU.x1, { id: `${id}-mouth`, backStyle: "fill:var(--anatomy-shade-0)" });
  box("throat", [DU.x0, DU.y0, DU.z0], [DU.x1, DU.y1, DU.z1], { tone: "mid" }, {
    r: 1,
    steps: 3,
    bevel: 0.3,
    inner: Ln(k.sideSeam(plan(DU.x0, DU.y0, DU.x1, DU.y1, 1), oz + DU.z1 - 2, P, 3), { tone: "faint" }),
    extra: mouth.svg + Ln([[-5.5, DU.z0 + 1.2], [5.5, DU.z0 + 1.2]].map((p) => ringX(DU.x1, p, 0.6)).join(""), { tone: "lo" }) + Dots([[-5.5, DU.z0 + 1.2], [5.5, DU.z0 + 1.2]].map(([y, z]) => at(T(DU.x1, y, z))), { size: 0.35 }),
  });
  const LEDGE = { x0: DU.x1, x1: DU.x1 + 12, z: MOUTH.z0 };
  box("ledge", [LEDGE.x0, -5.6, LEDGE.z - 1.2], [LEDGE.x1, 5.6, LEDGE.z], { tone: "mid" }, { r: 0.4, steps: 2, bevel: 0.2 });
  ctx.slot(`${id}:packet`, { after: N("throat") });

  // ---------------------------------------------------------------- terminals and their two wires to a plug on the base
  const TB = { x0: -5, x1: 5, y0: 17.2, y1: 22, z0: DISH.z1 - 4, z1: DISH.z1 };
  box("terminal.block", [TB.x0, TB.y0, TB.z0], [TB.x1, TB.y1, TB.z1], { tone: "lo" }, { r: 0.4, steps: 2 });
  for (const x of [-2.6, 2.6]) box("terminal.tab", [x - 1.2, TB.y1, TB.z0 + 0.8], [x + 1.2, TB.y1 + 3, TB.z0 + 3.2], { tone: "hi" }, { r: 0.2, steps: 2 });
  box("plug", [-6, 26, 3], [6, 34, 8], { tone: "lo" }, { r: 0.8, steps: 2, bevel: 0.3, extra: Dots([at(T(-2.6, 30, 8)), at(T(2.6, 30, 8))], { size: 0.5, tone: "mid" }) });
  for (const [x, tone] of [[-2.6, "hi"], [2.6, "lo"]])
    ctx.cable(N(`wire${x < 0 ? 0 : 1}`), [T(x, TB.y1 + 3, TB.z0 + 2), T(x, 30, TB.z0 + 2), T(x, 30, 8)], 0.6, { tone, bend: 3 });

  // ---------------------------------------------------------------- level LEDs in a dark window on the throat's top
  const LEDS = 6;
  {
    const WX0 = RING_OUT + 1.5;
    const WX1 = DU.x1 - 1.2;
    const WIN = plan(WX0, -4.4, WX1, 4.4, 0.8);
    ctx.material = "fx-graphite";
    const m = k.topMatrix([ox, oy], oz + DU.z1 + 0.6, P, "x");
    const pitch = (WX1 - WX0 - 1.6) / LEDS;
    const leds = Array.from({ length: LEDS }, (_, i) => `<rect data-led="${i}" x="${f2(WX0 + 0.8 + i * pitch + 0.25)}" y="-2.6" width="${f2(pitch - 0.5)}" height="5.2" rx=".4" style="fill:#23262b;stroke:var(--anatomy-lo);stroke-width:.4px"/>`).join("");
    ctx.slab(N("meter"), WIN, oz + DU.z1, 0.6, { tone: "mid" }, { steps: 3, extra: `<g data-part="${id}-meter" transform="${m}"><path d="${pl.roundRect(WX0 + 0.5, -3.4, WX1 - 0.5, 3.4, 0.6, 3)}" style="fill:#121316;stroke:none"/>${leds}</g>` });
    ctx.material = "";
  }

  ctx.data[id] = {
    ports: { in: T(LEDGE.x1, 0, LEDGE.z) },
    packet: { y: oy, z: oz + LEDGE.z, x1: ox + LEDGE.x1, mouth: ox + DU.x1, x0: ox + DU.x1 - 1.5, w: 10, d: 8, h: 7 },
    clip: mouth.id,
    leds: LEDS,
  };
}

export const LIVE = String.raw`
MACHINES.speaker = (api) => {
  const D = api.data;
  const g = api.slot("packet");
  const cone = api.el('[data-part="' + api.id + '-cone"]');
  const cap = api.el('[data-part="' + api.id + '-cap"]');
  const leds = [...api.el('[data-part="' + api.id + '-meter"]').querySelectorAll("rect")];
  const p = D.packet;
  const packets = [];
  const kicks = [];
  let level = 0;
  let peak = 0;
  let peakAt = -9;
  let heard = 0;
  let shown = "";
  let still = false;
  let n = 0;
  const hull = (pts) => {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [];
    for (const q of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    const hi = [];
    for (const q of pts.reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
    return pathOf([...lo.slice(0, -1), ...hi.slice(0, -1)], true);
  };
  // a packet at front x: through the mouth (clipped by the opening) plus the part still outside it
  function packetAt(x, z, alpha, tag) {
    const svg = api.packetSvg("audio", [x - p.w / 2, p.y, z], { w: p.w, d: p.d, h: p.h });
    const out0 = Math.max(p.mouth, x - p.w);
    let outside = "";
    if (x > p.mouth) {
      const c = [];
      for (const xx of [out0, x]) for (const yy of [p.y - p.d / 2, p.y + p.d / 2]) for (const zz of [z, z + p.h]) c.push(api.at([xx, yy, zz]));
      const cid = api.id + "-out-" + tag;
      outside = '<clipPath id="' + cid + '"><path d="' + hull(c) + '"/></clipPath><g clip-path="url(#' + cid + ')">' + svg + "</g>";
    }
    return '<g opacity="' + alpha.toFixed(2) + '"><g clip-path="url(#' + D.clip + ')">' + svg + "</g>" + outside + "</g>";
  }
  function meter(lit, pk) {
    const key = lit + ":" + pk;
    if (key === shown) return;
    shown = key;
    leds.forEach((el, i) => {
      const on = i < lit || i === pk;
      el.style.fill = on ? (i === D.leds - 1 ? "var(--pk-graph-top)" : "var(--pk-audio-face)") : "#23262b";
    });
  }
  return {
    get heard() { return heard; },
    get level() { return level; },
    accept(port, item, from) {
      if (api.calm()) return;
      // a packet handed on mid-fall keeps falling under gravity (from item.v, else from rest) onto the ledge; the
      // slide into the throat then starts as before (the fall is shifted so it ends at t = 0.3)
      const q = { item, t: 0, from: from ?? null, tag: n++ };
      if (q.from && q.from[2] > p.z + 0.5) {
        const v0 = item.v ? Math.max(0, -item.v[2]) : 0;
        const dz = q.from[2] - p.z;
        q.fall = (-v0 + Math.sqrt(v0 * v0 + 2 * 420 * dz)) / 420;
        q.v0 = v0;
        q.t = 0.3 - q.fall;
      }
      delete item.v;
      packets.push(q);
    },
    tick(dt, t) {
      if (api.calm()) {
        // reduced motion: one still frame, a packet half way into the throat, the meter at three LEDs
        if (!still) {
          still = true;
          packets.length = 0;
          kicks.length = 0;
          g.innerHTML = packetAt(p.mouth + p.w * 0.45, p.z, 1, "still");
          cone.setAttribute("transform", "");
          cap.setAttribute("transform", "");
          meter(3, -1);
        }
        return;
      }
      still = false;
      // each packet: comes from where it was handed over (or appears on the ledge), then slides into the throat
      let html = "";
      for (let i = packets.length - 1; i >= 0; i--) {
        const q = packets[i];
        q.t += dt;
        let x;
        let z = p.z;
        let alpha = 1;
        if (q.t < 0.3) {
          const u = api.smooth(0, 0.3, q.t);
          if (q.fall) {
            const s = q.t - (0.3 - q.fall);
            x = q.from[0] + p.w / 2 + (p.x1 - q.from[0] - p.w / 2) * api.clamp(s / q.fall, 0, 1);
            z = Math.max(p.z, q.from[2] - q.v0 * s - 210 * s * s);
          } else if (q.from) {
            x = q.from[0] + p.w / 2 + (p.x1 - q.from[0] - p.w / 2) * u;
            z = q.from[2] + (p.z - q.from[2]) * u;
          } else {
            x = p.x1;
            alpha = u;
          }
        } else {
          const u = api.smooth(0.3, 1.0, q.t);
          x = p.x1 + (p.x0 - p.x1) * u;
          alpha = 1 - api.smooth(0.85, 1.05, q.t); // through the rubber flap at the back of the throat
        }
        if (!q.kicked && q.t > 1.0) {
          q.kicked = true;
          heard++;
          kicks.push(t);
          level = Math.min(1, level * 0.5 + 0.6 + Math.random() * 0.35);
          if (level >= peak) (peak = level), (peakAt = t);
          api.announce("audio packet " + heard + " reaches the speaker");
        }
        if (q.t > 1.05) packets.splice(i, 1);
        else html += packetAt(x, z, alpha, q.tag);
      }
      g.innerHTML = html;
      // the cone pumps up along its axis: an impulse response per packet, out first, decaying; the cap moves further
      while (kicks.length && t - kicks[0] > 1.6) kicks.shift();
      let d = 0;
      for (const k0 of kicks) {
        const s = t - k0;
        d += Math.exp(-s / 0.26) * Math.sin(2 * Math.PI * 4.6 * s);
      }
      d = api.clamp(d, -1.1, 1.4) * 2.4;
      cone.setAttribute("transform", translateAlong(api.P, [0, 0, d]));
      cap.setAttribute("transform", translateAlong(api.P, [0, 0, d * 1.35]));
      // a peak meter: level decays, the peak LED holds, then falls slowly
      level *= Math.exp(-dt / 0.5);
      if (t - peakAt > 0.7) peak *= Math.exp(-dt / 0.9);
      const lit = Math.round(level * D.leds);
      const pk = Math.min(D.leds - 1, Math.max(lit, Math.round(peak * D.leds) - 1));
      meter(lit, peak > 0.12 ? pk : -1);
    },
  };
};`;
