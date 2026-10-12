// In-page part of tools/gate.mjs (bundled by esbuild into the "dl" gate page): resolve the palette with probes, redraw
// the figure svg from the DL, and report checks through console.warn (capture.mjs prints warnings). Every report line
// starts with "DLGATE"; any "DLGATE FAIL" fails the gate.
import { sectionsOf, FIELD_WORD, STRIDE_WORDS, PRIM_KIND, PRIM_FLAG, SEG_FLAG, isGradientPaint, gradientIndexOf } from "../export/dl-format.mjs";
import { resolvePalette, alphaAttrsOverridden } from "../export/palette-probe.mjs";
import { roleOf, ROLE_PROBES } from "../export/roles.mjs";
import { renderDlSvg } from "./dl2svg.mjs";

const CAPTURE_CONSOLE_LIMIT = 390; // capture.mjs cuts console arguments at 400 characters
const SUPPORTED_COMPUTED = { fillRule: "nonzero", dashArray: "none", clipPath: "none", mask: "none" }; // what the DL can draw

const fail = (text) => console.warn(`DLGATE FAIL ${text}`.slice(0, CAPTURE_CONSOLE_LIMIT));

export function runGate(json, base64) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const sections = sectionsOf(bytes);
  const svg = document.querySelector(".fx-stage svg");
  const t0 = performance.now();
  const paints = resolvePalette(json.palette, svg);
  const t1 = performance.now();
  svg.innerHTML = renderDlSvg(json, sections, paints);
  const t2 = performance.now();
  let failures = 0;
  const check = (ok, text) => {
    if (ok) return;
    failures++;
    fail(text());
  };

  const gradientPaints = new Set(json.gradients.map((g) => g.paint));
  const unresolved = paints.filter((p) => !p.color && !gradientPaints.has(p.id));
  check(!unresolved.length, () => `unresolved paints ${unresolved.map((p) => `${p.id}:${p.prop}=${p.raw}`).join(" ")}`);

  // computed properties the DL cannot express must keep their initial values (CSS could set them; the markup can't)
  for (const [property, expected] of Object.entries(SUPPORTED_COMPUTED)) {
    const off = paints.filter((p) => p.prop !== "stop-color" && p[property] !== expected);
    check(!off.length, () => `${property} ≠ ${expected} on ${off.map((p) => `${p.id}=${p[property]}`).join(" ")}`);
  }

  // props a role did not emit must compute to none (fill-only elements have no stroke, lines have no fill)
  const elementKey = (e) => JSON.stringify([e.ancestors, e.el]);
  const emitted = new Set(json.palette.map((e) => `${e.prop}|${elementKey(e)}`));
  const roleGaps = json.palette.filter((e) => {
    const other = e.prop === "fill" ? "stroke" : e.prop === "stroke" ? "fill" : null;
    return other && paints[e.id].other !== "none" && !emitted.has(`${other}|${elementKey(e)}`);
  });
  check(!roleGaps.length, () => `role gaps (CSS paints a prop the DL does not emit) ${roleGaps.map((e) => `${e.id}:${e.el.attrs.class}/${e.prop}->${paints[e.id].other}`).join(" ")}`);

  // every roles.mjs rule, used by the scene or not: computed fill / stroke / geometry vs roleOf
  const probes = resolvePalette(ROLE_PROBES.map((probe, id) => ({ id, prop: "fill", ancestors: probe.ancestors, el: probe.el, alphaAttrs: [] })), svg);
  const roleDrift = [];
  ROLE_PROBES.forEach((probe, i) => {
    const role = roleOf({ tag: probe.el.tag, attrs: probe.el.attrs, chain: probe.ancestors });
    const computed = probes[i];
    const paintsFill = computed.raw !== "none";
    const paintsStroke = computed.other !== "none";
    const name = `${probe.el.tag}.${probe.el.attrs.class ?? ""}${probe.ancestors.length > 2 ? ` in ${probe.ancestors[probe.ancestors.length - 1].attrs.class}` : ""}`;
    if (paintsFill !== role.fill) roleDrift.push(`${name} fill ${computed.raw}`);
    if (paintsStroke !== Boolean(role.stroke)) roleDrift.push(`${name} stroke ${computed.other}`);
    else if (role.stroke && (Math.abs(computed.width - role.stroke.width) > 1e-3 || computed.cap !== role.stroke.cap || computed.join !== role.stroke.join))
      roleDrift.push(`${name} ${computed.width} ${computed.cap} ${computed.join} vs ${role.stroke.width} ${role.stroke.cap} ${role.stroke.join}`);
  });
  check(!roleDrift.length, () => `roles.mjs vs CSS: ${roleDrift.join("; ")}`);

  // stroke geometry the DL carries vs computed style of the prim's palette entry; halo / blend flags vs filter / blend
  const PRIM = FIELD_WORD.prims;
  const SEGMENT = FIELD_WORD.segments;
  let geometry = 0;
  let flagged = 0;
  const detail = [];
  for (let p = 0; p < sections.prims.count; p++) {
    const prim = (field) => sections.prims.u32[p * STRIDE_WORDS.prims + PRIM[field]];
    const paintId = prim("paint");
    const paint = paints[isGradientPaint(paintId) ? json.gradients[gradientIndexOf(paintId)].paint : paintId];
    const halo = paint.filter !== "none";
    const blend = paint.blend !== "normal";
    if (halo !== Boolean(prim("flags") & PRIM_FLAG.halo) || blend !== Boolean(prim("flags") & PRIM_FLAG.blend)) flagged++;
    if (prim("kind") !== PRIM_KIND.stroke || !prim("count")) continue;
    const segment = prim("first") * STRIDE_WORDS.segments;
    const segFlags = sections.segments.u32[segment + SEGMENT.flags];
    const width = sections.segments.f32[segment + SEGMENT.width];
    const capOk = (paint.cap === "round") === Boolean(segFlags & SEG_FLAG.capRound);
    const joinOk = (paint.join === "round") === Boolean(segFlags & SEG_FLAG.joinRound);
    const widthOk = segFlags & SEG_FLAG.widthOverride || Math.abs(paint.width - width) < 1e-3;
    if (!capOk || !joinOk || !widthOk) {
      geometry++;
      if (detail.length < 4) detail.push(`prim ${p} paint ${paintId}: ${width}/${segFlags} vs ${paint.width} ${paint.cap} ${paint.join}`);
    }
  }
  check(!geometry, () => `stroke geometry ${geometry} prims: ${detail.join("; ")}`);
  check(!flagged, () => `halo/blend flags disagree with computed filter/blend on ${flagged} prims`);
  const overridden = alphaAttrsOverridden(json.palette, svg);
  check(!overridden.length, () => `CSS overrides markup opacity ${JSON.stringify(overridden)}`);

  // live-only paint (lamp glow is drawn in a slot): its blend mode must follow the theme
  const theme = document.body.dataset.theme;
  const [glow] = resolvePalette([{ id: 0, prop: "fill", ancestors: [{ tag: "g", attrs: { class: "fx-parts" } }], el: { tag: "circle", attrs: { class: "cf-glow" } }, alphaAttrs: [] }], svg);
  const expectedBlend = theme === "dark" ? "screen" : "multiply";
  check(glow.blend === expectedBlend && glow.color, () => `lamp glow probe ${glow.raw} ${glow.blend}, expected ${expectedBlend}`);

  const samples = [0, 1, 5].filter((i) => i < paints.length).map((i) => `${i}:${paints[i].raw}`);
  console.warn(`DLGATE ${failures ? "checked" : "ok"} theme=${theme} palette=${paints.length} roleProbes=${ROLE_PROBES.length} probe=${(t1 - t0).toFixed(1)}ms render=${(t2 - t1).toFixed(1)}ms samples ${samples.join(" ")} glow ${glow.raw} ${glow.blend}`);
}
