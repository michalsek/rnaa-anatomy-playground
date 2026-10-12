// In-page part of tools/gate.mjs (inlined after dl-format, palette-probe and dl2svg): resolve the palette with probes,
// redraw the figure svg from the DL, and report checks through console.warn (capture.mjs prints warnings).
function runGate(json, base64) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const sections = sectionsOf(bytes.buffer);
  const svg = document.querySelector(".fx-stage svg");
  const t0 = performance.now();
  const paints = resolvePalette(json.palette, svg);
  const t1 = performance.now();
  svg.innerHTML = renderDlSvg(json, sections, paints);
  const t2 = performance.now();
  const fail = (text) => console.warn(`DLGATE FAIL ${text}`.slice(0, 390));

  const gradientPaints = new Set(json.gradients.map((g) => g.paint));
  const unresolved = paints.filter((p) => !p.color && !gradientPaints.has(p.id));
  if (unresolved.length) fail(`unresolved paints ${unresolved.map((p) => `${p.id}:${p.prop}=${p.raw}`).join(" ")}`);

  // props a role did not emit must compute to none (fill-only elements have no stroke, lines have no fill)
  const elementKey = (e) => JSON.stringify([e.ancestors, e.el]);
  const emitted = new Set(json.palette.map((e) => `${e.prop}|${elementKey(e)}`));
  const roleGaps = json.palette.filter((e) => {
    const other = e.prop === "fill" ? "stroke" : e.prop === "stroke" ? "fill" : null;
    return other && paints[e.id].other !== "none" && !emitted.has(`${other}|${elementKey(e)}`);
  });
  if (roleGaps.length) fail(`role gaps (CSS paints a prop the DL does not emit) ${roleGaps.map((e) => `${e.id}:${e.el.attrs.class}/${e.prop}->${paints[e.id].other}`).join(" ")}`);

  // stroke geometry assumed by roles.mjs vs computed style; halo / blend flags vs computed filter / blend mode
  const P = LAYOUTS.prims.stride / 4;
  const S = LAYOUTS.segments.stride / 4;
  let geometry = 0;
  let flagged = 0;
  const detail = [];
  for (let p = 0; p < sections.prims.count; p++) {
    const kind = sections.prims.u32[p * P];
    const paintId = sections.prims.u32[p * P + 3];
    const flags = sections.prims.u32[p * P + 7];
    const first = sections.prims.u32[p * P + 5];
    const paint = paints[paintId & PAINT_GRADIENT ? json.gradients[paintId & ~PAINT_GRADIENT].paint : paintId];
    const halo = paint.filter !== "none";
    const blend = paint.blend !== "normal";
    if (halo !== !!(flags & PRIM_FLAG.halo) || blend !== !!(flags & PRIM_FLAG.blend)) flagged++;
    if (kind !== PRIM_KIND.stroke || !sections.prims.u32[p * P + 6]) continue;
    const segFlags = sections.segments.u32[first * S + 9];
    const width = sections.segments.f32[first * S + 8];
    const capOk = (paint.cap === "round") === !!(segFlags & SEG_FLAG.capRound);
    const joinOk = (paint.join === "round") === !!(segFlags & SEG_FLAG.joinRound);
    const widthOk = segFlags & SEG_FLAG.widthOverride || Math.abs(paint.width - width) < 1e-3;
    if (!capOk || !joinOk || !widthOk) {
      geometry++;
      if (detail.length < 4) detail.push(`prim ${p} paint ${paintId}: ${width}/${segFlags} vs ${paint.width} ${paint.cap} ${paint.join}`);
    }
  }
  if (geometry) fail(`stroke geometry ${geometry} prims: ${detail.join("; ")}`);
  if (flagged) fail(`halo/blend flags disagree with computed filter/blend on ${flagged} prims`);
  const overridden = alphaAttrsOverridden(json.palette, svg);
  if (overridden.length) fail(`CSS overrides markup opacity ${JSON.stringify(overridden)}`);
  const theme = document.body.dataset.theme;
  // live-only paint (lamp glow is drawn in a slot): its blend mode must follow the theme
  const [glow] = resolvePalette([{ id: 0, prop: "fill", ancestors: [{ tag: "g", attrs: { class: "fx-parts" } }], el: { tag: "circle", attrs: { class: "cf-glow" } }, alphaAttrs: [] }], svg);
  const expectedBlend = theme === "dark" ? "screen" : "multiply";
  if (glow.blend !== expectedBlend || !glow.color) fail(`lamp glow probe ${glow.raw} ${glow.blend}, expected ${expectedBlend}`);
  const sample = (i) => `${i}:${paints[i].raw}`;
  console.warn(`DLGATE ${unresolved.length + roleGaps.length + geometry + flagged + overridden.length ? "checked" : "ok"} theme=${theme} palette=${paints.length} probe=${(t1 - t0).toFixed(1)}ms render=${(t2 - t1).toFixed(1)}ms samples ${[0, 1, 5].map(sample).join(" ")} glow ${glow.raw} ${glow.blend}`);
}
