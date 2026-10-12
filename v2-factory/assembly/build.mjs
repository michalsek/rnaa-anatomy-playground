// The audio factory, assembled: every machine inside a low phone tray; a slider opens the phone (the display lifts
// off and slides back, the factory rises out of the tray level by level) and closes it again. The display
// carries the animated React screen with playback controls for the factory clock. One loop, top → bottom → top: fluff drops from under the display onto belt A (high), the packer boxes
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
const CASE = { w: 360, d: 760, r: 44, depth: 280, cut: 36, walls: "low", displayZ: 560, displayShift: [-80, -24], neck: 72, controls: true };
// the explode (home = open, the build's geometry; share 1 = closed). Closed, the factory is packed down into a deep
// well under the band, level by level, and the display slides back over the case and seats on the lip. Moves are
// vertical: every hand-off is a near-touching pair and the tower is full height, so any sideways pull would carry one
// machine through its neighbour in a visible frame. Closing, the floor drops first, then the low level, mid, high,
// the tower, and the display last (so a lower level always leads downward and a stacked hand-off only separates);
// opening runs the other way: the display lifts first, then the tower, high, mid and low levels rise in turn.
const SINK = 400;
const PIECES = {
  floor: [0, 0, -SINK - 40],
  low: [0, 0, -SINK],
  mid: [0, 0, -SINK],
  high: [0, 0, -SINK],
  tower: [0, 0, -SINK],
  display: [-CASE.displayShift[0], -CASE.displayShift[1], CASE.cut - CASE.displayZ],
  case: [0, 0, 0],
};
const ORDER = ["floor", "low", "mid", "high", "tower", "display"];
const SPRING = { stagger: 0.2, stiffness: 20, damping: 9.4, substeps: 4 };
// which level each machine rides
const LEVEL = { audio: "low", beltC: "low", crusher: "low", scanner: "low", beltD: "low", centrifuge: "mid", beltB: "mid", packer: "high", beltA: "high", elevator: "tower", speaker: "tower", phone: "display" };
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
const beltA = { id: "beltA", type: "top", axis: "x", dir: 1, top: 232, width: 20, legs: false };
const beltAOrigin = [-4, PACKER[1], 0];
beltA.length = PACKER[0] - 43 - beltAOrigin[0]; // head drum clear of the packer's deck (rails run 7 past it)
Object.assign(beltA, { inAt: DISPENSER_X - beltAOrigin[0], outAt: beltA.length, tip: false });

const beltBOrigin = [PACKER[0], PACKER[1] + 32, 0]; // rails start clear of the packer's front tab
const beltB = { id: "beltB", type: "top", axis: "y", dir: 1, top: 192, width: 18, inAt: 2, tip: false, legs: false };
beltB.length = CENTRI[1] - 49 - beltBOrigin[1]; // head drum + rails stop before the funnel lip (and its legs clear the coolant pipe)
beltB.outAt = beltB.length;

const W = 900;
const H = 1020;
const fit = [
  ...k.boxCorners({ x: -CASE.w / 2, y: -CASE.d / 2, w: CASE.w, d: CASE.d, r: 0 }, -8, CASE.depth),
  ...k.boxCorners({ x: -CASE.w / 2 + CASE.displayShift[0], y: -CASE.d / 2 + CASE.displayShift[1], w: CASE.w, d: CASE.d, r: 0 }, CASE.displayZ, CASE.displayZ + 6),
];
const ctx = scene({ W, H, fit, pad: 24, floorZ: -8 - SINK - 60 }); // the shop floor sits below the sunk floor plate

phone.build(ctx, [0, 0, 0], { id: "phone", ...CASE, dispenser: [DISPENSER_X, PACKER[1]], fullRecord: true });
const [CASE_HALO] = ctx.back.splice(0, 2); // the case's halo stays put; the display's floor shadow is dropped
// back-layer entries (halos, defs) pushed by each machine's build, so its halos can ride its level
const BACK = [...ctx.back.splice(0).map((svg) => ({ svg, id: "phone" }))];
const track = (id, build) => {
  const n = ctx.back.length;
  build();
  BACK.push(...ctx.back.splice(n).map((svg) => ({ svg, id })));
};
track("beltA", () => conveyor.build(ctx, beltAOrigin, beltA));
track("packer", () => packer.build(ctx, PACKER, { id: "packer", prefill: true, stand: false }));
track("beltB", () => conveyor.build(ctx, beltBOrigin, beltB));
track("centrifuge", () => centrifuge.build(ctx, CENTRI, { id: "centrifuge", stand: false }));

