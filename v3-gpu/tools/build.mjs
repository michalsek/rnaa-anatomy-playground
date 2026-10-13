// node tools/build.mjs [--dev]
// 1. esbuild bundles of src/web/main.ts: prod (minified) → out/gpu/gpu.js; dev (__GPU_DEV__, inline sourcemap).
// 2. GPU pages: a copy of an SVG page (card chrome + CSS) whose figure stage gets `canvas[data-gpu]` right before the
//    figure's own <svg class="iso-svg">; the SVG stays in the page (overlaying the hidden canvas until the first GPU frame,
//    and the fallback if WebGPU fails), the scene data and the bundle are inlined.
//      out/gpu/fixture/fixture-gpu(-light).html   ← fixture(-light).html + fixture.scene.json   (static, no runtime)
//      out/gpu/calib/calib-gpu(-light).html       ← calib(-light).html + calib.scene.json       (static, no runtime)
//      out/gpu/static(-light).html                ← out/svg/centrifuge(-light).html + DL         (static: module script dropped)
//      out/gpu/live(-light).html                  ← the same pages with v2's module script kept verbatim (prod bundle)
//      out/gpu/live-dev.html                      dev bundle: unsupported live markup throws at the runtime's write
//      centrifuge-gpu(-light).html                the deliverable pages: byte copies of out/gpu/live(-light).html, so the
//                                                 gates that open the live pages test the deliverable bytes
//    DL pages carry the binary half as export/dl-wire.mjs transport (column-wise delta, gzip, base64: 2.6 MB of
//    base64 → 0.25 MB), decoded in the page with DecompressionStream; the JSON half stays plain (boot reads it
//    synchronously).
//    Live pages get one injected line at `function drawRotor(now) {` (the native rotor hook, src/native/rotor-contract.ts);
//    exactly one such site must exist and every name the line passes must be declared in centrifugeLive, else the
//    build fails (tools/rotor-hook.mjs).
//    The live pages' module script must equal the script a fresh v2 page() writes now (drift check), and the figure must
//    hold exactly the DL's slots.
// --dev: only the dev outputs (live-dev.html); the prod pages stay as they are.
import * as esbuild from "esbuild";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { DL_WIRE_ENCODING, packDlBinary } from "../export/dl-wire.mjs";
import { sceneModule, svgPageOf } from "../export/export.mjs";
import { injectRotorHook } from "./rotor-hook.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out/gpu");
const devOnly = process.argv.includes("--dev");
mkdirSync(OUT, { recursive: true });

const bundle = async (dev) => {
  const result = await esbuild.build({
    entryPoints: [join(ROOT, "src/web/main.ts")],
    bundle: true,
    minify: !dev,
    format: "iife",
    target: "es2022",
    write: false,
    legalComments: "none",
    sourcemap: dev ? "inline" : false,
    logLevel: "warning",
    define: { __GPU_DEV__: String(dev) },
  });
  return result.outputFiles[0].text;
};

const scriptSafe = (text) => text.replace(/<\/(script)/gi, "<\\/$1");
const jsonSafe = (text) => text.replace(/</g, "\\u003c");
const FIGURE_TAG = /<svg\b[^>]*\bclass="iso-svg"[^>]*>/;
const MODULE_SCRIPT = /<script type="module">([\s\S]*?)<\/script>/;
/** While WebGPU boots the figure overlays the (hidden) canvas, which has the figure's CSS box. */
const FIGURE_OVERLAY_STYLE = "position:absolute;left:0;top:0;width:100%";
/** The live page with the native rotor hook as the first line of drawRotor (tools/rotor-hook.mjs: one site, every name declared). */
function withRotorHook(html, page) {
  const match = MODULE_SCRIPT.exec(html);
  const script = match?.[1] ?? "";
  const start = match.index + match[0].indexOf(script);
  return html.slice(0, start) + injectRotorHook(script, page) + html.slice(start + script.length);
}

const log = (file, html) => console.log(`${file.replace(ROOT + "/", "")} ${html.length} B`);
/** The deliverable pages at the top of v3-gpu, by theme. */
const DELIVERABLES = { dark: join(ROOT, "centrifuge-gpu.html"), light: join(ROOT, "centrifuge-gpu-light.html") };
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/**
 * The GPU version of an SVG page. `live` keeps the page's module script (the v2 runtime drives the figure's slots);
 * otherwise it is dropped (static frame).
 */
function gpuPage(svgPage, { dataScripts, bundleJs, live }) {
  let html = readFileSync(svgPage, "utf8");
  const tag = FIGURE_TAG.exec(html);
  if (!tag) throw new Error(`${svgPage}: no <svg class="iso-svg"> figure`);
  if (/\sstyle=/.test(tag[0])) throw new Error(`${svgPage}: the figure already carries a style attribute`);
  const viewBox = /viewBox="([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)"/.exec(tag[0]);
  if (!viewBox) throw new Error(`${svgPage}: figure without a viewBox`);
  const [, , , vw, vh] = viewBox;
  const label = /aria-label="([^"]*)"/.exec(tag[0])?.[1] ?? "figure";
  const canvas = `<canvas class="iso-svg" data-gpu${live ? " data-live" : ""} role="img" aria-label="${label}" style="aspect-ratio:${vw}/${vh};height:auto;visibility:hidden"></canvas>`;
  const figure = tag[0].replace(/>$/, ` style="${FIGURE_OVERLAY_STYLE}">`);
  html = html.slice(0, tag.index) + canvas + figure + html.slice(tag.index + tag[0].length);
  if (!live) html = html.replace(MODULE_SCRIPT, "");
  else html = withRotorHook(html, svgPage);
  // a classic inline script: runs during parsing, before the deferred module script, so the slot interceptors are in
  // place before the runtime binds; the last </body>: v2's module script contains the text "</body>" too
  const bodyEnd = html.lastIndexOf("</body>");
  return `${html.slice(0, bodyEnd)}${dataScripts}<script>${scriptSafe(bundleJs)}</script>${html.slice(bodyEnd)}`;
}

