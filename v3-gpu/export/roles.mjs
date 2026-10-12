// What each kit element paints, mirroring the kit CSS (iso-kit ISO_CSS, factory.css, the centrifuge CSS). Colour is
// never decided here (the palette is resolved from CSS at runtime); only which props paint and the stroke geometry.
// The gate cross-checks every assumption against getComputedStyle, so drift in the CSS fails the gate.

const LINE = { width: 0.6, cap: "round", join: "round" }; // .iso-line: var(--anatomy-weight) .6px, round/round
const RING = { width: 0.45, cap: "butt", join: "round" }; // .tb-ring
const SEAM = { width: 0.4, cap: "butt", join: "round" }; // .iso-solid[data-seamless] > .iso-shade/.iso-top
const FLUFF = { width: 0.5, cap: "butt", join: "miter" }; // .fx-fluff circle

const FILLS = new Set(["iso-fill", "tb-body", "tb-shine", "tb-shade", "cf-strobe", "cf-void", "cf-glow", "cf-glow-soft", "iso-halo"]);
const SEAMABLE = new Set(["iso-shade", "iso-top"]);

const classesOf = (node) => (node?.attrs.class ?? "").split(/\s+/).filter(Boolean);
const has = (node, name) => classesOf(node).includes(name);

// roleOf(element) → { fill: bool, stroke: stroke geometry | null, dot: bool, special: { halo?, blend? } }
export function roleOf({ tag, attrs, chain }) {
  const own = classesOf({ attrs });
  const parent = chain[chain.length - 1];
  const special = {};
  for (const dash of ["data-dotted", "data-dashed", "data-flow"]) if (attrs[dash] !== undefined) throw new Error(`roles: dashed strokes (${dash}) are not supported`);
  if (own.includes("iso-halo")) special.halo = true;
  if (own.includes("cf-glow")) special.blend = true; // mix-blend-mode: multiply (light) / screen (dark), resolved by probe
  if (attrs.fill && attrs.fill.startsWith("url(")) special.gradient = true;
  if (tag === "circle") {
    if (chain.some((g) => has(g, "iso-dots")) || own.some((c) => c.startsWith("cf-glow"))) return { fill: true, stroke: null, dot: true, special };
    if (own.includes("iso-wire-end")) return { fill: true, stroke: LINE, dot: true, special };
    if (chain.some((g) => has(g, "fx-fluff"))) return { fill: true, stroke: own.includes("fx-fluff-hi") ? null : FLUFF, dot: true, special };
    throw new Error(`roles: unknown circle class "${attrs.class ?? ""}"`);
  }
  if (tag !== "path") throw new Error(`roles: unexpected <${tag}>`);
  if (own.includes("iso-line") || own.includes("tb-edge")) return { fill: false, stroke: LINE, dot: false, special };
  if (own.includes("tb-ring")) return { fill: false, stroke: RING, dot: false, special };
  if (own.some((c) => SEAMABLE.has(c))) {
    const seamless = has(parent, "iso-solid") && parent.attrs["data-seamless"] !== undefined;
    if (seamless) special.seamless = true;
    return { fill: true, stroke: seamless ? SEAM : null, dot: false, special };
  }
  if (own.some((c) => FILLS.has(c))) return { fill: true, stroke: null, dot: false, special };
  throw new Error(`roles: unknown path class "${attrs.class ?? ""}"`);
}
