// MACHINES: machine kinds register here (MACHINES.conveyor = (api) => ({ tick, accept })); instances are
// created with FACTORY.define("beltA", MACHINES.conveyor) so one kind can be placed several times.
const MACHINES = {};
// FACTORY: the page runtime shared by every machine page and the assembly.
// Machines define themselves with FACTORY.define(id, api => ({ tick(dt, t), accept(port, item) })),
// draw moving things into their own slots, and hand items on with api.emit(port, item).
const FACTORY = (() => {
  const D = __FACTORY_DATA__;
  const P = D.P;
  const stage = document.querySelector(".fx-stage");
  const svg = stage.querySelector("svg");
  const readoutEl = document.querySelector("[data-readout]");
  const statusEl = document.querySelector("[data-status]");
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const slots = Object.fromEntries([...svg.querySelectorAll("[data-slot]")].map((g) => [g.dataset.slot, g]));
  const at = (p) => iso(p, P);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const machines = {};
  const links = {};
  const feeds = [];
  const sinks = {};
  let clock = 0;
  let nextId = 1;
  let readoutFn = null;

  // a post-style parcel: a box with a band of tape round it and a strap over the top; colour from its kind
  function packetSvg(kind, [x, y, z], { w = 10, d = 8, h = 7 } = {}) {
    const plan = { x: x - w / 2, y: y - d / 2, w, d, r: 0.6 };
    return `<g class="pk" data-kind="${kind}">${solidSvg(slabOf(plan, z, h, P, 2, 0.3), { tone: "hi" })}${lineSvg(sideSeam(plan, z + h * 0.55, P, 2) + lineOnTop([x - w / 2, y], [x + w / 2, y], z + h, P), { tone: "lo" })}</g>`;
  }
  // a loose instruction from JS: a soft bead with a highlight
  function fluffSvg([x, y, z], r = 2.4, kind = "fluff") {
    const c = at([x, y, z + r]);
    const s = r * D.KS;
    return `<g class="fx-fluff" data-kind="${kind}"><circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="${s.toFixed(2)}"/><circle class="fx-fluff-hi" cx="${(c[0] - s * 0.35).toFixed(1)}" cy="${(c[1] - s * 0.35).toFixed(1)}" r="${(s * 0.32).toFixed(2)}"/></g>`;
  }
  // a point at fraction t (0..1, by arc length) along a recorded route (3D world points)
  const routeCache = {};
  function along(name, t) {
    const pts = D.routes[name];
    if (!pts) return [0, 0, 0];
    let c = routeCache[name];
    if (!c) {
      const lens = [0];
      for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
      c = routeCache[name] = { lens, total: lens[lens.length - 1] };
    }
    const want = clamp(t, 0, 1) * c.total;
    let i = 1;
    while (i < c.lens.length - 1 && c.lens[i] < want) i++;
    return lerp3(pts[i - 1], pts[i], (want - c.lens[i - 1]) / (c.lens[i] - c.lens[i - 1] || 1));
  }
  // emit(port, item, from): `from` is the world point the item leaves at, so the receiver can animate the drop
  // frameOffset(id) → the world offset the assembly's explode gives machine id right now: a hand-off between two
  // machines that are moving differently re-bases `from` into the receiver's frame, so drops stay attached
  let frameOffset = null;
  function route(id, port, item, from) {
    const link = links[`${id}:${port}`];
    if (link && from && frameOffset) {
      const a = frameOffset(id);
      const b = frameOffset(link.to);
      from = [from[0] + a[0] - b[0], from[1] + a[1] - b[1], from[2] + a[2] - b[2]];
    }
    if (link && machines[link.to] && machines[link.to].accept) machines[link.to].accept(link.port, item, from);
    for (const fn of sinks[`${id}:${port}`] ?? []) fn(item, from);
  }
  function define(id, make) {
    const api = {
      id,
      data: D.data[id],
      P,
      KS: D.KS,
      V: D.V,
      at,
      clamp,
      smooth,
      lerp3,
      along,
      packetSvg,
      fluffSvg,
      slot: (name) => slots[`${id}:${name}`] ?? null,
      el: (sel) => svg.querySelector(sel),
      els: (sel) => [...svg.querySelectorAll(sel)],
      emit: (port, item, from) => route(id, port, item, from),
      item: (kind) => ({ id: nextId++, kind, born: clock }),
      now: () => clock,
      calm: () => still.matches,
      announce: (text) => (statusEl.textContent = text),
    };
    machines[id] = make(api);
    return machines[id];
  }
  let frame = 0;
  let last = 0;
  let visible = false;
  // playback: speed scales the factory clock, paused freezes it (machines still tick with dt 0 and redraw)
  let speed = 1;
  let paused = false;
  const frameHooks = [];
  function tick(now) {
    const real = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    for (const fn of frameHooks) fn(real);
    const dt = paused ? 0 : real * speed;
    clock += dt;
    for (const f of feeds) {
      if (clock >= f.next) {
        f.next = clock + f.every;
        machines[f.id]?.accept?.(f.port, f.make());
      }
    }
    for (const m of Object.values(machines)) m.tick?.(dt, clock);
    if (readoutFn) {
      const text = readoutFn(clock);
      if (readoutEl.textContent !== text) readoutEl.textContent = text;
    }
    frame = visible ? requestAnimationFrame(tick) : 0;
  }
  function start() {
    new IntersectionObserver((entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible && !frame) {
        last = 0;
        frame = requestAnimationFrame(tick);
      }
    }, { rootMargin: "120px 0px" }).observe(stage);
  }
  const api = {
    define,
    machines,
    // hand items from one machine's output port to another machine's input port
    link: (fromId, fromPort, toId, toPort = "in") => (links[`${fromId}:${fromPort}`] = { to: toId, port: toPort }),
    // demo feeder for a standalone machine page: every `every` seconds, accept(port, make())
    feed: (id, port, every, make, delay = 0.5) => feeds.push({ id, port, every, make, next: delay }),
    // listen to what a machine emits (standalone pages use it as a sink)
    onEmit: (id, port, fn) => (sinks[`${id}:${port}`] ??= []).push(fn),
    item: (kind) => ({ id: nextId++, kind, born: clock }),
    readout: (fn) => (readoutFn = fn),
    // assembly hooks: the build's data, the factory clock's speed and pause, and a per-frame hook on real time
    data: D.data,
    get speed() { return speed; },
    set speed(v) { speed = v; },
    get paused() { return paused; },
    set paused(v) { paused = !!v; },
    onFrame: (fn) => frameHooks.push(fn),
    set frameOffset(fn) { frameOffset = fn; },
    stage,
    svg,
    slots,
    at,
    P,
    still,
    start,
  };
  // exposed for drive.mjs checks and console debugging (the page script is a module)
  window.FACTORY = api;
  return api;
})();
