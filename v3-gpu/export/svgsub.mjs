// Isomorphic parser for the SVG subset the anatomy kit emits (no DOM, no Node APIs: it also runs in the page for the
// live adapter). Elements: g, path, circle, defs > linearGradient > stop. Path data: M/L/H/V/Z (absolute + relative).
// Each element accepts only the attributes in ATTRIBUTES (plus class / id / role / data-* / aria-*), numbers must be
// plain numbers, and anything else throws, so a new kit feature is noticed instead of silently dropped.

const CONTAINERS = new Set(["g", "defs", "linearGradient"]);
const LEAVES = new Set(["path", "circle", "stop"]);
const DRAWN = new Set(["path", "circle"]);
export const OPACITY_ATTRS = ["opacity", "fill-opacity", "stroke-opacity", "stop-opacity"];
const ATTRIBUTES = {
  g: ["opacity"],
  path: ["d", "fill", "stroke", "opacity", "fill-opacity", "stroke-opacity", "fill-rule", "style"],
  circle: ["cx", "cy", "r", "fill", "stroke", "opacity", "fill-opacity", "stroke-opacity", "style"],
  defs: [],
  linearGradient: ["gradientUnits", "x1", "y1", "x2", "y2"],
  stop: ["offset", "stop-color", "stop-opacity"],
};
const ATTRIBUTE_VALUES = { "fill-rule": ["nonzero"] }; // the only fill rule the tessellator implements
const IDENTITY_ATTRS = new Set(["class", "id", "role"]);
const isIdentityAttr = (name) => IDENTITY_ATTRS.has(name) || name.startsWith("data-") || name.startsWith("aria-");
const STYLE_PROPS = new Set(["stroke-width"]);

const QUOTED = `(?:"[^"]*"|'[^']*')`;
const TAG = new RegExp(`<(\\/?)([A-Za-z][\\w:-]*)((?:\\s+[\\w:-]+(?:\\s*=\\s*${QUOTED})?)*)\\s*(\\/?)>|<!--[\\s\\S]*?-->`, "g");
const ATTR = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;
const NAMED_ENTITIES = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };

// decodeEntities("a &amp; b &#39;c&#x27;") → "a & b 'c'"; an unknown named entity throws
function decodeEntities(text) {
  return text.replace(/&(#[0-9]+|#x[0-9a-fA-F]+|[A-Za-z]+);/g, (entity, body) => {
    if (body.startsWith("#x")) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(parseInt(body.slice(1), 10));
    if (NAMED_ENTITIES[body] === undefined) throw new Error(`svgsub: unknown entity ${entity}`);
    return NAMED_ENTITIES[body];
  });
}

function attrsOf(tag, source) {
  const attrs = {};
  for (const [, name, doubleQuoted, singleQuoted] of source.matchAll(ATTR)) {
    if (!isIdentityAttr(name) && !ATTRIBUTES[tag].includes(name)) throw new Error(`svgsub: <${tag} ${name}> is not supported`);
    const value = decodeEntities(doubleQuoted ?? singleQuoted ?? "");
    if (ATTRIBUTE_VALUES[name] && !ATTRIBUTE_VALUES[name].includes(value)) throw new Error(`svgsub: ${name}="${value}" is not supported (only ${ATTRIBUTE_VALUES[name].join(", ")})`);
    attrs[name] = value;
  }
  return attrs;
}

