# M1 findings — existing v2/kit code (out of scope)

1. The committed v2 `parts/centrifuge/centrifuge{,-light}.html` are stale relative to `shared/runtime.js` (no `frameOffset`). The SVG matches a fresh build, but rebuild before using the pages as baselines.
2. `kit.mjs:139–149` slot targets resolve via `findIndex`, so a target present as both `name` and `name#n` anchors to the first in painter order, contradicting the "latest" comment. Harmless today (centrifuge slot targets are unique).
3. `solidSvg` always emits `<path class="iso-top" d="…">`, even when empty: `centrifuge.lamp-lens` and `centrifuge.grease-nipple-ball` ship `d=""` fills.
4. 2,967 of 31,191 fill ring points (9.5 %) are repeated/closing duplicates left after `pathOf` rounding. Dropping them post-rounding shrinks the SVG for free.
5. 93 fill paths have touching or crossing ring edges; the kit relies on nonzero fill rule → GPU needs the general tessellator for these (libtess path in export/tess.mjs).
6. Packets fade with `<g class="pk" opacity>` (group opacity). Per-element alpha shows inner edges through during the fade → M3 must composite the group or accept the artefact.
7. pixelmatch at its default threshold (0.1) misses tone swaps (4.8 % changed pixels reported as 2 px). Visual checks need a stricter metric (any channel Δ > 8 used by tools/gate.mjs).
8. The floor halo goes through `ctx.back`, outside the recorder → no key/rank, invisible to the audit. The DL special-cases it as the `@back` item at rank −1.
