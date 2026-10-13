// node tools/test-live.mjs [markup.json] — src/live/geometry.ts against the M1 exporter (export/build-dl.mjs
// primitivesOf) on real live markup: the largest string each slot received (tools/live-gate.mjs record). Per slot:
// segment + dot count, layer count and nonzero fill area must agree; also times a warm build of all slots.
import { readFileSync } from "node:fs";
import * as esbuild from "esbuild";
const ROOT = new URL("..", import.meta.url).pathname;
const out = await esbuild.build({ entryPoints: [ROOT + "src/live/geometry.ts"], bundle: true, format: "esm", platform: "node", write: false, define: { __GPU_DEV__: "true" } });
const { SlotGeometryBuilder } = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));
const { primitivesOf, createPalette, createSink } = await import("../export/build-dl.mjs");
const recon = { maxStr: JSON.parse(readFileSync(process.argv[2] ?? ROOT + "out/gpu/live-gate/slot-markup.json", "utf8")) };
let id = 0;
const lookup = { paintOf: () => ({ id: id++ % 50, visible: true, opaque: true, blend: "normal" }) };
const b = new SlotGeometryBuilder(lookup, []);
let bad = 0;
for (const [slot, markup] of Object.entries(recon.maxStr)) {
  const g = b.build(markup, 1);
  const f32 = new Float32Array(g.bytes, 0, g.byteLength / 4);
  let area = 0;
  const v0 = g.segCount * 12;
  for (let v = 0; v < g.vertexCount; v += 3) {
    const o = v0 + v * 4;
    const [ax, ay, bx, by, cx, cy] = [f32[o], f32[o + 1], f32[o + 4], f32[o + 5], f32[o + 8], f32[o + 9]];
    area += ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
  }
  const sink = createSink();
  primitivesOf(markup, { item: 0, palette: createPalette(), sink });
  let refArea = 0;
  for (const p of sink.prims.filter((p) => p.kind === 0)) {
    const idx = sink.fillIndices.slice(p.first, p.first + p.count);
    for (let t = 0; t < idx.length; t += 3) {
      const [a, bb, c] = [sink.fillVertices[idx[t]], sink.fillVertices[idx[t + 1]], sink.fillVertices[idx[t + 2]]];
      refArea += ((bb.x - a.x) * (c.y - a.y) - (bb.y - a.y) * (c.x - a.x)) / 2;
    }
  }
  const ok = g.segCount === sink.segments.length + sink.dots.length && Math.abs(area - refArea) < 1e-3 * Math.max(1, refArea) && g.layers === sink.prims.length + sink.dots.length - sink.prims.filter((p) => p.kind === 2).length;
  if (!ok) bad++;
  console.log(ok ? "ok " : "BAD", slot.padEnd(24), `segs ${g.segCount} vs ${sink.segments.length}+${sink.dots.length} dots · area ${area.toFixed(2)} vs ${refArea.toFixed(2)} · layers ${g.layers} vs prims ${sink.prims.length}`);
}
const t0 = performance.now();
for (let i = 0; i < 200; i++) for (const markup of Object.values(recon.maxStr)) b.build(markup, 1);
console.log(`warm build of all max strings: ${((performance.now() - t0) / 200).toFixed(2)} ms/frame (node), mesh cache`, b.stats.meshHits, b.stats.meshMisses);
process.exit(bad ? 1 : 0);
