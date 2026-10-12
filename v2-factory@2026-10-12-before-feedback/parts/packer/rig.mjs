// Packer rig: convex prisms in any frame, stadium links, the two arms (IK + parts) and the carton.
// makeRig is self-contained on purpose: packer.mjs injects its source into the page with toString(), so
// the build and the live page draw the moving parts with exactly the same code.
export function makeRig(K, G, P) {
  const V = G.viewOf(P);
  const cam = K.cameraOf(P);
  const L = G.unit3([-cam.sinA, cam.cosA, 1.2]);
  const BANDS = [0, 0.2, 0.42, 0.62];
  const band = (score) => {
    let tone = 0;
    while (tone < BANDS.length && score >= BANDS[tone]) tone++;
    return tone;
  };
  const at = (p) => K.iso(p, P);
  const depth = (p) => G.dot3(p, V);
  const Z = [0, 0, 1];
  const X = [1, 0, 0];
  const Y = [0, 1, 0];
  const add = (...vs) => vs.reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
  const mul = G.mul3;
  const S = (paths, style) => K.solidSvg(paths, { tone: "mid", ...style });
  const Ln = (d, style) => K.lineSvg(d, style);

  function hull(points) {
    const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-9) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-9) upper.pop();
      upper.push(p);
    }
    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
  }

  // a convex polygon [[p, q]] in the frame's (a, v) plane, extruded along u from u0 to u1
  function prism(F, poly, u0, u1) {
    const area = poly.reduce((s, [p0, q0], i) => {
      const [p1, q1] = poly[(i + 1) % poly.length];
      return s + p0 * q1 - p1 * q0;
    }, 0);
    const ring = area > 0 ? poly : [...poly].reverse();
    const n = ring.length;
    const W3 = ([p, q], u) => add(F.o, mul(F.a, p), mul(F.v, q), mul(F.u, u));
    const lo = ring.map((pq) => at(W3(pq, u0)));
    const hi = ring.map((pq) => at(W3(pq, u1)));
    const buckets = [[], [], [], [], []];
    const normals = ring.map(([p0, q0], i) => {
      const [p1, q1] = ring[(i + 1) % n];
      return G.unit3(add(mul(F.a, q1 - q0), mul(F.v, -(p1 - p0))));
    });
    const seen = normals.map((m) => G.dot3(m, V) > 1e-6);
    for (let i = 0; i < n; i++) if (seen[i]) buckets[band(G.dot3(normals[i], L))].push(K.pathOf([lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i]], true));
    const caps = [[lo, mul(F.u, -1)], [hi, F.u]];
    const capSeen = caps.map(([, m]) => G.dot3(m, V) > 1e-6);
    caps.forEach(([pts, m], i) => capSeen[i] && buckets[band(G.dot3(m, L))].push(K.pathOf(pts, true)));
    const crease = [];
    for (let i = 0; i < n; i++) {
      const prev = (i - 1 + n) % n;
      const sharp = G.dot3(normals[i], normals[prev]) < Math.cos(0.35);
      if (sharp && seen[i] && seen[prev]) crease.push(K.pathOf([lo[i], hi[i]]));
      caps.forEach(([pts], c) => capSeen[c] && seen[i] && crease.push(K.pathOf([pts[i], pts[(i + 1) % n]])));
    }
    const outline = K.pathOf(hull([...lo, ...hi]), true);
    return { fill: outline, outline, crease: crease.join(""), top: buckets[4].join(""), shades: buckets.slice(0, 4).map((b) => b.join("")) };
  }
  const rect = (p0, p1, q0, q1) => [[p0, q0], [p1, q0], [p1, q1], [p0, q1]];
  // a slot shape from p = 0 to p = len with round ends of radius r
  function stadium(len, r, steps = 10) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / steps;
      pts.push([len + r * Math.cos(a), r * Math.sin(a)]);
    }
    for (let i = 0; i <= steps; i++) {
      const a = Math.PI / 2 + (Math.PI * i) / steps;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    return pts;
  }
  const frame = (o, a, u, v) => ({ o, a, u, v });
  // an inset slot outline on whichever cap face of a link prism looks at the viewer
  function recess(F, len, r, u0, u1, inset = 0.7) {
    const face = G.dot3(F.u, V) >= 0 ? u1 : u0;
    const pts = stadium(len - 2 * r, r - inset, 8).map(([p, q]) => at(add(F.o, mul(F.a, p + r), mul(F.v, q), mul(F.u, face))));
    return Ln(K.pathOf(pts, true), { tone: "faint" });
  }
  const cap = (centre, axis, s0, s1, r, style = {}, steps = 24) => S(G.disc(s0, s1, r, G.frameAlong(centre, axis), P, { steps }), style);

  // ---- arms ---------------------------------------------------------------------------------------
  // spec: { S: shoulder point, yokeZ: top of the turret, L1, L2, off: tool offset along n, r1, r2 }
  function solve(spec, W) {
    const dx = W[0] - spec.S[0];
    const dy = W[1] - spec.S[1];
    const flat = Math.hypot(dx, dy);
    const r = Math.sqrt(Math.max(1e-6, flat * flat - spec.off * spec.off));
    const side = spec.side ?? 1;
    const yaw = Math.atan2(dy, dx) - side * Math.atan2(spec.off, r);
    const h = W[2] - spec.S[2];
    const D = Math.min(spec.L1 + spec.L2 - 0.05, Math.hypot(r, h));
    const phi = Math.atan2(h, r);
    const beta = Math.acos(Math.max(-1, Math.min(1, (spec.L1 * spec.L1 + D * D - spec.L2 * spec.L2) / (2 * spec.L1 * D))));
    const a1 = phi + beta;
    const dir = [Math.cos(yaw), Math.sin(yaw), 0];
    const n = [-side * Math.sin(yaw), side * Math.cos(yaw), 0];
    const e1 = add(mul(dir, Math.cos(a1)), mul(Z, Math.sin(a1)));
    const E = add(spec.S, mul(e1, spec.L1));
    const Wp = add(spec.S, mul(dir, r), mul(Z, h));
    const e2 = G.unit3(G.sub3(Wp, E));
    return { yaw, a1, dir, n, e1, e2, E, Wp, W: add(Wp, mul(n, spec.off)) };
  }

  // a drag chain: a dark carrier strip on stand-offs with fine links riding on it, from s0 to s1 along a
  // link face at layer [u0, u1]; the cable enters and leaves through the end brackets
  function chain(F, s0, s1, q, u0, u1, parts, layer) {
    const pitch = 1.25;
    const count = Math.max(3, Math.floor((s1 - s0) / pitch));
    const end = s0 + count * pitch;
    const g = (svg) => '<g class="it fx-graphite">' + svg + "</g>";
    const um = u0 + (u1 - u0) * 0.4;
    parts.push({ layer: (u0 + um) / 2, d: depth(add(F.o, mul(F.a, (s0 + end) / 2))), svg: g(S(prism(F, rect(s0, end, q - 0.5, q + 0.5), u0, um), { tone: "lo" })) });
    for (let i = 0; i < count; i++) {
      const p = s0 + i * pitch;
      parts.push({ layer: (um + u1) / 2, d: depth(add(F.o, mul(F.a, p + pitch / 2), mul(F.v, q))), svg: g(S(prism(F, rect(p + 0.1, p + pitch - 0.1, q - 0.8, q + 0.8), um - 0.1, u1), { tone: i % 2 ? "mid" : "hi" })) });
    }
    for (const p of [s0 - 1, end + 0.2]) parts.push({ layer, d: depth(add(F.o, mul(F.a, p))), svg: S(prism(F, rect(p, p + 0.8, q - 1.1, q + 1.1), u0 - 0.1, u1 + 0.1), { tone: "mid" }) });
  }

  // all parts of one arm in pose q, ordered for painting; tool(pose) returns tool parts [{ z, d, svg }]
  function armSvg(spec, q, tool) {
    const { dir, n, e1, e2, E, Wp } = q;
    const s = G.dot3(n, V) >= 0 ? 1 : -1;
    const plates = [];
    const push = (layer, centre, svg) => plates.push({ layer, d: depth(centre), svg });
    const SP = spec.S;
    // rotating yoke plate on the turret, with two bolt heads that turn with it
    const yokeF = G.frameAlong([SP[0], SP[1], spec.yokeZ], Z);
    let first = S(G.disc(0, 1.1, spec.yokeR, yokeF, P, { steps: 40 }), { tone: "mid" });
    first += K.dotsSvg([mul(dir, 3.8), mul(dir, -3.8), mul(n, 3.8), mul(n, -3.8)].map((o) => at(add([SP[0], SP[1], spec.yokeZ + 1.1], o))), { size: 0.45 });
    // cheeks: a slab with a round top around the shoulder axis
    const cheekF = frame(SP, dir, n, Z);
    const below = spec.yokeZ + 1.1 - SP[2];
    const cheek = [[-2.6, below], [2.6, below], ...Array.from({ length: 11 }, (_, i) => [2.6 * Math.cos((Math.PI * i) / 10), 2.6 * Math.sin((Math.PI * i) / 10)])];
    push(-2.4, add(SP, mul(n, -2.4), [0, 0, -1]), S(prism(cheekF, cheek, -3.0, -1.8), { tone: "mid" }));
    push(2.4, add(SP, mul(n, 2.4), [0, 0, -1]), S(prism(cheekF, cheek, 1.8, 3.0), { tone: "mid" }));
    push(3.3, add(SP, mul(n, 3.3)), cap(SP, n, 3.0, 3.6, 1.5, { tone: "hi" }));
    // shoulder servo can on the far cheek, with a ribbed end cap
    push(-5.1, add(SP, mul(n, -5.1)), cap(SP, n, -6.8, -3.0, 2.3, { tone: "hi" }) + cap(SP, n, -7.4, -6.8, 1.6, { tone: "mid" }));
    // link 1 (centre layer) and its drag chain on the far face
    const F1 = frame(SP, e1, n, add(mul(dir, -Math.sin(q.a1)), mul(Z, Math.cos(q.a1))));
    push(0, add(SP, mul(e1, spec.L1 / 2)), S(prism(F1, stadium(spec.L1, spec.r1), -1.6, 1.6), { tone: "hi", inner: recess(F1, spec.L1, spec.r1, -1.6, 1.6) }));
    chain(F1, 6, spec.L1 - 5, 0, -3.0, -1.8, plates, -2.4);
    // elbow: servo on link 1's far face, caps on both sides
    push(-1.9, add(E, mul(n, -1.9)), cap(E, n, -2.2, -1.6, 1.6, { tone: "mid" }));
    push(-3.5, add(E, mul(n, -3.5)), cap(E, n, -4.9, -2.2, 2.0, { tone: "hi" }));
    // link 2 sits beside link 1 on the near side of the elbow
    const a2 = Math.atan2(e2[2], G.dot3(e2, dir));
    const F2 = frame(add(E, mul(n, 0)), e2, n, add(mul(dir, -Math.sin(a2)), mul(Z, Math.cos(a2))));
    const L2 = G.len3(G.sub3(Wp, E));
    push(3.1, add(E, mul(e2, L2 / 2), mul(n, 3.1)), S(prism(F2, stadium(L2, spec.r2), 1.8, 4.4), { tone: "hi", inner: recess(F2, L2, spec.r2, 1.8, 4.4, 0.6) }));
    chain(F2, 4, L2 - 5, 0, 4.4, 5.6, plates, 5.0);
    push(4.7, add(E, mul(n, 4.7)), cap(E, n, 4.4, 5.0, 1.4, { tone: "mid" }));
    push(1.5, add(Wp, mul(n, 1.5)), cap(Wp, n, 1.2, 1.8, 1.3, { tone: "mid" }));
    push(4.7, add(Wp, mul(n, 4.7)), cap(Wp, n, 4.4, 5.0, 1.3, { tone: "mid" }));
    push(6.0, add(Wp, mul(n, 6.0)), cap(Wp, n, 5.0, 7.0, 1.7, { tone: "hi" }));
    plates.sort((a, b) => a.layer * s - b.layer * s || a.d - b.d);
    const toolParts = tool(q).sort((a, b) => a.z - b.z || a.d - b.d);
    return first + toolParts.map((p) => p.svg).join("") + plates.map((p) => p.svg).join("");
  }

  // ---- carton -------------------------------------------------------------------------------------
  // c: { x, y, z, H, flaps: [-x, +x, -y, +y] angles (0 closed … π/2 upright … ~2 open) }, inside: [{ d, svg }]
  const CW = 10;
  const CD = 8;
  const WALL = 0.5;
  const FLAP = 0.4;
  function flapSvg(c, side, angle) {
    const x0 = c.x - CW / 2;
    const x1 = c.x + CW / 2;
    const y0 = c.y - CD / 2;
    const y1 = c.y + CD / 2;
    const zt = c.z + c.H - FLAP;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    let o, inward, hinge, len, half;
    if (side === 0) [o, inward, hinge, len, half] = [[x0, c.y, zt], X, Y, 3.6, CD / 2 - WALL - 0.1];
    if (side === 1) [o, inward, hinge, len, half] = [[x1, c.y, zt], mul(X, -1), Y, 3.6, CD / 2 - WALL - 0.1];
    if (side === 2) [o, inward, hinge, len, half] = [[c.x, y0, zt], Y, X, CD / 2, CW / 2];
    if (side === 3) [o, inward, hinge, len, half] = [[c.x, y1, zt], mul(Y, -1), X, CD / 2, CW / 2];
    const a = add(mul(inward, ca), mul(Z, sa));
    const v = add(mul(inward, -sa), mul(Z, ca));
    const F = frame(o, a, hinge, v);
    const tip = add(o, mul(a, len * 0.5), mul(v, FLAP / 2));
    return { d: depth(tip), svg: S(prism(F, rect(0, len, 0, FLAP), -half, half), { tone: "hi", crease: "lo" }) };
  }
  function cartonSvg(c, inside = []) {
    const x0 = c.x - CW / 2;
    const y0 = c.y - CD / 2;
    const zw = c.H - FLAP;
    const wall = (plan) => S(K.slabOf({ ...plan, r: 0 }, c.z, zw, P, 1), { tone: "hi", crease: "lo" });
    const out = [];
    const flaps = c.flaps.map((angle, side) => ({ side, angle, ...flapSvg(c, side, angle) }));
    const outside = (f) => f.angle > Math.PI / 2 + 0.02;
    for (const f of flaps) if (outside(f) && (f.side === 0 || f.side === 2)) out.push(f.svg);
    out.push(S(K.slabOf({ x: x0, y: y0, w: CW, d: CD, r: 0 }, c.z, WALL, P, 1), { tone: "hi", crease: "lo" }));
    out.push(wall({ x: x0, y: y0, w: WALL, d: CD }));
    out.push(wall({ x: x0, y: y0, w: CW, d: WALL }));
    out.push(...[...inside].sort((a, b) => a.d - b.d).map((i) => i.svg));
    out.push(wall({ x: x0 + CW - WALL, y: y0, w: WALL, d: CD }));
    out.push(wall({ x: x0, y: y0 + CD - WALL, w: CW, d: WALL }));
    for (const f of flaps) if (outside(f) && (f.side === 1 || f.side === 3)) out.push(f.svg);
    const closing = flaps.filter((f) => !outside(f)).sort((a, b) => Math.floor(a.side / 2) - Math.floor(b.side / 2) || a.d - b.d);
    out.push(...closing.map((f) => f.svg));
    return out.join("");
  }
  // the closed carton: the same solid and lines as the shared packetSvg, tape and band partly laid
  function closedSvg(c, tape = 1, bandAlpha = 1) {
    const plan = { x: c.x - CW / 2, y: c.y - CD / 2, w: CW, d: CD, r: 0.6 };
    let lines = "";
    if (bandAlpha > 0.02) lines += `<g opacity="${Math.min(1, bandAlpha).toFixed(2)}">${Ln(K.sideSeam(plan, c.z + c.H * 0.55, P, 2), { tone: "lo" })}</g>`;
    if (tape > 0.02) lines += Ln(K.lineOnTop([c.x - CW / 2, c.y], [c.x - CW / 2 + CW * Math.min(1, tape), c.y], c.z + c.H, P), { tone: "lo" });
    return K.solidSvg(K.slabOf(plan, c.z, c.H, P, 2, 0.3), { tone: "hi" }) + lines;
  }

  return { V, L, at, depth, add, mul, X, Y, Z, S, Ln, prism, rect, stadium, frame, cap, solve, armSvg, cartonSvg, closedSvg, CW, CD, WALL, FLAP };
}
