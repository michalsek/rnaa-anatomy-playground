// The phone: the whole factory lives inside it. The CASE lies flat as a deep phone-shaped tray (back plate, aluminium
// band walls; the far walls run full height, the near ones are cut down to a low machined lip so you can see in), and
// the DISPLAY floats high above it, face up, with the animated React screen. A small fluff dispenser hangs under the
// display: loose JS calls (blue beads) drop into a sight tube, pass a star valve and leave a nozzle pointing down
// (port `fluff`, emitted the moment a bead leaves the tip; the receiver draws the fall).
// Everything is built relative to `origin` = the centre of the case floor (z = 0 is the factory floor).
import { planes } from "./planes.mjs";

export const CASE = { w: 280, d: 540, depth: 280, r: 40, cut: 40, t: 6, back: 8 };

export function build(ctx, origin = [0, 0, 0], opts = {}) {
  const id = opts.id ?? "phone";
  const { k, G, P, at, S, Ln, Dots, f2 } = ctx;
  const pl = planes(ctx);
  const [ox, oy, oz] = origin;
  const C = { ...CASE, ...opts };
  const { w, d, depth: H, r: R, cut: CUT, t: TH, back: BACK } = C;
  const DZ = opts.displayZ ?? H + 220; // underside of the display (OLED back)
  const T = (x, y, z) => [ox + x, oy + y, oz + z];
  const N = (name) => `${id}.${name}`;
  const box = (name, a, b, style, o) => ctx.box(N(name), T(...a), T(...b), style, o);
  const plan = (x0, y0, x1, y1, r = 0.6) => ({ x: ox + x0, y: oy + y0, w: x1 - x0, d: y1 - y0, r });
  const UPF = (x, y) => G.frameOf(T(x, y, 0), [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  const ringY = (Y, [x, z], r, n = 12) => k.pathOf(Array.from({ length: n + 1 }, (_, i) => at(T(x + r * Math.cos((i / n) * 2 * Math.PI), Y, z + r * Math.sin((i / n) * 2 * Math.PI)))), true);
  const ringX = (X, [y, z], r, n = 12) => k.pathOf(Array.from({ length: n + 1 }, (_, i) => at(T(X, y + r * Math.cos((i / n) * 2 * Math.PI), z + r * Math.sin((i / n) * 2 * Math.PI)))), true);
  const screwsY = (Y, pts, ring = 1, size = 0.42) => Ln(pts.map((p) => ringY(Y, p, ring)).join(""), { tone: "lo" }) + Dots(pts.map(([x, z]) => at(T(x, Y, z))), { size });
  const screwsX = (X, pts, ring = 1, size = 0.42) => Ln(pts.map((p) => ringX(X, p, ring)).join(""), { tone: "lo" }) + Dots(pts.map(([y, z]) => at(T(X, y, z))), { size });

  // ---------------------------------------------------------------- the case
  const OUT = plan(-w / 2, -d / 2, w / 2, d / 2, R);
  const IN = plan(-w / 2 + TH, -d / 2 + TH, w / 2 - TH, d / 2 - TH, R - TH);
  ctx.back.push(`<path class="iso-halo" d="${k.haloOf(k.insetPlan(OUT, -4), oz - BACK, 1, P)}"/>`);
  // the shared scene records the shop floor at z −1…0; the back plate and the band's foot below z 0 sit where that
  // floor is, so they are recorded from the floor down to −1 (back) and from z 0 up (walls) and drawn in full
  // opts.fullRecord (assembly, scene floorZ −BACK): the shop floor sits under the back plate, so plate and walls are
  // recorded in full
  const FULL = Boolean(opts.fullRecord);
  const LOW = opts.walls === "low";
  {
    const shape = ctx.record(ctx.A.slab(IN, oz - BACK, FULL ? BACK : BACK - 1, { name: N("back"), ground: true }, 10));
    ctx.put(N("back"), T(0, 0, -BACK / 2), S(k.slabOf(IN, oz - BACK, BACK, P, 10), { tone: "lo" }), [shape]);
  }
  // band walls, cut into corner halves and side runs so the machines inside sort against each piece
  {
    const steps = 8;
    const outer = k.roundedPlan(OUT, steps);
    const inner = k.roundedPlan(IN, steps);
    const per = steps + 1;
    const far = (p) => p[0] < ox - w / 2 + 1 || p[1] < oy - d / 2 + 1; // on the −x side or the −y end
    const sideMid = (c) => {
      const b = c * per + steps;
      const n = ((c + 1) % 4) * per;
      return [(outer[b][0] + outer[n][0]) / 2, (outer[b][1] + outer[n][1]) / 2];
    };
    const pieces = [];
    for (let c = 0; c < 4; c++) {
      const a = c * per;
      const b = a + steps;
      const m = a + Math.round(steps / 2);
      const before = far(sideMid((c + 3) % 4));
      const after = far(sideMid(c));
      pieces.push({ kind: "corner", far: before, o: outer.slice(a, m + 1), i: inner.slice(a, m + 1) });
      pieces.push({ kind: "corner", far: after, o: outer.slice(m, b + 1), i: inner.slice(m, b + 1) });
      const n = ((c + 1) % 4) * per;
      const len = Math.hypot(outer[n][0] - outer[b][0], outer[n][1] - outer[b][1]);
      const runs = Math.max(1, Math.ceil(len / 110));
      const lerp = (p, q, u) => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
      for (let i = 0; i < runs; i++) {
        const u0 = i / runs;
        const u1 = (i + 1) / runs;
        pieces.push({ kind: "side", far: after, o: [lerp(outer[b], outer[n], u0), lerp(outer[b], outer[n], u1)], i: [lerp(inner[b], inner[n], u0), lerp(inner[b], inner[n], u1)] });
      }
    }
    // walls: "low" — a low tray all round: every wall at the lip height, the band drawn as two clean pieces (the far
    // half and the near half, each one concave ring, so no joints or seams show) and no inner rails
    let list = pieces;
    if (LOW) {
      const start = pieces.findIndex((p, i) => p.far !== pieces[(i + pieces.length - 1) % pieces.length].far);
      const rot = [...pieces.slice(start), ...pieces.slice(0, start)];
      list = [];
      for (const p of rot) {
        const last = list[list.length - 1];
        if (last && last.far === p.far) {
          last.o.push(...p.o.slice(1));
          last.i.push(...p.i.slice(1));
        } else list.push({ kind: "half", far: p.far, o: p.o.slice(), i: p.i.slice() });
      }
    }
    for (const piece of list) piece.ring = [...piece.o, ...piece.i.slice().reverse()];
    for (const piece of list) {
      const top = piece.far && !LOW ? H : CUT;
      const z0 = oz - BACK;
      const h = top + BACK;
      const shape = ctx.record(ctx.A.extruded(piece.ring, FULL ? oz - BACK : oz, FULL ? top + BACK : top, { name: N(`band.${piece.far ? "far" : "lip"}.${piece.kind}`) }));
      const seams = LOW ? "" : piece.far ? Ln(k.ringSeam(piece.ring, oz + CUT, P) + k.ringSeam(piece.ring, oz + H - 7, P), { tone: "faint" }) : Ln(k.ringSeam(piece.ring, oz + CUT - 5, P), { tone: "faint" });
      const cx = piece.ring.reduce((s, p) => s + p[0], 0) / piece.ring.length;
      const cy = piece.ring.reduce((s, p) => s + p[1], 0) / piece.ring.length;
      ctx.put(N(`band.${piece.far ? "far" : "lip"}.${piece.kind}`), [cx, cy, z0 + h / 2], S(k.extrude(piece.ring, z0, h, P, { convex: false, bevel: 0.5 }), { tone: "hi", inner: seams }), [shape]);
    }
  }
  // on the far walls' inner faces: two mounting rails each (for brackets put in at assembly) and antenna strips
  if (opts.rails !== false && !LOW) {
    const IX = -w / 2 + TH; // inner face of the −x wall
    const IY = -d / 2 + TH; // inner face of the −y end
    for (const z of [Math.round(H * 0.42), Math.round(H * 0.78)]) {
      const ya = -d / 2 + R + 4;
      const yb = d / 2 - R - 4;
      box("rail.side", [IX, ya, z - 2.5], [IX + 2.4, yb, z + 2.5], { tone: "mid" }, { r: 0.4, steps: 2, bevel: 0.2, extra: screwsX(IX + 2.4, Array.from({ length: Math.floor((yb - ya) / 40) }, (_, i) => [ya + 20 + i * 40, z]), 0.8, 0.38) });
      const xa = -w / 2 + R + 4;
      const xb = w / 2 - R - 4;
      box("rail.end", [xa, IY, z - 2.5], [xb, IY + 2.4, z + 2.5], { tone: "mid" }, { r: 0.4, steps: 2, bevel: 0.2, extra: screwsY(IY + 2.4, Array.from({ length: Math.floor((xb - xa) / 40) }, (_, i) => [xa + 20 + i * 40, z]), 0.8, 0.38) });
    }
    // antenna strips: the plastic breaks in the band, inside and across the top
    for (const y of [-d / 2 + R + 30, d / 2 - R - 30]) {
      ctx.put(N("antenna"), T(-w / 2 + TH / 2, y, H + 0.02), Ln(k.pathOf([at(T(-w / 2, y, H)), at(T(-w / 2 + TH, y, H))]) + k.pathOf([at(T(-w / 2, y + 3, H)), at(T(-w / 2 + TH, y + 3, H))]), { tone: "lo" }), [ctx.record(ctx.A.box(T(-w / 2 + 0.2, y - 0.2, H), T(-w / 2 + TH - 0.2, y + 3.2, H + 0.02), { name: N("antenna") }))], { bias: 0.2 });
    }
  }
  // the near lip's outer faces: buttons and SIM tray on the +x side, port, grilles and screws on the +y end
  {
    const X = w / 2;
    for (const [name, y0, y1] of [["button.action", -d / 2 + 96, -d / 2 + 112], ["button.volume.up", -d / 2 + 130, -d / 2 + 160], ["button.volume.down", -d / 2 + 172, -d / 2 + 202]])
      box(name, [X, y0, 10], [X + 1.8, y1, 26], { tone: "mid" }, { r: 0.8, steps: 3, bevel: 0.3 });
    const sim = pl.roundRect(-d / 2 + 250, -24, -d / 2 + 300, -12, 6, 6);
    const m = pl.planeMatrix(T(X + 0.02, 0, 0), [0, 1, 0], [0, 0, -1]);
    const shape = LOW ? null : ctx.record(ctx.A.box(T(X, -d / 2 + 248, 10), T(X + 0.04, -d / 2 + 302, 26), { name: N("sim") }));
    if (!LOW) ctx.put(N("sim"), T(X + 0.02, -d / 2 + 275, 18), `<g transform="${m}"><path class="iso-line" data-tone="lo" d="${sim}"/><path class="iso-line" data-tone="faint" d="${pl.roundRect(-d / 2 + 253, -22, -d / 2 + 297, -14, 4, 6)}"/></g>` + Dots([at(T(X + 0.04, -d / 2 + 292, 18))], { size: 0.7, tone: "lo" }), [shape], { bias: 0.05 });
    const Y = d / 2;
    const usb = pl.recess("y", { u0: ox - 14, u1: ox + 14, z0: oz + 13, z1: oz + 22, r: 4.5, depth: 5 }, oy + Y + 0.02, { id: `${id}-usb`, backStyle: "fill:#141518", back: `<path class="iso-line" data-tone="mid" d="${pl.roundRect(ox - 8, -(oz + 18.6), ox + 8, -(oz + 16.4), 1.1, 4)}"/>` });
    const grille = [];
    for (const s of [-1, 1]) for (let i = 0; i < 8; i++) grille.push(at(T(s * (34 + i * 6), Y + 0.04, 17.5)));
    const end = ctx.record(ctx.A.box(T(-84, Y, 10), T(84, Y + 0.04, 26), { name: N("end") }));
    ctx.put(N("end"), T(0, Y + 0.02, 18), usb.svg + (LOW ? "" : Dots(grille, { size: 1.1, tone: "lo" }) + screwsY(Y + 0.04, [[-22, 17.5], [22, 17.5]], 1.1, 0.5)), [end], { bias: 0.05 }); // low tray: just the port
  }
  // the floor: a vapour-chamber plate, standoffs and screw bosses along the walls, a label plate (all low and flat,
  // so the machines put in at assembly stand over them)
  {
    const VC = plan(-w / 2 + 22, -d / 2 + 22, w / 2 - 22, -d / 2 + 22 + d * 0.2, 14);
    ctx.slab(N("floor.vapour"), VC, oz, 0.4, { tone: "mid" }, {
      steps: 6,
      extra: Ln(k.planOutline(k.insetPlan(VC, 4), oz + 0.4, P, 6) + k.planOutline({ x: VC.x + 14, y: VC.y + VC.d / 2 - 3, w: VC.w - 28, d: 6, r: 3 }, oz + 0.4, P, 4), { tone: "faint" }) + Ln(k.corners(VC, 8).map(([x, y]) => k.ring(x, y, 1.4, oz + 0.4, P, 12)).join(""), { tone: "lo" }) + Dots(k.corners(VC, 8).map(([x, y]) => at([x, y, oz + 0.4])), { size: 0.45 }),
    });
    const BAT = plan(-w / 2 + 26, -d * 0.06, w / 2 - 26, d * 0.28, 8);
    ctx.slab(N("floor.battery"), BAT, oz, 0.4, { tone: "lo" }, {
      steps: 6,
      extra: Ln(k.planOutline(k.insetPlan(BAT, 3), oz + 0.4, P, 6), { tone: "faint" }) + Ln([BAT.w * 0.42, BAT.w * 0.3].map((len, i) => k.lineOnTop([BAT.x + 10, BAT.y + 12 + i * 6], [BAT.x + 10 + len, BAT.y + 12 + i * 6], oz + 0.4, P)).join(""), { tone: "lo", free: true }) +
        Ln(k.planOutline({ x: BAT.x + BAT.w / 2 - 9, y: BAT.y - 0.01 + 4, w: 18, d: 6, r: 1 }, oz + 0.4, P, 3), { tone: "lo" }) + Dots([at([BAT.x + BAT.w / 2 - 5, BAT.y + 7, oz + 0.4]), at([BAT.x + BAT.w / 2 + 5, BAT.y + 7, oz + 0.4])], { size: 0.5, tone: "mid" }),
    });
    const L = plan(-w / 2 + 24, d / 2 - 64, -w / 2 + 84, d / 2 - 40, 1.5);
    ctx.slab(N("floor.label"), L, oz, 0.4, { tone: "lo" }, {
      steps: 3,
      extra: Ln(k.planOutline(k.insetPlan(L, 2), oz + 0.4, P, 3), { tone: "faint" }) + Ln([40, 30, 34].map((len, i) => k.lineOnTop([L.x + 6, L.y + 6 + i * 5], [L.x + 6 + len, L.y + 6 + i * 5], oz + 0.4, P)).join(""), { tone: "lo", free: true }),
    });
    const inset = TH + 16;
    for (const [x, y] of [[-w / 2 + inset, -d / 2 + inset + 8], [w / 2 - inset, -d / 2 + inset + 8], [-w / 2 + inset, 0], [w / 2 - inset, 0], [-w / 2 + inset, d / 2 - inset - 8], [w / 2 - inset, d / 2 - inset - 8]])
      ctx.cyl(N("floor.standoff"), ox + x, oy + y, 3.2, oz, 5, { tone: "mid" }, { steps: 20, extra: Ln(k.ring(ox + x, oy + y, 1.5, oz + 5, P, 12), { tone: "lo" }) + Dots([at(T(x, y, 5))], { size: 0.45 }) });
    for (const s of [-1, 1]) for (const y of [-d / 4, d / 4]) ctx.cyl(N("floor.boss"), ox + s * (w / 2 - TH - 2.6), oy + y, 2.6, oz, 3.6, { tone: "mid" }, { steps: 16, extra: Dots([at(T(s * (w / 2 - TH - 2.6), y, 3.6))], { size: 0.4, tone: "lo" }) });
  }

  // ---------------------------------------------------------------- the display, floating face up
  // opts.displayShift [sx, sy]: the exploded display can float offset from the case (the assembly slides it back so
  // the dispenser under it sits near its visible edge)
  const [sx, sy] = opts.displayShift ?? [0, 0];
  const DOUT = plan(-w / 2 + sx, -d / 2 + sy, w / 2 + sx, d / 2 + sy, R);
  const OLED = k.insetPlan(DOUT, 3);
  const GLASS = k.insetPlan(DOUT, 0.8);
  const Z1 = DZ + 3.4; // OLED top
  const Z2 = Z1 + 1.6; // glass top
  ctx.back.push(`<path class="iso-halo" d="${k.haloOf(k.insetPlan(DOUT, 10), oz - BACK + 1, 1, P)}"/>`);
  {
    ctx.material = "fx-graphite";
    // the display is held by the exploded view, not by anything below it: recorded as grounded
    const shape = ctx.record(ctx.A.slab(OLED, oz + DZ, Z1 - DZ, { name: N("display.oled"), ground: true }, 10));
    ctx.put(N("display.oled"), T(sx, sy, (DZ + Z1) / 2), S(k.slabOf(OLED, oz + DZ, Z1 - DZ, P, 10, 0), { tone: "mid", inner: Ln(k.sideSeam(OLED, oz + DZ + 1.6, P, 10), { tone: "faint" }) }), [shape]);
    ctx.material = "";
  }
  {
    const SW = w - 13;
    const SD = d - 13;
    const SR = R - 6.5;
    const s = SW / 130; // the art was laid out for a 130-wide display
    const m = k.topMatrix([ox + sx, oy + sy], oz + Z2, P, "x");
    const rr = (x0, y0, x1, y1, r, style) => `<path d="${pl.roundRect(x0, y0, x1, y1, r, 8)}" style="${style}"/>`;
    const LY = -SD * 0.04;
    const ring = (rx, ry, deg, wd) => {
      const pts = (a, b) => Array.from({ length: 73 }, (_, i) => {
        const th = (i / 72) * Math.PI * 2;
        const c = Math.cos((deg * Math.PI) / 180);
        const sn = Math.sin((deg * Math.PI) / 180);
        const x = a * Math.cos(th);
        const y = b * Math.sin(th);
        return [x * c - y * sn, LY + x * sn + y * c];
      });
      return k.pathOf(pts(rx + wd / 2, ry + wd / 2), true) + k.pathOf(pts(rx - wd / 2, ry - wd / 2), true);
    };
    const logo = `<g data-part="${id}-logo"><path style="fill:var(--fx-react);fill-rule:evenodd;stroke:none" d="${ring(43 * s, 16.4 * s, 90, 3.8 * s) + ring(43 * s, 16.4 * s, 30, 3.8 * s) + ring(43 * s, 16.4 * s, 150, 3.8 * s)}"/></g><circle data-part="${id}-nucleus" cx="0" cy="${f2(LY)}" r="${f2(7.8 * s)}" style="fill:var(--fx-react);stroke:none"/>`;
    const ripple = `<circle data-part="${id}-ripple" cx="0" cy="${f2(LY)}" r="${f2(8 * s)}" style="fill:none;stroke:var(--fx-react);stroke-width:1.2;opacity:0"/>`;
    const glow = `<radialGradient id="${id}-glow" gradientUnits="userSpaceOnUse" cx="0" cy="${f2(LY)}" r="${f2(92 * s)}"><stop offset="0" stop-color="#2fb8e6" stop-opacity=".22"/><stop offset="1" stop-color="#2fb8e6" stop-opacity="0"/></radialGradient>`;
    const top = -SD / 2;
    const island = rr(-15.5 * s, top + 5 * s, 15.5 * s, top + 14 * s, 4.5 * s, "fill:#000;stroke:none") + `<circle cx="${f2(9.6 * s)}" cy="${f2(top + 9.5 * s)}" r="${f2(1.7 * s)}" style="fill:#1d2733;stroke:none"/>`;
    const sb = top + 11.6 * s; // status bar baseline
    const status = `<text x="${f2(-50 * s)}" y="${f2(sb)}" style="font:600 ${f2(5.4 * s)}px ui-sans-serif,system-ui,sans-serif;fill:#f2f3f5;letter-spacing:.1px">9:41</text>` +
      [0, 1, 2, 3].map((i) => `<rect x="${f2((30 + i * 2.1) * s)}" y="${f2(sb - 0.4 * s - (i + 1) * 1.1 * s)}" width="${f2(1.4 * s)}" height="${f2((i + 1) * 1.1 * s)}" rx="${f2(0.3 * s)}" style="fill:#f2f3f5;stroke:none"/>`).join("") +
      `<rect x="${f2(41 * s)}" y="${f2(sb - 5.2 * s)}" width="${f2(9.6 * s)}" height="${f2(4.8 * s)}" rx="${f2(1.3 * s)}" style="fill:none;stroke:#f2f3f5;stroke-width:.5;opacity:.7;vector-effect:none"/><rect x="${f2(42 * s)}" y="${f2(sb - 4.2 * s)}" width="${f2(6.4 * s)}" height="${f2(2.8 * s)}" rx="${f2(0.7 * s)}" style="fill:#f2f3f5;stroke:none"/>`;
    const home = rr(-22 * s, SD / 2 - 7.2 * s, 22 * s, SD / 2 - 5 * s, 1.1 * s, "fill:#e9eaee;stroke:none;opacity:.85");
    const glare = `<path d="M${f2(SW / 2 - 46 * s)} ${f2(top)}L${f2(SW / 2)} ${f2(top)}L${f2(SW / 2)} ${f2(top + 70 * s)}Z" style="fill:#fff;opacity:.05;stroke:none"/>`;
    // opts.controls: playback controls on the screen under the logo (real click targets, data-ctl="play" | "speed";
    // the page drives their state): a speed pill, a play/pause button, a four-cell device-buffer meter
    const ctl = (() => {
      if (!opts.controls) return "";
      const Y = LY + 64 * s;
      const r = 7.2 * s;
      const ink = "#f2f3f5";
      const pill = `<g data-ctl="speed" role="button" aria-label="speed"><rect x="${f2(-38 * s)}" y="${f2(Y - 5.4 * s)}" width="${f2(21 * s)}" height="${f2(10.8 * s)}" rx="${f2(5.4 * s)}" style="fill:#ffffff12;stroke:${ink};stroke-width:.8;stroke-opacity:.55"/><text data-ctl-text="speed" x="${f2(-27.5 * s)}" y="${f2(Y + 1.9 * s)}" text-anchor="middle" style="font:600 ${f2(5.4 * s)}px ui-sans-serif,system-ui,sans-serif;fill:${ink}">1×</text></g>`;
      const play = `<g data-ctl="play" role="button" aria-label="play or pause"><circle cx="0" cy="${f2(Y)}" r="${f2(r)}" style="fill:#ffffff12;stroke:${ink};stroke-width:.8;stroke-opacity:.55"/>` +
        `<g data-ctl-icon="pause"><rect x="${f2(-2.6 * s)}" y="${f2(Y - 3 * s)}" width="${f2(1.7 * s)}" height="${f2(6 * s)}" rx="${f2(0.4 * s)}" style="fill:${ink}"/><rect x="${f2(0.9 * s)}" y="${f2(Y - 3 * s)}" width="${f2(1.7 * s)}" height="${f2(6 * s)}" rx="${f2(0.4 * s)}" style="fill:${ink}"/></g>` +
        `<path data-ctl-icon="play" d="M${f2(-2 * s)} ${f2(Y - 3.4 * s)}L${f2(3.4 * s)} ${f2(Y)}L${f2(-2 * s)} ${f2(Y + 3.4 * s)}Z" style="fill:${ink};display:none"/></g>`;
      const cells = [0, 1, 2, 3].map((i) => `<rect data-ctl-cell="${i}" x="${f2((17 + i * 6.2) * s)}" y="${f2(Y - 1.8 * s)}" width="${f2(5.2 * s)}" height="${f2(3.6 * s)}" rx="${f2(0.8 * s)}" style="fill:#ffffff14;stroke:${ink};stroke-width:.6;stroke-opacity:.4"/>`).join("");
      return `<g data-part="${id}-controls">${pill}${play}<g data-ctl-meter="buffer">${cells}</g></g>`;
    })();
    const clipId = `${id}-display-clip`;
    const G0 = k.insetPlan({ x: -w / 2, y: -d / 2, w, d, r: R }, 0.8);
    const art = `<defs>${glow}<clipPath id="${clipId}"><path d="${pl.roundRect(-SW / 2, -SD / 2, SW / 2, SD / 2, SR, 8)}"/></clipPath></defs><g transform="${m}">` +
      `<path d="${pl.roundRect(G0.x, G0.y, G0.x + G0.w, G0.y + G0.d, G0.r, 8)}" style="fill:#16171b;stroke:none"/>` +
      `<g clip-path="url(#${clipId})"><path d="${pl.roundRect(-SW / 2, -SD / 2, SW / 2, SD / 2, SR, 8)}" style="fill:#0a0b0e;stroke:none"/><rect x="${f2(-SW / 2)}" y="${f2(-SD / 2)}" width="${SW}" height="${SD}" style="fill:url(#${id}-glow);stroke:none"/>${ripple}${logo}${status}${island}${home}${ctl}${glare}</g>` +
      `<path class="iso-line" data-tone="faint" d="${pl.roundRect(-SW / 2, -SD / 2, SW / 2, SD / 2, SR, 8)}"/></g>`;
    ctx.slab(N("display.glass"), GLASS, oz + Z1, Z2 - Z1, { tone: "hi" }, { steps: 10, bevel: 0.6, extra: art });
    ctx.data[`${id}:logo`] = { y: LY, s };
  }

  // ---------------------------------------------------------------- the fluff dispenser under the display
  const [dx, dy] = opts.dispenser ?? [-40, -118];
  ctx.material = "fx-react";
  const MP = plan(dx - 12, dy - 12, dx + 12, dy + 12, 2);
  ctx.slab(N("feed.plate"), MP, oz + DZ - 2.4, 2.4, { tone: "mid" }, { steps: 3, bevel: 0.3, extra: screwsY(dy + 12, [[dx - 8, DZ - 1.2], [dx + 8, DZ - 1.2]], 0.7, 0.36) + screwsX(dx + 12, [[dy - 8, DZ - 1.2], [dy + 8, DZ - 1.2]], 0.7, 0.36) });
  const TF = UPF(dx, dy);
  const NECK = opts.neck ?? 16; // a drop pipe, so the sight tube hangs clear of the display's edge
  const TUBE = { z0: DZ - 2.4 - NECK - 23.6, z1: DZ - 2.4 - NECK - 3, r: 3.8 };
  ctx.turned(N("feed.neck"), TF, [[oz + DZ - 2.4 - NECK, 3.4], [oz + DZ - 2.4, 3.4]], { tone: "mid" }, { inner: Ln(G.arcOf(TF, oz + DZ - 4.4, 3.4, P) + G.arcOf(TF, oz + DZ - NECK, 3.4, P), { tone: "faint" }) });
  ctx.turned(N("feed.collar.top"), TF, [[oz + TUBE.z1, 5.4], [oz + DZ - 2.4 - NECK, 5.4]], { tone: "mid" }, { inner: Ln(G.arcOf(TF, oz + TUBE.z1 + 1.5, 5.4, P), { tone: "faint" }) });
  {
    // the sight tube: glass you see the queued beads through
    const shape = ctx.record(ctx.A.cylinder(ox + dx, oy + dy, TUBE.r, oz + TUBE.z0, TUBE.z1 - TUBE.z0, { name: N("feed.tube") }));
    const paths = k.cylinder(ox + dx, oy + dy, TUBE.r, oz + TUBE.z0, TUBE.z1 - TUBE.z0, P, 32);
    const glint = k.fadeLineSvg([at(T(dx - TUBE.r * 0.5, dy + TUBE.r * 0.6, TUBE.z0 + 1.5)), at(T(dx - TUBE.r * 0.5, dy + TUBE.r * 0.6, TUBE.z1 - 1.5))], { fade: [3, 3], tone: "hi" });
    ctx.put(N("feed.tube"), T(dx, dy, (TUBE.z0 + TUBE.z1) / 2), `<g style="opacity:.42">${S(paths, { tone: "hi" })}</g>` + Ln(paths.outline, { tone: "mid" }), [shape]);
    ctx.slot(`${id}:tube`, { after: N("feed.tube") });
    ctx.data[`${id}:glint`] = glint; // drawn by the live code over the beads
  }
  ctx.turned(N("feed.collar.bottom"), TF, [[oz + TUBE.z0 - 3, 5.4], [oz + TUBE.z0, 5.4]], { tone: "mid" });
  const VB = { x0: dx - 7, x1: dx + 7, y0: dy - 6, y1: dy + 6, z0: TUBE.z0 - 14, z1: TUBE.z0 - 3 };
  box("feed.valve", [VB.x0, VB.y0, VB.z0], [VB.x1, VB.y1, VB.z1], { tone: "mid" }, {
    r: 1.4,
    steps: 3,
    bevel: 0.4,
    inner: Ln(k.sideSeam(plan(VB.x0, VB.y0, VB.x1, VB.y1, 1.4), oz + VB.z1 - 1.6, P, 3), { tone: "faint" }),
    extra: screwsY(VB.y1, [[VB.x0 + 1.8, VB.z0 + 1.6], [VB.x1 - 1.8, VB.z0 + 1.6]], 0.7, 0.38),
  });
  const VC = [dx, VB.y1, (VB.z0 + VB.z1) / 2];
  const GF = G.frameOf(T(...VC), [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  ctx.turned(N("feed.glass"), GF, [[0, 4.6], [1.2, 4.6], [1.2, 3.7], [1.5, 3.7]], { tone: "mid" }, {
    extra: `<path class="iso-fill" style="fill:#121418" d="${G.circleOf(GF, 1.5, 3.7, P, 40)}"/>` + Ln(G.circleOf(GF, 1.5, 3.7, P, 40) + G.circleOf(GF, 1.5, 0.9, P, 16), { tone: "mid" }) + Dots(G.dotsOf(GF, 1.2, 4.15, 4, P, { all: true, phase: Math.PI / 4 }), { size: 0.4, tone: "lo" }),
  });
  ctx.slot(`${id}:rotor`, { after: N("feed.glass") });
  const MF = G.frameOf(T(VB.x1, dy, VC[2]), [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  ctx.turned(N("feed.motor"), MF, [[0, 4.4], [1.2, 4.4], [1.2, 3.8], [9.6, 3.8], [9.6, 3.2], [10.6, 2.8, 1], [11.2, 1.6, 1], [11.4, 0, 1]], { tone: "mid" }, {
    inner: k.fadedSvg(G.ribsOf(MF, 2.4, 8.4, 3.8, 18, P, { fade: [0.1, 0.55], seams: true }), { tone: "lo" }),
  });
  const NZ = G.frameOf(T(dx, dy, VB.z0), [0, 0, -1], [1, 0, 0], [0, 1, 0]);
  ctx.turned(N("feed.nozzle"), NZ, [[0, 4], [1.4, 4], [1.4, 2.9], [7.4, 2.5], [7.4, 3.2], [9.4, 3.2], [9.4, 2.6], [11, 2.6]], { tone: "mid" }, {
    inner: k.fadedSvg(G.ribsOf(NZ, 7.4, 9.4, 3.2, 16, P, { fade: [0.1, 0.55], seams: true }), { tone: "lo" }),
  });
  ctx.material = "";
  ctx.slot(`${id}:spout`, { before: N("feed.nozzle") });
  const TIP = VB.z0 - 11;

  // the sight tube's window, as a screen clip (between the collars)
  const tubeClip = (() => {
    const pts = [];
    for (const z of [TUBE.z0, TUBE.z1]) for (let i = 0; i < 48; i++) pts.push(at(T(dx + TUBE.r * Math.cos((i / 48) * Math.PI * 2), dy + TUBE.r * Math.sin((i / 48) * Math.PI * 2), z)));
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [];
    for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    const hi = [];
    for (const p of [...pts].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
    return k.pathOf([...lo.slice(0, -1), ...hi.slice(0, -1)], true);
  })();
  ctx.back.push(`<defs><clipPath id="${id}-tube-clip"><path d="${tubeClip}"/></clipPath></defs>`);

  ctx.data[id] = {
    ports: { fluff: T(dx, dy, TIP) },
    tube: { x: ox + dx, y: oy + dy, z0: oz + TUBE.z0, z1: oz + TUBE.z1, top: oz + TUBE.z1 + 2.6, clip: `${id}-tube-clip`, glint: ctx.data[`${id}:glint`] },
    valve: T(dx, dy, VB.z0 + 1),
    tip: T(dx, dy, TIP),
    rotor: { o: T(...VC), s: 1.5, r0: 0.9, r1: 3.7 },
    logo: ctx.data[`${id}:logo`],
    interior: { x0: ox - w / 2 + TH, x1: ox + w / 2 - TH, y0: oy - d / 2 + TH, y1: oy + d / 2 - TH, floor: oz, top: oz + H, lip: oz + CUT },
    display: { z: oz + DZ, top: oz + Z2, shift: [sx, sy] },
  };
  delete ctx.data[`${id}:logo`];
  delete ctx.data[`${id}:glint`];
}

// a catch tray on a post, for a standalone page: receives falling items (item.v) and lets them settle in a small pile
export function buildTray(ctx, origin = [0, 0, 0], opts = {}) {
  const id = opts.id ?? "tray";
  const { k, G, P, at, Ln, Dots } = ctx;
  const [ox, oy, oz] = origin;
  const TZ = opts.height ?? 60;
  const T = (x, y, z) => [ox + x, oy + y, oz + z];
  const N = (name) => `${id}.${name}`;
  const box = (name, a, b, style, o) => ctx.box(N(name), T(...a), T(...b), style, o);
  const PF = G.frameOf(T(0, 0, 0), [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  const BASE = { x: ox - 9, y: oy - 9, w: 18, d: 18, r: 2 };
  ctx.slab(N("base"), BASE, oz, 2.4, { tone: "lo" }, { steps: 3, bevel: 0.4 });
  for (const [x, y] of k.corners(BASE, 3)) {
    ctx.cyl(N("washer"), x, y, 1.9, oz + 2.4, 0.4, { tone: "mid" }, { steps: 16 });
    ctx.cyl(N("nut"), x, y, 1.4, oz + 2.8, 1.4, { tone: "mid" }, { steps: 6, extra: Dots([at([x, y, oz + 4.2])], { size: 0.4, tone: "lo" }) });
  }
  ctx.turned(N("post"), PF, [[oz + 2.4, 2.6], [oz + TZ - 3, 2.6]], { tone: "mid" }, { inner: Ln(G.arcOf(PF, oz + 6, 2.6, P), { tone: "faint" }) });
  ctx.turned(N("head"), PF, [[oz + TZ - 3, 4.6], [oz + TZ - 1.5, 4.6]], { tone: "mid" });
  const TP = { x0: -12, x1: 12, y0: -10, y1: 10 };
  box("floor", [TP.x0 + 1, TP.y0 + 1, TZ - 1.5], [TP.x1 - 1, TP.y1 - 1, TZ], { tone: "lo" }, { r: 0.3, steps: 2 });
  box("wall.back", [TP.x0, TP.y0, TZ - 1.5], [TP.x1, TP.y0 + 1, TZ + 4], { tone: "mid" }, { r: 0.3, steps: 2 });
  box("wall.left", [TP.x0, TP.y0 + 1, TZ - 1.5], [TP.x0 + 1, TP.y1 - 1, TZ + 4], { tone: "mid" }, { r: 0.3, steps: 2 });
  box("wall.right", [TP.x1 - 1, TP.y0 + 1, TZ - 1.5], [TP.x1, TP.y1 - 1, TZ + 4], { tone: "mid" }, { r: 0.3, steps: 2 });
  box("wall.front", [TP.x0, TP.y1 - 1, TZ - 1.5], [TP.x1, TP.y1, TZ + 2.6], { tone: "mid" }, { r: 0.3, steps: 2, bevel: 0.2 });
  ctx.slot(`${id}:pile`, { after: N("floor") });
  ctx.slot(`${id}:fall`, { after: N("wall.front") });
  ctx.data[id] = { ports: { in: T(0, 0, TZ) }, floor: oz + TZ, rim: oz + TZ + 4, x: ox, y: oy, half: [TP.x1 - 4, TP.y1 - 4] };
}

export const LIVE = String.raw`
MACHINES.phone = (api) => {
  const D = api.data;
  const tubeG = api.slot("tube");
  const spoutG = api.slot("spout");
  const rotorG = api.slot("rotor");
  tubeG.setAttribute("clip-path", "url(#" + D.tube.clip + ")");
  const logo = api.el('[data-part="' + api.id + '-logo"]');
  const nucleus = api.el('[data-part="' + api.id + '-nucleus"]');
  const ripple = api.el('[data-part="' + api.id + '-ripple"]');
  const RF = G.frameOf(D.rotor.o, [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  const BEAD = 2.2;
  const PITCH = BEAD * 2 + 0.3;
  const GRAVITY = 900; // world units / s²
  const SLOTS = Math.floor((D.tube.z1 - D.tube.z0) / PITCH);
  const queue = [];   // beads in the sight tube, bottom first
  const spout = [];   // beads between the valve and the nozzle tip
  let nextBurst = 1.0;
  let nextRelease = 1.8;
  let rotor = 0;
  let rotorTarget = 0;
  let spin = 0;
  let tap = 9;
  let sent = 0;
  let stillDrawn = false;
  let holdBeads = false;
  const rand = (a, b) => a + Math.random() * (b - a);
  const LS = D.logo.s;
  function drawScreen() {
    logo.setAttribute("transform", "rotate(" + ((spin * 180) / Math.PI).toFixed(2) + " 0 " + D.logo.y.toFixed(2) + ")");
    const tr = api.clamp(tap / 0.9, 0, 1);
    ripple.setAttribute("r", ((8 + 46 * (1 - Math.pow(1 - tr, 2))) * LS).toFixed(2));
    ripple.style.opacity = ((1 - tr) * 0.9).toFixed(3);
    nucleus.setAttribute("r", ((7.8 + 1.6 * Math.exp(-tap / 0.18)) * LS).toFixed(2));
  }
  function drawBeads() {
    tubeG.innerHTML = queue.map((b) => api.fluffSvg([D.tube.x, D.tube.y, b.z], BEAD)).join("") + D.tube.glint;
    spoutG.innerHTML = spout.map((b) => api.fluffSvg([D.tip[0], D.tip[1], b.z], BEAD)).join("");
    rotorG.innerHTML = lineSvg(G.spokesOf(RF, D.rotor.s, D.rotor.r0, D.rotor.r1, 6, api.P, { phase: rotor }), { tone: "mid" });
  }
  return {
    get queued() { return queue.length; },
    get sent() { return sent; },
    // a tap on the screen from outside (the assembly's Space key): the next tick sends a burst
    tap() { nextBurst = 0; },
    // the assembly holds the valve while the display is not at rest above the case (a bead must not fall between
    // two parts that are moving apart)
    set hold(v) { holdBeads = !!v; },
    get hold() { return holdBeads; },
    tick(dt, t) {
      if (api.calm()) {
        // reduced motion: one representative still frame (three calls waiting in the tube), nothing moves or leaves
        if (!stillDrawn) {
          stillDrawn = true;
          queue.length = 0;
          spout.length = 0;
          for (let i = 0; i < 3; i++) queue.push({ z: D.tube.z0 + i * PITCH, v: 0, slot: i });
          spin = 0;
          tap = 9;
          drawScreen();
          drawBeads();
        }
        return;
      }
      stillDrawn = false;
      // a tap on the screen sends a burst of calls down into the sight tube
      if (t >= nextBurst) {
        nextBurst = t + rand(2.6, 3.6);
        const room = SLOTS - queue.length;
        const n = Math.min(room, 2 + Math.floor(Math.random() * 2));
        if (n > 0) {
          tap = 0;
          for (let i = 0; i < n; i++) queue.push({ z: D.tube.top + i * PITCH, v: 0 });
          api.announce(n + " calls leave the screen");
        }
      }
      // beads fall down the tube onto the one below (or the valve)
      queue.forEach((b, i) => {
        const rest = D.tube.z0 + i * PITCH;
        if (b.z > rest) {
          b.v += GRAVITY * dt;
          b.z = Math.max(rest, b.z - b.v * dt);
          if (b.z === rest) b.v = 0;
        }
      });
      // the star valve takes the bottom bead: one pocket per bead
      const bottom = queue[0];
      if (bottom && t >= nextRelease && !holdBeads && bottom.z <= D.tube.z0 + 0.01) {
        nextRelease = t + rand(0.9, 1.25);
        queue.shift();
        rotorTarget += Math.PI / 3;
        spout.push({ item: api.item("fluff"), z: D.valve[2], v: 0, wait: 0.28 });
      }
      rotor += (rotorTarget - rotor) * (1 - Math.exp(-dt / 0.1));
      // then it drops through the nozzle; the moment it clears the tip it is handed on, still falling
      for (let i = spout.length - 1; i >= 0; i--) {
        const b = spout[i];
        if (b.wait > 0) { b.wait -= dt; continue; }
        b.v += GRAVITY * dt;
        b.z -= b.v * dt;
        if (b.z + BEAD * 2 < D.tip[2]) {
          spout.splice(i, 1);
          sent++;
          b.item.v = [0, 0, -b.v];
          api.emit("fluff", b.item, [D.tip[0], D.tip[1], b.z]);
        }
      }
      // the screen: the React logo turns slowly; a burst sends a tap ripple out from the nucleus
      spin += dt * 0.32;
      tap += dt;
      drawScreen();
      drawBeads();
    },
  };
};
MACHINES.catchTray = (api) => {
  const D = api.data;
  const fallG = api.slot("fall");
  const pileG = api.slot("pile");
  const BEAD = 2.2;
  const GRAVITY = 900;
  const falling = [];
  const pile = [];
  const spots = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) spots.push([D.x + i * 5.2, D.y + j * 5.2]);
  let still = false;
  const freeSpot = () => {
    const used = new Set(pile.map((p) => p.spot));
    const free = spots.map((_, i) => i).filter((i) => !used.has(i));
    return free.length ? free[Math.floor(Math.random() * free.length)] : -1;
  };
  return {
    accept(port, item, from) {
      if (api.calm()) return;
      const p = from ?? [D.x, D.y, D.rim + 40];
      falling.push({ item, x: p[0], y: p[1], z: p[2], v: item.v ? -item.v[2] : 0 });
    },
    tick(dt, t) {
      if (api.calm()) {
        if (!still) {
          still = true;
          fallG.innerHTML = "";
          pileG.innerHTML = [0, 4, 7].map((i) => api.fluffSvg([spots[i][0], spots[i][1], D.floor], BEAD)).join("");
        }
        return;
      }
      still = false;
      for (let i = falling.length - 1; i >= 0; i--) {
        const f = falling[i];
        f.v += GRAVITY * dt;
        f.z -= f.v * dt;
        if (f.z <= D.floor) {
          falling.splice(i, 1);
          let spot = freeSpot();
          if (spot < 0) {
            pile.sort((a, b) => a.born - b.born);
            spot = pile.shift().spot;
          }
          // lands where it fell, hops once and rolls to its place in the pile
          pile.push({ x: f.x, y: f.y, x0: f.x, y0: f.y, spot, born: t, hop: Math.min(1.6, f.v * 0.01) });
        }
      }
      for (let i = pile.length - 1; i >= 0; i--) if (t - pile[i].born > 9) pile.splice(i, 1);
      fallG.innerHTML = falling.filter((f) => f.z > D.rim).map((f) => api.fluffSvg([f.x, f.y, f.z], BEAD)).join("");
      const low = falling.filter((f) => f.z <= D.rim).map((f) => ({ x: f.x, y: f.y, z: f.z, a: 1 }));
      const rest = pile.map((p) => {
        const age = t - p.born;
        const u = api.smooth(0, 0.45, age);
        const [sx, sy] = spots[p.spot];
        const z = D.floor + p.hop * Math.abs(Math.sin(age * 14)) * Math.exp(-age / 0.09);
        return { x: p.x0 + (sx - p.x0) * u, y: p.y0 + (sy - p.y0) * u, z, a: 1 - api.smooth(6.5, 9, age) };
      });
      pileG.innerHTML = [...low, ...rest].sort((a, b) => a.x + a.y - (b.x + b.y)).map((b) => '<g opacity="' + b.a.toFixed(2) + '">' + api.fluffSvg([b.x, b.y, b.z], BEAD) + "</g>").join("");
    },
  };
};`;
