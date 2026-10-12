#!/usr/bin/env node
// Stress page: N copies of a single-machine factory page, all on screen at once.
//
//   node bench/stress.mjs <single.html> [--n 10] [--mode inline|iframe] [--out bench/stress10-light.html]
//
// inline: one stylesheet, N stages, N copies of the page's module script. Each copy is scoped to its own cell by
//         re-targeting the runtime's three document.querySelector calls (".fx-stage", "[data-readout]",
//         "[data-status]"); module scope keeps the copies' FACTORY / MACHINES apart. Static SVG ids are suffixed.
// iframe: N iframes of the page (any page works, e.g. a GPU build); a same-origin style trims margins/captions.
// The grid is sized so every instance is fully inside the viewport (the runtime's IntersectionObserver would stop
// the ones outside it), recomputed on resize. The stage renderer is whatever the source page uses, so the GPU
// stress page is this command on the GPU page.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";

const argv = process.argv.slice(2);
const opt = { n: 10, mode: "inline", out: null };
const rest = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--n") opt.n = Number(argv[++i]);
  else if (argv[i] === "--mode") opt.mode = argv[++i];
  else if (argv[i] === "--out") opt.out = argv[++i];
  else rest.push(argv[i]);
}
const source = rest[0];
if (!source) {
  console.log("usage: node bench/stress.mjs <single.html> [--n 10] [--mode inline|iframe] [--out file.html]");
  process.exit(1);
}
opt.out ??= resolve(dirname(source), `stress${opt.n}-${opt.mode}-${basename(source)}`);
const html = readFileSync(source, "utf8");

const LAYOUT = String.raw`<script>
// fit N cells of the stage's aspect into the viewport: pick the column count that gives the largest cell
(() => {
  const N = __N__, PAD = 6;
  function fit() {
    const grid = document.querySelector(".bx-grid");
    const svg = document.querySelector(".bx-cell .iso-svg");
    const vb = svg ? svg.viewBox.baseVal : null;
    const aspect = __ASPECT__ ?? (vb && vb.width ? vb.height / vb.width : 1.2);
    const W = innerWidth, H = innerHeight;
    let best = { w: 0 };
    for (let cols = 1; cols <= N; cols++) {
      const rows = Math.ceil(N / cols);
      const w = Math.floor(Math.min(W / cols, H / rows / aspect)) - PAD;
      if (w > best.w) best = { w, cols };
    }
    grid.style.setProperty("--cols", best.cols);
    grid.style.setProperty("--cw", best.w + "px");
    grid.style.setProperty("--ch", Math.floor(best.w * aspect) + "px");
  }
  addEventListener("resize", fit);
  document.addEventListener("DOMContentLoaded", fit);
  window.__bxFit = fit;
})();
</script>`;

const GRID_CSS = `.bx-grid{display:grid;grid-template-columns:repeat(var(--cols,2),var(--cw,300px));grid-auto-rows:var(--ch,360px);gap:6px;justify-content:center;align-content:center;min-height:100vh;margin:0}
.bx-cell{position:relative;overflow:hidden}
.bx-cell.iso-plate{padding:0;box-shadow:none}
.bx-cell .iso-svg{width:var(--cw);height:var(--ch)}
.bx-cell .iso-plate-corners{inset:2px 4px}
.bx-cell iframe{display:block;width:100%;height:100%;border:0}
body{overflow:hidden}`;

function inline() {
  const head = html.slice(0, html.indexOf("</head>"));
  const bodyOpen = html.match(/<body[^>]*>/)[0];
  const innerStyle = html.match(/<main class="iso-page"><style>([\s\S]*?)<\/style>/)[1];
  const stageStart = html.indexOf('<div class="iso-stage fx-stage"');
  const stageEndMarker = "data-status></span></div>";
  const stageEnd = html.indexOf(stageEndMarker, stageStart) + stageEndMarker.length;
  if (stageStart < 0 || stageEnd < stageEndMarker.length) throw new Error("no .fx-stage block found");
  const stage = html.slice(stageStart, stageEnd);
  const readout = (html.match(/data-readout>([^<]*)</) ?? [, ""])[1];
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const ids = [...stage.matchAll(/ id="([^"$]+)"/g)].map((m) => m[1]);
  const vb = stage.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const cells = [];
  const scripts = [];
  for (let i = 0; i < opt.n; i++) {
    let s = stage;
    for (const id of ids) s = s.split(`id="${id}"`).join(`id="${id}--${i}"`).split(`url(#${id})`).join(`url(#${id}--${i})`).split(`href="#${id}"`).join(`href="#${id}--${i}"`);
    cells.push(`<div class="bx-cell iso-plate" data-inst="${i}"><div class="iso-plate-corners" aria-hidden="true"><span class="iso-plate-corner" data-corner="readout" data-readout>${readout}</span></div>${s}</div>`);
    let js = script;
    for (const sel of [".fx-stage", "[data-readout]", "[data-status]"]) {
      const call = `document.querySelector(${JSON.stringify(sel)})`;
      const count = js.split(call).length - 1;
      if (count !== 1) throw new Error(`expected exactly one ${call} in the page script, found ${count}`);
      js = js.replace(call, `document.querySelector(${JSON.stringify(`[data-inst="${i}"] ${sel}`)})`);
    }
    scripts.push(`<script type="module">${js}</script>`);
  }
  const aspect = vb ? Number(vb[2]) / Number(vb[1]) : "null";
  return `${head}<style>${innerStyle}\n${GRID_CSS}</style>${LAYOUT.replace("__N__", opt.n).replace("__ASPECT__", aspect)}</head>${bodyOpen}<main class="bx-grid">${cells.join("")}</main><script>__bxFit()</script>${scripts.join("\n")}</body></html>`;
}

function iframe() {
  const src = relative(dirname(resolve(opt.out)), resolve(source));
  const head = html.slice(0, html.indexOf("</head>"));
  const bodyOpen = html.match(/<body[^>]*>/)[0];
  const trim = `.iso-page{margin:0!important;width:100%!important}.iso-figure{margin:0!important}.iso-legend{display:none!important}.iso-plate{padding:4px!important}body{overflow:hidden}`;
  const cells = Array.from({ length: opt.n }, (_, i) => `<div class="bx-cell" data-inst="${i}"><iframe src="${src}" title="instance ${i}" onload="try{const s=this.contentDocument.createElement('style');s.textContent=${JSON.stringify(trim).replace(/"/g, "&quot;")};this.contentDocument.head.append(s)}catch(e){}"></iframe></div>`);
  // iframe cells hold the whole plate: use the plate's aspect (stage + corners), not the bare SVG's
  return `${head}<style>${GRID_CSS}</style>${LAYOUT.replace("__N__", opt.n).replace("__ASPECT__", "1.25")}</head>${bodyOpen}<main class="bx-grid">${cells.join("")}</main><script>__bxFit()</script></body></html>`;
}

const out = opt.mode === "iframe" ? iframe() : inline();
writeFileSync(opt.out, out);
console.log(`wrote ${opt.out} · ${opt.n} × ${opt.mode} · ${(out.length / 1024).toFixed(0)} KB`);
