// node tools/diff.mjs <a.png> <b.png> [--out diff.png] [--threshold 0.1] [--json]
//        [--crops "name:x,y,w,h;name2:x,y,w,h" --zoom 4 --sheet out/dir]   (crop boxes in image px of a/b)
// Pixelmatch both ways: default (anti-aliased pixels excluded, pixelmatch's own AA detector) and strict (includeAA).
// --crops writes for each box a side-by-side sheet [a | b | diff], nearest-neighbour upscaled by --zoom.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const [aPath, bPath] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const threshold = Number(opt("--threshold", "0.1"));
const read = (p) => PNG.sync.read(readFileSync(p));
let a = read(aPath);
let b = read(bPath);
if (a.width !== b.width || a.height !== b.height) {
  // Crop both to the common area (canvas device-pixel snapping can differ by a row).
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  console.warn(`size differs ${a.width}x${a.height} vs ${b.width}x${b.height} → comparing ${w}x${h}`);
  a = crop(a, 0, 0, w, h);
  b = crop(b, 0, 0, w, h);
}
function crop(img, x, y, w, h) {
  const out = new PNG({ width: w, height: h });
  for (let j = 0; j < h; j++) img.data.copy(out.data, j * w * 4, ((y + j) * img.width + x) * 4, ((y + j) * img.width + x + w) * 4);
  return out;
}
function zoom(img, k) {
  const out = new PNG({ width: img.width * k, height: img.height * k });
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
    const s = ((Math.floor(y / k) * img.width) + Math.floor(x / k)) * 4, d = (y * out.width + x) * 4;
    img.data.copy(out.data, d, s, s + 4);
  }
  return out;
}
const { width, height } = a;
const diff = new PNG({ width, height });
const loose = pixelmatch(a.data, b.data, diff.data, width, height, { threshold });
const strict = pixelmatch(a.data, b.data, null, width, height, { threshold, includeAA: true });
const total = width * height;
const report = {
  a: aPath, b: bPath, width, height, threshold,
  diffPixels: loose, diffPercent: +(100 * loose / total).toFixed(4),
  strictPixels: strict, strictPercent: +(100 * strict / total).toFixed(4),
};
const out = opt("--out");
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, PNG.sync.write(diff));
}
const crops = opt("--crops");
if (crops) {
  const k = Number(opt("--zoom", "4"));
  const dir = opt("--sheet", "out/gpu/crops");
  mkdirSync(dir, { recursive: true });
  report.crops = [];
  for (const spec of crops.split(";").filter(Boolean)) {
    const [name, box] = spec.split(":");
    const [x, y, w, h] = box.split(",").map(Number);
    const ca = crop(a, x, y, w, h), cb = crop(b, x, y, w, h);
    const cd = new PNG({ width: w, height: h });
    const n = pixelmatch(ca.data, cb.data, cd.data, w, h, { threshold });
    const gap = 4;
    const sheet = new PNG({ width: w * 3 * k + gap * 2, height: h * k });
    sheet.data.fill(255);
    [ca, cb, cd].forEach((img, i) => PNG.bitblt(zoom(img, k), sheet, 0, 0, w * k, h * k, i * (w * k + gap), 0));
    const file = join(dir, `${name}.png`);
    writeFileSync(file, PNG.sync.write(sheet));
    report.crops.push({ name, file, diffPixels: n, diffPercent: +(100 * n / (w * h)).toFixed(3) });
  }
}
if (args.includes("--json")) console.log(JSON.stringify(report));
else {
  console.log(`${width}x${height} threshold ${threshold}: ${loose} px (${report.diffPercent}%) differ · strict incl. AA ${strict} px (${report.strictPercent}%)`);
  for (const c of report.crops ?? []) console.log(`  crop ${c.name}: ${c.diffPixels} px (${c.diffPercent}%) → ${c.file}`);
}
