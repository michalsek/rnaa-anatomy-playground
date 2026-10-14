/**
 * The loop video's camera maths (M12, notes/M12-plan.md §1–§2): pure functions, no renderer.
 *
 * - `screenCamera`: the top-down camera that puts the closed phone's glass where the next part
 *   of the film needs it (filling the output's height on web, a rectangle of the simulator's
 *   screen on iOS).
 * - `filmBand` / `filmFrame`: the 16:9 band every fit goes into (a centred 16:9 rectangle, at
 *   most `width` wide, lifted by `dy`) and the frame spec that fits into it minus a 2.5% margin.
 * - `cameraLerp`, `smootherstep`: the scripted moves (log zoom, shortest yaw).
 * - `glassRect` / `filmGeometry`: the pixel geometry the compositor needs (the glass on screen,
 *   the simulator's glass, the scale between them and the zoom that fills the output with the
 *   simulator's band).
 *
 * Top-down (yaw 90°, elevation 90°): `basisOf` gives right = +x, up = −y, so the phone's island
 * (at −y) is at the top of the screen and no roll is needed.
 */
import { type CameraState, DEG, type FrameSpec, basisOf } from './camera.ts';

export const FILM = {
  /** The output's width in px (the line rule's reference: 1 px lines at the fit). */
  outW: 1920,
  outH: 1080,
  aspect: 16 / 9,
  /** The fit's margin inside the band, per side, as a fraction of the band. */
  margin: 0.025,
  fps: 60,
  /** The web glass's inset from the output's top and bottom (px at 1080p). */
  inset: 40,
} as const;

/** The closed phone's glass: plan size (world units), corner radius, the height of its top face. */
export interface Glass {
  w: number;
  d: number;
  r: number;
  z: number;
}

export interface ScreenCameraOptions {
  /** Which side of the glass `size` measures. */
  fill: 'width' | 'height';
  /** The glass's size on screen along that side, CSS px (points on iOS). */
  size: number;
  /** Lift the glass's centre above the viewport's centre by this many CSS px (negative: lower). */
  dy?: number;
}

/** Top-down camera with the glass centred (lifted by `dy`) at the given on-screen size. */
export function screenCamera(glass: Glass, o: ScreenCameraOptions): CameraState {
  const zoom = o.size / (o.fill === 'width' ? glass.w : glass.d);
  // Screen up is world −y at the top-down camera: lifting the glass moves the target to +y.
  return { target: [0, (o.dy ?? 0) / zoom, glass.z], yaw: 90 * DEG, elevation: 90 * DEG, zoom };
}

export interface CssRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BandOptions {
  /** Lift the band's centre above the viewport's centre (CSS px). */
  dy?: number;
  /** The band's widest (CSS px; default the viewport's width). */
  width?: number;
}

/** The largest centred 16:9 rectangle of the viewport (at most `width` wide), lifted by `dy`. */
export function filmBand(vp: { width: number; height: number }, o: BandOptions = {}): CssRect {
  const w = Math.min(o.width ?? vp.width, vp.width, vp.height * FILM.aspect);
  const h = w / FILM.aspect;
  return { x: (vp.width - w) / 2, y: vp.height / 2 - (o.dy ?? 0) - h / 2, w, h };
}

/** Where film fits go: the band minus the margin on every side, as exact pads (no aspect refit). */
export function filmFrame(vp: { width: number; height: number }, o: BandOptions & { margin?: number } = {}): FrameSpec {
  const m = o.margin ?? FILM.margin;
  const b = filmBand(vp, o);
  const l = b.x + m * b.w;
  const t = b.y + m * b.h;
  return { pad: { t, r: vp.width - (b.x + b.w) + m * b.w, b: vp.height - (b.y + b.h) + m * b.h, l }, aspect: null };
}

/**
 * Lines in proportion to the band: `pxPerCss = dpr · scale · zoom / ref` with scale = the band's
 * width (CSS px) over the output's, so a line is the same fraction of the band on every device.
 */
export const filmLineScale = (vp: { width: number; height: number }, o: BandOptions = {}) => filmBand(vp, o).w / FILM.outW;

/** 0 → 1 with zero first and second derivatives at both ends. */
export function smootherstep(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

const TAU = Math.PI * 2;
const wrap = (a: number) => {
  let d = a % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
};

/** a → b at u: target and elevation linear, zoom in log space, yaw the shortest way. */
export function cameraLerp(a: CameraState, b: CameraState, u: number, out: CameraState): CameraState {
  for (let i = 0; i < 3; i++) out.target[i] = a.target[i]! + (b.target[i]! - a.target[i]!) * u;
  out.zoom = Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * u);
  out.yaw = u >= 1 ? b.yaw : a.yaw + wrap(b.yaw - a.yaw) * u;
  out.elevation = a.elevation + (b.elevation - a.elevation) * u;
  return out;
}

