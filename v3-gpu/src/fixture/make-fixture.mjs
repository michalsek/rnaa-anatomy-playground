// node src/fixture/make-fixture.mjs → out/gpu/fixture/{fixture.html, fixture-light.html, fixture-share1(-light).html, fixture.scene.json}
// A small anatomy-kit scene that exercises every static-frame feature of the centrifuge: halo, four-tone prisms that
// overlap each other (lines under and over fills), creases/bevels/edges at 0.6 px, seamless 0.4 px tone strokes,
// a 1.3 px mark, dots of every tone and fill-opacity, a userSpaceOnUse linear gradient (CSS stop classes), a graphite
// material group, faded (group-opacity) ribs, translucent .55 packet lines. Pages mirror v2 kit.mjs page() markup.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { itemsToScene, encodeScene } from "./svg2scene.mjs";

const k = await import(join(homedir(), ".claude/skills/anatomy/kit/iso-kit.mjs"));
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "out/gpu/fixture");
const FACTORY_CSS = readFileSync(join(ROOT, "../v2-factory/shared/factory.css"), "utf8");
const EXTRA_CSS = `
.iso{--cf-void-0:#c9ccd1;--cf-void-1:#7d8188;--cf-void-2:#4a4d53}
.iso[data-theme="dark"]{--cf-void-0:#3a3d43;--cf-void-1:#1a1c20;--cf-void-2:#0b0c0e}
.cf-void-0{stop-color:var(--cf-void-0)}.cf-void-1{stop-color:var(--cf-void-1)}.cf-void-2{stop-color:var(--cf-void-2)}`;

const W = 600, H = 400;
const corners = [[-90, -60, 0], [90, -60, 0], [90, 60, 0], [-90, 60, 0], [-90, -60, 60], [90, 60, 70]];
const P = k.fitProjection(corners, W, H, { pad: 30 });

const items = [];
const put = (name, key, svg, { material = "", lift = 0, move = [0, 0] } = {}) => items.push({ name, key, lift, move, svg, material });

// Base plate with halo, bevel and a groove, screws as dots.
const PLATE = { x: -90, y: -60, w: 180, d: 120, r: 8 };
put("plate", 0, k.solidSvg(k.slabOf(PLATE, -10, 10, P, 8, 1.6), { tone: "lo", halo: true }) +
  k.lineSvg(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "faint" }) +
  k.dotsSvg(k.corners(PLATE, 10).map(([x, y]) => k.iso([x, y, 0], P)), { size: 0.5, tone: "mid" }));

// Ruler strip with ticks (lo minor / mid major), and a 1.3 px sync mark.
const strip = { x: -80, y: 40, w: 160, d: 7, r: 1 };
const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y + 0.8, 0.6, [2, 3.6], P);
put("ruler", 1, k.solidSvg(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }) +
  k.lineSvg(ticks.minor, { tone: "lo" }) + k.lineSvg(ticks.major, { tone: "mid" }) +
  `<path class="iso-line" data-tone="hi" style="stroke-width:1.3" d="${k.lineOnTop([0, strip.y + 0.8], [0, strip.y + 5], 0.6, P)}"/>`);

// Funnel void with gradient (userSpaceOnUse, CSS stop colours) on a puck.
{
  const c = [-55, -25];
  const puck = k.cylinder(c[0], c[1], 16, 0, 8, P, 48, 0.8);
  const back = k.iso([c[0] - 9, c[1] - 9, 8], P), front = k.iso([c[0] + 9, c[1] + 9, 8], P);
  const voidPath = k.ring(c[0], c[1], 11, 8, P, 48) + "Z";
  put("puck", 2, k.solidSvg(puck, { tone: "mid" }) +
    `<defs><linearGradient id="fx-void" gradientUnits="userSpaceOnUse" x1="${back[0].toFixed(1)}" y1="${back[1].toFixed(1)}" x2="${front[0].toFixed(1)}" y2="${front[1].toFixed(1)}"><stop offset="0" class="cf-void-0"/><stop offset="0.55" class="cf-void-1"/><stop offset="1" class="cf-void-2"/></linearGradient></defs><path class="cf-void" fill="url(#fx-void)" d="${voidPath}"/>` +
    k.lineSvg(k.ring(c[0], c[1], 11, 8, P, 48), { tone: "lo" }) +
    k.dotsSvg(Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * Math.PI * 2; return k.iso([c[0] + 13.5 * Math.cos(a), c[1] + 13.5 * Math.sin(a), 8], P); }), { size: 0.4, tone: "hi" }));
}

