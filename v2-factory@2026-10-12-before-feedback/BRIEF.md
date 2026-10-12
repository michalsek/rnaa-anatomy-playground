# v2 · The audio factory

A tall isometric machine hall (Anatomy skill style) that shows how `react-native-audio-api` turns JS calls into sound.
Believability inside a phone case is **not** required. Verticality **is**: things drop down through the factory and the
finished audio climbs back up to the speaker beside the screen. Reactor / rocket-engine finish (turned metal, flanges,
bolt circles, pipework) mixed with a factory (conveyors, arms, chutes, hoppers).

Research on the real engine: `../research-notes.md`. Previous versions: `../v0-bench`, `../v1-phone`
(v1's `build.mjs` is a good source of helper patterns: belts, pods, gauges, wheels, latch, React-logo screen).


## ⚠ Pivot (user feedback): the whole factory lives INSIDE the phone, v1-style stack

- **The phone case** lies flat on the floor as a deep, phone-shaped tray (real-world fit not required: it is as deep as
  the factory needs, ≈ 280). Back plate under everything (z −8…0, so the factory floor stays z = 0); aluminium band walls
  with buttons, ports, screws. The **far** walls (−x side and −y end) run full height; the **near** walls (+x side, +y end)
  are cut down to a low lip (≈ z 40) with a clean machined cut edge, so the viewer sees in (a cutaway, like the arcade
  cabinet with its side panel off). Phone proportions (≈ 1 : 2), rounded corners.
- **The display** floats high above the case, face up, like v1's exploded display: cover glass + OLED, carrying the
  **current animated screen** from `parts/screen/` (React logo, glow, status bar, island, home indicator, ripple) — the
  user loves it; redraw it in the plane of the top face instead of the upright face. The gantry goes away.
- **Fluff drops from under the screen**: a small dispenser on the display's underside releases beads that fall down
  into the case onto belt A.
- **The speaker** is a **bare driver** (like one mounted in a car door: stamped-steel basket with spokes and windows,
  magnet and back plate, cone with roll surround and dust cap, terminals with wires) sitting **inside the case near the
  top, under the screen, with its membrane facing up toward the screen**. The elevator delivers audio packets into it.
- Machines keep their own designs and orientations; the assembly places them inside the case by translation. Every part
  must build relative to `origin` (no absolute world coordinates) and keep its height under the case top (≈ z 280),
  except things hanging from the display.
- Case footprint, depth, display height and exact machine positions are settled by the assembly; the table above is
  the relative flow (left → right, top → bottom) to keep.

## The story (one loop, top → bottom → top)

1. **Fluff** (loose JS instructions: blue beads) drops from a dispenser **under the phone screen** onto **belt A**.
2. **Packer** (a set of arms) boxes fluff into **packets** (post-style parcels, colour coded) and drops them on **belt B**.
3. **Centrifuge** (one in the whole design) accumulates several packets, spins up until it is in sync with the
   audio thread, then releases them onto the **audio belt**.
4. **Audio belt**: fast, double sided (packets ride on top, go round the end drum and come back underneath). It never stops.
5. Spent packets (turned grey, `garbage`) drop off the audio belt onto **belt C**, which takes them to the **crusher**.
6. From the other side a **scanner needle** (hard-drive style arm) reads the audio belt; it drives the **elevator**
   that carries raw audio (mint `audio` packets) back **up to the speaker**, which sits next to the screen.

Truth behind it (for the caption, keep words out of the drawing): fluff = JS calls; packets = fixed-size closures
(FatFunction, 72 B) — blue `control` goes to the event scheduler (params, start/stop), amber `graph` goes to the graph
channel (connect/disconnect), white `data` = buffers handed over; centrifuge = the lock-free single-producer rings
(1,024 slots) that hold events until the audio thread drains them at the next render quantum; audio belt = the render
loop, one cleat-to-cleat segment per 128-frame quantum (375 per second at 48 kHz); crusher = the Disposer thread freeing what the audio
thread swapped out; scanner = the platform audio callback (CoreAudio / Oboe) reading each finished quantum;
elevator + speaker = output to the device.

## Scene plan (world units ≈ px, z up; camera azimuth 45°, elevation 30°; +x runs right-down, +y left-down)

| Machine (instance id) | Kind | Where (origin / extent) | Ports |
|---|---|---|---|
| `phone` (was `screen`) | phone | case lying flat, origin = floor centre: `w`×`d` (default 280×540), walls to `depth` (280), near walls cut to `cut` (40); display floats face up at `displayZ` (default depth + 220); dispenser hangs under it at `opts.dispenser` [dx, dy] (default [−40, −118]) | `fluff` out at origin + [dx, dy, displayZ − 67], emitted as the bead leaves the nozzle (`item.v` = [0, 0, −v]) |
| `speaker` | speaker | bare driver, membrane up, on a 4-post stand, origin = base centre; baffle top at `opts.height` (default 64); footprint ±46, throat + ledge to x +64 | `in` at origin + [64, 0, height − 15] (the feed ledge) |
| `beltA` | conveyor (top) | along +x, y = −118, x −60…72, top surface z 232, legs to floor | `in` at x −40, `out` at x 72 |
| `packer` | packer | x 72…130, y −140…−90, z 150…260 | `in` from beltA end; `out` drops on beltB start [100, −92, 196] |
| `beltB` | conveyor (top) | along +y, x = 100, y −96…24, top z 192 | `in` at y −92, `out` at y 24 (drops into centrifuge) |
| `centrifuge` | centrifuge | centre (100, 66), z 100…186, drum r ≈ 32, on a stand | `in` top [100, 34, 186]; `out` side/bottom onto audio belt [74, 74, 96] |
| `audio` | conveyor (double sided loop) | along −x, y = 74, x 86…−130, top run z 92, bottom run z 62 (end drums r 15) | `in` at x 74 (top); `drop` at x −130 (garbage falls to beltC); `read` exposes slat positions to the scanner |
| `scanner` | scanner | far side of the audio belt (y ≈ 50), pivot near (−30, 44, 70) | reads `audio`; `out` sends audio packets to beltD |
| `beltD` | conveyor (top) | along −y, x = −100, y 40…−112, top z 24 | `in` from scanner, `out` at elevator foot |
| `elevator` | elevator | vertical column x −118…−96, y −134…−112, z 0…430 | `in` at foot (z 24), `out` at top into the speaker |
| `beltC` | conveyor (top) | along +y, x = −136, y 70…150, top z 40 | `in` at y 74 (from audio `drop`), `out` at y 150 |
| `crusher` | crusher | centre (−136, 176), z 0…38 (drawer rolls out to local y +60) | `in` top hopper |

Positions are a plan, not a cage: if a machine needs more room, change it, and write the change into this table
and into the part's `NOTES.md`. Machines are placed by translation only, so build each in the orientation above.

## The contract every part follows

Folder per part: `parts/<kind>/`

- `<kind>.mjs` exports `build(ctx, origin, opts)` and `LIVE` (a string of page JS).
  - `build` draws with the shared helpers (`ctx.box/slab/prism/cyl/turned/disc/boss/cable/screws/put/slot`), offset by
    `origin`; every item name starts with the instance id (`opts.id`, e.g. `beltA.roller`).
  - It writes live data to `ctx.data[opts.id]` (geometry the page needs) including `ports` (world points).
  - Moving things are drawn into **slots**: `ctx.slot(`${id}:top`, { after: `${id}.belt` })` places an empty group at the
    right place in the settled painter's order; the live code fills it every frame.
  - Set `ctx.material = "fx-graphite"` for dark machined parts, `""` for brushed-steel structure, `"fx-react"` for
    JS-side parts. Reset it after.
- `LIVE` registers a kind: `MACHINES.<kind> = (api) => ({ tick(dt, t), accept(port, item, from) })`.
  `api` gives `data, slot(name), el(sel), at, along(route, t), packetSvg(kind, p), fluffSvg(p), emit(port, item, from),
  item(kind), now(), calm(), announce(text), smooth, lerp3, clamp`. Hand items on with `api.emit("out", item, worldPoint)`.
  Items are `{ id, kind, born }`; kinds: fluff, control, graph, data, audio, garbage.
- `build.mjs` makes the standalone page `<kind>.html` (+ `-light.html`) with a demo feeder
  (`FACTORY.feed(id, port, everySeconds, () => FACTORY.item("control"))`) and sink (`FACTORY.onEmit`). Boot code:
  `FACTORY.define("<id>", MACHINES.<kind>)`. See `parts/packets/` for the minimal example.
- `NOTES.md`: first line `status: <in progress | review | done>`, then decisions, size/ports, open questions.
- `shot.png`: a current light-theme screenshot of the standalone page (`capture.mjs … --out shot.png`).
- After each meaningful step run `node ../../tools/index.mjs` so `v2-factory/index.html` stays current.

## Quality bar (from the Anatomy skill — read `~/.claude/skills/anatomy/SKILL.md` and `references/craft.md`)

- A real, dense, buildable machine; many small purposeful parts; reactor/engine finish; one lit accent per machine.
- `node build.mjs --audit` ends `audit passed`; `node ~/.claude/skills/anatomy/scripts/lines.mjs <page>-light.html` prints
  `line ends: 0` (also mid-motion with `drive.mjs … ["lines"]`).
- Calm, physically plausible motion (springs, exponential follow, envelopes); nothing pops; reduced motion goes still.
- Light theme ships; check dark too. Read every PNG you make.
