/**
 * Orthographic camera in the Anatomy kit's convention: z up, yaw (azimuth) 45°, elevation 30°.
 *
 * The kit projects a world point to screen pixels (y down) as
 *   X = x·sinA − y·cosA
 *   Y = (x·cosA + y·sinA)·sinE − z·cosE
 * times a scale, plus an origin (`iso-kit.mjs#iso`). That frame is a mirror image of a
 * right-handed camera, so triangle winding flips on screen: the renderer culls back faces with
 * front faces clockwise.
 *
 * State is `{ target, yaw, elevation, zoom }` so orbit/pan/zoom can drive it later; the
 * matrices are rebuilt from the state each frame.
 */
import { mat4, vec3 } from 'wgpu-matrix';

export const DEG = Math.PI / 180;
export const KIT_YAW = 45 * DEG;
export const KIT_ELEVATION = 30 * DEG;
/** The kit's light: `unit3([-sinA, cosA, 1.2])` (`lathe.mjs#lightOf`), fixed to the camera. */
const KIT_LIGHT_UP = 1.2;

export interface CameraState {
  /** World point shown at the centre of the viewport. */
  target: [number, number, number];
  /** Azimuth in radians. */
  yaw: number;
  /** Elevation in radians. */
  elevation: number;
  /** CSS pixels per world unit. */
  zoom: number;
}

export interface Viewport {
  /** Size in device pixels. */
  width: number;
  height: number;
  /** Device pixels per CSS pixel. */
  dpr: number;
}

export interface Basis {
  /** World direction that maps to screen +X (right). */
  right: [number, number, number];
  /** World direction that maps to screen up (−Y of the kit). */
  up: [number, number, number];
  /** World direction toward the viewer; larger = nearer (the kit's `viewOf`). */
  toward: [number, number, number];
}

export function basisOf(yaw: number, elevation: number): Basis {
  const sA = Math.sin(yaw);
  const cA = Math.cos(yaw);
  const sE = Math.sin(elevation);
  const cE = Math.cos(elevation);
  return {
    right: [sA, -cA, 0],
    up: [-cA * sE, -sA * sE, cE],
    toward: [cA * cE, sA * cE, sE],
  };
}

/** The kit formula at unit scale and zero origin: screen X right, Y down. */
export function kitProject(
  [x, y, z]: readonly [number, number, number],
  yaw = KIT_YAW,
  elevation = KIT_ELEVATION,
): [number, number] {
  const sA = Math.sin(yaw);
  const cA = Math.cos(yaw);
  return [x * sA - y * cA, (x * cA + y * sA) * Math.sin(elevation) - z * Math.cos(elevation)];
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/** The light in view space, from the kit's light at the kit camera. Constant under orbit. */
const LIGHT_VIEW = (() => {
  const b = basisOf(KIT_YAW, KIT_ELEVATION);
  const l = vec3.normalize([-Math.sin(KIT_YAW), Math.cos(KIT_YAW), KIT_LIGHT_UP]);
  return [dot(l, b.right), dot(l, b.up), dot(l, b.toward)] as const;
})();

/** World-space light direction for a camera: the camera-fixed light re-expressed in world. */
export function lightOf(state: Pick<CameraState, 'yaw' | 'elevation'>): [number, number, number] {
  const b = basisOf(state.yaw, state.elevation);
  const [lr, lu, lt] = LIGHT_VIEW;
  return [0, 1, 2].map((i) => lr * b.right[i]! + lu * b.up[i]! + lt * b.toward[i]!) as [
    number,
    number,
    number,
  ];
}

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
  /**
   * Optional tighter hull (xyz triples, e.g. the corners of every part's box): fits use these
   * points instead of the 8 corners of min/max.
   */
  points?: Float32Array;
}

function cornersOf({ min, max, points }: Bounds): [number, number, number][] {
  const out: [number, number, number][] = [];
  if (points && points.length >= 3) {
    for (let i = 0; i + 2 < points.length; i += 3) out.push([points[i]!, points[i + 1]!, points[i + 2]!]);
    return out;
  }
  for (const x of [min[0], max[0]])
    for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) out.push([x, y, z]);
  return out;
}

/**
 * Fit a box into the viewport (the kit's `fitProjection`): pick the zoom that makes the
 * projected box fill the viewport minus `pad` CSS px, and centre it.
 */
