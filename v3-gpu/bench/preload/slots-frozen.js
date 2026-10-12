// Diagnostic floor: slots keep their first content; every later slot innerHTML write is dropped. The page still runs
// its simulation and builds every string, so this isolates script cost from DOM / style / layout / paint / raster.
(() => {
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  const seen = new WeakSet();
  const stats = (window.__benchStats = { slotWrites: 0, slotDropped: 0 });
  Object.defineProperty(Element.prototype, "innerHTML", {
    configurable: true,
    enumerable: desc.enumerable,
    get: desc.get,
    set(value) {
      if (this.hasAttribute("data-slot")) {
        stats.slotWrites++;
        if (seen.has(this)) {
          stats.slotDropped++;
          return;
        }
        seen.add(this);
      }
      desc.set.call(this, value);
    },
  });
})();
