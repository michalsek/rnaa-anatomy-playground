# M4 plan: the animated centrifuge

*2026-10-14. Planning-agent output, filed by the orchestrator, with the user's behaviour correction added as §A. Work in step order with checkpoints and stop rules; there is no time budget. Reduced motion is out of scope: port none of v2's `calm` branches (`centrifuge.mjs` L979–982, L1009–1011, L1025–1046; `build.mjs` L104–108).*

Abbreviations used throughout:

| short | file |
|---|---|
| v2 C | `v2-factory/parts/centrifuge/centrifuge.mjs` |
| v2 B | `build.mjs` |
| v2 R | `shared/runtime.js` |

## §A. User correction: spin-up behaviour (overrides v2 and anything below)

v2's spin-up was buggy. Only ONE packet visibly spun up, in the direction opposite to the tray's rotation, while the other packets and the tray itself were ignored.

**Likely cause** (verify): the release pose `a = a0 + (GATE − a0)·ease(age/TA)` (C L803–806) doesn't wrap the angle. When `GATE − a0` is close to ±360°, the released packet sweeps a full turn backwards.

The intended v4 cycle has five phases:

1. **Fill (`index`).** Packets drop from the throat into free pockets, as in v2.
2. **Close intake.** Spin-up starts (HOLD reached, or 4 s quiet with packets held, as in v2). From that moment no packet may enter a pocket until the tray is empty again.
   - Disable v2's timed drops during spin (C L1133).
   - The throat holds up to QMAX.
   - The feeder backs up (backpressure), and the stub feeder stops at its bed limit.
3. **Spin up.** The ENTIRE tray rotates: the `rotor` group, with ALL held packets riding in their pockets (pose §1.4 row 5 uses the live `A`). Everything turns the same way as the tray's normal rotation.
4. **Release / drain.** At each gate crossing (phase-locked to the belt, as in v2), the packet in that pocket leaves through the gate, down the spout, onto the audio belt.
   - The release pose angle must move forward, in the tray's direction. Wrap `GATE − a0` into the small forward delta, and never sweep backwards.
   - The tray keeps spinning until every pocket is empty.
5. **Spin down and reopen.** Use v2's spin-down (empty for 0.6 s → down → index at w < .5, resting on a pocket). Only then are drops allowed again, and the throat and feeder resume.

**Effect on the rest of this plan:**
- §1.2: in `mode='spin'` and `mode='down'`, `put` into a pocket is forbidden. The "timed drops" row is replaced, not ported.
- Tests (§6) gain:
  - (5) no pocket `put` while `mode !== 'index'`;
  - (6) after spin-up starts, held decreases monotonically to 0 before the next `put`;
  - (7) during spin, every held packet's pose angle equals `A + (k+½)·ALPHA`; during release, the angle moves monotonically forward.
- By eye (§8): v2 references are for look and per-phase state only, not this behaviour. Check by eye in a recording that the whole tray and every packet turn together, and that no packet ever moves backwards.

## 0. Before starting: the references are stale

- `qa/t-*.png` and `cycle-sheet.png` predate REVIEW: old geometry, readouts taken from the lagging needle. Use them only for state per phase (held count, phase word, where the packets are).
- For geometry and motion, take fresh final-v2 frames (step 2).
- When v2 code and the sheets disagree, the code wins. Never tune constants to match the sheets.

## 1. Sim port: `packages/engine/src/sim/centrifuge.ts`

Plain TS: no React, no `Math.random`, no wall clock. Exported from `src/index.ts`.

**Stepping**
- Fixed step `H = 1/120`.
- `advance(dt, speed)`:
  - clamps the frame dt to 1/30 (v2 R L106, motion.md);
  - multiplies by `speed`;
  - runs at most 8 steps;
  - **drops the remainder**, so there is no catch-up burst.
- `run(seconds)` is uncapped; it is for seek and tests.

**Determinism**
- The sim is a pure function of (seed, dt sequence).
- v2 has no randomness, so `seed` is only a start offset into `KINDS`. Seed 0 = v2.

