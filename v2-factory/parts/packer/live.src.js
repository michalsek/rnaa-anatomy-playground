MACHINES.packer = (api) => {
  const makeRig = __MAKE_RIG__;
  const R = makeRig({ iso, pathOf, solidSvg, lineSvg, dotsSvg, cameraOf, slabOf, sideSeam, lineOnTop }, G, api.P);
  const D = api.data;
  const at = api.at;
  const slots = { gutter: api.slot("gutter"), stack: api.slot("stack"), lane: api.slot("lane"), picker: api.slot("picker"), folder: api.slot("folder") };
  const last = {};
  const write = (name, svg) => {
    if (last[name] !== svg && slots[name]) slots[name].innerHTML = svg;
    last[name] = svg;
  };
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const smoother = (x) => {
    const t = clamp01(x);
    return t * t * t * (t * (t * 6 - 15) + 10);
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const mix = (A, B, t) => api.lerp3(A, B, smoother(t));
  const hop = (A, B, t, lift) => {
    const p = mix(A, B, t);
    p[2] += lift * Math.sin(Math.PI * clamp01(t));
    return p;
  };
  const KINDS = ["control", "graph", "data"];
  const BEAD = 2.4;
  // where the three beads come to rest in a carton: two on the floor, one on top that settles as the lid closes
  const CLUSTER = [[-2.3, -0.9, 0], [2.3, -0.9, 0], [0, 0.9, 3.6]];
  let nextKind = 0;
  const kindNext = () => KINDS[nextKind++ % KINDS.length];
  let clock = 0;
  let beadsIn = 0;
  let packetsOut = 0;
  let stillDrawn = false;

  function setPhase(o, phase) {
    o.phase = phase;
    o.t0 = clock;
  }
  const age = (o) => clock - o.t0;

  // ---- gutter ------------------------------------------------------------------------------------
  const GT = D.gutter;
  const nest = [];
  const slotX = (i) => (i < 3 ? GT.pockets[i] : GT.queue - (i - 3) * 1.2);
  const settledAt = (b, i) => b && b.phase === "roll" && Math.abs(b.x - slotX(i)) < 0.15 && Math.abs(b.v) < 0.5;
  const tempo = () => 1 + Math.min(0.8, 0.25 * Math.max(0, nest.length - 3));
  const T = (seconds) => seconds / tempo();
  function addBead(item, from) {
    const f = from ?? D.ports.in;
    nest.push({ item, phase: "fly", t0: clock, from: [f[0], f[1], f[2]], x: GT.entry, v: 0 });
  }
  function stepGutter(dt) {
    nest.forEach((b, i) => {
      if (b.phase === "fly") {
        if (clock - b.t0 >= 0.34) {
          b.phase = "roll";
          b.v = 12;
        }
        return;
      }
      const target = slotX(i);
      const w = 9;
      for (let s = 0; s < 4; s++) {
        const h = dt / 4;
        b.v += (w * w * (target - b.x) - 2 * w * b.v) * h;
        b.v = Math.max(-26, Math.min(26, b.v));
        b.x += b.v * h;
      }
    });
  }
  function beadPos(b) {
    if (b.phase === "fly") {
      const t = Math.min(1, (clock - b.t0) / 0.34);
      const p = api.lerp3(b.from, [GT.entry, GT.y, GT.z], t);
      p[2] += 2.2 * Math.sin(Math.PI * t) * (1 - t * 0.3);
      return p;
    }
    return [b.x, GT.y, GT.z];
  }
  function drawGutter() {
    write("gutter", nest.slice(0, 6).map((b) => api.fluffSvg(beadPos(b), BEAD)).join(""));
  }
  // receiver LEDs on the near lip light when their pocket holds a bead (drawn first in the picker slot)
  function eyeLeds() {
    return GT.eyes
      .map((p, i) => {
        if (!settledAt(nest[i], i)) return "";
        const c = at(p);
        return '<circle cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="' + (0.38 * api.KS).toFixed(2) + '" fill="var(--fx-react)" stroke="none"/>';
      })
      .join("");
  }

  // ---- lane: cartons, walking beam, magazine, erector ---------------------------------------------
  const LN = D.lane;
  const ST = LN.stations;
  const TOP = LN.z + 7;
  const cartons = [];
  const stack = [];
  for (let i = 0; i < 10; i++) stack.push({ kind: kindNext() });
  const OPEN = 1.95;
  const at0 = (y) => cartons.find((c) => Math.abs(c.y - y) < 0.5);
  const feeder = { phase: "idle", t0: 0, plate: D.pusher.rest };
  const erector = { phase: "idle", t0: 0, pad: D.erector.rest, carton: null };
  const beam = { phase: "idle", t0: 0, shift: 0, rise: 0 };
  let stackDrop = 0;

  function makeCarton(kind, y, stage, H) {
    const open = stage === "open" || stage === "filled";
    return { kind, y, x: LN.x, z: LN.z, H, stage, flaps: open ? [OPEN, OPEN, OPEN, OPEN] : [0, 0, 0, 0], fv: [0, 0, 0, 0], beads: [], tape: 0, t0: clock, home: y };
  }
  if (D.prefill) {
    const c2 = makeCarton(stack.shift().kind, ST[2], "filled", 7);
    c2.beads = CLUSTER.map((o) => ({ o, t0: -9, from: null }));
    cartons.push(c2);
    cartons.push(makeCarton(stack.shift().kind, ST[1], "open", 7));
    cartons.push(makeCarton(stack.shift().kind, ST[0], "open", 7));
    for (let i = 0; i < 3; i++) stack.push({ kind: kindNext() });
  }

  function stepFeeder() {
    const P0 = D.pusher;
    if (feeder.phase === "idle") {
      if (beam.phase === "idle" && !at0(ST[0]) && !cartons.some((c) => c.stage === "blank")) {
        const b = stack.shift();
        stack.push({ kind: kindNext() });
        cartons.push(makeCarton(b.kind, D.magazine.y, "blank", 1));
        setPhase(feeder, "push");
      }
    } else if (feeder.phase === "push") {
      const t = age(feeder) / T(0.55);
      feeder.plate = lerp(P0.rest, P0.out, smoother(t));
      const c = cartons.find((c) => c.stage === "blank");
      if (c) c.y = feeder.plate + 4;
      if (t >= 1) {
        if (c) {
          c.y = ST[0];
          c.stage = "erecting";
          erector.carton = c;
          setPhase(erector, "down");
        }
        setPhase(feeder, "back");
      }
    } else if (feeder.phase === "back") {
      const t = age(feeder) / T(0.45);
      feeder.plate = lerp(P0.out, P0.rest, smoother(t));
      if (t >= 1) {
        stackDrop = 1;
        setPhase(feeder, "drop");
      }
    } else if (feeder.phase === "drop") {
      const t = age(feeder) / T(0.18);
      stackDrop = 1 - t * t;
      if (t >= 1) {
        stackDrop = 0;
        setPhase(feeder, "idle");
      }
    }
  }
  // flaps open on a damped spring that starts at rest (ω 14 rad/s, ζ 0.7), one after the other
  function springFlaps(c, dt, since) {
    const w = 14;
    let moving = false;
    for (let i = 0; i < 4; i++) {
      if (since < i * 0.05) {
        moving = true;
        continue;
      }
      for (let s = 0; s < 4; s++) {
        const h = dt / 4;
        c.fv[i] += (w * w * (OPEN - c.flaps[i]) - 2 * 0.7 * w * c.fv[i]) * h;
        c.flaps[i] += c.fv[i] * h;
      }
      if (Math.abs(c.flaps[i] - OPEN) > 0.004 || Math.abs(c.fv[i]) > 0.03) moving = true;
    }
    return moving;
  }
  function stepErector(dt) {
    const E = D.erector;
    const c = erector.carton;
    if (erector.phase === "down") {
      const t = age(erector) / T(0.24);
      erector.pad = lerp(E.rest, LN.z + 1, smoother(t));
      if (t >= 1) setPhase(erector, "lift");
    } else if (erector.phase === "lift") {
      const t = age(erector) / T(0.36);
      c.H = lerp(1, 7, smoother(t));
      erector.pad = LN.z + c.H;
      if (t >= 1) setPhase(erector, "up");
    } else if (erector.phase === "up") {
      const t = age(erector) / T(0.3);
      erector.pad = lerp(TOP, E.rest, smoother(t));
      // the flaps may only swing once the pad is clear of the major flaps' arc
      if (erector.pad > TOP + 3.9) {
        if (erector.flapsAt === undefined) erector.flapsAt = clock;
        const moving = springFlaps(c, dt * tempo(), clock - erector.flapsAt);
        if (!moving && t >= 1) {
          c.flaps = [OPEN, OPEN, OPEN, OPEN];
          c.stage = "open";
          erector.carton = null;
          erector.flapsAt = undefined;
          setPhase(erector, "idle");
        }
      }
    }
  }
  function stepBeam() {
    if (beam.phase === "idle") {
      const s0 = at0(ST[0]);
      const s1 = at0(ST[1]);
      const s2 = at0(ST[2]);
      const ready = s0 && s0.stage === "open" && (!s1 || s1.stage === "filled") && (!s2 || s2.stage === "taped") && feeder.phase !== "push" && folder.free && picker.clearOfLane;
      if (ready) {
        for (const c of cartons) c.home = c.y;
        setPhase(beam, "rise");
      }
      return;
    }
    if (beam.phase === "rise") {
      beam.rise = smoother(age(beam) / T(0.12));
      if (age(beam) >= T(0.12)) setPhase(beam, "push");
    } else if (beam.phase === "push") {
      const t = age(beam) / T(0.55);
      beam.shift = LN.pitch * smoother(t);
      for (const c of cartons) if (c.stage !== "blank" && c.stage !== "erecting") c.y = c.home + beam.shift;
      if (t >= 1) {
        // hand the packet on at the end of the stroke: it is clear of the nose and at rest
        for (const c of [...cartons]) if (c.y > ST[2] + 1) emitPacket(c);
        setPhase(beam, "sink");
      }
    } else if (beam.phase === "sink") {
      beam.rise = 1 - smoother(age(beam) / T(0.12));
      if (age(beam) >= T(0.12)) {
        beam.rise = 0;
        beam.shift = 0;
        for (const c of cartons) c.y = Math.round(c.y * 100) / 100;
        setPhase(beam, "idle");
      }
    }
  }
  function emitPacket(c) {
    packetsOut++;
    cartons.splice(cartons.indexOf(c), 1);
    const item = api.item(c.kind);
    item.v = [0, 0, 0];
    api.emit("out", item, [c.x, c.y, c.z]);
    api.announce("packet " + packetsOut + " packed: " + c.kind);
  }

  // ---- picker: lift → traverse → lower, never across the gutter walls ------------------------------
  const PS = D.picker;
  const TOOL = 12.6;
  const GATE = GT.z + 23.4; // beads hang 0.8 clear of the photo-eyes on the gutter wall
  const PICK = [GT.pockets[1], GT.y, GT.z + 2 * BEAD + TOOL];
  const PHOME = [PICK[0], PICK[1], GATE];
  const PLACE = [LN.x, ST[1], TOP + 2 + 2 * BEAD + TOOL];
  const PGATE = [PLACE[0], PLACE[1], GATE];
  const picker = { phase: "home", t0: 0, W: PHOME, carried: [], squeeze: 0, vacuum: false, clearOfLane: true };
  const LOW = ["lower", "release", "rise"];
  function stepPicker() {
    const p = picker;
    const s1 = at0(ST[1]);
    p.clearOfLane = !LOW.includes(p.phase);
    const go = (phase, seconds, from, to) => {
      const t = age(p) / T(seconds);
      p.W = mix(from, to, t);
      return t >= 1;
    };
    if (p.phase === "home") {
      p.W = PHOME;
      if (nest.length >= 3 && [0, 1, 2].every((i) => settledAt(nest[i], i))) setPhase(p, "descend");
    } else if (p.phase === "descend") {
      if (go("descend", 0.28, PHOME, PICK)) setPhase(p, "grip");
    } else if (p.phase === "grip") {
      const t = age(p) / T(0.18);
      p.squeeze = smoother(t);
      p.vacuum = t > 0.3;
      if (t >= 1) {
        p.carried = nest.splice(0, 3).map((b) => b.item);
        setPhase(p, "lift");
      }
    } else if (p.phase === "lift") {
      if (go("lift", 0.28, PICK, PHOME)) setPhase(p, "traverse");
    } else if (p.phase === "traverse") {
      if (go("traverse", 0.5, PHOME, PGATE)) setPhase(p, "wait");
    } else if (p.phase === "wait") {
      p.W = PGATE;
      if (s1 && s1.stage === "open" && s1.beads.length === 0 && beam.phase === "idle" && folder.clearOfS1) setPhase(p, "lower");
    } else if (p.phase === "lower") {
      if (go("lower", 0.36, PGATE, PLACE)) setPhase(p, "release");
    } else if (p.phase === "release") {
      const t = age(p) / T(0.1);
      p.vacuum = false;
      p.squeeze = 1 - smoother(t);
      if (t >= 1) {
        const c = at0(ST[1]);
        if (c) {
          c.beads = p.carried.map((item, i) => ({ item, o: CLUSTER[i], t0: clock, from: [PLACE[0] - 5 + i * 5, PLACE[1], PLACE[2] - TOOL - 2 * BEAD] }));
          c.stage = "filling";
          c.t0 = clock;
        }
        p.carried = [];
        setPhase(p, "rise");
      }
    } else if (p.phase === "rise") {
      if (go("rise", 0.28, PLACE, PGATE)) setPhase(p, "back");
    } else if (p.phase === "back") {
      if (go("back", 0.45, PGATE, PHOME)) setPhase(p, "home");
    }
    for (const c of cartons) if (c.stage === "filling" && clock - c.t0 > T(0.4)) c.stage = "filled";
  }
  function pickerTool(q) {
    const W = q.W;
    const parts = [];
    const put = (z, c, svg) => parts.push({ z, d: R.depth(c), svg });
    put(W[2] - 3, W, R.cap([W[0], W[1], W[2] - 1.9], [0, 0, -1], 0, 2.3, 1.3, { tone: "mid" }));
    put(W[2] - 4.6, W, R.cap([W[0], W[1], W[2] - 4.2], [0, 0, -1], 0, 0.8, 1.8, { tone: "hi" }));
    put(W[2] - 6.3, W, R.cap([W[0], W[1], W[2] - 5], [0, 0, -1], 0, 2.6, 0.7, { tone: "mid" }));
    // the vacuum head is the one accent: React-blue manifold bar with a lamp that lights while it holds
    const barF = R.frame([W[0], W[1], W[2] - 9], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    let head = '<g class="it fx-react">' + R.S(R.prism(barF, R.rect(-6.6, 6.6, 0, 1.4), -0.9, 0.9), { tone: "hi" }) + R.S(R.prism(barF, R.rect(1.4, 4.4, 1.4, 2.2), -0.7, 0.7), { tone: "hi" }) + "</g>";
    head += R.cap([W[0], W[1], W[2] - 7.6], [0, 0, 1], 0, 0.6, 1.4, { tone: "mid" });
    const lamp = at([W[0] + 2.9, W[1] + 0.7, W[2] - 9 + 1.8]);
    head += '<circle cx="' + lamp[0].toFixed(1) + '" cy="' + lamp[1].toFixed(1) + '" r="' + (0.32 * api.KS).toFixed(2) + '" fill="' + (picker.vacuum ? "var(--fx-react)" : "var(--anatomy-paper)") + '" stroke="var(--anatomy-lo)" stroke-width="0.4"/>';
    put(W[2] - 8.3, W, head);
    const squeeze = picker.squeeze || 0;
    [-5, 0, 5].forEach((dx, i) => {
      const c = [W[0] + dx, W[1], W[2] - 9];
      const k = 1 - 0.12 * squeeze;
      const F = G.frameAlong(c, [0, 0, -1]);
      const prof = [[0, 0.45], [1 * k, 0.45], [1 * k, 0.85, 1], [1.4 * k, 1.05, 1], [1.8 * k, 0.8, 1], [2.2 * k, 1.05, 1], [2.6 * k, 0.8, 1], [2.9 * k, 0.85, 1], [3.6 - 0.1 * squeeze, 1.35]];
      put(W[2] - 11 - (2 - Math.abs(dx) / 5) * 0.01, c, R.S(G.solidOf(prof, F, api.P, { steps: 28, fill: "surface" }), { tone: "mid" }));
      if (picker.carried[i] !== undefined) put(W[2] - 20, c, api.fluffSvg([c[0], c[1], W[2] - TOOL - 2 * BEAD], BEAD));
    });
    return parts;
  }

  // ---- folder: closes the flaps from above, then tapes from the far end toward the viewer's left ---------
  const FS = D.folder;
  const FTOOL = 9;
  const C2 = [LN.x, ST[2]];
  const FHOME = D.folderHome;
  const FHOVER = [C2[0], C2[1], TOP + FTOOL + 5];
  const folder = { phase: "home", t0: 0, W: FHOME, free: true, clearOfS1: true, carton: null };
  function stepFolder() {
    const f = folder;
    const c = at0(ST[2]);
    f.free = f.phase === "home" || (f.phase === "return" && age(f) > T(0.12));
    // shared envelope: while the folder runs its tape stroke its elbow stands beside S1, so the picker stays up
    f.clearOfS1 = !["toStart", "tape"].includes(f.phase);
    const go = (seconds, from, to, lift = 0) => {
      const t = age(f) / T(seconds);
      f.W = lift ? hop(from, to, t, lift) : mix(from, to, t);
      return t >= 1;
    };
    if (f.phase === "home") {
      f.W = FHOME;
      if (c && c.stage === "filled" && beam.phase === "idle") {
        c.stage = "folding";
        f.carton = c;
        setPhase(f, "approach");
      }
      return;
    }
    const cc = f.carton;
    const X1 = cc.x + 5;
    const X0 = cc.x - 5;
    if (f.phase === "approach") {
      if (go(0.32, FHOME, FHOVER)) setPhase(f, "minor");
    } else if (f.phase === "minor") {
      const t = age(f) / T(0.26);
      cc.flaps[0] = cc.flaps[1] = OPEN * (1 - smoother(t));
      if (t >= 1) setPhase(f, "major");
    } else if (f.phase === "major") {
      const t = age(f) / T(0.3);
      cc.flaps[2] = OPEN * (1 - smoother(t * 1.12));
      cc.flaps[3] = OPEN * (1 - smoother(t * 1.12 - 0.12));
      if (t >= 1) {
        cc.flaps = [0, 0, 0, 0];
        cc.stage = "closed";
        setPhase(f, "holdS1");
      }
    } else if (f.phase === "holdS1") {
      // wait above the closed carton while the picker is down in S1
      if (picker.clearOfLane) setPhase(f, "toStart");
    } else if (f.phase === "toStart") {
      const t = age(f) / T(0.26);
      const e = smoother(t);
      f.W = [lerp(FHOVER[0], X1 + 2.4, e), cc.y, lerp(FHOVER[2], TOP + FTOOL, smoother(t * 1.3 - 0.3))];
      if (t >= 1) {
        cc.stage = "taping";
        setPhase(f, "tape");
      }
    } else if (f.phase === "tape") {
      const t = age(f) / T(0.5);
      const e = smoother(t);
      f.W = [X1 + 2.4 - 10 * e, cc.y, TOP + FTOOL];
      cc.tape = e;
      if (t >= 1) {
        cc.stage = "taped";
        cc.t0 = clock;
        setPhase(f, "return");
      }
    } else if (f.phase === "return") {
      if (go(0.42, [X0 + 2.4, cc.y, TOP + FTOOL], FHOME, 3)) {
        f.carton = null;
        setPhase(f, "home");
      }
    }
  }
  function folderTool(q) {
    const W = q.W;
    const parts = [];
    const put = (z, c, svg) => parts.push({ z, d: R.depth(c), svg });
    put(W[2] - 2.8, W, R.cap([W[0], W[1], W[2] - 1.8], [0, 0, -1], 0, 2, 1.3, { tone: "mid" }));
    put(W[2] - 4.1, W, R.cap([W[0], W[1], W[2] - 3.8], [0, 0, -1], 0, 0.6, 1.7, { tone: "hi" }));
    const F = R.frame([W[0], W[1], W[2] - 7.4], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    put(W[2] - 5.9, W, R.S(R.prism(F, R.rect(-3.4, 3.4, 0, 3), -1.5, 1.5), { tone: "mid" }));
    // plough fingers and the roller brackets hang below the block; the roller leads on the -x side
    for (const x of [-3, 3]) put(W[2] - 8, [W[0] + x, W[1], W[2] - 8], R.S(R.prism(F, R.rect(x - 0.3, x + 0.3, -1.2, 0), -1.2, 1.2), { tone: "lo" }));
    for (const y of [-1.5, 1.5]) put(W[2] - 7.9, [W[0] - 2.4, W[1] + y, W[2] - 8], R.S(R.prism(F, R.rect(-2.9, -1.9, -0.7, 0), y - 0.2 * Math.sign(y) - 0.1, y - 0.2 * Math.sign(y) + 0.1), { tone: "mid" }));
    put(W[2] - 8.1, [W[0] - 2.4, W[1], W[2] - 8.1], R.cap([W[0] - 2.4, W[1] - 1.2, W[2] - 8.1], [0, 1, 0], 0, 2.4, 0.9, { tone: "hi" }));
    // the tape roll sits on the near face, behind the roller
    const rc = [W[0] + 1.2, W[1] + 1.5, W[2] - 5.4];
    put(W[2] - 5.6, rc, R.cap(rc, [0, 1, 0], 0, 1.2, 1.9, { tone: "hi" }) + R.Ln(G.circleOf(G.frameAlong(rc, [0, 1, 0]), 1.2, 0.8, api.P, 24), { tone: "lo" }));
    return parts;
  }

  // ---- drawing -----------------------------------------------------------------------------------------
  const wrap = (kind, s) => '<g class="pk" data-kind="' + kind + '">' + s + "</g>";
  function drawStack() {
    const M = D.magazine;
    const P0 = D.pusher;
    const lifted = feeder.phase === "push" || feeder.phase === "back";
    let svg = "";
    stack.slice(0, 9).forEach((b, i) => {
      const z = lifted ? M.z + 1 + i : M.z + i + stackDrop;
      svg += wrap(b.kind, R.cartonSvg({ x: M.x, y: M.y, z, H: 1, flaps: [0, 0, 0, 0] }));
    });
    const blank = cartons.find((c) => c.stage === "blank");
    if (blank) svg += wrap(blank.kind, R.cartonSvg(blank));
    const rodF = G.frameAlong([M.x, P0.glandY, P0.z], [0, 1, 0]);
    const len = feeder.plate - 0.6 - P0.glandY;
    let rod = "";
    if (len > 0.05) rod += R.S(G.disc(0, len, 0.45, rodF, api.P, { steps: 16 }), { tone: "hi" });
    rod += R.S(slabOf({ x: M.x - 4, y: feeder.plate - 0.6, w: 8, d: 0.6, r: 0.1 }, P0.z - 0.45, 0.9, api.P, 1), { tone: "mid" });
    write("stack", rod + svg);
  }
  function cartonSvg(c) {
    const strap = (from, to) => lineSvg(lineOnTop([from, c.y], [to, c.y], c.z + c.H, api.P), { tone: "lo" });
    const X1 = c.x + R.CW / 2;
    if (c.stage === "taped") {
      // crossfade the folded carton into the shared packet look while the band appears
      const f = Math.min(1, (clock - c.t0) / T(0.35));
      const base = api.packetSvg(c.kind, [c.x, c.y, c.z]);
      if (f >= 1) return base;
      return base + '<g opacity="' + (1 - f).toFixed(2) + '">' + wrap(c.kind, R.cartonSvg(c) + strap(X1, X1 - R.CW)) + "</g>";
    }
    const inside = c.beads.map((b) => {
      const t = b.from ? Math.min(1, (clock - b.t0) / T(0.32)) : 1;
      const lid = 1 - clamp01((OPEN - c.flaps[3]) / OPEN);
      const end = [c.x + b.o[0], c.y + b.o[1], c.z + R.WALL + b.o[2] * (0.5 + 0.5 * lid)];
      const p = b.from ? [lerp(b.from[0], end[0], smoother(t)), lerp(b.from[1], end[1], smoother(t)), lerp(b.from[2], end[2], t * t)] : end;
      return { d: R.depth(p), svg: api.fluffSvg(p, BEAD) };
    });
    let svg = R.cartonSvg(c, inside);
    if (c.stage === "taping") svg += strap(X1, X1 - R.CW * c.tape);
    return wrap(c.kind, svg);
  }
  function drawLane() {
    const parts = [];
    for (const c of cartons) if (c.stage !== "blank") parts.push({ d: R.depth([c.x, c.y, c.z + c.H / 2]), svg: cartonSvg(c) });
    if (beam.rise > 0.01) {
      for (const y0 of ST) {
        const y = y0 - 4.6 + beam.shift;
        if (y > LN.edge - 1.4) continue;
        const h = 3 * beam.rise;
        parts.push({ d: R.depth([LN.x, y, LN.z + h / 2]), svg: R.S(slabOf({ x: LN.x - 0.6, y: y - 0.6, w: 1.2, d: 1.2, r: 0.15 }, LN.z, h, api.P, 1), { tone: "hi" }) });
      }
    }
    const E = D.erector;
    const padZ = erector.pad;
    const rodF = G.frameAlong([E.x, E.y, E.glandZ], [0, 0, -1]);
    const len = E.glandZ - (padZ + 1);
    let pad = "";
    if (len > 0.05) pad += R.S(G.disc(0, len, 0.5, rodF, api.P, { steps: 16 }), { tone: "hi" });
    pad += R.S(G.disc(0, 1, 2.6, G.frameAlong([E.x, E.y, padZ], [0, 0, 1]), api.P, { steps: 32 }), { tone: "mid" });
    parts.push({ d: R.depth([E.x, E.y, padZ + 3]) + 50, svg: pad });
    parts.sort((a, b) => a.d - b.d);
    write("lane", parts.map((p) => p.svg).join(""));
  }
  function drawArms() {
    const qp = R.solve(PS, picker.W);
    write("picker", eyeLeds() + R.armSvg(PS, qp, pickerTool));
    write("folder", R.armSvg(FS, R.solve(FS, folder.W), folderTool));
  }
  function drawAll() {
    drawGutter();
    drawStack();
    drawLane();
    drawArms();
  }

  return {
    tick(dt) {
      // reduced motion: one settled frame, then nothing moves and nothing is accepted
      if (api.calm()) {
        if (!stillDrawn) drawAll();
        stillDrawn = true;
        return;
      }
      stillDrawn = false;
      clock += dt;
      stepGutter(dt);
      stepFeeder();
      stepErector(dt);
      stepPicker();
      stepFolder();
      stepBeam();
      drawAll();
    },
    accept(port, item, from) {
      if (port !== "in" || api.calm()) return;
      beadsIn++;
      addBead(item, from);
    },
    stats: () => {
      const s1 = at0(ST[1]);
      return { beads: beadsIn, packets: packetsOut, next: s1 && s1.stage !== "filled" ? s1.kind : stack[0].kind };
    },
  };
};
