/**
 * SceneStore: the registry the React blocks (or any authoring code) write into, and the
 * renderer reads from. No React, no GPU.
 *
 * - Nodes have stable dotted ids. Groups carry transforms (and, with `moves`, a motion that
 *   animation code sets per frame); parts are static geometry; pools are instanced geometry;
 *   marks are free dots and segments.
 * - Registration order does not matter: parents are resolved at `build()`. Unknown parents,
 *   duplicate ids and unknown handles throw.
 * - `build()` merges every part into one static batch (instance slot k per part) and gives each
 *   pool its own batch. `flatten()` writes the instance table (world matrices + styles), only
 *   recomputing below nodes that changed.
 */
import { mat4, vec3 } from 'wgpu-matrix';
import type { Bounds } from '../camera/camera.ts';
import { contactSegments } from '../geo/contact.ts';
import type { Vec3 } from '../geo/mesh.ts';
import { type GeoKind, type GeoSpec, type LineSetSpec, type Prototype, buildGeo } from '../geo/spec.ts';
import { FLAG, NO_NEIGHBOUR, triangleCountOf } from '../geo/topology.ts';
import { DOT_OPACITY, type LineTone, MATERIAL, type Material, SLOT } from '../palette/tokens.ts';
import { INSTANCE, INSTANCE_FLOATS, MARK, SIZES, TONE_RULE, VERTEX_FLOATS } from '../render/schemas.ts';

export type Token = number;

/** Euler rotation in degrees, applied X then Y then Z: local = T · Rz · Ry · Rx · S. */
export interface Transform {
  position?: Vec3;
  rotation?: Vec3;
  scale?: number;
}

export type ToneRule = keyof typeof TONE_RULE;

export interface StyleSpec {
  material: Material;
  /** Outline tone (default `mid`). */
  outline?: LineTone;
  /** Crease tone (default `faint`). */
  crease?: LineTone;
  /** Edge line width, CSS px at the fit zoom (default 0.6). */
  width?: number;
  /** Default: plan for box/extrude, tube for tube/belt, bands for lathe. */
  tone?: ToneRule;
}

export type DotTone = keyof typeof DOT_OPACITY;

export interface DotSpec {
  at: Vec3;
  /** Radius, CSS px at the fit zoom (default 0.6). */
  size?: number;
  tone?: DotTone;
  /** Surface normal: hidden on back sides and faded toward limbs. Omit to always show. */
  normal?: Vec3;
  fade?: readonly [number, number];
}

export interface SegmentSpec {
  a: Vec3;
  b: Vec3;
  /** CSS px at the fit zoom (default 0.6). */
  width?: number;
  tone?: LineTone;
  normal?: Vec3;
  fade?: readonly [number, number];
}

export interface MarksSpec {
  material: Material;
  dots?: readonly DotSpec[];
  segments?: readonly SegmentSpec[];
}

export interface FrameInfo {
  /** Scene time and step, seconds (step clamped by the shell). */
  t: number;
  dt: number;
  reduced: boolean;
}

export interface GroupHandle {
  readonly id: string;
  /** Motion on top of the rest transform: local = rest · motion. */
  set(t: Transform): void;
  /** Motion = a rotation about a local axis. */
  spin(axis: 'x' | 'y' | 'z', rad: number): void;
}

export interface PoolHandle {
  readonly id: string;
  readonly capacity: number;
  /** Instances 0..count−1 are drawn. */
  count: number;
  /** Instance pose in the pool's frame: a position and a yaw about z (radians). */
  pose(i: number, p: Vec3, yaw?: number): void;
  /** Instance style: an index into the pool's `styles`. */
  style(i: number, k: number): void;
}