// Three overlapping prisms (back mid, middle graphite, front lit) — lines of the back ones run under front fills.
put("prism-back", 3, k.solidSvg(k.slabOf({ x: -10, y: -45, w: 60, d: 40, r: 3 }, 0, 34, P, 4, 0.8), { tone: "mid", crease: "lo" }), { lift: 40, move: [-50, -30] });
put("prism-mid", 4, k.solidSvg(k.slabOf({ x: 10, y: -20, w: 46, d: 36, r: 2 }, 0, 52, P, 4, 0.6), { tone: "hi" }), { material: "fx-graphite", lift: 30, move: [0, -60] });
put("prism-front", 5, k.solidSvg(k.slabOf({ x: 30, y: 5, w: 40, d: 30, r: 4 }, 0, 24, P, 6, 0.6), { tone: "hi", lit: true }) +
  k.lineSvg(k.sideSeam({ x: 30, y: 5, w: 40, d: 30, r: 4 }, 12, P, 6), { tone: "faint" }), { lift: 60, move: [0, -120] });

// Seamless cylinder (0.4 px tone strokes) with faded ribs (group opacity) and a knurl.
{
  const cyl = k.cylinder(-60, 30, 12, 0, 30, P, 40, 0.6);
  cyl.seamless = true;
  const ribs = Array.from({ length: 12 }, (_, i) => [k.rise([-60 + 12 * Math.cos((i / 12) * Math.PI + 0.3), 30 + 12 * Math.sin((i / 12) * Math.PI + 0.3)], 4, 26, P), 0.15 + 0.07 * i]);
  put("cylinder", 2.5, k.solidSvg(cyl, { tone: "mid", inner: k.fadedSvg(ribs, { tone: "lo" }) }));
}

// Packet: coloured kit solid with .55 translucent lines crossing each other, and overlapping translucent dots.
{
  const plan = { x: 60, y: -50, w: 14, d: 12, r: 0.6 };
  const box = k.slabOf(plan, 0, 10, P, 2, 0.3);
  const cross = k.lineOnTop([60, -50], [74, -38], 10, P) + k.lineOnTop([74, -50], [60, -38], 10, P) + k.sideSeam(plan, 5.5, P, 2);
  put("packet", 3.5, `<g class="pk" data-kind="graph">${k.solidSvg(box, { tone: "hi" })}${k.lineSvg(cross, { tone: "lo" })}</g>` +
    k.dotsSvg([[...k.iso([67, -44, 22], P), 1], [...k.iso([69, -44, 22], P), 0.6], [...k.iso([68, -42, 22], P), 0.3]], { size: 2.2, tone: "hi" }));
}

items.sort((a, b) => a.key - b.key);
const wrap = (item, offset = [0, 0]) => `<g class="it${item.material ? ` ${item.material}` : ""}" data-name="${item.name}"${offset[0] || offset[1] ? ` transform="translate(${offset[0]} ${offset[1]})"` : ""}>${item.svg}</g>`;

function pageFor(theme, share) {
  const order = [...items].sort((a, b) => (a.key + a.lift * share) - (b.key + b.lift * share));
  const svg = k.figureSvg({ width: W, height: H, label: "Fixture", body: `<g class="fx-parts">${order.map((it) => wrap(it, [it.move[0] * share, it.move[1] * share])).join("")}</g>` });
  const stage = `<div class="iso-stage fx-stage" tabindex="0" role="group" aria-label="Fixture">${svg}</div>`;
  const body = `<style>${FACTORY_CSS}${EXTRA_CSS}</style>` + k.plateHtml({ fig: "Fixture", title: "M2 synthetic", hint: "static", readout: `share ${share}`, body: stage });
  return k.pageHtml({ title: "Fixture", theme, body, width: Math.max(650, W + 60) });
}

mkdirSync(OUT, { recursive: true });
for (const share of [0, 0.5, 1]) for (const theme of ["dark", "light"]) {
  const name = `fixture${share ? `-share${share}` : ""}${theme === "light" ? "-light" : ""}.html`;
  writeFileSync(join(OUT, name), pageFor(theme, share));
}
// The GPU scene: the item svg already wrapped in its material group so probes see the same class chain.
const scene = itemsToScene({ viewBox: [0, 0, W, H], items: items.map((it) => ({ ...it, svg: wrap(it) })) });
scene.chainPrefix = [{ tag: "g", attrs: { class: "fx-parts" } }];
writeFileSync(join(OUT, "fixture.scene.json"), encodeScene(scene));
console.log(`fixture: ${items.length} items, ${scene.fills.length} fills (${scene.tris.length / 6} tris), ${scene.strokes.length} strokes (${scene.points.length / 2} pts), ${scene.dots.length} dots, ${scene.paints.length} paints`);