const OUT = ctx.data.centrifuge.ports.out; // in front of the stand, over the audio belt
const audioOrigin = [AUDIO_HEAD, OUT[1], 0];
const audio = { id: "audio", type: "loop", axis: "x", dir: -1, top: 92, drum: 15, length: OUT[0] + 12 - AUDIO_HEAD, inAt: OUT[0] - AUDIO_HEAD, readAt: SCANNER_X - AUDIO_HEAD, legs: false };
track("audio", () => conveyor.build(ctx, audioOrigin, audio));

const SCANNER = [SCANNER_X, audioOrigin[1] - 38, 0];
track("scanner", () => scanner.build(ctx, SCANNER, { id: "scanner", belt: "audio" }));
const sOut = ctx.data.scanner.ports.out; // packet bottom-centre on the preamp's lip (lip starts 4 nearer the belt)
const beltDTail = sOut[1] - 4 - 8; // tail drum + rails clear of the lip
const BELT_D_LEN = beltDTail - (ELEV_Y + 51);
const beltDOrigin = [sOut[0], beltDTail - BELT_D_LEN, 0];
const beltD = { id: "beltD", type: "top", axis: "y", dir: -1, top: 24, width: 18, speed: 28, length: BELT_D_LEN, inAt: BELT_D_LEN - 4, outAt: 0, tip: false, legs: false };
track("beltD", () => conveyor.build(ctx, beltDOrigin, beltD));
const ELEV = [sOut[0], beltDOrigin[1] - 51, 0]; // chute mouth 12 past belt D's head drum
track("elevator", () => elevator.build(ctx, ELEV, { id: "elevator", lift: 210, outDir: "-y", outReach: 40, access: false })); // a long duct carries the spout out past the head on screen
const spout = ctx.data.elevator.ports.out;
// the packet lands 5 in from the ledge end; the spout sits 3 further out (the speaker's base clears the elevator's post bases)
track("speaker", () => speaker.build(ctx, [spout[0] - 62, spout[1], 0], { id: "speaker", height: SPEAKER_LEDGE + 15, stand: false }));

const beltCOrigin = [AUDIO_HEAD, audioOrigin[1] - 22, 0];
const beltC = { id: "beltC", type: "top", axis: "y", dir: 1, top: 40, length: BELT_C_LEN, inAt: 22, outAt: BELT_C_LEN, tip: false, legs: false };
track("beltC", () => conveyor.build(ctx, beltCOrigin, beltC));
const CRUSHER = [AUDIO_HEAD, beltCOrigin[1] + BELT_C_LEN + 30, 0]; // belt C (and its rails) end before the hopper's back lip
track("crusher", () => crusher.build(ctx, CRUSHER, { id: "crusher" }));

export const LAYOUT = { CASE, PACKER, CENTRI, beltAOrigin, beltA, beltBOrigin, beltB, audioOrigin, audio, SCANNER, beltDOrigin, beltD, ELEV, SPEAKER: [spout[0] - 62, spout[1], 0], beltCOrigin, beltC, CRUSHER };
if (process.argv.includes("--layout")) console.log(JSON.stringify(LAYOUT, null, 1));

// ---------------------------------------------------------------- the explode: pieces, moves, back layer, the well clip
// every item, shape and tube belongs to one piece: the display (glass, OLED, dispenser), the case band (static), or the
// floor (back plate, floor details) or a machine level. The audit replays the springs' frames with these moves.
const pieceOf = (name) => {
  if (/^phone\.(display|feed)/.test(name)) return "display";
  if (/^phone\.(band|button|sim|end|antenna)/.test(name)) return "case";
  if (/^phone\./.test(name)) return "floor";
  const id = name.split(/[.:]/)[0];
  if (!LEVEL[id]) throw new Error("no level for " + name);
  return LEVEL[id];
};
for (const item of ctx.R.items) {
  item.piece = item.ride = pieceOf(item.name);
  item.move = PIECES[item.piece];
  for (const shape of item.shapes) Object.assign(shape, { piece: item.piece, ride: item.piece, move: item.move });
}
for (const tube of [...ctx.R.tubes, ...ctx.R.routes]) Object.assign(tube, { piece: pieceOf(tube.name), ride: pieceOf(tube.name), move: PIECES[pieceOf(tube.name)] });
ctx.R.order = ORDER;
ctx.R.spring = SPRING;

