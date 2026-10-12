// Minimal SVG-item → GpuScene converter for the M2 synthetic fixture and calibration pages.
// It only understands what the anatomy kit emits (path d with M/L/Z, circle, g, defs/linearGradient/stop)
// and is NOT the M1 exporter: the real centrifuge goes through export/ → out/dl → src/dl-loader.ts.
// Style is never resolved here: every drawable becomes a probe descriptor (its class chain), which the
// renderer resolves in the page with getComputedStyle — the same contract M1's palette table follows.
import libtess from "libtess";

const GEOMETRY_ATTRS = new Set(["data-name", "d", "cx", "cy", "r", "x1", "y1", "x2", "y2", "points", "id", "offset"]);

function tokenize(svg) {
  const tokens = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*(\/?)>/g;
  let match;
  while ((match = re.exec(svg))) {
    const [, closing, tag, attrText, selfClosing] = match;
    const attrs = {};
    for (const a of attrText.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? "";
    tokens.push({ closing: !!closing, tag, attrs, selfClosing: !!selfClosing });
  }
  return tokens;
}

export function subpathsOf(d) {
  const subpaths = [];
  let current = null;
  const re = /([MLZmlz])|(-?\d*\.?\d+(?:e-?\d+)?)/g;
  let command = null;
  const numbers = [];
  const flush = () => {
    if (!command) return;
    if (command === "M" || command === "L") {
      for (let i = 0; i + 1 < numbers.length; i += 2) {
        const point = [numbers[i], numbers[i + 1]];
        if (command === "M" && i === 0) {
          current = { points: [point], closed: false };
          subpaths.push(current);
        } else current.points.push(point);
      }
    } else if (command === "Z" && current) {
      current.closed = true;
      const start = current.points[0];
      current = { points: [start], closed: false, implicit: true };
      subpaths.push(current);
    }
    numbers.length = 0;
  };
  let m;
  while ((m = re.exec(d))) {
    if (m[1]) {
      flush();
      command = m[1].toUpperCase();
      if (command === "Z") flush();
    } else numbers.push(Number(m[2]));
  }
  flush();
  return subpaths.filter((s) => !(s.implicit && s.points.length < 2) && s.points.length >= 1);
}

function tessellate(subpaths, out) {
  const tess = new libtess.GluTesselator();
  tess.gluTessCallback(libtess.gluEnum.GLU_TESS_VERTEX_DATA, (data, poly) => poly.push(data[0], data[1]));
  tess.gluTessCallback(libtess.gluEnum.GLU_TESS_BEGIN, () => {});
  tess.gluTessCallback(libtess.gluEnum.GLU_TESS_ERROR, (e) => console.warn("libtess error", e));
  tess.gluTessCallback(libtess.gluEnum.GLU_TESS_COMBINE, (coords) => [coords[0], coords[1], coords[2]]);
  tess.gluTessCallback(libtess.gluEnum.GLU_TESS_EDGE_FLAG, () => {});
  tess.gluTessProperty(libtess.gluEnum.GLU_TESS_WINDING_RULE, libtess.windingRule.GLU_TESS_WINDING_NONZERO);
  tess.gluTessNormal(0, 0, 1);
  const before = out.length;
  tess.gluTessBeginPolygon(out);
  for (const s of subpaths) {
    if (s.points.length < 3) continue;
    tess.gluTessBeginContour();
    for (const [x, y] of s.points) tess.gluTessVertex([x, y, 0], [x, y, 0]);
    tess.gluTessEndContour();
  }
  tess.gluTessEndPolygon();
  return (out.length - before) / 2;
}

/**
 * items: [{ name, key, lift?, move?, svg }] in any order (the renderer sorts by key).
 * Returns the GpuScene wire object (typed arrays still as plain arrays; see encodeScene).
 */
export function itemsToScene({ viewBox, items, svgClass = "iso-svg" }) {
  const scene = { version: 1, viewBox, svgClass, items: [], paints: [], fills: [], strokes: [], dots: [], tris: [], points: [] };
  const paintIndex = new Map();
  const paintOf = (desc) => {
    const id = JSON.stringify(desc);
    if (!paintIndex.has(id)) {
      paintIndex.set(id, scene.paints.length);
      scene.paints.push(desc);
    }
    return paintIndex.get(id);
  };
  const strip = (tag, attrs) => {
    const kept = {};
    for (const [k, v] of Object.entries(attrs)) {
      if (GEOMETRY_ATTRS.has(k) || (k === "fill" && v.startsWith("url("))) continue;
      kept[k] = v;
    }
    return { tag, attrs: kept };
  };

  items.forEach((item, itemIndex) => {
    const tokens = tokenize(item.svg);
    const stack = [];
    const gradients = new Map();
    let layer = 0;
    let gradient = null;
    for (const t of tokens) {
      if (t.closing) {
        if (t.tag === "linearGradient") gradient = null;
        if (t.tag === "g") layer++;
        stack.pop();
        continue;
      }
      const chain = [...stack.filter((s) => s.tag !== "defs" && s.tag !== "linearGradient"), strip(t.tag, t.attrs)];
      if (t.tag === "linearGradient") {
        gradient = { x1: +t.attrs.x1, y1: +t.attrs.y1, x2: +t.attrs.x2, y2: +t.attrs.y2, units: t.attrs.gradientUnits ?? "objectBoundingBox", stops: [] };
        gradients.set(t.attrs.id, gradient);
      } else if (t.tag === "stop" && gradient) {
        gradient.stops.push({ offset: Number(t.attrs.offset), chain: [strip("stop", t.attrs)] });
      } else if (t.tag === "path" && t.attrs.d) {
        const subpaths = subpathsOf(t.attrs.d);
        const cls = t.attrs.class ?? "";
        const fillUrl = t.attrs.fill?.match(/^url\(#(.+)\)$/)?.[1];
        const isLine = /\biso-line\b/.test(cls);
        const isHalo = /\biso-halo\b/.test(cls);
        if (!isLine) {
          const first = scene.tris.length / 2;
          const count = tessellate(subpaths, scene.tris);
          const paint = fillUrl && gradients.has(fillUrl)
            ? paintOf({ kind: "linear", ...gradients.get(fillUrl), chain })
            : paintOf({ kind: "probe", prop: "fill", chain });
          if (count) scene.fills.push({ item: itemIndex, layer: layer++, paint, first, count, ...(isHalo ? { special: "halo" } : {}) });
        }
        // Stroke if the element can carry one: lines always, fills when the probe says so (seamless 0.4 px).
        if (!isHalo) {
          const polys = [];
          for (const s of subpaths) {
            if (s.points.length < 2 && !s.closed) continue;
            const start = scene.points.length / 2;
            for (const [x, y] of s.points) scene.points.push(x, y);
            polys.push([start, s.points.length, s.closed ? 1 : 0]);
          }
          if (polys.length) scene.strokes.push({ item: itemIndex, layer: layer++, paint: paintOf({ kind: "probe", prop: "stroke", chain }), polys, optional: !isLine });
        }
      } else if (t.tag === "circle") {
        const alpha = t.attrs["fill-opacity"] !== undefined ? Number(t.attrs["fill-opacity"]) : 1;
        const attrs = { ...t.attrs };
        delete attrs["fill-opacity"];
        const dchain = [...chain.slice(0, -1), strip("circle", attrs)];
        scene.dots.push({ item: itemIndex, layer, paint: paintOf({ kind: "probe", prop: "fill", chain: dchain }), x: +t.attrs.cx, y: +t.attrs.cy, r: +t.attrs.r, alpha });
      }
      if (!t.selfClosing) stack.push(strip(t.tag, t.attrs));
    }
    scene.items.push({ name: item.name, key: item.key, lift: item.lift ?? 0, move: item.move ?? [0, 0], layers: layer + 1 });
  });
  return scene;
}

export function encodeScene(scene) {
  const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString("base64");
  return JSON.stringify({ ...scene, tris: b64(new Float32Array(scene.tris)), points: b64(new Float32Array(scene.points)) });
}
