// Native host for the engine's `#platform/env.ts` (remapped in metro.config.js).
import { Platform } from 'react-native';
import type { HostPlatform } from '@anatomy/engine/platform/contract/env.ts';

declare const __DEV__: boolean;

export const PLATFORM: HostPlatform = Platform.OS === 'android' ? 'android' : 'ios';
export const DEV: boolean = __DEV__;
export const log = (...args: unknown[]) => console.log(...args);
