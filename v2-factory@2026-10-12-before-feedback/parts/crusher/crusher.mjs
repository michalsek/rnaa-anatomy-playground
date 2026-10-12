// Crusher: the Disposer thread. A double-roll crusher that destroys the packets the audio thread swapped out,
// off the audio thread. Built in local coordinates (origin = machine centre on the floor), placed by `origin`.
//
// Layout (local): roller axes run along x; the feed hopper opens toward −y where belt C ends (y ≈ −26, z 40);
// the drive (flywheel, V-belt, motor) is on the +x side, the control box on the −x side, the bin in front (+y).

const ROLLER = { r: 5.5, axisZ: 23, ys: [-6, 6], x0: -13, x1: 13, rings: 7, ringW: 2.6, gapW: 1.0, endR: 4.2, rootR: 4.8 };
const HOPPER = { z0: 30, backTop: 37, frontTop: 34, flare: 4 };
const FLY = { x: 21.6, r: 10, w: 4, hub: 2.4, holes: 6, holeR: 1.5, holeAt: 5.9 };
const MOTOR = { y: -24, z: 9.6, x: 26, pulleyR: 3.5 };
const BELT_R = 0.7;
const BIN = { x0: -12, x1: 12, y0: 20, y1: 40, floorZ: 2.6, rimZ: 10, wall: 1.2, travel: 16 };
const CHUTE = { x0: -11, x1: 11, y0: -13, y1: 28, z0: 17, z1: 11.6 };
const SPRING = { x: 18.8, z: 23, y0: 10, y1: 19, r: 1.75, turns: 5.5 };
const DIAL = { x: -32, y: 11.6, z: 26.5, r: 3.6, face: 0.9 };
const LAMP = { x: -32, y: 5, z: 32 };
const PILE_MAX = 5.4;