// parseSvg(markup) → root { tag: "#root", attrs, children } of { tag, attrs, children }
export function parseSvg(markup) {
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  let last = 0;
  for (const match of markup.matchAll(TAG)) {
    const between = markup.slice(last, match.index);
    if (between.trim()) throw new Error(`svgsub: text content is not supported: "${between.trim().slice(0, 40)}"`);
    last = match.index + match[0].length;
    if (match[0].startsWith("<!--")) continue;
    const [, closing, tag, attrSource, selfClosing] = match;
    if (!CONTAINERS.has(tag) && !LEAVES.has(tag)) throw new Error(`svgsub: unsupported element <${tag}>`);
    if (closing) {
      const open = stack.length > 1 ? stack.pop() : root;
      if (open.tag !== tag) throw new Error(`svgsub: </${tag}> closes <${open.tag}>`);
      continue;
    }
    const node = { tag, attrs: attrsOf(tag, attrSource), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  const rest = markup.slice(last).trim();
  if (rest) throw new Error(`svgsub: unparsable markup: "${rest.slice(0, 40)}"`);
  if (stack.length !== 1) throw new Error(`svgsub: unclosed <${stack[stack.length - 1].tag}>`);
  return root;
}

const PLAIN_NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

// numberOf(text, what, { percent, px }) → finite number. Plain numbers only; "%" (÷ 100) and "px" suffixes only where
// the caller allows them, any other unit throws.
function numberOf(text, what, { percent = false, px = false } = {}) {
  const trimmed = text.trim();
  if (PLAIN_NUMBER.test(trimmed)) return Number(trimmed);
  if (percent && trimmed.endsWith("%") && PLAIN_NUMBER.test(trimmed.slice(0, -1))) return Number(trimmed.slice(0, -1)) / 100;
  if (px && trimmed.endsWith("px") && PLAIN_NUMBER.test(trimmed.slice(0, -2))) return Number(trimmed.slice(0, -2));
  throw new Error(`svgsub: ${what} "${text}" is not a plain number`);
}

// numberAttr(node, "cx", 0) → the attribute as a number, fallback when absent
export function numberAttr(node, name, fallback, units = {}) {
  const value = node.attrs[name];
  return value === undefined ? fallback : numberOf(value, `<${node.tag} ${name}>`, units);
}
const opacityAttr = (node, name) => numberAttr(node, name, 1, { percent: true });

function styleOf(node) {
  const style = {};
  for (const declaration of (node.attrs.style ?? "").split(";")) {
    if (!declaration.trim()) continue;
    const at = declaration.indexOf(":");
    const name = at > 0 ? declaration.slice(0, at).trim() : declaration.trim();
    if (!STYLE_PROPS.has(name)) throw new Error(`svgsub: inline style "${name}" is not supported`);
    style[name] = declaration.slice(at + 1).trim();
  }
  return style;
}

const PATH_TOKEN = /([A-Za-z])|([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)|([\s,]+)|(.)/g;
const PATH_COMMANDS = new Set("MmLlHhVvZz");

// parsePathData(d) → [{ points: [[x, y]…], closed, drawn }] — drawn: the subpath has a drawing command (a lone M has
// not). Curves, arcs and any other command letter or stray character throw.
export function parsePathData(d) {
  const tokens = [];
  for (const [, letter, number, , stray] of d.matchAll(PATH_TOKEN)) {
    if (stray !== undefined) throw new Error(`svgsub: unexpected "${stray}" in path data: ${d.slice(0, 60)}`);
    if (letter !== undefined && !PATH_COMMANDS.has(letter)) throw new Error(`svgsub: unsupported path command ${letter}: ${d.slice(0, 60)}`);
    if (letter !== undefined) tokens.push(letter);
    else if (number !== undefined) tokens.push(Number(number));
  }
  const subpaths = [];
  let current = null;
  let x = 0;
  let y = 0;
  let command = "";
  const startSubpath = () => {
    current = { points: [[x, y]], closed: false, drawn: false };
    subpaths.push(current);
  };
  const lineTo = (nx, ny) => {
    if (!current || current.closed) startSubpath();
    x = nx;
    y = ny;
    current.points.push([x, y]);
    current.drawn = true;
  };
  for (let i = 0; i < tokens.length; ) {
    if (typeof tokens[i] === "string") command = tokens[i++];
    else if (!command) throw new Error(`svgsub: path data must start with a command: ${d.slice(0, 40)}`);
    const next = () => {
      const value = tokens[i++];
      if (typeof value !== "number") throw new Error(`svgsub: missing number in path data: ${d.slice(0, 40)}`);
      return value;
    };
    switch (command) {
      case "M":
      case "m": {
        const relative = command === "m" && current;
        const nx = next();
        const ny = next();
        x = relative ? x + nx : nx;
        y = relative ? y + ny : ny;
        startSubpath();
        command = command === "m" ? "l" : "L"; // extra pairs after a moveto are implicit linetos
        break;
      }
      case "L": lineTo(next(), next()); break;
      case "l": { const dx = next(); lineTo(x + dx, y + next()); break; }
      case "H": lineTo(next(), y); break;
      case "h": lineTo(x + next(), y); break;
      case "V": lineTo(x, next()); break;
      case "v": lineTo(x, y + next()); break;
      case "Z":
      case "z":
        if (current && !current.closed) {
          current.closed = true;
          current.drawn = true;
          [x, y] = current.points[0];
        }
        command = "";
        break;
    }
  }
  return subpaths;
}

const drawnLeafCount = (node) => (DRAWN.has(node.tag) ? 1 : node.tag === "defs" ? 0 : node.children.reduce((n, child) => n + drawnLeafCount(child), 0));

// drawables(root) → every path / circle with its ancestor chain, the opacity attributes multiplied down the tree, and
// the gradients defined anywhere in the fragment (url(#id) is resolved by the caller). `groupOpacity` marks elements
// inside a <g opacity> that draws more than one element: folding that opacity into each element is exact only while
// those elements do not overlap.
export function drawables(root) {
  const out = [];
  const gradients = {};
  const visit = (node, chain, opacity, inSharedOpacityGroup) => {
    for (const child of node.children) {
      if (node.tag === "defs" && child.tag !== "linearGradient") throw new Error(`svgsub: <${child.tag}> inside <defs> is not supported (only linearGradient)`);
      const own = opacityAttr(child, "opacity");
      if (child.tag === "linearGradient") {
        if (node.tag !== "defs") throw new Error("svgsub: <linearGradient> outside <defs> is not supported");
        gradients[child.attrs.id] = gradientOf(child, [...chain, child]);
        continue;
      }
      if (child.tag === "g") {
        const shared = inSharedOpacityGroup || (child.attrs.opacity !== undefined && drawnLeafCount(child) > 1);
        visit(child, [...chain, child], opacity * own, shared);
        continue;
      }
      if (child.tag === "defs") {
        visit(child, [...chain, child], opacity, inSharedOpacityGroup);
        continue;
      }
      if (child.tag === "stop") throw new Error("svgsub: <stop> outside <linearGradient>");
      const style = styleOf(child);
      out.push({
        tag: child.tag,
        attrs: child.attrs,
        chain,
        opacity: opacity * own,
        fillOpacity: opacityAttr(child, "fill-opacity"),
        strokeOpacity: opacityAttr(child, "stroke-opacity"),
        strokeWidth: style["stroke-width"] === undefined ? undefined : numberOf(style["stroke-width"], "inline stroke-width", { px: true }),
        groupOpacity: inSharedOpacityGroup,
      });
    }
  };
  visit(root, [], 1, false);
  return { elements: out, gradients };
}

function gradientOf(node, chain) {
  const units = node.attrs.gradientUnits ?? "objectBoundingBox";
  if (units !== "userSpaceOnUse") throw new Error(`svgsub: gradient ${node.attrs.id}: only userSpaceOnUse is supported`);
  for (const child of node.children) if (child.tag !== "stop") throw new Error(`svgsub: <${child.tag}> inside <linearGradient>`);
  // the SVG defaults (x2 = 100 % of the viewport) are not modelled, so the kit must spell out every coordinate
  const coordinate = (name) => {
    if (node.attrs[name] === undefined) throw new Error(`svgsub: gradient ${node.attrs.id}: ${name} is required`);
    return numberAttr(node, name);
  };
  return {
    id: node.attrs.id,
    node,
    x1: coordinate("x1"),
    y1: coordinate("y1"),
    x2: coordinate("x2"),
    y2: coordinate("y2"),
    stops: node.children.map((stop) => ({ node: stop, chain, offset: numberAttr(stop, "offset", 0, { percent: true }), alpha: opacityAttr(stop, "stop-opacity") })),
  };
}

// urlRef("url(#a)") → "a"
export const urlRef = (value) => /^url\(#([^)]+)\)$/.exec(value ?? "")?.[1] ?? null;
