// slowed contact sheets of every hand-off between machines (drive.mjs actions)
import { writeFileSync } from "node:fs";
import { region } from "./mk.mjs";
const M = "window.FACTORY.machines";
const sheet = (name, slow, every, count, cols = 6, scale = 3, size = [150, 110]) => [
  ["slow", slow], ["sheet", `shots/sheet-${name}.png`, every, count, null, scale, region(name, ...size), cols], ["slow", 1],
];
const acts = [
  ["wait", 1500],
  ["until", `${M}.beltA.items().some((i) => i.run === "air")`, 20000], ...sheet("dispenser-A", 0.08, 250, 18, 6, 2),
  ["until", `${M}.beltA.items().some((i) => i.run === "top" && i.pos[0] > 52)`, 20000], ...sheet("A-packer", 0.1, 200, 18),
  ["until", `${M}.beltB.items().some((i) => i.run === "air")`, 40000], ...sheet("packer-B", 0.1, 200, 18),
  ["until", `${M}.beltB.items().some((i) => i.pos[1] > 12)`, 60000], ["eval", `window.__n = ${M}.beltB.items().length`],
  ["until", `${M}.beltB.items().length < window.__n`, 60000], ...sheet("B-centrifuge", 0.08, 200, 18),
  ["until", `${M}.centrifuge.status().phase === "in sync"`, 90000], ["wait", 300], ...sheet("centrifuge-audio", 0.1, 250, 24),
  ["until", `${M}.scanner.reads % 4 === 0 && ${M}.scanner.reads > 0`, 30000], ...sheet("scanner-D", 0.25, 250, 24, 6, 3, [170, 120]),
  ["until", `${M}.beltD.items().some((i) => i.pos[1] < -138)`, 60000], ...sheet("D-elevator", 0.1, 250, 18),
  ["eval", `window.__lifted = ${M}.elevator.lifted`],
  ["until", `${M}.elevator.lifted > window.__lifted`, 60000], ["wait", 1200], ...sheet("elevator-speaker", 0.15, 220, 24, 6, 3, [150, 130]),
  ["until", `${M}.beltC.items().some((i) => i.run === "air")`, 120000], ...sheet("audio-C", 0.08, 200, 18),
  ["until", `${M}.beltC.items().some((i) => i.pos[1] > 198)`, 30000], ...sheet("C-crusher", 0.1, 250, 24),
  ["eval", `${M}.crusher.stats().count + " disposed"`],
];
writeFileSync(new URL("./handoffs.json", import.meta.url), JSON.stringify(acts));