export function fitToBounds(
  bounds: Bounds,
  viewport: Viewport,
  { pad = 24, yaw = KIT_YAW, elevation = KIT_ELEVATION } = {},
): CameraState {
  const flat = cornersOf(bounds).map((p) => kitProject(p, yaw, elevation));
  const xs = flat.map(([x]) => x);
  const ys = flat.map(([, y]) => y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const cssW = viewport.width / viewport.dpr;
  const cssH = viewport.height / viewport.dpr;
  const zoom = Math.max(
    1e-6,
    Math.min((cssW - pad * 2) / (right - left || 1), (cssH - pad * 2) / (bottom - top || 1)),
  );
  // Any world point that projects to the box's screen centre works as the target; take the
  // box centre and slide it along the screen axes.
  const centre: [number, number, number] = [0, 1, 2].map(
    (i) => (bounds.min[i]! + bounds.max[i]!) / 2,
  ) as [number, number, number];
  const [cx, cy] = kitProject(centre, yaw, elevation);
  const dx = (left + right) / 2 - cx;
  const dy = (top + bottom) / 2 - cy;
  const b = basisOf(yaw, elevation);
  const target = [0, 1, 2].map((i) => centre[i]! + dx * b.right[i]! - dy * b.up[i]!) as [
    number,
    number,
    number,
  ];
  return { target, yaw, elevation, zoom };
}

export interface CameraMatrices {
  view: Float32Array;
  projection: Float32Array;
  viewProjection: Float32Array;
  light: [number, number, number];
}

export function createCameraMatrices(): CameraMatrices {
  return {
    view: mat4.identity(),
    projection: mat4.identity(),
    viewProjection: mat4.identity(),
    light: [0, 0, 1],
  };
}

/**
 * Build view/projection for a state. View space is (right, up, toward) about the target, so
 * screen X/Y match the kit exactly. The projection is an ortho box whose edges are shifted so
 * the world origin lands on a whole device pixel (crisp, stable edges while panning).
 * `depthRange` is the half-depth of the visible slab in world units.
 */
export function cameraMatrices(
  state: CameraState,
  viewport: Viewport,
  depthRange = 1000,
  out: CameraMatrices = createCameraMatrices(),
): CameraMatrices {
  const b = basisOf(state.yaw, state.elevation);
  const t = state.target;
  // Rows = basis vectors; translation moves the target to the origin. Column-major storage.
  mat4.set(
    b.right[0], b.up[0], b.toward[0], 0,
    b.right[1], b.up[1], b.toward[1], 0,
    b.right[2], b.up[2], b.toward[2], 0,
    -dot(b.right, t), -dot(b.up, t), -dot(b.toward, t), 1,
    out.view,
  );

  const s = state.zoom * viewport.dpr; // device px per world unit
  const halfW = viewport.width / 2;
  const halfH = viewport.height / 2;
  // Device-pixel position of the world origin; snap it to a whole pixel.
  const ox = halfW - s * dot(b.right, t);
  const oy = halfH + s * dot(b.up, t); // y down
  const sx = Math.round(ox) - ox;
  const sy = Math.round(oy) - oy;
  // px = s·Xv + halfW + sx  →  Xv range for px in [0, width].
  const left = -(halfW + sx) / s;
  const right = (viewport.width - halfW - sx) / s;
  // py = halfH − s·Yv + sy (Yv up)  →  py = 0 is the top.
  const top = (halfH + sy) / s;
  const bottom = (halfH + sy - viewport.height) / s;
  // View z = toward-viewer depth; wgpu-matrix ortho maps z = −near → 0 and z = −far → 1.
  mat4.ortho(left, right, bottom, top, -depthRange, depthRange, out.projection);
  mat4.multiply(out.projection, out.view, out.viewProjection);
  out.light = lightOf(state);
  return out;
}

/**
 * A named view: angles in degrees, zoom relative to the fit zoom at those angles, and an
 * optional world point to centre (default: the fitted centre).
 */
export interface ViewPreset {
  name: string;
  yaw: number;
  elevation: number;
  zoom: number;
  focus?: [number, number, number];
  /** Fit this world box (min, max corners) instead of the scene bounds; `zoom` multiplies it. */
  frame?: readonly [readonly [number, number, number], readonly [number, number, number]];
}

/** Camera for a view preset: fit the bounds (or the view's frame) at the view's angles, then
 * zoom and re-centre. */
export function viewCamera(bounds: Bounds, viewport: Viewport, view: ViewPreset): CameraState {
  const box: Bounds = view.frame
    ? { min: [...view.frame[0]], max: [...view.frame[1]] }
    : bounds;
  const fit = fitToBounds(box, viewport, {
    yaw: view.yaw * DEG,
    elevation: view.elevation * DEG,
  });
  return {
    target: view.focus ? [...view.focus] : fit.target,
    yaw: fit.yaw,
    elevation: fit.elevation,
    zoom: fit.zoom * view.zoom,
  };
}
