// SVG dirty-check: skip a slot's innerHTML write when the string equals the last one written to that slot.
// Assumes slots are only ever written through innerHTML (true for the v2 factory machines). Counts in __benchStats.
(() => {
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  const last = new WeakMap();
  const stats = (window.__benchStats = { slotWrites: 0, slotSkipped: 0, slotKB: 0, slotKBSkipped: 0 });
  Object.defineProperty(Element.prototype, "innerHTML", {
    configurable: true,
    enumerable: desc.enumerable,
    get: desc.get,
    set(value) {
      if (this.hasAttribute("data-slot")) {
        const html = String(value);
        stats.slotWrites++;
        stats.slotKB += html.length / 1024;
        if (last.get(this) === html) {
          stats.slotSkipped++;
          stats.slotKBSkipped += html.length / 1024;
          return;
        }
        last.set(this, html);
      }
      desc.set.call(this, value);
    },
  });
})();
