// node tools/native-gate.mjs <command> [--quick] [--mutate …] — native rotor checks (thresholds: tools/gates.config.mjs
// NATIVE, NATIVE_STROKES, NATIVE_INJECT, NATIVE_FAULT). Every run injects packets of every v2 kind (NATIVE_INJECT).
//   contract   dev page (out/gpu/live-dev.html): at each tick the native painter's GPU-expanded records, read back, equal
//              what the markup path builds from v2's strings for the same state: every polyline (order, paint, width,
//              alpha, item, caps at both ends, points within NATIVE.contract.pointTolerance viewBox units — the kit
//              rounds to 0.1), the layer order, the fill area per paint, the hull the native path omits covered by
//              its faces; joins, crowd and flags equal what SegWriter writes for the read-back polylines. Each tick
//              also mutates its own read-back records (crowd, join, width, tone, item, caps): every mutation must be
//              rejected. The page's V8 must agree with kit-mirror's hypot2 bit for bit.
//   identity   native page: cached frame == ?cache=0 (0 px) at rotor ticks; after two device losses the painter is
//              back and the frame == a fresh page and == ?cache=0. --mutate patch: a 1 CSS px patch on the cached
//              page (self-test)
//   compare    native vs markup path (?native=0) vs SVG, lockstep, NATIVE.compare ticks × DPR 1/2/4 × both themes;
//              native vs SVG within the live limits, native vs markup without solid blobs; crops of the rotor at ×1
//              and ×4 in out/tmp/gates/native/crops
//   sheet      60 consecutive native frames of the rotor (light 700–759: spin-up through back / front swaps) as one
//              contact sheet (out/tmp/gates/native/sheet); no frame with a solid blob vs SVG
//   fault      error containment: a packet kind the native rotor refuses fails that machine only; it records the error,
//              falls back to the markup path in the same tick and the frame then equals the ?native=0 page (0 px)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { compareImages, crop, readPng, zoom } from "./diff.mjs";
import { GATES_OUT, PAGES, RUNTIME_STATE, advanceTo, createChecks, fileUrl, openRuntimePage, parseArgs, settle, shot, stageBox, waitFor, withBrowser } from "./harness.mjs";
import { LIVE, NATIVE, NATIVE_FAULT, NATIVE_INJECT, NATIVE_STROKES } from "./gates.config.mjs";
import { FILL_VERTEX_RECORD, SEG, SEG_RECORD } from "../src/core/schemas.ts";
import { CROWD_NONE, SegWriter } from "../src/core/strokes.ts";
import { hypot2 } from "../src/native/kit-mirror.ts";

const OUT = join(GATES_OUT, "native");
const themed = (theme) => (theme === "light" ? "-light" : "");
const PAGE = {
  svg: (theme) => PAGES.svg(theme),
  native: (theme) => PAGES.gpu(theme),
  markup: (theme) => `${fileUrl(PAGES.gpu(theme))}?native=0`,
  nativeUncached: (theme) => `${fileUrl(PAGES.gpu(theme))}?cache=0`,
  dev: () => PAGES.gpuDev(),
};

/** Cap bits of Seg.flags. */
const CAPS = SEG.roundStart | SEG.roundEnd | SEG.buttStart | SEG.buttEnd;
/** Packets of every kind, injected on every page of a run at the same ticks. */
const INJECTIONS = NATIVE_INJECT.flatMap(({ tick, kinds }) => kinds.map((kind) => ({ tick, js: `FACTORY.machines.centrifuge.accept("in", FACTORY.item(${JSON.stringify(kind)}))` })));

// ---- records ------------------------------------------------------------------------------------------------------
function decodeSegs(words, first, count) {
  const f32 = new Float32Array(Uint32Array.from(words).buffer);
  const u32 = Uint32Array.from(words);
  const segs = [];
  for (let i = first; i < first + count; i++) {
    const o = i * SEG_RECORD.words;
    segs.push({
      index: i,
      p0: [f32[o + SEG_RECORD.p0], f32[o + SEG_RECORD.p0 + 1]],
      p1: [f32[o + SEG_RECORD.p1], f32[o + SEG_RECORD.p1 + 1]],
      joinStart: [f32[o + SEG_RECORD.joinStart], f32[o + SEG_RECORD.joinStart + 1]],
      joinEnd: [f32[o + SEG_RECORD.joinEnd], f32[o + SEG_RECORD.joinEnd + 1]],
      width: f32[o + SEG_RECORD.width],
      item: u32[o + SEG_RECORD.item],
      paint: u32[o + SEG_RECORD.paint],
      layer: u32[o + SEG_RECORD.layer],
      alpha: f32[o + SEG_RECORD.alpha],
      flags: u32[o + SEG_RECORD.flags],
      polyStart: u32[o + SEG_RECORD.polyStart],
      polyEnd: u32[o + SEG_RECORD.polyEnd],
      crowd: f32[o + SEG_RECORD.crowd],
    });
  }
  return segs;
}

