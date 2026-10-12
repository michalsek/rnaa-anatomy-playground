// Display-list builder: settled + sorted recorder items → primitives (fill meshes, stroke segments, dot runs),
// palette keys, gradients and slot ranks. Isomorphic (the live adapter will reuse primitivesOf for slot markup).
import { parseSvg, parsePathData, drawables, urlRef } from "./svgsub.mjs";
import { roleOf } from "./roles.mjs";
import { cleanRing, triangulate, signedArea, isSimpleRing } from "./tess.mjs";
import { PRIM_KIND, PRIM_FLAG, SEG_FLAG, PAINT_GRADIENT } from "./dl-format.mjs";

// attributes that never change the cascade result (geometry, identity, alpha carried by the DL itself)
const KEY_DROP = new Set(["data-name", "data-route", "data-slot", "data-pulse", "id", "d", "cx", "cy", "r", "x1", "y1", "x2", "y2", "offset", "gradientUnits", "opacity", "fill-opacity", "stroke-opacity", "stop-opacity", "style", "role", "aria-hidden", "aria-label"]);
const ALPHA_ATTRS = ["opacity", "fill-opacity", "stroke-opacity", "stop-opacity"];
const CIRCLE_STEPS = 32;

function probeNode({ tag, attrs }) {
  const kept = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (KEY_DROP.has(name)) continue;
    if ((name === "fill" || name === "stroke") && value.startsWith("url(")) continue;
    kept[name] = value;
  }
  return { tag, attrs: kept };
}

// Palette: one entry per distinct (ancestor context × element × prop). The entry is the probe recipe: rebuild the
// chain under an svg.iso-svg in the page and read getComputedStyle(el)[prop] (+ opacities) — colours stay in CSS.
export function createPalette() {
  const entries = [];
  const byKey = new Map();
  return {
    entries,
    idOf(prop, node, chain) {
      const ancestors = chain.map(probeNode);
      const el = probeNode(node);
      const key = JSON.stringify([prop, ancestors, el]);
      let entry = byKey.get(key);
      if (!entry) {
        entry = { id: entries.length, prop, ancestors, el, alphaAttrs: [] };
        entries.push(entry);
        byKey.set(key, entry);
      }
      // where the markup carried opacity attributes (the gate checks CSS never overrides them)
      [...chain, node].forEach((n, depth) => {
        for (const name of ALPHA_ATTRS) {
          const at = depth === chain.length ? -1 : depth;
          if (n.attrs[name] !== undefined && !entry.alphaAttrs.some((a) => a.at === at && a.name === name)) entry.alphaAttrs.push({ at, name });
        }
      });
      return entry.id;
    },
  };
}

// placeSlots(items, slots): the slot lookup of v2 kit.mjs page() (after → latest target, before → earliest),
// plus the document position: insertAt = index of the first item drawn after the slot; seq = document order.
export function placeSlots(items, slots) {
  const placed = slots.map((slot) => {
    const targets = [].concat(slot.after ?? slot.before);
    const found = targets.map((target) => items.findIndex((item) => item.name === target || item.name.startsWith(`${target}#`)));
    if (found.some((i) => i < 0)) throw new Error(`slot ${slot.name}: no item named ${targets[found.findIndex((i) => i < 0)]}`);
    const side = slot.after ? "after" : "before";
    const anchor = side === "after" ? Math.max(...found) : Math.min(...found);
    const insertAt = side === "after" ? anchor + 1 : anchor;
    return { name: slot.name, side, anchor, insertAt, rank: insertAt - 0.5, targets };
  });
  // document order: for each item, its before-slots, the item, its after-slots (in declaration order)
  let seq = 0;
  items.forEach((_, index) => {
    for (const s of placed) if (s.side === "before" && s.anchor === index) s.seq = seq++;
    seq++;
    for (const s of placed) if (s.side === "after" && s.anchor === index) s.seq = seq++;
  });
  return placed;
}