**Order within a step** (v2 R L111–117, B L142–147):
1. feed timer;
2. `centrifuge.tick`, which reads the belt phase before the belt advances;
3. feeder tick, which may `accept`;
4. belt tick.

Emits are synchronous calls.

### 1.1 Typed state (mirrors v2's arrays so the port stays line by line)

```ts
export type Kind = 0 | 1 | 2;                      // control, graph, data = packet pool style index
export type PhaseWord = 'idle' | 'filling' | 'spinning up' | 'in sync' | 'spinning down';
type V3 = [number, number, number]; interface Spring { x: number; v: number }
interface Item { id: number; kind: Kind }
interface FeedItem extends Item { y: number }                                     // B L64–72
interface Queued extends Item { z: number; vz: number; arc: { from: V3; t0: number; dur: number } | null; ready: number; want: number } // want −1 = none
interface Falling extends Item { k: number; t0: number; z0: number; fall: number } // C L934–939
interface Releasing extends Item { t0: number; a0: number }                       // C L942–945
interface OnBelt extends Item { p: V3; v: V3; yaw: number; stage: 'fall' | 'ride' | 'tip' } // B L87–124
export interface SimState {
  t: number; acc: number; seed: number; nextId: number; feedNext: number; feedN: number; fed: number; gone: number;
  mode: 'index' | 'spin' | 'down'; A: number; w: number; target: number; ang: Spring; spd: Spring;
  inSync: boolean; syncFor: number; prevRel: number | null; S: number; prevP: number | null; emptyFor: number;
  lastLanding: number; lastDrop: number; releaseAt: number; motorA: number; lamp: Spring; needle: Spring;
  phase: PhaseWord; log: { t: number; phase: PhaseWord }[];
  pockets: (Item | null)[]; reserved: boolean[]; order: number[];
  feed: FeedItem[]; queue: Queued[]; falling: Falling[]; releasing: Releasing[]; belt: OnBelt[]; beltClock: number;
}
export interface Status { t: number; held: number; rpm: number; phase: PhaseWord; queued: number; inSync: boolean }
export interface Outputs { rotor: number; motor: number; open: number; share: number; lamp: number }
export interface CentrifugeSim {
  readonly state: Readonly<SimState>;
  reset(seed?: number): void; advance(dt: number, speed?: number): number; run(seconds: number): void;
  status(): Status;                                      // rpm = max(0,w)·60/τ (true speed, C L974)
  outputs(out: Outputs): Outputs;                        // rotor/motor extrapolated by w·acc (smooth at 120/144 Hz)
  packets(cb: (i: number, kind: Kind, x: number, y: number, z: number, yaw: number) => void): number;
  slats(cb: (j: number, x: number) => void): number;
  canRelease: ((lead: number) => boolean) | null;        // v2 releaseWhen (C L967, L1127); null in the app
}
export function createCentrifugeSim(o?: { seed?: number; feedEvery?: number }): CentrifugeSim;
export const CF: { /* the kinematic constants below, plus spout {start, dir, lip, hand, tFall} */ };
```

### 1.2 Concept map (v2 → v4)

