// The native rotor hook in v2's page script: where it goes and what it may name (CQ-M5 S7). Used by tools/build.mjs
// (GPU live pages) and tools/test-native.mjs (v2's LIVE run in Node with the same injected line).
import { ROTOR_HOOK_LINE } from "../src/native/rotor-contract.ts";

/** Where the hook goes: the first line of v2 centrifugeLive's drawRotor. */
export const ROTOR_ENTRY = "function drawRotor(now) {";
const LIVE_ENTRY = /function centrifugeLive\(([^)]*)\)\s*\{/;
const DECLARATION = (name) => new RegExp(`\\b(?:let|const|var|function)\\s+${name}\\b`);

/** Identifiers the hook line passes or reads (its call's arguments and the api object). */
export function hookNames(line = ROTOR_HOOK_LINE) {
  const args = /\(([^()]*)\)\)\s*return;$/.exec(line)?.[1];
  if (!args) throw new Error(`rotor hook: cannot read the arguments of ${line}`);
  return ["api", ...args.split(",").map((name) => name.trim())];
}

/**
 * Throws unless every identifier the hook line names is declared in v2's centrifugeLive: a parameter of centrifugeLive
 * or of drawRotor, or a `let` / `const` / `var` / `function` in its body. A renamed v2 variable would otherwise build
 * fine and throw a ReferenceError inside drawRotor on every tick (which no native error guard can contain).
 */
export function assertHookNames(script, line = ROTOR_HOOK_LINE) {
  const live = LIVE_ENTRY.exec(script);
  if (!live) throw new Error("rotor hook: no function centrifugeLive(…) { in the page script");
  const body = functionBody(script, live.index + live[0].length - 1);
  const parameters = new Set([...live[1].split(","), ...(/function drawRotor\(([^)]*)\)/.exec(body)?.[1] ?? "").split(",")].map((name) => name.trim()).filter(Boolean));
  const missing = hookNames(line).filter((name) => !parameters.has(name) && !DECLARATION(name).test(body));
  if (missing.length) throw new Error(`rotor hook: ${missing.join(", ")} not declared in centrifugeLive (v2 renamed a variable the hook passes: update ROTOR_HOOK_LINE in src/native/rotor-contract.ts)`);
}

/** The text of the block that opens at `script[open]` ("{"), by brace count (v2's LIVE has no unbalanced braces in strings). */
function functionBody(script, open) {
  let depth = 0;
  for (let i = open; i < script.length; i++) {
    if (script[i] === "{") depth++;
    else if (script[i] === "}" && --depth === 0) return script.slice(open, i + 1);
  }
  throw new Error("rotor hook: centrifugeLive's body never closes");
}

/** `script` with the hook as the first line of drawRotor; exactly one site must exist and every name must resolve. */
export function injectRotorHook(script, page = "page script") {
  const sites = script.split(ROTOR_ENTRY).length - 1;
  if (sites !== 1) throw new Error(`${page}: ${sites} occurrences of "${ROTOR_ENTRY}" in the module script (the native rotor hook needs exactly 1)`);
  assertHookNames(script);
  const at = script.indexOf(ROTOR_ENTRY) + ROTOR_ENTRY.length;
  const indent = /\n([ \t]*)[^\n]*$/.exec(script.slice(0, at))?.[1] ?? "";
  return `${script.slice(0, at)}\n${indent}  ${ROTOR_HOOK_LINE}${script.slice(at)}`;
}
