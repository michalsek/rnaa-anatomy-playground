// Every Chrome the v3 tools start, directly or through a Chrome-spawning tool such as the anatomy skill's capture.mjs,
// is started here, so that no browser and no temp profile outlives the run that started it.
//
// Each one runs under tools/chrome-guard.mjs: a sidecar node process in a session of its own that spawns the command
// as the leader of a fresh process group and owns that group and its temp profiles. The guard's stdin is a pipe whose
// only writer is this process. The kernel closes it however this process ends (normal exit, uncaught exception,
// unhandled rejection, SIGINT/SIGTERM/SIGHUP, SIGKILL), and on EOF the guard kills the group (SIGTERM, then SIGKILL
// after GUARD_GRACE_MS) and removes the profiles. Nothing here has to run for that to happen; the handlers below only
// let SIGINT / SIGTERM finish the cleanup before the tool dies (so whoever ran it sees no browser left), and cover one
// case the pipe cannot see: a tool whose supervisor died (tools/gates.mjs and bench/*.mjs pipe a child tool's output)
// would otherwise keep driving its browser with nobody reading the result.
//
// Orphans left by older runs or by a guard that was itself SIGKILLed: node tools/chrome-reap.mjs.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, fstatSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Temp-profile prefixes of the browsers v3 starts: launchChrome, capture.mjs (tools/gate.mjs), drive.mjs (chrome-webgpu.sh). */
export const PROFILE_PREFIXES = ["v3-perf-", "iso-capture-", "iso-drive-"];
export const GUARD_GRACE_MS = 3000;

const GUARD = join(dirname(fileURLToPath(import.meta.url)), "chrome-guard.mjs");
const SKILL_SCRIPTS = process.env.ANATOMY_SCRIPTS ?? join(homedir(), ".claude/skills/anatomy/scripts");
const TEMP_ROOTS = new Set([tmpdir(), realpathSync(tmpdir()), "/tmp", "/private/tmp"]);
// SIGHUP is left to the pipe: a listener would override the SIG_IGN that nohup relies on
const SIGNAL_NUMBERS = { SIGINT: 2, SIGTERM: 15 };

export function isOurProfile(dir) {
  return TEMP_ROOTS.has(dirname(dir)) && PROFILE_PREFIXES.some((prefix) => basename(dir).startsWith(prefix));
}

export function userDataDirOf(command) {
  return command.match(/--user-data-dir=(\S+)/)?.[1] ?? null;
}

export function listProcesses() {
  const table = execFileSync("ps", ["-axww", "-o", "pid=,ppid=,pgid=,etime=,command="], { encoding: "utf8", maxBuffer: 64 << 20 });
  return table
    .split("\n")
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/))
    .filter(Boolean)
    .map(([, pid, ppid, pgid, elapsed, command]) => ({ pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), elapsed, command }));
}

export function signalQuietly(target, signal) {
  try {
    process.kill(target, signal);
    return true;
  } catch {
    return false;
  }
}

/** Resolves true once no process answers to `target` (a pid, or -pgid for a whole group), false after `timeoutMs`. */
export async function waitGone(target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (signalQuietly(target, 0)) {
    if (Date.now() > deadline) return false;
    await new Promise((done) => setTimeout(done, 50));
  }
  return true;
}

export function removeProfile(dir) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