// a deep well under the band: whatever has sunk below the band's near bottom edge is out of sight (the
// display covers the opening, the band the sides). The clip is the screen region above that edge.
{
  const plan = { x: -CASE.w / 2, y: -CASE.d / 2, w: CASE.w, d: CASE.d, r: CASE.r };
  const ring = k.roundedPlan(plan, 12).map(([x, y]) => ctx.at([x, y, -8]));
  const iL = ring.reduce((b, p, i) => (p[0] < ring[b][0] ? i : b), 0);
  const iR = ring.reduce((b, p, i) => (p[0] > ring[b][0] ? i : b), 0);
  const walk = (from, to, step) => { const out = []; for (let i = from; ; i = (i + step + ring.length) % ring.length) { out.push(ring[i]); if (i === to) break; } return out; };
  const a = walk(iL, iR, 1);
  const b = walk(iL, iR, -1);
  const lower = a.reduce((s, p) => s + p[1], 0) / a.length > b.reduce((s, p) => s + p[1], 0) / b.length ? a : b;
  const pts = [...lower, [ring[iR][0], -4000], [ring[iL][0], -4000]];
  ctx.back.unshift(`<defs><clipPath id="fx-well" clipPathUnits="userSpaceOnUse"><path d="${k.pathOf(pts, true)}"/></clipPath></defs>`);
}
// the back layer: defs stay where they are; the case's halo is static; every machine's halo rides the deck
{
  const defs = [...ctx.back, ...BACK.filter((e) => e.svg.startsWith("<defs")).map((e) => e.svg)];
  const levels = Object.keys(PIECES).filter((p) => p !== "case" && p !== "display");
  const halos = (p) => BACK.filter((e) => !e.svg.startsWith("<defs") && (e.id === "phone" ? "floor" : LEVEL[e.id]) === p).map((e) => e.svg).join("");
  ctx.back.length = 0;
  ctx.back.push(...defs, CASE_HALO, ...levels.map((p) => `<g class="xback" data-p="${p}" clip-path="url(#fx-well)"><g class="xm">${halos(p)}</g></g>`));
}
ctx.data.explode = { order: ORDER, spring: SPRING, pieces: PIECES, level: LEVEL };