const ringOfCircle = (cx, cy, r) => Array.from({ length: CIRCLE_STEPS }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / CIRCLE_STEPS), cy + r * Math.sin((2 * Math.PI * i) / CIRCLE_STEPS)]);

// polylinesOf(subpaths, cap) → [{ points, closed }] as SVG strokes them: a lone moveto draws nothing; a zero-length
// subpath draws only with round caps (as a dot)
export function polylinesOf(subpaths, cap) {
  const out = [];
  for (const sp of subpaths) {
    if (!sp.drawn) continue;
    const points = withoutRepeats(sp.points);
    if (sp.closed && points.length > 1 && samePoint(points[0], points[points.length - 1])) points.pop();
    if (points.length === 1) {
      if (cap === "round") out.push({ points: [points[0], points[0]], closed: false });
      continue;
    }
    out.push({ points, closed: sp.closed });
  }
  return out;
}

const samePoint = (p, q) => Math.abs(p[0] - q[0]) <= 1e-9 && Math.abs(p[1] - q[1]) <= 1e-9;
const withoutRepeats = (points) => points.filter((p, i) => i === 0 || !samePoint(p, points[i - 1]));

// createSink() → the growing section arrays plus counters for the census
export function createSink() {
  return { prims: [], fillVertices: [], fillIndices: [], segments: [], dots: [], gradients: [], stats: { fillPaths: 0, fillSubpaths: 0, fillRingVerts: 0, multiSubpath: 0, mixedOrientation: 0, selfIntersecting: 0, earcut: 0, libtess: 0, emptyFills: 0, strokeElements: 0, strokePaths: 0, polylines: 0, pathSegments: 0, closedPolylines: 0, dotCircles: 0, dotGroups: 0, opacityGroups: 0, seamlessSolids: 0, halos: 0, blends: 0 }, checks: [] };
}

