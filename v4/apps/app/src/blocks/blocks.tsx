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
  type Plan,
  type PoolHandle,
  type ProfilePoint,
  type SegmentSpec,
  type SpriteHandle,
  type SpriteSpec,
  type StyleSpec,
  type ToneRule,
  type Transform,
  type Vec3,
  geoKey,
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
  const gk = geoKey(geo);
  const sk = stableKey(style);
  const tk = stableKey(transform);
  useLayoutEffect(() => {
    const token = store.part(full, { ...parentOf(path), geo, style, transform, contacts });
    return () => store.remove(full, token);
    // The keys stand for geo, style and transform.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, full, path, gk, sk, tk, contacts]);
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

export function Box(props: PartProps & { size: Vec3; center?: Vec3; r?: number; seams?: number[] }) {
  const { size, center, r, seams } = props;
  return usePart(props, {
    kind: 'box',
    size,
    ...(center && { center }),
    ...(r !== undefined && { r }),
    ...(seams && { seams }),
  });
}

export function Extrude(props: PartProps & { plan: Plan; z?: number; height: number; seams?: number[] }) {
  const { plan, z, height, seams } = props;
  return usePart(props, {
    kind: 'extrude',
    plan,
    height,
    ...(z !== undefined && { z }),
    ...(seams && { seams }),
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
  const { profile, steps, seams, marks, lineSets, subdivisions } = props;
  return usePart(props, {
    kind: 'lathe',
    profile,
    ...(steps !== undefined && { steps }),
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
  },
) {
  const { path, radius, sides, bend, caps, closed } = props;
  return usePart(props, {
    kind: 'tube',
    path,
    radius,
    ...(sides !== undefined && { sides }),
    ...(bend !== undefined && { bend }),
    ...(caps && { caps }),
    ...(closed !== undefined && { closed }),
  });
}

export function Belt(props: PartProps & { a: Vec3; ra: number; b: Vec3; rb: number; radius: number }) {
  const { a, ra, b, rb, radius } = props;
  return usePart(props, { kind: 'belt', a, ra, b, rb, radius });
}

// ---- pools and marks -------------------------------------------------------------------------

export function Instances({
  id,
  geo,
  styles,
  capacity,
  marks,
  ...placement
}: Placement & { id: string; geo: GeoSpec; styles: StyleProps[]; capacity: number; marks?: MarksSpec }) {
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
      ...(marks && { marks }),
    });
    return () => store.remove(full, token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, full, path, keys, capacity]);
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

/** A lazy getter for a moving group, pool or sprite below the current group; resolves on first call. */
export function useNode<H extends GroupHandle | PoolHandle | SpriteHandle>(relId: string): () => H {
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
