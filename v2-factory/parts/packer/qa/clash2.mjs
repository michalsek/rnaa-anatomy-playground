import { simulate } from "./sim.mjs";
const r = simulate({ seconds: 9 });
const OZ = -150;
for (const s of r.poses) {
  const ph = s.picker.phase;
  if (!["carry", "return"].includes(ph)) continue;
  const W = s.picker.W;
  const cupBottom = W[2] - 12.6 - OZ, barBottom = W[2] - 9 - OZ;
  // cups at x W-5..W+5 (±1.35)
  const xmin = W[0] - 6.35, xmax = W[0] + 6.35;
  const overGutter = xmin < 95.8 && W[1] + 1.35 > -121.6 && W[1] - 1.35 < -114.4;
  const under = cupBottom < 231.6 && overGutter;
  if (Math.round(s.t * 60) % 3 === 0) console.log(s.t.toFixed(2), ph.padEnd(7), "W", W.map((v, i) => (i == 2 ? v - OZ : v).toFixed(1)).join(","), "cups", cupBottom.toFixed(1) + "…" + barBottom.toFixed(1), "x", xmin.toFixed(1) + "…" + xmax.toFixed(1), under ? "<< IN GUTTER BAND (wall top 231.6, floor 226.6)" : "");
}