/**
 * Where a world point lands on screen (CSS px) for a camera and a viewport, as the renderer
 * draws it (without its sub-pixel origin snap: under half a device px).
 */
export function projectCss(state: CameraState, vp: { width: number; height: number }, p: readonly [number, number, number]): [number, number] {
  const b = basisOf(state.yaw, state.elevation);
  const d = [p[0] - state.target[0], p[1] - state.target[1], p[2] - state.target[2]];
  const x = d[0]! * b.right[0] + d[1]! * b.right[1] + d[2]! * b.right[2];
  const y = d[0]! * b.up[0] + d[1]! * b.up[1] + d[2]! * b.up[2];
  return [vp.width / 2 + state.zoom * x, vp.height / 2 - state.zoom * y];
}

/** The glass's bounding rectangle on screen in device px (the corners' hull) for a camera. */
export function glassRect(state: CameraState, vp: { width: number; height: number; dpr: number }, glass: Glass): CssRect {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const [x, y] = projectCss(state, vp, [(sx * glass.w) / 2, (sy * glass.d) / 2, glass.z]);
      xs.push(x * vp.dpr);
      ys.push(y * vp.dpr);
    }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * The simulator's splash (C0): the glass *covers* the screen (the user: a plain full-screen splash,
 * no case, paper or bevel), so only the screen art shows: the glass's height fill times `cover`,
 * its centre lifted `dy` points (negative: lowered). The rendered island sits where the
 * simulator's Dynamic Island is (centre 32 pt down), so the status bar the screen art draws in film
 * mode (traced from the simulator's, `machines/phone/statusBar.ts`) sits beside it as on a phone;
 * the art's edge line, its corners and the home indicator fall outside the screen (tests).
 */
export const SIM_SPLASH = { cover: 1.2322, dy: -89.36 } as const;

export function simCamera(glass: Glass, simCss: { width: number; height: number }, o: { cover: number; dy: number } = SIM_SPLASH): CameraState {
  return screenCamera(glass, { fill: 'height', size: o.cover * simCss.height, dy: o.dy });
}

/** A screen point (CSS px) back to the world at a top-down camera (on the glass's plane). */
function unprojectTopDown(c: CameraState, vp: { width: number; height: number }, x: number, y: number): [number, number] {
  // Top-down (yaw 90°, elevation 90°): screen x = W/2 + zoom·(wx − tx), screen y = H/2 + zoom·(wy − ty).
  return [c.target[0] + (x - vp.width / 2) / c.zoom, c.target[1] + (y - vp.height / 2) / c.zoom];
}

/**
 * Everything the compositor needs, in output px (1920 × 1080) and simulator px: the web glass G
 * at C1 (filling the output's height minus `FILM.inset` top and bottom); the simulator's screen
 * at its splash camera C0 mapped into the output (`screen`: where the recording goes, inside G),
 * the scale between them; the simulator's band (its full width, centred on the glass's centre,
 * CSS px), its place in the output, and the zoom S that makes it fill the output.
 */
export function filmGeometry(glass: Glass, sim: { width: number; height: number; dpr: number }, o: { cover: number; dy: number } = SIM_SPLASH) {
  const out = { width: FILM.outW, height: FILM.outH, dpr: 1 };
  const c1 = screenCamera(glass, { fill: 'height', size: FILM.outH - 2 * FILM.inset });
  const G = glassRect(c1, out, glass);
  const simCss = { width: sim.width / sim.dpr, height: sim.height / sim.dpr };
  const c0 = simCamera(glass, simCss, o);
  // A simulator point (device px) → the world → the output (px).
  const toOut = (x: number, y: number) => {
    const [wx, wy] = unprojectTopDown(c0, simCss, x / sim.dpr, y / sim.dpr);
    return projectCss(c1, out, [wx, wy, glass.z]);
  };
  const [sx0, sy0] = toOut(0, 0);
  const [sx1, sy1] = toOut(sim.width, sim.height);
  const screen = { x: sx0, y: sy0, w: sx1 - sx0, h: sy1 - sy0 };
  const scale = screen.w / sim.width;
  const bandOpts = { dy: o.dy };
  const band = filmBand(simCss, bandOpts);
  const [bx0, by0] = toOut(band.x * sim.dpr, band.y * sim.dpr);
  const bandOut = { x: bx0, y: by0, w: band.w * sim.dpr * scale, h: band.h * sim.dpr * scale };
  return { G, c1, c0, screen, scale, dy: o.dy, bandOpts, band, bandOut, S: FILM.outW / bandOut.w, glassR: glass.r * c1.zoom };
}
