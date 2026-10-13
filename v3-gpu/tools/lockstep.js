// Deterministic animation frames for page tests. Install before any page script (CDP
// Page.addScriptToEvaluateOnNewDocument, tools/harness.mjs lockstepPreload(), or `drive.mjs --preload tools/lockstep.js`).
//
// Every requestAnimationFrame callback receives virtual time T0 + n·(1000/60) ms and performance.now() returns it,
// whatever the wall clock does (capture stalls, slow GPUs, throttling). Options, read from window.__LOCKSTEP_OPTIONS
// when the script runs:
//   mode: "real"    one virtual frame per real display frame (default). Every callback runs in its own native rAF
//                   callback, so microtasks run between callbacks exactly as in production.
//         "turbo"   one virtual frame per macrotask (MessageChannel): 1,600 ticks in seconds instead of minutes.
//                   All callbacks of a frame run in one task (microtasks only after the last one); nothing is
//                   presented until the page is frozen and realFrames() is awaited.
//   rebase: "first-intersection"
//                   virtual time restarts (frame 0 again) when the first IntersectionObserver callback is delivered.
//                   The v2 runtime starts its loop there, and its dt = (now − last) / 1000 rounds differently for
//                   different absolute frame numbers; without the rebase two pages that spend a different number of
//                   frames booting (the GPU page draws while it boots) drift apart visibly after ~1,500 ticks.
//   waitReady: true hold IntersectionObserver callbacks while window.__gpu exists and is neither ready nor failed, so
//                   the runtime's first slot writes reach a live renderer (a GPU page frozen before its renderer
//                   exists never draws: QA-M3 D1). Pages without __gpu are not held.
// window.__lockstep:
//   frame             frames delivered so far (since the last rebase)
//   now()             virtual time in ms
//   freezeAt(n)       deliver no frame after frame n; queued callbacks wait
//   resume()          unfreeze
//   step(k = 1)       deliver k more frames, empty ones included (resolves on idle pages too), then freeze
//   rebase()          restart virtual time at frame 0
//   realFrames(k = 2) resolves after k real display frames: lets the compositor present what a frozen page drew
(() => {
  const options = { mode: "real", rebase: null, waitReady: false, ...(window.__LOCKSTEP_OPTIONS ?? {}) };
  const FRAME_MS = 1000 / 60;
  // A fixed origin: virtual time must not depend on how long the page took to load.
  const ORIGIN_MS = 1000 * FRAME_MS;
  const READY_POLL_MS = 5;
  const realRaf = window.requestAnimationFrame.bind(window);

  let frame = 0;
  let freezeAt = Infinity;
  let nextId = 1;
  let callbacks = new Map();
  let stepWaiters = [];
  const virtualNow = () => ORIGIN_MS + frame * FRAME_MS;
  const wantsFrame = () => frame < freezeAt && (callbacks.size > 0 || stepWaiters.length > 0);
  const settleStepWaiters = () => (stepWaiters = stepWaiters.filter((waiter) => (frame >= waiter.until ? (waiter.resolve(frame), false) : true)));

  // turbo: the whole frame in one MessageChannel task
  let turboScheduled = false;
  const channel = new MessageChannel();
  channel.port1.onmessage = deliverTurboFrame;
  function scheduleTurbo() {
    if (turboScheduled || !wantsFrame()) return;
    turboScheduled = true;
    channel.port2.postMessage(0);
  }
  function deliverTurboFrame() {
    turboScheduled = false;
    if (!wantsFrame()) return;
    frame++;
    const due = callbacks;
    callbacks = new Map();
    const time = virtualNow();
    for (const callback of due.values()) {
      try {
        callback(time);
      } catch (error) {
        setTimeout(() => {
          throw error;
        });
      }
    }
    settleStepWaiters();
    scheduleTurbo();
  }

  // real: each callback in its own native rAF callback; the first one to run in a display frame decides whether that
  // frame advances virtual time (not frozen) or every callback waits for the next display frame (frozen)
  let displayStamp = null;
  let displayFrameAdvances = false;
  function enterDisplayFrame(stamp) {
    if (stamp === displayStamp) return displayFrameAdvances;
    displayStamp = stamp;
    displayFrameAdvances = wantsFrame();
    if (displayFrameAdvances) {
      frame++;
      setTimeout(settleStepWaiters); // after every rAF callback of this display frame
    }
    return displayFrameAdvances;
  }
  function requestDisplayCallback(id) {
    realRaf((stamp) => {
      const callback = callbacks.get(id);
      if (!callback) return;
      if (!enterDisplayFrame(stamp)) return requestDisplayCallback(id);
      callbacks.delete(id);
      callback(virtualNow());
    });
  }
  let emptyFramesScheduled = false;
  function scheduleEmptyFrames() {
    if (emptyFramesScheduled || !stepWaiters.length) return;
    emptyFramesScheduled = true;
    realRaf(function emptyFrame(stamp) {
      enterDisplayFrame(stamp);
      if (stepWaiters.length) realRaf(emptyFrame);
      else emptyFramesScheduled = false;
    });
  }

  const turbo = options.mode === "turbo";
  const schedule = () => (turbo ? scheduleTurbo() : scheduleEmptyFrames());
  window.requestAnimationFrame = (callback) => {
    const id = nextId++;
    callbacks.set(id, callback);
    if (turbo) scheduleTurbo();
    else requestDisplayCallback(id);
    return id;
  };
  window.cancelAnimationFrame = (id) => callbacks.delete(id);
  performance.now = virtualNow;

  const rebase = () => {
    const shift = frame;
    if (freezeAt !== Infinity) freezeAt -= shift;
    for (const waiter of stepWaiters) waiter.until -= shift;
    frame = 0;
  };

  if (options.rebase === "first-intersection" || options.waitReady) {
    const NativeObserver = window.IntersectionObserver;
    let rebased = options.rebase !== "first-intersection";
    const gpuBooting = () => options.waitReady && window.__gpu && !window.__gpu.ready && !window.__gpu.error;
    window.IntersectionObserver = class extends NativeObserver {
      constructor(callback, observerOptions) {
        // Only the newest held delivery matters: it carries the current intersection state.
        let heldDelivery = null;
        const pollReady = () => {
          if (gpuBooting()) return setTimeout(pollReady, READY_POLL_MS);
          const delivery = heldDelivery;
          heldDelivery = null;
          delivery();
        };
        const deliver = (entries, observer) => {
          if (gpuBooting()) {
            if (!heldDelivery) setTimeout(pollReady, READY_POLL_MS);
            heldDelivery = () => deliver(entries, observer);
            return;
          }
          if (!rebased) {
            rebased = true;
            rebase();
          }
          callback(entries, observer);
        };
        super(deliver, observerOptions);
      }
    };
  }

  window.__lockstep = {
    options,
    get frame() {
      return frame;
    },
    now: virtualNow,
    freezeAt(n) {
      freezeAt = n;
      schedule();
    },
    resume() {
      freezeAt = Infinity;
      schedule();
    },
    step(k = 1) {
      const until = frame + k;
      freezeAt = until;
      const done = new Promise((resolve) => stepWaiters.push({ until, resolve }));
      schedule();
      return done;
    },
    rebase,
    realFrames(k = 2) {
      return new Promise((resolve) => {
        const countDown = () => (k-- > 0 ? realRaf(countDown) : resolve());
        countDown();
      });
    },
  };
})();
