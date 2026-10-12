// node tools/build.mjs [--dev]
// 1. esbuild bundle src/main.ts → out/gpu/gpu.js (minified IIFE, unminified with --dev)
// 2. harness pages: copy an SVG page (card chrome + CSS), swap its <svg class="iso-svg"> for a canvas with the same CSS
//    box, keep the SVG as a <template> fallback, drop the page's live module script (static frame: slots empty),
//    inline the scene data and the bundle.
//      out/gpu/fixture/fixture-gpu(-light).html   ← out/gpu/fixture/fixture(-light).html + fixture.scene.json
//      out/gpu/static(-light).html                ← out/svg/centrifuge(-light).html + out/dl/centrifuge.dl.{json,bin}
import * as esbuild from "esbuild";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out/gpu");
const dev = process.argv.includes("--dev");
mkdirSync(OUT, { recursive: true });

const result = await esbuild.build({
  entryPoints: [join(ROOT, "src/main.ts")],
  bundle: true,
  minify: !dev,
  format: "iife",
  target: "es2022",
  write: false,
  metafile: true,
  legalComments: "none",
  sourcemap: dev ? "inline" : false,
  logLevel: "warning",
});
const js = result.outputFiles[0].text;
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