| concept | v2 | v4 |
|---|---|---|
| feed | R L139 (delay .5), B L150 (every .9), B L131 `KINDS` (8 kinds then 5 nulls) | `feedNext`, `feedN`; null = nothing. Bursts of 8 every 11.7 s. |
| stub feeder | B L65–73 (slides at 30, 11 apart; the front waits at y1 until `canAccept` = queue < QMAX) | `feed[]`, emitting at (0, −42, 192). **Deviation:** stop taking items when 6 are on the bed (bed full), so the pool stays bounded. v2 accepts without limit. |
| accept and arc | C L976–984, L1001–1007 | `queue[]`; arc .32 s from the feeder, .22 s otherwise. |
| throat | C L1008–1022 (gravity fall to `restZ(i)` = 181 + 7i); `resting` L941 | same |
| index (filling) | C L1079–1112: nearest free pocket; drop when predicted landing error < .02; creep .12 rad/s when idle; spin at HOLD, or after 4 s quiet with packets held | `mode='index'`. The only mode that may `put` (§A). |
| drop and landing | C L907–911, L934–940, L1049–1064 (retarget to `atSpout()`) | `falling[]` → `put` |
| spin with phase lock | C L987–998 (belt phase unwrapped into S), L1074–1078 (error e), L1113–1145 (lock, in sync, releases at crossings) | `mode='spin'`, rate = 1/.42 (the belt gives the period). **Timed drops (C L1133) are NOT ported** (§A). |
| release | C L802–819 (`releasePose`: TA leave, TS spout, TF fall), L1066–1072 (hand on at z ≤ 100 with v) | `releasing[]` → `belt.push({stage:'fall'})`. Forward-wrapped angle (§A). |
| backpressure | throat `canAccept` C L970; feeder B L73; ring `releaseWhen` C L1127 | `queue.length < QMAX`; `canRelease`. Intake is closed in spin/down (§A). |
| spin-down | C L1146–1165 (empty .6 s → down τ .7 → index at w < .5, resting on a pocket) | `mode='down'` |
| stub belt | B L80–124: `quanta()` L86, slats L96–101, fall → ride → tip off | `beltClock`, `belt[]`. **Deviation:** slats wrap mod 96 (8 × pitch); slats beyond 86 are hidden. v2's mod 86 drifts out of phase with `quanta()`. |
| outputs | C L1168–1173, L1181, L885 | `outputs()` |

### 1.3 Constants to copy verbatim

**Geometry** (C L7, L51–58, L663, L668, L329):
- POCKETS 10, ALPHA 2π/10.
- Z.pocket 125, PK 7, Z.mouth 186, head 181.
- R.pocket 23, R.rimOut 31.4.
- SPOUT_DEG −90, GATE_DEG 95, slope 15°, SPOUT_LEN 15, SPOUT_V [42, 18].
- GRAVITY 400, gateLift 8.3, HAND_Z 100.
- Spout start, dir, lip, tFall and hand as in C L308–331. Test that hand ≈ (−4.47, 51.14, 100), which matches M3.md.

**Controller** (C L695–706):
- HOLD 6, QMAX 2, IDX_TAU .22, TA .28.
- DECEL = (42² − 18²)/30 = 48, TS = .5, LEAD = TA + TS + TF ≈ 1.09.
- `ease`, `burst`, `settle` (4 substeps): copy C L713–727 without `calm`.

**Lock** (C L1114–1121):
- `lock = ease((.18 − rel)/.12)`, target `syncW + 1.4·ALPHA·e·lock`, τ .4.
- In sync after .35 s with rel < .04 and |e| < .05; lost when |e| > .15 or rel > .12.
- Index landing: |lead| > .5 retargets (C L1056); `ready` = now + .1 (C L1005).

**Outputs:**
- open: `ease(age/.08)` → 1 until TA + .12 → `1 − ease((age − TA − .12)/.25)` (C L1171).
- lamp: settle to .45 in sync, τ .25, plus `.5·burst(age, .05, .2)`, capped at 1.2 (C L1172, L1181).
- needle share: settle to `w/(ALPHA·rate)`, τ .25 (C L1173).
- crank φ = 25 − 60·open (C L885).
- motor angle: `motorA += w·5.5/4·dt` (C L1169).

**Stubs** (B L21, L34, L39, L54; local = v2 − [100, 66, 0]):
- feeder: x 0, y −100 → −42, top 191.4, speed 30, gap 11.
- belt: x0 −78, x1 10, y 51.14, top 92, pitch 12, period .42, speed 12/.42.
- belt items: y relaxes at 8/s; removed below z 76.

### 1.4 Packet path

Each pose is (bottom-centre p, yaw, pitch, roll) in the `centrifuge` frame. The world origin is shared with the stubs. Pitch and roll are always 0.

