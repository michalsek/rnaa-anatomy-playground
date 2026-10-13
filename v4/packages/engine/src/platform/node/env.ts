// Node host (unit tests). Resolved through package.json#imports.
import type { HostPlatform } from '../contract/env.ts';

export const PLATFORM: HostPlatform = 'node';
export const DEV = true;
export const log = (...args: unknown[]) => console.log(...args);
