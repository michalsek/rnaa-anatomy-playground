# QA-FINAL: the WebGPU prototype deliverables, from a user's seat

HEAD under test: `589c0af` for the fresh copy (sources and deliverables). `463e6c9` (REPORT.md only) landed while this
QA ran and changes no source. Machine: Apple M4 Pro, Chrome 155.0.8059.40, Node 25.9.0, npm 11.14.1. Scratch:
`out/tmp/qa-final/` (scripts `qa-user.mjs`, `qa-visual.mjs`, `qa-motion.mjs`, `qa-index.mjs`; shots in `user/`,
`visual/`, `motion/`, `img/`). Read-only throughout: no source, deliverable, `../v2-factory` or skill file was touched.
`node tools/chrome-reap.mjs` at the end: 0 orphaned browsers, 0 leaked profiles.

## Verdict: ship with notes

Both pages boot, animate and fall back as specified, in headless, headed and stock-flag Chrome. They match v2 in theme,
reduced motion, focus and ARIA. A fresh clone rebuilds them byte for byte and the quick gates pass. I found no popping,
no missing part and no z-fighting in 80 consecutive frames I chose myself (spin-down and in-sync stretches the gates do
not use), and no solid blob at any tick. The differences a human could find are hairline weights. You need an A/B
toggle or a zoom to see them (see §3). The notes below are documentation and reproducibility fixes. None of them is a
defect in the deliverables.

## Issues

| # | Severity | Issue | Repro |
|---|---|---|---|
| 1 | Medium (repro) | The repo is not self-contained. `git archive HEAD v3-gpu` + `npm ci` + `npm test` fails: `tools/test-native.mjs` and `scenes/centrifuge.scene.mjs` import `../../v2-factory/...` (ERR_MODULE_NOT_FOUND). After adding `v2-factory` from the same commit, everything works, but only because `v2-factory/shared/kit.mjs` hard-codes `ANATOMY = "/Users/michalsek/.claude/skills/anatomy"`. `tools/chrome.mjs` (`launchChrome` → `chrome-port.mjs`), `tools/gate.mjs` (`capture.mjs`), `tools/report-shots.mjs` (`drive.mjs`) and `src/fixture/make-*.mjs` (`iso-kit.mjs`) also need the skill under `~/.claude/skills/anatomy` (`ANATOMY_SCRIPTS` overrides only the scripts). REPORT.md §8 documents both dependencies in one line, but nothing documents the absolute path in v2's kit.mjs, which ties the build to this user account. GATES.md and FINDINGS-M4 never mention either dependency. | `git -C .. archive HEAD v3-gpu \| tar -x -C out/tmp/qa-final/ && cd out/tmp/qa-final/v3-gpu && npm ci && npm test` |
| 2 | Low (visual, known) | Hairline weights differ from Chrome's SVG on a few edges, the same class of difference as QA-M2 D9. Worst case at DPR 2: the left outline of the central column puts about 45 % more ink on one device column over about 340 CSS px. It is the red line in `report/light-card-heat.png`, column x = 750, 197 px with Δ 33–63. At DPR 1: the drive belt's runs and the lower outline of the top conveyor's end roller are a little lighter or heavier. Mean luminance of the whole card is equal to 0.01 levels. You can see these in an A/B toggle on a retina display; side by side at 1× I could not tell the pages apart. | `out/tmp/qa-final/img/light-col750.png`, `visual/zoom-belt-light.png`, `visual/zoom-roller-light.png`, `visual/heat-d1-light.png` |
| 3 | Low (hygiene) | `npm run gates` rewrites tracked files `out/gate/*.png`. In the main working tree two of them now differ from HEAD (`centrifuge-dl-dark.png` 18,525 px, `centrifuge-diff-dark.png` 20 px), while the fresh copy reproduced HEAD exactly. So the dl gate's debug render is not stable between runs (perhaps load-dependent), and every gate run can leave the tree dirty. | `git -C .. status --short` |
| 4 | Cosmetic | The `tools/build.mjs` log prints string lengths, not bytes: "centrifuge-gpu-light.html 1573543 B" for a 1,573,558-byte file, and gpu.js 483,875 vs 483,881 B (multi-byte characters). | `npm run package`, then `ls -l centrifuge-gpu-light.html` |
| 5 | Cosmetic | index.html: the four "Comparison shots" figures sit in a 3-column grid at 1280 px, so the dark heatmap is left alone on a second row. Links to `.md` files (REPORT.md, notes) open as raw text over file://. | `out/tmp/qa-final/img/index-dark-1280.png` |