export function build(ctx, [ox, oy, oz] = [0, 0, 0], { id = "crusher" } = {}) {
  const { k, G, A, P, S, Ln, Dots, at } = ctx;
  const W = ([x, y, z]) => [ox + x, oy + y, oz + z];
  const N = (name) => `${id}.${name}`;
  const box = (name, a, b, style = {}, opts = {}) => ctx.box(N(name), W(a), W(b), style, opts);
  const cyl = (name, x, y, r, z0, h, style = {}, opts = {}) => ctx.cyl(N(name), ox + x, oy + y, r, oz + z0, h, style, opts);
  const plan = (x0, y0, x1, y1, r = 0.6) => ({ x: ox + x0, y: oy + y0, w: x1 - x0, d: y1 - y0, r });
  const FX = (x, y, z) => G.frameOf(W([x, y, z]), [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const FY = (x, y, z) => G.frameOf(W([x, y, z]), [0, 1, 0], [0, 0, 1], [1, 0, 0]);
  const FZ = (x, y, z) => G.frameOf(W([x, y, z]), [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  const turned = (name, F, profile, style = {}, opts = {}) => ctx.turned(N(name), F, profile, style, opts);
  // a plate along x with any convex cross-section in the (y, z) plane: sloped hopper walls, chute floor, cheeks
  const plateX = (name, x0, x1, poly, style = {}, { extra = "", inner = "", bias = 0, attrs } = {}) => {
    const F = FX(x0, 0, 0);
    const shape = ctx.record(A.prism(F, poly, 0, x1 - x0, { name: N(name) }));
    const cy = poly.reduce((a, p) => a + p[0], 0) / poly.length;
    const cz = poly.reduce((a, p) => a + p[1], 0) / poly.length;
    ctx.put(N(name), W([(x0 + x1) / 2, cy, cz]), S(G.prismOf(F, poly, 0, x1 - x0, P), { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
  };
  // screws on a vertical face: +x face (axis "x") or +y face (axis "y"), a ring and a dot each
  const faceScrews = (axis, points, { ring = 0.8, size = 0.45 } = {}) => {
    const frame = (p) => (axis === "x" ? FX(...p) : FY(...p));
    return Ln(points.map((p) => G.circleOf(frame(p), 0, ring, P, 14)).join(""), { tone: "lo" }) + Dots(points.map((p) => at(W(p))), { size });
  };
  const halo = (p, z, h) => ctx.back.push(`<path class="iso-halo" d="${k.haloOf(p, oz + z, h, P)}"/>`);

  const keep = ctx.material;
  halo(plan(-19, -24, 19, 26, 3), -1.5, 3);
  ctx.back.push(`<path class="iso-halo" data-bin="${id}" d="${k.haloOf(plan(-13, 19, 13, 41, 2), oz - 1, 2, P)}"/>`);
  halo(plan(-36, 1, -28, 9, 2), -1, 2);
  halo(plan(25, -31, 40, -17, 2), -1, 2);

  // ---- base: skid rails on feet, cross members ----------------------------------------------------------------
  ctx.material = "";
  for (const [x, y] of [[-15, -19], [15, -19], [-15, 21], [15, 21]]) {
    cyl(`foot.pad.${x}.${y}`, x, y, 2.8, 0, 0.8, { tone: "lo" }, { steps: 28, bevel: 0.2 });
    cyl(`foot.${x}.${y}`, x, y, 2.1, 0.8, 1.2, { tone: "mid" }, { steps: 24, bevel: 0.2 });
  }
  for (const x of [-17, 13]) {
    const p = plan(x, -22, x + 4, 24, 0.4);
    box(`rail.${x < 0 ? "l" : "r"}`, [x, -22, 2], [x + 4, 24, 5], { tone: "lo" }, { r: 0.4, bevel: 0.3, inner: Ln(k.sideSeam(p, 3.5 + oz, P, 3), { tone: "faint" }), extra: ctx.screws([[ox + x + 2, oy - 20.2], [ox + x + 2, oy + 22.2]], oz + 5, { ring: 0.9 }) });
  }
  box("cross.back", [-13, -21, 2], [13, -18, 5], { tone: "lo" }, { r: 0.3, bevel: 0.3 });
  box("cross.front", [-13, 15, 2], [13, 18, 5], { tone: "lo" }, { r: 0.3, bevel: 0.3 });

  // ---- housing: two side plates, back and front walls, a gear guard on −x ---------------------------------------
  for (const x of [-17, 13]) {
    const p = plan(x, -15, x + 4, 22, 0.5);
    const right = x > 0;
    box(`plate.${right ? "r" : "l"}`, [x, -15, 5], [x + 4, 22, 30], { tone: "mid" }, {
      r: 0.5,
      bevel: 0.4,
      inner: Ln(k.sideSeam(p, oz + 8, P, 3), { tone: "faint" }),
      extra: right ? faceScrews("x", [[17, -13, 7.4], [17, 20.4, 7.4], [17, -13, 14], [17, 20.4, 15.4]]) : "",
    });
  }
  {
    // rating plate on the right side plate: three printed lines and four screws
    const xF = 17.3;
    const rules = [[10.4, 12.6, 18.2], [10.4, 11.4, 16.6], [10.4, 10.2, 17.6]].map(([y0, z, y1]) => k.segment(W([xF, y0, z]), W([xF, y1, z]), P)).join("");
    box("plate.rating", [17, 9.2, 8.6], [xF, 19.4, 13.8], { tone: "lo" }, { r: 0.3, extra: Ln(rules, { tone: "lo", free: true }) + Dots([[9.9, 9.3], [18.7, 9.3], [9.9, 13.1], [18.7, 13.1]].map(([y, z]) => at(W([xF, y, z]))), { size: 0.35 }) });
  }
  box("wall.back", [-13, -15, 15], [13, -13, 30], { tone: "mid" }, { r: 0.2, bevel: 0.2 });
  box("wall.front", [-13, 13, 15.5], [13, 15, 30], { tone: "mid" }, {
    r: 0.2,
    bevel: 0.2,
    extra: faceScrews("y", [[-10.5, 15, 28], [10.5, 15, 28], [-10.5, 15, 20], [10.5, 15, 20]]),
  });
  {
    const p = plan(-20.5, -13, -17, 12, 1.4);
    box("guard", [-20.5, -13, 16], [-17, 12, 30], { tone: "mid" }, { r: 1.4, bevel: 0.5, steps: 4, inner: Ln(k.sideSeam(p, oz + 23, P, 4), { tone: "faint" }), extra: ctx.screws([[ox - 18.75, oy - 11], [ox - 18.75, oy + 10]], oz + 30, { ring: 0.8 }) });
  }

  // ---- rollers: two toothed rollers, seven rings each; their teeth are redrawn as they turn -----------------------
  const ringBands = [];
  const profile = [[0, ROLLER.endR], [0.9, ROLLER.endR]];
  for (let i = 0; i < ROLLER.rings; i++) {
    const s0 = 0.9 + i * (ROLLER.ringW + ROLLER.gapW);
    const s1 = s0 + ROLLER.ringW;
    ringBands.push([s0, s1]);
    profile.push([s0, ROLLER.r], [s1, ROLLER.r]);
    if (i < ROLLER.rings - 1) profile.push([s1, ROLLER.rootR], [s1 + ROLLER.gapW, ROLLER.rootR]);
  }
  const rollerLen = ROLLER.x1 - ROLLER.x0;
  profile.push([ringBands[ringBands.length - 1][1], ROLLER.endR], [rollerLen, ROLLER.endR]);
  const teeth = (F, phase) => ringBands.map(([s0, s1]) => k.fadedSvg(G.ribsOf(F, s0, s1, ROLLER.r, 14, P, { phase, fade: [0.1, 0.55], seams: true }), { tone: "mid" })).join("");
  ctx.material = "fx-graphite";
  ROLLER.ys.forEach((y, i) => {
    const F = FX(ROLLER.x0, y, ROLLER.axisZ);
    turned(`roller.${i ? "front" : "back"}`, F, profile, { tone: "hi" }, { extra: `<g data-part="${id}:roller${i}">${teeth(F, 0)}</g>`, attrs: i ? ` data-move="${id}:block"` : undefined });
  });

  // ---- hopper: flared walls as separate slabs, back → left → (packet) → right → front ----------------------------
  ctx.material = "";
  const z0 = HOPPER.z0;
  const fl = HOPPER.flare;
  const sideTop = (y) => HOPPER.backTop + ((y + 15 + fl) / (30 + 2 * fl)) * (HOPPER.frontTop - HOPPER.backTop);
  plateX("hopper.back", -13, 13, [[-15, z0], [-13, z0], [-13 - fl, HOPPER.backTop], [-15 - fl, HOPPER.backTop]], { tone: "mid" });
  const sidePoly = [[-15, z0], [15, z0], [15 + fl, HOPPER.frontTop], [-15 - fl, HOPPER.backTop]];
  plateX("hopper.left", -14.6, -13, sidePoly, { tone: "mid" });
  plateX("hopper.right", 13, 14.6, sidePoly, { tone: "mid" }, {
    extra: faceScrews("x", [[14.6, -12.5, 31.4], [14.6, 0, 31.4], [14.6, 12.5, 31.4]], { ring: 0.7 }),
  });
  {
    // wear liners bolted to the inner faces of the back and left walls (countersunk screws)
    const n = [7 / Math.hypot(4, 7), 4 / Math.hypot(4, 7)];
    const onBack = (t, off) => [-13 - 4 * t + n[0] * off, z0 + 7 * t + n[1] * off];
    const lin = [onBack(0.12, 0), onBack(0.86, 0), onBack(0.86, 0.5), onBack(0.12, 0.5)];
    const screwsBack = [[-9, 0.22], [9, 0.22], [-9, 0.76], [9, 0.76], [0, 0.22], [0, 0.76]].map(([x, t]) => { const [y, z] = onBack(t, 0.5); return at(W([x, y, z])); });
    plateX("hopper.liner.back", -11.4, 11.4, lin, { tone: "lo" }, { bias: -30, extra: Dots(screwsBack, { size: 0.42 }) });
    const yAt = (z) => -13 - ((z - z0) / 7) * 4;
    const linL = [[yAt(31) + 0.8, 31], [12, 31], [14.2, 33.6], [yAt(33.6) + 0.8, 33.6]];
    plateX("hopper.liner.left", -13, -12.5, linL, { tone: "lo" }, { bias: -30, extra: Dots([[-9, 32.6], [0, 32.6], [9, 32.6]].map(([y, z]) => at(W([-12.5, y, z]))), { size: 0.42 }) });
  }
  plateX("hopper.front", -13, 13, [[13, z0], [15, z0], [15 + fl, HOPPER.frontTop], [13 + fl, HOPPER.frontTop]], { tone: "mid" });
  box("hopper.lip.back", [-13, -15 - fl - 0.6, HOPPER.backTop], [13, -13 - fl + 0.4, HOPPER.backTop + 0.9], { tone: "mid" }, { r: 0.3, bevel: 0.2, bias: -30, extra: ctx.screws([-9, 0, 9].map((x) => [ox + x, oy - 14 - fl - 0.1]), oz + HOPPER.backTop + 0.9, { ring: 0.6, size: 0.4 }) });
  box("hopper.lip.front", [-14.6, 13 + fl - 0.4, HOPPER.frontTop], [14.6, 15 + fl + 0.6, HOPPER.frontTop + 0.9], { tone: "mid" }, { r: 0.3, bevel: 0.2, extra: ctx.screws([-9, 0, 9].map((x) => [ox + x, oy + 14 + fl + 0.1]), oz + HOPPER.frontTop + 0.9, { ring: 0.6, size: 0.4 }) });
  // photo-eye on the right wall: it sees a packet enter and asks the controller for speed
  box("eye.emitter", [-17.2, 0.4, 31], [-14.6, 3.6, 33.4], { tone: "mid" }, { r: 0.5, bevel: 0.3 });
  box("eye", [14.6, 0.4, 31], [17.2, 3.6, 33.4], { tone: "mid" }, { r: 0.5, bevel: 0.3, extra: Ln(G.circleOf(FY(15.9, 3.6, 32.2), 0, 0.7, P, 16), { tone: "lo" }) + Dots([at(W([15.9, 3.6, 32.2]))], { size: 0.5, tone: "hi" }) });

  // ---- bearings on +x: fixed back block, sliding front block on guide rails, tramp-relief spring -------------------
  ctx.material = "fx-graphite";
  box("bearing.back", [17, -10, 19], [20.4, -2, 27], { tone: "mid" }, { r: 0.6, bevel: 0.4, extra: faceScrews("x", [[20.4, -8.6, 25.6], [20.4, -3.4, 20.4]], { ring: 0.55, size: 0.4 }) });
  turned("bearing.back.cap", FX(20.4, -6, 23), [[0, 2.2], [0.6, 2.2]], { tone: "mid" }, { bevel: 0.15 });
  ctx.material = "";
  box("guide.top", [17, 0, 27], [19, 19, 28.2], { tone: "lo" }, { r: 0.2, bevel: 0.2 });
  box("guide.bottom", [17, 0, 17.8], [19, 19, 19], { tone: "lo" }, { r: 0.2, bevel: 0.2 });
  ctx.material = "fx-graphite";
  const moving = ` data-move="${id}:block"`;
  box("bearing.front", [17, 2, 19], [20.4, 10, 27], { tone: "mid" }, { r: 0.6, bevel: 0.4, attrs: moving, extra: faceScrews("x", [[20.4, 3.4, 25.6], [20.4, 8.6, 20.4]], { ring: 0.55, size: 0.4 }) });
  turned("bearing.front.cap", FX(20.4, 6, 23), [[0, 2.2], [0.9, 2.2], [0.9, 1.2], [1.5, 1.2]], { tone: "mid" }, { bevel: 0.15, attrs: moving });
  ctx.material = "";
  box("abutment", [17, 19, 18.6], [21, 22, 27.4], { tone: "mid" }, { r: 0.5, bevel: 0.4, extra: faceScrews("y", [[17.9, 22, 26.4], [17.9, 22, 19.6]], { ring: 0.4, size: 0.35 }) });
  {
    const F = FY(SPRING.x, SPRING.y0, SPRING.z);
    ctx.put(N("spring"), W([SPRING.x, (SPRING.y0 + SPRING.y1) / 2, SPRING.z]), `<g data-part="${id}:spring">${springSvg(ctx, W, 0)}</g>`, [ctx.record(A.solid(F, [[0, SPRING.r], [SPRING.y1 - SPRING.y0, SPRING.r]], { name: N("spring") }))]);
  }
  turned("nut", FY(SPRING.x, 22, SPRING.z), [[0, 1.3], [1.2, 1.3], [1.2, 0.6], [2.2, 0.6]], { tone: "mid" }, { bevel: 0.15 });

  // ---- flywheel on the back roller shaft, V-belt down to the motor pulley ----------------------------------------
  ctx.material = "fx-graphite";
  const FF = FX(FLY.x, ROLLER.ys[0], ROLLER.axisZ);
  turned("flywheel", FF, [[-0.6, FLY.hub], [0, FLY.hub], [0, FLY.r], [FLY.w, FLY.r], [FLY.w, FLY.hub], [FLY.w + 0.6, FLY.hub]], { tone: "mid" }, {
    bevel: 0.3,
    extra: Ln(G.arcOf(FF, FLY.w / 2 - 1, FLY.r, P) + G.arcOf(FF, FLY.w / 2 + 1, FLY.r, P), { tone: "lo" }) + Ln(G.circleOf(FF, FLY.w, FLY.r - 1.4, P) + G.circleOf(FF, FLY.w, 3.4, P), { tone: "lo" }) + `<g data-part="${id}:flywheel">${flywheelSvg(ctx, FF, 0)}</g>`,
  });
  turned("flywheel.nut", FX(FLY.x + FLY.w + 0.6, ROLLER.ys[0], ROLLER.axisZ), [[0, 1.3], [0.7, 1.3]], { tone: "mid" }, { bevel: 0.15 });
  const beltX = FLY.x + FLY.w / 2;
  const FP = FX(beltX - 1.5, MOTOR.y, MOTOR.z);
  // the pulley in three pieces so the belt can sit in its groove: back flange → hub → (belt) → front flange
  turned("motor.pulley.back", FP, [[0, 3.4], [0.6, 3.4]], { tone: "mid" }, { bevel: 0.15 });
  turned("motor.pulley", FX(beltX - 0.9, MOTOR.y, MOTOR.z), [[0, 2.8], [1.8, 2.8]], { tone: "mid" });
  turned("motor.pulley.front", FX(beltX + 0.9, MOTOR.y, MOTOR.z), [[0, 3.4], [0.6, 3.4]], { tone: "mid" }, { bevel: 0.15, extra: `<g data-part="${id}:pulley">${pulleySvg(ctx, FP, 0)}</g>` });
  turned("motor.shaft", FX(beltX + 1.5, MOTOR.y, MOTOR.z), [[0, 0.9], [MOTOR.x - beltX - 1.5, 0.9]], { tone: "mid" });
  const FM = FX(MOTOR.x, MOTOR.y, MOTOR.z);
  turned("motor", FM, [[0, 3.2], [0.5, 4.2], [1.6, 4.2], [1.6, 5], [10.4, 5], [10.4, 4.5], [12.4, 4.5], [12.4, 3.4], [12.9, 3.4]], { tone: "mid" }, {
    bevel: 0.2,
    extra: k.fadedSvg(G.ribsOf(FM, 1.6, 10.4, 5, 22, P, { fade: [0.1, 0.55], seams: true }), { tone: "lo" }) + k.fadedSvg(G.ribsOf(FM, 10.4, 12.4, 4.5, 26, P, { fade: [0.1, 0.55], seams: true }), { tone: "faint" }),
  });
  ctx.material = "";
  box("motor.base", [25, -31, 0], [40, -17, 1.6], { tone: "lo" }, {
    r: 0.6,
    bevel: 0.3,
    extra: Ln([[26.5, -29.6], [26.5, -20.4], [38.5, -29.6], [38.5, -20.4]].map(([x, y]) => k.planOutline(plan(x - 0.6, y - 1.2, x + 0.6, y + 1.2, 0.6), oz + 1.6, P, 4)).join(""), { tone: "lo" }),
  });
  box("motor.foot", [28, -27.4, 1.6], [37.6, -20.6, MOTOR.z - 5], { tone: "mid" }, { r: 0.4, bevel: 0.3, extra: ctx.screws([[ox + 29.4, oy - 26], [ox + 36.2, oy - 26], [ox + 29.4, oy - 22], [ox + 36.2, oy - 22]].map(([x, y]) => [x, y]), oz + MOTOR.z - 5, { ring: 0.6, size: 0.4 }) });
  box("motor.tbox", [30.4, -27, MOTOR.z + 5], [34.8, -21, MOTOR.z + 8.2], { tone: "mid" }, { r: 0.5, bevel: 0.3, extra: ctx.screws([[ox + 31.2, oy - 26.2], [ox + 34, oy - 21.8]], oz + MOTOR.z + 8.2, { ring: 0.45, size: 0.35 }) });
  {
    // V-belt: a closed loop in the plane x = beltX, broken where it passes behind each wheel's silhouette
    const c1 = [ROLLER.ys[0], ROLLER.axisZ];
    const c2 = [MOTOR.y, MOTOR.z];
    const r1 = FLY.r + BELT_R;
    const r2 = MOTOR.pulleyR;
    const loop = beltLoop(c1, r1, c2, r2).map(([y, z]) => W([beltX, y, z]));
    const V = ctx.V;
    const side = Math.hypot(V[1], V[2]);
    const across = [-V[2] / side, V[1] / side];
    const cum = [0];
    for (let i = 1; i < loop.length; i++) cum.push(cum[i - 1] + Math.hypot(loop[i][1] - loop[i - 1][1], loop[i][2] - loop[i - 1][2]));
    const breaks = [];
    for (const [c, r] of [[c1, r1], [c2, r2]])
      for (const sign of [-1, 1]) {
        const q = [oy + c[0] + across[0] * r * sign, oz + c[1] + across[1] * r * sign];
        let best = 0;
        loop.forEach((p, i) => (Math.hypot(p[1] - q[0], p[2] - q[1]) < Math.hypot(loop[best][1] - q[0], loop[best][2] - q[1]) ? (best = i) : 0));
        breaks.push(cum[best]);
      }
    const keepMat = ctx.material;
    ctx.material = "fx-graphite";
    ctx.cable(N("vbelt"), loop, BELT_R, { closed: true, limp: true, shells: [false, false], tone: "lo", maxLength: 5, breaks, touch: [N("flywheel"), N("motor.pulley"), N("motor.pulley.back"), N("motor.pulley.front")] });
    ctx.material = keepMat;
    // the same pieces ctx.cable drew, so the page can put each lacing mark inside the chunk it lies on
    const pieces = ctx.T.tubePieces(loop, BELT_R, P, { maxLength: 5, spacing: 0.7, gaps: [], closed: true, breaks });
    const runs = straightRuns(loop, c1, r1, c2, r2, oy, oz);
    const sOf = (p) => {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        const ab = G.sub3(b, a), l2 = G.dot3(ab, ab) || 1;
        const t = Math.max(0, Math.min(1, G.dot3(G.sub3(p, a), ab) / l2));
        const d = G.len3(G.sub3(G.add3(a, G.mul3(ab, t)), p));
        if (d < bestD) (bestD = d), (best = runs.cum[i] + t * Math.sqrt(l2));
      }
      return best;
    };
    const chunks = pieces.map((piece, i) => {
      const s0 = sOf(piece.points[0]);
      let s1 = sOf(piece.points[piece.points.length - 1]);
      if (s1 < s0) s1 += runs.total;
      return { name: i ? `${N("vbelt")}:chunk#${i + 1}` : `${N("vbelt")}:chunk`, s0, s1 };
    });
    ctx.data[id] = { ...(ctx.data[id] ?? {}), belt: { route: N("vbelt"), runs: { total: runs.total, runs: runs.runs }, chunks } };
  }

  // ---- discharge: vibrating chute under the rollers, cheeks, brackets, vibrator ---------------------------------
  ctx.material = "";
  const chuteTop = (y) => CHUTE.z0 + ((y - CHUTE.y0) / (CHUTE.y1 - CHUTE.y0)) * (CHUTE.z1 - CHUTE.z0);
  plateX("chute.floor", CHUTE.x0, CHUTE.x1, [[CHUTE.y0, CHUTE.z0], [CHUTE.y1, CHUTE.z1], [CHUTE.y1, CHUTE.z1 - 1], [CHUTE.y0, CHUTE.z0 - 1]], { tone: "mid" });
  for (const [name, x0] of [["l", CHUTE.x0], ["r", CHUTE.x1 - 1]]) {
    plateX(`chute.cheek.${name}`, x0, x0 + 1, [[15, chuteTop(15)], [CHUTE.y1, chuteTop(CHUTE.y1)], [CHUTE.y1, chuteTop(CHUTE.y1) + 2.6], [15, chuteTop(15) + 3.4]], { tone: "mid" });
    const bx = name === "l" ? [-13, CHUTE.x0] : [CHUTE.x1, 13];
    box(`chute.bracket.${name}`, [bx[0], 17, chuteTop(17) + 0.4], [bx[1], 20, chuteTop(17) + 2.8], { tone: "lo" }, { r: 0.2, bevel: 0.15 });
  }
  {
    // slide gate at the chute lip: closed while the bin is away, the flakes queue up behind it
    const zl = chuteTop(CHUTE.y1);
    for (const [name, x0] of [["l", CHUTE.x0], ["r", CHUTE.x1 - 1]]) box(`chute.guide.${name}`, [x0, CHUTE.y1, zl - 0.4], [x0 + 1, CHUTE.y1 + 0.8, zl + 6.6], { tone: "mid" }, { r: 0.15, bevel: 0.1 });
    box("chute.gate.bar", [CHUTE.x0, CHUTE.y1, zl + 6.6], [CHUTE.x1, CHUTE.y1 + 0.8, zl + 7.4], { tone: "mid" }, { r: 0.15, bevel: 0.1 });
    box("chute.gate.actuator", [-1.6, CHUTE.y1 - 0.2, zl + 7.4], [1.6, CHUTE.y1 + 1.0, zl + 9.4], { tone: "mid" }, { r: 0.4, bevel: 0.2 });
    box("chute.gate", [CHUTE.x0 + 1, CHUTE.y1 + 0.15, zl + 0.05], [CHUTE.x1 - 1, CHUTE.y1 + 0.65, zl + 2.6], { tone: "lo" }, { r: 0.1, attrs: ` data-move="${id}:gate"`, extra: Dots([-7, 0, 7].map((x) => at(W([x, CHUTE.y1 + 0.65, zl + 1.8]))), { size: 0.38 }) });
  }
  box("chute.vibrator", [-3, 15.4, chuteTop(19.4) - 1 - 3.2], [3, 19.4, chuteTop(19.4) - 1.0 + 0.05], { tone: "mid" }, { r: 0.6, bevel: 0.3 });

  // ---- bin: a drawer on casters under the chute, floor rails, a dump grate in front ------------------------------
  ctx.material = "";
  for (const x of [-9, 7]) box(`bin.rail.${x < 0 ? "l" : "r"}`, [x, 19, 0], [x + 2, 60, 0.8], { tone: "lo" }, { r: 0.2, bevel: 0.15 });
  box("grate", [-6.6, 43, 0], [6.6, 59, 0.4], { tone: "lo" }, {
    r: 0.6,
    extra: Ln(Array.from({ length: 7 }, (_, i) => k.planOutline(plan(-5.2 + i * 1.6, 44.4, -4.4 + i * 1.6, 57.6, 0.4), oz + 0.4, P, 4)).join(""), { tone: "lo" }),
  });
  const binAttr = ` data-bin="${id}"`;
  const B = BIN;
  const wz = B.floorZ + 0.8;
  for (const [x, y] of [[-8.6, 23], [7.4, 23], [-8.6, 37], [7.4, 37]]) turned(`bin.caster.${x}.${y}`, FX(x, y, 1.7), [[0, 0.9], [1.2, 0.9]], { tone: "mid" }, { attrs: binAttr });
  box("bin.floor", [B.x0, B.y0, B.floorZ], [B.x1, B.y1, wz], { tone: "mid" }, { r: 0.6, attrs: binAttr });
  {
    // a rubber mat on the bin floor. It records the envelope of the full pile above it, so the settled order puts
    // the live pile (slot crusher:bin, right after the mat) behind the chute lip and inside the bin walls.
    const mat = plan(B.x0 + B.wall, B.y0 + B.wall, B.x1 - B.wall, B.y1 - B.wall, 0.2);
    const shape = ctx.record(A.slab(mat, oz + wz, 0.6 + PILE_MAX, { name: N("bin.mat") }, 3));
    ctx.put(N("bin.mat"), W([0, (B.y0 + B.y1) / 2, wz + 0.3]), S(k.slabOf(mat, oz + wz, 0.6, P, 3), { tone: "lo" }), [shape], { attrs: binAttr });
  }
  box("bin.wall.back", [B.x0, B.y0, wz], [B.x1, B.y0 + B.wall, B.rimZ], { tone: "mid" }, { r: 0.3, bevel: 0.2, attrs: binAttr });
  box("bin.wall.left", [B.x0, B.y0 + B.wall, wz], [B.x0 + B.wall, B.y1 - B.wall, B.rimZ], { tone: "mid" }, { r: 0.2, bevel: 0.2, attrs: binAttr });
  box("bin.wall.right", [B.x1 - B.wall, B.y0 + B.wall, wz], [B.x1, B.y1 - B.wall, B.rimZ], { tone: "mid" }, { r: 0.2, bevel: 0.2, attrs: binAttr, extra: faceScrews("x", [[B.x1, 23, 8.6], [B.x1, 37, 8.6]], { ring: 0.5, size: 0.35 }) });
  {
    const yF = B.y1;
    // hazard band along the top of the front face: diagonal stripes that run edge to edge of the band
    const zb0 = 7.2;
    const zb1 = 9.4;
    const stripes = [];
    for (let u = B.x0 - 4; u < B.x1 + 4; u += 2.2) {
      const seg = clipSeg([u, zb0], [u + (zb1 - zb0), zb1], B.x0 + 1, B.x1 - 1);
      if (seg) stripes.push(k.segment(W([seg[0][0], yF, seg[0][1]]), W([seg[1][0], yF, seg[1][1]]), P));
    }
    const band = k.pathOf([[B.x0 + 1, zb0], [B.x1 - 1, zb0], [B.x1 - 1, zb1], [B.x0 + 1, zb1]].map(([x, z]) => at(W([x, yF, z]))), true);
    box("bin.wall.front", [B.x0, B.y1 - B.wall, wz], [B.x1, B.y1, B.rimZ], { tone: "mid" }, { r: 0.3, bevel: 0.2, attrs: binAttr, extra: Ln(band, { tone: "lo" }) + Ln(stripes.join(""), { tone: "lo" }) });
  }
  box("bin.handle.l", [-5, B.y1, 4.6], [-4, B.y1 + 1.6, 5.6], { tone: "lo" }, { r: 0.2, attrs: binAttr });
  box("bin.handle.r", [4, B.y1, 4.6], [5, B.y1 + 1.6, 5.6], { tone: "lo" }, { r: 0.2, attrs: binAttr });
  box("bin.handle", [-5, B.y1 + 1.6, 4.5], [5, B.y1 + 2.6, 5.7], { tone: "mid" }, { r: 0.4, attrs: binAttr });

  // ---- control box on a pedestal: lamp on top (the lit accent), step counter dial, buttons ------------------------
  ctx.material = "";
  box("ctl.base", [-35, 2, 0], [-29, 8, 0.8], { tone: "lo" }, { r: 0.5, bevel: 0.2, extra: ctx.screws([[-34, 3], [-30, 3], [-34, 7], [-30, 7]].map(([x, y]) => [ox + x, oy + y]), oz + 0.8, { ring: 0.5, size: 0.35 }) });
  box("ctl.column", [-33.4, 3.6, 0.8], [-30.6, 6.4, 16], { tone: "mid" }, { r: 0.3, bevel: 0.2 });
  {
    const p = plan(-38, -1, -26, 11, 1.2);
    const vents = [18.6, 20, 21.4, 22.8].map((z) => slotYZ(W, P, k, -26, 1.4, 8.6, z, 0.4)).join("");
    box("ctl.cabinet", [-38, -1, 16], [-26, 11, 32], { tone: "mid" }, { r: 1.2, bevel: 0.5, steps: 4, inner: Ln(k.sideSeam(p, oz + 30.4, P, 4), { tone: "faint" }), extra: Ln(vents, { tone: "lo" }) });
    ctx.cable(N("ctl.eye"), [W([-26, 2, 27.4]), W([-22.4, 2, 27.4]), W([-22.4, 2, 32.2]), W([-17.2, 2, 32.2])], 0.45, { tone: "mid", bend: 1.6 });
  }
  box("ctl.door", [-37, 11, 17], [-27, 11.6, 31], { tone: "mid" }, { r: 0.4, bevel: 0.2 });
  for (const z of [19, 26.6]) turned(`ctl.hinge.${z}`, FZ(-37.2, 11.9, z), [[0, 0.45], [2.4, 0.45]], { tone: "lo" });
  {
    const F = FY(DIAL.x, DIAL.y, DIAL.z);
    const minor = G.spokesOf(F, DIAL.face, 2.35, 2.85, 20, P);
    const major = G.spokesOf(F, DIAL.face, 1.9, 2.85, 4, P);
    turned("ctl.dial", F, [[0, DIAL.r], [DIAL.face, DIAL.r]], { tone: "hi" }, {
      bevel: 0.2,
      extra: Ln(G.circleOf(F, DIAL.face, 3.0, P), { tone: "lo" }) + Ln(minor, { tone: "lo" }) + Ln(major, { tone: "mid" }) + `<g data-part="${id}:needle">${needleSvg(ctx, F, 0)}</g>`,
    });
  }
  box("ctl.label", [-36.2, 11.6, 18.2], [-31, 11.9, 21.8], { tone: "lo" }, {
    r: 0.3,
    extra: Ln([[-35.4, 21, -32.2], [-35.4, 20, -33.2], [-35.4, 19, -32.8]].map(([x0, z, x1]) => k.segment(W([x0, 11.9, z]), W([x1, 11.9, z]), P)).join(""), { tone: "lo", free: true }),
  });
  turned("ctl.start", FY(-28.8, 11.6, 21.2), [[0, 1.1], [0.5, 1.1], [0.5, 0.85], [1.0, 0.85]], { tone: "mid" }, { bevel: 0.1 });
  turned("ctl.stop", FY(-28.8, 11.6, 18.6), [[0, 0.8], [0.5, 0.8], [0.5, 1.2], [1.1, 1.2]], { tone: "lo" }, { bevel: 0.1 });
  turned("ctl.key", FY(-28.8, 11.6, 29.2), [[0, 0.7], [0.5, 0.7]], { tone: "lo" }, { extra: Ln(k.segment(W([-28.8, 12.1, 28.75]), W([-28.8, 12.1, 29.65]), P), { tone: "hi" }) });
  turned("lamp.base", FZ(LAMP.x, LAMP.y, LAMP.z), [[0, 2.4], [1.1, 2.4], [1.1, 1.7], [1.8, 1.7]], { tone: "mid" }, { bevel: 0.2 });
  {
    const dome = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * (Math.PI / 2);
      dome.push([1.8 + 3.1 * Math.sin(a), 1.6 * Math.cos(a), 1]);
    }
    dome[dome.length - 1][1] = 0;
    const c = at(W([LAMP.x, LAMP.y, LAMP.z + 3.6]));
    turned("lamp.lens", FZ(LAMP.x, LAMP.y, LAMP.z), [[1.8, 1.6], ...dome.slice(1)], { tone: "hi", lit: true }, {
      smooth: { slope: (s) => -((s - 1.8) / 3.1) * 1.6 / Math.max(0.05, 3.1 * Math.sqrt(Math.max(1e-3, 1 - ((s - 1.8) / 3.1) ** 2))), radius: (s) => 1.6 * Math.sqrt(Math.max(0, 1 - ((s - 1.8) / 3.1) ** 2)) },
    });
    ctx.slot(`${id}:glow`, { before: N("lamp.lens") });
    ctx.slot(`${id}:lens`, { after: N("lamp.lens") });
    const lensPaths = G.solidOf([[1.8, 1.6], ...dome.slice(1)], FZ(LAMP.x, LAMP.y, LAMP.z), P, { smooth: { slope: (s) => -((s - 1.8) / 3.1) * 1.6 / Math.max(0.05, 3.1 * Math.sqrt(Math.max(1e-3, 1 - ((s - 1.8) / 3.1) ** 2))), radius: (s) => 1.6 * Math.sqrt(Math.max(0, 1 - ((s - 1.8) / 3.1) ** 2)) } });
    const core = at(W([LAMP.x - 0.5, LAMP.y - 0.5, LAMP.z + 3.6]));
    ctx.data[id] = { ...(ctx.data[id] ?? {}), glow: { c, r: 4.0 * ctx.KS }, lens: { d: lensPaths.outline, core, r: 3.2 * ctx.KS } };
  }
  // conduit from the cabinet down to a floor box, and the motor cable to its own floor box
  box("ctl.floorbox", [-29.4, 7.4, 0], [-25.6, 11.4, 1.4], { tone: "lo" }, { r: 0.4, bevel: 0.2 });
  ctx.cable(N("ctl.conduit"), [W([-27.5, 9.4, 16]), W([-27.5, 9.4, 1.4])], 0.7, { tone: "mid" });
  box("motor.floorbox", [31, -36, 0], [35, -32, 1.4], { tone: "lo" }, { r: 0.4, bevel: 0.2 });
  ctx.cable(N("motor.cable"), [W([32.6, -27, MOTOR.z + 6.6]), W([32.6, -30.5, MOTOR.z + 6.6]), W([32.6, -34, MOTOR.z + 2]), W([32.6, -34, 1.4])], 0.55, { tone: "mid", bend: 2.4 });

  ctx.material = keep;

  // ---- live slots: the packet between the rollers, the pile and flakes in the bin --------------------------------
  // after every part the falling packet must cover (settle may order them either way in a bigger scene)
  ctx.slot(`${id}:item`, { after: ["roller.back", "hopper.back", "hopper.left", "hopper.liner.back", "hopper.liner.left", "hopper.lip.back"].map(N) });
  ctx.slot(`${id}:bin`, { after: N("bin.mat") });
  ctx.slot(`${id}:flakes`, { after: N("chute.floor") });

  const rollers = ROLLER.ys.map((y) => FX(ROLLER.x0, y, ROLLER.axisZ));
  ctx.data[id] = {
    ...(ctx.data[id] ?? {}),
    origin: [ox, oy, oz],
    // ports and the expected drop point, in world coordinates and relative to origin
    ports: { in: W([0, 0, HOPPER.backTop]) },
    drop: W([0, -26, 40]),
    local: { in: [0, 0, HOPPER.backTop], drop: [0, -26, 40] },
    light: G.lightOf(P),
    rollers: rollers.map((F) => ({ F, bands: ringBands, r: ROLLER.r })),
    roller: { ys: ROLLER.ys.map((y) => oy + y), axisZ: oz + ROLLER.axisZ, r: ROLLER.r },
    hopper: { backTop: oz + HOPPER.backTop },
    fly: { F: FF, ...FLY, ratio: (FLY.r + BELT_R) / MOTOR.pulleyR },
    pulley: { F: FP },
    spring: { ...SPRING },
    dial: { F: FY(DIAL.x, DIAL.y, DIAL.z), face: DIAL.face },
    bin: { ...BIN, chuteY: oy + CHUTE.y1, chuteZ: oz + CHUTE.z1, pileMax: PILE_MAX },
    chute: { y0: oy + CHUTE.y0, y1: oy + CHUTE.y1, z0: oz + CHUTE.z0, z1: oz + CHUTE.z1, start: oy + 11, x0: ox + CHUTE.x0 + 1, x1: ox + CHUTE.x1 - 1 },
    lip: { inner: oy - 13 - HOPPER.flare + 0.4, top: oz + HOPPER.backTop + 0.9 },
    chips: chipLayout(),
  };
}

// a closed V-belt loop around two wheels in the (y, z) plane: [[y, z], …], wrapping c1 on its far side
function beltLoop(c1, r1, c2, r2, steps = 40) {
  const d = Math.hypot(c2[0] - c1[0], c2[1] - c1[1]);
  const th = Math.atan2(c2[1] - c1[1], c2[0] - c1[0]);
  const b = Math.acos((r1 - r2) / d);
  const arc = (c, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
  });
  return [...arc(c1, r1, th + b, th + 2 * Math.PI - b, steps), ...arc(c2, r2, th - b, th + b, Math.round(steps / 3))];
}
// the two straight runs of the belt, as fractions of its route (for the moving lacing marks)
function straightRuns(loop, c1, r1, c2, r2, oy, oz) {
  const cum = [0];
  for (let i = 1; i < loop.length; i++) cum.push(cum[i - 1] + Math.hypot(loop[i][1] - loop[i - 1][1], loop[i][2] - loop[i - 1][2]));
  const total = cum[cum.length - 1];
  const big = 41;
  // the loop is: big arc (41 points), small arc; straight runs join index 40→41 and the last point→0 (wrap)
  return { total, cum: [...cum, total], runs: [[cum[big - 1] / total, cum[big] / total], [cum[cum.length - 1] / total, 1]] };
}
// a closed vent slot on a face of constant x, running along y with round ends
function slotYZ(W, P, k, x, y0, y1, z, hh) {
  const pts = [];
  for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * Math.PI; pts.push([y1 - hh + Math.cos(a) * hh, z + Math.sin(a) * hh]); }
  for (let i = 0; i <= 8; i++) { const a = Math.PI / 2 + (i / 8) * Math.PI; pts.push([y0 + hh + Math.cos(a) * hh, z + Math.sin(a) * hh]); }
  return k.pathOf(pts.map(([y, zz]) => k.iso(W([x, y, zz]), P)), true);
}
// a segment from a to b in (x, z), clipped to x0 ≤ x ≤ x1
function clipSeg(a, b, x0, x1) {
  let [ax, az] = a;
  let [bx, bz] = b;
  if (bx < x0 || ax > x1) return null;
  const t = (x) => (x - a[0]) / (b[0] - a[0]);
  if (ax < x0) (az = a[1] + (b[1] - a[1]) * t(x0)), (ax = x0);
  if (bx > x1) (bz = a[1] + (b[1] - a[1]) * t(x1)), (bx = x1);
  if (bx - ax < 0.05) return null;
  return [[ax, az], [bx, bz]];
}
// chips scattered on the pile's top face (closed little quads), in bin-local x/y
function chipLayout() {
  const out = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 46; i++) out.push([-9.2 + rnd() * 18.4, 22.6 + rnd() * 14.8, rnd() * Math.PI, 0.55 + rnd() * 0.5]);
  return out;
}

// the drawings the page rebuilds, in the same form at build time (phase 0)
export function springSvg(ctx, W, shift) {
  const { k, G, P, S, Ln } = ctx;
  const y0 = SPRING.y0 + shift;
  const F = G.frameOf(W([SPRING.x, y0, SPRING.z]), [0, 1, 0], [0, 0, 1], [1, 0, 0]);
  const c = k.coil(W([0, y0 + 0.4, 0])[1], W([0, SPRING.y1, 0])[1], [W([SPRING.x, 0, 0])[0], W([0, 0, SPRING.z])[2]], SPRING.r - 0.08, SPRING.turns, "y", P);
  return S(G.disc(0, 0.4, SPRING.r, F, P), { tone: "mid" }) + Ln(c.back, { tone: "lo" }) + S(G.solidOf([[0.4, 0.6], [SPRING.y1 - y0, 0.6]], F, P), { tone: "mid" }) + Ln(c.front, { tone: "mid" });
}
function flywheelSvg(ctx, F, phase) {
  const { G, P, Ln } = ctx;
  return Ln(Array.from({ length: FLY.holes }, (_, i) => {
    const a = phase + (i / FLY.holes) * Math.PI * 2;
    const c = G.pointOf(F, FLY.w, FLY.holeAt, a);
    return G.circleOf(G.frameOf(c, F.a, F.u, F.v), 0, FLY.holeR, P, 18);
  }).join(""), { tone: "lo" });
}
function pulleySvg(ctx, F, phase) {
  const { G, P, Ln } = ctx;
  return Ln(Array.from({ length: 3 }, (_, i) => {
    const c = G.pointOf(F, 3, 1.7, phase + (i / 3) * Math.PI * 2);
    return G.circleOf(G.frameOf(c, F.a, F.u, F.v), 0, 0.55, P, 12);
  }).join("") + G.circleOf(F, 3, 0.9, P, 14), { tone: "lo" });
}
function needleSvg(ctx, F, angle) {
  const { G, P, k, Ln, Dots } = ctx;
  const s = F.a;
  const c = G.pointOf(F, DIAL.face + 0.05, 0, 0);
  const tip = G.pointOf(F, DIAL.face + 0.05, 2.5, angle);
  return Ln(k.pathOf([k.iso(c, P), k.iso(tip, P)]), { tone: "hi", free: "end" }) + Dots([k.iso(c, P)], { size: 0.7, tone: "hi" });
}

export const CSS = `.iso{--cr-lamp:#f5a623;--cr-lamp-core:#fff1cf;--cr-lamp-rim:#d97a06;--cr-chip-line:#2a2c31}
.iso[data-theme="dark"]{--cr-lamp:#ffbe5c;--cr-lamp-core:#fff6e0;--cr-lamp-rim:#f0961a;--cr-chip-line:#1d1f24}
.iso .cr-lamp-stop{stop-color:var(--cr-lamp)}.iso .cr-lamp-core{stop-color:var(--cr-lamp-core)}.iso .cr-lamp-rim{stop-color:var(--cr-lamp-rim)}
.iso .cr-lens{stroke:var(--cr-lamp-rim);stroke-width:.6px}
.iso .cr-chip{fill:var(--pk-garbage-top);stroke:var(--cr-chip-line);stroke-width:.35px;stroke-opacity:.55}.iso .cr-chip[data-c="1"]{fill:var(--pk-garbage-s1)}.iso .cr-chip[data-c="2"]{fill:var(--pk-garbage-s3)}`;

// The live layering relies on these relations in the settled painter's order. "@name" is the slot `id:name`.
// [a, b] means a is painted before b. Check them after page() (standalone and assembly) with checkOrder().
export function orderRules(id = "crusher") {
  const n = (s) => (s.startsWith("@") ? s : `${id}.${s}`);
  return [
    ["hopper.back", "@item"], ["hopper.left", "@item"], ["hopper.liner.back", "@item"], ["hopper.liner.left", "@item"], ["hopper.lip.back", "@item"], ["roller.back", "@item"],
    ["@item", "roller.front"], ["@item", "hopper.front"], ["@item", "hopper.right"],
    ["bin.wall.back", "@bin"], ["bin.wall.left", "@bin"], ["@bin", "chute.floor"], ["@bin", "bin.wall.right"], ["@bin", "bin.wall.front"],
    ["chute.floor", "@flakes"], ["@flakes", "wall.front"], ["@flakes", "chute.gate"], ["@flakes", "chute.cheek.r"], ["@flakes", "bin.wall.right"], ["@flakes", "bin.wall.front"],
    ["@glow", "lamp.lens"], ["lamp.lens", "@lens"],
  ].map(([a, b]) => [n(a), n(b)]);
}
// returns the broken relations (empty when the order holds); call after page(), which sorts ctx.R.items
export function checkOrder(ctx, id = "crusher", rules = orderRules(id)) {
  const names = ctx.R.items.map((item) => item.name);
  const indexOf = (name) => {
    if (name.startsWith("@")) {
      const slot = ctx.slots.find((s) => s.name === `${id}:${name.slice(1)}`);
      if (!slot) return NaN;
      const found = [].concat(slot.after ?? slot.before).map((target) => names.findIndex((n) => n === target || n.startsWith(`${target}#`)));
      return (slot.after ? Math.max(...found) : Math.min(...found)) + (slot.after ? 0.5 : -0.5);
    }
    return names.indexOf(name);
  };
  return rules.filter(([a, b]) => !(indexOf(a) < indexOf(b))).map(([a, b]) => `${a} (${indexOf(a)}) must be painted before ${b} (${indexOf(b)})`);
}

export const LIVE = `
MACHINES.crusher = (api) => {
  const D = api.data;
  const P = api.P;
  const V = api.V;
  const L = D.light;
  const BANDS = [0, 0.2, 0.42, 0.62];
  const NS = "http://www.w3.org/2000/svg";
  const svgRoot = api.el(".fx-parts").ownerSVGElement;
  const part = (name) => svgRoot.querySelector('[data-part="' + api.id + ':' + name + '"]');
  const all = (sel) => [...svgRoot.querySelectorAll(sel)];
  const rollerEls = [part("roller0"), part("roller1")];
  const flyEl = part("flywheel");
  const pulleyEl = part("pulley");
  const springEl = part("spring");
  const needleEl = part("needle");
  const blockEls = all('[data-move="' + api.id + ':block"]');
  const gateEls = all('[data-move="' + api.id + ':gate"]');
  const binEls = all('[data-bin="' + api.id + '"]');
  const itemSlot = api.slot("item");
  const binSlot = api.slot("bin");
  const flakeSlot = api.slot("flakes");
  binEls.push(binSlot);

  // lamp: a small halo on the cabinet top behind the lens, and an amber tint over the lens (pale core, saturated rim)
  const gid = "cr-" + api.id;
  const glowSlot = api.slot("glow");
  glowSlot.innerHTML = '<defs><radialGradient id="' + gid + '-halo"><stop offset="0" class="cr-lamp-stop" stop-opacity="0.7"/><stop offset="1" class="cr-lamp-stop" stop-opacity="0"/></radialGradient>'
    + '<radialGradient id="' + gid + '-lens" gradientUnits="userSpaceOnUse" cx="' + D.lens.core[0].toFixed(2) + '" cy="' + D.lens.core[1].toFixed(2) + '" r="' + D.lens.r.toFixed(2) + '"><stop offset="0" class="cr-lamp-core"/><stop offset="0.5" class="cr-lamp-stop"/><stop offset="1" class="cr-lamp-rim"/></radialGradient></defs>'
    + '<circle fill="url(#' + gid + '-halo)" cx="' + D.glow.c[0].toFixed(2) + '" cy="' + D.glow.c[1].toFixed(2) + '" r="' + D.glow.r.toFixed(2) + '" opacity="0"/>';
  const haloEl = glowSlot.lastChild;
  const lensSlot = api.slot("lens");
  lensSlot.innerHTML = '<path class="cr-lens" fill="url(#' + gid + '-lens)" d="' + D.lens.d + '" opacity="0"/>';
  const lensEl = lensSlot.firstChild;

  // belt lacing marks are drawn inside the belt chunk they lie on, so they share its depth
  const chunkMarks = D.belt.chunks.map((c) => {
    const host = svgRoot.querySelector('[data-name="' + c.name + '"]');
    const g = document.createElementNS(NS, "g");
    if (host) host.appendChild(g);
    return { s0: c.s0, s1: c.s1, g, last: "" };
  });

  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const band = (s) => { let t = 0; while (t < BANDS.length && s >= BANDS[t]) t++; return t; };
  const settle = (st, target, dt, sec) => {
    const w = 1 / sec;
    for (let i = 0; i < 4; i++) { st.v += (w * w * (target - st.x) - 2 * w * st.v) * (dt / 4); st.x += st.v * (dt / 4); }
  };
  const springStep = (st, target, dt, k, c) => {
    for (let i = 0; i < 4; i++) { st.v += (k * (target - st.x) - c * st.v) * (dt / 4); st.x += st.v * (dt / 4); }
  };
  function hull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (const q of p.reverse()) { while (up.length > 1 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  const FACES = [[[1, 0, 0], [4, 5, 7, 6]], [[-1, 0, 0], [0, 1, 3, 2]], ["y", [2, 3, 7, 6]], ["-y", [0, 1, 5, 4]], ["z", [1, 3, 7, 5]], ["-z", [0, 2, 6, 4]]];
  // a box pitched by th about x (th < 0 tips its +y end down): base is the centre of its bottom face before the pitch
  function pitchedBox(kind, base, w, d, h, th, strap = true) {
    const cs = Math.cos(th), sn = Math.sin(th);
    const c = [base[0], base[1], base[2] + h / 2];
    const corner = (i) => {
      const sx = i & 4 ? 1 : -1, sy = i & 2 ? 1 : -1, sz = i & 1 ? 1 : -1;
      const yy = (sy * d) / 2, zz = (sz * h) / 2;
      return [c[0] + (sx * w) / 2, c[1] + yy * cs - zz * sn, c[2] + yy * sn + zz * cs];
    };
    const pts3 = Array.from({ length: 8 }, (_, i) => corner(i));
    const pts = pts3.map((p) => iso(p, P));
    const normalOf = (n) => (n === "y" ? [0, cs, sn] : n === "-y" ? [0, -cs, -sn] : n === "z" ? [0, -sn, cs] : n === "-z" ? [0, sn, -cs] : n);
    const shades = ["", "", "", ""];
    let top = "";
    const seen = [];
    for (const [n, ids] of FACES) {
      const nn = normalOf(n);
      const vis = dot3(nn, V) > 1e-6;
      seen.push(vis ? ids : null);
      if (!vis) continue;
      const tone = band(dot3(nn, L));
      const d0 = pathOf(ids.map((i) => pts[i]), true);
      if (tone >= 4) top += d0; else shades[tone] += d0;
    }
    const edges = new Map();
    for (const ids of seen) if (ids) for (let j = 0; j < 4; j++) { const a = ids[j], b = ids[(j + 1) % 4]; const key = a < b ? a + "-" + b : b + "-" + a; edges.set(key, (edges.get(key) || 0) + 1); }
    let crease = "";
    for (const [key, n] of edges) if (n === 2) { const [a, b] = key.split("-").map(Number); crease += pathOf([pts[a], pts[b]]); }
    const outline = pathOf(hull(pts), true);
    let strapLine = "";
    if (strap && dot3(normalOf("z"), V) > 1e-6) {
      const m = (i, j) => [(pts3[i][0] + pts3[j][0]) / 2, (pts3[i][1] + pts3[j][1]) / 2, (pts3[i][2] + pts3[j][2]) / 2];
      strapLine = lineSvg(pathOf([iso(m(1, 3), P), iso(m(5, 7), P)]), { tone: "lo" });
    }
    return '<g class="pk" data-kind="' + kind + '">' + solidSvg({ fill: outline, outline, top, shades, crease }, { tone: "hi" }) + strapLine + "</g>";
  }

  const O = D.origin;
  const X0 = O[0];
  const yB = D.roller.ys[0], yF = D.roller.ys[1], zA = D.roller.axisZ, R = D.roller.r;
  const nipY = (yB + yF) / 2;
  const rollTop = (y) => zA + Math.sqrt(Math.max(0, R * R - Math.min((y - yB) ** 2, (y - yF) ** 2)));
  const PK = { w: 10, d: 8, h: 7 };
  const TA = 0.5, TB = 0.5, TT = 0.45, TC = 1.0;
  const T_NIP = TA + TB + TT, T_END = T_NIP + TC;
  const land = [X0, yB + 1.2, rollTop(yB + 1.2) + 0.1];
  const nipRest = zA + Math.sqrt(Math.max(0, R * R - ((yF - yB) / 2 - PK.d / 2) ** 2));
  const yTip = D.lip.inner + 0.6;
  const yHold = O[1] - 9.5;
  const zHold = D.lip.top + 0.35;
  const items = [];
  const flakes = [];
  const pending = [];
  let chips = [];
  const spin = { x: 1.4, v: 0 };
  const kick = { x: 0, v: 0 };
  const lamp = { x: 0, v: 0 };
  const needle = { x: 0, v: 0 };
  const gate = { x: 1, v: 0 };
  let phase = 0, belt = 0, count = 0, fill = 0, laneNext = 0, nextRelease = 0;
  const bin = { pos: 0, mode: "home", t: 0 };
  const CAP = 10, PER = 7, LANES = 7, VS = 12, GRAV = 160;
  const B = D.bin;
  const binLocal = { x0: X0 + B.x0 + B.wall + 0.1, x1: X0 + B.x1 - B.wall - 0.1, y0: O[1] + B.y0 + B.wall + 0.1, y1: O[1] + B.y1 - B.wall - 0.1, z: O[2] + B.floorZ + 1.4 };
  const pileH = () => fill * B.pileMax;
  const CH = D.chute;
  const chuteZ = (y) => CH.z0 + ((y - CH.y0) / (CH.y1 - CH.y0)) * (CH.z1 - CH.z0);
  const gateY = CH.y1 + 0.1;

  function drawItem(it, t) {
    const age = t - it.t0;
    const from = it.from;
    const xAt = (f) => from[0] + (X0 - from[0]) * api.smooth(0, 1, f);
    let base, th = 0, w = PK.w, d = PK.d, h = PK.h, jx = 0;
    if (age < TA) {
      // pushed off the belt end it slides across onto the back lip and over its edge, staying above the lip
      const f = age / TA;
      base = [xAt(f * 0.5), from[1] + (yTip - from[1]) * f, from[2] + (zHold - from[2]) * api.smooth(0, 1, f)];
      th = -0.06 * f;
    } else if (age < TA + TB) {
      // it tips nose-down over the lip edge, holds height until its tail is clear, then drops onto the back roller
      const g = (age - TA) / TB;
      const gh = (yHold - yTip) / (land[1] - yTip);
      const zf = Math.max(0, (g - gh) / (1 - gh));
      base = [xAt(0.5 + g * 0.5), yTip + (land[1] - yTip) * g, zHold + (land[2] - zHold) * zf * zf];
      th = -0.06 - 0.34 * api.smooth(0, 0.6, g) + 0.14 * api.smooth(0.6, 1, g);
    } else if (age < T_NIP) {
      const g = (age - TA - TB) / TT;
      const e = api.smooth(0, 1, g);
      base = [X0, land[1] + (nipY - land[1]) * e, land[2] + (nipRest - land[2]) * e + Math.sin(Math.PI * g) * 1.0 * (1 - g)];
      th = -0.26 * (1 - g) * (1 - g) + 0.16 * Math.sin(Math.PI * 2 * g) * (1 - g);
    } else {
      const c = Math.min(1, (age - T_NIP) / TC);
      const e = api.smooth(0, 1, c);
      d = PK.d + (1.2 - PK.d) * e;
      h = PK.h + (2.2 - PK.h) * e;
      w = PK.w + 0.8 * e;
      base = [X0, nipY, nipRest + (zA - 2.6 - nipRest) * e];
      jx = Math.sin(t * 61) * 0.18 * Math.sin(Math.PI * c);
    }
    base[0] += jx;
    return pitchedBox(it.item.kind || "garbage", base, w, d, h, th);
  }
  function pileSvg(t) {
    const h = pileH();
    if (h < 0.01) return "";
    const plan = { x: binLocal.x0, y: binLocal.y0, w: binLocal.x1 - binLocal.x0, d: binLocal.y1 - binLocal.y0, r: 0.4 };
    const zt = binLocal.z + h;
    const fadeIn = api.smooth(0, 0.8, h);
    const list = chips.length ? chips : D.chips.slice(0, Math.round(D.chips.length * Math.min(1, fill * 1.4))).map(([x, y, a, s]) => ({ x, y, a, s, c: Math.round(a * 7) % 3, born: -1e9 }));
    const quads = list.map((q) => {
      const cx = X0 + q.x, cy = O[1] + q.y;
      const pts = [[0.7, 0.4], [-0.5, 0.55], [-0.7, -0.35], [0.45, -0.5]].map(([u, v]) => [cx + (u * Math.cos(q.a) - v * Math.sin(q.a)) * q.s * 1.4, cy + (u * Math.sin(q.a) + v * Math.cos(q.a)) * q.s * 1.4]);
      const o = api.smooth(0, 0.3, t - q.born);
      return '<path class="cr-chip" data-c="' + q.c + '"' + (o < 1 ? ' opacity="' + o.toFixed(3) + '"' : "") + ' d="' + onTop(pts, zt, P, true) + '"/>';
    }).join("");
    return '<g class="pk" data-kind="garbage"><g opacity="' + fadeIn.toFixed(3) + '">' + solidSvg(slabOf(plan, binLocal.z, h, P, 4, 0.2), { tone: "hi" }) + "</g>" + quads + "</g>";
  }
  function spawnFlakes(t) {
    for (let i = 0; i < PER; i++) pending.push({ due: t + i * 0.085, seed: Math.random() });
  }
  const LANE_V = [1.0, 0.86, 1.12, 0.93, 1.06, 0.82, 0.97];
  const laneX = (lane) => CH.x0 + 1.2 + lane * ((CH.x1 - CH.x0 - 2.4) / (LANES - 1));
  const laneTail = (lane) => flakes.reduce((m, f) => (f.mode === "slide" && f.lane === lane ? Math.min(m, f.y) : m), Infinity);
  // a flake comes out from under the housing wall in its own lane, slides down the chute, drops into the bin
  function startFlake(f) {
    const lane = laneNext % LANES;
    if (laneTail(lane) < CH.start + 1.9) return false;
    laneNext++;
    const r = f.seed;
    flakes.push({ mode: "slide", lane, x: laneX(lane) + (r - 0.5) * 0.4, y: CH.start, z: chuteZ(CH.start), vx: (r - 0.5) * 2, vy: VS * (0.55 + ((r * 5.7) % 1) * 0.75), vz: 0, th: r * 3, s: 0.8 + ((r * 13.1) % 1) * 0.3, tl: 0, wait: 0 });
    return true;
  }
  function settleAll(t) {
    for (const it of items) { count++; fill = Math.min(1, fill + 1 / CAP); }
    items.length = 0;
    for (const f of flakes) if (f.mode !== "land") fill = Math.min(1, fill + 1 / (CAP * PER));
    fill = Math.min(1, fill + pending.length / (CAP * PER));
    flakes.length = 0; pending.length = 0; chips = [];
    bin.pos = 0; bin.mode = "home"; gate.x = 1; gate.v = 0;
  }

  return {
    stats: () => ({ count, fill, bin: bin.mode }),
    accept(port, item, from) {
      if (port !== "in") return;
      if (api.calm()) {
        count++;
        fill = fill >= 1 - 1e-6 ? 1 / CAP : Math.min(1, fill + 1 / CAP);
        return;
      }
      items.push({ item, t0: api.now(), from: from || D.drop, done: false });
    },
    tick(dt, t) {
      const calm = api.calm();
      if (calm && (items.length || flakes.length || pending.length || bin.mode !== "home")) settleAll(t);
      let crushing = false, seen = false;
      for (const it of items) {
        const age = t - it.t0;
        if (age < T_NIP) seen = true;
        if (age > T_NIP - 0.15 && age < T_END) crushing = true;
        if (!it.flaked && age > T_NIP + 0.35) { it.flaked = true; spawnFlakes(t); }
        if (age >= T_END) { it.done = true; count++; }
      }
      for (let i = items.length - 1; i >= 0; i--) if (items[i].done) items.splice(i, 1);
      if (calm) {
        spin.x = 0; spin.v = 0; kick.x = 0; lamp.x = 0; needle.x = count * (Math.PI * 2) / 20;
      } else {
        settle(spin, crushing ? 4.6 : 1.4, dt, 0.32);
        springStep(kick, crushing ? 1 : 0, dt, 70, 7.5);
        settle(lamp, seen ? 1 : 0, dt, seen ? 0.06 : 0.25);
        springStep(needle, count * (Math.PI * 2) / 20, dt, 180, 15);
        settle(gate, bin.mode === "home" ? 1 : 0, dt, 0.12);
      }
      phase += spin.x * dt;
      belt += spin.x * (D.fly.r + 0.7) * dt;

      // rollers turn toward the nip: the back one's top runs +y, the front one's −y
      rollerEls.forEach((el, i) => {
        const F = D.rollers[i].F;
        const ph = i ? phase : -phase;
        el.innerHTML = D.rollers[i].bands.map(([s0, s1]) => fadedSvg(G.ribsOf(F, s0, s1, R, 14, P, { phase: ph, fade: [0.1, 0.55], seams: true }), { tone: "mid" })).join("");
      });
      const fly = D.fly;
      flyEl.innerHTML = lineSvg(Array.from({ length: fly.holes }, (_, i) => {
        const c = G.pointOf(fly.F, fly.w, fly.holeAt, -phase + (i / fly.holes) * Math.PI * 2);
        return G.circleOf(G.frameOf(c, fly.F.a, fly.F.u, fly.F.v), 0, fly.holeR, P, 18);
      }).join(""), { tone: "lo" });
      const pf = D.pulley.F;
      pulleyEl.innerHTML = lineSvg(Array.from({ length: 3 }, (_, i) => {
        const c = G.pointOf(pf, 3, 1.7, -phase * fly.ratio + (i / 3) * Math.PI * 2);
        return G.circleOf(G.frameOf(c, pf.a, pf.u, pf.v), 0, 0.55, P, 12);
      }).join("") + G.circleOf(pf, 3, 0.9, P, 14), { tone: "lo" });

      // lacing marks on the open middle of the two straight belt runs, each inside its own chunk
      {
        const run = D.belt.runs;
        const spacing = 9;
        const marks = [];
        for (let s = ((-belt % spacing) + spacing) % spacing; s < run.total; s += spacing) {
          const f = s / run.total;
          for (const [a, b] of run.runs) if (f > a + (b - a) * 0.12 && f < b - (b - a) * 0.12) marks.push(s);
        }
        for (const c of chunkMarks) {
          const pts = marks.filter((s) => (s >= c.s0 && s <= c.s1) || (s + run.total >= c.s0 && s + run.total <= c.s1)).map((s) => iso(api.along(D.belt.route, s / run.total), P));
          const html = pts.length ? dotsSvg(pts, { size: 0.45, tone: "hi" }) : "";
          if (html !== c.last) { c.g.innerHTML = html; c.last = html; }
        }
      }

      // tramp-relief spring: the front bearing block and its roller kick back while a packet is in the nip
      const shift = kick.x * 0.9;
      const tr = translateAlong(P, [0, shift, 0]);
      blockEls.forEach((el) => el.setAttribute("transform", tr));
      {
        const S0 = D.spring;
        const y0 = O[1] + S0.y0 + shift;
        const y1 = O[1] + S0.y1;
        const x = O[0] + S0.x, z = O[2] + S0.z;
        const F = G.frameOf([x, y0, z], [0, 1, 0], [0, 0, 1], [1, 0, 0]);
        const c = coil(y0 + 0.4, y1, [x, z], S0.r - 0.08, S0.turns, "y", P);
        springEl.innerHTML = solidSvg(G.disc(0, 0.4, S0.r, F, P), { tone: "mid" }) + lineSvg(c.back, { tone: "lo" }) + solidSvg(G.solidOf([[0.4, 0.6], [y1 - y0, 0.6]], F, P), { tone: "mid" }) + lineSvg(c.front, { tone: "mid" });
      }

      // counter dial: one division per packet destroyed, a stepped needle with a little overshoot
      {
        const F = D.dial.F;
        const s = D.dial.face + 0.05;
        const c = iso(G.pointOf(F, s, 0, 0), P);
        const tip = iso(G.pointOf(F, s, 2.5, needle.x), P);
        needleEl.innerHTML = lineSvg(pathOf([c, tip]), { tone: "hi", free: "end" }) + dotsSvg([c], { size: 0.7, tone: "hi" });
      }
      haloEl.setAttribute("opacity", (lamp.x * 0.6).toFixed(3));
      lensEl.setAttribute("opacity", (lamp.x * 0.94).toFixed(3));

      // bin: when full the chute gate closes, the drawer rolls out over the grate, dumps through its bottom, rolls back
      if (!calm) {
        const falling = flakes.some((f) => f.mode !== "slide");
        if (bin.mode === "home" && fill >= 1 - 1e-6) { bin.mode = "full"; api.announce("bin full, emptying"); }
        if (bin.mode === "full" && !falling && gate.x < 0.05) { bin.mode = "out"; bin.t = t; }
        if (bin.mode === "out") { bin.pos = api.smooth(0, 1, (t - bin.t) / 1.5); if (t - bin.t >= 1.5) { bin.mode = "dump"; bin.t = t; } }
        else if (bin.mode === "dump") { const f = Math.min(1, (t - bin.t) / 1.2); fill = Math.max(0, 1 - api.smooth(0, 1, f)); if (f >= 1) { fill = 0; chips = []; bin.mode = "back"; bin.t = t; } }
        else if (bin.mode === "back") { bin.pos = 1 - api.smooth(0, 1, (t - bin.t) / 1.5); if (t - bin.t >= 1.5) {
          bin.pos = 0; bin.mode = "home"; api.announce("bin emptied");
          // the gate lifts: the queue leaves one flake at a time, front of the queue first
          flakes.filter((f) => f.mode === "slide").sort((a, b) => b.y - a.y || a.lane - b.lane).forEach((f, k) => (f.wait = t + 0.25 + k * 0.07));
        } }
      }
      const btr = bin.pos > 1e-4 ? translateAlong(P, [0, bin.pos * B.travel, 0]) : "";
      binEls.forEach((el) => (btr ? el.setAttribute("transform", btr) : el.removeAttribute("transform")));
      const gtr = gate.x > 1e-3 ? translateAlong(P, [0, 0, gate.x * 2.9]) : "";
      gateEls.forEach((el) => (gtr ? el.setAttribute("transform", gtr) : el.removeAttribute("transform")));

      // flakes: released one at a time into lanes; they queue behind the gate while it is shut
      pending.sort((a, b) => a.due - b.due);
      while (pending.length && t >= pending[0].due && t >= nextRelease && startFlake(pending[0])) { pending.shift(); nextRelease = t + 0.085; }
      const shut = bin.mode !== "home" || gate.x < 0.8;
      const lanes = {};
      for (const f of flakes) if (f.mode === "slide") (lanes[f.lane] ??= []).push(f);
      for (const lane in lanes) {
        let limit = Infinity;
        for (const f of lanes[lane].sort((a, b) => b.y - a.y)) {
          const stop = shut && f.y <= gateY - 0.9 ? Math.min(limit, gateY - 0.9) : limit;
          if (t >= f.wait) f.y = Math.max(f.y, Math.min(f.y + VS * LANE_V[f.lane] * dt, stop));
          f.z = chuteZ(Math.min(f.y, CH.y1));
          limit = f.y - 1.9;
          if (f.y >= CH.y1 + 0.4) { f.mode = "fall"; f.vz = 0; }
        }
      }
      const zPile = binLocal.z + pileH();
      for (let i = flakes.length - 1; i >= 0; i--) {
        const f = flakes[i];
        if (f.mode === "fall") {
          f.x += f.vx * dt; f.y += f.vy * dt; f.vz -= GRAV * dt; f.z += f.vz * dt; f.th += 9 * dt;
          if (f.z <= zPile) {
            f.z = zPile; f.mode = "land"; f.tl = t;
            fill = Math.min(1, fill + 1 / (CAP * PER));
            chips.push({ x: f.x - X0, y: f.y - O[1], a: f.th, s: f.s * 0.9, c: f.lane % 3, born: t });
            if (chips.length > 70) chips.shift();
          }
        } else if (f.mode === "land" && t - f.tl > 0.3) flakes.splice(i, 1);
      }
      const drawn = flakes.slice().sort((a, b) => dot3([a.x, a.y, a.z], V) - dot3([b.x, b.y, b.z], V)).map((f) => {
        if (f.mode !== "land") return pitchedBox("garbage", [f.x, f.y, f.z], 1.5 * f.s, 1.1 * f.s, 0.7 * f.s, f.mode === "fall" ? f.th : 0, false);
        const k = Math.min(1, (t - f.tl) / 0.3);
        return '<g opacity="' + (1 - k).toFixed(3) + '">' + pitchedBox("garbage", [f.x, f.y, f.z], 1.5 * f.s, 1.1 * f.s, 0.7 * f.s * (1 - 0.7 * k), 0, false) + "</g>";
      }).join("");
      binSlot.innerHTML = pileSvg(t);
      flakeSlot.innerHTML = drawn;
      itemSlot.innerHTML = calm ? "" : items.map((it) => drawItem(it, t)).join("");
    },
  };
};`;
