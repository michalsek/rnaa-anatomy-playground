// Browser-side palette resolution: rebuild each palette entry's class chain as hidden probe elements under the page's
// svg.iso-svg and read getComputedStyle, so light/dark (and any CSS change) come from the page's own tokens.
// Dependency-free (inlined into the gate page; the renderer imports it).

const NS = "http://www.w3.org/2000/svg";

// parseColor("rgb(1, 2, 3)" | "rgba(1 2 3 / 0.5)" | "none") → [r, g, b, a] in 0..1, or null
export function parseColor(text) {
  const match = /^rgba?\(([^)]+)\)$/.exec(text.trim());
  if (!match) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return [parts[0] / 255, parts[1] / 255, parts[2] / 255, parts.length > 3 ? parts[3] : 1];
}

function build(entry, root, extraAttrs = {}) {
  let parent = root;
  const nodes = [];
  [...entry.ancestors, entry.el].forEach((spec, depth) => {
    const node = document.createElementNS(NS, spec.tag);
    for (const [name, value] of Object.entries(spec.attrs)) node.setAttribute(name, value);
    for (const [name, value] of Object.entries(extraAttrs[depth === entry.ancestors.length ? -1 : depth] ?? {})) node.setAttribute(name, value);
    parent.appendChild(node);
    parent = node;
    nodes.push(node);
  });
  return nodes;
}

function probeRoot(host) {
  const root = document.createElementNS(NS, "g");
  root.setAttribute("data-dl-probe", "");
  host.appendChild(root);
  return root;
}

// resolvePalette(palette, host) → [{ color: [r, g, b, a] | null, alpha, width, cap, join, blend, filter, transform, raw }]
// alpha = CSS opacity of the element and every probe ancestor × the prop's own -opacity (markup alpha is in the DL).
export function resolvePalette(palette, host) {
  const root = probeRoot(host);
  try {
    return palette.map((entry) => {
      const nodes = build(entry, root);
      const el = nodes[nodes.length - 1];
      const style = getComputedStyle(el);
      const chainOpacity = nodes.reduce((product, node) => product * Number(getComputedStyle(node).opacity), 1);
      const own = { fill: "fill-opacity", stroke: "stroke-opacity", "stop-color": "stop-opacity" }[entry.prop];
      const raw = style.getPropertyValue(entry.prop);
      const resolved = {
        id: entry.id,
        prop: entry.prop,
        raw,
        color: parseColor(raw),
        alpha: (entry.prop === "stop-color" ? 1 : chainOpacity) * Number(style.getPropertyValue(own)),
        width: parseFloat(style.strokeWidth),
        cap: style.strokeLinecap,
        join: style.strokeLinejoin,
        blend: style.mixBlendMode,
        filter: style.filter,
        transform: style.transform,
        other: entry.prop === "fill" ? style.stroke : entry.prop === "stroke" ? style.fill : "",
      };
      nodes[0].remove();
      return resolved;
    });
  } finally {
    root.remove();
  }
}

// alphaAttrsHonoured(palette, host) → entries whose markup opacity attributes are overridden by CSS (should be [])
export function alphaAttrsOverridden(palette, host) {
  const root = probeRoot(host);
  const bad = [];
  for (const entry of palette) {
    if (!entry.alphaAttrs.length) continue;
    const extra = {};
    for (const { at, name } of entry.alphaAttrs) (extra[at] ??= {})[name] = "0.5";
    const nodes = build(entry, root, extra);
    for (const { at, name } of entry.alphaAttrs) {
      const node = nodes[at < 0 ? nodes.length - 1 : at];
      if (Number(getComputedStyle(node).getPropertyValue(name)) !== 0.5) bad.push({ id: entry.id, at, name });
    }
    nodes[0].remove();
  }
  root.remove();
  return bad;
}
