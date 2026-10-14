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
import { now } from '#platform/env.ts';
import type { Bounds } from '../camera/camera.ts';
import { contactSegments } from '../geo/contact.ts';
import type { Vec3 } from '../geo/mesh.ts';
import { type GeoKind, type GeoSpec, type LineSetSpec, type Prototype, buildGeo } from '../geo/spec.ts';
import { FLAG, NO_NEIGHBOUR, triangleCountOf } from '../geo/topology.ts';
import { DOT_OPACITY, FX, type FxName, type LineTone, MATERIAL, type Material, SLOT } from '../palette/tokens.ts';
import { INSTANCE, INSTANCE_FLOATS, MARK, SIZES, SPRITE, TONE_RULE, VERTEX_FLOATS } from '../render/schemas.ts';

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
  /**
   * Tone `gradient`: a linear gradient from `from` to `to` (model space, measured on screen
   * like SVG's userSpaceOnUse), through three FX stops with the middle one at `mid` (.5).
   */
  gradient?: { from: Vec3; to: Vec3; stops: readonly [FxName, FxName, FxName]; mid?: number };
}

/** Sprites: transparent screen-space effects drawn after the marks (no depth write). */
export type SpriteSpec =
  | {
      kind: 'halo';
      /** Plan of the shadow (rounded rect, centred on the node's origin on its floor plane). */
      plan: { w: number; d: number; r: number };
      /** Blur σ in world units at screen scale (default 3.1: the kit's 9 px blur at KS 2.88). */
      sigma?: number;
      /** Screen-down shift in world units at screen scale (default 1.04: the kit's 3 px). */
      shift?: number;
    }
  | {
      kind: 'disc';
      radius: number;
      grow?: number;
      opacity: number;
      cap?: number;
      fx: FxName;
      /** `glow` blends multiply in light and screen in dark; `normal` is premultiplied over. */
      blend: 'normal' | 'glow';
      /** World units toward the viewer (clears the surface the glow sits on). */
      bias?: number;
      level?: number;
    };

export interface SpriteHandle {
  readonly id: string;
  /** Disc: r = radius + grow · level, alpha = min(opacity · level, cap). */
  level: number;
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
  /** On a pool, each instance's style material is used instead. */
  material: Material;
  dots?: readonly DotSpec[];
  segments?: readonly SegmentSpec[];
}

export interface FrameInfo {
  /** Scene time and step, seconds (step clamped by the shell). */
  t: number;
  dt: number;
}

export interface GroupHandle {
  readonly id: string;
  /** Motion on top of the rest transform: local = rest · motion. */
  set(t: Transform): void;
  /** Motion = a rotation about a local axis. */
  spin(axis: 'x' | 'y' | 'z', rad: number): void;
  /** Motion = a translation (no allocation; for per-frame slides). */
  translate(x: number, y: number, z: number): void;
}

/** A handle on a part declared `live`: per-instance shading that changes per frame. */
export interface PartHandle {
  readonly id: string;
  /** E2: blend toward the part's `blend` style, 0..1 (the fill and its lines). */
  mix: number;
  /** E1: shift of the part's UV line sets, in u (scrolling slats). */
  uShift: number;
}

export interface PoolHandle {
  readonly id: string;
  /** Read live: a re-registered pool may have another capacity. */
  readonly capacity: number;
  /** Instances 0..count−1 are drawn. */
  count: number;
  /**
   * Instance pose in the pool's frame: a position, then a rotation in radians applied as
   * Rz(yaw) · Ry(pitch) · Rx(roll) (yaw about z, then pitch about the turned y, then roll about
   * the instance's own x). Unchanged values do not mark the store dirty.
   */
  pose(i: number, p: Vec3, yaw?: number, pitch?: number, roll?: number): void;
  /** The same with scalar coordinates (no array per call). */
  pose(i: number, x: number, y: number, z: number, yaw?: number, pitch?: number, roll?: number): void;
  /** Instance style: an index into the pool's `styles`. */
  style(i: number, k: number): void;
  /** E2: blend instance i toward style `k2` (an index into `styles`) by `mix` (0..1). */
  blend(i: number, k2: number, mix: number): void;
  /** E1: shift instance i's UV line sets by `u`. */
  shift(i: number, u: number): void;
  /** E3 (pools declared `scalable`): an axis-aligned scale in the instance's own frame. */
  scale(i: number, sx: number, sy: number, sz: number): void;
}

export interface FlattenResult {
  f32: Float32Array;
  /** Instances in the table. */
  used: number;
  dirty: boolean;
  /** Instances rewritten by this flatten: lo..hi−1 (empty when not dirty). */
  lo: number;
  hi: number;
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
  /** 12 words per gradient (Gradient). */
  gradients: ArrayBuffer;
  gradientCount: number;
  /** Sprite draws: `normal` blend first, then `glow` (the table itself comes from `sprites()`). */
  spriteCount: number;
  spriteRanges: { normal: [first: number, count: number]; glow: [first: number, count: number] };
  bounds: Bounds;
  stats: { parts: number; pools: number; triangles: number; instances: number; marks: number; contacts: number; sprites: number };
  /** Milliseconds per build phase (DEV log). */
  timings: Record<string, number>;
}