/** Drawn segments → polylines (consecutive segments of one [polyStart, polyEnd) range). */
function polylinesOf(segs) {
  const lines = [];
  for (const s of segs) {
    if (!(s.alpha > 0)) continue;
    const last = lines[lines.length - 1];
    if (last && last.polyStart === s.polyStart) {
      last.points.push(s.p1);
      last.segs.push(s);
    } else lines.push({ polyStart: s.polyStart, paint: s.paint, layer: s.layer, points: [s.p0, s.p1], segs: [s] });
  }
  return lines;
}

/** What SegWriter writes for `line`'s own (read-back) points: joins, crowd and flags of each segment. */
function segWriterOf(line) {
  const writer = new SegWriter(line.points.length);
  const first = line.segs[0];
  writer.polyline(line.points.flat(), 0, line.points.length, false, "round", { width: first.width, item: first.item, paint: first.paint, layer: first.layer, alpha: first.alpha });
  return decodeSegs(writer.u32, 0, writer.count);
}

const crowdOf = (value) => (value >= NATIVE_STROKES.crowdIrrelevant ? Infinity : value);
const sameCrowd = (a, b) => {
  const [x, y] = [crowdOf(a), crowdOf(b)];
  return x === y || Math.abs(x - y) <= NATIVE_STROKES.crowdTolerance;
};
const sameJoin = (a, b) => Math.abs(a[0] - b[0]) <= NATIVE_STROKES.joinTolerance && Math.abs(a[1] - b[1]) <= NATIVE_STROKES.joinTolerance;

/** Stroke fields of one native polyline against the markup path's polyline and against SegWriter on its own points. */
function strokeProblems(name, line, other) {
  const problems = [];
  const first = line.segs[0], last = line.segs[line.segs.length - 1];
  const reference = other.segs[0];
  for (const s of line.segs) {
    if (s.width !== reference.width) problems.push(`${name}: width ${s.width} vs ${reference.width}`);
    if (s.alpha !== reference.alpha) problems.push(`${name}: alpha ${s.alpha} vs ${reference.alpha}`);
    if (s.item !== reference.item) problems.push(`${name}: item ${s.item} vs ${reference.item}`);
  }
  if ((first.flags & CAPS) !== (reference.flags & CAPS)) problems.push(`${name}: start cap ${first.flags & CAPS} vs ${reference.flags & CAPS}`);
  const otherLast = other.segs[other.segs.length - 1];
  if ((last.flags & CAPS) !== (otherLast.flags & CAPS)) problems.push(`${name}: end cap ${last.flags & CAPS} vs ${otherLast.flags & CAPS}`);
  segWriterOf(line).forEach((expected, i) => {
    const s = line.segs[i];
    if (s.flags !== expected.flags) problems.push(`${name} seg ${i}: flags ${s.flags} vs SegWriter ${expected.flags}`);
    if (!sameJoin(s.joinStart, expected.joinStart) || !sameJoin(s.joinEnd, expected.joinEnd)) problems.push(`${name} seg ${i}: joins ${s.joinStart}/${s.joinEnd} vs SegWriter ${expected.joinStart}/${expected.joinEnd}`);
    if (!sameCrowd(s.crowd, expected.crowd)) problems.push(`${name} seg ${i}: crowd ${s.crowd} vs SegWriter ${expected.crowd}`);
  });
  return problems;
}

function decodeVertices(words, firstWord, count) {
  const u32 = Uint32Array.from(words);
  const f32 = new Float32Array(u32.buffer);
  return Array.from({ length: count }, (_, v) => {
    const o = firstWord + v * FILL_VERTEX_RECORD.words;
    return { x: f32[o + FILL_VERTEX_RECORD.pos], y: f32[o + FILL_VERTEX_RECORD.pos + 1], item: u32[o + FILL_VERTEX_RECORD.ids] & 0xffff, paint: u32[o + FILL_VERTEX_RECORD.ids] >>> 16 };
  });
}

/**
 * Triangle area and Σ triangle perimeters per paint (zero-area triangles add nothing). Moving every boundary point by
 * at most δ changes a region's area by at most δ × its boundary length; Σ triangle perimeters bounds that length.
 */