| # | segment | position | yaw |
|---|---|---|---|
| 1 | feeder bed | (0, y, 191.4) | **0** (v2 `packetSvg` long axis on x; M3 used 90°, fix it) |
| 2 | arc in, u = age/dur | lerp((0,−42,192) → (0,−23,187), u) + (0,0,6 sin πu) (C L919–921) | ease(u)·(−90°) (deviation: v2 snaps at the end) |
| 3 | throat | (0, −23, z) | −90° |
| 4 | drop | (0, −23, max(125, z0 − ½g·age²)) | −90° |
| 5 | pocket ride | polar(A + (k+½)·ALPHA, 23, 125), with the **live A**, so every held packet turns with the tray (§A) | pocket angle |
| 6 | out through gate (age < TA) | r 23 until .08 s, then lerp to 31.4; a = a0 + **fwdWrap(GATE − a0)**·ease(age/TA); z 125 | a |
| 7 | down the spout | S0 + SD·(42t − 24t²) (C L808–812) | 95° |
| 8 | fall from the lip | lip + (cos G·h·t, sin G·h·t, vz·t − 200t²) (C L814–818) | 95° |
| 9 | hand-off, then belt fall | p += v·dt, v.z −= 400·dt until z ≤ 92 (B L109–112) | 95° |
| 10 | ride belt | x −= speed·dt; y relaxes at 8/s (B L113–115) | eases at 8/s to the nearest multiple of 90° (v2 snaps to 0) |
| 11 | tip off (x ≤ −79) | vx −speed, gravity, removed below z 76 (B L116–121) | held |

- **No clipping:** the void disc at 186.02 and the funnel walls hide what v2 cut at the mouth plane.
- **Level on the spout:** packets stay level, as in v2. The low end sinks about 1.3 into the floor, which hides it.

## 2. Wiring: `apps/app/src/machines/centrifuge/`

**`live.ts`** (new; a plain module, per the Fast Refresh rule):
- `sim = createCentrifugeSim()`;
- `ctl = { paused: false, speed: 1 }`;
- `readout = createReadout(100)`;
- the `dev` hook object (§4).

It is a module singleton that is not reset on mount, so switching view, scene or theme resumes the sim. A Fast Refresh of `live.ts` or the sim restarts at t = 0, which is acceptable.

**`Centrifuge.tsx`** has exactly **one `useFrame`**.
- Delete the M3 `useFrame`s in `Packets` and `AudioBelt` (`Stubs.tsx`) and the `HELD`/`WAITING` constants.
- Packet pool `CAPACITY = 40`; slats stay at 8.
- Handles via `useNode` (full ids):
  - `centrifuge.rotor`
  - `centrifuge.drive.motorPulley`
  - `centrifuge.bowl.gate`
  - `centrifuge.instruments.crank-mount.crank`
  - `centrifuge.instruments.tach.needle`
  - `centrifuge.instruments.lamp.glow` and `.glowSoft`
  - `centrifuge.packets`
  - `stubBelt.slats`

  Check the real ids in the code.

```ts
useFrame(({ dt }) => {
  sim.advance(ctl.paused ? 0 : dt, ctl.speed); sim.outputs(o);
  rotor().spin('z', o.rotor - A0 * DEG);   motor().spin('z', o.motor % TAU);
  gate().set({ position: [0, 0, 8.3 * o.open] });  crank().spin('z', -60 * DEG * o.open);
  needle().spin('z', (-135 + 270 * clamp01(0.7 * o.share)) * DEG - SYNC * DEG);    // C L869
  glow().level = glowSoft().level = o.lamp;
  const pk = packets(); pk.count = sim.packets((i, k, x, y, z, yaw) => { P[0]=x; P[1]=y; P[2]=z; pk.pose(i, P, yaw); pk.style(i, k); });
  const sl = slats(); sl.count = sim.slats((j, x) => sl.pose(j, [x, BELT.y, 91.4]));
  readout.publish(sim.status(), performance.now());
});
```

