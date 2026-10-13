// node tools/chrome-reap.mjs [--dry-run] [--min-age <minutes>]
// Cleans up after browsers that outlived the run that started them (runs from before tools/chrome.mjs, or a guard that
// was itself SIGKILLed). Only temp profiles named with our prefixes (PROFILE_PREFIXES in tools/chrome.mjs) are touched:
//  1. orphaned browsers: every process using such a profile is killed (SIGTERM, then SIGKILL) and the profile removed
//     when the browser's main process (or, without one, every helper left) has been reparented to launchd (PPID 1);
//  2. leaked profiles: such directories no live process uses, last modified more than --min-age minutes ago
//     (default 10, so a profile created a moment before its browser starts is safe).
// --dry-run only lists what would be reaped.
import { readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROFILE_PREFIXES, isOurProfile, listProcesses, removeProfile, signalQuietly, userDataDirOf, waitGone } from "./chrome.mjs";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const minAgeIndex = argv.indexOf("--min-age");
const minAgeMinutes = minAgeIndex >= 0 ? Number(argv[minAgeIndex + 1]) : 10;
if (argv.includes("--help") || !(minAgeMinutes >= 0)) {
  console.log("usage: node tools/chrome-reap.mjs [--dry-run] [--min-age <minutes>]");
  process.exit(argv.includes("--help") ? 0 : 1);
}

const isHelper = (command) => / --type=/.test(command);
const byProfile = new Map();
for (const proc of listProcesses()) {
  const dir = userDataDirOf(proc.command);
  if (!dir || !isOurProfile(dir)) continue;
  if (!byProfile.has(dir)) byProfile.set(dir, []);
  byProfile.get(dir).push(proc);
}

const orphaned = [...byProfile].filter(([, procs]) => {
  const mains = procs.filter((p) => !isHelper(p.command));
  return mains.length ? mains.every((p) => p.ppid === 1) : procs.every((p) => p.ppid === 1);
});

console.log(`prefixes: ${PROFILE_PREFIXES.join(" ")} in ${tmpdir()}${dryRun ? "  (dry run)" : ""}`);
console.log(`orphaned browsers: ${orphaned.length} (of ${byProfile.size} running with our profiles)`);
for (const [dir, procs] of orphaned) {
  const main = procs.find((p) => !isHelper(p.command)) ?? procs[0];
  console.log(`  ${dryRun ? "would kill" : "kill"} pid ${main.pid} (+${procs.length - 1} helpers), up ${main.elapsed}, ${main.command.includes("--headless") ? "headless" : "headed"}, ${dir}`);
}
if (!dryRun) {
  const pids = orphaned.flatMap(([, procs]) => procs.map((p) => p.pid));
  for (const pid of pids) signalQuietly(pid, "SIGTERM");
  const stubborn = [];
  for (const pid of pids) if (!(await waitGone(pid, 3000))) stubborn.push(pid);
  for (const pid of stubborn) signalQuietly(pid, "SIGKILL");
  for (const pid of stubborn) await waitGone(pid, 2000);
  for (const [dir] of orphaned) removeProfile(dir);
}

const inUse = new Set([...byProfile.keys()].filter((dir) => !orphaned.some(([orphan]) => orphan === dir)));
const reaped = new Set(orphaned.map(([dir]) => dir));
const now = Date.now();
const leaked = readdirSync(tmpdir())
  .map((name) => join(tmpdir(), name))
  .filter((dir) => isOurProfile(dir) && !inUse.has(dir) && !reaped.has(dir))
  .flatMap((dir) => {
    try {
      const stat = statSync(dir);
      return stat.isDirectory() && now - stat.mtimeMs > minAgeMinutes * 60000 ? [{ dir, minutes: (now - stat.mtimeMs) / 60000 }] : [];
    } catch {
      return [];
    }
  });
console.log(`leaked profiles (unused, older than ${minAgeMinutes} min): ${leaked.length}`);
for (const { dir, minutes } of leaked) {
  console.log(`  ${dryRun ? "would remove" : "remove"} ${dir} (${minutes < 120 ? `${minutes.toFixed(0)} min` : `${(minutes / 60).toFixed(1)} h`} old)`);
  if (!dryRun) removeProfile(dir);
}
