// v2a: the pre-feedback assembly (tall far walls, card with legend and caption, no explode). Kept reachable as
// factory-v2a.html; the current version is build.mjs → factory.html.
// The audio factory, assembled: every machine inside the phone case, the display floating above it with its animated
// React screen. One loop, top → bottom → top: fluff drops from under the display onto belt A (high), the packer boxes
// it onto belt B, the centrifuge (the lock-free rings) holds packets until it is in sync with the audio belt (the render
// loop, low), spent packets fall onto belt C and into the crusher (the Disposer); the scanner reads each quantum off the
// audio belt, belt D carries the device buffers to the elevator, which lifts them back up to the speaker under the screen.
//
// Every machine is placed by translation only; dependent positions are derived from the parts' own ports, so the
// table in NOTES.md is the single place the layout is chosen (LAYOUT below).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scene, page, k } from "../shared/kit.mjs";
import * as phone from "../parts/screen/phone.mjs";
import * as speaker from "../parts/screen/speaker.mjs";
import * as conveyor from "../parts/conveyor/conveyor.mjs";
import * as packer from "../parts/packer/packer.mjs";
import * as centrifuge from "../parts/centrifuge/centrifuge.mjs";
import * as crusher from "../parts/crusher/crusher.mjs";
import * as scanner from "../parts/scanner/scanner.mjs";
import * as elevator from "../parts/scanner/elevator.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- layout (case frame: origin = centre of the case floor)
const CASE = { w: 360, d: 760, r: 44, depth: 280, cut: 40, displayZ: 560, displayShift: [-80, -24], neck: 72 };
const PACKER = [100, -190, 0]; // floor under the lane axis on the gutter line
const AUDIO_Y = 120; // the render loop runs low across the front half
const CENTRI = [100, AUDIO_Y - 51.2, 0]; // its spout hangs over the audio belt // axis on the floor; belt B runs between the packer's lane nose and the funnel
const AUDIO_HEAD = -90; // x of the audio belt's head drum (garbage drops here onto belt C)
const SCANNER_X = 30; // pivot x; the elevator stands under belt D's far end at scanner x − 77
const ELEV_Y = -226; // clear of the centrifuge on screen (u = x − y well apart)
const BELT_C_LEN = 110;
const DISPENSER_X = 20; // over belt A's intake
const SPEAKER_LEDGE = 205; // z of the speaker's feed ledge, under the elevator's down-spout

// the belts, all relative: inAt / outAt / readAt are distances along the belt from its origin
const beltA = { id: "beltA", type: "top", axis: "x", dir: 1, top: 232, width: 20 };
const beltAOrigin = [-4, PACKER[1], 0];
beltA.length = PACKER[0] - 43 - beltAOrigin[0]; // head drum clear of the packer's deck (rails run 7 past it)
Object.assign(beltA, { inAt: DISPENSER_X - beltAOrigin[0], outAt: beltA.length, tip: false });

const beltBOrigin = [PACKER[0], PACKER[1] + 32, 0]; // rails start clear of the packer's front tab
const beltB = { id: "beltB", type: "top", axis: "y", dir: 1, top: 192, width: 18, inAt: 2, tip: false };
beltB.length = CENTRI[1] - 49 - beltBOrigin[1]; // head drum + rails stop before the funnel lip (and its legs clear the coolant pipe)
beltB.outAt = beltB.length;

const W = 900;
const H = 1020;
const fit = [
  ...k.boxCorners({ x: -CASE.w / 2, y: -CASE.d / 2, w: CASE.w, d: CASE.d, r: 0 }, -8, CASE.depth),
  ...k.boxCorners({ x: -CASE.w / 2 + CASE.displayShift[0], y: -CASE.d / 2 + CASE.displayShift[1], w: CASE.w, d: CASE.d, r: 0 }, CASE.displayZ, CASE.displayZ + 6),
];
const ctx = scene({ W, H, fit, pad: 30, floorZ: -8 });

phone.build(ctx, [0, 0, 0], { id: "phone", ...CASE, dispenser: [DISPENSER_X, PACKER[1]], fullRecord: true });
conveyor.build(ctx, beltAOrigin, beltA);
packer.build(ctx, PACKER, { id: "packer", prefill: true });
conveyor.build(ctx, beltBOrigin, beltB);
centrifuge.build(ctx, CENTRI, { id: "centrifuge" });

