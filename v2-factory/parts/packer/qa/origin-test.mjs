// Throwaway QA page: two packers at different origins (and ids) in one scene.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scene, page, k } from "../../../shared/kit.mjs";
import { build, LIVE, CSS, ANCHOR } from "../packer.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const A0 = ANCHOR;
const B0 = [ANCHOR[0] + 75, ANCHOR[1] + 95, 40];
const box = (o) => [...k.boxCorners({ x: o[0] - 32, y: o[1] - 34, w: 64, d: 58, r: 0 }, o[2], o[2] + 250)];
const ctx = scene({ W: 760, H: 900, fit: [...box(A0), ...box(B0)], pad: 20 });
build(ctx, A0, { id: "pkA" });
build(ctx, B0, { id: "pkB" });
page(ctx, {
  out: join(HERE, "origin-test.html"), title: "Packer origin test", fig: "QA", hint: "pkA at ANCHOR · pkB at ANCHOR + [75, 95, 40]", readout: "",
  live: [LIVE], css: CSS,
  boot: `FACTORY.define("pkA", MACHINES.packer); FACTORY.define("pkB", MACHINES.packer);
FACTORY.feed("pkA", "in", 0.9, () => FACTORY.item("fluff"), 0.1);
FACTORY.feed("pkB", "in", 0.9, () => FACTORY.item("fluff"), 0.5);
const sink = {}; for (const id of ["pkA", "pkB"]) FACTORY.onEmit(id, "out", (item, from) => (sink[id] = (sink[id] ?? []).concat([[item.kind, from.map((v) => Math.round(v * 10) / 10)]])));
window.__sink = sink;
FACTORY.readout(() => { const a = FACTORY.machines.pkA.stats(), b = FACTORY.machines.pkB.stats(); return "A " + a.beads + "/" + a.packets + " · B " + b.beads + "/" + b.packets; });`,
});
