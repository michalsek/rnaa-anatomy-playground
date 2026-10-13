// node tools/build.mjs [--dev]
// 1. esbuild bundle src/main.ts → out/gpu/gpu.js (minified IIFE, unminified with --dev)
// 2. harness pages: copy an SVG page (card chrome + CSS), swap its <svg class="iso-svg"> for a canvas with the same CSS
//    box, keep the SVG as a <template> fallback, drop the page's live module script (static frame: slots empty),
//    inline the scene data and the bundle.
//      out/gpu/fixture/fixture-gpu(-light).html   ← out/gpu/fixture/fixture(-light).html + fixture.scene.json
//      out/gpu/static(-light).html                ← out/svg/centrifuge(-light).html + out/dl/centrifuge.dl.{json,bin}
// 3. live pages (M3): the same SVG page with its v2 module script kept verbatim (asserted against runtime.js and the
//    centrifuge LIVE source); the figure becomes canvas + hidden slot skeleton + <template> fallback.
//      out/gpu/live(-light).html    prod bundle: unsupported live markup → slot skipped + console.warn
//      out/gpu/live-dev.html        dev bundle (__GPU_DEV__): unsupported live markup throws at the runtime's write
import * as esbuild from "esbuild";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out/gpu");
const dev = process.argv.includes("--dev");
mkdirSync(OUT, { recursive: true });

const bundle = async (devBuild) => {
  const result = await esbuild.build({
    entryPoints: [join(ROOT, "src/main.ts")],
    bundle: true,
    minify: !devBuild,
    format: "iife",
    target: "es2022",
    write: false,
    metafile: true,
    legalComments: "none",
    sourcemap: devBuild ? "inline" : false,
    logLevel: "warning",
    define: { __GPU_DEV__: String(devBuild) },
  });
  return result.outputFiles[0].text;
};
const js = await bundle(dev);
const devJs = dev ? js : await bundle(true);
writeFileSync(join(OUT, "gpu.js"), js);
console.log(`out/gpu/gpu.js ${js.length} B${dev ? " (dev)" : " minified"}`);

const scriptSafe = (text) => text.replace(/<\/(script)/gi, "<\\/$1");
const jsonSafe = (text) => text.replace(/</g, "\\u003c");

function harness(svgPage, dataScripts, outFile) {
  let html = readFileSync(svgPage, "utf8");
  const start = html.indexOf('<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg"');
  if (start < 0) throw new Error(`${svgPage}: no svg.iso-svg`);
  const end = html.indexOf("</svg>", start) + "</svg>".length;
  const svg = html.slice(start, end);
  const [, , , vw, vh] = svg.match(/viewBox="([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)"/);
  const label = svg.match(/aria-label="([^"]*)"/)?.[1] ?? "figure";
  const canvas = `<canvas class="iso-svg" data-gpu role="img" aria-label="${label}" style="aspect-ratio:${vw}/${vh};height:auto"></canvas><template id="svg-fallback">${svg}</template>`;
  html = html.slice(0, start) + canvas + html.slice(end);
  html = html.replace(/<script type="module">[\s\S]*?<\/script>/, ""); // static frame: no live runtime
  html = html.replace("</body>", () => `${dataScripts}<script>${scriptSafe(js)}</script></body>`); // function form: no $-patterns
  writeFileSync(outFile, html);
  console.log(`${outFile.replace(ROOT + "/", "")} ${html.length} B`);
}

const fixtureDir = join(OUT, "fixture");
if (existsSync(join(fixtureDir, "fixture.scene.json"))) {
  const scene = readFileSync(join(fixtureDir, "fixture.scene.json"), "utf8");
  const data = `<script type="application/json" id="gpu-scene">${jsonSafe(scene)}</script>`;
  for (const variant of ["fixture", "fixture-light", "fixture-share1", "fixture-share1-light"]) {
    if (!variant.includes("share1")) harness(join(fixtureDir, `${variant}.html`), data, join(fixtureDir, `${variant.replace("fixture", "fixture-gpu")}.html`));
  }
}
for (const extra of ["calib"]) {
  const scene = join(OUT, extra, `${extra}.scene.json`);
  if (!existsSync(scene)) continue;
  const data = `<script type="application/json" id="gpu-scene">${jsonSafe(readFileSync(scene, "utf8"))}</script>`;
  for (const theme of ["", "-light"]) harness(join(OUT, extra, `${extra}${theme}.html`), data, join(OUT, extra, `${extra}-gpu${theme}.html`));
}

