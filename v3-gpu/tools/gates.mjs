// node tools/gates.mjs [--quick | --full] [--only a,b] [--skip a,b] — runs the gates in sequence (they share the GPU,
// so never in parallel), prints a summary table and exits 1 when any gating row fails. Default: --quick.
//   --quick  every gate in its short form (< ~2 min on the reference machine)
//   --full   every gate in full, the gate self-tests (each deliberate defect must make its gate fail) and the perf
//            smoke (numbers only, never fails the run)
// Logs → out/tmp/gates/logs/<row>.log, gate reports → out/tmp/gates/<gate>.json. Thresholds: tools/gates.config.mjs,
// explained in notes/GATES.md. Pages under test must be built first (node export/export.mjs && node tools/build.mjs).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GATES_OUT, ROOT, parseArgs } from "./harness.mjs";
import { NATIVE_ROWS } from "./gates.config.mjs";

const node = (...args) => [process.execPath, ...args];
/** One row per command: `expect: "fail"` marks a self-test (the gate must reject a deliberate defect). */
const ROWS = [
  { name: "unit", modes: ["quick", "full"], command: node("--test", "tools/test-export.mjs", "tools/test-live.mjs", "tools/test-native.mjs", "tools/test-core.mjs") },
  { name: "dl", modes: ["quick", "full"], command: node("tools/gate.mjs") },
  { name: "static", modes: ["quick"], command: node("tools/live-gate.mjs", "static", "--quick") },
  { name: "static", modes: ["full"], command: node("tools/live-gate.mjs", "static") },
  { name: "live", modes: ["quick"], command: node("tools/live-gate.mjs", "live", "--quick") },
  { name: "live", modes: ["full"], command: node("tools/live-gate.mjs", "live") },
  { name: "motion", modes: ["quick"], command: node("tools/live-gate.mjs", "motion", "--quick") },
  { name: "motion", modes: ["full"], command: node("tools/live-gate.mjs", "motion") },
  { name: "edge", modes: ["quick"], command: node("tools/live-edge.mjs", "--quick") },
  { name: "edge", modes: ["full"], command: node("tools/live-edge.mjs") },
  { name: "calib", modes: ["quick"], command: node("tools/live-gate.mjs", "calib", "--quick") },
  { name: "calib", modes: ["full"], command: node("tools/live-gate.mjs", "calib") },
  { name: "determinism", modes: ["quick"], command: node("tools/live-gate.mjs", "determinism", "--ticks", "600", "--real-ticks", "60") },
  { name: "determinism", modes: ["full"], command: node("tools/live-gate.mjs", "determinism", "--ticks", "3000") },
  { name: "native:contract", modes: ["quick"], command: node("tools/native-gate.mjs", "contract", "--quick") },
  { name: "native:contract", modes: ["full"], command: node("tools/native-gate.mjs", "contract") },
  { name: "native:identity", modes: ["quick"], command: node("tools/native-gate.mjs", "identity", "--quick") },
  { name: "native:identity", modes: ["full"], command: node("tools/native-gate.mjs", "identity") },
  { name: "native:compare", modes: ["full"], command: node("tools/native-gate.mjs", "compare") },
  { name: "native:sheet", modes: ["full"], command: node("tools/native-gate.mjs", "sheet") },
  ...NATIVE_ROWS.map(({ args, ...row }) => ({ ...row, command: node(...args) })),
  { name: "identity", modes: ["quick"], command: node("tools/live-gate.mjs", "identity", "--quick") },
  { name: "identity", modes: ["full"], command: node("tools/live-gate.mjs", "identity") },
  { name: "package", modes: ["quick"], command: node("tools/package-gate.mjs", "--quick") },
  { name: "package", modes: ["full"], command: node("tools/package-gate.mjs") },
  { name: "selftest:dl", modes: ["full"], expect: "fail", command: node("tools/gate.mjs", "--mutate", "drop-fill", "--themes", "dark") },
  { name: "selftest:static", modes: ["full"], expect: "fail", command: node("tools/live-gate.mjs", "static", "--quick", "--mutate", "patch") },
  { name: "live:markup", modes: ["full"], command: node("tools/live-gate.mjs", "live", "--quick", "--native", "0") },
  { name: "selftest:live", modes: ["full"], expect: "fail", command: node("tools/live-gate.mjs", "live", "--quick", "--mutate", "drop-native") },
  { name: "selftest:live:markup", modes: ["full"], expect: "fail", command: node("tools/live-gate.mjs", "live", "--quick", "--native", "0", "--mutate", "drop-slot") },
  { name: "selftest:motion", modes: ["full"], expect: "fail", command: node("tools/live-gate.mjs", "motion", "--quick", "--mutate", "pop") },
  { name: "selftest:calib", modes: ["full"], expect: "fail", command: node("tools/live-gate.mjs", "calib", "--quick", "--mutate", "contrast") },
  { name: "selftest:identity", modes: ["full"], expect: "fail", command: node("tools/live-gate.mjs", "identity", "--quick", "--mutate", "skip-growth") },
  { name: "selftest:identity:invalidate", modes: ["full"], expect: "fail", command: node("tools/live-gate.mjs", "identity", "--quick", "--mutate", "skip-invalidate") },
  { name: "selftest:determinism", modes: ["full"], expect: "fail", command: node("tools/live-gate.mjs", "determinism", "--ticks", "300", "--real-ticks", "30", "--mutate", "no-rebase") },
  { name: "perf", modes: ["full"], gating: false, command: node("tools/live-gate.mjs", "perf") },
];
const REQUIRED_PAGES = ["out/dl/centrifuge.dl.json", "out/svg/centrifuge.html", "out/gpu/live.html", "out/gpu/live-light.html", "out/gpu/live-dev.html", "out/gpu/static.html", "out/gpu/calib/calib-gpu.html", "out/gpu/fixture/fixture-gpu.html", "centrifuge-gpu.html", "centrifuge-gpu-light.html"];

