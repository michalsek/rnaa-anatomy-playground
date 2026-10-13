// node tools/package-gate.mjs [--quick] — the deliverable pages (centrifuge-gpu(-light).html, M4). Exit 1 on any
// failed check; report → out/tmp/gates/package.json, shots → out/tmp/gates/package/.
//   bytes        each deliverable is byte-identical to out/gpu/live(-light).html (so every live / edge / native gate
//                ran on the deliverable bytes) and references nothing outside itself
//   open         over file:// and http://127.0.0.1, both themes: ready, html[data-renderer=webgpu], the native rotor
//                active, one renderer line on the console, console otherwise clean; load → ready time reported
//   params       ?native=0 (no native machines) and ?cache=0 (no cached frames) still work
//   fallback     no navigator.gpu, a null adapter, no DecompressionStream (the display list cannot be decoded): the
//                SVG figure takes over, html[data-renderer=svg], the reason in __gpu.error, the figure animates
//   v2           the deliverable vs the committed v2 page (../v2-factory/parts/centrifuge) at the same lockstep tick,
//                normal and reduced motion: within the live limits of DPR 2, runtime state equal
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { LIVE } from "./gates.config.mjs";
import { compareImages } from "./diff.mjs";
import { GATES_OUT, PAGES, ROOT, RUNTIME_STATE, advanceTo, createChecks, fileUrl, openPage, openRuntimePage, parseArgs, settle, shot, sleep, stageBox, waitFor, withBrowser } from "./harness.mjs";