function areaByPaint(vertices, item) {
  const areas = new Map();
  for (let v = 0; v + 2 < vertices.length; v += 3) {
    const [a, b, c] = [vertices[v], vertices[v + 1], vertices[v + 2]];
    if (item !== undefined && a.item !== item) continue;
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
    if (!area) continue;
    const perimeter = Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - b.x, c.y - b.y) + Math.hypot(a.x - c.x, a.y - c.y);
    const entry = areas.get(a.paint) ?? { area: 0, perimeter: 0 };
    entry.area += area;
    entry.perimeter += perimeter;
    areas.set(a.paint, entry);
  }
  return areas;
}

const pointSegment = ([px, py], [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
};
const pointPolyline = (p, points) => points.slice(1).reduce((best, q, i) => Math.min(best, pointSegment(p, points[i], q)), points.length === 1 ? Math.hypot(p[0] - points[0][0], p[1] - points[0][1]) : Infinity);
/** Symmetric max distance of each polyline's points from the other polyline. */
const polylineDistance = (a, b) => Math.max(...a.map((p) => pointPolyline(p, b)), ...b.map((p) => pointPolyline(p, a)));

/** One tick: native records vs the markup path's records for the same state. Returns problems and the measured maxima. */
function compareContract(check, tol) {
  const problems = [];
  let maxDistance = 0, maxAreaError = 0, polylines = 0;
  const { gpu, reference } = check;
  const hull = new Set(gpu.hullPaints);
  const nativeVertices = decodeVertices(gpu.fills, 0, gpu.fills.length / 4);
  for (const slot of gpu.slots) {
    const ref = reference.find((r) => r.slot === slot.slot);
    const name = `slot ${slot.slot}`;
    const nativeLines = polylinesOf(decodeSegs(gpu.segs, slot.segFirst, slot.segCount));
    const refLines = polylinesOf(decodeSegs(ref.words, 0, ref.segCount));
    polylines += nativeLines.length;
    if (nativeLines.length !== refLines.length) {
      problems.push(`${name}: ${nativeLines.length} polylines vs ${refLines.length}`);
      continue;
    }
    nativeLines.forEach((line, i) => {
      const other = refLines[i];
      if (line.paint !== other.paint) problems.push(`${name} polyline ${i}: paint ${line.paint} vs ${other.paint}`);
      problems.push(...strokeProblems(`${name} polyline ${i}`, line, other));
      const distance = polylineDistance(line.points, other.points);
      maxDistance = Math.max(maxDistance, distance);
      if (distance > tol.pointTolerance) problems.push(`${name} polyline ${i}: ${distance.toFixed(3)} apart`);
      if (i && Math.sign(line.layer - nativeLines[i - 1].layer) !== Math.sign(other.layer - refLines[i - 1].layer)) problems.push(`${name} polyline ${i}: layer order differs`);
    });
    // fills: the markup path's vertices follow its Seg records; the native ones carry the slot's pseudo-item
    const refVertices = decodeVertices(ref.words, ref.segCount * SEG_RECORD.words, ref.vertexCount);
    const nativeAreas = areaByPaint(nativeVertices, slot.item);
    const refAreas = areaByPaint(refVertices);
    // the markup path's coordinates are rounded to 0.1: an area may differ by ≤ pointTolerance × boundary length
    let hullArea = 0, nativeTotal = 0, nativeBoundary = 0;
    const measure = (paint, mine, theirs) => {
      const bound = tol.pointTolerance * Math.max(mine.perimeter, theirs.perimeter);
      const error = Math.abs(mine.area - theirs.area);
      maxAreaError = Math.max(maxAreaError, error / Math.max(bound, 1e-9));
      if (error > bound) problems.push(`${name} paint ${paint}: area ${mine.area.toFixed(2)} vs ${theirs.area.toFixed(2)} (allowed ±${bound.toFixed(2)})`);
    };
    for (const [paint, theirs] of refAreas) {
      if (hull.has(paint)) {
        hullArea += theirs.area;
        continue;
      }
      measure(paint, nativeAreas.get(paint) ?? { area: 0, perimeter: 0 }, theirs);
    }
    for (const [paint, mine] of nativeAreas) {
      nativeTotal += mine.area;
      nativeBoundary += mine.perimeter;
      if (!refAreas.has(paint)) problems.push(`${name}: native paint ${paint} (${mine.area.toFixed(2)}) absent from the markup path`);
    }
    if (hullArea) measure("hull", { area: nativeTotal, perimeter: nativeBoundary }, { area: hullArea, perimeter: 0 });
  }
  return { problems, maxDistance, maxAreaError, polylines };
}

/** Advances to `tick`, evaluating every injection due on the way (each at its own tick, while frozen there). */
async function advanceInjecting(cdp, tick, pending) {
  while (pending.length && pending[0].tick <= tick) {
    const due = pending[0].tick;
    await advanceTo(cdp, due);
    while (pending.length && pending[0].tick === due) await cdp.evaluate(pending.shift().js);
  }
  await advanceTo(cdp, tick);
}

/** Deliberate defects in read-back records; the contract must reject each one (the gate's self-test). */
const MUTATIONS = {
  /** One crowded segment's crowd halved (or a relevant one invented). */
  crowd: (gpu, segs) => {
    const s = segs.find((seg) => seg.alpha > 0 && seg.flags & (SEG.joinStart | SEG.joinEnd));
    setF32(gpu.segs, s.index * SEG_RECORD.words + SEG_RECORD.crowd, s.crowd < NATIVE_STROKES.crowdIrrelevant ? s.crowd * 0.5 : 1);
  },
  /** One join normal flipped. */
  join: (gpu, segs) => {
    const s = segs.find((seg) => seg.alpha > 0 && seg.flags & SEG.joinEnd);
    setF32(gpu.segs, s.index * SEG_RECORD.words + SEG_RECORD.joinEnd, -s.joinEnd[0]);
    setF32(gpu.segs, s.index * SEG_RECORD.words + SEG_RECORD.joinEnd + 1, -s.joinEnd[1]);
  },
  /** One segment drawn 1.5× wider (e.g. crease and edge widths swapped in the styles). */
  width: (gpu, segs) => {
    const s = segs.find((seg) => seg.alpha > 0);
    setF32(gpu.segs, s.index * SEG_RECORD.words + SEG_RECORD.width, s.width * 1.5);
  },
  /** One segment on the wrong item (explode offset / depth base). */
  item: (gpu, segs) => {
    const s = segs.find((seg) => seg.alpha > 0);
    gpu.segs[s.index * SEG_RECORD.words + SEG_RECORD.item] = s.item + 1;
  },
  /** One polyline end without its round cap. */
  caps: (gpu, segs) => {
    const s = segs.find((seg) => seg.alpha > 0 && seg.flags & SEG.roundEnd);
    gpu.segs[s.index * SEG_RECORD.words + SEG_RECORD.flags] = s.flags & ~SEG.roundEnd;
  },
  /** Two fill paints of the first slot swapped (faces drawn in the wrong tone): the pair whose areas differ most. */
  tone: (gpu) => {
    const slot = gpu.slots.find((s) => s.count > 0);
    const areas = [...areaByPaint(decodeVertices(gpu.fills, 0, gpu.fills.length / 4), slot.item)].filter(([paint]) => !gpu.hullPaints.includes(paint)).sort((a, b) => a[1].area - b[1].area);
    const [small, large] = [areas[0][0], areas[areas.length - 1][0]];
    for (let o = FILL_VERTEX_RECORD.ids; o < gpu.fills.length; o += FILL_VERTEX_RECORD.words) {
      const paint = gpu.fills[o] >>> 16;
      if ((gpu.fills[o] & 0xffff) !== slot.item || (paint !== small && paint !== large)) continue;
      gpu.fills[o] = (gpu.fills[o] & 0xffff) | ((paint === small ? large : small) << 16);
    }
  },
};
const setF32 = (words, at, value) => {
  const f32 = new Float32Array(1);
  f32[0] = value;
  words[at] = new Uint32Array(f32.buffer)[0];
};

/** The page's V8 vs kit-mirror's hypot2 (bit-identical classification needs it on the browser's engine too). */
const HYPOT_CHECK = `(() => {
  const hypot2 = ${hypot2.toString()};
  let seed = 7, bad = 0, n = 0;
  const random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const bits = new Float64Array(1), words = new Uint32Array(bits.buffer);
  const value = (r) => { if (r < 0.3) { words[0] = random() * 2 ** 32; words[1] = random() * 2 ** 32; return bits[0]; } return r < 0.6 ? (random() - 0.5) * 10 ** (random() * 40 - 20) : (random() - 0.5) * 400; };
  for (let i = 0; i < 1000000; i++, n++) { const x = value(random()), y = value(random()); if (!Object.is(hypot2(x, y), Math.hypot(x, y))) bad++; }
  return { n, bad };
})()`;

async function contract(options) {
  const checks = createChecks("native-contract");
  const ticks = options.quick ? NATIVE.contract.quickTicks : LIVE.ticks;
  const rows = [];
  const rejected = Object.fromEntries(Object.keys(MUTATIONS).map((name) => [name, 0]));
  const kinds = new Set();
  await withBrowser(async (browser) => {
    const { cdp, problems, warnings, close } = await openRuntimePage(browser, { path: PAGE.dev(), dpr: 1 });
    try {
      const pending = [...INJECTIONS];
      for (const tick of ticks) {
        await advanceInjecting(cdp, tick, pending);
        await settle(cdp);
        const check = await cdp.evaluate("__gpu.nativeCheck()");
        if (!check) {
          checks.check(false, `t${tick}: native records available`, "nativeCheck() returned null");
          continue;
        }
        const result = compareContract(check, NATIVE.contract);
        rows.push({ tick, ...result, problems: result.problems.slice(0, 10) });
        checks.check(!result.problems.length, `t${tick}: native records == markup-path records (${result.polylines} polylines)`, result.problems.length ? result.problems.slice(0, 4).join("; ") : `max point distance ${result.maxDistance.toFixed(4)}, max area error ${(100 * result.maxAreaError).toFixed(0)} % of its rounding bound`);
        const segs = decodeSegs(check.gpu.segs, 0, check.gpu.segs.length / SEG_RECORD.words);
        for (const [name, mutate] of Object.entries(MUTATIONS)) {
          const gpu = { ...check.gpu, segs: [...check.gpu.segs], fills: [...check.gpu.fills] };
          mutate(gpu, segs);
          if (compareContract({ ...check, gpu }, NATIVE.contract).problems.length) rejected[name]++;
        }
        const markup = await cdp.evaluate(`["rotorBack", "rotorFront", "spout", "fall"].map((n) => FACTORY.slots["centrifuge:" + n].innerHTML).join("")`);
        for (const [, kind] of markup.matchAll(/data-kind="([^"]+)"/g)) kinds.add(kind);
      }
      for (const [name, count] of Object.entries(rejected)) checks.check(count === ticks.length, `self-test: the contract rejects a mutated ${name} at every tick`, `${count} / ${ticks.length}`);
      const injected = new Set(NATIVE_INJECT.flatMap((i) => i.kinds));
      checks.check([...injected].every((kind) => kinds.has(kind) || NATIVE_INJECT.find((i) => i.kinds.includes(kind)).tick > ticks[ticks.length - 1]), "every injected packet kind was drawn at a checked tick", [...kinds].join(", "));
      const hypot = await cdp.evaluate(HYPOT_CHECK);
      checks.check(hypot.bad === 0, "the browser's Math.hypot == kit-mirror hypot2 (bit for bit)", `${hypot.bad} of ${hypot.n} differ`);
      checks.check(!problems.length && !warnings.length, "dev page console clean", [...problems, ...warnings].slice(0, 3).join(" | "));
    } finally {
      await close();
    }
  });
  checks.finish({ rows, rejected, kinds: [...kinds] });
}

// ---- frames -----------------------------------------------------------------------------------------------------------
async function framesOf(browser, { path, ticks, dpr = 2, dir, prefix, after, inject = [], preloads = [] }) {
  const { cdp, problems, warnings, close } = await openRuntimePage(browser, { path, dpr, preloads });
  try {
    const box = await stageBox(cdp);
    const out = {};
    const pending = [...inject];
    for (const tick of ticks) {
      await advanceInjecting(cdp, tick, pending);
      await settle(cdp);
      out[tick] = { file: await shot(cdp, join(dir, `${prefix}-t${tick}.png`), box), state: await cdp.evaluate(RUNTIME_STATE) };
      if (after) await after(cdp, tick);
    }
    const stats = await cdp.evaluate("window.__gpu ? __gpu.frameStats() : null");
    const gpu = await cdp.evaluate("window.__gpu ? { errors: [...__gpu.errors], error: __gpu.error } : null");
    return { shots: out, problems: [...problems, ...warnings], stats, gpu, box, rotor: await rotorBox(cdp) };
  } finally {
    await close();
  }
}

/** Device-px box (in the stage shot) around the rotor slots' envelopes; null on pages without them. */
async function rotorBox(cdp) {
  return cdp.evaluate(`(() => {
    const s = window.__gpu?.frameStats?.(); const env = s?.envelopes; if (!env) return null;
    const boxes = ["rotorBack", "rotorFront"].map((n) => env["centrifuge:" + n]?.box).filter(Boolean); if (!boxes.length) return null;
    const svg = document.querySelector("svg.iso-svg"); const [vx, vy, vw] = svg.getAttribute("viewBox").split(" ").map(Number);
    const k = s.width / vw;
    const x0 = Math.min(...boxes.map((b) => b[0])), y0 = Math.min(...boxes.map((b) => b[1])), x1 = Math.max(...boxes.map((b) => b[2])), y1 = Math.max(...boxes.map((b) => b[3]));
    return [Math.floor((x0 - vx) * k), Math.floor((y0 - vy) * k), Math.ceil((x1 - x0) * k), Math.ceil((y1 - y0) * k)];
  })()`);
}

/** --mutate patch: a 1 CSS px grey square over the figure (the 0 px identity must see it). */
const PATCH = `addEventListener("DOMContentLoaded", () => { const stage = document.querySelector("canvas[data-gpu]")?.parentElement; if (!stage) return; const dot = document.createElement("div"); dot.style.cssText = "position:absolute;left:50%;top:45%;width:1px;height:1px;background:#888;z-index:9"; stage.append(dot); });`;

async function identity(options) {
  const mutate = options.mutate === "patch";
  if (options.mutate && !mutate) throw new Error(`identity: unknown mutation ${options.mutate}`);
  const checks = createChecks(mutate ? "native-identity-mutate-patch" : "native-identity");
  const ticks = options.quick ? NATIVE.identity.quickTicks : NATIVE.identity.ticks;
  await withBrowser(async (browser) => {
    for (const theme of options.quick ? ["dark"] : ["dark", "light"]) {
      const dir = join(OUT, "identity", theme);
      const cached = await framesOf(browser, { path: PAGE.native(theme), ticks, dir, prefix: "cached", preloads: mutate ? [PATCH] : [] });
      const full = await framesOf(browser, { path: PAGE.nativeUncached(theme), ticks, dir, prefix: "uncached" });
      for (const tick of ticks) {
        const d = compareImages(cached.shots[tick].file, full.shots[tick].file);
        checks.check(d.loose === 0 && d.withAA === 0, `${theme} t${tick}: cached == ?cache=0`, `${d.withAA} px differ`);
      }
      checks.check(cached.stats.native?.drawing && full.stats.native?.drawing, `${theme}: native painter drawing on both pages`, JSON.stringify(cached.stats.native));
      checks.check(!cached.problems.length && !full.problems.length, `${theme}: consoles clean`, [...cached.problems, ...full.problems].slice(0, 3).join(" | "));
    }
    if (mutate) return;
    // two device losses, then the same tick on a fresh page and on ?cache=0
    const dir = join(OUT, "identity", "loss");
    const [lossTick, end] = NATIVE.identity.loss;
    const lost = await framesOf(browser, {
      path: PAGE.native("dark"), ticks: [lossTick, end], dir, prefix: "lost",
      after: async (cdp, tick) => {
        if (tick !== lossTick) return;
        for (let n = 1; n <= 2; n++) {
          await cdp.evaluate("__gpu.simulateDeviceLoss()");
          await waitFor(cdp, `__gpu.frameStats().reinits >= ${n} && "lastEncodeMs" in __gpu.frameStats()`, 15000);
        }
      },
    });
    const fresh = await framesOf(browser, { path: PAGE.native("dark"), ticks: [end], dir, prefix: "fresh" });
    const uncached = await framesOf(browser, { path: PAGE.nativeUncached("dark"), ticks: [end], dir, prefix: "uncached" });
    checks.check(lost.stats.reinits === 2 && lost.stats.native?.drawing, "after two device losses the native painter draws again", JSON.stringify({ reinits: lost.stats.reinits, native: lost.stats.native?.drawing }));
    for (const [name, other] of [["a fresh page", fresh], ["?cache=0", uncached]]) {
      const d = compareImages(lost.shots[end].file, other.shots[end].file);
      checks.check(d.withAA === 0, `t${end} after the losses == ${name}`, `${d.withAA} px differ`);
    }
    checks.check(!lost.problems.length, "loss page console clean", lost.problems.slice(0, 3).join(" | "));
  });
  checks.finish();
}

/** [a | b | c] crops side by side, each zoomed ×factor. */
function sheetOf(files, [x, y, width, height], factor, outFile) {
  const gap = 4;
  const images = files.map((file) => zoom(crop(readPng(file), x, y, width, height), factor));
  const sheet = new PNG({ width: images.length * (width * factor + gap) - gap, height: height * factor });
  sheet.data.fill(255);
  images.forEach((image, i) => PNG.bitblt(image, sheet, 0, 0, image.width, image.height, i * (width * factor + gap), 0));
  mkdirSync(join(outFile, ".."), { recursive: true });
  writeFileSync(outFile, PNG.sync.write(sheet));
  return outFile;
}

const fit = ([x, y, w, h], image) => {
  const x0 = Math.max(0, x), y0 = Math.max(0, y);
  return [x0, y0, Math.min(image.width - x0, w), Math.min(image.height - y0, h)];
};

async function compare(options) {
  const checks = createChecks("native-compare");
  const quick = Boolean(options.quick);
  const ticks = quick ? NATIVE.compare.quickTicks : NATIVE.compare.ticks;
  const dprs = quick ? [2] : NATIVE.compare.dprs;
  const rows = [];
  await withBrowser(async (browser) => {
    for (const theme of quick ? ["dark"] : ["dark", "light"]) {
      for (const dpr of dprs) {
        const dir = join(OUT, "compare", `${theme}-dpr${dpr}`);
        const run = {};
        for (const kind of ["svg", "markup", "native"]) run[kind] = await framesOf(browser, { path: PAGE[kind](theme), ticks, dpr, dir, prefix: kind, inject: INJECTIONS });
        const limit = NATIVE.compare.limits[dpr];
        for (const tick of ticks) {
          const pair = (a, b) => compareImages(run[a].shots[tick].file, run[b].shots[tick].file, { diffFile: join(dir, `diff-${a}-${b}-t${tick}.png`) });
          const row = { theme, dpr, tick, nativeVsSvg: pair("svg", "native"), markupVsSvg: pair("svg", "markup"), nativeVsMarkup: pair("markup", "native") };
          for (const value of [row.nativeVsSvg, row.markupVsSvg, row.nativeVsMarkup]) delete value.width, delete value.height;
          rows.push(row);
          const d = row.nativeVsSvg;
          checks.check(d.loosePct <= limit.vsSvg.loosePct && d.withAAPct <= limit.vsSvg.withAAPct && d.solidCluster <= limit.vsSvg.solidCluster, `${theme} DPR ${dpr} t${tick}: native vs SVG within the live limits`, `loose ${d.loosePct}% · AA ${d.withAAPct}% · solid ${d.solidCluster} (markup path: ${row.markupVsSvg.loosePct}% · ${row.markupVsSvg.withAAPct}%)`);
          const m = row.nativeVsMarkup;
          checks.check(m.solidCluster <= limit.vsMarkup.solidCluster && m.loosePct <= limit.vsMarkup.loosePct, `${theme} DPR ${dpr} t${tick}: native vs markup path, no solid blob`, `loose ${m.loosePct}% · AA ${m.withAAPct}% · solid ${m.solidCluster} · blob ${m.looseCluster}`);
          const state = Object.keys(run.svg.shots[tick].state).filter((key) => key !== "ticks" && [run.markup, run.native].some((r) => r.shots[tick].state[key] !== run.svg.shots[tick].state[key]));
          checks.check(!state.length, `${theme} DPR ${dpr} t${tick}: runtime state equal on the three pages`, state.join(", "));
        }
        const rotor = run.native.rotor;
        if (rotor && NATIVE.compare.cropTicks.length) {
          for (const tick of NATIVE.compare.cropTicks.filter((t) => ticks.includes(t))) {
            const files = ["svg", "markup", "native"].map((kind) => run[kind].shots[tick].file);
            const image = readPng(files[0]);
            sheetOf(files, fit(rotor, image), 1, join(OUT, "crops", `${theme}-dpr${dpr}-t${tick}-x1.png`));
            const [x, y, w, h] = fit(rotor, image);
            // ×4 detail: the front quarter of the rotor (packets, vane ends, the spout mouth)
            sheetOf(files, fit([x + Math.round(w * 0.15), y + Math.round(h * 0.45), Math.round(w * 0.3), Math.round(h * 0.3)], image), 4, join(OUT, "crops", `${theme}-dpr${dpr}-t${tick}-x4.png`));
          }
        }
        for (const kind of ["svg", "markup", "native"]) checks.check(!run[kind].problems.length, `${theme} DPR ${dpr} ${kind} console clean`, run[kind].problems.slice(0, 3).join(" | "));
      }
    }
  });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "compare.json"), JSON.stringify(rows, null, 1));
  checks.finish({ rows });
}

