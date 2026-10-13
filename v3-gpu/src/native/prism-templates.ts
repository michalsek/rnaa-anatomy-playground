// Rigid prism templates: the plan rings native parts are made of (part-local x, y), each triangulated once on the CPU.
// A part turns and moves its template rigidly and the projection is affine, so the template's triangulation stays a
// triangulation of the drawn top face for every pose: no convex-fan assumption, any simple ring.
import earcut from 'earcut';
import { classWordsOf } from './kit-mirror.ts';

/** Where a template lives in the GPU tables, and what one part made of it needs. */
export interface PrismTemplate {
  ringFirst: number;
  ringCount: number;
  /** First index (into the triangle index table) and triangle count of the top face. */
  triangleFirst: number;
  triangleCount: number;
  /** Words of the part's class record (kit-mirror classWordsOf). */
  classWords: number;
  /** Seg records of one part (segSlotsOf). */
  segSlots: number;
  /** Fill vertices of one part (vertexSlotsOf). */
  vertexSlots: number;
}

/**
 * Seg slots of a part with an n-point ring: crease, bevel, back top, front bottom, verticals, band (n each), strap
 * (rotor-shaders.ts block order).
 */
export const segSlotsOf = (ringCount: number) => 6 * ringCount + 1;
/** Fill vertices of a part: the top face's triangles and two triangles per side face. */
export const vertexSlotsOf = (ringCount: number, triangleCount: number) => 3 * (triangleCount + 2 * ringCount);

/** Largest ring a template may have (the GPU walks runs per thread: keeps one part's work bounded). */
export const MAX_TEMPLATE_RING = 1024;

export class PrismTemplates {
  /** Ring points of every template, part-local (x, y) pairs, f64 (the CPU model builds world rings from these). */
  private points: number[] = [];
  private triangleIndices: number[] = [];
  private readonly list: PrismTemplate[] = [];

  /** Registers a ring (closed, ≥ 3 points, simple); throws when it cannot be drawn as a prism top. */
  add(ring: readonly (readonly [number, number])[]): PrismTemplate {
    if (ring.length < 3 || ring.length > MAX_TEMPLATE_RING) throw new Error(`prism template: ${ring.length} ring points (3…${MAX_TEMPLATE_RING})`);
    const flat = ring.flat();
    const triangles = earcut(flat);
    if (triangles.length / 3 !== ring.length - 2) throw new Error(`prism template: the ring triangulates into ${triangles.length / 3} triangles, not ${ring.length - 2} (repeated or collinear points, or self-intersecting)`);
    const template: PrismTemplate = {
      ringFirst: this.points.length / 2,
      ringCount: ring.length,
      triangleFirst: this.triangleIndices.length,
      triangleCount: triangles.length / 3,
      classWords: classWordsOf(ring.length),
      segSlots: segSlotsOf(ring.length),
      vertexSlots: vertexSlotsOf(ring.length, triangles.length / 3),
    };
    this.points.push(...flat);
    this.triangleIndices.push(...triangles);
    this.list.push(template);
    return template;
  }

  get templates(): readonly PrismTemplate[] {
    return this.list;
  }

  /** f64 ring points (x, y pairs) of every template. */
  ring64(): Float64Array {
    return new Float64Array(this.points);
  }

  /** The GPU ring table (vec2f per point). */
  ring32(): Float32Array<ArrayBuffer> {
    return new Float32Array(this.points);
  }

  /** The GPU triangle table: ring-local point indices, three per triangle. */
  triangles(): Uint32Array<ArrayBuffer> {
    return new Uint32Array(this.triangleIndices);
  }
}
