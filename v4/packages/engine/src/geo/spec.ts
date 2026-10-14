/**
 * JSON-serializable geometry specs. `buildGeo` turns one into a prototype (mesh + topology +
 * its own line sets, tagged 1..n locally); `geoKey` is the cache key, so a prototype used by
 * many parts or pool instances is built once.
 */
import type { FxName, Slot } from '../palette/tokens.ts';
import { type BandSpec, band } from './band.ts';
import { belt } from './belt.ts';
import { box } from './box.ts';
import { type Plan, extrude } from './extrude.ts';
import { type ProfilePoint, lathe } from './lathe.ts';
import type { Mesh, Vec3 } from './mesh.ts';
import { type Topology, buildTopology } from './topology.ts';
import { tube } from './tube.ts';

/** Procedural lines in a surface's uv space (around the axis: u in 0..1). */
export interface LineSetSpec {
  /** Lines per full turn of u. */
  count: number;
  /** Shift in line units (x = u·count − phase). */
  phase: number;
  /** Drawn line indices: first..last (inclusive, after wrapping into 0..count−1). */
  first: number;
  last: number;
  /** Every n-th line from `first` is a major (0 = none). */
  majorEvery: number;
  minor: Slot;
  major: Slot;
  /** CSS px at the fit zoom. */
  width: number;
  majorWidth: number;
  /** Facing range over which the lines fade in; equal values = no fade. */
  fade: readonly [number, number];
  /**
   * `sectors`: instead of lines, fill the first `duty` (0..1) of each period with the FX colour
   * `fill` (AA'd edges; `first`..`last` still pick the drawn periods). Default `lines`.
   */
  kind?: 'lines' | 'sectors';
  duty?: number;
  fill?: FxName;
}

export type GeoSpec =
  | { kind: 'box'; size: Vec3; center?: Vec3; r?: number; seams?: number[] }
  | { kind: 'extrude'; plan: Plan; z?: number; height: number; seams?: number[] }
  | {
      kind: 'lathe';
      profile: readonly ProfilePoint[];
      steps?: number;
      seams?: number[];
      marks?: number[];
      lineSets?: readonly { segment: number; lines: LineSetSpec }[];
      subdivisions?: number;
    }
  | {
      kind: 'tube';
      path: readonly Vec3[];
      radius: number;
      sides?: number;
      bend?: number;
      caps?: readonly [boolean, boolean];
      closed?: boolean;
    }
  | { kind: 'belt'; a: Vec3; ra: number; b: Vec3; rb: number; radius: number }
  | ({ kind: 'band'; lines?: { outer?: LineSetSpec; inner?: LineSetSpec } } & BandSpec);

export type GeoKind = GeoSpec['kind'];

export interface Prototype {
  key: string;
  /** Unique per cache entry (a rebuilt prototype gets a new one): a cheap key for pair caches. */
  id: number;
  mesh: Mesh;
  topology: Topology;
  /** Line sets of this prototype; triangle tag k refers to lineSets[k − 1]. */
  lineSets: LineSetSpec[];
  /** Model-space AABB. */
  min: Vec3;
  max: Vec3;
}

/** Stable JSON (sorted object keys), rounded to 1e-6 so float noise does not split caches. */
export function stableKey(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === 'number') return Math.round(v * 1e6) / 1e6;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : 1)),
      );
    }
    return v;
  });
}

export const geoKey = (spec: GeoSpec) => stableKey(spec);

export function buildMesh(spec: GeoSpec): { mesh: Mesh; lineSets: LineSetSpec[] } {
  switch (spec.kind) {
    case 'box':
      return { mesh: box(spec), lineSets: [] };
    case 'extrude':
      return { mesh: extrude(spec), lineSets: [] };
    case 'lathe': {
      const sets = spec.lineSets ?? [];
      const mesh = lathe({
        profile: spec.profile,
        ...(spec.steps !== undefined && { steps: spec.steps }),
        ...(spec.seams && { seams: spec.seams }),
        ...(spec.marks && { marks: spec.marks }),
        ...(spec.subdivisions !== undefined && { subdivisions: spec.subdivisions }),
        lineSets: sets.map(({ segment }, i) => ({ segment, set: i + 1 })),
      });
      return { mesh, lineSets: sets.map(({ lines }) => lines) };
    }
    case 'tube':
      return { mesh: tube(spec), lineSets: [] };
    case 'belt':
      return { mesh: belt(spec), lineSets: [] };
    case 'band': {
      const { kind: _kind, lines, ...rest } = spec;
      const sets: LineSetSpec[] = [];
      const outer = lines?.outer ? sets.push(lines.outer) : 0;
      const inner = lines?.inner ? sets.push(lines.inner) : 0;
      return { mesh: band(rest, { outer, inner }), lineSets: sets };
    }
  }
}

/** Prototype cache, keyed by `geoKey`. CPU data only; bounded so edits don't leak forever. */
const cache = new Map<string, Prototype>();
const CACHE_LIMIT = 1024;
let nextId = 1;

export function buildGeo(spec: GeoSpec): Prototype {
  const key = geoKey(spec);
  const hit = cache.get(key);
  if (hit) return hit;
  const { mesh, lineSets } = buildMesh(spec);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i++) {
    const k = i % 3;
    min[k] = Math.min(min[k]!, mesh.positions[i]!);
    max[k] = Math.max(max[k]!, mesh.positions[i]!);
  }
  const proto: Prototype = { key, id: nextId++, mesh, topology: buildTopology(mesh), lineSets, min, max };
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, proto);
  return proto;
}