// primitivesOf(markup, { item, chainPrefix, palette, sink, collect }) → number of prims appended for one item's svg
export function primitivesOf(markup, { item, chainPrefix = [], palette, sink, collect = false }) {
  const root = parseSvg(markup);
  const { elements, gradients } = drawables(root);
  countGroups(root, sink.stats);
  const firstPrim = sink.prims.length;
  let layer = 0;
  const gradientIndex = new Map();
  const push = (prim) => {
    sink.prims.push({ ...prim, item, layer: layer++ });
    return sink.prims.length - 1;
  };
  for (const el of elements) {
    const chain = [...chainPrefix, ...el.chain];
    const role = roleOf(el);
    for (const name of Object.keys(el.style)) if (name !== "stroke-width") throw new Error(`build-dl: inline style "${name}" is not supported`);
    const flags = (role.special.halo ? PRIM_FLAG.halo : 0) | (role.special.blend ? PRIM_FLAG.blend : 0) | (role.special.seamless ? PRIM_FLAG.seamless : 0) | (el.groupOpacity ? PRIM_FLAG.groupOpacity : 0);
    if (role.special.halo) sink.stats.halos++;
    if (role.special.blend) sink.stats.blends++;
    let subpaths;
    if (el.tag === "circle") {
      const [cx, cy, r] = ["cx", "cy", "r"].map((a) => Number(el.attrs[a] ?? 0));
      const paint = palette.idOf("fill", el, chain);
      const alpha = el.opacity * el.fillOpacity;
      sink.stats.dotCircles++;
      const last = sink.prims[sink.prims.length - 1];
      const dot = { cx, cy, r, item, paint, alpha };
      if (last && sink.prims.length > firstPrim && last.kind === PRIM_KIND.dot && last.paint === paint && last.alpha === alpha && last.flags === flags && !role.stroke) {
        sink.dots.push({ ...dot, layer: last.layer, prim: sink.prims.length - 1 });
        last.count++;
      } else {
        const prim = push({ kind: PRIM_KIND.dot, paint, alpha, first: sink.dots.length, count: 1, flags });
        sink.dots.push({ ...dot, layer: sink.prims[prim].layer, prim });
      }
      if (!role.stroke) continue;
      subpaths = [{ points: ringOfCircle(cx, cy, r), closed: true, drawn: true }];
    } else {
      subpaths = parsePathData(el.attrs.d ?? "");
      if (role.fill) emitFill(el, subpaths, chain, flags);
    }
    if (role.stroke) emitStroke(el, subpaths, chain, flags, role.stroke);
  }
  return sink.prims.length - firstPrim;

  function emitFill(el, subpaths, chain, flags) {
    const stats = sink.stats;
    const rings = subpaths.map((s) => cleanRing(s.points)).filter((r) => r.length >= 3);
    stats.fillPaths++;
    stats.fillSubpaths += subpaths.length;
    stats.fillRingVerts += subpaths.reduce((n, s) => n + s.points.length, 0);
    if (subpaths.length > 1) stats.multiSubpath++;
    const signs = new Set(rings.map((r) => Math.sign(signedArea(r))).filter(Boolean));
    if (signs.size > 1) stats.mixedOrientation++;
    if (rings.some((r) => !isSimpleRing(r))) stats.selfIntersecting++;
    const mesh = triangulate(subpaths);
    if (mesh.method === "earcut") stats.earcut++;
    else if (mesh.method === "libtess") stats.libtess++;
    if (!mesh.indices.length) stats.emptyFills++;
    let paint = palette.idOf("fill", el, chain);
    const ref = urlRef(el.attrs.fill);
    if (ref) {
      paint = PAINT_GRADIENT | gradientFor(ref, paint);
      flags |= PRIM_FLAG.gradient;
    }
    const alpha = el.opacity * el.fillOpacity;
    const base = sink.fillVertices.length;
    const prim = push({ kind: PRIM_KIND.fill, paint, alpha, first: sink.fillIndices.length, count: mesh.indices.length, flags });
    const { layer: primLayer } = sink.prims[prim];
    for (const [x, y] of mesh.positions) sink.fillVertices.push({ x, y, item, paint, layer: primLayer, alpha });
    for (const i of mesh.indices) sink.fillIndices.push(base + i);
    if (collect) sink.checks.push({ prim, subpaths, mesh });
  }

  function emitStroke(el, subpaths, chain, flags, geometry) {
    const stats = sink.stats;
    stats.strokeElements++;
    if (el.tag === "path" && !(flags & PRIM_FLAG.seamless)) stats.strokePaths++;
    const override = el.style["stroke-width"] !== undefined;
    const width = override ? parseFloat(el.style["stroke-width"]) : geometry.width;
    const paint = palette.idOf("stroke", el, chain);
    const alpha = el.opacity * el.strokeOpacity;
    const polylines = polylinesOf(subpaths, geometry.cap);
    const prim = push({ kind: PRIM_KIND.stroke, paint, alpha, first: sink.segments.length, count: 0, flags });
    const record = sink.prims[prim];
    const style = (geometry.cap === "round" ? SEG_FLAG.capRound : 0) | (geometry.join === "round" ? SEG_FLAG.joinRound : 0) | (override ? SEG_FLAG.widthOverride : 0);
    for (const { points, closed } of polylines) {
      const n = closed ? points.length : points.length - 1;
      if (el.tag === "path" && !(flags & PRIM_FLAG.seamless)) {
        stats.polylines++;
        stats.pathSegments += n;
        if (closed) stats.closedPolylines++;
      }
      for (let i = 0; i < n; i++) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[(i + 1) % points.length];
        const segFlags = style | (closed ? SEG_FLAG.closed : 0) | (i === 0 ? SEG_FLAG.start : 0) | (i === n - 1 ? SEG_FLAG.end : 0);
        sink.segments.push({ x0, y0, x1, y1, item, paint, layer: record.layer, alpha, width, flags: segFlags, prim });
      }
    }
    record.count = sink.segments.length - record.first;
  }

  function gradientFor(ref, paint) {
    if (gradientIndex.has(ref)) return gradientIndex.get(ref);
    const g = gradients[ref];
    if (!g) throw new Error(`build-dl: url(#${ref}) has no gradient in the same item`);
    const index = sink.gradients.length;
    sink.gradients.push({
      id: ref,
      units: "userSpaceOnUse",
      x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2,
      paint, // the filled element's own entry: its opacities apply on top of the gradient
      stops: g.stops.map((s) => ({ offset: s.offset, alpha: s.alpha, paint: palette.idOf("stop-color", s.node, [...chainPrefix, ...s.chain]) })),
    });
    gradientIndex.set(ref, index);
    return index;
  }
}

