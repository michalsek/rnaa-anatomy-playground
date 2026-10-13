// The paint table shared by the static scene and the live slots: probe recipes (CSS chains) or linear gradients keyed
// like the exporter's palette, their resolved colours, and the opaque / blended / hidden class the renderer sorts by.
// Colours come from a PaintResolver (web: getComputedStyle on probe elements; a native host: a table resolved at
// export time), so nothing here touches the DOM.

/** One node of a probe chain: the element is recreated where the figure lived so the CSS cascade resolves it. */
export interface ChainNode {
  tag: string;
  attrs: Record<string, string>;
}

export type BlendMode = 'normal' | 'multiply' | 'screen';
export type LineCap = 'round' | 'butt' | 'square';
export type PaintProp = 'fill' | 'stroke' | 'stop-color';
export type Rgba = [number, number, number, number];

/** A CSS probe: `ancestors… > el` resolved for `prop` (export/build-dl.mjs palette entry). */
export interface ProbeDesc {
  kind: 'probe';
  prop: PaintProp;
  ancestors: ChainNode[];
  el: ChainNode;
}

/** A user-space linear gradient; `paint` is the filled element's own fill probe, each stop a stop-color probe. */
export interface LinearDesc {
  kind: 'linear';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  paint: number;
  stops: { offset: number; alpha: number; paint: number }[];
}

export type PaintDesc = ProbeDesc | LinearDesc;

/** What a resolver reports for one probe. */
export interface ProbedPaint {
  /** Straight sRGB-encoded colour 0..1, or null for `none`. */
  color: Rgba | null;
  /** CSS opacity of the element and its probe ancestors × the prop's own -opacity. */
  alpha: number;
  /** Computed stroke-width (CSS px) and caps (stroke probes). */
  width: number;
  cap: LineCap;
  blend: BlendMode;
  /**
   * CSS filter blur (std deviation) and the translation of the computed transform, in the `px` of the element's own
   * coordinate system: SVG user units, i.e. viewBox units (not screen CSS px).
   */
  blur: number;
  translate: [number, number];
}

export interface PaintResolver {
  /** Resolves every probe in one batch (one style recalculation in a DOM host). */
  resolve(probes: ProbeDesc[]): ProbedPaint[];
}

export interface ResolvedPaint {
  /** Straight colour; alpha includes the CSS opacity chain (and, for a gradient, the element's own opacity). */
  rgba: Rgba;
  visible: boolean;
  width: number;
  cap: LineCap;
  blend: BlendMode;
  blur: number;
  translate: [number, number];
  /** Linear gradients only: resolved stops (stop alpha folded in). */
  stops?: { offset: number; rgba: Rgba }[];
}

export interface PaintClass {
  visible: boolean;
  /** Fully opaque with normal blending at every point: drawn with the depth-writing fills. */
  opaque: boolean;
  blend: BlendMode;
}

/** Alpha at or above this counts as opaque (8-bit output cannot show the difference). */
export const OPAQUE_ALPHA = 0.999;

export const isOpaqueAlpha = (alpha: number) => alpha >= OPAQUE_ALPHA;

export function classifyPaint(paint: ResolvedPaint): PaintClass {
  const stopsOpaque = paint.stops?.every((stop) => isOpaqueAlpha(stop.rgba[3])) ?? true;
  return { visible: paint.visible, opaque: paint.visible && paint.blend === 'normal' && isOpaqueAlpha(paint.rgba[3]) && stopsOpaque, blend: paint.blend };
}

const HIDDEN: ResolvedPaint = { rgba: [0, 0, 0, 0], visible: false, width: 0, cap: 'butt', blend: 'normal', blur: 0, translate: [0, 0] };

/**
 * Every paint the renderer knows, by id. Ids are stable for the table's lifetime: the static palette first (DL
 * palette ids), gradients, then paints discovered in live slots. New entries stay unresolved (drawn as hidden) until
 * `resolvePending` resolves them all in one batch.
 */
export class PaintTable {
  readonly descs: PaintDesc[] = [];
  readonly resolved: ResolvedPaint[] = [];
  readonly classes: PaintClass[] = [];
  private readonly byKey = new Map<string, number>();
  private pending: number[] = [];
  /** Bumped whenever colours or the entry count change (the GPU paint buffer follows it). */
  version = 0;
  /**
   * Bumped whenever a resolved paint's class changes (geometry sorted by class must be rebuilt). A paint's first
   * resolution does not count: nothing was built with it yet.
   */
  classVersion = 0;
  /**
   * Bumped whenever a resolved paint draws differently (colour, width, cap, blend, blur, translate, gradient stops):
   * every cached rendering of it is stale. First resolutions do not count.
   */
  appearanceVersion = 0;
  /** Bumped whenever a resolved paint's class, width or cap changes: geometry built from them (stroke pads, cap flags). */
  geometryVersion = 0;
  private readonly settled: boolean[] = [];

