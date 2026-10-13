// node tools/native-gate.mjs <command> [--quick] — M5 native rotor checks (thresholds: tools/gates.config.mjs NATIVE).
//   contract   dev page (out/gpu/live-dev.html): at each tick the native painter's GPU-expanded records, read back, equal
//              what the markup path builds from v2's strings for the same state: every polyline (order, paint, caps,
//              points within NATIVE.contract.pointTolerance viewBox units — the kit rounds to 0.1), the layer order,
//              the fill area per paint, and the hull the native path omits covered by its faces
//   identity   native page: cached frame == ?cache=0 (0 px) at rotor ticks; after two device losses the painter is
//              back and the frame == a fresh page and == ?cache=0
//   compare    native vs markup path (?native=0) vs SVG, lockstep, NATIVE.compare ticks × DPR 1/2/4 × both themes;
//              native vs SVG within the live limits, native vs markup without solid blobs; crops of the rotor at ×1
//              and ×4 in out/tmp/gates/native/crops
//   sheet      60 consecutive native frames of the rotor (light 700–759: spin-up through back / front swaps) as one
//              contact sheet, plus the frame-to-frame diff strip (out/tmp/gates/native/sheet)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { compareImages, crop, readPng, zoom } from "./diff.mjs";
import { GATES_OUT, PAGES, RUNTIME_STATE, advanceTo, createChecks, fileUrl, openRuntimePage, parseArgs, settle, shot, stageBox, waitFor, withBrowser } from "./harness.mjs";
import { LIVE, NATIVE } from "./gates.config.mjs";
import { FILL_VERTEX_RECORD, SEG_RECORD } from "../src/core/schemas.ts";

const OUT = join(GATES_OUT, "native");
const themed = (theme) => (theme === "light" ? "-light" : "");
const PAGE = {
  svg: (theme) => PAGES.svg(theme),
  native: (theme) => PAGES.gpu(theme),
  markup: (theme) => `${fileUrl(PAGES.gpu(theme))}?native=0`,
  nativeUncached: (theme) => `${fileUrl(PAGES.gpu(theme))}?cache=0`,
  dev: () => PAGES.gpuDev(),
};

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
      paint: u32[o + SEG_RECORD.paint],
      layer: u32[o + SEG_RECORD.layer],
      alpha: f32[o + SEG_RECORD.alpha],
      flags: u32[o + SEG_RECORD.flags],
      polyStart: u32[o + SEG_RECORD.polyStart],
      polyEnd: u32[o + SEG_RECORD.polyEnd],
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
    if (last && last.polyStart === s.polyStart) last.points.push(s.p1);
    else lines.push({ polyStart: s.polyStart, paint: s.paint, layer: s.layer, flagsFirst: s.flags, points: [s.p0, s.p1] });
  }
  return lines;
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
      if (line.flagsFirst !== other.flagsFirst && (line.flagsFirst & 48) !== (other.flagsFirst & 48)) problems.push(`${name} polyline ${i}: caps ${line.flagsFirst} vs ${other.flagsFirst}`);
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

async function contract(options) {
  const checks = createChecks("native-contract");
  const ticks = options.quick ? NATIVE.contract.quickTicks : LIVE.ticks;
  const rows = [];
  await withBrowser(async (browser) => {
    const { cdp, problems, warnings, close } = await openRuntimePage(browser, { path: PAGE.dev(), dpr: 1 });
    try {
      for (const tick of ticks) {
        await advanceTo(cdp, tick);
        await settle(cdp);
        const check = await cdp.evaluate("__gpu.nativeCheck()");
        if (!check) {
          checks.check(false, `t${tick}: native records available`, "nativeCheck() returned null");
          continue;
        }
        const result = compareContract(check, NATIVE.contract);
        rows.push({ tick, ...result, problems: result.problems.slice(0, 10) });
        checks.check(!result.problems.length, `t${tick}: native records == markup-path records (${result.polylines} polylines)`, result.problems.length ? result.problems.slice(0, 4).join("; ") : `max point distance ${result.maxDistance.toFixed(4)}, max area error ${(100 * result.maxAreaError).toFixed(0)} % of its rounding bound`);
      }
      checks.check(!problems.length && !warnings.length, "dev page console clean", [...problems, ...warnings].slice(0, 3).join(" | "));
    } finally {
      await close();
    }
  });
  checks.finish({ rows });
}

// ---- frames -----------------------------------------------------------------------------------------------------------
async function framesOf(browser, { path, ticks, dpr = 2, dir, prefix, after }) {
  const { cdp, problems, warnings, close } = await openRuntimePage(browser, { path, dpr });
  try {
    const box = await stageBox(cdp);
    const out = {};
    for (const tick of ticks) {
      await advanceTo(cdp, tick);
      await settle(cdp);
      out[tick] = { file: await shot(cdp, join(dir, `${prefix}-t${tick}.png`), box), state: await cdp.evaluate(RUNTIME_STATE) };
      if (after) await after(cdp, tick);
    }
    const stats = await cdp.evaluate("window.__gpu ? __gpu.frameStats() : null");
    return { shots: out, problems: [...problems, ...warnings], stats, box, rotor: await rotorBox(cdp) };
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

async function identity(options) {
  const checks = createChecks("native-identity");
  const ticks = options.quick ? NATIVE.identity.quickTicks : NATIVE.identity.ticks;
  await withBrowser(async (browser) => {
    for (const theme of options.quick ? ["dark"] : ["dark", "light"]) {
      const dir = join(OUT, "identity", theme);
      const cached = await framesOf(browser, { path: PAGE.native(theme), ticks, dir, prefix: "cached" });
      const full = await framesOf(browser, { path: PAGE.nativeUncached(theme), ticks, dir, prefix: "uncached" });
      for (const tick of ticks) {
        const d = compareImages(cached.shots[tick].file, full.shots[tick].file);
        checks.check(d.loose === 0 && d.withAA === 0, `${theme} t${tick}: cached == ?cache=0`, `${d.withAA} px differ`);
      }
      checks.check(cached.stats.native?.drawing && full.stats.native?.drawing, `${theme}: native painter drawing on both pages`, JSON.stringify(cached.stats.native));
      checks.check(!cached.problems.length && !full.problems.length, `${theme}: consoles clean`, [...cached.problems, ...full.problems].slice(0, 3).join(" | "));
    }
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
        for (const kind of ["svg", "markup", "native"]) run[kind] = await framesOf(browser, { path: PAGE[kind](theme), ticks, dpr, dir, prefix: kind });
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
    checks.check(worst.solid <= 4, `${theme} ${from}–${from + count - 1}: no frame with a solid blob vs SVG`, JSON.stringify(worst));
  });
  checks.finish();
}

const options = parseArgs(["quick"]);
const command = options._[0];
const COMMANDS = { contract, identity, compare, sheet };
if (!COMMANDS[command]) {
  console.error(`usage: node tools/native-gate.mjs ${Object.keys(COMMANDS).join("|")} [--quick]`);
  process.exit(2);
}
await COMMANDS[command](options);
