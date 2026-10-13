// node tools/chrome-guard.mjs [--profile <dir>]... -- <command> [args...]
// Sidecar started by tools/chrome.mjs (spawnGuarded), not by hand. Spawns <command> as the leader of a new process
// group (Chrome's helpers stay in it) with stdout / stderr straight on ours, then ends the whole group, removes the
// given profiles plus any of our temp profiles a group member was using, and exits with the command's status, when:
//  - the command exits (helpers it left behind are swept),
//  - our stdin reaches EOF: its only writer is the tool that started us, so the kernel closes it when that tool dies
//    in any way, SIGKILL included,
//  - our parent changes (reparented: the same death, seen without the pipe),
//  - we get SIGTERM / SIGINT / SIGHUP (tools/chrome.mjs closes a browser with SIGTERM).
// The group gets SIGTERM, then SIGKILL after GUARD_GRACE_MS.
import { spawn } from "node:child_process";
import { constants } from "node:os";
import { GUARD_GRACE_MS, isOurProfile, listProcesses, removeProfile, signalQuietly, userDataDirOf, waitGone } from "./chrome.mjs";

const separator = process.argv.indexOf("--");
const own = process.argv.slice(2, separator);
const [command, ...args] = process.argv.slice(separator + 1);
const profiles = own.flatMap((arg, i) => (own[i - 1] === "--profile" ? [arg] : []));
if (separator < 0 || !command) {
  console.error("usage: node tools/chrome-guard.mjs [--profile <dir>]... -- <command> [args...]");
  process.exit(2);
}

// once the tool is gone its pipes are too: never die of EPIPE before the cleanup is done
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

const startPpid = process.ppid;
let status = null;
let ending = false;

const child = spawn(command, args, { detached: true, stdio: ["ignore", "inherit", "inherit"] });
child.on("exit", (code, signal) => {
  status = code ?? 128 + (constants.signals[signal] ?? 0);
  end();
});
child.on("error", (error) => {
  status = 127;
  try {
    console.error(`chrome-guard: ${command}: ${error.message}`);
  } catch {}
  end();
});

process.stdin.on("end", end);
process.stdin.on("close", end);
process.stdin.on("error", end);
process.stdin.resume();
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, end);
setInterval(() => process.ppid !== startPpid && end(), 500).unref();

async function end() {
  if (ending) return;
  ending = true;
  const group = child.pid;
  const doomed = new Set(profiles);
  if (group) {
    for (const p of listProcesses()) {
      const dir = p.pgid === group ? userDataDirOf(p.command) : null;
      if (dir && isOurProfile(dir)) doomed.add(dir);
    }
    signalQuietly(-group, "SIGTERM");
    if (!(await waitGone(-group, GUARD_GRACE_MS))) {
      signalQuietly(-group, "SIGKILL");
      await waitGone(-group, 2000);
    }
  }
  for (const dir of doomed) {
    try {
      removeProfile(dir);
    } catch {}
  }
  process.exit(status ?? 1);
}
