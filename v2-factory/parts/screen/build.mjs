// Standalone page for the phone + speaker parts: the case with the display floating above it, beads dropping from the
// dispenser under the display into a catch tray inside the case, and the speaker under the display fed audio packets.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scene, page, k } from "../../shared/kit.mjs";
import * as phone from "./phone.mjs";
import * as speaker from "./speaker.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));

// a smaller case than the factory's (w 280 · d 540 · depth 280) so the machines in it read at this size
const CASEOPTS = { w: 200, d: 380, depth: 160, r: 34, cut: 34, displayZ: 330 };
const DISP = [84, 130];
const fit = [
  ...k.boxCorners({ x: -104, y: -194, w: 208, d: 388, r: 0 }, -8, CASEOPTS.depth),
  ...k.boxCorners({ x: -104, y: -194, w: 208, d: 388, r: 0 }, CASEOPTS.displayZ, CASEOPTS.displayZ + 6),
];
const ctx = scene({ W: 680, H: 900, fit, pad: 26 });
phone.build(ctx, [0, 0, 0], { id: "phone", ...CASEOPTS, dispenser: DISP });
phone.buildTray(ctx, [DISP[0], DISP[1], 0], { id: "tray", height: 64 });
speaker.build(ctx, [-30, -70, 0], { id: "speaker", height: 92 });

page(ctx, {
  out: join(HERE, "screen.html"),
  title: "Phone and speaker",
  fig: "Part",
  hint: "watch",
  readout: "starting",
  keys: [
    { mark: "lit", label: "Speaker cone: pumps once for every audio packet it swallows" },
    { mark: "raised", label: "Fluff dispenser under the display: sight tube, star valve, nozzle" },
  ],
  caption:
    "The factory lives inside the phone. The case lies open with its near walls cut down to a lip; the display floats above it, face up, with the React logo turning on it. Every few seconds a tap on the screen sends loose JS calls (blue beads) down into the sight tube under the display; the star valve lets one through at a time and it falls from the nozzle (here into a catch tray; in the factory onto belt A). Under the display sits the speaker, a bare driver facing up: mint audio packets slide into its throat (from the elevator in the factory, fed here every 1.6 s) and each one pumps the cone and the level LEDs.",
  live: [phone.LIVE, speaker.LIVE],
  boot: `FACTORY.define("phone", MACHINES.phone);
FACTORY.define("tray", MACHINES.catchTray);
FACTORY.define("speaker", MACHINES.speaker);
FACTORY.link("phone", "fluff", "tray", "in");
FACTORY.feed("speaker", "in", 1.6, () => FACTORY.item("audio"), 1.2);
FACTORY.readout(() => {
  const s = FACTORY.machines.phone;
  const p = FACTORY.machines.speaker;
  return s.queued + " queued · " + s.sent + " dropped · " + p.heard + " heard · level " + Math.round(p.level * 100) + "%";
});`,
});
