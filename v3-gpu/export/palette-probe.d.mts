import type { DlChainNode } from "./dl-format.mjs";
export interface ProbeEntry {
  prop: "fill" | "stroke" | "stop-color";
  ancestors: DlChainNode[];
  el: DlChainNode;
}
export interface ProbeResult {
  prop: string;
  raw: string;
  color: [number, number, number, number] | null;
  alpha: number;
  width: number;
  cap: string;
  join: string;
  blend: string;
  filter: string;
  transform: string;
  other: string;
  fillRule: string;
  dashArray: string;
  clipPath: string;
  mask: string;
}
export declare function parseColor(text: string): [number, number, number, number] | null;
export declare function resolvePalette(palette: ProbeEntry[], host: Element): ProbeResult[];
