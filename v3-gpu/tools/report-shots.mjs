// node tools/report-shots.mjs [--themes light,dark] [--readme-only] — side-by-side comparison images for the report (M4), written to
// report/ with report/README.md (what each image shows, pixel-diff numbers) and report/shots.json.
//
// Pages: the committed v2 pages (../v2-factory/parts/centrifuge/centrifuge(-light).html, not rebuilt) and the
// deliverables (centrifuge-gpu(-light).html). Both are driven by the anatomy skill's drive.mjs (one Chrome per run,
// started through tools/chrome.mjs spawnGuarded) with tools/lockstep.js and the gates' tick gate as preload, so every
// pair of shots shows the same runtime tick (the readouts printed by drive.mjs are compared too). The committed v2 page
// predates the v2 runtime's `frameOffset` hook (FINDINGS-M1 #1); out/svg (a fresh build) is shot as well and must equal
// it at the card tick, which shows the hook is inert here.
//   card     the full card at DPR 2 ("1×"), tick CARD_TICK
//   crops    CROPS at DPR 4 — the page re-rendered at device scale 4 (the GPU canvas draws at DPR 4), not magnified
//   strip    STRIP_FRAMES frames of the rotor region at DPR 2, one every STRIP_STEP ticks over one rotor turn
// Diff measures as in the gates (tools/diff.mjs): pixelmatch 0.1 loose (AA excluded) / incl. AA, Δ>8, max Δ, solid
// blob. Heatmaps: the v2 image greyed out, every differing pixel coloured by its largest channel difference.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { spawnGuarded } from "./chrome.mjs";
import { STRICT_DELTA, compareImages, readPng } from "./diff.mjs";
import { GATE_LOCKSTEP, PAGES, ROOT, TICK_GATE, advanceTo, lockstepPreload, openRuntimePage, parseArgs, settle, withBrowser } from "./harness.mjs";

const REPORT = join(ROOT, "report");
const WORK = join(ROOT, "out/tmp/report");
const DRIVE = join(process.env.ANATOMY_SCRIPTS ?? join(homedir(), ".claude/skills/anatomy/scripts"), "drive.mjs");
const VIEWPORT = { width: 1280, height: 1400 };
/** In sync, four packets held, the lamp at its brightest (gates.config.mjs LIVE: lamp maximum 971). */
const CARD_TICK = 971;
/** From the release (884) over one rotor turn at ≈ 14 rpm (≈ 252 ticks): release, fall, hand-off, refill. */
const STRIP_FIRST = 884;
const STRIP_STEP = 21;
const STRIP_FRAMES = 12;
const STRIP_TICKS = Array.from({ length: STRIP_FRAMES }, (_, i) => STRIP_FIRST + i * STRIP_STEP);
const PAGE_SOURCES = {
  v2: (theme) => join(ROOT, `../v2-factory/parts/centrifuge/centrifuge${theme === "light" ? "-light" : ""}.html`),
  gpu: (theme) => join(ROOT, PAGES.deliverable(theme)),
  fresh: (theme) => join(ROOT, PAGES.svg(theme)),
};
const STAGE = ".fx-stage";
const PLATE = ".iso-plate";
/** Heatmap bins of the largest channel difference (of 255): colour and meaning. */
const HEAT_BINS = [
  { upTo: STRICT_DELTA, rgb: [59, 130, 246], meaning: `1–${STRICT_DELTA}: anti-aliasing level` },
  { upTo: 32, rgb: [245, 158, 11], meaning: `${STRICT_DELTA + 1}–32: visible on a zoomed edge` },
  { upTo: 255, rgb: [239, 68, 68], meaning: "> 32: a different colour" },
];
/**
 * The crops: which parts each shows, as CSS px regions of the stage around page elements (found on the v2 page at
 * CARD_TICK): `of` selectors whose union is cropped, padded, clamped to `max` and anchored at `anchor` of the union.
 */
