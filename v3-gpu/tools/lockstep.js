// drive.mjs --preload tools/lockstep.js
// Deterministic frames: every requestAnimationFrame callback receives t0 + n·(1000/60) ms and performance.now()
// returns the current virtual frame time, whatever the wall clock does (capture stalls, slow GPUs, throttling).
// The real rAF still paces delivery. window.__lockstep:
//   frame             frames delivered so far
//   freezeAt(n)       stop delivering callbacks after frame n (state stays exactly at frame n; queued callbacks wait)
//   step(k = 1)       while frozen, deliver k more frames (returns a promise resolved after the k-th)
//   resume()          unfreeze
//   now()             virtual time in ms
// Installs before the page's scripts; drive.mjs's own ["slow", f] wrapper sits underneath and is ignored.
(() => {
  const STEP = 1000 / 60;
  const realRaf = window.requestAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  const t0 = Math.ceil(realNow() / STEP) * STEP;
  let frame = 0;
  let freezeAt = Infinity;
  let pending = [];
  let ticking = false;
  let stepWaiters = [];
  const virtual = () => t0 + frame * STEP;

  function tick() {
    ticking = false;
    if (frame >= freezeAt || !pending.length) {
      if (pending.length && frame < freezeAt) schedule();
      return;
    }
    frame++;
    const callbacks = pending;
    pending = [];
    const now = virtual();
    for (const { id, callback } of callbacks) {
      if (cancelled.has(id)) { cancelled.delete(id); continue; }
      try { callback(now); } catch (e) { setTimeout(() => { throw e; }); }
    }
    stepWaiters = stepWaiters.filter((w) => (frame >= w.until ? (w.resolve(frame), false) : true));
    if (pending.length) schedule();
  }
  function schedule() {
    if (ticking) return;
    ticking = true;
    realRaf(tick);
  }
  let nextId = 1;
  const cancelled = new Set();
  window.requestAnimationFrame = (callback) => {
    const id = nextId++;
    pending.push({ id, callback });
    schedule();
    return id;
  };
  window.cancelAnimationFrame = (id) => cancelled.add(id);
  performance.now = () => virtual();

  window.__lockstep = {
    get frame() { return frame; },
    now: virtual,
    freezeAt(n) { freezeAt = n; },
    resume() { freezeAt = Infinity; schedule(); },
    step(k = 1) {
      freezeAt = frame + k;
      schedule();
      return new Promise((resolve) => stepWaiters.push({ until: frame + k, resolve }));
    },
  };
})();
