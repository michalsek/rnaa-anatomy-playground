/**
 * React "lego" blocks: each one registers a node in the SceneStore from a layout effect and
 * renders null (groups render their children under a new id path). Structure and params only;
 * per-frame motion goes through `useFrame` + `useNode` handles, never through React state.
 */
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  type DotSpec,
  type FrameInfo,
  type FxName,
  type GeoSpec,
  type GroupHandle,
  type LineTone,
  type LineSetSpec,
  type MarksSpec,
  type Material,
  type PartHandle,
  type Plan,
  type PoolHandle,
  type ProfilePoint,
  type BandSpec,
  type SegmentSpec,
  type SpriteHandle,
  type SpriteSpec,
  type StyleSpec,
  type ToneRule,
  type Transform,
  type Vec3,
  geoKey,
  lodSteps,
  stableKey,
} from '@anatomy/engine';
import { SceneContext, joinId, useScene } from './context.ts';

export interface Placement {
  position?: Vec3;
  /** Euler degrees, applied X then Y then Z. */
  rotation?: Vec3;
  scale?: number;
}

export interface StyleProps {
  material: Material;
  outline?: LineTone;
  crease?: LineTone;
  width?: number;
  tone?: ToneRule;
  gradient?: StyleSpec['gradient'];
}

interface PartProps extends Placement, StyleProps {
  id: string;
  /** Contact lines with other parts (default: the enclosing group's `contacts`, else true). */
  contacts?: boolean;
  /** Gets a PartHandle (`useNode`): its blend and line-set shift change per frame. */
  live?: boolean;
  /** The style a live part blends toward (E2). */
  blend?: StyleProps;
}

const transformOf = ({ position, rotation, scale }: Placement): Transform => ({
  ...(position && { position }),
  ...(rotation && { rotation }),
  ...(scale !== undefined && { scale }),
});

const styleOf = ({ material, outline, crease, width, tone, gradient }: StyleProps): StyleSpec => ({
  material,
  ...(outline && { outline }),
  ...(crease && { crease }),
  ...(width !== undefined && { width }),
  ...(tone && { tone }),
  ...(gradient && { gradient }),
});

const parentOf = (path: string | null) => (path ? { parent: path } : {});

