// QA throwaway: two centrifuge instances at unusual origins (one lifted in z) on one page, fed directly.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scene, page } from "../../../shared/kit.mjs";
import { build, LIVE, CSS } from "../centrifuge.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const O1 = [-140, 230, 0];
const O2 = [60, 40, 0];
const fit = [];
for (const [ox, oy, oz] of [O1, O2]) for (const [x, y, z] of [[-45, -35, 0], [60, -35, 0], [-45, 40, 0], [60, 40, 0], [0, -30, 190], [50, 0, 185]]) fit.push([ox + x, oy + y, oz + z]);
const ctx = scene({ W: 900, H: 760, pad: 30, fit });
build(ctx, O1, { id: "cfA" });
build(ctx, O2, { id: "cfB" });
page(ctx, {
  out: join(HERE, "origin.html"),
  title: "Centrifuge origin test",
  fig: "QA",
  hint: "two instances",
  readout: "",
  css: CSS,
  live: [LIVE],
  boot: `
FACTORY.define("cfA", MACHINES.centrifuge);
FACTORY.define("cfB", MACHINES.centrifuge);
window.__out = { cfA: [], cfB: [] };
for (const id of ["cfA", "cfB"]) FACTORY.onEmit(id, "out", (item, from) => window.__out[id].push(from));
FACTORY.feed("cfA", "in", 0.7, () => FACTORY.item("control"));
FACTORY.feed("cfB", "in", 1.1, () => FACTORY.item("graph"), 2);
FACTORY.readout(() => { const a = FACTORY.machines.cfA.status(), b = FACTORY.machines.cfB.status(); return "A " + a.held + " " + a.phase + " · B " + b.held + " " + b.phase; });`,
  caption: "QA only.",
});
