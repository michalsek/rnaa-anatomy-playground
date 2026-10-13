// node tools/live-edge.mjs — M3 edge cases on the live pages (needs a prior `live-gate.mjs compare --tag gate-dpr2` run
// for the theme-switch reference shots). Results → out/gpu/live-gate/edge.json, shots → out/gpu/live-gate/edge/.
// theme switch mid-animation · resize mid-animation · stage scrolled out of view · unsupported markup (dev / prod) ·
// no WebGPU (SVG fallback keeps animating).
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { launchChrome } from "./perf-lib.mjs";
import { openPage, TICK_HOOK, lockstepSource, advanceTo, settle, stageBox, shot, waitFor, diffImages } from "./live-gate.mjs";
const OUT = "out/gpu/live-gate/edge";
const url = (p) => pathToFileURL(p).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launchChrome();
const results = {};
const pre = [lockstepSource(), TICK_HOOK];
const log = (name, value) => { results[name] = value; console.log(name, JSON.stringify(value)); };
try {
  // a) theme switch mid-animation: dark page switched to light at tick 700 == light page at tick 700
  {
    const { cdp, problems, close } = await openPage(browser, { url: url("out/gpu/live.html"), preloads: pre });
    await advanceTo(cdp, 690);
    await cdp.evaluate(`__gpu.setTheme("light")`);
    await advanceTo(cdp, 700);
    await settle(cdp, "gpu");
    const file = await shot(cdp, join(OUT, "theme-switch-gpu-t700.png"), await stageBox(cdp));
    log("theme-switch", { vsFreshLightGpu: diffImages(file, "out/gpu/live-gate/gate-dpr2/gate-dpr2-gpu-light-t700.png"), vsSvgLight: diffImages(file, "out/gpu/live-gate/gate-dpr2/gate-dpr2-svg-light-t700.png"), problems });
    await close();
  }
  // b) resize mid-animation: 1280 → 520 px wide at tick 690, shot at 700; vs SVG page loaded at 520 px, tick 700
  {
    const files = {};
    for (const [kind, page] of [["gpu", "out/gpu/live.html"], ["svg", "out/svg/centrifuge.html"]]) {
      const { cdp, problems, close } = await openPage(browser, { url: url(page), preloads: pre, width: kind === "gpu" ? 1280 : 520 });
      await advanceTo(cdp, 690);
      if (kind === "gpu") await cdp.send("Emulation.setDeviceMetricsOverride", { width: 520, height: 1400, deviceScaleFactor: 2, mobile: false });
      await advanceTo(cdp, 700);
      await settle(cdp, kind);
      await sleep(200);
      files[kind] = await shot(cdp, join(OUT, `resize-${kind}-t700.png`), await stageBox(cdp));
      if (kind === "gpu") results.resizeStats = await cdp.evaluate(`(() => { const s = __gpu.frameStats(); return { width: s.width, height: s.height, dpr: s.dpr, canvas: [document.querySelector("canvas").width, document.querySelector("canvas").height], ticks: __tickGate.ticks, readout: document.querySelector("[data-readout]").textContent, frames: __gpu.frames }; })()`);
      else results.resizeSvg = await cdp.evaluate(`({ ticks: __tickGate.ticks, readout: document.querySelector("[data-readout]").textContent })`);
      if (problems.length) console.log(kind, problems);
      await close();
    }
    log("resize", { ...diffImages(files.svg, files.gpu, join(OUT, "resize-diff.png")), stats: results.resizeStats, svg: results.resizeSvg });
  }
  // c) stage out of view: the runtime's IntersectionObserver stops its loop → no slot writes → no GPU frames
  {
    const { cdp, close } = await openPage(browser, { url: url("out/gpu/live.html"), preloads: pre });
    await advanceTo(cdp, 300);
    await settle(cdp, "gpu");
    await cdp.evaluate(`document.body.style.paddingTop = "6000px"; window.scrollTo(0, 0); __tickGate.target = Infinity; __lockstep.resume(); 1`);
    await sleep(1500);
    const hidden0 = await cdp.evaluate(`({ ticks: __tickGate.ticks, frames: __gpu.frames })`);
    await sleep(1500);
    const hidden1 = await cdp.evaluate(`({ ticks: __tickGate.ticks, frames: __gpu.frames })`);
    await cdp.evaluate(`document.querySelector(".fx-stage").scrollIntoView({ block: "center" }); 1`);
    await sleep(1500);
    const shown = await cdp.evaluate(`({ ticks: __tickGate.ticks, frames: __gpu.frames })`);
    log("hidden", { hidden0, hidden1, shown, stoppedWhileHidden: hidden0.ticks === hidden1.ticks && hidden0.frames === hidden1.frames, resumed: shown.ticks > hidden1.ticks && shown.frames > hidden1.frames });
    await close();
  }
  // d) unsupported markup: dev throws at the write; prod skips the slot with one warning
  for (const page of ["out/gpu/live-dev.html", "out/gpu/live.html"]) {
    const { cdp, problems, close } = await openPage(browser, { url: url(page), preloads: pre });
    await advanceTo(cdp, 120);
    await settle(cdp, "gpu");
    const write = await cdp.evaluate(`(() => { try { FACTORY.slots["centrifuge:lamp"].innerHTML = '<g class="iso-dots"><text>x</text></g>'; return "no throw"; } catch (e) { return "threw: " + e.message; } })()`);
    await sleep(200);
    const after = await cdp.evaluate(`({ errors: __gpu.frameStats().live.errors, error: __gpu.error })`);
    log(`unsupported-${page.includes("dev") ? "dev" : "prod"}`, { write, after, problems: problems.slice(0, 3) });
    await close();
  }
  // e) no WebGPU: SVG fallback from the template keeps animating (writes forwarded to the real slots)
  {
    const { cdp, problems, close } = await openPage(browser, { url: url("out/gpu/live.html"), preloads: [readFileSync("tools/no-webgpu.preload.js", "utf8")] });
    await sleep(2500);
    const state = await cdp.evaluate(`({ error: __gpu.error, gpuAttr: document.documentElement.dataset.gpu, svgs: [...document.querySelectorAll(".fx-stage svg")].map((s) => s.getAttribute("class")), canvas: !!document.querySelector("canvas[data-gpu]"), readout: document.querySelector("[data-readout]").textContent, rotorChildren: document.querySelector('svg.iso-svg [data-slot="centrifuge:rotorBack"]').childElementCount + document.querySelector('svg.iso-svg [data-slot="centrifuge:rotorFront"]').childElementCount })`);
    log("no-webgpu", { ...state, problems: problems.slice(0, 3) });
    await shot(cdp, join(OUT, "no-webgpu.png"), await stageBox(cdp));
    await close();
  }
} finally {
  browser.close();
}
writeFileSync("out/gpu/live-gate/edge.json", JSON.stringify(results, null, 1));