function usePart(props: PartProps, geo: GeoSpec) {
  const { store, path, contacts: groupContacts } = useScene();
  const full = joinId(path, props.id);
  const transform = transformOf(props);
  const style = styleOf(props);
  const contacts = props.contacts ?? groupContacts;
  const live = props.live ?? false;
  const blend = props.blend ? styleOf(props.blend) : null;
  const gk = geoKey(geo);
  const sk = stableKey({ style, blend });
  const tk = stableKey(transform);
  useLayoutEffect(() => {
    const token = store.part(full, { ...parentOf(path), geo, style, transform, contacts, live, ...(blend && { blend }) });
    return () => store.remove(full, token);
    // The keys stand for geo, style and transform.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, full, path, gk, sk, tk, contacts, live]);
  return null;
}

// ---- groups ----------------------------------------------------------------------------------

export function Group({
  id,
  moves = false,
  contacts,
  children,
  ...placement
}: Placement & {
  id: string;
  moves?: boolean;
  /** Default `contacts` for the parts below (inherited when omitted). */
  contacts?: boolean;
  children?: ReactNode;
}) {
  const { store, path, contacts: inherited } = useScene();
  const full = joinId(path, id);
  const transform = transformOf(placement);
  const tk = stableKey(transform);
  useLayoutEffect(() => {
    const token = store.group(full, { ...parentOf(path), transform, moves });
    return () => store.remove(full, token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, full, path, tk, moves]);
  const below = contacts ?? inherited;
  const value = useMemo(() => ({ store, path: full, contacts: below }), [store, full, below]);
  return <SceneContext.Provider value={value}>{children}</SceneContext.Provider>;
}

/** A machine's root group; ids below resolve relative to it. */
export const Machine = Group;

// ---- solids ----------------------------------------------------------------------------------

/** `lines`: a UV line set on the sides (u = perimeter fraction, v = model z; E6 `stripes`). */
export function Box(props: PartProps & { size: Vec3; center?: Vec3; r?: number; seams?: number[]; lines?: LineSetSpec }) {
  const { size, center, r, seams, lines } = props;
  return usePart(props, {
    kind: 'box',
    size,
    ...(center && { center }),
    ...(r !== undefined && { r }),
    ...(seams && { seams }),
    ...(lines && { lines }),
  });
}

export function Extrude(props: PartProps & { plan: Plan; z?: number; height: number; seams?: number[]; lines?: LineSetSpec }) {
  const { z, height, seams, lines } = props;
  // E9: a circle's segments by radius (an explicit count is capped by the LOD too).
  const plan: Plan = 'circle' in props.plan ? { ...props.plan, steps: lodSteps(props.plan.circle, props.plan.steps) } : props.plan;
  return usePart(props, {
    kind: 'extrude',
    plan,
    height,
    ...(z !== undefined && { z }),
    ...(seams && { seams }),
    ...(lines && { lines }),
  });
}

export function Lathe(
  props: PartProps & {
    profile: readonly ProfilePoint[];
    steps?: number;
    seams?: number[];
    marks?: number[];
    lineSets?: readonly { segment: number; lines: LineSetSpec }[];
    subdivisions?: number;
  },
) {
  const { profile, seams, marks, lineSets, subdivisions } = props;
  // E9: segments by radius (an explicit count is capped by the LOD too).
  let maxR = 0;
  for (const p of profile) maxR = Math.max(maxR, Math.abs(p[0]));
  const steps = lodSteps(maxR, props.steps);
  return usePart(props, {
    kind: 'lathe',
    profile,
    steps,
    ...(seams && { seams }),
    ...(marks && { marks }),
    ...(lineSets && { lineSets }),
    ...(subdivisions !== undefined && { subdivisions }),
  });
}

export function Tube(
  props: PartProps & {
    path: readonly Vec3[];
    radius: number;
    sides?: number;
    bend?: number;
    caps?: readonly [boolean, boolean];
    closed?: boolean;
    /** A piece of the tube between two arc lengths (see `TubeSpec.range`). */
    range?: readonly [number, number];
  },
) {
  const { path, radius, sides, bend, caps, closed, range } = props;
  return usePart(props, {
    kind: 'tube',
    path,
    radius,
    ...(sides !== undefined && { sides }),
    ...(bend !== undefined && { bend }),
    ...(caps && { caps }),
    ...(closed !== undefined && { closed }),
    ...(range && { range }),
  });
}

export function Belt(props: PartProps & { a: Vec3; ra: number; b: Vec3; rb: number; radius: number }) {
  const { a, ra, b, rb, radius } = props;
  return usePart(props, { kind: 'belt', a, ra, b, rb, radius });
}

/**
 * A conveyor belt band round two drums (E1): `lines.outer` / `lines.inner` are the slats; give it
 * `live` and set `uShift` per frame to scroll them.
 */
export function Band(
  props: PartProps & BandSpec & { lines?: { outer?: LineSetSpec; inner?: LineSetSpec } },
) {
  const { axis, dir, L, R, thickness, across, zc, steps, lines } = props;
  return usePart(props, {
    kind: 'band',
    axis,
    dir,
    L,
    R,
    thickness,
    across,
    zc,
    ...(steps !== undefined && { steps }),
    ...(lines && { lines }),
  });
}

// ---- pools and marks -------------------------------------------------------------------------

export function Instances({
  id,
  geo,
  styles,
  capacity,
  marks,
  scalable = false,
  ...placement
}: Placement & {
  id: string;
  geo: GeoSpec;
  styles: StyleProps[];
  capacity: number;
  marks?: MarksSpec;
  /** E3: instances take an axis-aligned scale (`PoolHandle.scale`). */
  scalable?: boolean;
}) {
  const { store, path } = useScene();
  const full = joinId(path, id);
  const transform = transformOf(placement);
  const resolved = styles.map(styleOf);
  const keys = [geoKey(geo), stableKey(resolved), stableKey(transform), stableKey(marks ?? null)].join('|');
  useLayoutEffect(() => {
    const token = store.pool(full, {
      ...parentOf(path),
      geo,
      styles: resolved,
      capacity,
      transform,
      scalable,
      ...(marks && { marks }),
    });
    return () => store.remove(full, token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, full, path, keys, capacity, scalable]);
  return null;
}

export function Marks({
  id,
  material,
  dots,
  segments,
  ...placement
}: Placement & { id: string; material: Material; dots?: readonly DotSpec[]; segments?: readonly SegmentSpec[] }) {
  const { store, path } = useScene();
  const full = joinId(path, id);
  const transform = transformOf(placement);
  const key = stableKey({ material, dots, segments, transform });
  useLayoutEffect(() => {
    const token = store.marks(full, {
      ...parentOf(path),
      transform,
      material,
      ...(dots && { dots }),
      ...(segments && { segments }),
    });
    return () => store.remove(full, token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, full, path, key]);
  return null;
}

// ---- sprites ---------------------------------------------------------------------------------

function useSprite(id: string, placement: Placement, spec: SpriteSpec) {
  const { store, path } = useScene();
  const full = joinId(path, id);
  const transform = transformOf(placement);
  const key = stableKey({ spec, transform });
  useLayoutEffect(() => {
    const token = store.sprite(full, { ...parentOf(path), transform, ...spec });
    return () => store.remove(full, token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, full, path, key]);
  return null;
}

/** The kit's soft floor shadow under a plan (rounded rect centred on the node's origin). */
export function Halo({
  id,
  plan,
  sigma,
  shift,
  ...placement
}: Placement & { id: string; plan: { w: number; d: number; r: number }; sigma?: number; shift?: number }) {
  return useSprite(id, placement, {
    kind: 'halo',
    plan,
    ...(sigma !== undefined && { sigma }),
    ...(shift !== undefined && { shift }),
  });
}

/** A screen-facing glow disc at the node's origin; its `level` is live via `useNode`. */
export function Glow({
  id,
  fx,
  radius,
  grow,
  opacity,
  cap,
  blend,
  bias,
  level,
  ...placement
}: Placement & {
  id: string;
  fx: FxName;
  radius: number;
  grow?: number;
  opacity: number;
  cap?: number;
  blend: 'normal' | 'glow';
  bias?: number;
  level?: number;
}) {
  return useSprite(id, placement, {
    kind: 'disc',
    fx,
    radius,
    opacity,
    blend,
    ...(grow !== undefined && { grow }),
    ...(cap !== undefined && { cap }),
    ...(bias !== undefined && { bias }),
    ...(level !== undefined && { level }),
  });
}

// ---- per-frame hooks -------------------------------------------------------------------------

/** Run `cb` every frame (scene time). Never set React state in it. */
export function useFrame(cb: (f: FrameInfo) => void): void {
  const { store } = useScene();
  const ref = useRef(cb);
  useLayoutEffect(() => {
    ref.current = cb;
  });
  useEffect(() => store.onFrame((f) => ref.current(f)), [store]);
}

/**
 * A lazy getter for a moving group, live part, pool or sprite below the current group; resolves
 * on first call.
 */
export function useNode<H extends GroupHandle | PartHandle | PoolHandle | SpriteHandle>(relId: string): () => H {
  const { store, path } = useScene();
  const full = joinId(path, relId);
  return useMemo(() => {
    let handle: H | null = null;
    return () => {
      handle ??= store.node(full) as H;
      return handle;
    };
  }, [store, full]);
}
