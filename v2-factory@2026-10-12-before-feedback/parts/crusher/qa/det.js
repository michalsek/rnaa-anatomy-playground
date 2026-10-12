// deterministic clock + random for frame-exact comparison of two pages; holds at window.__stopAt frames
(() => {
  let seed = 12345;
  Math.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const raf = window.requestAnimationFrame.bind(window);
  window.__f = 0;
  window.__stopAt = +(new URLSearchParams(location.search).get("stop") || 120);
  window.requestAnimationFrame = (cb) => raf(function step() {
    if (window.__f >= window.__stopAt) return raf(step);
    window.__f++;
    cb(window.__f * (1000 / 60));
  });
})();