export interface SceneBuild {
  /** 12 floats per vertex (GpuVertex). */
  vertices: Float32Array;
  vertexCount: number;
  /** 12 words per triangle (GpuTri). */
  tris: ArrayBuffer;
  triCount: number;
  /** Draws: the static batch (one instance) first, then one per pool. */
  /** `open`: the geometry has boundary edges, so it is drawn without culling (inner walls). */
  batches: { firstTri: number; triCount: number; firstInstance: number; pool: string | null; open: boolean }[];
  instanceCount: number;
  /** 8 words per style (Style). */
  styles: ArrayBuffer;
  styleCount: number;
  lineSets: LineSetSpec[];
  /** 16 words per mark (Mark). */
  marks: ArrayBuffer;
  markCount: number;
  bounds: Bounds;
  stats: { parts: number; pools: number; triangles: number; instances: number; marks: number; contacts: number };
}

type NodeKind = 'group' | 'part' | 'pool' | 'marks';

interface NodeBase {
  kind: NodeKind;
  id: string;
  token: Token;
  parent: string | null;
  rest: Float32Array;
  moves: boolean;
  motion: Float32Array | null;
  world: Float32Array;
  dirty: boolean;
}
interface GroupNode extends NodeBase {
  kind: 'group';
}
interface PartNode extends NodeBase {
  kind: 'part';
  geo: GeoSpec;
  style: StyleSpec;
  contacts: boolean;
}
interface PoolNode extends NodeBase {
  kind: 'pool';
  geo: GeoSpec;
  styles: StyleSpec[];
  capacity: number;
  marks: MarksSpec | null;
  count: number;
  /** x, y, z, yaw per instance. */
  poses: Float32Array;
  styleOf: Uint16Array;
  poolDirty: boolean;
}
interface MarksNode extends NodeBase {
  kind: 'marks';
  spec: MarksSpec;
}
type Node = GroupNode | PartNode | PoolNode | MarksNode;

const DEFAULT_TONE: Record<GeoKind, ToneRule> = {
  box: 'plan',
  extrude: 'plan',
  lathe: 'bands',
  tube: 'tube',
  belt: 'tube',
};
const DEFAULT_FADE = [0.04, 0.42] as const;

export function transformMatrix(t: Transform | undefined, out = mat4.identity()) {
  mat4.identity(out);
  if (!t) return out;
  const scale = t.scale ?? 1;
  if (!(scale > 0) || !Number.isFinite(scale)) throw new Error(`transform: bad scale ${scale}`);
  const [rx, ry, rz] = (t.rotation ?? [0, 0, 0]).map((deg) => (deg * Math.PI) / 180) as [number, number, number];
  mat4.translation(t.position ?? [0, 0, 0], out);
  mat4.rotateZ(out, rz, out);
  mat4.rotateY(out, ry, out);
  mat4.rotateX(out, rx, out);
  if (scale !== 1) mat4.uniformScale(out, scale, out);
  return out;
}

const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] } as const;

const BOUNDARY_BITS = FLAG.boundary(0) | FLAG.boundary(1) | FLAG.boundary(2);
const openCache = new WeakMap<Prototype, boolean>();
/** Whether a prototype has open boundaries (its inside can be seen). */
function isOpen(proto: Prototype): boolean {
  let open = openCache.get(proto);
  if (open === undefined) {
    open = proto.topology.flags.some((f) => (f & BOUNDARY_BITS) !== 0);
    openCache.set(proto, open);
  }
  return open;
}

interface Built {
  version: number;
  /** Parents first. */
  order: Node[];
  /** Static instance slot per part / marks node. */
  slot: Map<string, number>;
  /** Style index per part; style base per pool. */
  style: Map<string, number>;
  poolBase: Map<string, number>;
  instanceCount: number;
}

export class SceneStore {
  private nodes = new Map<string, Node>();
  private nextToken = 1;
  private frameCallbacks = new Set<(f: FrameInfo) => void>();
  private built: Built | null = null;
  private f32 = new Float32Array(0);
  private u32 = new Uint32Array(this.f32.buffer);
  private dirtyAny = true;
  private contactCache = new Map<string, Float32Array>();
  readonly motion = { reduced: false };
  version = 0;

  // ---- registration ----------------------------------------------------------------------

