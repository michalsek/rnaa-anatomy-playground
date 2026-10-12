// "SVG layered" probe: will-change:transform on every slot group. Chrome does not composite SVG descendants, so this
// is expected to change nothing; the run records the layer count to prove it either way.
document.addEventListener("DOMContentLoaded", () => {
  const style = document.createElement("style");
  style.textContent = "[data-slot]{will-change:transform}";
  document.head.append(style);
});
