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

// attrsOf(tag, attrSource) → { name: value } of one start tag's attribute text; any attribute the subset does not
// allow for that element throws
export function attrsOf(tag, source) {
  const attrs = {};
  for (const [, name, doubleQuoted, singleQuoted] of source.matchAll(ATTR)) {
    if (!isIdentityAttr(name) && !ATTRIBUTES[tag].includes(name)) throw new Error(`svgsub: <${tag} ${name}> is not supported`);
    const value = decodeEntities(doubleQuoted ?? singleQuoted ?? "");
    if (ATTRIBUTE_VALUES[name] && !ATTRIBUTE_VALUES[name].includes(value)) throw new Error(`svgsub: ${name}="${value}" is not supported (only ${ATTRIBUTE_VALUES[name].join(", ")})`);
    attrs[name] = value;
  }
  return attrs;
}

// isBlank(text, from, to): only whitespace in text[from, to) (what String.prototype.trim removes, without slicing)
function isBlank(text, from, to) {
  for (let i = from; i < to; i++) {
    const c = text.charCodeAt(i);
    if (!(c === 32 || (c >= 9 && c <= 13) || c === 0xa0 || c === 0xfeff || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000)) return false;
  }
  return true;
}

// scanTags(markup, { open(tag, attrSource, selfClosing, raw), close(tag) }) walks the markup's tags in document order
// with the same checks as parseSvg (no text content, only subset elements, balanced nesting) without building a tree;
// attribute text is handed over raw (attrsOf parses and checks it), so a caller can key caches on the tag text.
export function scanTags(markup, { open, close }) {
  const stack = [];
  let last = 0;
  for (const match of markup.matchAll(TAG)) {
    if (!isBlank(markup, last, match.index)) throw new Error(`svgsub: text content is not supported: "${markup.slice(last, match.index).trim().slice(0, 40)}"`);
    last = match.index + match[0].length;
    if (match[0].startsWith("<!--")) continue;
    const [raw, closing, tag, attrSource, selfClosing] = match;
    if (!CONTAINERS.has(tag) && !LEAVES.has(tag)) throw new Error(`svgsub: unsupported element <${tag}>`);
    if (closing) {
      const opened = stack.pop() ?? "#root";
      if (opened !== tag) throw new Error(`svgsub: </${tag}> closes <${opened}>`);
      close(tag);
      continue;
    }
    open(tag, attrSource, !!selfClosing, raw);
    if (!selfClosing) stack.push(tag);
  }
  const rest = markup.slice(last).trim();
  if (rest) throw new Error(`svgsub: unparsable markup: "${rest.slice(0, 40)}"`);
  if (stack.length) throw new Error(`svgsub: unclosed <${stack[stack.length - 1]}>`);
}

// parseSvg(markup) → root { tag: "#root", attrs, children } of { tag, attrs, children }
export function parseSvg(markup) {
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  scanTags(markup, {
    open(tag, attrSource, selfClosing) {
      const node = { tag, attrs: attrsOf(tag, attrSource), children: [] };
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) stack.push(node);
    },
    close() {
      stack.pop();
    },
  });
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
// opacityAttr(node, "fill-opacity") → the opacity attribute as a number (plain or percentage), 1 when absent
export const opacityAttr = (node, name) => numberAttr(node, name, 1, { percent: true });

// styleOf(node) → the inline style declarations (only STYLE_PROPS are allowed; anything else throws)
export function styleOf(node) {
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

// strokeWidthOf(node) → the inline style's stroke-width in CSS px (plain number or "Npx"), undefined when absent
export function strokeWidthOf(node) {
  const width = styleOf(node)["stroke-width"];
  return width === undefined ? undefined : numberOf(width, "inline stroke-width", { px: true });
}

const PATH_TOKEN = /([A-Za-z])|([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)|([\s,]+)|(.)/g;
const PATH_COMMANDS = new Set("MmLlHhVvZz");

const CODE_M = 77, CODE_L = 76, CODE_Z = 90, CODE_SPACE = 32, CODE_MINUS = 45, CODE_DOT = 46, CODE_0 = 48, CODE_9 = 57;
// integers up to 15 digits are exact in a double, and so are the powers of ten up to 10^22
const MAX_EXACT_DIGITS = 15;
const POWERS_OF_TEN = Array.from({ length: MAX_EXACT_DIGITS + 1 }, (_, k) => 10 ** k);

// kitPathData(d) → subpaths for path data in the exact form the anatomy kit's pathOf writes (absolute M / L / Z,
// plain decimals, one space between x and y, nothing between a number and the next command: "M247.9 634.1L249.6
// 625.7Z"), null for anything else. Several times faster than the general tokenizer; equal results where it applies.
function kitPathData(d) {
  const subpaths = [];
  let current = null;
  let i = 0;
  const n = d.length;
  // a decimal as an integer over a power of ten: one IEEE division, so the result is the correctly rounded value of the
  // decimal, exactly what Number(text) returns, without slicing the string
  const number = () => {
    const negative = d.charCodeAt(i) === CODE_MINUS;
    if (negative) i++;
    let mantissa = 0;
    let digits = 0;
    let decimals = -1;
    while (i < n) {
      const c = d.charCodeAt(i);
      if (c >= CODE_0 && c <= CODE_9) {
        mantissa = mantissa * 10 + (c - CODE_0);
        digits++;
        if (decimals >= 0) decimals++;
      } else if (c === CODE_DOT && decimals < 0) {
        decimals = 0;
      } else break;
      i++;
    }
    if (!digits || digits > MAX_EXACT_DIGITS) return NaN; // NaN: the general parser takes over
    const value = decimals > 0 ? mantissa / POWERS_OF_TEN[decimals] : mantissa;
    return negative ? -value : value;
  };
  while (i < n) {
    const command = d.charCodeAt(i++);
    if (command === CODE_Z) {
      if (current && !current.closed) {
        current.closed = true;
        current.drawn = true;
      }
      continue;
    }
    if (command !== CODE_M && command !== CODE_L) return null;
    const x = number();
    if (d.charCodeAt(i++) !== CODE_SPACE) return null;
    const y = number();
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (command === CODE_M) {
      current = { points: [[x, y]], closed: false, drawn: false };
      subpaths.push(current);
      continue;
    }
    if (!current) return null; // the general parser rejects a path that does not start with M
    if (current.closed) {
      // a lineto after Z starts a new subpath at the closed subpath's first point
      const [sx, sy] = current.points[0];
      current = { points: [[sx, sy]], closed: false, drawn: false };
      subpaths.push(current);
    }
    current.points.push([x, y]);
    current.drawn = true;
  }
  return subpaths;
}

// parsePathData(d) → [{ points: [[x, y]…], closed, drawn }] — drawn: the subpath has a drawing command (a lone M has
// not). Curves, arcs and any other command letter or stray character throw.
export function parsePathData(d) {
  return kitPathData(d) ?? parseGeneralPathData(d);
}

function parseGeneralPathData(d) {
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

// drawnLeafCount(node) → path / circle elements drawn under node (defs excluded)
export const drawnLeafCount = (node) => (DRAWN.has(node.tag) ? 1 : node.tag === "defs" ? 0 : node.children.reduce((n, child) => n + drawnLeafCount(child), 0));

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
      out.push({
        tag: child.tag,
        attrs: child.attrs,
        chain,
        opacity: opacity * own,
        fillOpacity: opacityAttr(child, "fill-opacity"),
        strokeOpacity: opacityAttr(child, "stroke-opacity"),
        strokeWidth: strokeWidthOf(child),
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