const OUT = ctx.data.centrifuge.ports.out; // in front of the stand, over the audio belt
const audioOrigin = [AUDIO_HEAD, OUT[1], 0];
const audio = { id: "audio", type: "loop", axis: "x", dir: -1, top: 92, drum: 15, length: OUT[0] + 12 - AUDIO_HEAD, inAt: OUT[0] - AUDIO_HEAD, readAt: SCANNER_X - AUDIO_HEAD };
conveyor.build(ctx, audioOrigin, audio);

const SCANNER = [SCANNER_X, audioOrigin[1] - 38, 0];
scanner.build(ctx, SCANNER, { id: "scanner", belt: "audio" });
const sOut = ctx.data.scanner.ports.out; // packet bottom-centre on the preamp's lip (lip starts 4 nearer the belt)
const beltDTail = sOut[1] - 4 - 8; // tail drum + rails clear of the lip
const BELT_D_LEN = beltDTail - (ELEV_Y + 51);
const beltDOrigin = [sOut[0], beltDTail - BELT_D_LEN, 0];
const beltD = { id: "beltD", type: "top", axis: "y", dir: -1, top: 24, width: 18, speed: 28, length: BELT_D_LEN, inAt: BELT_D_LEN - 4, outAt: 0, tip: false };
conveyor.build(ctx, beltDOrigin, beltD);
const ELEV = [sOut[0], beltDOrigin[1] - 51, 0]; // chute mouth 12 past belt D's head drum
elevator.build(ctx, ELEV, { id: "elevator", lift: 210, outDir: "-y", outReach: 40 }); // a long duct carries the spout out past the head on screen
const spout = ctx.data.elevator.ports.out;
// the packet lands 5 in from the ledge end; the spout sits 3 further out (the speaker's base clears the elevator's post bases)
speaker.build(ctx, [spout[0] - 62, spout[1], 0], { id: "speaker", height: SPEAKER_LEDGE + 15 });

const beltCOrigin = [AUDIO_HEAD, audioOrigin[1] - 22, 0];
const beltC = { id: "beltC", type: "top", axis: "y", dir: 1, top: 40, length: BELT_C_LEN, inAt: 22, outAt: BELT_C_LEN, tip: false };
conveyor.build(ctx, beltCOrigin, beltC);
const CRUSHER = [AUDIO_HEAD, beltCOrigin[1] + BELT_C_LEN + 30, 0]; // belt C (and its rails) end before the hopper's back lip
crusher.build(ctx, CRUSHER, { id: "crusher" });

export const LAYOUT = { CASE, PACKER, CENTRI, beltAOrigin, beltA, beltBOrigin, beltB, audioOrigin, audio, SCANNER, beltDOrigin, beltD, ELEV, SPEAKER: [spout[0] - 62, spout[1], 0], beltCOrigin, beltC, CRUSHER };
if (process.argv.includes("--layout")) console.log(JSON.stringify(LAYOUT, null, 1));

// ---------------------------------------------------------------- page
const ASSEMBLY_LIVE = String.raw`
// Space / Enter / click: a tap on the screen. The display dips and springs back, and the screen sends a burst of calls.
MACHINES.tapper = (api) => {
  const nodes = api.els('[data-name^="phone.display"],[data-name^="phone.feed"],[data-slot^="phone:"]');
  let x = 0;
  let v = 0;
  let active = false;
  const draw = () => {
    const tr = Math.abs(x) < 1e-3 ? "" : translateAlong(api.P, [0, 0, x]);
    for (const n of nodes) n.setAttribute("transform", tr);
  };
  return {
    tap() {
      FACTORY.machines.phone.tap();
      if (api.calm()) return;
      v -= 26;
      active = true;
    },
    tick(dt) {
      if (!active) return;
      // a damped spring (ω 14, ζ 0.45), sub-stepped
      for (let i = 0; i < 4; i++) {
        const h = dt / 4;
        v += (-196 * x - 12.6 * v) * h;
        x += v * h;
      }
      if (Math.abs(x) < 5e-4 && Math.abs(v) < 5e-3) { x = 0; v = 0; active = false; }
      draw();
    },
  };
};`;

