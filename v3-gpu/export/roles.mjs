// What each kit element paints, mirroring the kit CSS (iso-kit ISO_CSS, factory.css, the centrifuge CSS). Colour is
// never decided here (the palette is resolved from CSS at runtime); only which props paint and the stroke geometry.
// The gate probes every rule below in Chrome (ROLE_PROBES, whether or not the scene uses the class) and fails when
// the computed fill / stroke / width / cap / join differ, so drift in the CSS is caught.

const LINE = { width: 0.6, cap: "round", join: "round" }; // .iso-line: var(--anatomy-weight) .6px, round/round
const RING = { width: 0.45, cap: "butt", join: "round" }; // .tb-ring
const SEAM = { width: 0.4, cap: "butt", join: "round" }; // .iso-solid[data-seamless] > .iso-shade/.iso-top
const WIRE_END = { width: 0.6, cap: "butt", join: "miter" }; // .iso-wire-end sets only stroke-width: SVG defaults
const FLUFF = { width: 0.5, cap: "butt", join: "miter" }; // .fx-fluff circle

const STROKE_PATHS = { "iso-line": LINE, "tb-ring": RING };
const FILL_PATHS = ["iso-fill", "tb-body", "tb-shine", "tb-shade", "cf-strobe", "cf-void", "cf-glow", "cf-glow-soft", "iso-halo"];
const SEAMABLE = ["iso-shade", "iso-top"];
const UNSUPPORTED_ATTRS = {
  "data-dotted": "dashed strokes",
  "data-dashed": "dashed strokes",
  "data-flow": "animated dashed strokes",
  "data-pulse": "pulsing dots (CSS animation)",
};

const classesOf = (node) => (node?.attrs.class ?? "").split(/\s+/).filter(Boolean);
const has = (node, name) => classesOf(node).includes(name);

// roleOf({ tag, attrs, chain }) → { fill: bool, stroke: stroke geometry | null, special: { halo?, blend?, seamless? } }
export function roleOf({ tag, attrs, chain }) {
  const own = classesOf({ attrs });
  const parent = chain[chain.length - 1];
  const special = {};
  for (const [name, feature] of Object.entries(UNSUPPORTED_ATTRS)) if (attrs[name] !== undefined) throw new Error(`roles: ${feature} (${name}) are not supported`);
  if (own.includes("iso-halo")) special.halo = true;
  if (own.includes("cf-glow")) special.blend = true; // mix-blend-mode: multiply (light) / screen (dark), resolved by probe
  if (tag === "circle") {
    if (chain.some((g) => has(g, "iso-dots")) || own.some((c) => c.startsWith("cf-glow"))) return { fill: true, stroke: null, special };
    if (own.includes("iso-wire-end")) return { fill: true, stroke: WIRE_END, special };
    if (chain.some((g) => has(g, "fx-fluff"))) return { fill: true, stroke: own.includes("fx-fluff-hi") ? null : FLUFF, special };
    throw new Error(`roles: unknown circle class "${attrs.class ?? ""}"`);
  }
  if (tag !== "path") throw new Error(`roles: unexpected <${tag}>`);
  const strokeClass = own.find((c) => STROKE_PATHS[c]);
  if (strokeClass) return { fill: false, stroke: STROKE_PATHS[strokeClass], special };
  if (own.some((c) => SEAMABLE.includes(c))) {
    const seamless = has(parent, "iso-solid") && parent.attrs["data-seamless"] !== undefined;
    if (seamless) special.seamless = true;
    return { fill: true, stroke: seamless ? SEAM : null, special };
  }
  if (own.some((c) => FILL_PATHS.includes(c))) return { fill: true, stroke: null, special };
  throw new Error(`roles: unknown path class "${attrs.class ?? ""}"`);
}

// One synthetic element per rule of roleOf, as palette-style probe recipes ({ ancestors, el }). The gate builds each
// in the page and compares getComputedStyle with roleOf(probe).
const ITEM_CHAIN = [{ tag: "g", attrs: { class: "fx-parts" } }, { tag: "g", attrs: { class: "it" } }];
const probe = (tag, attrs, ancestors = []) => ({ ancestors: [...ITEM_CHAIN, ...ancestors], el: { tag, attrs } });
const SEAMLESS_SOLID = { tag: "g", attrs: { class: "iso-solid", "data-seamless": "" } };
export const ROLE_PROBES = [
  ...Object.keys(STROKE_PATHS).map((name) => probe("path", { class: name, "data-tone": "lo" })),
  ...FILL_PATHS.map((name) => probe("path", { class: name })),
  ...SEAMABLE.flatMap((name) => [probe("path", { class: name, "data-shade": "1" }), probe("path", { class: name, "data-shade": "1" }, [SEAMLESS_SOLID])]),
  probe("circle", {}, [{ tag: "g", attrs: { class: "iso-dots", "data-tone": "mid" } }]),
  probe("circle", { class: "cf-glow" }),
  probe("circle", { class: "cf-glow-soft" }),
  probe("circle", { class: "iso-wire-end" }),
  probe("circle", {}, [{ tag: "g", attrs: { class: "fx-fluff" } }]),
  probe("circle", { class: "fx-fluff-hi" }, [{ tag: "g", attrs: { class: "fx-fluff" } }]),
];