export function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const playwright = join(homedir(), "Library/Caches/ms-playwright");
  if (existsSync(playwright)) {
    for (const dir of readdirSync(playwright).sort().reverse()) {
      candidates.push(join(playwright, dir, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"));
    }
  }
  return candidates.find((path) => existsSync(path));
}

const liveGuards = new Set();
const startPpid = process.ppid;
let handlersInstalled = false;
let abandoned = false;

/**
 * Runs `command` under a guard. `profiles` are removed when the group ends; profiles of our prefixes that Chrome
 * processes inside the group were given (e.g. capture.mjs's own) are found and removed too. The returned `child` is the
 * guard: its stdout / stderr carry the command's, its exit code mirrors the command's.
 */
export function spawnGuarded(command, args, { profiles = [] } = {}) {
  installHandlers();
  const guardArgs = [GUARD, ...profiles.flatMap((dir) => ["--profile", dir]), "--", command, ...args];
  const child = spawn(process.execPath, guardArgs, { detached: true, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.on("error", () => {});
  const exited = new Promise((done) => child.once("exit", (code, signal) => done({ code, signal })));
  const guard = { child, profiles, exited, closing: null };
  guard.close = () => (guard.closing ??= closeGuard(guard));
  liveGuards.add(guard);
  exited.then(({ signal }) => {
    liveGuards.delete(guard);
    // a guard always exits with a code after its cleanup; one killed by a signal (SIGKILL) may have left the browser
    if (signal) sweepProfiles(profiles);
  });
  return guard;
}

async function closeGuard(guard) {
  if (guard.child.exitCode !== null || guard.child.signalCode !== null) return;
  // the guard's command leads its group; read it before the guard can die and the group lose its parent
  const groups = listProcesses().filter((p) => p.ppid === guard.child.pid).map((p) => p.pgid);
  guard.child.kill("SIGTERM");
  const timeout = new Promise((done) => setTimeout(done, GUARD_GRACE_MS + 3000, "timeout"));
  if ((await Promise.race([guard.exited, timeout])) !== "timeout") return;
  guard.child.kill("SIGKILL");
  for (const pgid of groups) signalQuietly(-pgid, "SIGKILL");
  sweepProfiles(guard.profiles);
}

function sweepProfiles(profiles) {
  if (!profiles.length) return;
  for (const p of listProcesses()) if (profiles.includes(userDataDirOf(p.command))) signalQuietly(p.pid, "SIGKILL");
  for (const dir of profiles) removeProfile(dir);
}

export async function closeAllGuarded() {
  await Promise.all([...liveGuards].map((guard) => guard.close()));
}

function terminateAllNow() {
  for (const guard of liveGuards) signalQuietly(guard.child.pid, "SIGTERM");
}

function outputIsPiped() {
  try {
    const stat = fstatSync(1);
    return stat.isFIFO() || stat.isSocket();
  } catch {
    return false;
  }
}

function installHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;
  // sync contexts: the guards finish the shutdown on their own once signalled (or once our end of the pipe closes)
  process.on("exit", terminateAllNow);
  process.on("uncaughtExceptionMonitor", terminateAllNow);
  for (const signal of Object.keys(SIGNAL_NUMBERS)) {
    const onSignal = async () => {
      process.off(signal, onSignal);
      process.once(signal, () => {
        terminateAllNow();
        process.exit(128 + SIGNAL_NUMBERS[signal]);
      });
      // the tool sees its browsers die and fails (a capture "exits 143"): that is this shutdown, not a crash to report
      const ignore = () => {};
      process.on("uncaughtException", ignore);
      process.on("unhandledRejection", ignore);
      await closeAllGuarded();
      // keep the default disposition (death by this signal) unless the tool installed its own handler
      if (process.listenerCount(signal) === 1) {
        process.removeAllListeners(signal);
        process.kill(process.pid, signal);
      }
    };
    process.on(signal, onSignal);
  }
  // a supervisor that pipes our output died (we were reparented): nobody will read the result, so stop. A tool started
  // from a shell with output to a file or terminal (nohup, &) is left running.
  setInterval(() => {
    if (abandoned || !liveGuards.size || process.ppid === startPpid || !outputIsPiped()) return;
    abandoned = true;
    closeAllGuarded().finally(() => process.exit(1));
  }, 500).unref();
}

// Fresh profile per run. Same base flags as drive.mjs / capture.mjs, plus the anti-backgrounding flags a headed perf
// run needs (an occluded or unfocused window must keep producing frames).
export async function launchChrome({ headed = false, windowSize = [1300, 1000], flags = [] } = {}) {
  const binary = chromePath();
  if (!binary) throw new Error("No Chrome found. Set CHROME_PATH.");
  const { chromePort } = await import(pathToFileURL(join(SKILL_SCRIPTS, "chrome-port.mjs")).href);
  const profile = mkdtempSync(join(tmpdir(), "v3-perf-"));
  const args = [
    ...(headed ? [`--window-size=${windowSize[0]},${windowSize[1]}`, "--window-position=40,40"] : ["--headless=new", "--hide-scrollbars"]),
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--allow-file-access-from-files",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-extensions",
    ...flags,
    "about:blank",
  ];
  const guard = spawnGuarded(binary, args, { profiles: [profile] });
  const { child } = guard;
  // chromePort reads the DevTools line from stderr and, when Chrome fails to start, "kills" it: route that to the guard
  const startup = { stderr: child.stderr, on: child.on.bind(child), off: child.off.bind(child), kill: () => guard.close() };
  const port = await chromePort(startup, profile);
  child.stderr.resume(); // keep draining Chrome's log so it never blocks on a full pipe
  return { binary, args, chrome: child, profile, port, close: guard.close };
}