// ---------------------------------------------------------------- page
const ASSEMBLY_LIVE = String.raw`
// The explode: one spring per piece (the same spring and stagger the audit replays), driven by the slider's target.
// Home is open (share 0); closed is share 1. Items are re-sorted by key + lift · share whenever the order changes.
MACHINES.explode = (api) => {
  const X = FACTORY.data.explode;
  const parts = api.el(".fx-parts");
  const all = [...parts.children].filter((n) => n.classList.contains("xw")).map((n) => ({ n, p: n.dataset.p, k: +n.dataset.k, l: +n.dataset.l, m: n.firstElementChild }));
  // everything that sinks into the well is clipped at the band's near bottom edge
  for (const w of all) if (w.p !== "display" && w.p !== "case") w.n.setAttribute("clip-path", "url(#fx-well)");
  const backs = api.els(".xback").map((n) => ({ p: n.dataset.p, m: n.firstElementChild }));
  let order = all.slice();
  const springs = Object.fromEntries(X.order.map((id) => [id, { x: 1, v: 0, target: 1, pending: null, drawn: null }]));
  let clock = 0;
  const shiftOf = (id, s) => { const m = X.pieces[id]; const a = api.at([m[0] * s, m[1] * s, m[2] * s]); const o = api.at([0, 0, 0]); return [a[0] - o[0], a[1] - o[1]]; };
  function goal(share) {
    const ids = Object.values(springs).some((sp) => share > sp.target) ? X.order : [...X.order].reverse();
    let index = 0;
    for (const id of ids) {
      const sp = springs[id];
      if (Math.abs(sp.target - share) < 1e-6 && !sp.pending) continue;
      sp.pending = { value: share, at: clock + index++ * X.spring.stagger };
    }
  }
  function place() {
    let moved = false;
    for (const id of X.order) {
      const sp = springs[id];
      if (sp.drawn !== null && Math.abs(sp.drawn - sp.x) < 1e-5) continue;
      sp.drawn = sp.x;
      moved = true;
      const [dx, dy] = shiftOf(id, sp.x);
      const tr = Math.abs(dx) + Math.abs(dy) < 1e-3 ? "" : "translate(" + dx.toFixed(2) + " " + dy.toFixed(2) + ")";
      for (const w of all) if (w.p === id) w.m.setAttribute("transform", tr);
      for (const b of backs) if (b.p === id) b.m.setAttribute("transform", tr);
    }
    if (!moved) return;
    const share = (p) => (springs[p] ? springs[p].x : 0);
    const next = all.map((w) => ({ w, key: w.k + w.l * share(w.p) })).sort((a, b) => a.key - b.key).map((o) => o.w);
    if (next.some((w, i) => w !== order[i])) {
      const frag = document.createDocumentFragment();
      for (const w of next) frag.appendChild(w.n);
      parts.appendChild(frag);
      order = next;
    }
  }
  const self = {
    get open() { return 1 - springs.display.x; },
    // the world offset of a piece right now (move · share)
    offsetOf(id) { const sp = springs[id]; const m = X.pieces[id]; return sp && m ? [m[0] * sp.x, m[1] * sp.x, m[2] * sp.x] : [0, 0, 0]; },
    get resting() { return Object.values(springs).every((sp) => !sp.pending && Math.abs(sp.x - sp.target) < 1e-3 && Math.abs(sp.v) < 1e-3); },
    target: 1,
    set(openAmount) { self.target = 1 - openAmount; goal(self.target); },
    jump(openAmount) { self.target = 1 - openAmount; for (const sp of Object.values(springs)) { sp.x = sp.target = self.target; sp.v = 0; sp.pending = null; } place(); },
    frame(dt) {
      clock += dt;
      const calm = api.calm();
      for (const sp of Object.values(springs)) {
        if (sp.pending && clock >= sp.pending.at) { sp.target = sp.pending.value; sp.pending = null; }
        if (calm) { sp.x = sp.target; sp.v = 0; continue; }
        for (let i = 0; i < X.spring.substeps; i++) {
          const h = dt / X.spring.substeps;
          sp.v += ((sp.target - sp.x) * X.spring.stiffness - sp.v * X.spring.damping) * h;
          sp.x += sp.v * h;
        }
      }
      place();
    },
  };
  place();
  return self;
};
// a tap on the display (outside its controls): the display dips and springs back, the screen sends a burst of calls
MACHINES.tapper = (api) => {
  const nodes = api.els('[data-name^="phone.display"],[data-name^="phone.feed"],[data-slot^="phone:"]');
  let x = 0;
  let v = 0;
  let active = false;
  return {
    tap() {
      FACTORY.machines.phone.tap();
      if (api.calm()) return;
      v -= 26;
      active = true;
    },
    frame(dt) {
      if (!active) return;
      for (let i = 0; i < 4; i++) {
        const h = dt / 4;
        v += (-196 * x - 12.6 * v) * h;
        x += v * h;
      }
      if (Math.abs(x) < 5e-4 && Math.abs(v) < 5e-3) { x = 0; v = 0; active = false; }
      const tr = x === 0 ? "" : translateAlong(api.P, [0, 0, x]);
      for (const n of nodes) n.setAttribute("transform", tr);
    },
  };
};`;

