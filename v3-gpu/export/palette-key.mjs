// Palette identity: which attributes of a probe chain can change the CSS cascade result, and the key two equal probe
// recipes share. One source for the exporter's palette (build-dl.mjs) and the renderer's live slots, so a paint met
// in a live slot resolves to the same entry as the equal static one.
import { OPACITY_ATTRS } from "./svgsub.mjs";

// attributes that never change the cascade result (geometry, identity, alpha carried by the records, the inline
// stroke-width the records carry as a width override)
export const PROBE_KEY_IGNORED_ATTRS = new Set(["data-name", "data-route", "data-slot", "id", "d", "cx", "cy", "r", "x1", "y1", "x2", "y2", "offset", "gradientUnits", ...OPACITY_ATTRS, "style", "role", "aria-hidden", "aria-label"]);

// probeNode({ tag, attrs }) → { tag, attrs } with only the cascade-relevant attributes, in markup order (paint-server
// references are dropped: gradients are resolved through their stops)
export function probeNode({ tag, attrs }) {
  const kept = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (PROBE_KEY_IGNORED_ATTRS.has(name)) continue;
    if ((name === "fill" || name === "stroke") && value.startsWith("url(")) continue;
    kept[name] = value;
  }
  return { tag, attrs: kept };
}

// paintKeyOf(prop, ancestors, el) → the palette key of a probe recipe whose nodes are already probeNode()s
export const paintKeyOf = (prop, ancestors, el) => JSON.stringify([prop, ancestors, el]);