  group(id: string, o: { parent?: string; transform?: Transform; moves?: boolean } = {}): Token {
    return this.add({ ...this.base('group', id, o.parent, o.transform), moves: o.moves ?? false, kind: 'group' });
  }

  part(
    id: string,
    o: { parent?: string; geo: GeoSpec; style: StyleSpec; transform?: Transform; contacts?: boolean },
  ): Token {
    return this.add({
      ...this.base('part', id, o.parent, o.transform),
      kind: 'part',
      geo: o.geo,
      style: o.style,
      contacts: o.contacts ?? true,
    });
  }

  pool(
    id: string,
    o: {
      parent?: string;
      geo: GeoSpec;
      styles: StyleSpec[];
      capacity: number;
      marks?: MarksSpec;
      transform?: Transform;
    },
  ): Token {
    if (!(o.capacity > 0) || !Number.isInteger(o.capacity)) throw new Error(`pool "${id}": bad capacity ${o.capacity}`);
    if (!o.styles.length) throw new Error(`pool "${id}": needs at least one style`);
    return this.add({
      ...this.base('pool', id, o.parent, o.transform),
      kind: 'pool',
      geo: o.geo,
      styles: o.styles,
      capacity: o.capacity,
      marks: o.marks ?? null,
      count: 0,
      poses: new Float32Array(o.capacity * 4),
      styleOf: new Uint16Array(o.capacity),
      poolDirty: true,
    });
  }

  marks(id: string, o: { parent?: string; transform?: Transform } & MarksSpec): Token {
    const { parent, transform, ...spec } = o;
    return this.add({ ...this.base('marks', id, parent, transform), kind: 'marks', spec });
  }

  /** Remove a node; a no-op unless `token` is the node's current one (StrictMode, Fast Refresh). */
  remove(id: string, token: Token): void {
    const node = this.nodes.get(id);
    if (!node || node.token !== token) return;
    this.nodes.delete(id);
    this.version++;
  }

  private base(kind: NodeKind, id: string, parent: string | undefined, transform: Transform | undefined) {
    if (!id) throw new Error(`${kind}: empty id`);
    return {
      id,
      token: this.nextToken++,
      parent: parent ?? null,
      rest: transformMatrix(transform),
      moves: false,
      motion: null,
      world: mat4.identity(),
      dirty: true,
    };
  }

  private add(node: Node): Token {
    if (this.nodes.has(node.id)) throw new Error(`duplicate id "${node.id}"`);
    this.nodes.set(node.id, node);
    this.version++;
    return node.token;
  }

  // ---- handles ---------------------------------------------------------------------------

  /** A handle on a moving group or a pool. Throws for unknown ids. */
  node(id: string): GroupHandle | PoolHandle {
    const node = this.lookup(id);
    if (node.kind === 'pool') return this.poolHandle(id);
    if (node.kind === 'group') {
      if (!node.moves) throw new Error(`group "${id}" is not declared with moves`);
      return this.groupHandle(id);
    }
    throw new Error(`"${id}" is a ${node.kind}; only moving groups and pools have handles`);
  }

  group$(id: string): GroupHandle {
    const h = this.node(id);
    if (!('spin' in h)) throw new Error(`"${id}" is not a group`);
    return h;
  }

  pool$(id: string): PoolHandle {
    const h = this.node(id);
    if (!('pose' in h)) throw new Error(`"${id}" is not a pool`);
    return h;
  }

  private lookup(id: string): Node {
    const node = this.nodes.get(id);
    if (node) return node;
    const head = id.split('.')[0]!;
    const known = [...this.nodes.keys()].filter((k) => k === head || k.startsWith(`${head}.`)).sort();
    throw new Error(
      `unknown id "${id}"; known under "${head}": ${known.length ? known.join(', ') : '(none)'}`,
    );
  }

