// GpuScene + paint classes → the static scene's GPU records and per-item draw entries. Pure CPU (Node-testable).
// Opaque fills go to one vertex run (drawn with depth writes, order-independent); every other primitive becomes a
// draw entry of its item, in layer order, with conservative bounds for the static cache partition.
import { FillWriter } from './fills.ts';
import { isOpaqueAlpha, type BlendMode, type PaintTable } from './paint.ts';
import type { GpuScene } from './scene.ts';
import { SegWriter } from './strokes.ts';

/** Axis-aligned box in viewBox units (item-relative: the explode offset is applied when it is placed). */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const emptyBox = (): Box => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
export const isEmptyBox = (box: Box) => !(box.x1 >= box.x0 && box.y1 >= box.y0);
export function growBox(box: Box, x: number, y: number, pad = 0) {
  if (x - pad < box.x0) box.x0 = x - pad;
  if (y - pad < box.y0) box.y0 = y - pad;
  if (x + pad > box.x1) box.x1 = x + pad;
  if (y + pad > box.y1) box.y1 = y + pad;
}
export function unionBox(into: Box, box: Box) {
  if (box.x0 < into.x0) into.x0 = box.x0;
  if (box.y0 < into.y0) into.y0 = box.y0;
  if (box.x1 > into.x1) into.x1 = box.x1;
  if (box.y1 > into.y1) into.y1 = box.y1;
}

/**
 * A blended draw of one primitive. `bounds` cover its geometry in viewBox units; strokes add `halfWidth` (CSS px,
 * converted with the current DPR) and every entry an anti-aliasing margin when the partition places it.
 */
export type StaticEntry =
  | { kind: 'segs'; layer: number; first: number; count: number; blend: BlendMode; bounds: Box; halfWidth: number }
  | { kind: 'fill'; layer: number; first: number; count: number; blend: BlendMode; bounds: Box; halfWidth: 0 }
  | { kind: 'halo'; layer: number; halo: number; bounds: Box; halfWidth: 0 };

export interface HaloPrim {
  item: number;
  layer: number;
  paint: number;
  /** Vertex range in `haloVertices`. */
  first: number;
  count: number;
  /** Silhouette bounds (viewBox units, before blur and shift). */
  bounds: Box;
}

/** An opaque fill's vertex run in `StaticGeometry.opaque`. */
export interface OpaqueFill {
  item: number;
  first: number;
  count: number;
  bounds: Box;
}

export interface StaticGeometry {
  segs: SegWriter;
  opaque: FillWriter;
  opaqueFills: OpaqueFill[];
  blended: FillWriter;
  haloVertices: FillWriter;
  halos: HaloPrim[];
  /** Blended entries per item, sorted by layer. */
  entries: StaticEntry[][];
}

export function buildStaticGeometry(scene: GpuScene, paints: PaintTable): StaticGeometry {
  const segs = new SegWriter(Math.max(64, scene.points.length));
  const opaque = new FillWriter(Math.max(64, scene.tris.length / 2));
  const blended = new FillWriter();
  const haloVertices = new FillWriter();
  const halos: HaloPrim[] = [];
  const opaqueFills: OpaqueFill[] = [];
  const entries: StaticEntry[][] = scene.items.map(() => []);
  const tris = scene.tris;

  const fillBounds = (first: number, count: number) => {
    const box = emptyBox();
    for (let v = first; v < first + count; v++) growBox(box, tris[v * 2], tris[v * 2 + 1]);
    return box;
  };
  for (const fill of scene.fills) {
    const paint = paints.classes[fill.paint];
    if (!paint.visible || fill.alpha <= 0) continue;
    if (fill.halo) {
      const first = haloVertices.triangles(tris, fill.first, fill.count, fill.item, fill.paint, fill.layer, fill.alpha);
      const bounds = fillBounds(fill.first, fill.count);
      halos.push({ item: fill.item, layer: fill.layer, paint: fill.paint, first, count: fill.count, bounds });
      entries[fill.item].push({ kind: 'halo', layer: fill.layer, halo: halos.length - 1, bounds: { ...bounds }, halfWidth: 0 });
    } else if (paint.opaque && isOpaqueAlpha(fill.alpha)) {
      const first = opaque.triangles(tris, fill.first, fill.count, fill.item, fill.paint, fill.layer, fill.alpha);
      opaqueFills.push({ item: fill.item, first, count: fill.count, bounds: fillBounds(fill.first, fill.count) });
    } else {
      const first = blended.triangles(tris, fill.first, fill.count, fill.item, fill.paint, fill.layer, fill.alpha);
      entries[fill.item].push({ kind: 'fill', layer: fill.layer, first, count: fill.count, blend: paint.blend, bounds: fillBounds(fill.first, fill.count), halfWidth: 0 });
    }
  }

  // Strokes and dots: per item in layer order, so an item's stroke records are contiguous and a painter-ordered draw
  // list can merge consecutive entries into one instanced draw.
  type StrokePrim = { layer: number; emit: () => { bounds: Box; halfWidth: number; blend: BlendMode } | null };
  const prims: StrokePrim[][] = scene.items.map(() => []);
  const points = scene.points;
  for (const stroke of scene.strokes) {
    const paint = paints.classes[stroke.paint];
    if (!paint.visible || stroke.alpha <= 0) continue;
    prims[stroke.item].push({
      layer: stroke.layer,
      emit: () => {
        const resolved = paints.resolved[stroke.paint];
        const cap = stroke.cap ?? (resolved.cap === 'butt' ? 'butt' : 'round');
        const width = stroke.width || resolved.width;
        const bounds = emptyBox();
        for (const [first, count, closed] of stroke.polys) {
          segs.polyline(points, first, count, closed, cap, { width: stroke.width, item: stroke.item, paint: stroke.paint, layer: stroke.layer, alpha: stroke.alpha });
          for (let p = first; p < first + count; p++) growBox(bounds, points[p * 2], points[p * 2 + 1]);
        }
        return { bounds, halfWidth: width / 2, blend: paint.blend };
      },
    });
  }
  for (const dot of scene.dots) {
    const paint = paints.classes[dot.paint];
    if (!paint.visible || dot.alpha <= 0) continue;
    prims[dot.item].push({
      layer: dot.layer,
      emit: () => {
        segs.dot(dot.x, dot.y, dot.r, { item: dot.item, paint: dot.paint, layer: dot.layer, alpha: dot.alpha });
        const bounds = emptyBox();
        growBox(bounds, dot.x, dot.y, dot.r);
        return { bounds, halfWidth: 0, blend: paint.blend };
      },
    });
  }
  prims.forEach((list, item) => {
    list.sort((a, b) => a.layer - b.layer);
    for (const prim of list) {
      const first = segs.count;
      const emitted = prim.emit();
      if (!emitted || segs.count === first) continue;
      entries[item].push({ kind: 'segs', layer: prim.layer, first, count: segs.count - first, ...emitted });
    }
    entries[item].sort((a, b) => a.layer - b.layer);
  });
  return { segs, opaque, opaqueFills, blended, haloVertices, halos, entries };
}