async function sheet() {
  const checks = createChecks("native-sheet");
  const { theme, from, count } = NATIVE.sheet;
  const ticks = Array.from({ length: count }, (_, i) => from + i);
  const dir = join(OUT, "sheet", "frames");
  await withBrowser(async (browser) => {
    const run = await framesOf(browser, { path: PAGE.native(theme), ticks, dpr: 2, dir, prefix: "native" });
    const svg = await framesOf(browser, { path: PAGE.svg(theme), ticks, dpr: 2, dir, prefix: "svg" });
    const image = readPng(run.shots[from].file);
    const [x, y, w, h] = fit(run.rotor, image);
    const columns = 10;
    const tile = (files, outFile) => {
      const rows = Math.ceil(files.length / columns);
      const out = new PNG({ width: columns * (w + 2), height: rows * (h + 2) });
      out.data.fill(255);
      files.forEach((file, i) => PNG.bitblt(crop(readPng(file), x, y, w, h), out, 0, 0, w, h, (i % columns) * (w + 2), Math.floor(i / columns) * (h + 2)));
      writeFileSync(outFile, PNG.sync.write(out));
    };
    tile(ticks.map((t) => run.shots[t].file), join(OUT, "sheet", `${theme}-${from}-native.png`));
    tile(ticks.map((t) => svg.shots[t].file), join(OUT, "sheet", `${theme}-${from}-svg.png`));
    let worst = { solid: 0, tick: null };
    for (const t of ticks) {
      const d = compareImages(svg.shots[t].file, run.shots[t].file);
      if (d.solidCluster > worst.solid) worst = { solid: d.solidCluster, tick: t };
    }
    checks.check(worst.solid <= NATIVE.compare.limits[2].vsSvg.solidCluster, `${theme} ${from}–${from + count - 1}: no frame with a solid blob vs SVG`, JSON.stringify(worst));
  });
  checks.finish();
}

