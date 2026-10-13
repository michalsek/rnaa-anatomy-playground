// Adapted from BoneTideOSS (MIT, Konrad Reczko): the `#platform/*` seam. The engine imports
// host services only via `#platform/<name>.ts`; each host provides a file with this shape.
export type HostPlatform = 'web' | 'ios' | 'android' | 'node';

export declare const PLATFORM: HostPlatform;
/** Development build: enables extra validation and logging. */
export declare const DEV: boolean;
/** Host logger (the engine is built without DOM/Node libs, so it has no `console` type). */
export declare function log(...args: unknown[]): void;