const DIR = join(GATES_OUT, "package");
const THEMES = ["dark", "light"];
const LIMIT = LIVE.limits[LIVE.dpr];
/** The committed v2 pages the deliverables stand in for. */
const V2_PAGES = { dark: join(ROOT, "../v2-factory/parts/centrifuge/centrifuge.html"), light: join(ROOT, "../v2-factory/parts/centrifuge/centrifuge-light.html") };
const NO_WEBGPU = readFileSync(join(ROOT, "tools/no-webgpu.preload.js"), "utf8");
const NULL_ADAPTER = `if (navigator.gpu) GPU.prototype.requestAdapter = () => new Promise((resolve) => setTimeout(() => resolve(null), 50));`;
const NO_DECOMPRESSION = `delete window.DecompressionStream;`;
/** Records console.info lines and when html[data-gpu] got its value (ms since navigation start). */
const OBSERVE = `(() => {
  const infos = window.__infoLines = [];
  const info = console.info.bind(console);
  console.info = (...args) => { infos.push(args.join(" ")); info(...args); };
  window.__gpuStateAt = {};
  // the preload runs before <html> exists: watch the document for the attribute instead
  new MutationObserver(() => { const state = document.documentElement?.dataset.gpu; if (state && !(state in __gpuStateAt)) __gpuStateAt[state] = performance.now(); })
    .observe(document, { subtree: true, attributes: true, attributeFilter: ["data-gpu"] });
})();`;
/** References a self-contained page must not have: external scripts, stylesheets, images, fonts, imports. */
const EXTERNAL_REFERENCE = /\b(?:src|href)\s*=\s*["'](?!#|data:)[^"']+["']|\burl\(\s*["']?(?!#|data:)[a-z][^)]*\)|@import\b/gi;

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const consoleText = (page) => [...page.problems, ...page.warnings].slice(0, 3).join(" | ");

/** Serves ROOT on 127.0.0.1 (the deliverables over http://). */
function serveRoot() {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".png": "image/png", ".md": "text/markdown; charset=utf-8" };
  const server = createServer((request, response) => {
    const path = normalize(join(ROOT, decodeURIComponent(new URL(request.url, "http://x").pathname)));
    if (!path.startsWith(ROOT)) return response.writeHead(403).end();
    try {
      const body = readFileSync(path);
      response.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function withPage(browser, options, use) {
  const page = await openPage(browser, { ...options, preloads: [OBSERVE, ...(options.preloads ?? [])] });
  try {
    return await use(page);
  } finally {
    await page.close();
  }
}

const PAGE_STATE = `({
  gpu: document.documentElement.dataset.gpu ?? null,
  renderer: document.documentElement.dataset.renderer ?? null,
  ready: !!window.__gpu?.ready,
  error: window.__gpu?.error ?? null,
  native: window.__gpu?.frameStats?.().native ?? null,
  cachedFrames: window.__gpu?.frameStats?.().cachedFrames ?? null,
  fullFrames: window.__gpu?.frameStats?.().fullFrames ?? null,
  infos: window.__infoLines,
  stateAt: window.__gpuStateAt,
  canvas: !!document.querySelector("canvas[data-gpu]"),
  rotor: FACTORY.slots["centrifuge:rotorFront"].innerHTML,
  status: document.querySelector("[data-status]")?.textContent ?? null,
  domContentLoaded: performance.getEntriesByType("navigation")[0]?.domContentLoadedEventEnd ?? null,
})`;

async function checkOpen(browser, { check }, { url, label }) {
  return withPage(browser, { path: url }, async (page) => {
    await waitFor(page.cdp, "window.__gpu && (__gpu.ready || !!__gpu.error)", 30000);
    await sleep(300);
    const state = await page.cdp.evaluate(PAGE_STATE);
    check(state.ready && !state.error && state.gpu === "ready" && state.renderer === "webgpu", `open ${label}: ready, html[data-renderer=webgpu]`, JSON.stringify({ gpu: state.gpu, renderer: state.renderer, error: state.error }));
    check(state.native?.active === true, `open ${label}: native rotor active`, JSON.stringify(state.native && { active: state.native.active, drawing: state.native.drawing }));
    check(state.infos.length === 1 && state.infos[0].startsWith("figure renderer: WebGPU · TypeGPU"), `open ${label}: one renderer line on the console`, JSON.stringify(state.infos));
    check(!page.problems.length && !page.warnings.length, `open ${label}: console clean`, consoleText(page));
    return { readyMs: Math.round(state.stateAt.ready), domContentLoadedMs: Math.round(state.domContentLoaded) };
  });
}

async function checkParams(browser, { check }, theme) {
  const base = fileUrl(PAGES.deliverable(theme));
  await withPage(browser, { path: `${base}?native=0` }, async (page) => {
    await waitFor(page.cdp, "window.__gpu && (__gpu.ready || !!__gpu.error)", 30000);
    await sleep(500);
    const state = await page.cdp.evaluate(PAGE_STATE);
    check(state.ready && state.native === null, `params ${theme} ?native=0: ready, no native machines`, JSON.stringify({ ready: state.ready, native: state.native }));
  });
  await withPage(browser, { path: `${base}?cache=0` }, async (page) => {
    await waitFor(page.cdp, "window.__gpu && (__gpu.ready || !!__gpu.error)", 30000);
    await sleep(500);
    const state = await page.cdp.evaluate(PAGE_STATE);
    check(state.ready && state.cachedFrames === 0 && state.fullFrames > 10, `params ${theme} ?cache=0: ready, every frame a full redraw`, JSON.stringify({ ready: state.ready, cached: state.cachedFrames, full: state.fullFrames }));
  });
}

async function checkFallback(browser, { check }, { name, preload, reason }) {
  await withPage(browser, { path: PAGES.deliverable("light"), preloads: [preload] }, async (page) => {
    await waitFor(page.cdp, "document.documentElement.dataset.gpu === 'fallback'", 15000).catch(() => {});
    const early = await page.cdp.evaluate(PAGE_STATE);
    await sleep(600);
    const state = await page.cdp.evaluate(PAGE_STATE);
    check(state.gpu === "fallback" && state.renderer === "svg" && String(state.error).startsWith(reason) && !state.canvas, `fallback ${name}: SVG figure, html[data-renderer=svg], __gpu.error "${reason}…"`, JSON.stringify({ gpu: state.gpu, renderer: state.renderer, error: state.error?.slice(0, 80), canvas: state.canvas }));
    check(state.rotor !== early.rotor && !!state.status, `fallback ${name}: the figure animates, aria-live status present`, `rotor ${early.rotor.length} → ${state.rotor.length} chars, status "${state.status}"`);
    check(state.infos.length === 1 && state.infos[0].startsWith("figure renderer: SVG fallback"), `fallback ${name}: one renderer line on the console`, JSON.stringify(state.infos));
    check(!page.problems.length && !page.warnings.length, `fallback ${name}: console clean`, consoleText(page));
  });
}

async function runtimeShot(browser, { path, theme, tick, reduced, prefix }) {
  const { cdp, problems, warnings, close } = await openRuntimePage(browser, { path, dpr: LIVE.dpr, reduced });
  try {
    const box = await stageBox(cdp);
    await advanceTo(cdp, tick);
    await settle(cdp);
    return { file: await shot(cdp, join(DIR, `${prefix}-${theme}-t${tick}.png`), box), state: await cdp.evaluate(RUNTIME_STATE), problems: [...problems, ...warnings] };
  } finally {
    await close();
  }
}

async function checkAgainstV2(browser, { check }, { theme, tick, reduced }) {
  const label = `v2 ${theme} t${tick}${reduced ? " reduced" : ""}`;
  const prefix = reduced ? "reduced" : "motion";
  const v2 = await runtimeShot(browser, { path: V2_PAGES[theme], theme, tick, reduced, prefix: `${prefix}-v2` });
  const gpu = await runtimeShot(browser, { path: PAGES.deliverable(theme), theme, tick, reduced, prefix: `${prefix}-gpu` });
  const diff = compareImages(v2.file, gpu.file, { diffFile: join(DIR, `${prefix}-diff-${theme}-t${tick}.png`) });
  check(diff.loosePct <= LIMIT.loosePct && diff.withAAPct <= LIMIT.withAAPct && diff.solidCluster <= LIMIT.solidCluster, `${label}: deliverable vs committed v2 page within the DPR ${LIVE.dpr} live limits`, `loose ${diff.loosePct}% · incl. AA ${diff.withAAPct}% · solid blob ${diff.solidCluster} px`);
  const differing = Object.keys(v2.state).filter((key) => v2.state[key] !== gpu.state[key]);
  check(!differing.length, `${label}: runtime state, readout and aria-live equal`, differing.length ? `${differing.join(", ")} differ` : `"${gpu.state.readout}"`);
  check(!v2.problems.length && !gpu.problems.length, `${label}: consoles clean`, [...v2.problems, ...gpu.problems].slice(0, 3).join(" | "));
  return diff;
}

const options = parseArgs(["quick"]);
const checks = createChecks("package");
const report = { sizes: {}, loads: [], v2: [] };

for (const theme of THEMES) {
  const deliverable = PAGES.deliverable(theme);
  const html = readFileSync(deliverable, "utf8");
  checks.check(sha256(deliverable) === sha256(join(ROOT, PAGES.gpu(theme))), `bytes ${theme}: deliverable == ${PAGES.gpu(theme)}`);
  const external = html.match(EXTERNAL_REFERENCE) ?? [];
  checks.check(!external.length, `bytes ${theme}: no external references`, external.slice(0, 3).join(" "));
  report.sizes[theme] = readFileSync(deliverable).length;
}

const server = await serveRoot();
try {
  await withBrowser(async (browser) => {
    for (const theme of THEMES) {
      const file = PAGES.deliverable(theme);
      const http = `http://127.0.0.1:${server.address().port}/${file}`;
      for (const [scheme, url] of [["file", file], ["http", http]]) {
        const load = await checkOpen(browser, checks, { url, label: `${theme} ${scheme}://` });
        report.loads.push({ theme, scheme, ...load });
      }
      await checkParams(browser, checks, theme);
    }
    await checkFallback(browser, checks, { name: "no-webgpu", preload: NO_WEBGPU, reason: "no-webgpu" });
    await checkFallback(browser, checks, { name: "null-adapter", preload: NULL_ADAPTER, reason: "no-adapter" });
    await checkFallback(browser, checks, { name: "no-decompression", preload: NO_DECOMPRESSION, reason: "dl-decode-failed" });
    const comparisons = options.quick ? [{ theme: "light", tick: 711 }, { theme: "light", tick: 600, reduced: true }] : THEMES.flatMap((theme) => [{ theme, tick: 711 }, { theme, tick: 884 }, { theme, tick: 600, reduced: true }]);
    for (const comparison of comparisons) report.v2.push({ ...comparison, ...(await checkAgainstV2(browser, checks, comparison)) });
  });
} finally {
  server.close();
}
console.log(`load → ready (ms since navigation start): ${report.loads.map((l) => `${l.theme} ${l.scheme} ${l.readyMs} (DOMContentLoaded ${l.domContentLoadedMs})`).join(" · ")}`);
checks.finish(report);
