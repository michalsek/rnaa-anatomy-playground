// Throwaway QA: rebuild the standalone crusher page at another origin (same relative framing) so the two pages can be
// compared frame for frame. Usage: node qa/origin-test.mjs 60,-40,0  → qa/origin-60_-40_0.html (+ -light)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const QA = dirname(fileURLToPath(import.meta.url));
const origin = (process.argv[2] ?? "60,-40,0").split(",").map(Number);
const tag = origin.join("_");
let src = readFileSync(join(QA, "..", "build.mjs"), "utf8");
src = src.replace(/const O = \[[^\]]*\];/, `const O = ${JSON.stringify(origin)};`)
  .replace(`"../../shared/kit.mjs"`, `"../../../shared/kit.mjs"`)
  .replace(`"./crusher.mjs"`, `"../crusher.mjs"`)
  .replace(`join(HERE, "crusher.html")`, `join(HERE, "origin-${tag}.html")`);
const file = join(QA, `_build-${tag}.mjs`);
writeFileSync(file, src);
try { execFileSync("node", [file], { stdio: "inherit" }); } catch { console.log("(audit exit non-zero, expected off the floor)"); }