  get size() {
    return this.descs.length;
  }

  get hasPending() {
    return this.pending.length > 0;
  }

  /** Id of the paint with this key; `describe` builds its recipe only when the key is new. */
  idOf(key: string, describe: () => PaintDesc): number {
    const known = this.byKey.get(key);
    if (known !== undefined) return known;
    const id = this.descs.length;
    this.descs.push(describe());
    this.resolved.push(HIDDEN);
    this.classes.push(classifyPaint(HIDDEN));
    this.byKey.set(key, id);
    this.pending.push(id);
    return id;
  }

  /** Resolves the entries added since the last call; returns how many were resolved. */
  resolvePending(resolver: PaintResolver): number {
    if (!this.pending.length) return 0;
    const ids = this.pending;
    this.pending = [];
    this.resolveIds(resolver, ids);
    return ids.length;
  }

  /** Re-resolves every entry (theme change); returns whether any class changed. */
  resolveAll(resolver: PaintResolver): boolean {
    this.pending = [];
    const before = this.classVersion;
    this.resolveIds(resolver, this.descs.map((_, id) => id));
    return this.classVersion !== before;
  }

  private resolveIds(resolver: PaintResolver, ids: number[]) {
    // gradients read their own and their stops' probes: resolve those probes too, even when they are not new
    const probeIds = new Set<number>();
    for (const id of ids) {
      const desc = this.descs[id];
      if (desc.kind === 'probe') probeIds.add(id);
      else {
        probeIds.add(desc.paint);
        for (const stop of desc.stops) probeIds.add(stop.paint);
      }
    }
    const probeList = [...probeIds];
    const probed = resolver.resolve(probeList.map((id) => this.descs[id] as ProbeDesc));
    const byId = new Map(probeList.map((id, i) => [id, probed[i]]));
    probeList.forEach((id, i) => this.store(id, resolvedProbe(this.descs[id] as ProbeDesc, probed[i])));
    for (const id of ids) {
      const desc = this.descs[id];
      if (desc.kind === 'linear') this.store(id, resolvedLinear(desc, byId));
    }
    this.version++;
  }

  private store(id: number, paint: ResolvedPaint) {
    const next = classifyPaint(paint);
    if (this.settled[id]) {
      const previous = this.classes[id];
      const before = this.resolved[id];
      const classChanged = previous.visible !== next.visible || previous.opaque !== next.opaque || previous.blend !== next.blend;
      if (classChanged) this.classVersion++;
      if (classChanged || before.width !== paint.width || before.cap !== paint.cap) this.geometryVersion++;
      if (!drawsAlike(before, paint)) this.appearanceVersion++;
    }
    this.settled[id] = true;
    this.resolved[id] = paint;
    this.classes[id] = next;
  }
}

const sameRgba = (a: Rgba, b: Rgba) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

function drawsAlike(a: ResolvedPaint, b: ResolvedPaint): boolean {
  if (a.visible !== b.visible || a.width !== b.width || a.cap !== b.cap || a.blend !== b.blend || a.blur !== b.blur) return false;
  if (a.translate[0] !== b.translate[0] || a.translate[1] !== b.translate[1] || !sameRgba(a.rgba, b.rgba)) return false;
  const stopsA = a.stops ?? [];
  const stopsB = b.stops ?? [];
  return stopsA.length === stopsB.length && stopsA.every((stop, i) => stop.offset === stopsB[i].offset && sameRgba(stop.rgba, stopsB[i].rgba));
}

function resolvedProbe(desc: ProbeDesc, probe: ProbedPaint): ResolvedPaint {
  const { color } = probe;
  const rgba: Rgba = color ? [color[0], color[1], color[2], color[3] * probe.alpha] : [0, 0, 0, 0];
  const drawsStroke = desc.prop !== 'stroke' || probe.width > 0;
  return { rgba, visible: !!color && rgba[3] > 0 && drawsStroke, width: probe.width, cap: probe.cap, blend: probe.blend, blur: probe.blur, translate: probe.translate };
}

function resolvedLinear(desc: LinearDesc, probes: Map<number, ProbedPaint>): ResolvedPaint {
  const probeOf = (id: number) => {
    const probe = probes.get(id);
    if (!probe) throw new Error(`paint table: gradient probe ${id} was not resolved`);
    return probe;
  };
  const own = probeOf(desc.paint);
  const stops = desc.stops.map((stop) => {
    const probe = probeOf(stop.paint);
    const c = probe.color ?? [0, 0, 0, 0];
    return { offset: stop.offset, rgba: [c[0], c[1], c[2], c[3] * probe.alpha * stop.alpha] as Rgba };
  });
  return { rgba: [1, 1, 1, own.alpha], visible: own.alpha > 0, width: 0, cap: 'butt', blend: own.blend, blur: own.blur, translate: own.translate, stops };
}
