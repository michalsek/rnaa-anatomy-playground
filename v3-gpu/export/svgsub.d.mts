export interface SvgElement {
  tag: string;
  attrs: Record<string, string>;
}
export interface SvgNode extends SvgElement {
  children: SvgNode[];
}
export interface Subpath {
  points: number[][];
  closed: boolean;
  drawn: boolean;
}
export declare const OPACITY_ATTRS: string[];
export declare function attrsOf(tag: string, source: string): Record<string, string>;
export declare function scanTags(markup: string, handlers: { open(tag: string, attrSource: string, selfClosing: boolean, raw: string): void; close(tag: string): void }): void;
export declare function parseSvg(markup: string): SvgNode;
export declare function numberAttr(node: SvgElement, name: string, fallback: number, units?: { percent?: boolean; px?: boolean }): number;
export declare function opacityAttr(node: SvgElement, name: string): number;
export declare function styleOf(node: SvgElement): Record<string, string>;
export declare function strokeWidthOf(node: SvgElement): number | undefined;
export declare function parsePathData(d: string): Subpath[];
export declare function drawnLeafCount(node: SvgNode): number;
export declare function urlRef(value: string | undefined): string | null;