const boot = `
const M = FACTORY.machines;
for (const [id, kind] of [["phone", "phone"], ["beltA", "conveyor"], ["packer", "packer"], ["beltB", "conveyor"], ["centrifuge", "centrifuge"], ["audio", "conveyor"], ["beltC", "conveyor"], ["crusher", "crusher"], ["scanner", "scanner"], ["beltD", "conveyor"], ["elevator", "elevator"], ["speaker", "speaker"]]) FACTORY.define(id, MACHINES[kind]);
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
// the rings drain one packet per quantum, in phase with the audio belt's cleats, and only into a free cleat
M.centrifuge.syncTo(() => M.audio.quanta(), M.audio.quanta().period);
M.centrifuge.releaseWhen((lead) => M.audio.canTake(lead));
// backpressure: belt B holds its front packet at the roller while the funnel's throat is full
M.beltB.hold = () => !M.centrifuge.canAccept();
const explode = FACTORY.define("explode", MACHINES.explode);
const tapper = FACTORY.define("tapper", MACHINES.tapper);
// hand-offs between machines on different levels use the ports where they are right now
FACTORY.frameOffset = (id) => explode.offsetOf(FACTORY.data.explode.level[id]);
const still = FACTORY.still.matches;

// ---- the slider, the tour, playback
const slider = document.querySelector(".fx-slider");
const status = document.querySelector("[data-status]");
const say = (text) => (status.textContent = text);
const SPEEDS = [0.5, 1, 2];
const speedText = FACTORY.svg.querySelector('[data-ctl-text="speed"]');
const icons = { play: FACTORY.svg.querySelector('[data-ctl-icon="play"]'), pause: FACTORY.svg.querySelector('[data-ctl-icon="pause"]') };
const cells = [...FACTORY.svg.querySelectorAll("[data-ctl-cell]")];
function showPlayback() {
  speedText.textContent = (FACTORY.speed === 0.5 ? "½" : FACTORY.speed) + "×";
  icons.play.style.display = FACTORY.paused ? "" : "none";
  icons.pause.style.display = FACTORY.paused ? "none" : "";
}
function togglePlay() { FACTORY.paused = !FACTORY.paused; showPlayback(); say(FACTORY.paused ? "factory paused" : "factory running"); }
function stepSpeed(dir) {
  const i = Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(FACTORY.speed) + dir));
  FACTORY.speed = SPEEDS[i];
  showPlayback();
  say("speed " + SPEEDS[i] + " times");
}
function cycleSpeed() { FACTORY.speed = SPEEDS[(SPEEDS.indexOf(FACTORY.speed) + 1) % SPEEDS.length]; showPlayback(); say("speed " + FACTORY.speed + " times"); }
showPlayback();

let touring = !still;
let tourT = 0;
const TOUR = [[1.4, 1], [14, 0], [18.5, 1]]; // open at 1.4 s, close at 14 s, open again at 18.5 s (then loop from 1.4)
let tourStep = 0;
function stopTour() { touring = false; }
function setOpen(v, user) {
  if (user) stopTour();
  v = Math.max(0, Math.min(1, v));
  if (still) explode.jump(v); else explode.set(v);
  slider.setAttribute("aria-valuetext", v < 0.02 ? "closed" : v > 0.98 ? "open" : "open " + Math.round(v * 100) + "%");
  if (user) say(v < 0.02 ? "phone closed" : v > 0.98 ? "phone open: the factory inside" : "opening the phone");
}
if (still) setOpen(1); else explode.jump(0);
slider.value = still ? 1 : 0;
slider.addEventListener("input", () => setOpen(+slider.value, true));
slider.addEventListener("pointerdown", stopTour);

FACTORY.onFrame((dt) => {
  if (touring) {
    tourT += dt;
    const [at, value] = TOUR[tourStep];
    if (tourT >= at) {
      setOpen(value, false);
      tourStep++;
      if (tourStep === TOUR.length) { tourStep = 1; tourT = TOUR[0][0]; }
    }
  }
  explode.frame(dt);
  tapper.frame(dt);
  if (document.activeElement !== slider) slider.value = explode.open.toFixed(3);
  // the device-buffer meter on the screen: quanta read into the next 512-frame buffer
  const n = M.scanner.reads % 4;
  cells.forEach((c, i) => (c.style.fill = i < n ? "var(--pk-audio-face)" : "#ffffff14"));
});

FACTORY.stage.addEventListener("click", (e) => {
  const ctl = e.target.closest("[data-ctl]");
  if (ctl) { ctl.dataset.ctl === "play" ? togglePlay() : cycleSpeed(); return; }
  if (e.target.closest('[data-name^="phone.display"]')) tapper.tap();
});
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const onSlider = document.activeElement === slider;
  if (e.key === " ") { e.preventDefault(); togglePlay(); }
  else if (e.key === "[") stepSpeed(-1);
  else if (e.key === "]") stepSpeed(1);
  else if (!onSlider && (e.key === "ArrowRight" || e.key === "ArrowUp")) { e.preventDefault(); setOpen(explode.open + (e.shiftKey ? 0.25 : 0.1), true); slider.value = 1 - explode.target; }
  else if (!onSlider && (e.key === "ArrowLeft" || e.key === "ArrowDown")) { e.preventDefault(); setOpen(explode.open - (e.shiftKey ? 0.25 : 0.1), true); slider.value = 1 - explode.target; }
  else if (!onSlider && e.key === "Home") setOpen(0, true);
  else if (!onSlider && e.key === "End") setOpen(1, true);
});
const info = document.querySelector(".fx-info");
const about = document.querySelector("#fx-about");
info.addEventListener("click", () => { const open = about.hidden; about.hidden = !open; info.setAttribute("aria-expanded", String(open)); });

// live and true: one cleat gap past the read point = one 128-frame quantum (375 a second at 48 kHz in the engine)
FACTORY.readout(() => {
  const q = M.audio.quanta();
  const rate = FACTORY.paused ? "paused" : (FACTORY.speed / q.period).toFixed(2) + "/s here";
  return q.count.toLocaleString("en-US") + " quanta · " + rate + " (375/s real) · " + M.crusher.stats().count + " disposed";
});
window.FACTORY = FACTORY;`;

