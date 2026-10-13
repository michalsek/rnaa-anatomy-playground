// Renderer-facing scene, decoupled from any file format. The M1 display list (dl-loader.ts) and the fixture wire format
// (sceneFromWire, src/fixture) both produce a GpuScene; the renderer only ever sees this.
import type { ChainNode, PaintDesc } from './paint.ts';

export interface SceneItem {
  name: string;
  /** Painter's key; the frame order is key + lift · share (ties keep the export order). */
  key: number;
  lift: number;
  /** Screen translation (viewBox units) per unit of share: the explode vector. */
  move: [number, number];
  /** Depth slots this item uses (max layer + 1). */
  layers: number;
}

/** A filled element: `count` triangle-list vertices starting at vertex `first` of `tris`. */
export interface FillElem {
  item: number;
  layer: number;
  paint: number;
  /** Markup alpha (opacity attributes), multiplied with the paint's CSS alpha. */
  alpha: number;
  first: number;
  count: number;
  /** A CSS-blurred halo silhouette (drawn through the halo effect, not as a fill). */
  halo?: boolean;
}

/** A stroked element: polylines [first point, point count, closed] into `points`. */
export interface StrokeElem {
  item: number;
  layer: number;
  paint: number;
  alpha: number;
  polys: [number, number, boolean][];
  /** CSS px; 0 → the paint's computed stroke-width. */
  width: number;
  /** Caps of open polylines; undefined → the paint's computed stroke-linecap. Joins are always round. */
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

/** A paint of the scene's palette: `key` dedupes it against paints discovered later (live slots). */
export interface ScenePaint {
  key: string;
  desc: PaintDesc;
}

export interface GpuScene {
  viewBox: [number, number, number, number];
  /** Class of the probe host <svg> (the element the figure's CSS targets). */
  svgClass: string;
  items: SceneItem[];
  /** Palette in id order: fills / strokes / dots reference these ids. */
  palette: ScenePaint[];
  tris: Float32Array;
  fills: FillElem[];
  points: Float32Array;
  strokes: StrokeElem[];
  dots: DotElem[];
}

export function decodeBase64(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Frame order: item indices sorted by key + lift · share, ties by index (stable); written into `out`. */
export function orderOf(items: SceneItem[], share: number, out: Uint32Array<ArrayBuffer> = new Uint32Array(items.length)): Uint32Array<ArrayBuffer> {
  for (let i = 0; i < items.length; i++) out[i] = i;
  const keyOf = (i: number) => items[i].key + items[i].lift * share;
  out.sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    return ka === kb ? a - b : ka - kb;
  });
  return out;
}

// ---- fixture wire format (src/fixture/svg2scene.mjs: JSON with base64 Float32 arrays) ------------------------------

type WireProbe = { kind: 'probe'; prop: 'fill' | 'stroke'; chain: ChainNode[] };
type WireLinear = { kind: 'linear'; x1: number; y1: number; x2: number; y2: number; units?: string; chain: ChainNode[]; stops: { offset: number; chain: ChainNode[] }[] };
interface WireScene {
  viewBox: [number, number, number, number];
  svgClass?: string;
  chainPrefix?: ChainNode[];
  items: SceneItem[];
  paints: (WireProbe | WireLinear)[];
  tris: string;
  points: string;
  fills: { item: number; layer: number; paint: number; first: number; count: number; special?: 'halo' }[];
  strokes: { item: number; layer: number; paint: number; polys: [number, number, number][] }[];
  dots: DotElem[];
}

export function sceneFromWire(wire: WireScene): GpuScene {
  const prefix = wire.chainPrefix ?? [];
  const palette: ScenePaint[] = [];
  const probeId = new Map<string, number>();
  const probe = (prop: 'fill' | 'stroke' | 'stop-color', chain: ChainNode[]) => {
    const ancestors = [...prefix, ...chain.slice(0, -1)];
    const el = chain[chain.length - 1];
    const key = JSON.stringify([prop, ancestors, el]);
    let id = probeId.get(key);
    if (id === undefined) {
      id = palette.length;
      palette.push({ key, desc: { kind: 'probe', prop, ancestors, el } });
      probeId.set(key, id);
    }
    return id;
  };
  const idOfWire = wire.paints.map((paint, index) => {
    if (paint.kind === 'probe') return probe(paint.prop, paint.chain);
    if ((paint.units ?? 'userSpaceOnUse') !== 'userSpaceOnUse') throw new Error(`scene: gradient units ${paint.units} not supported`);
    const own = probe('fill', paint.chain);
    const stops = paint.stops.map((stop) => ({ offset: stop.offset, alpha: 1, paint: probe('stop-color', stop.chain) }));
    const id = palette.length;
    palette.push({ key: `wire-gradient:${index}`, desc: { kind: 'linear', x1: paint.x1, y1: paint.y1, x2: paint.x2, y2: paint.y2, paint: own, stops } });
    return id;
  });
  return {
    viewBox: wire.viewBox,
    svgClass: wire.svgClass ?? 'iso-svg',
    items: wire.items,
    palette,
    tris: new Float32Array(decodeBase64(wire.tris)),
    fills: wire.fills.map(({ item, layer, paint, first, count, special }) => ({ item, layer, paint: idOfWire[paint], alpha: 1, first, count, halo: special === 'halo' })),
    points: new Float32Array(decodeBase64(wire.points)),
    strokes: wire.strokes.map(({ item, layer, paint, polys }) => ({ item, layer, paint: idOfWire[paint], alpha: 1, width: 0, polys: polys.map(([first, count, closed]) => [first, count, !!closed] as [number, number, boolean]) })),
    dots: wire.dots.map((dot) => ({ ...dot, paint: idOfWire[dot.paint] })),
  };
}