/**
 * Error containment (CQ-M5 S1): a packet kind the native rotor refuses makes its hook throw inside the guard. The
 * machine must fail alone — error recorded, not fatal, slots back on the markup path in the same tick — and from then
 * on the page must equal the ?native=0 page with the same injection (0 px), with the runtime state of the SVG page.
 */
async function fault() {
  const checks = createChecks("native-fault");
  const { theme, dpr, injectAt, kind, before, ticks } = NATIVE_FAULT;
  const inject = [...INJECTIONS.filter((i) => i.tick < injectAt), { tick: injectAt, js: `FACTORY.machines.centrifuge.accept("in", FACTORY.item(${JSON.stringify(kind)}))` }];
  const dir = join(OUT, "fault");
  await withBrowser(async (browser) => {
    const run = {};
    const states = {};
    const machineState = async (cdp, tick) => (states[tick] = await cdp.evaluate("__gpu.frameStats().native?.machines?.[0]?.state ?? null"));
    for (const page of ["svg", "markup"]) run[page] = await framesOf(browser, { path: PAGE[page](theme), ticks, dpr, dir, prefix: page, inject });
    run.native = await framesOf(browser, { path: PAGE.native(theme), ticks: [before, ...ticks], dpr, dir, prefix: "native", inject, after: machineState });
    checks.check(states[before] === "owning" && states[ticks[0]] === "failed", `the machine drew natively at t${before} and had failed by t${ticks[0]}`, JSON.stringify(states));
    const native = run.native.stats.native;
    const machine = native?.machines?.[0];
    checks.check(machine?.state === "failed" && /plain name/.test(machine.error ?? ""), "the refused kind failed the native machine", JSON.stringify({ state: machine?.state, error: machine?.error }));
    checks.check(run.native.gpu.errors.some((e) => /native centrifuge: .*plain name/.test(e)) && run.native.gpu.error === null, "the error is in __gpu.errors and not fatal (__gpu.error null, the figure stays on the GPU)", JSON.stringify(run.native.gpu));
    checks.check(native.active === true && native.drawing === false, "the host stays active; the failed machine no longer draws", JSON.stringify({ active: native.active, drawing: native.drawing }));
    for (const tick of ticks) {
      const d = compareImages(run.markup.shots[tick].file, run.native.shots[tick].file, { diffFile: join(dir, `diff-markup-native-t${tick}.png`) });
      checks.check(d.withAA === 0, `t${tick}: native page after the fault == ?native=0 page`, `${d.withAA} px differ (loose ${d.loosePct} %)`);
      const state = Object.keys(run.svg.shots[tick].state).filter((key) => key !== "ticks" && run.native.shots[tick].state[key] !== run.svg.shots[tick].state[key]);
      checks.check(!state.length, `t${tick}: runtime state == SVG page`, state.join(", "));
    }
    const unexpected = run.native.problems.filter((p) => !/native centrifuge: .*plain name/.test(p));
    checks.check(!unexpected.length && !run.markup.problems.length, "consoles clean (besides the native machine's own warning)", [...unexpected, ...run.markup.problems].slice(0, 3).join(" | "));
  });
  checks.finish();
}

const options = parseArgs(["quick"]);
const command = options._[0];
const COMMANDS = { contract, identity, compare, sheet, fault };
if (!COMMANDS[command]) {
  console.error(`usage: node tools/native-gate.mjs ${Object.keys(COMMANDS).join("|")} [--quick]`);
  process.exit(2);
}
await COMMANDS[command](options);
