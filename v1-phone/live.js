const D = __DATA__;
const P = D.P;
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const layer = svg.querySelector(".rn-parts");
const tokensLayer = svg.querySelector('[data-part="tokens"]');
const readout = document.querySelector("[data-readout]");
const status = document.querySelector("[data-status]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const NS = "http://www.w3.org/2000/svg";
const $ = (sel) => svg.querySelector(sel);
const at = (p) => iso(p, P);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const f1 = (v) => v.toFixed(1);

// ---- the engine's clock: one vane passing the index is one render quantum ------------
const SAMPLE_RATE = 48000;
const QUANTUM = 128;
const REAL_PER_SECOND = SAMPLE_RATE / QUANTUM; // 375 quanta every second on a real device
const SHOWN_PER_SECOND = 1.5;
const SLOWER = Math.round(REAL_PER_SECOND / SHOWN_PER_SECOND);
const VANE = (Math.PI * 2) / D.core.vanes;

// ---- exploded assembly ----------------------------------------------------------
const nodes = [...layer.querySelectorAll(".it")].map((el) => ({ el, piece: el.dataset.piece, key: Number(el.dataset.k), m: el.dataset.m.split(",").map(Number), shown: "" }));
for (const node of nodes) node.lift = node.m[0] * D.V[0] + node.m[1] * D.V[1] + node.m[2] * D.V[2];
let order = nodes.map((_, i) => i);
const piece = Object.fromEntries(D.stagger.map((id) => [id, { x: 0, v: 0, target: 0, pending: null }]));
const offsetOf = (id) => {
  const m = D.moves[id];
  const share = piece[id].x;
  return [(D.EX[0] * m[0] + D.EY[0] * m[1] + D.EZ[0] * m[2]) * share, (D.EX[1] * m[0] + D.EY[1] * m[1] + D.EZ[1] * m[2]) * share];
};
let clock = 0;
let apart = false;
function setApart(value) {
  if (value === apart) return;
  apart = value;
  const list = (value ? D.stagger : [...D.stagger].reverse()).filter((id) => piece[id].target !== (value ? 1 : 0) || piece[id].pending);
  list.forEach((id, index) => (piece[id].pending = { value: value ? 1 : 0, at: clock + index * D.spring.stagger }));
  announce(value ? "opening the phone" : "closing the phone");
}
function springs(dt, calm) {
  for (const id of D.stagger) {
    const s = piece[id];
    if (s.pending && clock >= s.pending.at) {
      s.target = s.pending.value;
      s.pending = null;
    }
    if (calm) {
      s.x = s.target;
      s.v = 0;
      continue;
    }
    const h = dt / D.spring.substeps;
    for (let i = 0; i < D.spring.substeps; i++) {
      s.v += ((s.target - s.x) * D.spring.stiffness - s.v * D.spring.damping) * h;
      s.x += s.v * h;
    }
    if (Math.abs(s.target - s.x) < 5e-4 && Math.abs(s.v) < 5e-4) {
      s.x = s.target;
      s.v = 0;
    }
  }
}
function place() {
  for (const node of nodes) {
    const share = piece[node.piece].x;
    const [tx, ty] = offsetOf(node.piece);
    const text = share === 0 ? "" : `translate(${tx.toFixed(2)} ${ty.toFixed(2)})`;
    if (text !== node.shown) {
      node.shown = text;
      if (text) node.el.setAttribute("transform", text);
      else node.el.removeAttribute("transform");
    }
  }
  const next = nodes.map((_, i) => i).sort((a, b) => nodes[a].key + nodes[a].lift * piece[nodes[a].piece].x - (nodes[b].key + nodes[b].lift * piece[nodes[b].piece].x));
  if (next.some((index, i) => index !== order[i])) {
    const fragment = document.createDocumentFragment();
    for (const index of next) fragment.appendChild(nodes[index].el);
    layer.appendChild(fragment);
    order = next;
  }
}

// ---- moving parts ----------------------------------------------------------------
const el = {
  vanes: $('[data-part="vanes"]'),
  osc: $('[data-part="osc-wheel"]'),
  bufPulley: $('[data-part="buf-pulley"]'),
  reels: [$('[data-part="reel0"]'), $('[data-part="reel1"]')],
  ringTable: $('[data-part="ring-table"]'),
  ringCaps: $('[data-part="ring-caps"]'),
  needle: $('[data-part="needle"]'),
  gain: $('[data-part="gain-pointer"]'),
  plunger: $('[data-part="plunger"]'),
  latch: $('[data-part="latch"]'),
  cone: $('[data-name="frame.speaker.cone"]'),
  ripple: $('[data-part="ripple"]'),
};
const CORE_F = G.frameOf([D.core.x, D.core.y, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
const vanesOf = (phase) => lineSvg(G.spokesOf(CORE_F, D.core.top, 5.4, 20.6, D.core.vanes, P, { phase, sweep: 0.62 }), { tone: "mid" });
function wheelOf(p, r, phase, pin = true) {
  const spokes = lineSvg(
    [0, 1, 2, 3, 4].map((i) => {
      const a = phase + (i * Math.PI * 2) / 5;
      return lineOnTop([p.x + Math.sin(a) * 2, p.y - Math.cos(a) * 2], [p.x + Math.sin(a) * (r - 1.8), p.y - Math.cos(a) * (r - 1.8)], p.z, P);
    }).join("") + ring(p.x, p.y, r - 1.8, p.z, P, 40) + ring(p.x, p.y, 2, p.z, P, 16),
    { tone: "lo" },
  );
  return pin ? spokes + dotsSvg([at([p.x + Math.sin(phase) * (r - 3.6), p.y - Math.cos(phase) * (r - 3.6), p.z])], { size: 1.3, tone: "hi" }) : spokes;
}
const reelOf = (p, phase) =>
  lineSvg(
    [0, 1, 2].map((i) => {
      const a = phase + (i * Math.PI * 2) / 3;
      return lineOnTop([p.x + Math.sin(a) * 1.2, p.y - Math.cos(a) * 1.2], [p.x + Math.sin(a) * (p.r - 0.7), p.y - Math.cos(a) * (p.r - 0.7)], p.z, P);
    }).join("") + ring(p.x, p.y, 1.2, p.z, P, 12),
    { tone: "lo" },
  );
const pocket = (i, phase) => {
  const a = phase + ((i + 0.5) * Math.PI * 2) / 8;
  return [D.ring.x + Math.sin(a) * 6.2, D.ring.y - Math.cos(a) * 6.2];
};
const ringTableOf = (phase) => lineSvg(Array.from({ length: 8 }, (_, i) => ring(...pocket(i, phase), 1.6, D.ring.z, P, 12)).join(""), { tone: "lo" });
function needleOf(level) {
  const g = D.gauge;
  const a = -Math.PI * 0.7 + Math.PI * 1.4 * clamp(level, 0, 1);
  return lineOnTop([g.x - Math.sin(a) * 1.2, g.y + Math.cos(a) * 1.2], [g.x + Math.sin(a) * 5, g.y - Math.cos(a) * 5], g.z, P);
}
function gainOf(value) {
  const g = D.gain;
  const a = -Math.PI * 0.75 + Math.PI * 1.5 * value;
  return lineOnTop([g.x, g.y], [g.x + Math.sin(a) * 4.8, g.y - Math.cos(a) * 4.8], g.z, P);
}
function latchOf(t) {
  const L = D.latch;
  const a = (t * Math.PI) / 2.6;
  const p0 = at([L.x, L.y, L.z]);
  const p1 = at([L.x + Math.cos(a) * 5, L.y, L.z + Math.sin(a) * 5]);
  return `<path class="iso-line rn-js" data-free="end" style="stroke-width:1.6" d="M${f1(p0[0])} ${f1(p0[1])}L${f1(p1[0])} ${f1(p1[1])}"/><circle class="rn-js-dot" cx="${f1(p1[0])}" cy="${f1(p1[1])}" r="${(0.9 * D.KS).toFixed(2)}"/>`;
}

// ---- signal tokens travelling along conduits ---------------------------------------
const routes = {};
for (const [name, pts] of Object.entries(D.routes)) {
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  routes[name] = { pts, lens, total: lens[lens.length - 1] };
}
function pointOn(name, t) {
  const r = routes[name];
  const want = clamp(t, 0, 1) * r.total;
  let i = 1;
  while (i < r.lens.length - 1 && r.lens[i] < want) i++;
  const f = (want - r.lens[i - 1]) / (r.lens[i] - r.lens[i - 1] || 1);
  return [r.pts[i - 1][0] + (r.pts[i][0] - r.pts[i - 1][0]) * f, r.pts[i - 1][1] + (r.pts[i][1] - r.pts[i - 1][1]) * f];
}
const tokens = [];
function send(route, seconds, { cmd = false, reverse = false, done } = {}) {
  if (still.matches) {
    done?.();
    return;
  }
  const node = document.createElementNS(NS, "circle");
  node.setAttribute("class", cmd ? "rn-token rn-cmd" : "rn-token");
  node.setAttribute("r", String((cmd ? 1.3 : 1) * D.KS));
  tokensLayer.appendChild(node);
  tokens.push({ route, t0: clock, seconds, reverse, done, node });
}

// ---- model --------------------------------------------------------------------------
const M = {
  rotor: 0,
  quantum: 0,
  level: 0,
  levelShown: 0,
  gain: { value: 0.8, shown: 0.8, steps: [0.8, 0.45, 1] },
  buf: { playing: true, phase: 0 },
  ring: { index: 0, shown: 0, filled: new Set(), pending: [] },
  plungerAt: -9,
  latchAt: -9,
  rippleAt: -9,
  coneAt: -9,
};
function announce(text) {
  status.textContent = text;
}
// JS → audio: a call lands in the command ring; the core takes it at the next quantum
function command(kind) {
  const land = () => {
    const slot = M.ring.index % 8;
    M.ring.filled.add(slot);
    M.ring.pending.push({ slot, kind });
    M.ring.index += 1;
  };
  send("harness.cmd", 0.9, { cmd: true, done: land });
  announce(kind === "gain" ? "gain change queued for the audio thread" : "buffer source toggle queued");
}
function applyCommand({ slot, kind }) {
  M.ring.filled.delete(slot);
  send("conduit.ring", 0.6, {
    cmd: true,
    reverse: true,
    done: () => {
      if (kind === "gain") {
        M.gain.steps.push(M.gain.steps.shift());
        M.gain.value = M.gain.steps[0];
        M.plungerAt = clock;
        send("conduit.gain", 0.5, { cmd: true });
      } else {
        M.buf.playing = !M.buf.playing;
      }
    },
  });
}
// audio → JS: an event leaves the core, flips the latch and reaches the screen
function raiseEvent() {
  send("line.event", 0.9, {
    done: () => {
      M.latchAt = clock;
      M.rippleAt = clock + 0.25;
      announce("ended event delivered to JavaScript");
    },
  });
}
function onQuantum() {
  M.quantum += 1;
  // take every queued call before rendering, in order
  while (M.ring.pending.length) applyCommand(M.ring.pending.shift());
  const sources = 0.55 + (M.buf.playing ? 0.35 : 0);
  M.level = clamp(sources * M.gain.value * (0.86 + 0.14 * Math.sin(M.quantum * 1.7)), 0, 1);
  send("conduit.osc", 0.55);
  if (M.buf.playing) send("conduit.buf", 0.55);
  send("line.out", 0.45, { done: () => (M.coneAt = clock) });
}

// ---- drawing --------------------------------------------------------------------------
function draw() {
  const rotor = M.rotor;
  el.vanes.innerHTML = vanesOf(rotor);
  el.osc.innerHTML = wheelOf(D.osc, D.osc.r, (-rotor * D.pulley.r) / D.osc.r);
  el.bufPulley.innerHTML = wheelOf(D.bufPulley, D.bufPulley.r, (-rotor * D.pulley.r) / D.bufPulley.r, false);
  el.reels.forEach((node, i) => (node.innerHTML = reelOf(D.reels[i], M.buf.phase * (i ? 1.3 : 1))));
  const ringPhase = -M.ring.shown * ((Math.PI * 2) / 8);
  el.ringTable.innerHTML = ringTableOf(ringPhase);
  el.ringCaps.innerHTML = [...M.ring.filled].map((slot) => {
    const [x, y] = pocket(slot, ringPhase);
    const p = at([x, y, D.ring.z]);
    return `<circle class="rn-capsule" cx="${f1(p[0])}" cy="${f1(p[1])}" r="${(1.25 * D.KS).toFixed(2)}"/>`;
  }).join("");
  el.needle.setAttribute("d", needleOf(M.levelShown));
  el.gain.setAttribute("d", gainOf(M.gain.shown));
  const plunger = clock - M.plungerAt < 0.4 ? -Math.sin(((clock - M.plungerAt) / 0.4) * Math.PI) * 2.2 : 0;
  el.plunger.setAttribute("transform", plunger ? translateAlong(P, [0, 0, plunger]) : "");
  const up = clock - M.latchAt < 2.2 ? smoothstep(0, 0.25, clock - M.latchAt) * (1 - smoothstep(1.6, 2.2, clock - M.latchAt)) : 0;
  el.latch.innerHTML = latchOf(up);
  const cone = clock - M.coneAt < 0.45 ? Math.sin((clock - M.coneAt) * 34) * Math.exp(-(clock - M.coneAt) * 8) * 1.1 * M.levelShown : 0;
  el.cone.setAttribute("transform", Math.abs(cone) > 0.01 ? translateAlong(P, [0, 0, cone]) : "");
  const ra = clock - M.rippleAt;
  if (ra > 0 && ra < 1.2) {
    el.ripple.setAttribute("r", (7.4 + ra * 26).toFixed(1));
    el.ripple.style.opacity = String((1 - smoothstep(0, 1.2, ra)) * 0.9);
  } else el.ripple.style.opacity = "0";
  for (const t of tokens) {
    const f = smoothstep(0, 1, (clock - t.t0) / t.seconds);
    const [x, y] = pointOn(t.route, t.reverse ? 1 - f : f);
    const [ox, oy] = offsetOf(t.route === "line.out" || t.route.startsWith("conduit") || t.route === "harness.cmd" || t.route === "line.event" ? "engine" : "frame");
    t.node.setAttribute("cx", f1(x + ox));
    t.node.setAttribute("cy", f1(y + oy));
  }
  const moving = D.stagger.some((id) => piece[id].x !== piece[id].target || piece[id].pending);
  const state = moving ? (apart ? "opening" : "closing") : apart ? "open" : "closed";
  readout.textContent = `${state} · quantum ${M.quantum.toLocaleString("en")} · ${REAL_PER_SECOND} per second, shown ${SLOWER}× slower`;
}

// ---- loop and tour ------------------------------------------------------------------
let frame = 0;
let last = 0;
let visible = false;
let touring = !still.matches;
let tourClock = 0;
let tourStep = 0;
let idleTimer = 0;
const TOUR = [
  [1.4, () => setApart(true)],
  [5.5, () => command("gain")],
  [9.5, () => raiseEvent()],
  [12.5, () => command("buffer")],
  [16, () => command("gain")],
  [19, () => command("buffer")],
  [22.5, () => raiseEvent()],
  [26, () => setApart(false)],
  [30, () => {}],
];
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const calm = still.matches;
  clock += dt;
  if (touring) {
    tourClock += dt;
    while (tourStep < TOUR.length && tourClock >= TOUR[tourStep][0]) TOUR[tourStep++][1]();
    if (tourStep >= TOUR.length) {
      tourClock = 0;
      tourStep = 0;
    }
  }
  springs(dt, calm);
  place();
  // the rotor never stops: one vane per quantum
  if (!calm) {
    const before = Math.floor(M.rotor / VANE);
    M.rotor += dt * SHOWN_PER_SECOND * VANE;
    if (Math.floor(M.rotor / VANE) > before) onQuantum();
    if (M.buf.playing) M.buf.phase += dt * 1.8;
  }
  const ease = (x, target, tau) => (calm ? target : x + (target - x) * (1 - Math.exp(-dt / tau)));
  M.levelShown = ease(M.levelShown, M.level, 0.25);
  M.gain.shown = ease(M.gain.shown, M.gain.value, 0.12);
  M.ring.shown = ease(M.ring.shown, M.ring.index, 0.18);
  for (const t of tokens.filter((t) => clock - t.t0 >= t.seconds)) {
    t.node.remove();
    t.done?.();
  }
  for (let i = tokens.length - 1; i >= 0; i--) if (clock - tokens[i].t0 >= tokens[i].seconds) tokens.splice(i, 1);
  draw();
  const busy = !calm || D.stagger.some((id) => piece[id].x !== piece[id].target || piece[id].pending);
  frame = visible && busy ? requestAnimationFrame(tick) : 0;
}
const run = () => {
  if (!frame && visible) {
    last = 0;
    frame = requestAnimationFrame(tick);
  }
};
new IntersectionObserver((entries) => {
  visible = entries[entries.length - 1].isIntersecting;
  if (visible) run();
}, { rootMargin: "120px 0px" }).observe(stage);
function takeOver() {
  touring = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    touring = !still.matches;
  }, 9000);
}
stage.addEventListener("keydown", (event) => {
  const key = event.key;
  if (key === " " || key === "Enter") {
    event.preventDefault();
    takeOver();
    setApart(!apart);
  } else if (key === "1") {
    takeOver();
    command("gain");
    if (still.matches) onQuantum();
  } else if (key === "2") {
    takeOver();
    command("buffer");
    if (still.matches) onQuantum();
  } else if (key === "3") {
    takeOver();
    raiseEvent();
  } else return;
  run();
});
stage.addEventListener("click", () => {
  takeOver();
  setApart(!apart);
  run();
});
if (still.matches) {
  touring = false;
  setApart(true);
}
place();
draw();