function countGroups(root, stats) {
  const walk = (node) => {
    for (const child of node.children) {
      const classes = (child.attrs.class ?? "").split(/\s+/);
      if (child.tag === "g" && classes.includes("iso-dots")) stats.dotGroups++;
      if (child.tag === "g" && child.attrs.opacity !== undefined) stats.opacityGroups++;
      if (child.tag === "g" && classes.includes("iso-solid") && child.attrs["data-seamless"] !== undefined) stats.seamlessSolids++;
      walk(child);
    }
  };
  walk(root);
}

const itemMarkup = (item) => `<g class="it${item.material ? ` ${item.material}` : ""}" data-name="${item.name}"${item.attrs ?? ""}>${item.svg}</g>`;
const FX_PARTS = { tag: "g", attrs: { class: "fx-parts" } };

// buildDisplayList({ items (settled + sorted), back (svg strings drawn before the parts), slots, V, width, height })
export function buildDisplayList({ scene, items, back = [], slots = [], V, width, height, collect = false }) {
  const palette = createPalette();
  const sink = createSink();
  const dlItems = items.map((item, rank) => {
    const first = sink.prims.length;
    const count = primitivesOf(itemMarkup(item), { item: rank, chainPrefix: [FX_PARTS], palette, sink, collect });
    const m = item.move ?? [0, 0, 0];
    return { index: rank, name: item.name, piece: item.piece ?? "", key: item.key, lift: m[0] * V[0] + m[1] * V[1] + m[2] * V[2], rank, material: item.material ?? "", prims: [first, count] };
  });
  if (back.length) {
    const first = sink.prims.length;
    const count = primitivesOf(back.join(""), { item: dlItems.length, chainPrefix: [], palette, sink, collect });
    dlItems.push({ index: dlItems.length, name: "@back", piece: "", key: -Infinity, lift: 0, rank: -1, material: "", back: true, prims: [first, count] });
  }
  for (const item of dlItems) item.flags = flagsOf(sink.prims.slice(item.prims[0], item.prims[0] + item.prims[1]), item);
  const placed = placeSlots(items, slots);
  for (const slot of placed) (dlItems[slot.anchor].flags ??= []).push(`slot-${slot.side}`);
  return {
    json: {
      format: "rnaa-dl",
      version: 1,
      scene,
      viewBox: [0, 0, width, height],
      units: { coords: "svg user units (viewBox)", strokeWidth: "CSS px (vector-effect: non-scaling-stroke)" },
      probe: { host: "svg.iso-svg inside .iso-plate .fx-stage of a page with body.iso[data-theme] (light|dark)", props: { fill: ["fill", "fill-opacity", "opacity"], stroke: ["stroke", "stroke-opacity", "opacity", "stroke-width", "stroke-linecap", "stroke-linejoin"], "stop-color": ["stop-color", "stop-opacity"] }, extra: ["mix-blend-mode", "filter", "transform"] },
      items: dlItems.map((item) => ({ ...item, key: Number.isFinite(item.key) ? item.key : null })),
      slots: placed,
      palette: palette.entries,
      gradients: sink.gradients,
    },
    sections: { prims: sink.prims, fillVertices: sink.fillVertices, fillIndices: sink.fillIndices, segments: sink.segments, dots: sink.dots },
    stats: sink.stats,
    checks: sink.checks,
  };
}

function flagsOf(prims, item) {
  const flags = new Set(item.back ? ["back"] : []);
  for (const p of prims)
    for (const [name, bit] of Object.entries(PRIM_FLAG)) if (p.flags & bit) flags.add(name);
  return [...flags];
}