const boot = `
const M = FACTORY.machines;
FACTORY.define("phone", MACHINES.phone);
FACTORY.define("beltA", MACHINES.conveyor);
FACTORY.define("packer", MACHINES.packer);
FACTORY.define("beltB", MACHINES.conveyor);
FACTORY.define("centrifuge", MACHINES.centrifuge);
FACTORY.define("audio", MACHINES.conveyor);
FACTORY.define("beltC", MACHINES.conveyor);
FACTORY.define("crusher", MACHINES.crusher);
FACTORY.define("scanner", MACHINES.scanner);
FACTORY.define("beltD", MACHINES.conveyor);
FACTORY.define("elevator", MACHINES.elevator);
FACTORY.define("speaker", MACHINES.speaker);
FACTORY.define("tapper", MACHINES.tapper);
FACTORY.link("phone", "fluff", "beltA", "in");
FACTORY.link("beltA", "out", "packer", "in");
FACTORY.link("packer", "out", "beltB", "in");
FACTORY.link("beltB", "out", "centrifuge", "in");
FACTORY.link("centrifuge", "out", "audio", "in");
FACTORY.link("audio", "drop", "beltC", "in");
FACTORY.link("beltC", "out", "crusher", "in");
FACTORY.link("scanner", "out", "beltD", "in");
FACTORY.link("beltD", "out", "elevator", "in");
FACTORY.link("elevator", "out", "speaker", "in");
// the rings drain one packet per quantum, in phase with the audio belt's cleats
M.centrifuge.syncTo(() => M.audio.quanta(), M.audio.quanta().period);
// and only into a free cleat: a packet with no room under the spout rides the ring round again
M.centrifuge.releaseWhen((lead) => M.audio.canTake(lead));
// backpressure: belt B holds its front packet at the roller while the funnel's throat is full
M.beltB.hold = () => !M.centrifuge.canAccept();
// live and true: one cleat gap past the read point = one 128-frame quantum (375 a second at 48 kHz in the engine)
FACTORY.readout(() => {
  const q = M.audio.quanta();
  const s = M.audio.stats();
  const c = M.centrifuge.status();
  const onBelts = ["beltB", "beltC", "beltD"].reduce((n, id) => n + M[id].items().length, 0);
  const flight = onBelts + s.riding + s.hanging + c.held;
  return q.count.toLocaleString("en-US") + " quanta · " + (1 / q.period).toFixed(2) + "/s (375/s real) · " + flight + " in flight · " + M.crusher.stats().count + " disposed";
});
const stage = FACTORY.stage;
stage.setAttribute("aria-label", "Inside a React Native app: an audio factory in a phone. Press Space or Enter, or click, to tap the screen and send a burst of JavaScript calls.");
const tap = () => M.tapper.tap();
stage.addEventListener("click", tap);
stage.addEventListener("keydown", (e) => {
  if (e.key === " " || e.key === "Enter") { e.preventDefault(); tap(); }
});
stage.addEventListener("focus", () => FACTORY.machines.phone && (document.querySelector("[data-status]").textContent = "The factory is running: JavaScript calls are packed, queued in the rings and rendered one quantum at a time."));
window.FACTORY = FACTORY;`;

const KEY_CSS = `
.iso-swatch[data-mark^="pk-"] path{stroke-width:6px;stroke-linecap:round;vector-effect:none}
.iso-swatch[data-mark="pk-fluff"] path{stroke:var(--fx-react);stroke-dasharray:.01 40;stroke-dashoffset:-6.5}
.iso-swatch[data-mark="pk-control"] path{stroke:var(--pk-control-face)}
.iso-swatch[data-mark="pk-graph"] path{stroke:var(--pk-graph-face)}
.iso-swatch[data-mark="pk-data"] path{stroke:var(--pk-data-s1)}
.iso-swatch[data-mark="pk-audio"] path{stroke:var(--pk-audio-face)}
.iso-swatch[data-mark="pk-garbage"] path{stroke:var(--pk-garbage-face)}
.fx-stage{cursor:pointer}
@media (max-width:560px){.iso-plate-corner[data-corner="readout"]{left:12px;white-space:normal;text-align:right;line-height:1.35}.iso-plate-corner[data-corner="hint"]{bottom:44px}}`;