## 1. Fresh-clone reproducibility

- `npm ci` on the lockfile: 12 packages, 0 vulnerabilities, 0.7 s.
- `npm test` without `../v2-factory`: 56 pass, then `test-native.mjs` crashes (issue 1). With `v2-factory` extracted
  from the same commit: 72 tests, 71 pass, 1 todo (the known miter-join gap).
- `npm run package`: 6.3 s. `centrifuge-gpu.html` (c1b44c52…) and `centrifuge-gpu-light.html` (3c49014a…) are
  **byte-identical** to the committed files. `out/dl/*`, `out/svg/centrifuge(-light).html` and every other tracked file
  are unchanged too.
- `npm run gates` (quick) in the fresh copy: **all 13 rows PASS in 205 s**. After the run, no tracked file differs from
  HEAD in the copy.
- Dependencies outside `v3-gpu/`: `../v2-factory` (same repo, so a full clone has it), `~/.claude/skills/anatomy`
  (`kit/`, `scripts/chrome-port.mjs`, `capture.mjs`, `drive.mjs`), a Chrome binary (`CHROME_PATH` or the standard
  locations), Node with global `WebSocket` / `fetch`. Only the deliverable pages are self-contained.

## 2. The deliverables as a user

I tested both pages over file:// in headless Chrome (`launchChrome`), headed Chrome (a real window, DPR 1 display) and a
"plain" headless Chrome with only user-default flags (no `--allow-file-access-from-files`, no swiftshader or blocklist
flags).

| check | light | dark |
|---|---|---|
| boots, `html[data-renderer=webgpu]`, `data-gpu=ready`, adapter apple metal-3 | yes (all three modes) | yes |
| animates: readout changes, `__gpu.frames` +90 in 1.5 s (60 Hz), +216 headed (high-refresh display) | yes | yes |
| console | exactly one `info: figure renderer: WebGPU · TypeGPU (apple metal-3)`, nothing else, after the resizes too | same |
| resize 1280@2 → 700@2 → 390@3 → 1600@1 | canvas backing store follows (1240×1472 / 1002×1191 / 652×774), no horizontal scroll, no error | same |
| OS colour scheme emulated dark / light, at load and flipped live | stays light (body `rgb(242,242,239)`, plate `rgb(251,251,250)`, `color-scheme: light`): the same as v2-light | stays dark (`rgb(11,11,11)` / `rgb(19,19,19)`): the same as v2-dark |
| reduced motion | 0.0 rpm, fill continues ("held 3/10" → "5/10"), 2 GPU frames in 2 s: the same behaviour as v2 under reduce | same |
| focus / ARIA | one focusable `div.iso-stage[tabindex=0][role=group][aria-label=Centrifuge]`, Tab gives `:focus-visible` with a 1 px solid outline; `canvas[role=img][aria-label=Centrifuge]`; the hidden SVG is `aria-hidden` and `display:none`; `aria-live=polite` status span; title and lang are the same as v2 | same |
| no WebGPU (`tools/no-webgpu.preload.js`) | `data-renderer=svg`, `data-gpu=fallback`, `__gpu.error = "no-webgpu"`, the SVG animates, one `info: … SVG fallback (no-webgpu)` line, ARIA identical to v2 | same |

## 3. Visual (a picky designer's pass)

I looked at every report crop (`*-side.png`), both full-card heatmaps, both strips and the hero shots. Then I made my
own lockstep captures, committed v2 page vs deliverable, at ticks the report does not use (333 filling, 1287 in sync,
2111 spinning up; DPR 1 and DPR 4). Runtime state was equal at every shot and both consoles were clean.

| theme | DPR | ticks | stage loose % | incl. AA % | solid blob |
|---|---|---|---|---|---|
| light | 1 | 333 / 1287 / 2111 | 0.1215 / 0.1211 / 0.1223 | 0.24 / 0.22 / 0.24 | 0 |
| dark | 1 | 333 / 1287 / 2111 | 0.0862 / 0.0862 / 0.0886 | 0.14 / 0.14 / 0.14 | 0 |
| light | 4 | 1287 | 0.0091 | 0.050 | 0 |
| dark | 4 | 1287 | 0.0013 | 0.023 | 0 |