  private groupHandle(id: string): GroupHandle {
    const get = () => this.lookup(id) as GroupNode;
    const touch = (n: GroupNode) => {
      n.dirty = true;
      this.dirtyAny = true;
    };
    return {
      id,
      set: (t) => {
        const n = get();
        n.motion = transformMatrix(t, n.motion ?? undefined);
        touch(n);
      },
      spin: (axis, rad) => {
        const n = get();
        n.motion = mat4.axisRotation(AXES[axis], rad, n.motion ?? undefined);
        touch(n);
      },
    };
  }

  private poolHandle(id: string): PoolHandle {
    const get = () => this.lookup(id) as PoolNode;
    const check = (n: PoolNode, i: number) => {
      if (!(i >= 0 && i < n.capacity) || !Number.isInteger(i)) {
        throw new Error(`pool "${id}": instance ${i} out of range (capacity ${n.capacity})`);
      }
    };
    const touch = (n: PoolNode) => {
      n.poolDirty = true;
      this.dirtyAny = true;
    };
    const capacity = get().capacity;
    return {
      id,
      capacity,
      get count() {
        return get().count;
      },
      set count(value: number) {
        const n = get();
        if (!(value >= 0 && value <= n.capacity) || !Number.isInteger(value)) {
          throw new Error(`pool "${id}": count ${value} exceeds capacity ${n.capacity}`);
        }
        if (n.count !== value) {
          n.count = value;
          touch(n);
        }
      },
      pose: (i, p, yaw = 0) => {
        const n = get();
        check(n, i);
        n.poses.set([p[0], p[1], p[2], yaw], i * 4);
        touch(n);
      },
      style: (i, k) => {
        const n = get();
        check(n, i);
        if (!(k >= 0 && k < n.styles.length)) throw new Error(`pool "${id}": style ${k} unknown`);
        n.styleOf[i] = k;
        touch(n);
      },
    };
  }

  // ---- frame -----------------------------------------------------------------------------

  onFrame(cb: (f: FrameInfo) => void): () => void {
    this.frameCallbacks.add(cb);
    return () => this.frameCallbacks.delete(cb);
  }

  tick(t: number, dt: number): void {
    const info = { t, dt, reduced: this.motion.reduced };
    for (const cb of this.frameCallbacks) cb(info);
  }

  /** Draw count of a pool (for the renderer). */
  poolCount(id: string): number {
    const node = this.nodes.get(id);
    return node?.kind === 'pool' ? node.count : 0;
  }

  // ---- build -----------------------------------------------------------------------------

