import type { Subpath } from "./svgsub.mjs";
export declare const CIRCLE_STEPS: number;
export declare function ringOfCircle(cx: number, cy: number, r: number): number[][];
export declare function polylinesOf(subpaths: Subpath[], cap: string): { points: number[][]; closed: boolean }[];