type NodeKind = 'group' | 'part' | 'pool' | 'marks' | 'sprite';

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
  /** Resolved at build (parents first). */
  parentNode: Node | null;
  /** Flatten pass that last recomputed `world`. */
  stamp: number;
  /**
   * The last motion call, so an unchanged one is a no-op: 0 none / `set`, 1 spin (mA axis code,
   * mB angle), 2 translate (mA, mB, mC).
   */
  motionKind: 0 | 1 | 2;
  mA: number;
  mB: number;
  mC: number;
}
interface GroupNode extends NodeBase {
  kind: 'group';
}
interface PartNode extends NodeBase {
  kind: 'part';
  geo: GeoSpec;
  style: StyleSpec;
  contacts: boolean;
  /** Has a PartHandle (its instance is rewritten when mix or uShift change). */
  live: boolean;
  /** The style a live part blends toward. */
  blend: StyleSpec | null;
  mix: number;
  uShift: number;
  /** The prototype, resolved once (a node's geo never changes; edits re-register). */
  proto: Prototype | null;
}
interface PoolNode extends NodeBase {
  kind: 'pool';
  geo: GeoSpec;
  styles: StyleSpec[];
  capacity: number;
  marks: MarksSpec | null;
  count: number;
  scalable: boolean;
  /** x, y, z, yaw, pitch, roll, sx, sy, sz per instance. */
  poses: Float32Array;
  styleOf: Uint16Array;
  style2Of: Uint16Array;
  mixOf: Float32Array;
  shiftOf: Float32Array;
  /** Instances written with the visible flag at the last flatten (the rest are already hidden). */
  written: number;
  poolDirty: boolean;
}
interface MarksNode extends NodeBase {
  kind: 'marks';
  spec: MarksSpec;
}
interface SpriteNode extends NodeBase {
  kind: 'sprite';
  spec: SpriteSpec;
  level: number;
}
type Node = GroupNode | PartNode | PoolNode | MarksNode | SpriteNode;

const DEFAULT_TONE: Record<GeoKind, ToneRule> = {
  box: 'plan',
  extrude: 'plan',
  lathe: 'bands',
  tube: 'tube',
  belt: 'tube',
  band: 'bands',
};
const DEFAULT_FADE = [0.04, 0.42] as const;
/** Mark material: use the instance's style material (pool marks). */
const MARK_INHERIT = 0xffff;

const ZERO3: Vec3 = [0, 0, 0];
const RAD = Math.PI / 180;

export function transformMatrix(t: Transform | undefined, out = mat4.identity()) {
  mat4.identity(out);
  if (!t) return out;
  const scale = t.scale ?? 1;
  if (!(scale > 0) || !Number.isFinite(scale)) throw new Error(`transform: bad scale ${scale}`);
  const r = t.rotation ?? ZERO3;
  mat4.translation(t.position ?? ZERO3, out);
  if (r[2] !== 0) mat4.rotateZ(out, r[2] * RAD, out);
  if (r[1] !== 0) mat4.rotateY(out, r[1] * RAD, out);
  if (r[0] !== 0) mat4.rotateX(out, r[0] * RAD, out);
  if (scale !== 1) mat4.uniformScale(out, scale, out);
  return out;
}

const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] } as const;
const AXIS_CODE = { x: 0, y: 1, z: 2 } as const;
const POSE_FLOATS = 9;

/**
 * Contact segments per (small prototype, big prototype, relative placement), shared by every
 * store like the prototype cache: edits and remounts rebuild warm. Swept back to the pairs the
 * last build used once it holds more than CONTACT_CACHE_LIMIT entries.
 */
const contactCache = new Map<string, { segments: Float32Array; normals: Float32Array }>();
const CONTACT_CACHE_LIMIT = 4096;

