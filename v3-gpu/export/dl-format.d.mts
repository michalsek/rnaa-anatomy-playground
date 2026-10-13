// Type declarations for dl-format.mjs (the TypeScript renderer imports the module directly).

type Fields<T extends string> = Record<T, number>;

export declare const MAGIC: number;
export declare const VERSION: number;
export declare const SECTION_ALIGN: number;
export declare const HEADER_BYTES: number;
export declare const LAYOUTS: Record<SectionName, { stride: number; fields: [string, "f" | "u"][] }>;
export type SectionName = "prims" | "fillVertices" | "fillIndices" | "segments" | "dots";
export declare const SECTIONS: SectionName[];
export declare const FIELD_WORD: {
  prims: Fields<"kind" | "item" | "layer" | "paint" | "alpha" | "first" | "count" | "flags">;
  fillVertices: Fields<"x" | "y" | "item" | "paint" | "layer" | "alpha">;
  fillIndices: Fields<"index">;
  segments: Fields<"x0" | "y0" | "x1" | "y1" | "item" | "paint" | "layer" | "alpha" | "width" | "flags" | "prim" | "pad">;
  dots: Fields<"cx" | "cy" | "r" | "item" | "paint" | "layer" | "alpha" | "prim">;
};
export declare const STRIDE_WORDS: Record<SectionName, number>;
export declare const PRIM_KIND: { fill: 0; stroke: 1; dot: 2 };
export declare const PRIM_FLAG: { halo: 1; blend: 2; gradient: 4; seamless: 8; groupOpacity: 16 };
export declare const SEG_FLAG: { start: 1; end: 2; closed: 4; capRound: 8; joinRound: 16; widthOverride: 32 };
export declare const PAINT_GRADIENT: number;
export declare function gradientPaint(index: number): number;
export declare function isGradientPaint(paintId: number): boolean;
export declare function gradientIndexOf(paintId: number): number;

export interface DlSection {
  name: SectionName;
  offset: number;
  byteLength: number;
  count: number;
  stride: number;
  f32: Float32Array;
  u32: Uint32Array;
}
export declare function sectionsOf(source: ArrayBuffer | ArrayBufferView): Record<SectionName, DlSection>;
export declare function pack(sections: Record<SectionName, unknown[]>): { buffer: ArrayBuffer; table: Omit<DlSection, "f32" | "u32">[] };
export declare function recordAt(section: DlSection, index: number): Record<string, number>;

/** A probe recipe node (export/build-dl.mjs probeNode). */
export interface DlChainNode {
  tag: string;
  attrs: Record<string, string>;
}

/** The display list's JSON half (notes/DL-FORMAT.md). */
export interface DlJson {
  format: "rnaa-dl";
  version: number;
  scene: string;
  viewBox: [number, number, number, number];
  items: { index: number; name: string; piece: string; key: number | null; lift: number; rank: number; material: string; prims: [number, number]; flags: string[]; back?: boolean }[];
  slots: { name: string; side: "after" | "before"; anchor: number; insertAt: number; rank: number; targets: string[]; seq: number }[];
  palette: { id: number; prop: "fill" | "stroke" | "stop-color"; ancestors: DlChainNode[]; el: DlChainNode; alphaAttrs: { at: number; name: string }[] }[];
  gradients: { id: string; units: string; x1: number; y1: number; x2: number; y2: number; paint: number; stops: { offset: number; alpha: number; paint: number }[] }[];
  sections: Omit<DlSection, "f32" | "u32">[];
  counts: Record<string, number>;
}
