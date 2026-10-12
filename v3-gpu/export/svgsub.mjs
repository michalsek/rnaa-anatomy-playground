// Isomorphic parser for the SVG subset the anatomy kit emits (no DOM, no Node APIs: it also runs in the page for the
// live adapter). Elements: g, path, circle, defs, linearGradient, stop. Path data: M/L/H/V/Z (absolute + relative).
// Anything else throws, so a new kit feature is noticed instead of silently dropped.

const CONTAINERS = new Set(["g", "defs", "linearGradient"]);
const LEAVES = new Set(["path", "circle", "stop"]);
const TAG = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+(?:\s*=\s*"[^"]*")?)*)\s*(\/?)>|<!--[\s\S]*?-->/g;
const ATTR = /([\w:-]+)(?:\s*=\s*"([^"]*)")?/g;
const ENTITIES = { "&amp;": "&", "&quot;": '"', "&lt;": "<", "&gt;": ">", "&#39;": "'" };

const unescape = (text) => text.replace(/&(amp|quot|lt|gt|#39);/g, (m) => ENTITIES[m]);

function attrsOf(source) {
  const attrs = {};
  for (const [, name, value] of source.matchAll(ATTR)) attrs[name] = value === undefined ? "" : unescape(value);
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
      const open = stack.pop();
      if (open.tag !== tag) throw new Error(`svgsub: </${tag}> closes <${open.tag}>`);
      continue;
    }
    const node = { tag, attrs: attrsOf(attrSource), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (markup.slice(last).trim()) throw new Error("svgsub: trailing text");
  if (stack.length !== 1) throw new Error(`svgsub: unclosed <${stack[stack.length - 1].tag}>`);
  return root;
}

// parseStyle("stroke-width:1.3") → { "stroke-width": "1.3" }
export function parseStyle(style = "") {
  const out = {};
  for (const declaration of style.split(";")) {
    const at = declaration.indexOf(":");
    if (at > 0) out[declaration.slice(0, at).trim()] = declaration.slice(at + 1).trim();
  }
  return out;
}

const NUMBER = /[MmLlHhVvZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

// parsePathData(d) → [{ points: [[x, y]…], closed, drawn }] — drawn: the subpath has a drawing command (a lone M has not)
export function parsePathData(d) {
  const tokens = d.match(NUMBER) ?? [];
  if (/[CcSsQqTtAa]/.test(d)) throw new Error(`svgsub: curve commands are not supported: ${d.slice(0, 60)}`);
  const subpaths = [];
  let current = null;
  let x = 0;
  let y = 0;
  let command = "";
  const start = () => {
    current = { points: [[x, y]], closed: false, drawn: false };
    subpaths.push(current);
  };
  const lineTo = (nx, ny) => {
    if (!current || current.closed) start();
    x = nx;
    y = ny;
    current.points.push([x, y]);
    current.drawn = true;
  };
  for (let i = 0; i < tokens.length; ) {
    if (/[A-Za-z]/.test(tokens[i])) command = tokens[i++];
    else if (!command) throw new Error(`svgsub: path data must start with a command: ${d.slice(0, 40)}`);
    const next = () => {
      const value = Number(tokens[i++]);
      if (!Number.isFinite(value)) throw new Error(`svgsub: bad number in path data: ${d.slice(0, 40)}`);
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
        start();
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
      default:
        throw new Error(`svgsub: unsupported path command ${command}`);
    }
  }
  return subpaths;
}

const OPACITY_ATTRS = ["opacity", "fill-opacity", "stroke-opacity", "stop-opacity"];
const numberOr = (value, fallback) => (value === undefined || value === "" ? fallback : Number(value));

// drawables(root) → every path / circle / stop with its ancestor chain, the opacity attributes multiplied down
// the tree, and the gradients defined anywhere in the fragment (url(#id) is resolved by the caller).
export function drawables(root) {
  const out = [];
  const gradients = {};
  const visit = (node, chain, opacity) => {
    for (const child of node.children) {
      const own = numberOr(child.attrs.opacity, 1);
      if (child.tag === "linearGradient") gradients[child.attrs.id] = gradientOf(child, [...chain, child]);
      if (CONTAINERS.has(child.tag)) {
        if (child.tag === "g") visit(child, [...chain, child], opacity * own);
        else visit(child, [...chain, child], opacity);
        continue;
      }
      if (child.tag === "stop") continue;
      out.push({
        tag: child.tag,
        attrs: child.attrs,
        chain,
        opacity: opacity * own,
        fillOpacity: numberOr(child.attrs["fill-opacity"], 1),
        strokeOpacity: numberOr(child.attrs["stroke-opacity"], 1),
        style: parseStyle(child.attrs.style),
        groupOpacity: chain.some((g) => g.tag === "g" && g.attrs.opacity !== undefined && g.children.length > 1),
      });
    }
  };
  visit(root, [], 1);
  return { elements: out, gradients };
}

function gradientOf(node, chain) {
  const units = node.attrs.gradientUnits ?? "objectBoundingBox";
  if (units !== "userSpaceOnUse") throw new Error(`svgsub: gradient ${node.attrs.id}: only userSpaceOnUse is supported`);
  return {
    id: node.attrs.id,
    node,
    x1: Number(node.attrs.x1 ?? 0),
    y1: Number(node.attrs.y1 ?? 0),
    x2: Number(node.attrs.x2 ?? 0),
    y2: Number(node.attrs.y2 ?? 0),
    stops: node.children.map((stop) => ({ node: stop, chain, offset: Number(stop.attrs.offset ?? 0), alpha: numberOr(stop.attrs["stop-opacity"], 1) })),
  };
}

// urlRef("url(#a)") → "a"
export const urlRef = (value) => /^url\(#([^)]+)\)$/.exec(value ?? "")?.[1] ?? null;
export { OPACITY_ATTRS };
