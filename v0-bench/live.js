const D = __DATA__;
const P = D.P;
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const $ = (sel) => svg.querySelector(sel);
const $$ = (sel) => [...svg.querySelectorAll(sel)];
const readout = document.querySelector("[data-readout]");
const status = document.querySelector("[data-status]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const NS = "http://www.w3.org/2000/svg";
const at = (p) => iso(p, P);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const QS = D.quantumSeconds;
const SLOW = Math.round(QS / (D.quantum / D.sampleRate));
const TOPO = ["osc", "buf", "gain", "filter", "scope", "dest"];
const OUT_CABLE = { osc: "patch.osc-gain", buf: "patch.buf-gain", gain: "patch.gain-filter", filter: "patch.filter-scope", scope: "patch.scope-dest" };

// ---- elements ------------------------------------------------------------------
const el = {
  leds: Object.fromEntries($$("[data-led]").map((n) => [n.dataset.led, n])),
  caps: Object.fromEntries($$("[data-cap]").map((n) => [n.dataset.cap, n])),
  qdots: $$("[data-q]"),
  hands: Object.fromEntries(D.drums.map((d) => [d.id, $(`[data-part="hands-${d.id}"]`)])),
  gainPointer: $('[data-pointer="mod.gain.knob"]'),
  gear: $('[data-part="gear"]'),
  reels: [$('[data-part="reel0"]'), $('[data-part="reel1"]')],
  rollers: [$('[data-part="roller0"]'), $('[data-part="roller1"]')],
  lever: $('[data-part="lever"]'),
  armature: $('[data-part="armature"]'),
  bell: $('[data-name="console.bell"]'),
  cone: $('[data-part="cone"]'),
  wave: $('[data-part="wave"]'),
  tape: [$('[data-part="tape0"]'), $('[data-part="tape1"]')],
  keys: $$(".it[data-key]"),
  flows: $('[data-part="flows"]'),
  tokens: $('[data-part="tokens"]'),
};

// ---- route geometry (screen polylines) -------------------------------------------
const routes = {};
for (const [name, pts] of Object.entries(D.routes)) {
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  routes[name] = { pts, lens, total: lens[lens.length - 1], d: pathOf(pts) };
}
function pointOn(name, t) {
  const r = routes[name];
  const want = clamp(t, 0, 1) * r.total;
  let i = 1;
  while (i < r.lens.length - 1 && r.lens[i] < want) i++;
  const span = r.lens[i] - r.lens[i - 1] || 1;
  const f = (want - r.lens[i - 1]) / span;
  return [r.pts[i - 1][0] + (r.pts[i][0] - r.pts[i - 1][0]) * f, r.pts[i - 1][1] + (r.pts[i][1] - r.pts[i - 1][1]) * f];
}
const flowPaths = {};
for (const name of Object.values(OUT_CABLE)) {
  const path = document.createElementNS(NS, "path");
  path.setAttribute("class", "rn-flow");
  path.setAttribute("d", routes[name].d);
  path.setAttribute("stroke-dasharray", `0 ${routes[name].total + 20}`);
  el.flows.appendChild(path);
  flowPaths[name] = path;
}

// ---- model -------------------------------------------------------------------
const newRing = () => ({ w: 0, r: 0, items: [], hand: { w: 0, r: 0 } });
const S = {
  running: false,
  q: 0,
  frame: 0,
  u: 0, // position inside the current quantum, 0..1
  rings: { sched: newRing(), graph: newRing() },
  osc: "idle", // idle → playing → ended
  oscGen: 1,
  buf: { plugged: false, started: false, playing: false, gen: 1 },
  gain: { target: 1, shown: 1 },
  tokens: [],
  events: [],
  shredUntil: 0,
  bellAt: -10,
  armatureAt: -10,
  leverAt: -10,
  lever: -0.5,
  wavePhase: 0,
  waveAmp: 0,
  coneAt: -10,
  coneAmp: 0,
  reelPhase: 0,
  rollerPhase: 0,
  gearShown: 0,
  queued: 0, // event-queue magazine fill
  tape: ["", ""],
  drained: [],
  clock: 0,
  pending: [],
};

function say(text) {
  if (readout.textContent !== text) readout.textContent = text;
}
function announce(text) {
  status.textContent = text;
}
function typeLine(text) {
  S.tape = [S.tape[1], text];
  el.tape[0].textContent = S.tape[0];
  el.tape[1].textContent = S.tape[1];
}
function later(seconds, fn) {
  S.pending.push({ at: S.clock + seconds, fn });
}
function fly(route, seconds, done, reverse = false) {
  const node = document.createElementNS(NS, "circle");
  node.setAttribute("class", "rn-token");
  node.setAttribute("r", String(1.9 * D.KS));
  el.tokens.appendChild(node);
  S.tokens.push({ route, t0: S.clock, seconds, done, node, reverse });
}

// a JS call: a closure crosses its line into a ring slot
function send(ringId, text, effect) {
  typeLine(text);
  const calm = still.matches;
  const land = () => {
    const R = S.rings[ringId];
    if (!S.running) {
      // no audio thread is consuming: the JS thread drains the ring and runs the closure itself
      effect();
      announce(`${text}: driver stopped, run on the JS thread`);
      return;
    }
    const slot = R.w % D.slots;
    R.items.push({ slot, effect, text });
    R.w += 1;
    el.caps[`${ringId}-${slot}`]?.setAttribute("data-on", "");
  };
  if (calm) land();
  else fly(`line.${ringId}.in`, 0.7, land);
}

// ---- commands ---------------------------------------------------------------------
function startOsc() {
  if (S.osc === "ended") {
    S.oscGen += 1;
    const name = `osc${S.oscGen}`;
    send("graph", `${name}.connect(gain)`, () => {});
    send("sched", `${name}.start()`, () => (S.osc = "playing"));
  } else if (S.osc === "idle") {
    send("sched", "osc.start()", () => (S.osc = "playing"));
  } else return;
  if (!S.running) resume();
}
function setGain() {
  const next = S.gain.target >= 1 ? 0.5 : S.gain.target >= 0.5 ? 0.25 : 1;
  send("sched", `gain.gain.value = ${next}`, () => (S.gain.target = next));
}
function toggleBuffer() {
  if (!S.buf.plugged) {
    send("graph", "src.connect(gain)", () => {
      S.buf.plugged = true;
      stage.classList.remove("rn-unplugged");
    });
    if (!S.buf.started) {
      S.buf.started = true;
      send("sched", "src.start()", () => (S.buf.playing = true));
    }
  } else {
    send("graph", "src.disconnect()", () => {
      S.buf.plugged = false;
      stage.classList.add("rn-unplugged");
    });
  }
}
function swapBuffer() {
  S.buf.gen += 1;
  send("sched", `src.buffer = take${S.buf.gen}`, () => {
    // the old buffer leaves the audio thread through the disposer
    const calm = still.matches;
    const shred = () => {
      S.shredUntil = S.clock + 1.4;
      announce("old buffer destroyed on the disposer thread");
    };
    if (calm) shred();
    else fly("line.dispose", 0.9, shred);
  });
}
function stopOsc() {
  if (S.osc !== "playing") return;
  send("sched", "osc.stop()", () => {
    S.osc = "ended";
    raiseEnded();
  });
}
function raiseEnded() {
  const calm = still.matches;
  const ringBell = () => {
    S.bellAt = S.clock;
    announce("onended ran on the JS thread");
  };
  const dispatch = () => {
    S.queued += 1;
    later(calm ? 0 : 0.3, () => {
      S.armatureAt = S.clock;
      S.queued = Math.max(0, S.queued - 1);
      if (calm) ringBell();
      else fly("line.invoke", 1.1, ringBell);
    });
  };
  if (calm) dispatch();
  else fly("line.events", 0.8, dispatch);
}
function resume() {
  typeLine(S.running ? "ctx.suspend()" : "ctx.resume()");
  const starting = !S.running;
  S.leverAt = S.clock;
  const done = () => {
    S.running = starting;
    if (starting) S.u = 0;
    announce(starting ? "promise worker started the driver" : "driver stopped; context suspended");
  };
  if (still.matches) done();
  else later(0.35, () => fly("line.driver", 0.6, done));
}
const COMMANDS = [startOsc, setGain, toggleBuffer, swapBuffer, stopOsc];

// ---- one render quantum, as the audio thread runs it -----------------------------------
const PH = { sched: [0, 0.2], graph: [0.2, 0.32], settle: [0.32, 0.4], nodes: [0.4, 0.86], copy: [0.86, 1] };
function processable() {
  // the speaker and the analyser are roots; anything with a path to them is pulled
  const set = new Set(["dest", "scope", "filter", "gain"]);
  if (S.osc !== "ended") set.add("osc");
  if (S.buf.plugged) set.add("buf");
  return TOPO.filter((id) => set.has(id));
}
function sounding() {
  const osc = S.osc === "playing" ? 0.62 : 0;
  const buf = S.buf.plugged && S.buf.playing ? 0.48 : 0;
  return { osc, buf, any: (osc + buf) * S.gain.shown };
}
function drain(id, [u0, u1], u) {
  const R = S.rings[id];
  const count = R.items.length;
  if (!count) return;
  const each = Math.min(0.045, (u1 - u0) / count);
  while (R.items.length && u >= u0 + each * (count - R.items.length + 1)) {
    const item = R.items.shift();
    el.caps[`${id}-${item.slot}`]?.removeAttribute("data-on");
    R.r += 1;
    item.effect();
  }
}
function endQuantum() {
  S.q += 1;
  S.frame += D.quantum;
  const s = sounding();
  S.waveAmp = Math.min(1.4, s.any);
  S.wavePhase += 0.9;
  S.coneAt = S.clock;
  S.coneAmp = Math.min(1, s.any);
}

// ---- drawing ------------------------------------------------------------------------
function handsOf(d, R) {
  const hand = (pos, z, tone, width) => {
    const a = (pos / D.slots) * Math.PI * 2;
    const tip = [d.x + Math.sin(a) * d.slotR, d.y - Math.cos(a) * d.slotR];
    return `<path class="iso-line rn-hand" data-tone="${tone}" data-free="end" style="stroke-width:${width}" d="${lineOnTop([d.x, d.y], tip, z, P)}"/><circle cx="${at([...tip, z])[0].toFixed(1)}" cy="${at([...tip, z])[1].toFixed(1)}" r="${(0.9 * D.KS).toFixed(2)}" class="${tone === "lit" ? "rn-token" : "iso-wire-end"}"/>`;
  };
  // write hand points at the next free slot, read hand at the next slot to consume
  return hand(R.hand.w, d.write, "hi", 1.2) + hand(R.hand.r, d.read, "lit", 1.4);
}
function gearTeeth(phase) {
  const g = D.gear;
  const t = radialTicks(g.x, g.y, g.r, 32, 8, g.z, [1.4, 3.2], P, phase);
  return lineSvg(t.minor, { tone: "lo" }) + lineSvg(t.major, { tone: "mid" });
}
function reelSpokes(r, phase) {
  return lineSvg(
    [0, 1, 2].map((i) => {
      const a = phase + (i * Math.PI * 2) / 3;
      return lineOnTop([r.x + Math.sin(a) * 2.6, r.y - Math.cos(a) * 2.6], [r.x + Math.sin(a) * (r.r - 1), r.y - Math.cos(a) * (r.r - 1)], r.z, P);
    }).join("") + ring(r.x, r.y, r.r - 1, r.z, P, 40),
    { tone: "lo" },
  );
}
function leverOf(t) {
  const L = D.lever;
  const tip = [L.x + t * 3.4, L.y, L.z + Math.sqrt(36 - t * t * 11.56)];
  const a = at([L.x, L.y, L.z]);
  const b = at(tip);
  return `<path class="iso-line" data-tone="hi" style="stroke-width:1.6" d="M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}"/>${dotsSvg([b], { size: 1.3, tone: "hi" })}`;
}
function waveOf(amp, phase) {
  const { w, d } = D.scope;
  const pts = [];
  for (let i = 0; i <= 48; i++) {
    const x = 1 + ((w - 2) * i) / 48;
    const s = sounding();
    const v = (s.osc * Math.sin(phase + i * 0.55) + s.buf * Math.sin(phase * 0.7 + i * 0.21) * Math.cos(i * 0.09)) / Math.max(0.0001, s.osc + s.buf);
    pts.push([x, d / 2 - v * amp * (d / 2 - 2) * 0.62]);
  }
  return pathOf(pts.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]));
}