const CROPS = [
  { name: "rotor", title: "rotor + packets (native rotor slots, packet strokes)", of: ['[data-slot="centrifuge:rotorBack"]', '[data-slot="centrifuge:rotorFront"]'], max: [200, 150] },
  { name: "tach", title: "tach dial hairlines and the 1.3 px sync mark", of: ['[data-name="centrifuge.tach"]', '[data-slot="centrifuge:tach"]'], max: [120, 100] },
  { name: "belt-stub", title: "belt stub edges (bed, rails, slats slot)", of: ['[data-name="stub.belt.bed"]'], max: [180, 110], anchor: [0.35, 0.5] },
  { name: "funnel", title: "funnel void linear gradient", of: ['[data-name="centrifuge.funnel"]'], max: [160, 120] },
  { name: "halo", title: "floor halo edge (pre-blurred, 9 px blur, 3 px offset)", of: [".iso-halo"], max: [150, 110], anchor: [0.02, 0.6] },
  { name: "motor-ribs", title: "motor ribs (group opacity .95 / .65 / .20)", of: ['[data-name="centrifuge.motor"]'], max: [170, 130] },
  { name: "lamp", title: "lamp glow (mix-blend multiply light / screen dark)", of: ['[data-slot="centrifuge:lamp"]', '[data-name="centrifuge.lamp-lens"]'], max: [110, 90] },
];
const CROP_SCALE = 4;
const CARD_SCALE = 2;
const PAD = 8;

const preloadFile = join(WORK, "lockstep-preload.js");
const advance = (tick) => [
  ["eval", `(() => { const g = __tickGate; g.target = ${tick}; if (g.ticks < ${tick}) __lockstep.resume(); return g.ticks; })()`],
  ["until", `__tickGate.ticks >= ${tick} && __tickGate.frozenAt === __lockstep.frame`, 120000],
  ["until", `__tickGate.ticks === ${tick}`, 1000],
  ["until", "!window.__gpu || window.__gpu.ready || !!window.__gpu.error", 60000],
  ["eval", "__lockstep.realFrames(3).then(() => __tickGate.ticks)"],
];

/** Regions (CSS px of the stage) of every crop, measured on the v2 page at CARD_TICK. */
async function cropRegions(theme) {
  return withBrowser(async (browser) => {
    const { cdp, close } = await openRuntimePage(browser, { path: PAGE_SOURCES.v2(theme), dpr: CARD_SCALE, ...VIEWPORT });
    try {
      await advanceTo(cdp, CARD_TICK);
      await settle(cdp);
      const found = await cdp.evaluate(`(() => {
        const stage = document.querySelector(${JSON.stringify(STAGE)}).getBoundingClientRect();
        const crops = ${JSON.stringify(CROPS)};
        return Object.fromEntries(crops.map(({ name, of, max, anchor = [0.5, 0.5] }) => {
          const rects = of.flatMap((selector) => [...document.querySelectorAll(selector)]).map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height);
          const x0 = Math.min(...rects.map((r) => r.left)) - ${PAD}, y0 = Math.min(...rects.map((r) => r.top)) - ${PAD};
          const x1 = Math.max(...rects.map((r) => r.right)) + ${PAD}, y1 = Math.max(...rects.map((r) => r.bottom)) + ${PAD};
          const width = Math.min(max[0], x1 - x0), height = Math.min(max[1], y1 - y0);
          const left = x0 + (x1 - x0 - width) * anchor[0], top = y0 + (y1 - y0 - height) * anchor[1];
          return [name, [Math.round(left - stage.left), Math.round(top - stage.top), Math.round(width), Math.round(height)]];
        }));
      })()`);
      return found;
    } finally {
      await close();
    }
  });
}