  build(): SceneBuild {
    const order = this.ordered();
    // Rest world matrices (without motion): bounds and contacts are taken at rest.
    const restWorld = new Map<string, Float32Array>();
    for (const n of order) {
      const parent = n.parent ? restWorld.get(n.parent)! : null;
      restWorld.set(n.id, parent ? mat4.multiply(parent, n.rest) : mat4.clone(n.rest));
    }

    const statics = order.filter((n): n is PartNode | MarksNode => n.kind === 'part' || n.kind === 'marks');
    statics.sort((a, b) => (a.id < b.id ? -1 : 1));
    const pools = order.filter((n): n is PoolNode => n.kind === 'pool').sort((a, b) => (a.id < b.id ? -1 : 1));
    const slot = new Map(statics.map((n, k) => [n.id, k]));
    const poolBase = new Map<string, number>();
    let instanceCount = statics.length;
    for (const p of pools) {
      poolBase.set(p.id, instanceCount);
      instanceCount += p.capacity;
    }

    // Styles: parts share deduplicated styles; each pool gets a consecutive block, so an
    // instance's style is the pool's base + k.
    const styleWords: number[] = [];
    const styleIndex = new Map<string, number>();
    const resolveStyle = (s: StyleSpec, kind: GeoKind) => {
      const material = MATERIAL[s.material];
      if (material === undefined) throw new Error(`unknown material "${s.material}"`);
      return [
        material,
        SLOT[s.outline ?? 'mid'],
        SLOT[s.crease ?? 'faint'],
        TONE_RULE[s.tone ?? DEFAULT_TONE[kind]],
        s.width ?? 0.6,
        0, 0, 0,
      ];
    };
    const style = new Map<string, number>();
    for (const n of statics) {
      if (n.kind !== 'part') continue;
      const words = resolveStyle(n.style, n.geo.kind);
      const key = words.join(',');
      let index = styleIndex.get(key);
      if (index === undefined) {
        index = styleWords.length / 8;
        styleIndex.set(key, index);
        styleWords.push(...words);
      }
      style.set(n.id, index);
    }
    for (const p of pools) {
      style.set(p.id, styleWords.length / 8);
      for (const s of p.styles) styleWords.push(...resolveStyle(s, p.geo.kind));
    }

    // Prototypes and their line sets.
    const lineSets: LineSetSpec[] = [];
    const lineSetOffset = new Map<string, number>();
    const protoOf = (geo: GeoSpec): Prototype => {
      const proto = buildGeo(geo);
      if (!lineSetOffset.has(proto.key)) {
        lineSetOffset.set(proto.key, lineSets.length);
        lineSets.push(...proto.lineSets);
      }
      return proto;
    };
    const parts = statics.filter((n): n is PartNode => n.kind === 'part');
    const draws: { proto: Prototype; slot: number }[] = parts.map((n) => ({ proto: protoOf(n.geo), slot: slot.get(n.id)! }));
    // Static geometry in two runs, closed then open (open meshes are drawn without culling).
    const statics2 = [...draws.filter((x) => !isOpen(x.proto)), ...draws.filter((x) => isOpen(x.proto))];
    const poolProtos = pools.map((p) => protoOf(p.geo));
    if (lineSets.length > FLAG.lineSetMask) throw new Error(`too many line sets (${lineSets.length} > 255)`);

    // Geometry: the static batch, then one copy per pool.
    const all = [...statics2, ...poolProtos.map((proto) => ({ proto, slot: 0 }))];
    const vertexCount = all.reduce((s, d) => s + d.proto.mesh.positions.length / 3, 0);
    const triCount = all.reduce((s, d) => s + triangleCountOf(d.proto.topology), 0);
    const vertices = new Float32Array(vertexCount * VERTEX_FLOATS);
    const tris = new ArrayBuffer(triCount * SIZES.tri);
    const tu = new Uint32Array(tris);
    const tf = new Float32Array(tris);
    let v0 = 0;
    let t0 = 0;
    const batches: SceneBuild['batches'] = [];
    const staticRuns = { closed: 0, open: 0 };
    all.forEach(({ proto, slot: s }, k) => {
      const { mesh, topology } = proto;
      const vc = mesh.positions.length / 3;
      const tc = triangleCountOf(topology);
      for (let v = 0; v < vc; v++) {
        const o = (v0 + v) * VERTEX_FLOATS;
        vertices[o] = mesh.positions[v * 3]!;
        vertices[o + 1] = mesh.positions[v * 3 + 1]!;
        vertices[o + 2] = mesh.positions[v * 3 + 2]!;
        vertices[o + 3] = mesh.uvs[v * 2]!;
        vertices[o + 4] = mesh.normals[v * 3]!;
        vertices[o + 5] = mesh.normals[v * 3 + 1]!;
        vertices[o + 6] = mesh.normals[v * 3 + 2]!;
        vertices[o + 7] = mesh.uvs[v * 2 + 1]!;
        vertices[o + 8] = mesh.tangents[v * 3]!;
        vertices[o + 9] = mesh.tangents[v * 3 + 1]!;
        vertices[o + 10] = mesh.tangents[v * 3 + 2]!;
      }
      const shift = lineSetOffset.get(proto.key)!;
      for (let t = 0; t < tc; t++) {
        const o = (t0 + t) * 12;
        tu[o] = mesh.indices[t * 3]! + v0;
        tu[o + 1] = mesh.indices[t * 3 + 1]! + v0;
        tu[o + 2] = mesh.indices[t * 3 + 2]! + v0;
        tu[o + 3] = s;
        tf[o + 4] = topology.faceNormals[t * 3]!;
        tf[o + 5] = topology.faceNormals[t * 3 + 1]!;
        tf[o + 6] = topology.faceNormals[t * 3 + 2]!;
        let flags = topology.flags[t]!;
        const tag = (flags >>> FLAG.lineSetShift) & FLAG.lineSetMask;
        if (tag > proto.lineSets.length) {
          throw new Error(`geometry ${proto.key.slice(0, 60)}…: line set ${tag} unknown (${proto.lineSets.length} defined)`);
        }
        if (tag) flags = (flags & ~(FLAG.lineSetMask << FLAG.lineSetShift)) | ((tag + shift) << FLAG.lineSetShift);
        tu[o + 7] = flags;
        for (let i = 0; i < 3; i++) {
          const a = topology.adj[t * 3 + i]!;
          tu[o + 8 + i] = a === NO_NEIGHBOUR ? NO_NEIGHBOUR : a + t0;
        }
        const partner = mesh.partners[t]!;
        tu[o + 11] = partner < 0 ? NO_NEIGHBOUR : partner + t0;
      }
      if (k >= draws.length) {
        const pool = pools[k - draws.length]!;
        batches.push({ firstTri: t0, triCount: tc, firstInstance: poolBase.get(pool.id)!, pool: pool.id, open: isOpen(proto) });
      } else {
        staticRuns[isOpen(proto) ? 'open' : 'closed'] += tc;
      }
      v0 += vc;
      t0 += tc;
    });
    if (staticRuns.open > 0) {
      batches.unshift({ firstTri: staticRuns.closed, triCount: staticRuns.open, firstInstance: 0, pool: null, open: true });
    }
    if (staticRuns.closed > 0) {
      batches.unshift({ firstTri: 0, triCount: staticRuns.closed, firstInstance: 0, pool: null, open: false });
    }

    // Marks: marks nodes, pool marks (per instance), contacts.
    const markWords: number[] = [];
    const pushMarks = (spec: MarksSpec, instance: number) => {
      const material = MATERIAL[spec.material];
      for (const dot of spec.dots ?? []) {
        const fade = dot.normal ? (dot.fade ?? DEFAULT_FADE) : [0, 0];
        markWords.push(
          ...dot.at, dot.size ?? 0.6, ...dot.at, instance,
          ...(dot.normal ?? [0, 0, 0]), MARK.dot, fade[0]!, fade[1]!, material, SLOT[dot.tone ?? 'mid'],
        );
      }
      for (const seg of spec.segments ?? []) {
        const fade = seg.normal ? (seg.fade ?? DEFAULT_FADE) : [0, 0];
        markWords.push(
          ...seg.a, seg.width ?? 0.6, ...seg.b, instance,
          ...(seg.normal ?? [0, 0, 0]), MARK.segment, fade[0]!, fade[1]!, material, SLOT[seg.tone ?? 'lo'],
        );
      }
    };
    for (const n of statics) if (n.kind === 'marks') pushMarks(n.spec, slot.get(n.id)!);
    for (const p of pools) {
      if (!p.marks) continue;
      for (let i = 0; i < p.capacity; i++) pushMarks(p.marks, poolBase.get(p.id)! + i);
    }
    const contacts = this.contacts(parts, restWorld);
    for (const c of contacts) {
      const n = parts.find((p) => p.id === c.id)!;
      const width = n.style.width ?? 0.6;
      const tone = SLOT[n.style.outline ?? 'mid'];
      const material = MATERIAL[n.style.material];
      const s = c.segments;
      for (let k = 0; k < s.length; k += 6) {
        markWords.push(s[k]!, s[k + 1]!, s[k + 2]!, width, s[k + 3]!, s[k + 4]!, s[k + 5]!, slot.get(n.id)!,
          0, 0, 0, MARK.segment, 0, 0, material, tone);
      }
    }
    const markCount = markWords.length / 16;
    const marks = new ArrayBuffer(Math.max(1, markCount) * SIZES.mark);
    {
      const mf = new Float32Array(marks);
      const mu = new Uint32Array(marks);
      // Word layout: a(3) size b(3) instance normal(3) kind fade(2) material slot.
      const isU32 = [7, 11, 14, 15];
      markWords.forEach((w, i) => {
        if (isU32.includes(i % 16)) mu[i] = w;
        else mf[i] = w;
      });
    }

    // Bounds: static parts at rest (pools excluded).
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const p = vec3.create();
    parts.forEach((n, k) => {
      const { mesh } = draws[k]!.proto;
      const m = restWorld.get(n.id)!;
      for (let i = 0; i < mesh.positions.length; i += 3) {
        vec3.transformMat4(mesh.positions.subarray(i, i + 3), m, p);
        for (let c = 0; c < 3; c++) {
          min[c] = Math.min(min[c]!, p[c]!);
          max[c] = Math.max(max[c]!, p[c]!);
        }
      }
    });
    if (!parts.length) {
      min.fill(-1);
      max.fill(1);
    }

    this.built = { version: this.version, order, slot, style, poolBase, instanceCount };
    this.f32 = new Float32Array(instanceCount * INSTANCE_FLOATS);
    this.u32 = new Uint32Array(this.f32.buffer);
    for (const n of order) {
      n.dirty = true;
      if (n.kind === 'pool') n.poolDirty = true;
    }
    this.dirtyAny = true;

    const styles = new ArrayBuffer(Math.max(1, styleWords.length / 8) * SIZES.style);
    {
      const sf = new Float32Array(styles);
      const su = new Uint32Array(styles);
      styleWords.forEach((w, i) => {
        if (i % 8 === 4) sf[i] = w;
        else su[i] = w;
      });
    }
    return {
      vertices,
      vertexCount,
      tris,
      triCount,
      batches,
      instanceCount,
      styles,
      styleCount: styleWords.length / 8,
      lineSets,
      marks,
      markCount,
      bounds: { min, max },
      stats: {
        parts: parts.length,
        pools: pools.length,
        triangles: triCount,
        instances: instanceCount,
        marks: markCount,
        contacts: contacts.reduce((s, c) => s + c.segments.length / 6, 0),
      },
    };
  }

