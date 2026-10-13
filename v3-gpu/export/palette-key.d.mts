import type { DlChainNode } from "./dl-format.mjs";
export declare const PROBE_KEY_IGNORED_ATTRS: Set<string>;
export declare function probeNode(node: { tag: string; attrs: Record<string, string> }): DlChainNode;
export declare function paintKeyOf(prop: "fill" | "stroke" | "stop-color", ancestors: DlChainNode[], el: DlChainNode): string;
