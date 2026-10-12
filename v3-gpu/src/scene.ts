// Renderer-facing scene, decoupled from any file format. The fixture (src/fixture) and the M1 display list
// (src/dl-loader.ts) both produce a GpuScene; the renderer only ever sees this.

/** One node of a probe's class chain: the element is recreated in the page so the CSS cascade resolves it. */
export interface ChainNode {
  tag: string;
  attrs: Record<string, string>;
}

/** Colour source resolved in the DOM (getComputedStyle) — re-resolved on every theme change. */
export type PaintDesc =
  | { kind: 'probe'; prop: 'fill' | 'stroke'; chain: ChainNode[]; alpha?: number }
  | {
      kind: 'linear';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      units?: string;
      stops: { offset: number; chain: ChainNode[]; alpha?: number }[];
      chain: ChainNode[];
      /** Markup alpha multiplied into the resolved colour. */
      alpha?: number;
    };

export interface SceneItem {
  name: string;
  /** Painter's key; the frame order is key + lift·share (stable for ties). */
  key: number;
  lift: number;
  /** Screen translation (viewBox units) per unit of share — the explode vector. */
  move: [number, number];
  /** Number of primitive depth slots this item uses (max layer + 1). */
  layers: number;
}

/** A filled element: `count` triangle-list vertices starting at `first` in `tris`. */
export interface FillElem {
  item: number;
  layer: number;
  paint: number;
  first: number;
  count: number;
  special?: 'halo';
}

/** A stroked element: polylines [start, count, closed] into `points`; width from CSS unless given (CSS px). */
export interface StrokeElem {
  item: number;
  layer: number;
  paint: number;
  polys: [number, number, number][];
  width?: number;
  /** A fill element that may or may not carry a CSS stroke (seamless tone strokes); dropped when it has none. */
  optional?: boolean;
  /** Extra element alpha (multiplied with the probed alpha). */
  alpha?: number;
  /** Caps of open polylines (joins are always round in the kit). Default round. */
  cap?: 'round' | 'butt';
}

export interface DotElem {
  item: number;
  layer: number;
  paint: number;
  x: number;
  y: number;
  r: number;
  alpha: number;
}

export interface GpuScene {
  viewBox: [number, number, number, number];
  svgClass: string;
  /** Ancestors every item sits under in the SVG page (e.g. `<g class="fx-parts">`), for probes. */
  chainPrefix: ChainNode[];
  items: SceneItem[];
  paints: PaintDesc[];
  tris: Float32Array;
  fills: FillElem[];
  points: Float32Array;
  strokes: StrokeElem[];
  dots: DotElem[];
}

function decodeBase64(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Wire format of src/fixture (JSON with base64 Float32 arrays). */
export function sceneFromWire(wire: any): GpuScene {
  return {
    viewBox: wire.viewBox,
    svgClass: wire.svgClass ?? 'iso-svg',
    chainPrefix: wire.chainPrefix ?? [],
    items: wire.items,
    paints: wire.paints,
    tris: new Float32Array(decodeBase64(wire.tris)),
    fills: wire.fills,
    points: new Float32Array(decodeBase64(wire.points)),
    strokes: wire.strokes,
    dots: wire.dots,
  };
}

/** Frame order: indices sorted by key + lift·share, ties by export index (stable). */
export function orderOf(items: SceneItem[], share: number): Uint32Array {
  const idx = Array.from(items, (_, i) => i);
  idx.sort((a, b) => items[a].key + items[a].lift * share - (items[b].key + items[b].lift * share) || a - b);
  return Uint32Array.from(idx);
}
