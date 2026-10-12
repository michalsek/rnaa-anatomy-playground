// QA throwaway (not part of the build): proves the conveyor kind is parametric in axis, dir, length, top, width.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scene, page, k } from "../../../shared/kit.mjs";
import { build, LIVE } from "../conveyor.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const T1 = { id: "ty", type: "top", axis: "y", dir: -1, length: 100, top: 70, width: 14, inAt: 30, outAt: -60 };
const T2 = { id: "tx", type: "top", axis: "x", dir: 1, length: 90, top: 36, width: 18, inAt: 50, outAt: 130 };
const L1 = { id: "ly", type: "loop", axis: "y", dir: 1, length: 140, top: 60, width: 16, drum: 12, inAt: -50, readAt: 20 };
const fit = [
  ...k.boxCorners({ x: -30, y: -90, w: 60, d: 140, r: 0 }, 0, 80),
  ...k.boxCorners({ x: 20, y: 10, w: 130, d: 40, r: 0 }, 0, 44),
  ...k.boxCorners({ x: -150, y: -80, w: 120, d: 180, r: 0 }, 0, 70),
];
const ctx = scene({ W: 860, H: 600, fit, pad: 22 });
build(ctx, [0, -60, 0], T1);
build(ctx, [40, 30, 0], T2);
build(ctx, [-90, -60, 0], L1);
const boot = `
window.FACTORY = FACTORY;
FACTORY.define("ty", MACHINES.conveyor);
FACTORY.define("tx", MACHINES.conveyor);
FACTORY.define("ly", MACHINES.conveyor);
const MIX = ["control", "graph", "data", "garbage"];
let n = 0;
FACTORY.feed("ty", "in", 1.6, () => FACTORY.item(MIX[n++ % 4]), 0.3);
FACTORY.feed("tx", "in", 1.9, () => FACTORY.item(MIX[n++ % 4]), 0.6);
FACTORY.feed("ly", "in", 1.3, () => FACTORY.item(MIX[n++ % 3]), 0.4);
window.__out = [];
for (const [id, port] of [["ty","out"],["tx","out"],["ly","drop"]]) FACTORY.onEmit(id, port, (item, from) => window.__out.push([id, item.kind, from.map((v) => Math.round(v * 10) / 10), item.v ? item.v.map((v) => Math.round(v)) : null]));
FACTORY.readout(() => window.__out.length + " out");`;
page(ctx, { out: join(HERE, "param.html"), title: "Conveyor params", fig: "QA", hint: "", readout: "", live: [LIVE], boot, caption: "QA throwaway." });
