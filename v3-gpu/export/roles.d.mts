import type { SvgElement } from "./svgsub.mjs";
export interface StrokeGeometry {
  width: number;
  cap: "round" | "butt";
  join: "round" | "miter";
}
export interface Role {
  fill: boolean;
  stroke: StrokeGeometry | null;
  special: { halo?: boolean; blend?: boolean; seamless?: boolean };
}
export declare function roleOf(element: SvgElement & { chain: SvgElement[] }): Role;
export declare const ROLE_PROBES: { ancestors: SvgElement[]; el: SvgElement }[];