- No React state per frame, and no per-frame allocation: one scratch `P` and one `o`. Use the M3 review's allocation fixes (scalar pose overload, no `spun` array, no `transformMatrix` map).
- Wrap A only in the view; the sim needs the unwrapped A for its `floor(u)` crossings.
- **`shell/createShell.ts`:** call `store.tick(time, paused ? 0 : dt)` every frame, so poses written while paused (seek) still render.
- **`dims.ts`:** import the spout `lip` and `hand` from the engine `CF`, so there's one source.

## 3. Readout (`apps/app/src/overlay/readout.ts` + `Card.tsx`)

```ts
export interface ReadoutSource { subscribe(cb: () => void): () => void; getSnapshot(): string; getPhase(): string }
export function createReadout(minMs: number): ReadoutSource & { publish(s: Status, now: number): void; flush(s: Status): void };
```

**Text and timing:**
- Format: `held ${held}/10 · ${rpm.toFixed(1)} rpm · ${phase}` (v2 B L153). Initial value: `held 0/10 · 0.0 rpm · idle`.
- `publish` notifies only when the string changes and ≥ 100 ms have passed. A phase change notifies immediately. `seek` calls `flush`.

**Rendering:**
- `CardText.readout: string | ReadoutSource` in `scenes.tsx`.
- `Card.tsx` gets a `<LiveReadout source style/>` holding the only `useSyncExternalStore(...)`, so only that `Text` re-renders.

**Accessibility:**
- The 10 Hz text gets no live region.
- `accessibilityLiveRegion="polite"` moves to a visually hidden phase-word `Text` inside `LiveReadout` (aria-live on web).
- On iOS, call `AccessibilityInfo.announceForAccessibility(phase)` when the phase changes.

## 4. Time-control dev hook (`__DEV__` only, registered from `scene.dev` in `App.tsx`)

`__v4.sim` exposes:

| call | does |
|---|---|
| `seek(t)` | `reset(seed)`, then `run(t)`, then pause and flush |
| `pause()` / `play()` | stop / resume the sim |
| `speed(x)` | x in 0.25–4 |
| `seed(n)` | set the seed |
| `status()` | current status |
| `log()` | phase changes with times |
| `release(on)` | sets `canRelease`, to test backpressure |

Seek is deterministic and immune to rAF throttling, so the hidden pane and iOS give the same state.

## 5. Tipping tone change: decided, no tilt

The plan tone rule falls back to bands once a model's z axis leaves vertical by more than about 2.6° (`render/shaders.ts` L205). v2 never tilts a packet, and v4 matches with pitch = roll = 0, so nothing pops. If tilt is wanted later, add a `planYaw` tone rule (cut, not planned).

## 6. Tests: `packages/engine/tests/centrifuge.test.ts`

1. **Determinism.**
   - Two sims, seed 0, the same jittered dt sequence (LCG, dt ≤ 1/30) for 45 s, give deep-equal `state`.
   - `seek(30)` twice gives the same result.
   - Seed 1 gives a different kind order and an identical phase log.
2. **Phase order over one cycle.**
   - Run 45 s and read `log`: idle → filling → spinning up → in sync → spinning down → filling/idle.
   - Every transition is in the allowed graph.
   - At least one release reaches the belt.
   - Print the timeline for M4.md.
3. **Conservation**, checked at every step:
   - `fed = alive + gone`;
   - no `put` into an occupied pocket (assert in the sim);
   - held ≤ 10;
   - alive ≤ 40.
4. **Backpressure.**
   - `queue.length ≤ 2` at every step, and the feeder front waits at y1 whenever the queue is full.
   - With `canRelease = () => false` for 6 s after the first in sync: no loss, none on the belt, held never drops. Restoring it drains.
   - `CF.spout.hand` ≈ (−4.47, 51.14, 100).
