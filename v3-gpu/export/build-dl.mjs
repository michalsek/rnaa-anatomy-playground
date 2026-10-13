// Display-list builder: settled + sorted recorder items → primitives (fill meshes, stroke segments, dot runs),
// palette keys, gradients and slot ranks. Isomorphic (the live adapter will reuse primitivesOf for slot markup).
import { parseSvg, parsePathData, drawables, urlRef, numberAttr, OPACITY_ATTRS } from "./svgsub.mjs";
import { roleOf } from "./roles.mjs";
import { triangulate, signedArea } from "./tess.mjs";
import { PRIM_KIND, PRIM_FLAG, SEG_FLAG, VERSION, gradientPaint, pack } from "./dl-format.mjs";
import { paintKeyOf, probeNode } from "./palette-key.mjs";
import { polylinesOf, ringOfCircle } from "./polylines.mjs";

export { polylinesOf };

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
      const key = paintKeyOf(prop, ancestors, el);
      let entry = byKey.get(key);
      if (!entry) {
        entry = { id: entries.length, prop, ancestors, el, alphaAttrs: [] };
        entries.push(entry);
        byKey.set(key, entry);
      }
      // where the markup carried opacity attributes (the gate checks CSS never overrides them)
      [...chain, node].forEach((n, depth) => {
        for (const name of OPACITY_ATTRS) {
          const at = depth === chain.length ? -1 : depth;
          if (n.attrs[name] !== undefined && !entry.alphaAttrs.some((a) => a.at === at && a.name === name)) entry.alphaAttrs.push({ at, name });
        }
      });
      return entry.id;
    },
  };
}

// placeSlots(items, slots): the slot lookup of the slot loop in v2 kit.mjs page() (after → the latest of its targets,
// before → the earliest; each target resolves to the FIRST item in draw order named `target` or `target#n`, as kit's
// findIndex does, even for `after`), plus the document position: insertAt = index of the first item drawn after the
// slot; seq = document order.
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

// Census of what the exporter met, compared by the gate with the scene's expectations (scenes/*.scene.mjs CENSUS).
// nonSimpleFills: fills with a ring whose non-adjacent edges cross or touch (touching counts, so it exceeds a pure
// self-intersection count).
export const CENSUS_KEYS = ["fillPaths", "fillSubpaths", "fillRingVerts", "multiSubpath", "mixedOrientation", "nonSimpleFills", "earcut", "libtess", "emptyFills", "strokeElements", "strokePaths", "polylines", "pathSegments", "closedPolylines", "dotCircles", "dotGroups", "opacityGroups", "seamlessSolids", "halos", "blends"];

// createSink() → the growing section arrays plus the census counters
export function createSink() {
  return { prims: [], fillVertices: [], fillIndices: [], segments: [], dots: [], gradients: [], stats: Object.fromEntries(CENSUS_KEYS.map((key) => [key, 0])), fillChecks: [] };
}

function tallyFill(stats, subpaths, mesh) {
  stats.fillPaths++;
  stats.fillSubpaths += subpaths.length;
  stats.fillRingVerts += subpaths.reduce((n, s) => n + s.points.length, 0);
  if (subpaths.length > 1) stats.multiSubpath++;
  const signs = new Set(mesh.rings.map((ring) => Math.sign(signedArea(ring))).filter(Boolean));
  if (signs.size > 1) stats.mixedOrientation++;
  if (mesh.simpleRings.includes(false)) stats.nonSimpleFills++;
  if (mesh.method === "earcut") stats.earcut++;
  else if (mesh.method === "libtess") stats.libtess++;
  if (!mesh.indices.length) stats.emptyFills++;
}

// isOutlinePath: a stroked <path> drawn as a line (not a seamless solid's seam, not a circle's outline); the census
// counts these as the scene's stroke paths
function tallyStroke(stats, isOutlinePath, polylines) {
  stats.strokeElements++;
  if (!isOutlinePath) return;
  stats.strokePaths++;
  for (const { points, closed } of polylines) {
    stats.polylines++;
    stats.pathSegments += closed ? points.length : points.length - 1;
    if (closed) stats.closedPolylines++;
  }
}

