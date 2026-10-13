// Web host for the engine's `#platform/env.ts` (remapped in metro.config.js).
import type { HostPlatform } from '@anatomy/engine/platform/contract/env.ts';

declare const __DEV__: boolean;

export const PLATFORM: HostPlatform = 'web';
export const DEV: boolean = __DEV__;
export const log = (...args: unknown[]) => console.log(...args);