5. **(§A) Intake closed outside index:** no pocket `put` while `mode !== 'index'`.
6. **(§A) Full drain first:** after spin-up starts, held decreases monotonically to 0 before the next `put`.
7. **(§A) Poses follow the tray:**
   - during spin, every held packet's pose angle = `A + (k+½)·ALPHA`;
   - during release, the angle moves monotonically forward (never backwards).

## 7. Acceptance criteria

- `pnpm test` and `pnpm types` are green; no WebGPU validation errors on web or iOS.
- **One full cycle** on web and the iOS sim runs the §A phases. The per-phase state (held count, phase word, rpm ≈ 14.3 in sync) is plausible against the fresh v2 frames.
- **The whole tray** and every held packet turn together during spin; no packet ever moves backwards.
- **Intake** stays closed until the tray is empty and has spun down. The feeder visibly backs up.
- **No pose pops** at segment hand-overs. Check with `speed(0.25)` around a release, plus a seek strip at 0.02 s steps.
- **Release cues:** the gate lifts and drops, the crank kicks 60°, and the lamp flashes once per release over a steady glow.
- **Needle:** rests at −135°, rides the sync tick in sync, returns on spin-down.
- **Spinning parts:** the strobe and both pulleys spin; the motor pulley at ×1.375.
- **Belt:** slats step one pitch per .42 s, evenly spaced; released packets land between slats.
- **Readout:** ≤ 10 Hz, only `LiveReadout` re-renders (argent React profiler), and words and numbers are from the same instant.
- **Perf:** 60 fps on the iOS sim at `fit` while in sync; max rAF gap < 25 ms.

## 8. By-eye test plan (argent; all artefacts in the scratchpad)

1. **v2 references.**
   - Open `centrifuge-light.html` and `centrifuge.html` in one argent Chromium at DPR 1, then close it after.
   - Inject `let c=0; FACTORY.onFrame(r=>{ if(!FACTORY.paused){ c+=r*FACTORY.speed; if(c>=T) FACTORY.paused=true }})`, step through T = 2, 4, …, 30 s, and screenshot each.
   - These are for look and per-phase state only (§A).
2. **v4 phase shots.**
   - Platforms: web (built-in pane at desktop width and at 375) and iOS sim (debugger-evaluate over Metro), in light and dark.
   - For each: `setChrome(false)`, then `sim.seek(T)`, then screenshot `fit`, plus the `rotor` and `instr` crops while in sync and mid-release.
3. **Recordings.**
   - iOS sim, light and dark: `seek(0)` → `play()` → `screen-recording-start` → about 35 s → stop.
   - Web: only if argent Chromium records cheaply.
   - These double as the social-media capture, so keep the best one and name it clearly.
4. **Edge cases.**
   - Background the tab or app for 10 s, then resume: `status().t` advances by ≤ 1/15 s.
   - Toggle the theme mid-release.
   - Switch to a crop view mid-cycle.
   - Fast Refresh edit of a part prop in `Rotor.tsx`: no duplicate-id throw, and motion continues.
   - Fast Refresh of `live.ts`: a clean restart.
   - Pause/resume via both the chip and `sim.pause`; seeking while paused still renders.
   - Scene chip to the gallery and back: the sim resumes.
5. **Perf note.** On the iOS sim at `fit` and in the `rotor` crop through a sync phase, read the max rAF gap and the per-frame flatten time.

## 9. Risks

- **Fixed step vs v2's variable dt:** threshold events (`eLand < .02`, `floor(u)` crossings) can fire one step apart. Compare by phase, not by the millisecond.
- **Hermes vs V8:** last-ulp differences can make a long seek diverge between platforms. Compare by eye.
- **Per-frame cost:** the spinning rotor dirties its subtree every frame (re-flatten plus about 20 KB uploaded). Measure on Hermes first, and optimise only if the frame rate misses 60.
- **Pops at the line ends:** packets appear at the far end of the feeder bed and vanish mid-air below the roller. v2 does the same; pools have no per-instance opacity.
- **Pocket overwrite in v2 (L1056–1061):** if test 3 fires, take the first free pocket and note it.

