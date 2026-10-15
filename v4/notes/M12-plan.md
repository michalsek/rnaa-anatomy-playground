# M12 plan: the inception loop video

*2026-10-14. Planning-agent output, filed by the orchestrator.*
- *Work in step order, with checkpoints and stop rules. No time estimates.*
- *Precondition: M11 is merged. Everything that depends on M11 (fit framing, tour, reveal length R) is read at runtime, never hard-coded.*
- *Paths are relative to `v4/`. User answers to §8 are in §9.*

## 0. Findings
1. **Top-down portrait needs no roll.** At yaw 90° / elevation 90°, `basisOf` gives right = +x, up = −y, toward = +z, so the island is at the top. The mirror convention matches on web and iOS. The light is camera-fixed, so the top face shades the same on both.
2. **Closed glass** = a rectangle 358.4 × 758.4 at z 41, centred at world [0,0], corner radius 43.2.
3. **Nothing in the machines runs on scene time; motion is sim-driven.** While the sim is held, the frame is static except the logo. The logo turns as `SPIN·clock.t` (0.32 rad/s), and its rings repeat every π/3.
4. **The camera ease uses `performance.now()`** (`renderer.ts` L418) and the shell runs on rAF. Deterministic capture therefore needs manual stepping plus an injected clock.
5. **Line width = `dpr·zoom/refZoom`.** At the same framing, iOS @3x lines are 4.8× thicker relative to the frame than web at 1920 px. Film mode makes line width proportional to the frame.
6. **Tools:**
   - argent can't record Chromium, and its iOS recordings are 30 fps, trim static stretches and are watermarked.
   - `xcrun simctl io recordVideo` gives the raw framebuffer at up to 60 fps (VFR), with no watermark or island.
   - The built-in pane stalls when hidden.
   - Hermes `debugger-evaluate` doesn't await promises, so iOS film hooks must be synchronous.
   - Available: ffmpeg 8.1.2 (libx264, ffv1), Chrome, and Node 25 (global `WebSocket` → a dependency-free CDP client).

## 1. Shots
All shots use film seconds = scene seconds, 60 fps, seed 0, light, bare, chrome off.

**Film frame (`filmFrame`):** a 16:9 band with 2.5% pads.

