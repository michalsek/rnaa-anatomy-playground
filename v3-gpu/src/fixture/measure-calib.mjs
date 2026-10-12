// node src/fixture/measure-calib.mjs <svg.png> <gpu.png> <scale>
// Per calibration cell: ink = Σ |lum − lum(bg)| over the cell (bg = median of the cell border), peak = max |Δlum|.
// Prints gpu/svg ratios grouped by kind × width (light paper and graphite halves separately).
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const [svgPath, gpuPath, scaleArg] = process.argv.slice(2);
const scale = Number(scaleArg ?? 2);
const meta = JSON.parse(readFileSync(join(ROOT, "out/gpu/calib/cells.json"), "utf8"));
const a = PNG.sync.read(readFileSync(svgPath));
const b = PNG.sync.read(readFileSync(gpuPath));
const vbScale = (meta.svgCssWidth / meta.viewBox[2]) * scale;
const lum = (img, x, y) => {
  const i = (y * img.width + x) * 4;
  return 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
};
function measure(img, [bx, by, bw, bh]) {
  const x0 = Math.round(meta.origin[0] * scale + bx * vbScale), y0 = Math.round(meta.origin[1] * scale + by * vbScale);
  const w = Math.round(bw * vbScale), h = Math.round(bh * vbScale);
  const border = [];
  for (let x = x0; x < x0 + w; x++) border.push(lum(img, x, y0), lum(img, x, y0 + h - 1));
  for (let y = y0; y < y0 + h; y++) border.push(lum(img, x0, y), lum(img, x0 + w - 1, y));
  border.sort((p, q) => p - q);
  const bg = border[border.length >> 1];
  let ink = 0, peak = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const dl = Math.abs(lum(img, x, y) - bg);
    ink += dl;
    peak = Math.max(peak, dl);
  }
  return { ink, peak };
}
const groups = new Map();
for (const c of meta.cells) {
  const sa = measure(a, c.box), sb = measure(b, c.box);
  const key = `${c.half.padEnd(8)} ${c.kind.padEnd(6)} w${c.width}`;
  const g = groups.get(key) ?? { ink: [], peak: [], detail: [] };
  g.ink.push(sb.ink / sa.ink);
  g.peak.push(sb.peak / Math.max(1, sa.peak));
  if (c.kind === "line") g.detail.push(`${c.angle}°:${(sb.ink / sa.ink).toFixed(2)}`);
  groups.set(key, g);
}
const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
for (const [key, g] of groups) console.log(`${key}  ink gpu/svg ${mean(g.ink).toFixed(3)}  peak ${mean(g.peak).toFixed(3)}  ${g.detail.join(" ")}`);
