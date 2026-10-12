// QA harness: run the packer LIVE code headless in node, record arm poses and carton states per tick.
import { scene, k, G } from "../../../shared/kit.mjs";
import { build, LIVE } from "../packer.mjs";
const fit = [[0,0,0],[200,0,0],[0,-200,0],[0,0,300]];
export function simulate({ origin = [100, -118, -150], seconds = 12, dt = 1 / 60, feedEvery = 0.9, calm = false, prefill = true } = {}) {
  const ctx = scene({ W: 700, H: 760, fit, pad: 26 });
  build(ctx, origin, { id: "packer", prefill, floor: 150 });
  const data = ctx.data.packer;
  const poses = [];
  let live = LIVE.replace("const qp = R.solve(PS, picker.W);", "const qp = R.solve(PS, picker.W); const qf0 = R.solve(FS, folder.W); globalThis.__rec({ t: clock, picker: { ...qp, phase: picker.phase, W: picker.W }, folder: { ...qf0, phase: folder.phase, W: folder.W }, cartons: cartons.map((c) => ({ ...c, flaps: [...c.flaps] })), erector: { ...erector, carton: null }, beam: { ...beam }, feeder: { ...feeder }, nest: nest.map((b) => ({ ...b })) });");
  if (live === LIVE) throw new Error("hook failed");
  globalThis.__rec = (s) => poses.push(JSON.parse(JSON.stringify(s)));
  const MACHINES = {};
  const emitted = [];
  const fn = new Function("MACHINES", "G", "iso", "pathOf", "solidSvg", "lineSvg", "dotsSvg", "cameraOf", "slabOf", "sideSeam", "lineOnTop", live);
  fn(MACHINES, G, k.iso, k.pathOf, k.solidSvg, k.lineSvg, k.dotsSvg, k.cameraOf, k.slabOf, k.sideSeam, k.lineOnTop);
  let clock = 0, nextId = 1;
  const slotObj = () => ({ innerHTML: "" });
  const api = { id: "packer", data, P: ctx.P, KS: ctx.KS, at: (p) => k.iso(p, ctx.P), clamp: (v, a, b) => Math.min(b, Math.max(a, v)), lerp3: (a, b, t) => a.map((v, i) => v + (b[i] - v) * t),
    packetSvg: () => "", fluffSvg: () => "", slot: slotObj, emit: (port, item, from) => emitted.push({ t: clock, port, item, from }), item: (kind) => ({ id: nextId++, kind, born: clock }), now: () => clock, calm: () => calm, announce: () => {} };
  const m = MACHINES.packer(api);
  let next = 0.1;
  const feedFrom = [data.ports.in[0] - 3, data.ports.in[1], data.ports.in[2]];
  while (clock < seconds) {
    clock += dt;
    if (clock >= next) { next = clock + feedEvery; m.accept("in", api.item("fluff"), feedFrom); }
    m.tick(dt, clock);
  }
  return { data, poses, emitted, stats: m.stats(), ctx };
}
