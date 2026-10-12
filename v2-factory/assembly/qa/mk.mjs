// helpers: card-px regions around each junction, and drive action lists
import { readFileSync, writeFileSync } from "node:fs";
const { pairs } = JSON.parse(readFileSync(new URL("./ports.json", import.meta.url)));
const OX = 24, OY = 52, S = 1.0133;
// a card-px box round both ends of a hand-off, padded, at least w × h
export const region = (name, w = 130, h = 100, pad = 34) => {
  const xs = pairs[name].map((p) => OX + p.vb[0] * S);
  const ys = pairs[name].map((p) => OY + p.vb[1] * S);
  const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
  const ww = Math.max(w, x1 - x0), hh = Math.max(h, y1 - y0);
  return [Math.round((x0 + x1) / 2 - ww / 2), Math.round((y0 + y1) / 2 - hh / 2), Math.round(ww), Math.round(hh)];
};
export const names = Object.keys(pairs);
const mode = process.argv[2];
if (mode === "zooms") {
  const theme = process.argv[3] ?? "light";
  const acts = [["wait", Number(process.argv[4] ?? 20000)]];
  for (const n of names) acts.push(["shot", `shots/z-${n.replace(/[→ ]/g, "-")}-${theme}.png`, null, 4, region(n)]);
  writeFileSync(new URL(`./zooms-${theme}.json`, import.meta.url), JSON.stringify(acts));
}
if (mode === "timed") {
  const acts = [["wait", 3000]];
  for (let t = 3; t <= 33; t += 5) acts.push(["shot", `shots/t-${String(t).padStart(2, "0")}s.png`, null, 1], ["wait", 4800]);
  writeFileSync(new URL("./timed.json", import.meta.url), JSON.stringify(acts));
}
if (mode === "region") console.log(JSON.stringify(region(process.argv[3], Number(process.argv[4] ?? 130), Number(process.argv[5] ?? 100))));