const dlJson = join(ROOT, "out/dl/centrifuge.dl.json");
const dlBin = join(ROOT, "out/dl/centrifuge.dl.bin");
if (existsSync(dlJson) && existsSync(dlBin) && existsSync(join(ROOT, "out/svg/centrifuge.html")) && !process.argv.includes("--no-dl")) {
  const data = `<script type="application/json" id="gpu-dl">${jsonSafe(readFileSync(dlJson, "utf8"))}</script><script type="application/octet-stream" id="gpu-dl-bin">${readFileSync(dlBin).toString("base64")}</script>`;
  harness(join(ROOT, "out/svg/centrifuge.html"), data, join(OUT, "static.html"));
  harness(join(ROOT, "out/svg/centrifuge-light.html"), data, join(OUT, "static-light.html"));
}

// ---- live pages (M3) ------------------------------------------------------------------------------------------------
const MODULE_SCRIPT = /<script type="module">([\s\S]*?)<\/script>/;

// The page script must be v2's own: kit + lathe + runtime.js (data spliced in) + LIVE + STUB_LIVE + boot, as page()
// concatenated it. Fails the build when the copy drifted from the v2 sources.
async function assertVerbatimScript(script) {
  const runtime = readFileSync(join(ROOT, "../v2-factory/shared/runtime.js"), "utf8");
  const [head, tail] = runtime.split("__FACTORY_DATA__");
  const { LIVE } = await import("../../v2-factory/parts/centrifuge/centrifuge.mjs");
  const missing = [["runtime.js head", head], ["runtime.js tail", tail], ["centrifuge LIVE", LIVE]].filter(([, text]) => !script.includes(text.replace(/<\/(script)/gi, "<\\/$1")));
  if (missing.length) throw new Error(`live page script is not v2's verbatim: missing ${missing.map(([name]) => name).join(", ")}`);
}

async function liveHarness(svgPage, dataScripts, bundleJs, outFile) {
  let html = readFileSync(svgPage, "utf8");
  const script = html.match(MODULE_SCRIPT)?.[1];
  if (!script) throw new Error(`${svgPage}: no module script`);
  await assertVerbatimScript(script);
  const start = html.indexOf('<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg"');
  if (start < 0) throw new Error(`${svgPage}: no svg.iso-svg`);
  const end = html.indexOf("</svg>", start) + "</svg>".length;
  const svg = html.slice(start, end);
  const [, , , vw, vh] = svg.match(/viewBox="([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)"/);
  const label = svg.match(/aria-label="([^"]*)"/)?.[1] ?? "figure";
  // runtime.js binds to stage.querySelector("svg") and its [data-slot] groups: the skeleton is the first svg in the stage
  const slots = [...svg.matchAll(/<g data-slot="[^"]*"><\/g>/g)].map((m) => m[0]).join("");
  const skeleton = `<svg class="fx-live-slots" aria-hidden="true" style="display:none">${slots}</svg>`;
  const canvas = `<canvas class="iso-svg" data-gpu data-live role="img" aria-label="${label}" style="aspect-ratio:${vw}/${vh};height:auto"></canvas>${skeleton}<template id="svg-fallback">${svg}</template>`;
  html = html.slice(0, start) + canvas + html.slice(end);
  // classic inline script: runs during parsing, i.e. before the deferred module script, so the slot setters are in place
  // the last </body>: the kit source inside the module script contains the text "</body>" too
  const bodyEnd = html.lastIndexOf("</body>");
  html = `${html.slice(0, bodyEnd)}${dataScripts}<script>${scriptSafe(bundleJs)}</script>${html.slice(bodyEnd)}`;
  writeFileSync(outFile, html);
  console.log(`${outFile.replace(ROOT + "/", "")} ${html.length} B`);
}

if (existsSync(dlJson) && existsSync(dlBin) && existsSync(join(ROOT, "out/svg/centrifuge.html")) && !process.argv.includes("--no-dl")) {
  const data = `<script type="application/json" id="gpu-dl">${jsonSafe(readFileSync(dlJson, "utf8"))}</script><script type="application/octet-stream" id="gpu-dl-bin">${readFileSync(dlBin).toString("base64")}</script>`;
  await liveHarness(join(ROOT, "out/svg/centrifuge.html"), data, js, join(OUT, "live.html"));
  await liveHarness(join(ROOT, "out/svg/centrifuge-light.html"), data, js, join(OUT, "live-light.html"));
  await liveHarness(join(ROOT, "out/svg/centrifuge.html"), data, devJs, join(OUT, "live-dev.html"));
}
