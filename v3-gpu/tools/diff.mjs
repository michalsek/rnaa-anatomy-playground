// Image comparison shared by the gates, and a CLI:
//   node tools/diff.mjs <a.png> <b.png> [--out diff.png] [--threshold 0.1] [--json]
//        [--crops "name:x,y,w,h;name2:x,y,w,h" --zoom 4 --sheet out/dir]   (crop boxes in image px of a/b)
// Three measures per pair: pixelmatch with its anti-aliasing detector ("loose": AA pixels excluded), pixelmatch with
// AA pixels counted ("withAA"), and "strict": any channel moved by more than STRICT_DELTA. Images of different sizes
// are refused: a one-row size difference is itself a defect (QA-M2 D1 hid behind silent cropping).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

export const PIXELMATCH_THRESHOLD = 0.1;
/** A pixel differs "strictly" when any channel moves by more than this (of 255). */
export const STRICT_DELTA = 8;
const DIFF_COLOR = [255, 0, 0];

export const readPng = (file) => PNG.sync.read(readFileSync(file));
const pngOf = (image) => (typeof image === "string" ? readPng(image) : image);

export function crop(image, x, y, width, height) {
  if (x < 0 || y < 0 || x + width > image.width || y + height > image.height) throw new Error(`crop ${x},${y},${width},${height} outside ${image.width}x${image.height}`);
  const out = new PNG({ width, height });
  for (let row = 0; row < height; row++) image.data.copy(out.data, row * width * 4, ((y + row) * image.width + x) * 4, ((y + row) * image.width + x + width) * 4);
  return out;
}

/** Nearest-neighbour upscale by an integer factor. */
export function zoom(image, factor) {
  const out = new PNG({ width: image.width * factor, height: image.height * factor });
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) {
      const source = (Math.floor(y / factor) * image.width + Math.floor(x / factor)) * 4;
      image.data.copy(out.data, (y * out.width + x) * 4, source, source + 4);
    }
  return out;
}

/** Largest 8-connected blob of set pixels in a width × height mask. */
export function largestCluster(mask, width, height) {
  const seen = new Uint8Array(mask.length);
  let largest = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let size = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      size++;
      const x = i % width;
      const y = (i - x) / width;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          const j = ny * width + nx;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && mask[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
    }
    largest = Math.max(largest, size);
  }
  return largest;
}

/** Pixels whose whole 3 × 3 neighbourhood is set: removes 1–2 px wide lines (hairline weight) but keeps areas. */
export function erode(mask, width, height) {
  const out = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      let all = 1;
      for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1 && all; dx++) all = mask[(y + dy) * width + x + dx];
      out[y * width + x] = all;
    }
  return out;
}

/**
 * Compares two equally sized images (PNG objects or file paths). `loosePct` / `withAAPct` / `strictPct` are percent
 * of the image; `looseCluster` is the largest connected blob of loose differences, `solidCluster` the largest blob
 * left after a 3 × 3 erosion: a missing or misplaced area survives it, AA noise and a hairline drawn a little lighter
 * or heavier (a long 1 px line of differences) do not. Writes the loose diff image to `diffFile` when given.
 */
