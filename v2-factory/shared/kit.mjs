// Shared building kit for the v2 audio factory. Every machine and the assembly use this, so
// geometry, painter's order, the audit, colours and the live runtime stay consistent.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ANATOMY = "/Users/michalsek/.claude/skills/anatomy";
const k = await import(`${ANATOMY}/kit/iso-kit.mjs`);
const G = await import(`${ANATOMY}/kit/lathe.mjs`);
const T = await import(`${ANATOMY}/kit/tube.mjs`);
const A = await import(`${ANATOMY}/kit/audit.mjs`);
const { kitScript } = await import(`${ANATOMY}/scripts/inline-kit.mjs`);
export { k, G, T, A };
const SHARED = dirname(fileURLToPath(import.meta.url));

// Item kinds travelling through the factory, and the colour each one carries.
export const KINDS = ["fluff", "control", "graph", "data", "audio", "garbage"];

// scene({ W, H, azimuth, elevation, fit, pad }) → ctx with the projection, the recorder and the helpers.
export function scene({ W = 760, H = 760, azimuth = 45, elevation = 30, fit, pad = 28, floorZ = 0 } = {}) {
  const P = k.fitProjection(fit, W, H, { pad, azimuth, elevation });
  const V = G.viewOf(P);
  const KS = G.scaleOf(P);
  const R = A.recorder(P);
  const at = (p) => k.iso(p, P);
  const f2 = (v) => Math.round(v * 100) / 100;
  const S = (paths, style) => k.solidSvg(paths, style);
  const Ln = (d, style) => k.lineSvg(d, style);
  const Dots = (points, style) => k.dotsSvg(points, style);
  const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);
  const UP = (x, y, z) => G.frameOf([x, y, z], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  const ctx = { k, G, T, A, P, V, KS, R, W, H, at, f2, S, Ln, Dots, path3, UP, back: [], data: {}, slots: [], routes: {}, material: "" };
  const record = (shape) => R.solid(shape);
  ctx.record = record;
  // the shop floor (top at floorZ, default 0; the assembly passes −8 to sit under the phone's back plate) (the audit treats it as ground)
  {
    const xs = fit.map((p) => p[0]);
    const ys = fit.map((p) => p[1]);
    const x0 = Math.min(...xs) - 20;
    const y0 = Math.min(...ys) - 20;
    record(A.slab({ x: x0, y: y0, w: Math.max(...xs) + 20 - x0, d: Math.max(...ys) + 20 - y0, r: 0 }, floorZ - 1, 1, { name: "stand.floor", ground: true }, 1));
  }

  // every drawn item: a name (machine-prefixed: "centrifuge.drum"), a reference point for depth, svg, recorded shapes
  ctx.put = (name, ref, svg, shapes = [], { bias = 0, attrs, material = ctx.material } = {}) =>
    R.put({ name: R.nameFor(name), at: ref, bias, svg, shapes, attrs, material });
  ctx.box = (name, [x0, y0, z0], [x1, y1, z1], style = {}, { r = 0.6, steps = 3, bevel = 0, extra = "", inner = "", bias = 0, attrs } = {}) => {
    const plan = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r };
    const shape = record(A.slab(plan, z0, z1 - z0, { name }, steps));
    ctx.put(name, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], S(k.slabOf(plan, z0, z1 - z0, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
    return plan;
  };
  ctx.slab = (name, plan, z0, h, style = {}, { steps = 6, bevel = 0, extra = "", inner = "", bias = 0, attrs } = {}) => {
    const shape = record(A.slab(plan, z0, h, { name }, steps));
    ctx.put(name, [plan.x + plan.w / 2, plan.y + plan.d / 2, z0 + h / 2], S(k.slabOf(plan, z0, h, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
  };
  ctx.prism = (name, ring, z0, h, style = {}, { extra = "", inner = "", bias = 0, ref, attrs } = {}) => {
    const shape = record(A.extruded(ring, z0, h, { name }));
    const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
    const cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
    ctx.put(name, ref ?? [cx, cy, z0 + h / 2], S(k.extrude(ring, z0, h, P, { convex: false }), { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
  };
  ctx.cyl = (name, cx, cy, r, z0, h, style = {}, { steps = 32, bevel = 0, extra = "", inner = "", bias = 0, attrs, owner } = {}) => {
    const shape = record(A.cylinder(cx, cy, r, z0, h, { name, owner }));
    ctx.put(name, [cx, cy, z0 + h / 2], S(k.cylinder(cx, cy, r, z0, h, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
  };
  // a turned part on any axis: profile [[s, r(, smooth)]] along frame F (G.frameAlong / G.frameOf)
  ctx.turned = (name, F, profile, style = {}, { extra = "", inner = "", bias = 0, smooth, steps, bevel = 0, owner, attrs, fill } = {}) => {
    const opts = { bevel, ...(smooth !== undefined ? { smooth } : {}), ...(steps ? { steps } : {}), ...(fill ? { fill } : {}) };
    const paths = G.solidOf(profile, F, P, opts);
    const mid = (profile[0][0] + profile[profile.length - 1][0]) / 2;
    const shape = record(A.solid(F, profile, { name, owner, radius: smooth && smooth.radius ? smooth.radius : null }));
    ctx.put(name, G.add3(F.o, G.mul3(F.a, mid)), S(paths, { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
  };
  ctx.disc = (name, F, s0, s1, r, style = {}, opts = {}) => ctx.turned(name, F, [[s0, r], [s1, r]], style, opts);
  // A STEPPED turned part (collar → column → cap…). A single lathe of a stepped profile is drawn as its outer hull,
  // so a narrow column above a wide collar reads as a see-through cone. Build each constant-radius run as its own
  // disc item instead: segments = [[s0, s1, r], …] along F; returns the names. Smooth (curved) runs still use ctx.turned.
  ctx.stepped = (name, F, segments, style = {}, opts = {}) =>
    segments.map(([s0, s1, r, segStyle], i) => {
      const id = `${name}.${i}`;
      ctx.disc(id, F, s0, s1, r, { ...style, ...(segStyle ?? {}) }, opts);
      return id;
    });
  // a short boss standing out of a face along dir; returns its end point (where a line lands)
  ctx.boss = (name, base, dir, r, len, style = {}, opts = {}) => {
    ctx.turned(name, G.frameAlong(base, dir), [[-0.2, r], [len, r]], { tone: "mid", ...style }, { bevel: 0.2, ...opts });
    return G.add3(base, G.mul3(dir, len));
  };
  ctx.screws = (points, z, { ring = 1.2, size = 0.45 } = {}) =>
    Ln(points.map(([x, y]) => k.ring(x, y, ring, z, P, 12)).join(""), { tone: "lo" }) + Dots(points.map(([x, y]) => at([x, y, z])), { size });
  // a pipe or cable between two real ports, with connector shells; recorded for the audit
  ctx.cable = (name, points, r = 0.9, { tone = "mid", bend = 4, shells = [true, true], rings, maxLength = 12, bias = 0.05, limp = false, touch, closed = false, breaks = [] } = {}) => {
    const route = closed ? points : G.fillet(points, Math.max(bend, r * 2.6), 10, { P, tube: r });
    const total = G.pathLength(route);
    const SHELL = Math.max(1.8, r * 2.2);
    const gaps = closed ? [] : [...(shells[0] ? [[0, SHELL]] : []), ...(shells[1] ? [[total - SHELL, total]] : [])];
    R.route(name, route, r, { gaps, limp, touch, closed, rims: shells.map((on) => (on ? r * 1.6 : r)) });
    ctx.routes[name] = route;
    T.tubePieces(route, r, P, { maxLength, spacing: Math.max(0.6, Math.min(1.6, r)), gaps, closed, breaks, ...(rings ? { rings } : {}) }).forEach((piece) =>
      ctx.put(`${name}:chunk`, piece.mid, T.tubeSvg(piece, { tone }), [A.tube(piece.points, piece.radii, { touch })], { bias, attrs: ` data-route="${name}"` }),
    );
    if (!closed)
      [0, 1].forEach((index) => {
        if (!shells[index]) return;
        const end = index ? route[route.length - 1] : route[0];
        const tangent = G.tangentAlong(route, index ? total : 0);
        const F = G.frameAlong(end, tangent);
        const [s0, s1] = index ? [-SHELL, 0] : [0, SHELL];
        const shape = record(A.disc(F, s0, s1, r * 1.6, { name: `${name}.shell${index}`, owner: name }));
        ctx.put(`${name}.shell${index}`, G.add3(end, G.mul3(tangent, (s0 + s1) / 2)), S(G.disc(s0, s1, r * 1.6, F, P, { steps: 24, bevel: 0.2 }), { tone: "mid" }), [shape], { bias: bias + 0.1 });
      });
    return route;
  };
  // a live slot: an empty <g data-slot="machine:name"> placed right after (or before) a named item in the
  // settled painter's order. Moving things (packets, fluff, a spinning part rebuilt per frame) are drawn into it.
  ctx.slot = (name, where) => ctx.slots.push({ name, ...where });
  return ctx;
}

// Packets and fluff, drawn the same way at build time and in the page (see runtime.js for the page copy).
export function packetPaths(ctx, [x, y, z], { w = 10, d = 8, h = 7 } = {}) {
  const plan = { x: x - w / 2, y: y - d / 2, w, d, r: 0.6 };
  return ctx.S(ctx.k.slabOf(plan, z, h, ctx.P, 2, 0.3), { tone: "hi" }) + ctx.Ln(ctx.k.sideSeam(plan, z + h * 0.55, ctx.P, 2) + ctx.k.lineOnTop([x - w / 2, y], [x + w / 2, y], z + h, ctx.P), { tone: "lo" });
}

// page(ctx, opts): settle the order, insert the slots, write a standalone page (and its light twin).
// Options for the assembly (defaults keep every part page as it was):
// - frame: false → no card, legend or caption block: the stage fills the viewport, `overlay` (HTML) is laid over it,
//   `describe` becomes the stage's accessible description.
// - explode: true → every item is wrapped as <g class="xw" data-p data-k data-l><g class="xm">slots + item</g></g>
//   (piece, settled key, lift = move · V), so the page can move pieces and re-sort them (key + lift · share);
//   slots travel and sort with the item they are anchored to.
export function page(ctx, { out, title, fig = "Fig", hint = "", readout = "", keys = [], caption = "", live = [], boot = "", css = "", audit = {}, frame = true, overlay = "", describe = "", explode = false, settleStates = null }) {
  const { R, A: AA, P } = ctx;
  // settleStates: the explode states the depth keys are solved (and depth order audited) in; default: the kit's full set
  AA.settle(R, P, settleStates ? { states: settleStates } : undefined);
  R.items.sort((a, b) => a.key - b.key);
  const after = new Map();
  const before = new Map();
  for (const slot of ctx.slots) {
    // after / before may name several items: the slot goes after the latest (or before the earliest) of them
    const targets = [].concat(slot.after ?? slot.before);
    const found = targets.map((target) => R.items.findIndex((item) => item.name === target || item.name.startsWith(`${target}#`)));
    if (found.some((i) => i < 0)) throw new Error(`slot ${slot.name}: no item named ${targets[found.findIndex((i) => i < 0)]}`);
    const index = slot.after ? Math.max(...found) : Math.min(...found);
    const map = slot.after ? after : before;
    map.set(index, [...(map.get(index) ?? []), `<g data-slot="${slot.name}"></g>`]);
  }
  const V = ctx.V;
  const groups = R.items.map((item, index) => {
    const inner = `${(before.get(index) ?? []).join("")}<g class="it${item.material ? ` ${item.material}` : ""}" data-name="${item.name}"${item.attrs ?? ""}>${item.svg}</g>${(after.get(index) ?? []).join("")}`;
    if (!explode) return inner;
    const m = item.move ?? [0, 0, 0];
    const lift = m[0] * V[0] + m[1] * V[1] + m[2] * V[2];
    return `<g class="xw" data-p="${item.piece ?? ""}" data-k="${item.key.toFixed(4)}" data-l="${lift.toFixed(4)}"><g class="xm">${inner}</g></g>`;
  });
  const svg = ctx.k.figureSvg({ width: ctx.W, height: ctx.H, label: title, body: [...ctx.back, `<g class="fx-parts">${groups.join("")}</g>`, `<g data-slot="overlay"></g>`] });
  const latheSource = readFileSync(join(ANATOMY, "kit", "lathe.mjs"), "utf8").replace(/^import .*$/m, "").replace(/^export /gm, "");
  const latheScript = `const G = (() => {${latheSource}\nreturn { spokesOf, ribsOf, frameOf, frameAlong, pointOf, dotsOf, arcOf, circleOf, disc, sphereOf, lathe, solidOf, prismOf, viewOf, lightOf, toneOf, scaleOf, add3, sub3, mul3, dot3, unit3, cross3, len3 };})();\n`;
  const runtime = readFileSync(join(SHARED, "runtime.js"), "utf8").replace("__FACTORY_DATA__", JSON.stringify({ P, KS: ctx.KS, V: ctx.V, data: ctx.data, routes: Object.fromEntries(Object.entries(ctx.routes).map(([n, pts]) => [n, pts])) }));
  const style = readFileSync(join(SHARED, "factory.css"), "utf8") + css;
  const stage = `<div class="iso-stage fx-stage" tabindex="0" role="group" aria-label="${title}"${describe ? ` aria-describedby="fx-describe"` : ""}>${svg}<span class="fx-sr" role="status" aria-live="polite" data-status></span></div>`;
  const body = frame
    ? `<style>${style}</style>` + ctx.k.plateHtml({ fig, title, hint, readout, keys, caption, body: stage })
    : `<style>${style}</style><div class="fx-full">${stage}${overlay}<span class="fx-readout" data-readout aria-hidden="true">${readout}</span>${describe ? `<p class="fx-sr" id="fx-describe">${describe}</p>` : ""}</div>`;
  const script = kitScript() + latheScript + runtime + live.join("\n") + `\n${boot}\nFACTORY.start();`;
  for (const theme of ["light", "dark"]) {
    const file = theme === "light" ? out.replace(/\.html$/, "-light.html") : out;
    writeFileSync(file, ctx.k.pageHtml({ title, theme, body, script, width: Math.max(650, ctx.W + 60) }));
  }
  console.log("wrote", out, "+ light ·", R.items.length, "items");
  AA.auditOrExit(R, P, audit);
}
