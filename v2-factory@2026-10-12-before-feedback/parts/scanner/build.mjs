import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scene, page, k } from "../../shared/kit.mjs";
import * as scanner from "./scanner.mjs";
import * as elevator from "./elevator.mjs";
import * as stubs from "./stubs.mjs";
import * as conveyor from "../conveyor/conveyor.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));

const LIFT = 210;
// Placement (relative): scanner origin = audio origin + [90, −38, 0]; the elevator sits under belt D's far end.
const AUDIO = [-120, 70, 0];
const S = [AUDIO[0] + 90, AUDIO[1] - 38, 0];
const E = [-107, -123, 0];
const fit = [
  ...k.boxCorners({ x: -122, y: -150, w: 50, d: 54, r: 0 }, 0, 24 + LIFT + 34),
  ...k.boxCorners({ x: -122, y: -188, w: 30, d: 40, r: 0 }, 0, 24 + LIFT + 14),
  ...k.boxCorners({ x: AUDIO[0] - 16, y: AUDIO[1] - 12, w: 202, d: 26, r: 0 }, 0, 96),
  ...k.boxCorners({ x: S[0] - 86, y: S[1] - 26, w: 110, d: 58, r: 0 }, 0, 105),
];
const ctx = scene({ W: 640, H: 760, fit, pad: 22 });
conveyor.build(ctx, AUDIO, { id: "audio", type: "loop", axis: "x", dir: -1, length: 170, top: 92, readAt: S[0] - AUDIO[0] }); // readAt is a distance along the belt
scanner.build(ctx, S, { id: "scanner", belt: "audio" });
elevator.build(ctx, E, { id: "elevator", lift: LIFT, outDir: "-y", outReach: 14 });
stubs.buildBeltDStub(ctx, "beltD", ctx.data.scanner.ports.out, ctx.data.elevator.ports.in);
stubs.buildSpeakerStub(ctx, "speaker", ctx.data.elevator.ports.out);
ctx.material = "";

const boot = `
FACTORY.define("audio", MACHINES.conveyor);
FACTORY.feed("audio", "in", 2.2, () => FACTORY.item(["control", "graph", "data"][Math.floor(Math.random() * 3)]), 0.3);
FACTORY.define("scanner", MACHINES.scanner);
FACTORY.define("beltD", MACHINES.beltDStub);
FACTORY.define("elevator", MACHINES.elevator);
FACTORY.define("speaker", MACHINES.speakerStub);
FACTORY.link("scanner", "out", "beltD", "in");
FACTORY.link("beltD", "out", "elevator", "in");
FACTORY.link("elevator", "out", "speaker", "in");
FACTORY.readout(() => {
  const s = FACTORY.machines.scanner, e = FACTORY.machines.elevator;
  return "quanta read " + s.reads.toLocaleString("en-US") + " · packets lifted " + e.lifted.toLocaleString("en-US");
});`;

page(ctx, {
  out: join(HERE, "scanner.html"),
  title: "Read arm and bucket elevator",
  fig: "Part",
  hint: "One read per cleat · 4 per packet",
  readout: "quanta read 0 · packets lifted 0",
  keys: [
    { mark: "lit", label: "status lamp" },
    { mark: "raised", label: "audio packet" },
  ],
  caption:
    "The platform audio callback (CoreAudio / Oboe) reads each finished 128-frame render quantum, one cleat gap of the audio belt: the read head tracks one cleat, flies back to the next, and sends a pulse down the flex cable. Four quanta fill one 512-frame device buffer, which leaves the preamp as one packet and rides the bucket elevator up to the speaker.",
  live: [conveyor.LIVE, scanner.LIVE, stubs.BELTD_STUB_LIVE, elevator.LIVE, stubs.SPEAKER_STUB_LIVE],
  boot,
  audit: {},
});