export function compareImages(aImage, bImage, { diffFile, threshold = PIXELMATCH_THRESHOLD } = {}) {
  const a = pngOf(aImage);
  const b = pngOf(bImage);
  if (a.width !== b.width || a.height !== b.height) throw new Error(`size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  const { width, height } = a;
  const diff = new PNG({ width, height });
  const loose = pixelmatch(a.data, b.data, diff.data, width, height, { threshold, diffMask: true, diffColor: DIFF_COLOR });
  const withAA = pixelmatch(a.data, b.data, null, width, height, { threshold, includeAA: true });
  const looseMask = new Uint8Array(width * height);
  let strict = 0;
  for (let p = 0, i = 0; p < looseMask.length; p++, i += 4) {
    looseMask[p] = diff.data[i + 3] && diff.data[i] === DIFF_COLOR[0] && diff.data[i + 1] === DIFF_COLOR[1] && diff.data[i + 2] === DIFF_COLOR[2] ? 1 : 0;
    if (Math.abs(a.data[i] - b.data[i]) > STRICT_DELTA || Math.abs(a.data[i + 1] - b.data[i + 1]) > STRICT_DELTA || Math.abs(a.data[i + 2] - b.data[i + 2]) > STRICT_DELTA) strict++;
  }
  if (diffFile) {
    mkdirSync(dirname(diffFile), { recursive: true });
    writeFileSync(diffFile, PNG.sync.write(diff));
  }
  const pct = (n) => +((100 * n) / (width * height)).toFixed(4);
  return { width, height, loose, loosePct: pct(loose), withAA, withAAPct: pct(withAA), strict, strictPct: pct(strict), looseCluster: largestCluster(looseMask, width, height), solidCluster: largestCluster(erode(looseMask, width, height), width, height) };
}

/** [a | b | loose diff] side by side, each upscaled ×factor; returns the crop's own comparison. */
export function cropSheet(aImage, bImage, [x, y, width, height], factor, outFile, threshold = PIXELMATCH_THRESHOLD) {
  const ca = crop(pngOf(aImage), x, y, width, height);
  const cb = crop(pngOf(bImage), x, y, width, height);
  const cd = new PNG({ width, height });
  const differing = pixelmatch(ca.data, cb.data, cd.data, width, height, { threshold });
  const gap = 4;
  const sheet = new PNG({ width: width * 3 * factor + gap * 2, height: height * factor });
  sheet.data.fill(255);
  [ca, cb, cd].forEach((image, i) => PNG.bitblt(zoom(image, factor), sheet, 0, 0, width * factor, height * factor, i * (width * factor + gap), 0));
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, PNG.sync.write(sheet));
  return { file: outFile, loose: differing, loosePct: +((100 * differing) / (width * height)).toFixed(3) };
}

/** Crop specs "name:x,y,w,h;name:x,y,w,h" → [{ name, box }]. */
export const parseCrops = (spec) =>
  String(spec ?? "")
    .split(";")
    .filter(Boolean)
    .map((entry) => {
      const [name, box] = entry.split(":");
      const numbers = box?.split(",").map(Number) ?? [];
      if (numbers.length !== 4 || numbers.some((n) => !Number.isFinite(n))) throw new Error(`bad crop "${entry}" (want name:x,y,w,h)`);
      return { name, box: numbers };
    });

async function cli() {
  const { parseArgs } = await import("./harness.mjs");
  const options = parseArgs(["json"]);
  const [aPath, bPath] = options._;
  if (!aPath || !bPath) {
    console.error("usage: node tools/diff.mjs <a.png> <b.png> [--out diff.png] [--threshold 0.1] [--json] [--crops spec --zoom 4 --sheet dir]");
    process.exit(2);
  }
  const threshold = Number(options.threshold ?? PIXELMATCH_THRESHOLD);
  const a = readPng(aPath);
  const b = readPng(bPath);
  const report = { a: aPath, b: bPath, threshold, ...compareImages(a, b, { diffFile: options.out, threshold }) };
  const factor = Number(options.zoom ?? 4);
  const sheetDir = options.sheet ?? "out/tmp/crops";
  report.crops = parseCrops(options.crops).map(({ name, box }) => ({ name, ...cropSheet(a, b, box, factor, join(sheetDir, `${name}.png`), threshold) }));
  if (options.json) return console.log(JSON.stringify(report));
  console.log(`${report.width}x${report.height} threshold ${threshold}: loose ${report.loose} px (${report.loosePct}%, largest blob ${report.looseCluster}, solid ${report.solidCluster}) · incl. AA ${report.withAA} px (${report.withAAPct}%) · Δ>${STRICT_DELTA} ${report.strict} px (${report.strictPct}%)`);
  for (const c of report.crops) console.log(`  crop ${c.name}: ${c.loose} px (${c.loosePct}%) → ${c.file}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await cli();
  } catch (error) {
    console.error(String(error.message ?? error));
    process.exit(1);
  }
}
