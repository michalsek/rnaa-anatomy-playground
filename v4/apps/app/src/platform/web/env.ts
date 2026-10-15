// Web host for the engine's `#platform/env.ts` (remapped in metro.config.js).
import type { HostPlatform } from '@anatomy/engine/platform/contract/env.ts';

declare const __DEV__: boolean;

export const PLATFORM: HostPlatform = 'web';
export const DEV: boolean = __DEV__;
/** Also kept in a small ring (`globalThis.__v4logs`) for dev tools that can't read the console. */
export const log = (...args: unknown[]) => {
  console.log(...args);
  const g = globalThis as { __v4logs?: string[] };
  const ring = (g.__v4logs ??= []);
  ring.push(args.map(String).join(' '));
  if (ring.length > 50) ring.shift();
};
export const now = () => performance.now();
