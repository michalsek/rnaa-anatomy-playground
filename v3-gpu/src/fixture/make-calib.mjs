// node src/fixture/make-calib.mjs → out/gpu/calib/{calib.html, calib-light.html, calib.scene.json, cells.json}
// Hairline calibration sheet, each cell on light paper (left half) and on a graphite panel (right half), for stroke
// widths 0.4 / 0.6 / 1.0 / 1.3 CSS px:
//  - straight lines at 0…90°, including the isometric 2:1 slopes (26.565° and 153.435°);
//  - offset sweeps: short 0°, 90° and 2:1 lines shifted by 0, 0.2, … 0.8 viewBox units, so every sub-pixel phase of
//    a hairline is measured on its own (a mean over phases hides a phase that renders too light);
//  - a zig-zag polyline with sharp round joins, a closed ring, butt-capped tube-ring-like strokes, short dial ticks
//    and dots.
// cells.json lists each cell's box in viewBox units; tools/live-gate.mjs calib measures ink per cell.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { itemsToScene, encodeScene } from "./svg2scene.mjs";

const k = await import(join(homedir(), ".claude/skills/anatomy/kit/iso-kit.mjs"));
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "out/gpu/calib");
const FACTORY_CSS = readFileSync(join(ROOT, "../v2-factory/shared/factory.css"), "utf8");
const ISO_SLOPE_DEG = (Math.atan(0.5) * 180) / Math.PI;
const W = 900, H = 600;
const HALF_WIDTH = W / 2;
const ROW_HEIGHT = 140;
const widths = [0.4, 0.6, 1.0, 1.3];
const angles = [0, 7, 15, ISO_SLOPE_DEG, 30, 45, 60, 90, 180 - ISO_SLOPE_DEG];
const sweepAngles = [0, 90, ISO_SLOPE_DEG];
const sweepOffsets = [0, 0.2, 0.4, 0.6, 0.8];
const cell = 40;
const sweepCell = 28;
const cells = [];
let svgLight = "";
const f = (n) => n.toFixed(2);
const angleName = (deg) => +deg.toFixed(3);
const line = (cx, cy, deg, r, w) => {
  const a = (deg * Math.PI) / 180;
  return `<path class="iso-line" data-tone="hi" style="stroke-width:${w}" d="M${f(cx - r * Math.cos(a))} ${f(cy - r * Math.sin(a))}L${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}"/>`;
};
for (const [half, x0] of [["paper", 10], ["graphite", HALF_WIDTH + 10]]) {
  let body = "";
  widths.forEach((w, row) => {
    const y = 10 + row * ROW_HEIGHT;
    angles.forEach((deg, col) => {
      const cx = x0 + 20 + col * cell, cy = y + 20;
      body += line(cx, cy, deg, 14, w);
      cells.push({ half, kind: "line", width: w, angle: angleName(deg), box: [cx - 19, cy - 19, 38, 38] });
    });
    // offset sweeps: the line moves by (o, o) inside a fixed cell
    sweepAngles.forEach((deg, group) => {
      sweepOffsets.forEach((o, i) => {
        const cx = x0 + 15 + (group * sweepOffsets.length + i) * sweepCell, cy = y + 56;
        body += line(cx + o, cy + o, deg, 9, w);
        cells.push({ half, kind: "line", width: w, angle: angleName(deg), offset: o, box: [cx - 13, cy - 13, 26, 26] });
      });
    });
    // zig-zag with sharp joins + closed ring + butt ring-like short strokes + dots
    const zx = x0 + 10, zy = y + 86;
    const zig = Array.from({ length: 12 }, (_, i) => `${i ? "L" : "M"}${f(zx + i * 5)} ${f(zy + (i % 2 ? 12 : 0))}`).join("");
    body += `<path class="iso-line" data-tone="mid" style="stroke-width:${w}" d="${zig}"/>`;
    cells.push({ half, kind: "zigzag", width: w, box: [zx - 3, zy - 3, 62, 18] });
    const ring = Array.from({ length: 48 }, (_, i) => `${i ? "L" : "M"}${f(x0 + 100 + 12 * Math.cos((i / 48) * 2 * Math.PI))} ${f(zy + 6 + 7 * Math.sin((i / 48) * 2 * Math.PI))}`).join("") + "Z";
    body += `<path class="iso-line" data-tone="lo" style="stroke-width:${w}" d="${ring}"/>`;
    cells.push({ half, kind: "ring", width: w, box: [x0 + 85, zy - 4, 30, 20] });
    body += `<path class="tb-ring" style="stroke-width:${w}" d="M${f(x0 + 130)} ${f(zy)}L${f(x0 + 133)} ${f(zy + 12)}M${f(x0 + 140)} ${f(zy)}L${f(x0 + 143)} ${f(zy + 12)}"/>`;
    cells.push({ half, kind: "butt", width: w, box: [x0 + 126, zy - 4, 22, 20] });
    // short ticks (dial scale marks): lengths 1.4 viewBox units at 12 angles
    const tx = x0 + 200, ty = zy + 6;
    body += `<path class="iso-line" data-tone="hi" style="stroke-width:${w}" d="${Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI; const cx = tx + i * 6; return `M${f(cx)} ${f(ty)}L${f(cx + 1.4 * Math.cos(a))} ${f(ty + 1.4 * Math.sin(a))}`; }).join("")}"/>`;
    cells.push({ half, kind: "ticks", width: w, box: [tx - 3, ty - 4, 74, 10] });
    body += `<g class="iso-dots" data-tone="${["faint", "lo", "mid", "hi"][row]}">${Array.from({ length: 6 }, (_, i) => `<circle cx="${f(x0 + 160 + i * 4.3)}" cy="${f(zy + 6 + i * 0.37)}" r="${[0.36, 0.4, 0.42, 0.5][row]}"/>`).join("")}</g>`;
    cells.push({ half, kind: "dots", width: [0.36, 0.4, 0.42, 0.5][row], box: [x0 + 156, zy, 30, 14] });
  });
  const panel = half === "graphite" ? `<g class="iso-solid"><path class="iso-fill" d="M${x0 - 5} 5L${x0 + HALF_WIDTH - 10} 5L${x0 + HALF_WIDTH - 10} ${H - 5}L${x0 - 5} ${H - 5}Z"/></g>` : "";
  const wrapped = `<g class="it${half === "graphite" ? " fx-graphite" : ""}" data-name="${half}">${panel}${body}</g>`;
  svgLight += wrapped;
}
const items = [
  { name: "paper", key: 0, svg: svgLight.split('<g class="it fx-graphite"')[0] },
  { name: "graphite", key: 1, svg: '<g class="it fx-graphite"' + svgLight.split('<g class="it fx-graphite"')[1] },
];
function pageFor(theme) {
  const svg = k.figureSvg({ width: W, height: H, label: "Calibration", body: `<g class="fx-parts">${items.map((i) => i.svg).join("")}</g>` });
  const stage = `<div class="iso-stage fx-stage" tabindex="0" role="group" aria-label="Calibration">${svg}</div>`;
  const body = `<style>${FACTORY_CSS}</style>` + k.plateHtml({ fig: "Calib", title: "hairlines", hint: "", readout: "", body: stage });
  return k.pageHtml({ title: "Calibration", theme, body, width: Math.max(650, W + 60) });
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "calib.html"), pageFor("dark"));
writeFileSync(join(OUT, "calib-light.html"), pageFor("light"));
const scene = itemsToScene({ viewBox: [0, 0, W, H], items });
scene.chainPrefix = [{ tag: "g", attrs: { class: "fx-parts" } }];
writeFileSync(join(OUT, "calib.scene.json"), encodeScene(scene));
writeFileSync(join(OUT, "cells.json"), JSON.stringify({ viewBox: [0, 0, W, H], cells }));
console.log(`calib: ${cells.length} cells`);