| | viewport | pads |
|---|---|---|
| Web | 1920×1080 CSS, dpr 2 | l/r 48, t/b 27 |
| Sim (portrait) | 402×874 pt | l/r 10.05, t 0, b 2Δ (Δ = 5 pt lifts the band centre to `R_sim`'s centre) |

**Line rule:** `pxPerCss = ρ·zoom/refFit`, where ρ = 16:9 band width in device px / 1920 (web 2, sim 0.628). `refFit` is the `fit` zoom at 45/30 in the film frame, pinned once per run.

| shot | film t | camera | reveal / sim | notes |
|---|---|---|---|---|
| **P1.1 open hold** | 0→2.0 | F: 45°, 30°, `fit` in filmFrame | revealed (skipped), **sim held at 0** | static; **loop seam B, side B** |
| P1.2 tour | 2.0→2.0+T | M11 tour minus its reveal step, eased on the film clock | sim runs | T measured (event-gated, deterministic) |
| P1.3 conceal | →+R | stays at F | `conceal()`, sim held | R = `revealCtl.plan.end` |
| P1.4 to screen | →+2.5 | smootherstep F→C1: yaw 45→90, elev 30→90, log zoom, target → [0,0,41] | closed | |
| **P1.5 hold** | →+0.5 | C1: 90°, 90°, zoom 1000/758.4 = 1.31857, target [0,0,41] | closed | glass G = (723.71, 40, 472.58, 1000) @1080p; **seam A, side A**; logo angle φ1 |
| P2.0 armed | (trimmed) | C0: 90°, 90°, zoom 402/358.4 = 1.12165 pt/u, target [0, 4.458, 41] | closed, sim held | logo frozen at φ1; glass = R_sim exactly |
| **P2.1 splash** | 0→1.0 | C0 | closed | `go()` starts the logo at φ1; **seam A, side B** |
| P2.2 pull-out | →2.4 | C0→C0′ (zoom ×0.6, top-down) | closed | "phone in a phone": paper and case appear inside the screen |
| P2.3 tilt | →4.4 | C0′→F_sim | closed | |
| P2.4 reveal | →4.4+R | F_sim | `reveal({holdAfter:true})`, sim held at 0 | |
| **P2.5 settle** | →4.9+R+Z | F_sim | open, sim 0 | static; the zoom (Z = 2.0) runs here; **seam B, side A** |

**Seam A (P1→P2).** These must be identical on both sides of the cut:
- the glass rect, the closed lid and the theme;
- the logo angle φ1, with the logo rate continuing;
- line width (the ρ rule);
- everything outside G (P2 uses P1's last frame as a still);
- no status bar or island inside R_sim.

Cut at P2's first moving frame (ffmpeg `freezedetect` freeze_end). Use a hard cut, or a 6-frame dissolve only if SSIM < 0.98.

**Seam B (loop).** These must be identical on both sides:
- camera F inside the 16:9 band (same relative pads, same `refFit` rule);
- reveal at its end;
- sim at t 0, seed 0, held;
- stands, halos and theme.

Check at checkpoint B that the logo is outside the band at F. If it isn't, freeze the logo at angle 0 during P1.1 and P2.5, eased there during the reveal.

**File order:** `P1[0.5 s..end] ++ C2 ++ zoom(C2 tail) ⨯xfade P1[0..0.5 s]`. The last and first frames are consecutive P1 frames, so the loop is seamless by construction and has no duplicate-frame stall.

## 2. App and engine support (DEV only, off by default; the normal app must not change)
1. **`packages/engine/src/camera/film.ts`** (pure, tested):
   - `screenCamera(vpCss, glass:{w,d,z}, o:{fill:'width'|'height'; size; dy?}): CameraState` (yaw 90, elevation 90);
   - `filmFrame(vpCss, o:{margin:0.025; dy?}): FrameSpec`;
   - `cameraLerp(a,b,u,out)` (log zoom, shortest yaw, linear elevation and target);
   - `smootherstep(u)`;
   - `simScreenRect(vpPx, dpr, glass, dy) → {x,y,w,h}`.
2. **Renderer** (all optional; `null` restores today's behaviour):
   - `setClock(fn|null)`: the ease reads it instead of `now()`;
   - `setLines({scale, ref}|null)`: pins `refZoom = ref` and multiplies `pxPerCss` by `scale = ρ/dpr`.

   The film camera bypasses M11's orbit clamp of 10–80° and uses `setCamera` directly.
3. **Shell** (`shell/createShell.ts`):
   - loop body → `tickDraw(dt)`;
   - `setManual(on)`: cancels or resumes rAF;
   - `step(dt): Promise<void>`: `tickDraw`, then `device.queue.onSubmittedWorkDone()`;
   - pass-throughs for `getCamera`, `setCamera`, `setLines`, `setClock`.

   `Stage.tsx` calls `filmCtl.attach(shell)` and detaches in cleanup.
4. **`apps/app/src/film/filmCtl.ts`** (plain module) and **`film/FilmDriver.tsx`** (frame hook in `FactoryScene`, next to `TourDriver`).
   - It advances the timeline on `info.dt`, writes the camera through `shell.setCamera`, and the film clock feeds `setClock`.
   - **`__v4.film`** (every call is sync):
     - `enable({platform:'web'|'sim'})`: bare, chrome off, filmFrame, `setLines`, `StatusBar hidden` on iOS;
     - `part1()`: `factoryLive.restart(0)`, `revealCtl.skip({hold:true})`, film clock at 0, manual stepping on web;
     - `step()` (web);
     - `arm({logo})`, `go()`;
     - `state()` → `{shot, t, frame, logo, camera, reveal, tour, simT, ledger, done}`;
     - `screenRect()`.
5. **Hooks in existing modules:**
   - `revealCtl.skip({hold})`, `reveal({holdAfter})`;
   - `tourCtl.play({from:1, reveal:false})`, with `export const FILM_TOUR = TOUR.slice(1)`;
   - `Phone.tsx`: `logo().spin('z', filmCtl.logo() ?? w.o.spin)`. In film mode the logo is `φ0 + SPIN·filmT`, ignoring the hold.
6. **Fake splash = the 3D lid at C0, not a separate 2D component.** The glass fills R_sim exactly and the logo turns, so it matches P1's glass by construction: same renderer, art, line rule and angle. The recording starts only after arming, so the app's boot never appears. The splash-to-phone transition style is decided in §9.
7. **Pixel geometry** (`film.ts` computes it, `state()` prints it):
   - Output glass G = (723.71, 40, 472.58, 1000) @1080p. Mask radius 43.2·1.31857 ≈ 57 px, inset 1 px so P1's glass outline stays.
   - Sim glass is 1206×2552 px. Slack is 70 px, so R_sim = (0, 20, 1206, 2552), clearing the home indicator. Δ = 15 px = 5 pt, so target y = 4.458 world units.
   - Scale sim → output ×0.391857.
   - The sim's 16:9 band (1206×678.4 centred at y 1296) maps to output (723.71, 405.8, 472.58, 265.8). Zoom S = 1920/472.58 = **4.0628** about (960, 540).

## 3. Recording
### Part 1: deterministic frame-stepped capture in a separate Chrome (recommended)
**Why:** argent has no Chromium recorder, a desktop screen recording is real-time and noisy, and the pane stalls when hidden. Frame stepping gives exact 60 fps, exact seam frames, repeatable runs and dpr 2 supersampling.

Launch Chrome:
```sh
open -na "Google Chrome" --args --user-data-dir=$SCRATCH/chrome-film --remote-debugging-port=9333 \
  --disable-background-timer-throttling --disable-renderer-backgrounding \
  --disable-backgrounding-occluded-windows http://localhost:8090
```

Capture with `tools/film/capture-web.mjs` (Node, no dependencies, CDP over the global `WebSocket`):
1. `Emulation.setDeviceMetricsOverride {1920,1080,dpr 2}`.
2. `Runtime.evaluate("__v4.film.enable({platform:'web'}); __v4.film.part1()")`.
3. Loop until `done`:
   - `Runtime.evaluate("__v4.film.step()", awaitPromise)`;
   - `Page.captureScreenshot png` → ffmpeg stdin;
   - append `state()` to `p1-state.jsonl`.

Encode on the fly:
```sh
ffmpeg -f image2pipe -framerate 60 -c:v png -i - -vf scale=1920:1080:flags=lanczos -c:v ffv1 p1.mkv
```
Keep 4K PNGs only of the last frame and the seam neighbours.

### Part 2: real-time `simctl` recording
**Setup:** iPhone 18 Pro, booted portrait. Don't rotate after launch. Check that `__v4sizes()` reports 402×874 and the texture is 1206×2622.

**Sequence:**
1. Arm with sync calls through argent `debugger-evaluate`: `__v4.film.enable({platform:'sim'}); __v4.film.arm({logo: φ1})`.
2. Start recording: `xcrun simctl io EBB4A340-5607-41A6-B36C-A9255815E16B recordVideo --codec=h264 --force $SCRATCH/p2.mov` (background).
3. Wait 1 s on a still frame, then call `__v4.film.go()`.
4. Once `state().done` is true, stop with `kill -INT`.

**Fallback if it hitches:** frame-stepped iOS, using Metro CDP `step()` + `simctl io screenshot` per frame.

## 3b. Compositing (ffmpeg; variables come from `state()` and §2.7)
```sh
# trim mark: first moving frame inside R_sim
ffmpeg -i p2.mov -vf "crop=1206:2552:0:20,freezedetect=n=0.0005:d=0.5" -f null - 2>&1 | grep freeze_end   # → TGO
# glass mask at 1080p (anti-aliased rounded rect, R=56)
ffmpeg -f lavfi -i color=white:s=472x1000 -vf "format=gray,geq=lum='255*clip(56.5-hypot(max(abs(X+0.5-W/2)-(W/2-56),0),max(abs(Y+0.5-H/2)-(H/2-56),0)),0,1)'" -frames:v 1 mask.png
# C2: P1's last frame + sim inside the glass
ffmpeg -loop 1 -framerate 60 -i p1_last.png -i p2.mov -loop 1 -framerate 60 -i mask.png -filter_complex "
 [0:v]scale=1920:1080:flags=lanczos[bg];
 [1:v]fps=60,trim=start=$TGO:duration=$C2D,setpts=PTS-STARTPTS,crop=1206:2552:0:20,scale=472:1000:flags=lanczos,format=rgba[s];
 [2:v]format=gray[m];[s][m]alphamerge[sm];
 [bg][sm]overlay=x=724:y=40:shortest=1,format=yuv444p[c]" -map "[c]" -c:v ffv1 c2.mkv
# zoom segment: same composite at 7680x4320 (glass ≥1206 px wide: G×4 = 1890×4000 at 2895,160) → z8k.mkv, then:
ffmpeg -i z8k.mkv -i p1.mkv -filter_complex "
 [0:v]scale=w='2*trunc(1920*pow(4.0628,(st(0,t/2)*0+ld(0)^3*(ld(0)*(ld(0)*6-15)+10)))/2)':h=-2:eval=frame:flags=lanczos,
      crop=1920:1080:(iw-1920)/2:(ih-1080)/2,setsar=1[z];
 [1:v]trim=0:0.5,setpts=PTS-STARTPTS[h];
 [z][h]xfade=transition=fade:duration=0.5:offset=1.5[zx]" -map "[zx]" -c:v ffv1 zoomx.mkv
# final loop, social H.264
ffmpeg -i p1.mkv -i c2.mkv -i zoomx.mkv -filter_complex "
 [0:v]trim=start=0.5,setpts=PTS-STARTPTS[a];[1:v]trim=duration=$C2HEAD,setpts=PTS-STARTPTS[b];
 [a][b][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]" -map "[v]" -c:v libx264 -profile:v high -level 4.2 \
 -preset slow -crf 16 -maxrate 20M -bufsize 40M -r 60 -g 120 -movflags +faststart -an loop-light-60.mp4
```
- **Zoom:** exponential (`S^E(u)` with smootherstep), centred, with even widths. This avoids `zoompan`'s integer jitter.
- **Optional 30 fps export:** `-vf fps=30 -g 60`.

## 4. Verification by eye
1. **Seam frames.** For seam A: `select='between(n,N-1,N+1)',scale=640:-1,tile=3x1`. Do the same at the file boundary in the 3× loop. Also crop each strip to G at 100%.
2. **Seam A numbers.** `ffmpeg -i p1_last.png -i c2_f0.png -lavfi ssim -f null -` should give ≥ 0.98, plus a `blend=all_mode=difference` image.
3. **Full loop.** `ffmpeg -stream_loop 2 -i loop-light-60.mp4 -c copy loop3x.mp4`, then watch both seams and the zoom.
4. **Contact sheet** of every shot boundary, using the frame indices from `p1-state.jsonl`.

## 5. Tests (`packages/engine/tests/film.test.ts`)
1. `screenCamera`: the glass corners project onto G at 1920×1080 dpr 2 and onto R_sim at 402×874 dpr 3, within 0.01 px. The island side is at the top.
2. `filmFrame`: the same rect relative to the band on web and sim; the band centre equals R_sim's centre; S·W_G = 1920.
3. `cameraLerp`: exact endpoints, shortest yaw across ±180°, monotone log zoom.
4. Determinism (app): two captures of the first 240 Part 1 frames give identical PNG md5s and an identical `p1-state.jsonl`.

## 6. Steps and checkpoints
0. **Baseline:** M11 is merged; `pnpm test` and `pnpm types` pass; a normal-app smoke test (reveal, tour, views, orbit) passes on web and iOS.
1. **`film.ts` + tests 5.1–5.3.** **Checkpoint A:** green.
2. **Renderer `setClock`/`setLines`, shell `step`, the `filmCtl`/`FilmDriver` skeleton, and `enable` with C1/C0 stills.** **Checkpoint B:**
   - the web still at C1 and the iOS still at C0 (`simctl io screenshot`) have glass edges at G and R_sim within 1 px;
   - no status bar, island or home indicator inside R_sim;
   - clean top-down lines and shading with no flicker on the band's vertical walls (fallback: elevation 89.5°);
   - the logo is outside the band at F.
3. **Part 1 script:** shots, `FILM_TOUR`, conceal, path, hold. **Checkpoint C:** test 5.4 is deterministic, and a 240-frame CDP capture has distinct, correct frames.
4. **Full Part 1 capture.** **Checkpoint D:** a shot contact sheet, plus the recorded last frame and φ1.
5. **Part 2:** arm, go, shots, `simctl` recording. **Checkpoint E:** 60 fps with no gap > 25 ms; `freezedetect` finds TGO.
6. **Composite** C2, the zoom and the final file. **Checkpoint F:** the §4 checks pass at both seams.
7. **Wrap-up:** `notes/M12.md` (verdict, numbers, seams, commands). Commit source, `tools/film/` and the notes only, never media.

## 7. Risks, stop rules, cut list
**Risks:**
- **`captureScreenshot` returns a stale WebGPU canvas.** Fallback: in film mode, give the canvas `COPY_SRC` and read it back in-page.
- **Items mid-air during the conceal.** Fallback: gate the tour's last `fit` step on "nothing falling", with a max wait.
- **M11 moves `fit`, φ, F or R.** Everything is read at runtime, so re-capture after M11 fixes.
- **Sub-pixel lines in the sim at F** (≈ 0.63 px). The zoom's xfade covers them.
- **Disk:** the 8K intermediates live in `$SCRATCH`; delete them after each checkpoint.

**Stop rules.** Stop and report with frame strips if any of these happens:
- WebGPU validation error or device loss;
- a red test;
- two failures with the same cause;
- film code changes the normal app;
- Part 1 is non-deterministic;
- seam A SSIM < 0.97 after two fixes;
- iOS stays below 58 fps after one retry and the fallback.

**Cut list** (cut first at the top):
1. dark theme
2. 30 fps export
3. dpr 2 supersampling
4. the 8K zoom (accept a softer end under the xfade)
5. the anti-aliased mask

**Never cut:** exact glass geometry, static seams, the consecutive-frame loop, the light 60 fps master.

## 8. Open questions (answers in §9)
1. **Length:** the full M11 tour, or a shorter film tour?
2. **Splash → phone:** the pull-out (planner's default), or a literal opacity fade?
3. **Audio:** a silent master, or music added later by the user?
4. **Frame:** is the rendered phone's case the only frame around the sim recording (no iPhone bezel)?
5. **Deliverables:** 16:9 at 60 fps only, or also 30 fps and 9:16 / 1:1?
6. **Theme:** light only, or light and dark?

## 9. User answers
*(user, 2026-10-14)*
1. **Length:** the full M11 tour.
2. **Splash:** the pull-out, so no literal fade. The camera pulls back from the screen until it becomes a phone inside the phone.
3. **Audio:** silent master.
4. **Frame:** only the rendered phone's case; no iPhone bezel.
5. **Deliverables:** one master only, 16:9, light, 60 fps. The dark theme, the 30 fps export and other crops are cut.
6. **Theme:** light only.

## Out of scope
- argent limits: no Chromium recorder, iOS watermark, 30 fps, Hermes doesn't await.
- Social platforms re-encode uploads, which may break gapless looping.
- The pane stalls when hidden.
- `MAX_DT` 0.1 vs the clock's 1/30.
- iOS stale framing on rotation (avoided by not rotating).
- react-native-wgpu's intermittent `RNWebGPU global` error after a reload.
