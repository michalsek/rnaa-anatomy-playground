// Halo A/B: the drop-shadow halo without its CSS blur (shape, offset and opacity unchanged).
document.addEventListener("DOMContentLoaded", () => {
  const style = document.createElement("style");
  style.textContent = ".iso-halo{filter:none!important}";
  document.head.append(style);
});