/** Packed GPU blocks of a prototype (local indices), built once per prototype. */
interface Packed {
  vertices: Float32Array;
  /** 12 words per triangle; idx/adj/partner local, NO_NEIGHBOUR kept. */
  tris: Uint32Array;
}
const packedCache = new WeakMap<Prototype, Packed>();
function packedOf(proto: Prototype): Packed {
  let packed = packedCache.get(proto);
  if (packed) return packed;
  const { mesh, topology } = proto;
  const vc = mesh.positions.length / 3;
  const tc = triangleCountOf(topology);
  const vertices = new Float32Array(vc * VERTEX_FLOATS);
  for (let v = 0; v < vc; v++) {
    const o = v * VERTEX_FLOATS;
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
  const tris = new Uint32Array(tc * 12);
  const tf = new Float32Array(tris.buffer);
  for (let t = 0; t < tc; t++) {
    const o = t * 12;
    tris[o] = mesh.indices[t * 3]!;
    tris[o + 1] = mesh.indices[t * 3 + 1]!;
    tris[o + 2] = mesh.indices[t * 3 + 2]!;
    tf[o + 4] = topology.faceNormals[t * 3]!;
    tf[o + 5] = topology.faceNormals[t * 3 + 1]!;
    tf[o + 6] = topology.faceNormals[t * 3 + 2]!;
    const flags = topology.flags[t]!;
    const tag = (flags >>> FLAG.lineSetShift) & FLAG.lineSetMask;
    if (tag > proto.lineSets.length) {
      throw new Error(`geometry ${proto.key.slice(0, 60)}…: line set ${tag} unknown (${proto.lineSets.length} defined)`);
    }
    tris[o + 7] = flags;
    tris[o + 8] = topology.adj[t * 3]!;
    tris[o + 9] = topology.adj[t * 3 + 1]!;
    tris[o + 10] = topology.adj[t * 3 + 2]!;
    const partner = mesh.partners[t]!;
    tris[o + 11] = partner < 0 ? NO_NEIGHBOUR : partner;
  }
  packed = { vertices, tris };
  packedCache.set(proto, packed);
  return packed;
}

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
  /** Blend style index per part (its own style when it has none). */
  style2: Map<string, number>;
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
  private flattenStamp = 0;
  private spriteNodes: SpriteNode[] = [];
  private spriteTable = new ArrayBuffer(SIZES.sprite);
  private spritesDirty = true;
  private spriteSlots: number[] = [];
  /** The instance range written by the current flatten. */
  private lo = Infinity;
  private hi = 0;
  private readonly flat: FlattenResult = { f32: this.f32, used: 0, dirty: false, lo: 0, hi: 0 };
  private readonly local = mat4.create();
  private readonly tmp = mat4.create();
  private readonly scratch = mat4.create();
  private readonly v3 = vec3.create();
  version = 0;

  // ---- registration ----------------------------------------------------------------------

  group(id: string, o: { parent?: string; transform?: Transform; moves?: boolean } = {}): Token {
    return this.add({ ...this.base('group', id, o.parent, o.transform), moves: o.moves ?? false, kind: 'group' });
  }

  part(
    id: string,
    o: {
      parent?: string;
      geo: GeoSpec;
      style: StyleSpec;
      transform?: Transform;
      contacts?: boolean;
      /** A PartHandle can change its blend and line-set shift per frame. */
      live?: boolean;
      /** The style the part blends toward (with `live`). */
      blend?: StyleSpec;
    },
  ): Token {
    if (o.blend && !o.live) throw new Error(`part "${id}": blend needs live`);
    return this.add({
      ...this.base('part', id, o.parent, o.transform),
      kind: 'part',
      geo: o.geo,
      style: o.style,
      contacts: o.contacts ?? true,
      live: o.live ?? false,
      blend: o.blend ?? null,
      mix: 0,
      uShift: 0,
      proto: null,
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
      /** E3: instances may take an axis-aligned scale. */
      scalable?: boolean;
    },
  ): Token {
    if (!(o.capacity > 0) || !Number.isInteger(o.capacity)) throw new Error(`pool "${id}": bad capacity ${o.capacity}`);
    if (!o.styles.length) throw new Error(`pool "${id}": needs at least one style`);
    const poses = new Float32Array(o.capacity * POSE_FLOATS);
    for (let i = 0; i < o.capacity; i++) poses.fill(1, i * POSE_FLOATS + 6, i * POSE_FLOATS + 9);
    return this.add({
      ...this.base('pool', id, o.parent, o.transform),
      kind: 'pool',
      geo: o.geo,
      styles: o.styles,
      capacity: o.capacity,
      marks: o.marks ?? null,
      count: 0,
      scalable: o.scalable ?? false,
      poses,
      styleOf: new Uint16Array(o.capacity),
      style2Of: new Uint16Array(o.capacity),
      mixOf: new Float32Array(o.capacity),
      shiftOf: new Float32Array(o.capacity),
      written: 0,
      poolDirty: true,
    });
  }

  marks(id: string, o: { parent?: string; transform?: Transform } & MarksSpec): Token {
    const { parent, transform, ...spec } = o;
    return this.add({ ...this.base('marks', id, parent, transform), kind: 'marks', spec });
  }

  sprite(id: string, o: { parent?: string; transform?: Transform } & SpriteSpec): Token {
    const { parent, transform, ...spec } = o;
    return this.add({
      ...this.base('sprite', id, parent, transform),
      kind: 'sprite',
      spec,
      level: spec.kind === 'disc' ? (spec.level ?? 1) : 1,
    });
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
      parentNode: null,
      stamp: 0,
      motionKind: 0 as const,
      mA: 0,
      mB: 0,
      mC: 0,
    };
  }

  private add(node: Node): Token {
    if (this.nodes.has(node.id)) throw new Error(`duplicate id "${node.id}"`);
    this.nodes.set(node.id, node);
    this.version++;
    return node.token;
  }

  // ---- handles ---------------------------------------------------------------------------

  /** A handle on a moving group, a live part, a pool or a sprite. Throws for unknown ids. */
  node(id: string): GroupHandle | PartHandle | PoolHandle | SpriteHandle {
    const node = this.lookup(id);
    if (node.kind === 'pool') return this.poolHandle(id);
    if (node.kind === 'sprite') return this.spriteHandle(id);
    if (node.kind === 'group') {
      if (!node.moves) throw new Error(`group "${id}" is not declared with moves`);
      return this.groupHandle(id);
    }
    if (node.kind === 'part') {
      if (!node.live) throw new Error(`part "${id}" is not declared live`);
      return this.partHandle(id);
    }
    throw new Error(`"${id}" is a ${node.kind}; only moving groups, live parts, pools and sprites have handles`);
  }

  part$(id: string): PartHandle {
    const h = this.node(id);
    if (!('uShift' in h)) throw new Error(`"${id}" is not a part`);
    return h;
  }

  private partHandle(id: string): PartHandle {
    const get = () => this.lookup(id) as PartNode;
    const store = this;
    const touch = (n: PartNode) => {
      n.dirty = true;
      store.dirtyAny = true;
    };
    return {
      id,
      get mix() {
        return get().mix;
      },
      set mix(value: number) {
        const n = get();
        if (!(value >= 0 && value <= 1)) throw new Error(`part "${id}": mix ${value} outside 0..1`);
        if (!n.blend && value !== 0) throw new Error(`part "${id}": no blend style`);
        if (n.mix === Math.fround(value)) return;
        n.mix = Math.fround(value);
        touch(n);
      },
      get uShift() {
        return get().uShift;
      },
      set uShift(value: number) {
        const n = get();
        if (!Number.isFinite(value)) throw new Error(`part "${id}": bad uShift ${value}`);
        if (n.uShift === Math.fround(value)) return;
        n.uShift = Math.fround(value);
        touch(n);
      },
    };
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

  sprite$(id: string): SpriteHandle {
    const h = this.node(id);
    if (!('level' in h)) throw new Error(`"${id}" is not a sprite`);
    return h;
  }

  private spriteHandle(id: string): SpriteHandle {
    const get = () => this.lookup(id) as SpriteNode;
    const store = this;
    return {
      id,
      get level() {
        return get().level;
      },
      set level(value: number) {
        const n = get();
        if (!Number.isFinite(value)) throw new Error(`sprite "${id}": bad level ${value}`);
        if (n.level === value) return;
        n.level = value;
        store.spritesDirty = true;
      },
    };
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
        const m = transformMatrix(t, this.scratch);
        if (n.motionKind === 0 && n.motion && sameMatrix(n.motion, m)) return;
        n.motion = mat4.copy(m, n.motion ?? undefined);
        n.motionKind = 0;
        touch(n);
      },
      spin: (axis, rad) => {
        const n = get();
        const code = AXIS_CODE[axis];
        if (n.motionKind === 1 && n.mA === code && n.mB === rad) return;
        n.motion = mat4.axisRotation(AXES[axis], rad, n.motion ?? undefined);
        n.motionKind = 1;
        n.mA = code;
        n.mB = rad;
        touch(n);
      },
      translate: (x, y, z) => {
        const n = get();
        if (n.motionKind === 2 && n.mA === x && n.mB === y && n.mC === z) return;
        const m = (n.motion ??= mat4.create());
        mat4.identity(m);
        m[12] = x;
        m[13] = y;
        m[14] = z;
        n.motionKind = 2;
        n.mA = x;
        n.mB = y;
        n.mC = z;
        touch(n);
      },
    };
  }

  private poolHandle(id: string): PoolHandle {
    const get = () => this.lookup(id) as PoolNode;
    const touch = (n: PoolNode) => {
      n.poolDirty = true;
      this.dirtyAny = true;
    };
    const check = (n: PoolNode, i: number) => {
      if (!(i >= 0 && i < n.capacity) || !Number.isInteger(i)) {
        throw new Error(`pool "${id}": instance ${i} out of range (capacity ${n.capacity})`);
      }
    };
    const write = (i: number, x: number, y: number, z: number, yaw: number, pitch: number, roll: number) => {
      const n = get();
      check(n, i);
      const q = n.poses;
      const o = i * POSE_FLOATS;
      // Compare at float32 precision (what the array stores).
      const f = Math.fround;
      if (
        q[o] === f(x) && q[o + 1] === f(y) && q[o + 2] === f(z) &&
        q[o + 3] === f(yaw) && q[o + 4] === f(pitch) && q[o + 5] === f(roll)
      ) {
        return;
      }
      q[o] = x;
      q[o + 1] = y;
      q[o + 2] = z;
      q[o + 3] = yaw;
      q[o + 4] = pitch;
      q[o + 5] = roll;
      touch(n);
    };
    function pose(i: number, p: Vec3, yaw?: number, pitch?: number, roll?: number): void;
    function pose(i: number, x: number, y: number, z: number, yaw?: number, pitch?: number, roll?: number): void;
    function pose(i: number, a: Vec3 | number, b = 0, c = 0, d = 0, e = 0, g = 0): void {
      if (typeof a === 'number') write(i, a, b, c, d, e, g);
      else write(i, a[0], a[1], a[2], b, c, d);
    }
    return {
      id,
      get capacity() {
        return get().capacity;
      },
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
      pose,
      style: (i, k) => {
        const n = get();
        check(n, i);
        if (!(k >= 0 && k < n.styles.length)) throw new Error(`pool "${id}": style ${k} unknown`);
        if (n.styleOf[i] === k) return;
        n.styleOf[i] = k;
        touch(n);
      },
      blend: (i, k2, mix) => {
        const n = get();
        check(n, i);
        if (!(k2 >= 0 && k2 < n.styles.length)) throw new Error(`pool "${id}": style ${k2} unknown`);
        if (!(mix >= 0 && mix <= 1)) throw new Error(`pool "${id}": mix ${mix} outside 0..1`);
        const m = Math.fround(mix);
        if (n.style2Of[i] === k2 && n.mixOf[i] === m) return;
        n.style2Of[i] = k2;
        n.mixOf[i] = m;
        touch(n);
      },
      shift: (i, u) => {
        const n = get();
        check(n, i);
        const v = Math.fround(u);
        if (n.shiftOf[i] === v) return;
        n.shiftOf[i] = v;
        touch(n);
      },
      scale: (i, sx, sy, sz) => {
        const n = get();
        check(n, i);
        if (!n.scalable) throw new Error(`pool "${id}" is not scalable`);
        if (!(sx > 0 && sy > 0 && sz > 0)) throw new Error(`pool "${id}": bad scale ${sx}, ${sy}, ${sz}`);
        const q = n.poses;
        const o = i * POSE_FLOATS + 6;
        const f = Math.fround;
        if (q[o] === f(sx) && q[o + 1] === f(sy) && q[o + 2] === f(sz)) return;
        q[o] = sx;
        q[o + 1] = sy;
        q[o + 2] = sz;
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
    const info = { t, dt };
    for (const cb of this.frameCallbacks) cb(info);
  }

  /** Draw count of a pool (for the renderer). */
  poolCount(id: string): number {
    const node = this.nodes.get(id);
    return node?.kind === 'pool' ? node.count : 0;
  }

  // ---- build -----------------------------------------------------------------------------

  build(): SceneBuild {
    const timings: Record<string, number> = {};
    let lapStart = now();
    const lap = (phase: string) => {
      const t = now();
      timings[phase] = (timings[phase] ?? 0) + t - lapStart;
      lapStart = t;
    };
    const order = this.ordered();
    // Rest world matrices (without motion): bounds and contacts are taken at rest.
    const restWorld = new Map<string, Float32Array>();
    for (const n of order) {
      const parent = n.parent ? restWorld.get(n.parent)! : null;
      restWorld.set(n.id, parent ? mat4.multiply(parent, n.rest) : mat4.clone(n.rest));
    }

    const statics = order.filter(
      (n): n is PartNode | MarksNode | SpriteNode => n.kind === 'part' || n.kind === 'marks' || n.kind === 'sprite',
    );
    // E8: statics that move (under a moving group, or live parts) take the last static slots,
    // just before the pools, so a frame's rewritten instances form one short range at the end.
    const moving = new Map(statics.map((n) => [n.id, (n.kind === 'part' && n.live) || this.mover(n) !== null]));
    statics.sort((a, b) => {
      const ma = moving.get(a.id)!;
      const mb = moving.get(b.id)!;
      if (ma !== mb) return ma ? 1 : -1;
      return a.id < b.id ? -1 : 1;
    });
    const pools = order.filter((n): n is PoolNode => n.kind === 'pool').sort((a, b) => (a.id < b.id ? -1 : 1));
    const slot = new Map(statics.map((n, k) => [n.id, k]));
    const poolBase = new Map<string, number>();
    let instanceCount = statics.length;
    for (const p of pools) {
      poolBase.set(p.id, instanceCount);
      instanceCount += p.capacity;
    }

    lap('order');
    // Styles: parts share deduplicated styles; each pool gets a consecutive block, so an
    // instance's style is the pool's base + k.
    const styleWords: number[] = [];
    const styleIndex = new Map<string, number>();
    const gradientWords: number[] = [];
    const resolveStyle = (s: StyleSpec, kind: GeoKind) => {
      const material = MATERIAL[s.material];
      if (material === undefined) throw new Error(`unknown material "${s.material}"`);
      const tone = s.tone ?? DEFAULT_TONE[kind];
      let gradient = 0;
      if (tone === 'gradient') {
        const g = s.gradient;
        if (!g) throw new Error(`tone 'gradient' needs a gradient spec`);
        gradient = gradientWords.length / 12;
        gradientWords.push(...g.from, g.mid ?? 0.5, ...g.to, 0, ...g.stops.map((x) => FX[x]), 0);
      }
      return [
        material,
        SLOT[s.outline ?? 'mid'],
        SLOT[s.crease ?? 'faint'],
        TONE_RULE[tone],
        s.width ?? 0.6,
        gradient, 0, 0,
      ];
    };
    const style = new Map<string, number>();
    for (const n of statics) {
      if (n.kind !== 'part') continue;
      const words = resolveStyle(n.style, n.geo.kind);
      // A gradient style carries its own table row, so it never dedups with another.
      const key = words.join(',');
      let index = styleIndex.get(key);
      if (index === undefined) {
        index = styleWords.length / 8;
        styleIndex.set(key, index);
        styleWords.push(...words);
      }
      style.set(n.id, index);
    }
    // A live part's blend style (deduplicated like the part styles).
    const style2 = new Map<string, number>();
    for (const n of statics) {
      if (n.kind !== 'part') continue;
      if (!n.blend) {
        style2.set(n.id, style.get(n.id)!);
        continue;
      }
      const words = resolveStyle(n.blend, n.geo.kind);
      const key = words.join(',');
      let index = styleIndex.get(key);
      if (index === undefined) {
        index = styleWords.length / 8;
        styleIndex.set(key, index);
        styleWords.push(...words);
      }
      style2.set(n.id, index);
    }
    for (const p of pools) {
      style.set(p.id, styleWords.length / 8);
      for (const s of p.styles) styleWords.push(...resolveStyle(s, p.geo.kind));
    }

    lap('styles');
    // Prototypes and their line sets.
    const lineSets: LineSetSpec[] = [];
    const lineSetOffset = new Map<string, number>();
    const register = (proto: Prototype) => {
      if (!lineSetOffset.has(proto.key)) {
        lineSetOffset.set(proto.key, lineSets.length);
        lineSets.push(...proto.lineSets);
      }
      return proto;
    };
    const parts = statics.filter((n): n is PartNode => n.kind === 'part');
    const draws: { proto: Prototype; slot: number }[] = parts.map((n) => ({
      proto: register((n.proto ??= buildGeo(n.geo))),
      slot: slot.get(n.id)!,
    }));
    // Static geometry in two runs, closed then open (open meshes are drawn without culling).
    const statics2 = [...draws.filter((x) => !isOpen(x.proto)), ...draws.filter((x) => isOpen(x.proto))];
    const poolProtos = pools.map((p) => register(buildGeo(p.geo)));
    if (lineSets.length > FLAG.lineSetMask) throw new Error(`too many line sets (${lineSets.length} > 255)`);

    lap('protos');
    // Geometry: the static batch, then one copy per pool. Each prototype's block is packed once
    // (cached); here it is copied and its indices rebased.
    const all = [...statics2, ...poolProtos.map((proto) => ({ proto, slot: 0 }))];
    const vertexCount = all.reduce((s, d) => s + d.proto.mesh.positions.length / 3, 0);
    const triCount = all.reduce((s, d) => s + triangleCountOf(d.proto.topology), 0);
    const vertices = new Float32Array(vertexCount * VERTEX_FLOATS);
    const tris = new ArrayBuffer(triCount * SIZES.tri);
    const tu = new Uint32Array(tris);
    let v0 = 0;
    let t0 = 0;
    const batches: SceneBuild['batches'] = [];
    const staticRuns = { closed: 0, open: 0 };
    const tagMask = FLAG.lineSetMask << FLAG.lineSetShift;
    all.forEach(({ proto, slot: s }, k) => {
      const packed = packedOf(proto);
      const vc = proto.mesh.positions.length / 3;
      const tc = triangleCountOf(proto.topology);
      vertices.set(packed.vertices, v0 * VERTEX_FLOATS);
      tu.set(packed.tris, t0 * 12);
      const shift = lineSetOffset.get(proto.key)!;
      for (let t = 0; t < tc; t++) {
        const o = (t0 + t) * 12;
        tu[o] = tu[o]! + v0;
        tu[o + 1] = tu[o + 1]! + v0;
        tu[o + 2] = tu[o + 2]! + v0;
        tu[o + 3] = s;
        const flags = tu[o + 7]!;
        const tag = (flags >>> FLAG.lineSetShift) & FLAG.lineSetMask;
        if (tag) tu[o + 7] = (flags & ~tagMask) | ((tag + shift) << FLAG.lineSetShift);
        for (let i = 8; i < 12; i++) {
          const a = tu[o + i]!;
          if (a !== NO_NEIGHBOUR) tu[o + i] = a + t0;
        }
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

    lap('pack');
    // Marks: marks nodes, pool marks (per instance), contacts.
    const markWords: number[] = [];
    const pushMarks = (spec: MarksSpec, instance: number, inherit = false) => {
      const material = inherit ? MARK_INHERIT : MATERIAL[spec.material];
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
      // Pool marks take each instance's style material (a strap on a blue or an amber packet).
      for (let i = 0; i < p.capacity; i++) pushMarks(p.marks, poolBase.get(p.id)! + i, true);
    }
    lap('marks');
    const contacts = this.contacts(parts, restWorld);
    lap('contacts');
    let contactCount = 0;
    for (const c of contacts) {
      const n = c.node;
      const width = n.style.width ?? 0.6;
      const tone = SLOT[n.style.outline ?? 'mid'];
      const material = MATERIAL[n.style.material];
      const instance = slot.get(n.id)!;
      const s = c.segments;
      const nm = c.normals;
      for (let k = 0, j = 0; k < s.length; k += 6, j += 3) {
        // The bigger part's face normal: the quad lies on that surface (see marksVertex).
        markWords.push(s[k]!, s[k + 1]!, s[k + 2]!, width, s[k + 3]!, s[k + 4]!, s[k + 5]!, instance,
          nm[j]!, nm[j + 1]!, nm[j + 2]!, MARK.contact, 0, 0, material, tone);
      }
      contactCount += s.length / 6;
    }
    const markCount = markWords.length / 16;
    // Sprites: normal blend first, then glow; each rides its node's static instance slot.
    const sprites = statics.filter((n): n is SpriteNode => n.kind === 'sprite');
    const isGlow = (n: SpriteNode) => n.spec.kind === 'disc' && n.spec.blend === 'glow';
    this.spriteNodes = [...sprites.filter((n) => !isGlow(n)), ...sprites.filter(isGlow)];
    this.spriteSlots = this.spriteNodes.map((n) => slot.get(n.id)!);
    const glowCount = sprites.filter(isGlow).length;
    this.spriteTable = new ArrayBuffer(Math.max(1, sprites.length) * SIZES.sprite);
    this.spritesDirty = true;
    const marks = new ArrayBuffer(Math.max(1, markCount) * SIZES.mark);
    {
      const mf = new Float32Array(marks);
      const mu = new Uint32Array(marks);
      // Word layout: a(3) size b(3) instance normal(3) kind fade(2) material slot.
      for (let i = 0; i < markWords.length; i++) {
        const w = i % 16;
        if (w === 7 || w === 11 || w === 14 || w === 15) mu[i] = markWords[i]!;
        else mf[i] = markWords[i]!;
      }
    }
    lap('marks');

    // Bounds and the fit hull: every static part's box corners at rest (pools excluded).
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const p = vec3.create();
    const corner = vec3.create();
    const points = new Float32Array(parts.length * 24);
    parts.forEach((n, k) => {
      const { proto } = draws[k]!;
      const m = restWorld.get(n.id)!;
      let c = 0;
      for (let ix = 0; ix < 2; ix++)
        for (let iy = 0; iy < 2; iy++)
          for (let iz = 0; iz < 2; iz++) {
            corner[0] = ix ? proto.max[0] : proto.min[0];
            corner[1] = iy ? proto.max[1] : proto.min[1];
            corner[2] = iz ? proto.max[2] : proto.min[2];
            vec3.transformMat4(corner, m, p);
            points.set(p, k * 24 + c * 3);
            for (let a = 0; a < 3; a++) {
              if (p[a]! < min[a]!) min[a] = p[a]!;
              if (p[a]! > max[a]!) max[a] = p[a]!;
            }
            c++;
          }
    });
    if (!parts.length) {
      min.fill(-1);
      max.fill(1);
    }
    lap('bounds');
    this.built = { version: this.version, order, slot, style, style2, poolBase, instanceCount };
    this.f32 = new Float32Array(instanceCount * INSTANCE_FLOATS);
    this.u32 = new Uint32Array(this.f32.buffer);
    for (const n of order) {
      n.dirty = true;
      if (n.kind === 'pool') {
        n.poolDirty = true;
        n.written = 0;
      }
    }
    this.dirtyAny = true;

    const gradientCount = gradientWords.length / 12;
    const gradients = new ArrayBuffer(Math.max(1, gradientCount) * SIZES.gradient);
    {
      const gf = new Float32Array(gradients);
      const gu = new Uint32Array(gradients);
      // Word layout: from(3) mid to(3) _p fx(3) _q.
      gradientWords.forEach((w, i) => {
        const k = i % 12;
        if (k >= 7) gu[i] = w;
        else gf[i] = w;
      });
    }
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
      gradients,
      gradientCount,
      spriteCount: this.spriteNodes.length,
      spriteRanges: {
        normal: [0, this.spriteNodes.length - glowCount],
        glow: [this.spriteNodes.length - glowCount, glowCount],
      },
      bounds: { min, max, points },
      stats: {
        parts: parts.length,
        pools: pools.length,
        triangles: triCount,
        instances: instanceCount,
        marks: markCount,
        contacts: contactCount,
        sprites: this.spriteNodes.length,
      },
      timings,
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
      n.parentNode = null;
      if (n.parent !== null) {
        const parent = this.nodes.get(n.parent);
        if (!parent) throw new Error(`"${n.id}": unknown parent "${n.parent}"`);
        if (parent.kind !== 'group') throw new Error(`"${n.id}": parent "${n.parent}" is a ${parent.kind}`);
        visit(parent, [...path, n.id]);
        n.parentNode = parent;
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
    const p = vec3.create();
    const corner = vec3.create();
    const info = eligible.map((n) => {
      const proto = (n.proto ??= buildGeo(n.geo));
      const m = restWorld.get(n.id)!;
      const lo: [number, number, number] = [Infinity, Infinity, Infinity];
      const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      for (let ix = 0; ix < 2; ix++)
        for (let iy = 0; iy < 2; iy++)
          for (let iz = 0; iz < 2; iz++) {
            corner[0] = ix ? proto.max[0] : proto.min[0];
            corner[1] = iy ? proto.max[1] : proto.min[1];
            corner[2] = iz ? proto.max[2] : proto.min[2];
            vec3.transformMat4(corner, m, p);
            for (let c = 0; c < 3; c++) {
              if (p[c]! < lo[c]!) lo[c] = p[c]!;
              if (p[c]! > hi[c]!) hi[c] = p[c]!;
            }
          }
      const size = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
      return { n, proto, m, lo, hi, size, mover: this.mover(n) };
    });
    const used = new Set<string>();
    const out: { node: PartNode; segments: Float32Array; normals: Float32Array }[] = [];
    for (let i = 0; i < info.length; i++) {
      const A = info[i]!;
      for (let j = i + 1; j < info.length; j++) {
        const B = info[j]!;
        if (A.mover !== B.mover) continue;
        if (
          A.lo[0] > B.hi[0] + 1e-4 || B.lo[0] > A.hi[0] + 1e-4 ||
          A.lo[1] > B.hi[1] + 1e-4 || B.lo[1] > A.hi[1] + 1e-4 ||
          A.lo[2] > B.hi[2] + 1e-4 || B.lo[2] > A.hi[2] + 1e-4
        ) {
          continue;
        }
        // Marks go to the smaller part, in its model space.
        const [small, big] = A.size <= B.size ? [A, B] : [B, A];
        const rel = mat4.multiply(mat4.inverse(small.m), big.m);
        let key = `${small.proto.id}|${big.proto.id}`;
        for (let k = 0; k < 16; k++) key += `,${Math.round(rel[k]! * 1e5)}`;
        used.add(key);
        let hit = contactCache.get(key);
        if (!hit) {
          // Work in the big part's model space (only the small mesh is transformed), then
          // carry the segments and normals into the small part's space.
          const normals: number[] = [];
          const inBig = contactSegments(
            { mesh: small.proto.mesh, model: mat4.inverse(rel) },
            { mesh: big.proto.mesh, model: mat4.identity() },
            1e-4,
            normals,
          );
          const segments = new Float32Array(inBig.length);
          for (let k = 0; k < inBig.length; k += 3) {
            vec3.transformMat4(inBig.subarray(k, k + 3), rel, p);
            segments.set(p, k);
          }
          for (let k = 0; k < normals.length; k += 3) {
            const n = vec3.transformMat4Upper3x3([normals[k]!, normals[k + 1]!, normals[k + 2]!], rel);
            vec3.normalize(n, n);
            normals[k] = n[0]!;
            normals[k + 1] = n[1]!;
            normals[k + 2] = n[2]!;
          }
          hit = { segments, normals: new Float32Array(normals) };
          contactCache.set(key, hit);
        }
        if (hit.segments.length) out.push({ node: small.n, ...hit });
      }
    }
    if (contactCache.size > CONTACT_CACHE_LIMIT) {
      for (const key of contactCache.keys()) if (!used.has(key)) contactCache.delete(key);
    }
    return out;
  }

  // ---- per-frame instance table ------------------------------------------------------------

  /**
   * The instance table (24 floats per instance) after applying motions and pool poses.
   * `dirty` says whether anything changed since the last call; `lo`..`hi` (instances, end
   * exclusive) is the range rewritten by this call (E8: upload only that). Call `build()` first.
   */
  flatten(): FlattenResult {
    const b = this.built;
    const r = this.flat;
    if (!b || b.version !== this.version) throw new Error('flatten: scene changed, build() first');
    r.f32 = this.f32;
    r.used = b.instanceCount;
    r.dirty = false;
    r.lo = 0;
    r.hi = 0;
    if (!this.dirtyAny) return r;
    this.lo = Infinity;
    this.hi = 0;
    // Nodes recomputed in this pass carry its stamp, so children see a changed parent.
    const stamp = ++this.flattenStamp;
    const { local, tmp, v3 } = this;
    for (const n of b.order) {
      const parent = n.parentNode;
      if (n.dirty || (parent !== null && parent.stamp === stamp)) {
        const m = n.motion ? mat4.multiply(n.rest, n.motion, local) : n.rest;
        if (parent !== null) mat4.multiply(parent.world, m, n.world);
        else mat4.copy(m, n.world);
        n.dirty = false;
        n.stamp = stamp;
        if (n.kind === 'part') {
          const k = b.slot.get(n.id)!;
          this.writeInstance(k, n.world, b.style.get(n.id)!, INSTANCE.visible, b.style2.get(n.id)!, n.mix, n.uShift);
        } else if (n.kind === 'marks' || n.kind === 'sprite') {
          this.writeInstance(b.slot.get(n.id)!, n.world, 0, INSTANCE.visible, 0, 0, 0);
        }
      }
      if (n.kind === 'pool' && (n.poolDirty || n.stamp === stamp)) {
        const base = b.poolBase.get(n.id)!;
        const styleBase = b.style.get(n.id)!;
        const q = n.poses;
        // Instances past both this count and the last one are already hidden.
        const end = Math.max(n.count, n.written);
        for (let i = 0; i < end; i++) {
          const o = i * POSE_FLOATS;
          v3[0] = q[o]!;
          v3[1] = q[o + 1]!;
          v3[2] = q[o + 2]!;
          mat4.translation(v3, tmp);
          if (q[o + 3] !== 0) mat4.rotateZ(tmp, q[o + 3]!, tmp);
          if (q[o + 4] !== 0) mat4.rotateY(tmp, q[o + 4]!, tmp);
          if (q[o + 5] !== 0) mat4.rotateX(tmp, q[o + 5]!, tmp);
          if (n.scalable && (q[o + 6] !== 1 || q[o + 7] !== 1 || q[o + 8] !== 1)) {
            v3[0] = q[o + 6]!;
            v3[1] = q[o + 7]!;
            v3[2] = q[o + 8]!;
            mat4.scale(tmp, v3, tmp);
          }
          mat4.multiply(n.world, tmp, tmp);
          this.writeInstance(
            base + i,
            tmp,
            styleBase + n.styleOf[i]!,
            i < n.count ? INSTANCE.visible : 0,
            styleBase + n.style2Of[i]!,
            n.mixOf[i]!,
            n.shiftOf[i]!,
          );
        }
        n.written = n.count;
        n.poolDirty = false;
      }
    }
    this.dirtyAny = false;
    r.dirty = true;
    r.lo = this.hi > 0 ? this.lo : 0;
    r.hi = this.hi;
    return r;
  }

  /** The sprite table (16 words per sprite, in draw order); `dirty` after a build or a level change. */
  sprites(): { buffer: ArrayBuffer; count: number; dirty: boolean } {
    const count = this.spriteNodes.length;
    if (!this.spritesDirty) return { buffer: this.spriteTable, count, dirty: false };
    const f = new Float32Array(this.spriteTable);
    const u = new Uint32Array(this.spriteTable);
    this.spriteNodes.forEach((n, i) => {
      const o = i * 16;
      const sp = n.spec;
      f.fill(0, o, o + 16);
      u[o + 13] = this.spriteSlots[i]!;
      f[o + 14] = n.level;
      if (sp.kind === 'halo') {
        u[o + 3] = SPRITE.halo;
        f[o + 4] = sp.plan.w / 2;
        f[o + 5] = sp.plan.d / 2;
        f[o + 6] = Math.min(sp.plan.r, sp.plan.w / 2, sp.plan.d / 2);
        f[o + 7] = sp.sigma ?? 3.1;
        u[o + 12] = FX.halo;
        f[o + 15] = sp.shift ?? 1.04;
      } else {
        u[o + 3] = SPRITE.disc;
        f[o + 8] = sp.radius;
        f[o + 9] = sp.grow ?? 0;
        f[o + 10] = sp.opacity;
        f[o + 11] = sp.cap ?? 1;
        u[o + 12] = FX[sp.fx];
        f[o + 15] = sp.bias ?? 0;
      }
    });
    this.spritesDirty = false;
    return { buffer: this.spriteTable, count, dirty: true };
  }

  private writeInstance(
    k: number,
    model: Float32Array,
    style: number,
    flags: number,
    style2: number,
    mix: number,
    uShift: number,
  ) {
    const o = k * INSTANCE_FLOATS;
    this.f32.set(model, o);
    this.u32[o + 16] = style;
    this.u32[o + 17] = flags;
    this.u32[o + 18] = style2;
    this.f32[o + 19] = mix;
    this.f32[o + 20] = uShift;
    if (k < this.lo) this.lo = k;
    if (k + 1 > this.hi) this.hi = k + 1;
  }

  /** Ids currently registered (for messages and dev hooks). */
  ids(): string[] {
    return [...this.nodes.keys()].sort();
  }
}

function sameMatrix(a: Float32Array, b: Float32Array): boolean {
  for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function createSceneStore(): SceneStore {
  return new SceneStore();
}