/** Runs drive.mjs on `page` with `actions`; resolves to the readouts it printed after each shot. */
function drive(page, scale, actions, name) {
  const actionsFile = join(WORK, `${name}.actions.json`);
  writeFileSync(actionsFile, JSON.stringify(actions, null, 1));
  const { child } = spawnGuarded(process.execPath, [DRIVE, page, "--actions", actionsFile, "--width", String(VIEWPORT.width), "--height", String(VIEWPORT.height), "--scale", String(scale), "--preload", preloadFile]);
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  return new Promise((resolve, reject) =>
    child.on("exit", (code) => {
      writeFileSync(join(WORK, `${name}.log`), output);
      if (code) return reject(new Error(`drive ${name} exited ${code}:\n${output.slice(-2000)}`));
      if (/exception|console error/i.test(output)) return reject(new Error(`drive ${name}: page problems:\n${output.slice(-2000)}`));
      resolve([...output.matchAll(/^shot (\S+) · readout "([^"]*)"/gm)].map((m) => ({ file: m[1], readout: m[2] })));
    }),
  );
}

const shotFile = (kind, theme, subject) => join(WORK, kind, `${theme}-${subject}.png`);

/** The card + strip run (DPR 2) and the crop run (DPR 4) of one page. */
async function shootPage(kind, theme, regions) {
  const page = PAGE_SOURCES[kind](theme);
  const stops = [...new Set([...STRIP_TICKS, CARD_TICK])].sort((a, b) => a - b);
  const cardRun = [["until", "window.__tickGate && __tickGate.ticks >= 1", 60000]];
  for (const tick of stops) {
    cardRun.push(...advance(tick));
    if (tick === CARD_TICK) cardRun.push(["shot", shotFile(kind, theme, "card"), PLATE, 1]);
    if (kind !== "fresh" && STRIP_TICKS.includes(tick)) cardRun.push(["shot", shotFile(kind, theme, `strip-t${tick}`), STAGE, 1, regions.rotor]);
  }
  const cropRun = [["until", "window.__tickGate && __tickGate.ticks >= 1", 60000], ...advance(CARD_TICK), ...CROPS.map(({ name }) => ["shot", shotFile(kind, theme, `crop-${name}`), STAGE, 1, regions[name]])];
  const readouts = await drive(page, CARD_SCALE, cardRun, `${kind}-${theme}-card`);
  if (kind !== "fresh") readouts.push(...(await drive(page, CROP_SCALE, cropRun, `${kind}-${theme}-crops`)));
  return readouts;
}

function heatmap(reference, other) {
  const out = new PNG({ width: reference.width, height: reference.height });
  let maxDelta = 0;
  for (let i = 0; i < reference.data.length; i += 4) {
    const delta = Math.max(Math.abs(reference.data[i] - other.data[i]), Math.abs(reference.data[i + 1] - other.data[i + 1]), Math.abs(reference.data[i + 2] - other.data[i + 2]));
    maxDelta = Math.max(maxDelta, delta);
    const bin = delta ? HEAT_BINS.find((b) => delta <= b.upTo) : null;
    const grey = 150 + Math.round((0.299 * reference.data[i] + 0.587 * reference.data[i + 1] + 0.114 * reference.data[i + 2]) * 0.35);
    [out.data[i], out.data[i + 1], out.data[i + 2]] = bin ? bin.rgb : [grey, grey, grey];
    out.data[i + 3] = 255;
  }
  return { image: out, maxDelta };
}

/** [v2 | GPU | heatmap] with a gap in the theme's card colour. */
function triptych(images, background) {
  const gap = 12;
  const { width, height } = images[0];
  const sheet = new PNG({ width: width * images.length + gap * (images.length - 1), height });
  for (let i = 0; i < sheet.data.length; i += 4) [sheet.data[i], sheet.data[i + 1], sheet.data[i + 2], sheet.data[i + 3]] = [...background, 255];
  images.forEach((image, i) => PNG.bitblt(image, sheet, 0, 0, width, height, i * (width + gap), 0));
  return sheet;
}

/** Rows of frames: v2, GPU, heatmap; one column per tick. */
function stripSheet(rows, background) {
  const gap = 6;
  const { width, height } = rows[0][0];
  const columns = rows[0].length;
  const sheet = new PNG({ width: columns * width + (columns - 1) * gap, height: rows.length * height + (rows.length - 1) * gap });
  for (let i = 0; i < sheet.data.length; i += 4) [sheet.data[i], sheet.data[i + 1], sheet.data[i + 2], sheet.data[i + 3]] = [...background, 255];
  rows.forEach((row, r) => row.forEach((image, c) => PNG.bitblt(image, sheet, 0, 0, width, height, c * (width + gap), r * (height + gap))));
  return sheet;
}

const write = (file, png) => writeFileSync(file, PNG.sync.write(png));
const CARD_BACKGROUND = { light: [251, 251, 250], dark: [19, 19, 19] };

function comparePair(theme, subject, { saveSide }) {
  const a = readPng(shotFile("v2", theme, subject));
  const b = readPng(shotFile("gpu", theme, subject));
  const diff = compareImages(a, b);
  const { image: heat, maxDelta } = heatmap(a, b);
  const stem = `${theme}-${subject}`;
  write(join(REPORT, `${stem}-v2.png`), a);
  write(join(REPORT, `${stem}-gpu.png`), b);
  write(join(REPORT, `${stem}-heat.png`), heat);
  if (saveSide) write(join(REPORT, `${stem}-side.png`), triptych([a, b, heat], CARD_BACKGROUND[theme]));
  return { subject, stem, width: a.width, height: a.height, loosePct: diff.loosePct, withAAPct: diff.withAAPct, strictPct: diff.strictPct, maxDelta, solidCluster: diff.solidCluster };
}

const options = parseArgs(["readme-only"]);
if (options["readme-only"]) {
  writeFileSync(join(REPORT, "README.md"), readme(JSON.parse(readFileSync(join(REPORT, "shots.json"), "utf8"))));
  console.log("report/README.md rewritten from report/shots.json");
  process.exit(0);
}
const themes = options.themes ? String(options.themes).split(",") : ["light", "dark"];
mkdirSync(REPORT, { recursive: true });
for (const kind of Object.keys(PAGE_SOURCES)) mkdirSync(join(WORK, kind), { recursive: true });
writeFileSync(preloadFile, `${lockstepPreload(GATE_LOCKSTEP)}\n;\n${TICK_GATE}`);

const results = { cardTick: CARD_TICK, cardScale: CARD_SCALE, cropScale: CROP_SCALE, stripTicks: STRIP_TICKS, viewport: VIEWPORT, themes: {} };
for (const theme of themes) {
  const regions = await cropRegions(theme);
  const readouts = {};
  for (const kind of Object.keys(PAGE_SOURCES)) readouts[kind] = await shootPage(kind, theme, regions);
  const label = (shot) => shot.file.slice(shot.file.lastIndexOf("/") + 1);
  const readoutOf = (kind) => Object.fromEntries(readouts[kind].map((shot) => [label(shot), shot.readout]));
  const v2Readouts = readoutOf("v2");
  const gpuReadouts = readoutOf("gpu");
  const mismatched = Object.keys(v2Readouts).filter((key) => v2Readouts[key] !== gpuReadouts[key]);
  if (mismatched.length) throw new Error(`${theme}: readouts differ between v2 and GPU shots: ${mismatched.join(", ")}`);

  const fresh = compareImages(shotFile("v2", theme, "card"), shotFile("fresh", theme, "card"));
  const pairs = [comparePair(theme, "card", { saveSide: false }), ...CROPS.map(({ name }) => comparePair(theme, `crop-${name}`, { saveSide: true }))];

  const frames = STRIP_TICKS.map((tick) => {
    const a = readPng(shotFile("v2", theme, `strip-t${tick}`));
    const b = readPng(shotFile("gpu", theme, `strip-t${tick}`));
    return { tick, a, b, heat: heatmap(a, b), diff: compareImages(a, b) };
  });
  write(join(REPORT, `${theme}-strip.png`), stripSheet([frames.map((f) => f.a), frames.map((f) => f.b), frames.map((f) => f.heat.image)], CARD_BACKGROUND[theme]));
  results.themes[theme] = {
    regions,
    readout: v2Readouts[`${theme}-card.png`],
    v2VsFreshSvg: { loose: fresh.loose, withAA: fresh.withAA, strict: fresh.strict },
    pairs,
    strip: frames.map(({ tick, diff, heat }) => ({ tick, loosePct: diff.loosePct, withAAPct: diff.withAAPct, strictPct: diff.strictPct, maxDelta: heat.maxDelta, solidCluster: diff.solidCluster, readout: v2Readouts[`${theme}-strip-t${tick}.png`] })),
  };
  console.log(`${theme}: card + ${CROPS.length} crops + strip; v2 vs fresh SVG ${fresh.loose} px loose / ${fresh.withAA} incl. AA`);
}
writeFileSync(join(REPORT, "shots.json"), JSON.stringify(results, null, 1));
writeFileSync(join(REPORT, "README.md"), readme(results));
console.log("report/README.md written");

function readme({ themes: byTheme }) {
  const fmt = (value, digits = 4) => (Number.isFinite(value) ? value.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "") : "–");
  const row = (p, link) => `| ${link} | ${p.width}×${p.height} | ${fmt(p.loosePct)} | ${fmt(p.withAAPct)} | ${fmt(p.strictPct)} | ${p.maxDelta} | ${p.solidCluster} |`;
  const header = "| image | px | loose % | incl. AA % | Δ>8 % | max Δ | solid blob px |\n|---|---:|---:|---:|---:|---:|---:|";
  const sections = Object.entries(byTheme).map(([theme, t]) => {
    const subjects = t.pairs.map((p) => {
      const crop = CROPS.find(({ name }) => `crop-${name}` === p.subject);
      const what = crop ? `${crop.title} — ${CROP_SCALE}× (DPR ${CROP_SCALE})` : `full card — 1× (DPR ${CARD_SCALE})`;
      const files = `[v2](${p.stem}-v2.png) · [GPU](${p.stem}-gpu.png) · [heat](${p.stem}-heat.png)${crop ? ` · [side by side](${p.stem}-side.png)` : ""}`;
      return row(p, `**${what}**<br>${files}`);
    });
    const strip = t.strip.map((f) => `| t${f.tick} | ${f.readout} | ${fmt(f.loosePct)} | ${fmt(f.withAAPct)} | ${fmt(f.strictPct)} | ${f.maxDelta} | ${f.solidCluster} |`);
    return `## ${theme}${theme === "light" ? " (ships)" : ""}

Tick ${CARD_TICK}: "${t.readout}". The committed v2 page vs a fresh v2 build (out/svg) at that tick: ${t.v2VsFreshSvg.loose} px loose,
${t.v2VsFreshSvg.withAA} px incl. AA, ${t.v2VsFreshSvg.strict} px Δ>8 (the stale runtime's missing \`frameOffset\` hook is inert on this page).

${header}
${subjects.join("\n")}

### Motion strip — [${theme}-strip.png](${theme}-strip.png)

Rotor region at DPR ${CARD_SCALE}, ${STRIP_FRAMES} frames every ${STRIP_STEP} ticks from the release (≈ one rotor turn). Rows: v2 SVG, GPU, heatmap.

| tick | readout | loose % | incl. AA % | Δ>8 % | max Δ | solid blob px |
|---|---|---:|---:|---:|---:|---:|
${strip.join("\n")}`;
  });
  return `# Comparison shots: v2 SVG vs the WebGPU deliverable

Generated by \`node tools/report-shots.mjs\` (do not edit by hand; numbers also in [shots.json](shots.json)).

- **v2**: the committed \`../v2-factory/parts/centrifuge/centrifuge(-light).html\` (not rebuilt). **GPU**: the deliverable
  \`centrifuge-gpu(-light).html\` (native rotor, static cache on — the defaults).
- Both driven by the anatomy skill's \`drive.mjs\` with \`tools/lockstep.js\` (turbo frames, time rebased at the runtime's
  start, GPU ready first) and the gates' tick gate: every pair shows the same runtime tick, and the readouts printed at
  each shot are equal. Viewport ${VIEWPORT.width} × ${VIEWPORT.height} CSS px.
- Crops are rendered at device scale ${CROP_SCALE} (the GPU canvas draws ${CROP_SCALE} device px per CSS px), not magnified.
- Measures as in the gates (tools/diff.mjs): **loose** = pixelmatch 0.1 with anti-aliased pixels excluded, **incl. AA**
  = the same with them counted, **Δ>8** = any channel moved by more than 8 / 255, **max Δ** = the largest channel
  difference, **solid blob** = the largest blob of loose differences surviving a 3 × 3 erosion (a missing or moved
  part; 0 everywhere in the gates).
- Heatmaps: the v2 image greyed out; differing pixels coloured by their largest channel difference:
${HEAT_BINS.map((b) => `  rgb(${b.rgb.join(", ")}) ${b.meaning}`).join(";\n")}.
- \`hero-light.png\`, \`hero-dark.png\`, \`hero-light-reduced.png\` (reduced motion): the deliverables as a visitor sees
  them, captured in real time by the anatomy skill's \`capture.mjs\` (1×, 1280 px viewport, 4 s after load) — not
  compared, not lockstepped.

${sections.join("\n\n")}
`;
}
