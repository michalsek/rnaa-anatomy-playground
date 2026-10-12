// Browser-side palette resolution: rebuild each palette entry's class chain as hidden probe elements under the page's
// svg.iso-svg and read getComputedStyle, so light/dark (and any CSS change) come from the page's own tokens.
// Dependency-free (bundled into the gate page; the renderer imports it).

const NS = "http://www.w3.org/2000/svg";

// parseColor(computed colour) → [r, g, b, a] in 0..1 for "rgb(…)" / "rgba(…)" (alpha as a number or a percentage),
// null for "none" and paint servers ("url(…)", resolved through json.gradients). Any other syntax (oklch(), color(),
// a keyword) throws: the renderer would otherwise draw it as none.
export function parseColor(text) {
  const trimmed = text.trim();
  if (trimmed === "none" || trimmed.startsWith("url(")) return null;
  const match = /^rgba?\(([^)]+)\)$/.exec(trimmed);
  if (!match) throw new Error(`palette-probe: unsupported computed colour "${text}"`);
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  const alpha = parts.length > 3 ? (parts[3].endsWith("%") ? Number(parts[3].slice(0, -1)) / 100 : Number(parts[3])) : 1;
  const color = [Number(parts[0]) / 255, Number(parts[1]) / 255, Number(parts[2]) / 255, alpha];
  if (parts.length < 3 || color.some((c) => !Number.isFinite(c))) throw new Error(`palette-probe: unparsable computed colour "${text}"`);
  return color;
}

// buildProbeChain(entry, root, extraAttrs) → the probe nodes for ancestors… el, appended under root. extraAttrs maps a
// chain depth (-1 = el) to attributes added on top of the recipe's.
function buildProbeChain(entry, root, extraAttrs = {}) {
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

// withProbeRoot(host, use) → use(root): a hidden <g> under host for probe chains, removed afterwards even on throw
function withProbeRoot(host, use) {
  const root = document.createElementNS(NS, "g");
  root.setAttribute("data-dl-probe", "");
  host.appendChild(root);
  try {
    return use(root);
  } finally {
    root.remove();
  }
}

const OWN_OPACITY = { fill: "fill-opacity", stroke: "stroke-opacity", "stop-color": "stop-opacity" };
const OTHER_PAINT = { fill: "stroke", stroke: "fill" };

// resolvePalette(palette, host) → per entry { id, prop, raw, color: [r, g, b, a] | null, alpha, width, cap, join,
// blend, filter, transform, other, fillRule, dashArray, clipPath, mask }. alpha = CSS opacity of the element and every
// probe ancestor × the prop's own -opacity (markup alpha is in the DL); other = the computed opposite paint (fill for
// a stroke entry and vice versa). Every chain is built before any style is read, so the page recalculates style once.
export function resolvePalette(palette, host) {
  return withProbeRoot(host, (root) => {
    const chains = palette.map((entry) => buildProbeChain(entry, root));
    return palette.map((entry, i) => {
      const nodes = chains[i];
      const style = getComputedStyle(nodes[nodes.length - 1]);
      const chainOpacity = nodes.reduce((product, node) => product * Number(getComputedStyle(node).opacity), 1);
      const raw = style.getPropertyValue(entry.prop);
      return {
        id: entry.id,
        prop: entry.prop,
        raw,
        color: parseColor(raw),
        alpha: (entry.prop === "stop-color" ? 1 : chainOpacity) * Number(style.getPropertyValue(OWN_OPACITY[entry.prop])),
        width: parseFloat(style.strokeWidth),
        cap: style.strokeLinecap,
        join: style.strokeLinejoin,
        blend: style.mixBlendMode,
        filter: style.filter,
        transform: style.transform,
        other: OTHER_PAINT[entry.prop] ? style.getPropertyValue(OTHER_PAINT[entry.prop]) : "",
        fillRule: style.fillRule,
        dashArray: style.strokeDasharray,
        clipPath: style.clipPath,
        mask: style.mask,
      };
    });
  });
}

// alphaAttrsOverridden(palette, host) → [{ id, at, name }] where CSS overrides an opacity attribute the markup carried
// (should be []: the DL assumes markup opacity attributes take effect)
export function alphaAttrsOverridden(palette, host) {
  return withProbeRoot(host, (root) => {
    const probed = palette.filter((entry) => entry.alphaAttrs.length).map((entry) => {
      const extra = {};
      for (const { at, name } of entry.alphaAttrs) (extra[at] ??= {})[name] = "0.5";
      return { entry, nodes: buildProbeChain(entry, root, extra) };
    });
    const overridden = [];
    for (const { entry, nodes } of probed)
      for (const { at, name } of entry.alphaAttrs) {
        const node = nodes[at < 0 ? nodes.length - 1 : at];
        if (Number(getComputedStyle(node).getPropertyValue(name)) !== 0.5) overridden.push({ id: entry.id, at, name });
      }
    return overridden;
  });
}