page(ctx, {
  out: join(HERE, "factory-v2a.html"),
  title: "Inside a React Native app",
  fig: "Fig 3",
  hint: "Space or click taps the screen",
  readout: "0 quanta",
  css: centrifuge.CSS + crusher.CSS + packer.CSS + KEY_CSS,
  keys: [
    { mark: "pk-fluff", label: "JS call" },
    { mark: "pk-control", label: "control event" },
    { mark: "pk-graph", label: "graph change" },
    { mark: "pk-data", label: "data hand-over" },
    { mark: "pk-audio", label: "device buffer" },
    { mark: "pk-garbage", label: "spent, to the Disposer" },
    { mark: "lit", label: "each machine's lamp or accent" },
  ],
  caption:
    "How react-native-audio-api turns JavaScript calls into sound. Calls (blue beads) fall from the screen and are packed into fixed-size closures (72 bytes each): blue control events for the event scheduler (parameters, start, stop), amber graph changes (connect, disconnect), white buffers handed over. The centrifuge stands for the lock-free single-producer rings (1,024 slots in the engine): packets wait there until the audio thread drains them at the next render quantum, and nothing on either side waits on a lock. The audio belt is the render loop: each cleat-to-cleat segment is one 128-frame quantum, 375 a second at 48 kHz (shown here far slower). The scanner is the platform audio callback (CoreAudio or Oboe) reading every finished quantum; four quanta make one 512-frame device buffer, one mint packet, which the elevator lifts to the speaker. What the audio thread swaps out turns grey and rides belt C to the crusher, the Disposer thread, so nothing is freed on the audio thread.",
  live: [phone.LIVE, speaker.LIVE, conveyor.LIVE, packer.LIVE, centrifuge.LIVE, crusher.LIVE, scanner.LIVE, elevator.LIVE, ASSEMBLY_LIVE],
  boot,
  // part-internal pairs that only cross the crowding threshold at this smaller scale; each read clean at 8× (qa/crowd.json)
  audit: {
    crowd: [
      ["packer.hose.pushB", "packer.mag.post"],
      ["packer.cable.picker", "packer.bridge.post.1"],
      ["packer.cable.picker", "packer.picker.pedestal.2"],
      ["crusher.ctl.eye", "crusher.hopper.left"],
    ],
  },
});

const broken = crusher.checkOrder(ctx, "crusher", [...crusher.orderRules("crusher"), ["beltC.wrap1", "@item"]]);
if (broken.length) {
  console.error("painter order broken:\n  " + broken.join("\n  "));
  process.exitCode = 1;
} else console.log("crusher order rules hold");

// junction points (viewBox coordinates) for the verification scripts in qa/: both ends of every hand-off
if (process.argv.includes("--ports")) {
  const D = ctx.data;
  const pairs = {
    "dispenser-A": [D.phone.ports.fluff, D.beltA.ports.in], "A-packer": [D.beltA.ports.out, D.packer.ports.in], "packer-B": [D.packer.ports.out, D.beltB.ports.in],
    "B-centrifuge": [D.beltB.ports.out, D.centrifuge.ports.in], "centrifuge-audio": [D.centrifuge.ports.out, D.audio.ports.in], "audio-C": [D.audio.ports.drop, D.beltC.ports.in],
    "C-crusher": [D.beltC.ports.out, D.crusher.ports.in], "scanner-D": [D.scanner.ports.out, D.beltD.ports.in], "D-elevator": [D.beltD.ports.out, D.elevator.ports.in],
    "elevator-speaker": [D.elevator.ports.out, D.speaker.ports.in], "scanner-read": [D.scanner.ports.read, D.audio.ports.read],
  };
  const r1 = (v) => Math.round(v * 10) / 10;
  const out = Object.fromEntries(Object.entries(pairs).map(([n, ps]) => [n, ps.map((p) => ({ world: p.map(r1), vb: ctx.at(p).map(r1) }))]));
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(join(HERE, "qa"), { recursive: true });
  writeFileSync(join(HERE, "qa", "ports-v2a.json"), JSON.stringify({ W, H, pairs: out }, null, 1));
}