## 10. Cut list (in order)

1. web recording
2. render extrapolation (`w·acc`)
3. the belt's yaw squaring
4. the arc's yaw ease
5. the `canRelease` hook and its test
6. dark recordings

Never cut: the sim, §A behaviour, the single `useFrame`, the readout, seek.

## 11. Ordered steps, checkpoints, stop rules

1. **Small M3 review fixes first** (see the orchestrator brief).
2. **Sim, constants and tests** (§1, §6 including §A).
   - **Checkpoint A:** tests green; the printed timeline is plausible.
   - **Stop:** if phase order, conservation or the §A tests still fail after one fix, stop and report. Don't redesign the controller.
3. **Fresh v2 references** (§8.1).
4. **Wiring** (§2).
   - **Checkpoint B:** on web, a full cycle runs with no errors; every handle resolves; the needle and crank signs are right; the whole tray turns with its packets.
   - **Stop:** on a WebGPU validation error or a pool overflow.
5. **Readout** (§3).
   - **Checkpoint C:** only `LiveReadout` re-renders, at ≤ 10 Hz.
6. **Dev hook** (§4), then phase shots (§8.2).
   - **Checkpoint D:** every phase in both themes on both platforms is right.
7. **Edge cases, recordings, perf** (§8.3–8.5).
   - **Checkpoint E:** §7 passes.
   - **Stop:** if perf misses after one profile and the cut list, report the numbers.
8. **Wrap-up.**
   - One tuning round: a delta list, then the fixes, then a reshoot.
   - Write `notes/M4.md` (timeline, deviations including §A, verdict) and update the README.
   - Commit source and docs only.

If any checkpoint fails twice for the same reason, stop and report.

## Out-of-scope findings in existing code

- The shell's `MAX_DT` is 0.1 s, while the kit asks for 1/30. The sim clamps on its own, so only the gallery spinner jumps after a hitch.
- The paused shell skips `store.tick`, so handle writes from dev hooks don't show. §2 fixes this.
- `dims.ts` re-derives the spout kinematics. §2 makes one source.
- v2's own bugs:
  - the spin-up/release angle wrap (§A);
  - slat wrap mod 86;
  - possible pocket overwrite;
  - unbounded `FACTORY.feed`.
- The QA cycle sheets are stale (pre-REVIEW, rpm read from the needle).

## §A addendum: exact port details from the revised plan (follow these)

- **`canAccept`** (v2 L970–972) becomes `mode === 'index' && queue.length < QMAX`.
- **In-sync drops** into passing pockets (v2 **L1130–1143**) are deleted.
- **`emptyFor`** (v2 L1146) drops the `!queue.length` condition. The throat may hold up to 2 packets while intake is closed; otherwise spin-down would never start.
- **Release ride:**
  - `a = ride(k) + (G* − ride(k))·ease(τ/TA)`, with `G* = a0 + wrapπ(GATE − a0)` and `ride(k) = A + (k+½)·α` (using the same `A + w·acc` that drives `rotor.spin`).
  - It must be forward-only. Assert it in the tests.
  - Replace v2 L943 and L803–806.
- **`FEED_MAX = 6`:** the feed timer holds (the next spawn waits) while the feeder bed holds 6 items. This keeps the backpressure deterministic and bounded.
- **Landing guard:** if both `k` and `near` are full at landing (v2 L1056–1061), use `freePocket()`.
- **One direction:** `A` must never decrease. Index targets are always ahead (v2 L1085–1091, L1161–1163).
- **Slats:** 7 slats at `x = 9 − mod(slat + 12j, 84)`, which supersedes "8 mod 96". The belt phase is `mod((slat − 14.47)/12 + 0.5, 1)` (build L86).
- **Feeder packet yaw:** 0, not M3's 90°.
- **HOLD** stays at v2's 6 for now. It's one constant; the user may want 10 ("fill the tray").