let lastText = "";
function draw() {
  for (const d of D.drums) el.hands[d.id].innerHTML = handsOf(d, S.rings[d.id]);
  // lamps: the node being processed now
  const order = processable();
  const [n0, n1] = PH.nodes;
  const slot = S.running && S.u >= n0 && S.u < n1 ? Math.floor(((S.u - n0) / (n1 - n0)) * order.length) : -1;
  for (const id of TOPO) {
    const on = slot >= 0 && order[slot] === id;
    if (on) el.leds[id].setAttribute("data-on", "");
    else el.leds[id].removeAttribute("data-on");
  }
  // flows: the buffer a node just wrote, carried to the next one
  const s = sounding();
  const live = { osc: s.osc > 0, buf: s.buf > 0 };
  live.gain = (live.osc || live.buf) && S.gain.shown > 0.01;
  live.filter = live.scope = live.gain;
  for (const [id, name] of Object.entries(OUT_CABLE)) {
    const path = flowPaths[name];
    const i = order.indexOf(id);
    const total = routes[name].total;
    if (i < 0 || slot < 0 || !live[id]) {
      path.setAttribute("stroke-dasharray", `0 ${total + 20}`);
      continue;
    }
    const f = clamp(((S.u - n0) / (n1 - n0)) * order.length - i, 0, 2) / 2;
    const head = smooth(0, 1, f) * (total + 14);
    path.setAttribute("stroke-dasharray", `0 ${Math.max(0, head - 14).toFixed(1)} ${Math.min(14, head).toFixed(1)} ${total + 20}`);
  }
  el.gainPointer.setAttribute("d", (() => {
    const g = D.gain;
    const a = -Math.PI * 0.75 + Math.PI * 1.5 * clamp(S.gain.shown, 0, 1);
    return lineOnTop([g.x, g.y], [g.x + Math.sin(a) * (g.r - 0.8), g.y - Math.cos(a) * (g.r - 0.8)], g.top, P);
  })());
  el.gear.innerHTML = gearTeeth(S.gearShown);
  el.reels.forEach((node, i) => (node.innerHTML = reelSpokes(D.reels[i], S.reelPhase * (i ? 1.42 : 1))));
  el.rollers.forEach((node, i) => (node.innerHTML = fadedSvg(G.ribsOf(D.rollers[i].F, 0, D.rollers[i].w, D.rollers[i].r, 14, P, { phase: S.rollerPhase * (i ? -1 : 1), fade: [0.1, 0.55] }), { tone: "lo" })));
  const leverT = S.lever;
  el.lever.innerHTML = leverOf(leverT);
  const armature = S.clock - S.armatureAt < 0.35 ? -Math.sin(((S.clock - S.armatureAt) / 0.35) * Math.PI) * 2.2 : 0;
  el.armature.setAttribute("transform", armature ? translateAlong(P, [0, 0, armature]) : "");
  const bellAge = S.clock - S.bellAt;
  const shake = bellAge < 1.2 ? Math.sin(bellAge * 48) * Math.exp(-bellAge * 4) * 0.9 : 0;
  el.bell.setAttribute("transform", shake ? translateAlong(P, [shake, -shake * 0.6, 0]) : "");
  const coneAge = S.clock - S.coneAt;
  const cone = coneAge < 0.5 ? Math.sin(coneAge * 30) * Math.exp(-coneAge * 7) * 1.1 * S.coneAmp : 0;
  el.cone.setAttribute("transform", Math.abs(cone) > 0.01 ? translateAlong(P, [0, 0, cone]) : "");
  el.wave.setAttribute("d", waveOf(S.waveAmp, S.wavePhase));
  el.qdots.forEach((dot, i) => (i < S.queued ? dot.setAttribute("data-on", "") : dot.removeAttribute("data-on")));
  for (const t of S.tokens) {
    const f = smooth(0, 1, (S.clock - t.t0) / t.seconds);
    const [x, y] = pointOn(t.route, t.reverse ? 1 - f : f);
    t.node.setAttribute("cx", x.toFixed(1));
    t.node.setAttribute("cy", y.toFixed(1));
  }
  const text = S.running ? `quantum ${S.q.toLocaleString("en")} · frame ${S.frame.toLocaleString("en")} · ${still.matches ? "stepped" : `${SLOW}× slower`}` : `suspended · quantum ${S.q.toLocaleString("en")}`;
  say(text);
  if (text.split(" ")[0] !== lastText) {
    lastText = text.split(" ")[0];
    stage.setAttribute("aria-valuetext", S.running ? "running" : "suspended");
  }
}