Consecutive frames at DPR 1: light 1560–1599 (spin-down) and dark 2380–2419 (in sync). Every frame had solid blob 0,
loose ≤ 0.126 %, and readouts equal frame by frame. No pop, flicker or depth swap.

What a human could notice at 1×:
- **None of these side by side at normal viewing.** Four-tone shading, gradients, halo, lamp glow (green identical:
  mean G−R 7.7 vs 7.7), dot rows and the edges that end on strokes all match. At 4× and above the crops are hard to
  tell apart.
- **In an A/B flicker:** a few hairlines change weight (issue 2): the central column's left outline (DPR 2, heavier on
  the GPU), the belt runs and the top roller's lower outline (DPR 1). This is AA-level and has no colour or geometry
  change. DPR 1 is where the GPU sits furthest from v2: loose 0.12 % light against the gate limit of 0.15 %, which is
  about ten times the DPR 2 figure. Neither the report nor the gates show a DPR 1 full card. Note that the README's
  "full card — 1×" means unmagnified at DPR 2.

## 4. index.html

- Every relative link and image resolves in the working tree and in HEAD (55 targets, including `REPORT.md` now that it
  is committed, and the `../v2-factory` originals, which need the full repo).
- 0 external requests. All 13 requests are local files. Console clean. No broken images.
- Light and dark follow `prefers-color-scheme` (`#f2f2ef` / `#0b0b0b`). No horizontal scroll at 1280 or 390.
- Nits: issue 5.

## 5. Docs spot-check (numbers against the raw files they cite)

| claim | source | raw | verdict |
|---|---|---|---|
| svg desktop main 3.11, gpu 2.16 ms | rows.md / FINDINGS-M4 | medians of `taskMs` r1–r3: 3.11 / 2.16 | correct |
| phone 10.97 vs 6.82 ms | rows.md | 10.97 / 6.82 | correct |
| stress10 desktop svg 44.9 fps / 25.2 % / 22.31 | rows.md | 44.9 / 25.2 / 22.31 | correct |
| stress10 phone 11.7 / 86.0 vs 15.0 / 66.9 | FINDINGS-M4 | 11.7 / 85.98, 15.0 / 66.85 | correct |
| GPU pass 1.57 ms desktop | FINDINGS-M4 | `gpuPage.medianSumMs.gpuPass` 1.573 (all three runs) | correct |
| heap 18.1 vs 3.5 MB | rows.md | 18.1 / 3.5 | correct |
| load desktop 48/14 vs 68/52/134; phone 120/108 vs 124/202/538; M5 127 / 504 | rows.md / FINDINGS | load.json medians are the same | correct |
| deliverable 1,537 / 498 KB, v2 763 / 160 KB, M5 3,844 / 773 KB | FINDINGS-M4 | 1,573,558 / 509,598; 781,616 / 164,110; 3,936,733 B: KiB | correct |
| DL "2,637 KB → 251 KB inline" | FINDINGS-M4 | 2,636,800 B (M5 base64) → 251,444 B: **decimal kB**, while the line above uses KiB | correct, but mixed units |
| breakdown "v2 page 763, bundle 482, display list 307 KB" | FINDINGS-M4 | bundle 483,881 B = 472.5 KiB / 483.9 kB; DL 55,652 + 251,444 = 307,096 B = 299.9 KiB / 307.1 kB. Parts sum to 1,552 against the 1,537 total | **inaccurate** (bundle figure fits neither unit; mixed units) |
| "The Δ 99 on both full cards is a single hairline pixel column" | FINDINGS-M4 | Δ 99 is one **pixel** (980, 1420) in both cards. The visible red line in the light heatmap is a different column (x = 750, 197 px, Δ 33–63) | **inaccurate** |
| comparison table (16 cells) and strip worst | FINDINGS-M4 / README | shots.json is the same throughout | correct |
| `package` row 54 checks; gates:full 793 s; 72 unit tests | FINDINGS-M4 | out/tmp/gates/summary.json (full): 54 checks, row times sum ≈ 793 s; 72 | correct |
| `npm run gates` "≈ 1.5 min" | GATES.md | 205 s measured (REPORT.md says ≈ 3 min) | **stale** |
| rows.md: "gpu = the frozen deliverable" | rows.md | frame-row JSONs hash `e89a15d76abd`, the current deliverable is `93036f78…`. FINDINGS discloses this (frames measured just before the device-request change), rows.md does not. "GPU pass Σ" prints 0.00 instead of "–" on rows without timestamps | minor |
