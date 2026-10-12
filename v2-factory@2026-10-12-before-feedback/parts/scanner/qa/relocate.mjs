// QA throwaway (not part of the build): scanner + elevator at another origin, lift 180 / outDir "-x",
// reading the REAL audio belt (parts/conveyor) through an adapter. Usage:
//   node qa/relocate.mjs [slats|cleats|none] [oz]
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scene, page, k } from "../../../shared/kit.mjs";
import * as scanner from "../scanner.mjs";
import * as elevator from "../elevator.mjs";
import * as stubs from "../stubs.mjs";
import * as conveyor from "../../conveyor/conveyor.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const MODE = process.argv[2] ?? "slats";
const OZ = Number(process.argv[3] ?? 0);

const BRIEF = process.env.PLACE === "brief";
const S = BRIEF ? [-30, 36, 0] : [30, -20, OZ];            // scanner origin (pivot foot)
const BELT_Y = S[1] + 38;           // audio belt centre: head (local y +30.5) over the far margin (edge + 1.5)
const OUT = [S[0] - 77, S[1] + 8, 24];
const LIFT = 180;
const E = [OUT[0], -124, 0];        // elevator origin; its in port = E + [0, 39, 24]

const fit = [
  ...k.boxCorners({ x: BRIEF ? -150 : -60, y: BELT_Y - 16, w: BRIEF ? 250 : 160, d: 32, r: 0 }, 0, 100 + OZ),
  ...k.boxCorners({ x: S[0] - 90, y: S[1] - 30, w: 120, d: 60, r: 0 }, 0, 102 + OZ),
  ...k.boxCorners({ x: E[0] - 50, y: E[1] - 60, w: 90, d: 110, r: 0 }, 0, 24 + LIFT + 60),
];
const ctx = scene({ W: 640, H: 760, fit, pad: 22 });
conveyor.build(ctx, BRIEF ? [-130, 74, 0] : [-50, BELT_Y, 0], { id: "audio", type: "loop", axis: "x", dir: -1, length: BRIEF ? 216 : 140, top: 92 + OZ, inAt: 70, readAt: S[0] });
scanner.build(ctx, S, { id: "scanner" });

// belt D stand-in (same as stubs.buildBeltDStub, but placed from the ports)
{
  const id = "beltD", n = (s) => `${id}.${s}`;
  const X = OUT[0], Y0 = E[1] + 39 + 1, Y1 = OUT[1] - 2, Z = 24;
  ctx.material = "";
  for (let y = Y1 - 6; y > Y0 + 4; y -= 30) for (const x of [X - 7.4, X + 6.4]) ctx.box(n("leg"), [x, y - 1, 0], [x + 1, y + 1, Z - 5], { tone: "lo" }, { r: 0.2 });
  ctx.box(n("rail"), [X - 7.4, Y0, Z - 5], [X - 6, Y1, Z], { tone: "mid" }, { r: 0.3 });
  ctx.box(n("belt"), [X - 6, Y0, Z - 1], [X + 6, Y1, Z], { tone: "mid" }, { r: 0.2, inner: "" });
  ctx.slot(`${id}:items`, { after: n("belt") });
  ctx.box(n("rail"), [X + 6, Y0, Z - 5], [X + 7.4, Y1, Z], { tone: "mid" }, { r: 0.3 });
  ctx.data[id] = { x: X, y0: Y0, y1: Y1, z: Z, speed: 20 };
}
elevator.build(ctx, E, { id: "elevator", lift: LIFT, outDir: "-x", outReach: 16 });
stubs.buildSpeakerStub(ctx, "speaker", ctx.data.elevator.ports.out);
ctx.material = "";

const ADAPTERS = {
  none: "",
  // every slat of the top run, at the belt's own pitch (3)
  slats: `
(() => {
  const belt = FACTORY.machines.audio, g = belt.geometry();
  const sTail = g.dir > 0 ? 0 : g.L;
  belt.pitch = g.pitch;
  belt.slats = () => {
    const travel = belt.slatPhase() * g.pitch, phase = ((travel % g.pitch) + g.pitch) % g.pitch, out = [];
    for (let u = phase; u < g.L; u += g.pitch) out.push(g.origin[0] + sTail + g.dir * u);
    return out;
  };
})();`,
  // only the cleats (every cleatEvery slats; true cleat gap = loop length / cleat count)
  cleats: `
(() => {
  const belt = FACTORY.machines.audio, g = belt.geometry();
  const sTail = g.dir > 0 ? 0 : g.L;
  const total = 2 * g.L + 2 * Math.PI * g.RW, n = Math.floor(total / (g.pitch * g.cleatEvery)), gap = total / n;
  belt.pitch = gap;
  belt.slats = () => {
    const travel = belt.slatPhase() * g.pitch, out = [];
    for (let i = 0; i < n; i++) { const u = (((i * gap + travel) % total) + total) % total; if (u < g.L) out.push(g.origin[0] + sTail + g.dir * u); }
    return out;
  };
})();`,
};

const boot = `
FACTORY.define("audio", MACHINES.conveyor);
${ADAPTERS[MODE]}
FACTORY.define("scanner", MACHINES.scanner);
FACTORY.define("beltD", MACHINES.beltDStub);
FACTORY.define("elevator", MACHINES.elevator);
FACTORY.define("speaker", MACHINES.speakerStub);
FACTORY.link("scanner", "out", "beltD", "in");
FACTORY.link("beltD", "out", "elevator", "in");
FACTORY.link("elevator", "out", "speaker", "in");
const KINDS = ["control", "graph", "data"];
let fed = 0;
FACTORY.feed("audio", "in", 1.6, () => FACTORY.item(KINDS[fed++ % 3]), 0.2);
FACTORY.readout(() => {
  const s = FACTORY.machines.scanner, e = FACTORY.machines.elevator;
  return "reads " + s.reads + " · packets " + s.packets + " · lifted " + e.lifted + " · t " + FACTORY.machines.speaker.received;
});`;

page(ctx, {
  out: join(HERE, `relocate-${BRIEF ? "brief-" : ""}${MODE}${OZ ? "-z" + OZ : ""}.html`),
  title: "QA relocate",
  fig: "QA",
  hint: `adapter: ${MODE}`,
  readout: "",
  live: [conveyor.LIVE, scanner.LIVE, stubs.BELTD_STUB_LIVE, elevator.LIVE, stubs.SPEAKER_STUB_LIVE],
  boot,
  audit: {},
});