// ---- loop ----------------------------------------------------------------------------
let frame = 0;
let last = 0;
let visible = false;
let touring = !still.matches;
let tourClock = 0;
let tourStep = 0;
let idleTimer = 0;
const TOUR = [
  [1.2, 0],
  [5.2, 1],
  [9.6, 2],
  [14.4, 3],
  [18.8, 1],
  [22.4, 4],
  [28, 0],
  [32, 2],
  [36.4, 1],
  [40, -1],
];
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const calm = still.matches;
  S.clock += dt;
  if (touring) {
    tourClock += dt;
    while (tourStep < TOUR.length && tourClock >= TOUR[tourStep][0]) {
      const [, cmd] = TOUR[tourStep];
      if (cmd >= 0) COMMANDS[cmd]();
      tourStep += 1;
    }
    if (tourStep >= TOUR.length) {
      tourClock = 0;
      tourStep = 0;
    }
  }
  for (const job of S.pending.filter((j) => S.clock >= j.at)) job.fn();
  S.pending = S.pending.filter((j) => S.clock < j.at);
  for (const t of S.tokens.filter((t) => S.clock - t.t0 >= t.seconds)) {
    t.node.remove();
    t.done();
  }
  S.tokens = S.tokens.filter((t) => S.clock - t.t0 < t.seconds);
  if (S.running && calm) {
    // reduced motion: no clock to watch; a quantum runs only when there is something to read
    if (S.rings.sched.items.length || S.rings.graph.items.length) {
      drain("sched", PH.sched, 1);
      drain("graph", PH.graph, 1);
      endQuantum();
    }
  } else if (S.running) {
    const before = S.u;
    S.u += dt / QS;
    drain("sched", PH.sched, Math.min(S.u, 1));
    drain("graph", PH.graph, Math.min(S.u, 1));
    if (before < PH.copy[0] && S.u >= PH.copy[0]) endQuantum();
    if (S.u >= 1) S.u -= 1;
  }
  // eased followers
  const ease = (x, target, tau) => (calm ? target : x + (target - x) * (1 - Math.exp(-dt / tau)));
  for (const d of D.drums) {
    const R = S.rings[d.id];
    R.hand.w = ease(R.hand.w, R.w, 0.18);
    R.hand.r = ease(R.hand.r, R.r, 0.12);
  }
  S.gain.shown = ease(S.gain.shown, S.gain.target, 0.06);
  S.gearShown = ease(S.gearShown, (S.q * Math.PI * 2) / 32, 0.08);
  S.lever = ease(S.lever, S.running || S.clock - S.leverAt < 0.6 ? 0.5 : -0.5, 0.12);
  if (S.running && S.buf.plugged && S.buf.playing) S.reelPhase += dt * 1.6;
  if (S.clock < S.shredUntil) S.rollerPhase += dt * 5;
  draw();
  const busy = !calm || S.tokens.length || S.pending.length;
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
    tourClock = TOUR[tourStep % TOUR.length][0] - 1;
  }, 3600 * 3);
}
function press(i) {
  takeOver();
  const key = el.keys.find((k) => k.dataset.key === String(i));
  key?.setAttribute("data-down", "");
  key?.setAttribute("transform", translateAlong(P, [0, 0, -1.2]));
  setTimeout(() => {
    key?.removeAttribute("data-down");
    key?.removeAttribute("transform");
  }, 180);
  COMMANDS[i]();
  run();
}
stage.addEventListener("keydown", (event) => {
  if (/^[1-5]$/.test(event.key)) {
    event.preventDefault();
    press(Number(event.key) - 1);
  } else if (event.key === " ") {
    event.preventDefault();
    takeOver();
    resume();
    run();
  }
});
for (const key of el.keys) key.addEventListener("click", () => press(Number(key.dataset.key)));
if (still.matches) touring = false;
draw();