  /** Nodes with parents first; throws on unknown parents and cycles. */
  private ordered(): Node[] {
    const out: Node[] = [];
    const state = new Map<string, 1 | 2>();
    const visit = (n: Node, path: string[]) => {
      const s = state.get(n.id);
      if (s === 2) return;
      if (s === 1) throw new Error(`parent cycle: ${[...path, n.id].join(' → ')}`);
      state.set(n.id, 1);
      if (n.parent !== null) {
        const parent = this.nodes.get(n.parent);
        if (!parent) throw new Error(`"${n.id}": unknown parent "${n.parent}"`);
        if (parent.kind !== 'group') throw new Error(`"${n.id}": parent "${n.parent}" is a ${parent.kind}`);
        visit(parent, [...path, n.id]);
      }
      state.set(n.id, 2);
      out.push(n);
    };
    for (const n of [...this.nodes.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) visit(n, []);
    return out;
  }

  /** The nearest moving ancestor (or null): parts that move together can share contacts. */
  private mover(n: Node): string | null {
    let p = n.parent;
    while (p !== null) {
      const node = this.nodes.get(p)!;
      if (node.moves) return node.id;
      p = node.parent;
    }
    return null;
  }

  private contacts(parts: PartNode[], restWorld: Map<string, Float32Array>) {
    const eligible = parts.filter((n) => n.contacts);
    const info = eligible.map((n) => {
      const proto = buildGeo(n.geo);
      const m = restWorld.get(n.id)!;
      const lo: [number, number, number] = [Infinity, Infinity, Infinity];
      const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      const p = vec3.create();
      for (const x of [proto.min[0], proto.max[0]])
        for (const y of [proto.min[1], proto.max[1]])
          for (const z of [proto.min[2], proto.max[2]]) {
            vec3.transformMat4([x, y, z], m, p);
            for (let c = 0; c < 3; c++) {
              lo[c] = Math.min(lo[c]!, p[c]!);
              hi[c] = Math.max(hi[c]!, p[c]!);
            }
          }
      const size = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
      return { n, proto, m, lo, hi, size, mover: this.mover(n) };
    });
    const out: { id: string; segments: Float32Array }[] = [];
    for (let i = 0; i < info.length; i++) {
      for (let j = i + 1; j < info.length; j++) {
        const A = info[i]!;
        const B = info[j]!;
        if (A.mover !== B.mover) continue;
        if ([0, 1, 2].some((c) => A.lo[c]! > B.hi[c]! + 1e-4 || B.lo[c]! > A.hi[c]! + 1e-4)) continue;
        // Marks go to the smaller part, in its model space.
        const [small, big] = A.size <= B.size ? [A, B] : [B, A];
        const inv = mat4.inverse(small.m);
        const rel = mat4.multiply(inv, big.m);
        const key = `${small.proto.key}|${big.proto.key}|${Array.from(rel, (x) => Math.round(x * 1e5)).join(',')}`;
        let segments = this.contactCache.get(key);
        if (!segments) {
          segments = contactSegments(
            { mesh: small.proto.mesh, model: mat4.identity() },
            { mesh: big.proto.mesh, model: rel },
          );
          if (this.contactCache.size > 256) this.contactCache.clear();
          this.contactCache.set(key, segments);
        }
        if (segments.length) out.push({ id: small.n.id, segments });
      }
    }
    return out;
  }

  // ---- per-frame instance table ------------------------------------------------------------

  /**
   * The instance table (20 floats per instance) after applying motions and pool poses.
   * `dirty` says whether anything changed since the last call. Call `build()` first.
   */
  flatten(): { f32: Float32Array; used: number; dirty: boolean } {
    const b = this.built;
    if (!b || b.version !== this.version) throw new Error('flatten: scene changed, build() first');
    if (!this.dirtyAny) return { f32: this.f32, used: b.instanceCount, dirty: false };
    const recomputed = new Set<string>();
    const local = mat4.create();
    const tmp = mat4.create();
    for (const n of b.order) {
      const parentChanged = n.parent !== null && recomputed.has(n.parent);
      if (n.dirty || parentChanged) {
        const m = n.motion ? mat4.multiply(n.rest, n.motion, local) : n.rest;
        if (n.parent !== null) mat4.multiply(this.nodes.get(n.parent)!.world, m, n.world);
        else mat4.copy(m, n.world);
        n.dirty = false;
        recomputed.add(n.id);
        if (n.kind === 'part' || n.kind === 'marks') {
          const k = b.slot.get(n.id)!;
          this.writeInstance(k, n.world, n.kind === 'part' ? b.style.get(n.id)! : 0, INSTANCE.visible);
        }
      }
      if (n.kind === 'pool' && (n.poolDirty || recomputed.has(n.id))) {
        const base = b.poolBase.get(n.id)!;
        const styleBase = b.style.get(n.id)!;
        for (let i = 0; i < n.capacity; i++) {
          const o = i * 4;
          mat4.translation([n.poses[o]!, n.poses[o + 1]!, n.poses[o + 2]!], tmp);
          mat4.rotateZ(tmp, n.poses[o + 3]!, tmp);
          mat4.multiply(n.world, tmp, tmp);
          this.writeInstance(base + i, tmp, styleBase + n.styleOf[i]!, i < n.count ? INSTANCE.visible : 0);
        }
        n.poolDirty = false;
      }
    }
    this.dirtyAny = false;
    return { f32: this.f32, used: b.instanceCount, dirty: true };
  }

  private writeInstance(k: number, model: Float32Array, style: number, flags: number) {
    const o = k * INSTANCE_FLOATS;
    this.f32.set(model, o);
    this.u32[o + 16] = style;
    this.u32[o + 17] = flags;
  }

  /** Ids currently registered (for messages and dev hooks). */
  ids(): string[] {
    return [...this.nodes.keys()].sort();
  }
}

export function createSceneStore(): SceneStore {
  return new SceneStore();
}