function run(row) {
  return new Promise((done) => {
    const start = Date.now();
    const child = spawn(row.command[0], row.command.slice(1), { cwd: ROOT });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("exit", (code) => done({ code, output, seconds: (Date.now() - start) / 1000 }));
  });
}

const options = parseArgs(["quick", "full"]);
const mode = options.full ? "full" : "quick";
const only = options.only ? String(options.only).split(",") : null;
const skip = options.skip ? String(options.skip).split(",") : [];
const baseName = (name) => name.replace(/^selftest:/, "");
const rows = ROWS.filter((row) => row.modes.includes(mode) && (!only || only.includes(row.name) || only.includes(baseName(row.name))) && !skip.includes(row.name));
const missing = REQUIRED_PAGES.filter((page) => !existsSync(join(ROOT, page)));
if (missing.length) {
  console.error(`missing ${missing.join(", ")}: run node export/export.mjs && node tools/build.mjs first`);
  process.exit(2);
}

mkdirSync(join(GATES_OUT, "logs"), { recursive: true });
const results = [];
for (const row of rows) {
  process.stdout.write(`${row.name.padEnd(22)} … `);
  const { code, output, seconds } = await run(row);
  const logFile = join(GATES_OUT, "logs", `${row.name.replace(/:/g, "-")}.log`);
  writeFileSync(logFile, output);
  const lines = output.split("\n");
  const failedChecks = lines.filter((line) => line.startsWith("FAIL"));
  const problems = lines.filter((line) => line.startsWith("FAIL") || line.startsWith("✖") || /Error|error:/.test(line));
  // a self-test passes only when the gate ran and one of its checks rejected the defect (a crash is not a rejection)
  const ok = row.expect === "fail" ? code === 1 && failedChecks.length > 0 : code === 0;
  const passedChecks = lines.filter((line) => line.startsWith("PASS") || line.startsWith("✔")).length;
  let detail;
  if (row.expect === "fail") detail = ok ? `rejected the defect (${failedChecks.length} failing checks)` : `NOT rejected (exit ${code}${problems[0] ? `: ${problems[0]}` : ""})`;
  else if (row.gating === false) detail = ok ? "numbers in out/tmp/gates/perf.json" : `exit ${code}: ${problems[0] ?? ""}`;
  else detail = ok ? `${passedChecks} checks` : `${failedChecks.length || problems.length} failing: ${problems[0] ?? `exit ${code}`}`;
  const status = row.gating === false ? (ok ? "INFO" : "WARN") : ok ? "PASS" : "FAIL";
  results.push({ name: row.name, ok, status, gating: row.gating !== false, seconds, detail, log: logFile.replace(`${ROOT}/`, "") });
  console.log(`${status} ${seconds.toFixed(0)} s`);
}

const width = Math.max(...results.map((r) => r.name.length));
console.log(`\ngates (${mode}):`);
for (const r of results) console.log(`  ${r.name.padEnd(width)}  ${r.status}  ${`${r.seconds.toFixed(0)} s`.padStart(5)}  ${r.detail.slice(0, 160)}`);
const failing = results.filter((r) => !r.ok && r.gating);
const total = results.reduce((sum, r) => sum + r.seconds, 0);
console.log(failing.length ? `\n${failing.length} gate(s) FAILED in ${total.toFixed(0)} s: ${failing.map((r) => `${r.name} (${r.log})`).join(", ")}` : `\nall gates passed in ${total.toFixed(0)} s`);
writeFileSync(join(GATES_OUT, "summary.json"), JSON.stringify({ mode, results }, null, 1));
process.exitCode = failing.length ? 1 : 0;