const CAPTION =
  "How react-native-audio-api turns JavaScript calls into sound. Calls (blue beads) fall from the screen and are packed into fixed-size closures (72 bytes each): blue control events for the event scheduler (parameters, start, stop), amber graph changes (connect, disconnect), white buffers handed over. The centrifuge stands for the lock-free single-producer rings (1,024 slots in the engine): packets wait there until the audio thread drains them at the next render quantum, and nothing on either side waits on a lock. The audio belt is the render loop: each cleat-to-cleat segment is one 128-frame quantum, 375 a second at 48 kHz (shown here far slower). The scanner is the platform audio callback (CoreAudio or Oboe) reading every finished quantum; four quanta make one 512-frame device buffer, one mint packet (the four cells on the screen fill with it), which the elevator lifts to the speaker. What the audio thread swaps out turns grey and rides belt C to the crusher, the Disposer thread, so nothing is freed on the audio thread.";
const HELP = "Slider or arrow keys open the phone. On the screen: play/pause (Space), speed (the pill, or [ and ]). Tap the screen to send calls.";

const OVERLAY = `<div class="fx-ui"><label class="fx-open"><span aria-hidden="true">closed</span><input class="fx-slider" type="range" min="0" max="1" step="0.001" value="0" aria-label="Open the phone" aria-valuetext="closed"><span aria-hidden="true">open</span></label></div>
<button class="fx-info" type="button" aria-expanded="false" aria-controls="fx-about" aria-label="About this figure">i</button>
<div class="fx-about" id="fx-about" hidden><p>${CAPTION}</p><p class="fx-help">${HELP}</p></div>`;

const FULL_CSS = `
html,body{height:100%;margin:0;overflow:hidden}
.iso-page{width:100vw!important;height:100vh;margin:0!important;max-width:none!important}
.fx-full{position:relative;width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;background:var(--anatomy-page)}
.fx-full .fx-stage{width:100%;height:100%;display:flex;align-items:center;justify-content:center}
.fx-full .iso-svg{width:100%!important;height:100%!important;max-width:100vw;max-height:100vh}
.fx-full .fx-stage:focus-visible{outline:none}
[data-ctl]{cursor:pointer}
.fx-ui{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;font:11px/1 var(--anatomy-mono);color:var(--anatomy-muted);letter-spacing:.08em;text-transform:uppercase}
.fx-open{display:flex;align-items:center;gap:10px}
.fx-slider{width:min(260px,52vw);accent-color:var(--fx-react)}
.fx-readout{position:absolute;right:16px;bottom:20px;font:11px/1.3 var(--anatomy-mono);color:var(--anatomy-muted);font-variant-numeric:tabular-nums;max-width:40vw;text-align:right}
.fx-info{position:absolute;right:14px;top:14px;width:24px;height:24px;border-radius:50%;border:1px solid var(--anatomy-mid);background:transparent;color:var(--anatomy-text);font:italic 600 13px/1 Georgia,serif;cursor:pointer}
.fx-about{position:absolute;right:14px;top:46px;max-width:min(420px,calc(100vw - 28px));padding:12px 14px;background:var(--anatomy-card);border:1px solid var(--anatomy-faint);font-size:12.5px;line-height:1.5;color:var(--anatomy-text);box-shadow:var(--anatomy-lift)}
.fx-about p{margin:0 0 8px}.fx-help{color:var(--anatomy-muted)}
@media (max-width:560px){.fx-readout{left:16px;right:16px;bottom:52px;max-width:none;text-align:center}.fx-ui{bottom:14px}}`;

page(ctx, {
  out: join(HERE, "factory.html"),
  title: "Inside a React Native app",
  readout: "0 quanta",
  frame: false,
  explode: true,
  overlay: OVERLAY,
  describe: CAPTION + " " + HELP,
  css: centrifuge.CSS + crusher.CSS + packer.CSS + FULL_CSS,
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

// junction points (viewBox coordinates, open pose) for the verification scripts in qa/: both ends of every hand-off
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
  writeFileSync(join(HERE, "qa", "ports.json"), JSON.stringify({ W, H, pairs: out }, null, 1));
}