function tallyGroups(root, stats) {
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

// primitivesOf(markup, { item, chainPrefix, palette, sink, collectFillChecks }) → number of prims appended for one
// item's svg. collectFillChecks keeps each fill's source subpaths and f64 mesh in sink.fillChecks for the area gate.
export function primitivesOf(markup, { item, chainPrefix = [], palette, sink, collectFillChecks = false }) {
  const root = parseSvg(markup);
  const { elements, gradients } = drawables(root);
  tallyGroups(root, sink.stats);
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
    const flags = (role.special.halo ? PRIM_FLAG.halo : 0) | (role.special.blend ? PRIM_FLAG.blend : 0) | (role.special.seamless ? PRIM_FLAG.seamless : 0) | (el.groupOpacity ? PRIM_FLAG.groupOpacity : 0);
    if (role.special.halo) sink.stats.halos++;
    if (role.special.blend) sink.stats.blends++;
    let subpaths;
    if (el.tag === "circle") {
      const [cx, cy, r] = ["cx", "cy", "r"].map((name) => numberAttr(el, name, 0));
      emitDot(el, chain, flags, { cx, cy, r }, !role.stroke);
      if (!role.stroke) continue;
      subpaths = [{ points: ringOfCircle(cx, cy, r), closed: true, drawn: true }];
    } else {
      subpaths = parsePathData(el.attrs.d ?? "");
      if (role.fill) emitFill(el, subpaths, chain, flags);
    }
    if (role.stroke) emitStroke(el, subpaths, chain, flags, role.stroke);
  }
  return sink.prims.length - firstPrim;

  // consecutive plain dots of one item with the same paint, alpha and flags share one prim (a dot run)
  function emitDot(el, chain, flags, { cx, cy, r }, joinsRuns) {
    const paint = palette.idOf("fill", el, chain);
    const alpha = el.opacity * el.fillOpacity;
    sink.stats.dotCircles++;
    const last = sink.prims[sink.prims.length - 1];
    const dot = { cx, cy, r, item, paint, alpha };
    const extendsRun = joinsRuns && sink.prims.length > firstPrim && last.kind === PRIM_KIND.dot && last.paint === paint && last.alpha === alpha && last.flags === flags;
    if (extendsRun) {
      sink.dots.push({ ...dot, layer: last.layer, prim: sink.prims.length - 1 });
      last.count++;
    } else {
      const prim = push({ kind: PRIM_KIND.dot, paint, alpha, first: sink.dots.length, count: 1, flags });
      sink.dots.push({ ...dot, layer: sink.prims[prim].layer, prim });
    }
  }

  function emitFill(el, subpaths, chain, flags) {
    const mesh = triangulate(subpaths);
    tallyFill(sink.stats, subpaths, mesh);
    let paint = palette.idOf("fill", el, chain);
    const ref = urlRef(el.attrs.fill);
    if (ref) {
      paint = gradientPaint(gradientFor(ref, paint));
      flags |= PRIM_FLAG.gradient;
    }
    const alpha = el.opacity * el.fillOpacity;
    const base = sink.fillVertices.length;
    const prim = push({ kind: PRIM_KIND.fill, paint, alpha, first: sink.fillIndices.length, count: mesh.indices.length, flags });
    const { layer: primLayer } = sink.prims[prim];
    for (const [x, y] of mesh.positions) sink.fillVertices.push({ x, y, item, paint, layer: primLayer, alpha });
    for (const i of mesh.indices) sink.fillIndices.push(base + i);
    if (collectFillChecks) sink.fillChecks.push({ prim, subpaths, mesh });
  }

  function emitStroke(el, subpaths, chain, flags, geometry) {
    const override = el.strokeWidth !== undefined;
    const width = override ? el.strokeWidth : geometry.width;
    const paint = palette.idOf("stroke", el, chain);
    const alpha = el.opacity * el.strokeOpacity;
    const polylines = polylinesOf(subpaths, geometry.cap);
    tallyStroke(sink.stats, el.tag === "path" && !(flags & PRIM_FLAG.seamless), polylines);
    const prim = push({ kind: PRIM_KIND.stroke, paint, alpha, first: sink.segments.length, count: 0, flags });
    const record = sink.prims[prim];
    const style = (geometry.cap === "round" ? SEG_FLAG.capRound : 0) | (geometry.join === "round" ? SEG_FLAG.joinRound : 0) | (override ? SEG_FLAG.widthOverride : 0);
    for (const { points, closed } of polylines) {
      const n = closed ? points.length : points.length - 1;
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

// itemMarkup(item) → the `<g class="it …">` wrapper v2 kit page() puts around each item (copied; the gate compares
// it with the generated page)
export const itemMarkup = (item) => `<g class="it${item.material ? ` ${item.material}` : ""}" data-name="${item.name}"${item.attrs ?? ""}>${item.svg}</g>`;
const FX_PARTS = { tag: "g", attrs: { class: "fx-parts" } };
export const BACK_ITEM_NAME = "@back";

// buildDisplayList({ scene, items (settled + sorted), back (svg strings drawn before the parts), slots, V, width,
// height }) → { json, buffer (packed .dl.bin), sections, stats, fillChecks }. Prims are stored in draw order: the
// back item's prims first, then the scene items by rank. json.items lists the scene items by rank (index === rank)
// and the back item last.
export function buildDisplayList({ scene, items, back = [], slots = [], V, width, height, collectFillChecks = false }) {
  const palette = createPalette();
  const sink = createSink();
  const options = { palette, sink, collectFillChecks };
  const backItem = back.length ? { index: items.length, name: BACK_ITEM_NAME, piece: "", key: null, lift: 0, rank: -1, material: "", back: true, prims: [0, primitivesOf(back.join(""), { ...options, item: items.length })] } : null;
  const dlItems = items.map((item, rank) => {
    if (!Number.isFinite(item.key)) throw new Error(`build-dl: item ${item.name} has no settled key (${item.key})`);
    const first = sink.prims.length;
    const count = primitivesOf(itemMarkup(item), { ...options, item: rank, chainPrefix: [FX_PARTS] });
    const m = item.move ?? [0, 0, 0];
    return { index: rank, name: item.name, piece: item.piece ?? "", key: item.key, lift: m[0] * V[0] + m[1] * V[1] + m[2] * V[2], rank, material: item.material ?? "", prims: [first, count] };
  });
  if (backItem) dlItems.push(backItem);
  for (const item of dlItems) item.flags = flagsOf(sink.prims.slice(item.prims[0], item.prims[0] + item.prims[1]), item);
  const placed = placeSlots(items, slots);
  for (const slot of placed) dlItems[slot.anchor].flags.push(`slot-${slot.side}`);
  const sections = { prims: sink.prims, fillVertices: sink.fillVertices, fillIndices: sink.fillIndices, segments: sink.segments, dots: sink.dots };
  const { buffer, table } = pack(sections);
  const json = {
    format: "rnaa-dl",
    version: VERSION,
    scene,
    viewBox: [0, 0, width, height],
    units: { coords: "svg user units (viewBox)", strokeWidth: "CSS px (vector-effect: non-scaling-stroke)" },
    probe: { host: "svg.iso-svg inside .iso-plate .fx-stage of a page with body.iso[data-theme] (light|dark)", props: { fill: ["fill", "fill-opacity", "opacity"], stroke: ["stroke", "stroke-opacity", "opacity", "stroke-width", "stroke-linecap", "stroke-linejoin"], "stop-color": ["stop-color", "stop-opacity"] }, extra: ["mix-blend-mode", "filter", "transform"] },
    items: dlItems,
    slots: placed,
    palette: palette.entries,
    gradients: sink.gradients,
    sections: table,
    counts: { items: dlItems.length, prims: sections.prims.length, triangles: sections.fillIndices.length / 3, fillVertices: sections.fillVertices.length, segments: sections.segments.length, dots: sections.dots.length, palette: palette.entries.length, gradients: sink.gradients.length, slots: placed.length },
  };
  return { json, buffer, sections, stats: sink.stats, fillChecks: sink.fillChecks };
}

function flagsOf(prims, item) {
  const flags = new Set(item.back ? ["back"] : []);
  for (const p of prims)
    for (const [name, bit] of Object.entries(PRIM_FLAG)) if (p.flags & bit) flags.add(name);
  return [...flags];
}
