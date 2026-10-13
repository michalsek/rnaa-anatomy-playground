// v2's centrifuge page script run in Node (tools/test-native.mjs): the whole module script of out/svg/centrifuge.html
// (inlined kit, FACTORY runtime, centrifuge LIVE, stub feed and belt) with the native rotor hook injected exactly as
// tools/build.mjs injects it, over a minimal fake DOM. `machineGpu(id, api)` plays the GPU page's FACTORY.define
// wrapper (src/web/main.ts): what it returns becomes the machine's `api.gpu`.
import { readFileSync } from "node:fs";
import { injectRotorHook } from "./rotor-hook.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const MODULE_SCRIPT = /<script type="module">([\s\S]*?)<\/script>/;
/** One display frame at 60 Hz (the runtime clamps dt to 1/30 s). */
export const FRAME_MS = 1000 / 60;

/** A fake `<g data-slot>`: innerHTML is a plain string property. */
class FakeSlot {
  constructor(name) {
    this.dataset = { slot: name };
    this.innerHTML = "";
  }
}

/**
 * Boots the page script; returns `{ factory, slots, tick(n) }`. `tick(n)` runs n runtime frames with deterministic
 * time stamps; `slots` maps `machine:slot` names to their fake elements (v2's writes land in `innerHTML`).
 */
export function bootV2Page({ page = "out/svg/centrifuge.html", machineGpu = () => undefined } = {}) {
  const html = readFileSync(`${ROOT}${page}`, "utf8");
  const script = injectRotorHook(MODULE_SCRIPT.exec(html)[1], page);
  const names = [...html.matchAll(/data-slot="([^"]*)"/g)].map((m) => m[1]);
  const slots = Object.fromEntries(names.map((name) => [name, new FakeSlot(name)]));
  const svg = { querySelectorAll: (selector) => (selector === "[data-slot]" ? Object.values(slots) : []), querySelector: () => null };
  const stage = { querySelector: () => svg };
  const text = () => ({ textContent: "" });
  const elements = { ".fx-stage": stage, "[data-readout]": text(), "[data-status]": text() };
  const document = { querySelector: (selector) => elements[selector] ?? null };
  let frame = null;
  const requestAnimationFrame = (callback) => {
    frame = callback;
    return 1;
  };
  class IntersectionObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {
      this.callback([{ isIntersecting: true }]);
    }
  }
  const matchMedia = () => ({ matches: false, addEventListener() {} });
  // window.FACTORY: wrap define as the GPU page does, before the page script defines its machines
  const window = {};
  let factory;
  Object.defineProperty(window, "FACTORY", {
    get: () => factory,
    set(next) {
      if (next === factory) return;
      factory = next;
      const define = next.define;
      next.define = (id, make) => define.call(next, id, (api) => {
        const gpu = machineGpu(id, api);
        if (gpu) api.gpu = gpu;
        return make(api);
      });
    },
  });
  new Function("window", "document", "requestAnimationFrame", "IntersectionObserver", "matchMedia", script)(window, document, requestAnimationFrame, IntersectionObserver, matchMedia);
  let now = 0;
  return {
    factory,
    slots,
    /** Runs `count` runtime frames. */
    tick(count = 1) {
      for (let i = 0; i < count; i++) {
        now += FRAME_MS;
        const callback = frame;
        frame = null;
        callback(now);
      }
    },
  };
}