/** The module script of v2's page() as it is written now, for both themes (drift check of out/svg). */
async function freshPageScripts(scene) {
  const dir = mkdtempSync(join(tmpdir(), "v3-build-"));
  try {
    const { run } = await sceneModule(scene);
    run({ out: svgPageOf(scene, "dark", dir) });
    return Object.fromEntries(["dark", "light"].map((theme) => [theme, MODULE_SCRIPT.exec(readFileSync(svgPageOf(scene, theme, dir), "utf8"))?.[1]]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Slots kit.mjs page() adds to every figure outside the scene's own (not drawn by the GPU path; unused by the centrifuge). */
const KIT_SLOTS = ["overlay"];

const normalized = (script) => script.replace(/\r\n/g, "\n").trim();

function assertLivePage(svgPage, theme, freshScripts, dl) {
  const html = readFileSync(svgPage, "utf8");
  const script = MODULE_SCRIPT.exec(html)?.[1];
  if (!script) throw new Error(`${svgPage}: no module script`);
  if (normalized(script) !== normalized(freshScripts[theme] ?? "")) throw new Error(`${svgPage}: its module script differs from v2's page() output now — re-run node export/export.mjs`);
  const figure = html.slice(FIGURE_TAG.exec(html).index, html.indexOf("</svg>", FIGURE_TAG.exec(html).index));
  const slots = [...figure.matchAll(/data-slot="([^"]*)"/g)].map((m) => m[1]);
  const expected = dl.slots.map((slot) => slot.name);
  const extra = slots.filter((name) => !expected.includes(name));
  if (expected.some((name) => !slots.includes(name)) || extra.some((name) => !KIT_SLOTS.includes(name))) throw new Error(`${svgPage}: figure slots [${slots}] ≠ DL slots [${expected}] + kit slots [${KIT_SLOTS}]`);
}

const prodJs = devOnly ? null : await bundle(false);
const devJs = await bundle(true);
if (prodJs) {
  writeFileSync(join(OUT, "gpu.js"), prodJs);
  console.log(`out/gpu/gpu.js ${prodJs.length} B minified`);
}

const write = (file, html) => {
  writeFileSync(file, html);
  log(file, html);
};

if (prodJs) {
  const sceneScript = (file) => `<script type="application/json" id="gpu-scene">${jsonSafe(readFileSync(file, "utf8"))}</script>`;
  for (const [dir, stem] of [[join(OUT, "fixture"), "fixture"], [join(OUT, "calib"), "calib"]]) {
    const scene = join(dir, `${stem}.scene.json`);
    if (!existsSync(scene)) continue;
    for (const theme of ["", "-light"]) write(join(dir, `${stem}-gpu${theme}.html`), gpuPage(join(dir, `${stem}${theme}.html`), { dataScripts: sceneScript(scene), bundleJs: prodJs, live: false }));
  }
}

const dlJson = join(ROOT, "out/dl/centrifuge.dl.json");
const dlBin = join(ROOT, "out/dl/centrifuge.dl.bin");
const svgPages = { dark: join(ROOT, "out/svg/centrifuge.html"), light: join(ROOT, "out/svg/centrifuge-light.html") };
if (existsSync(dlJson) && existsSync(dlBin) && existsSync(svgPages.dark)) {
  const dl = JSON.parse(readFileSync(dlJson, "utf8"));
  const dlWire = gzipSync(packDlBinary(readFileSync(dlBin)), { level: 9 }).toString("base64");
  const dataScripts = `<script type="application/json" id="gpu-dl">${jsonSafe(readFileSync(dlJson, "utf8"))}</script><script type="application/octet-stream" id="gpu-dl-bin" data-encoding="${DL_WIRE_ENCODING}">${dlWire}</script>`;
  const fresh = await freshPageScripts("centrifuge");
  for (const theme of ["dark", "light"]) assertLivePage(svgPages[theme], theme, fresh, dl);
  const suffix = (theme) => (theme === "light" ? "-light" : "");
  if (prodJs) {
    for (const theme of ["dark", "light"]) {
      write(join(OUT, `static${suffix(theme)}.html`), gpuPage(svgPages[theme], { dataScripts, bundleJs: prodJs, live: false }));
      const livePage = join(OUT, `live${suffix(theme)}.html`);
      const html = gpuPage(svgPages[theme], { dataScripts, bundleJs: prodJs, live: true });
      write(livePage, html);
      writeFileSync(DELIVERABLES[theme], html);
      if (sha256(DELIVERABLES[theme]) !== sha256(livePage)) throw new Error(`${DELIVERABLES[theme]} differs from ${livePage}`);
      console.log(`${DELIVERABLES[theme].replace(ROOT + "/", "")} ${html.length} B, gzip ${gzipSync(html, { level: 9 }).length} B (= ${livePage.replace(ROOT + "/", "")})`);
    }
  }
  write(join(OUT, "live-dev.html"), gpuPage(svgPages.dark, { dataScripts, bundleJs: devJs, live: true }));
}
