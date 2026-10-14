/**
 * The phone (v2 `parts/screen/phone.mjs` L9–274 with v2 A's options: `walls: "low"`, the display
 * at 560 shifted [−80, −24], the neck 72): the low tray the factory stands in, the display
 * floating face up above it, and the fluff dispenser hanging under it. Frame: the case floor's
 * centre (= world), z up. Plain module (no components).
 */
import { PHONE, type PhoneLayout, dispenserGeometry } from '@anatomy/engine';
import type { V3 } from '../kit.ts';

export { PHONE };

/** The case's plans: outer, inner (the wall's inside), with their corner radii. */
export function caseDims(p: PhoneLayout = PHONE) {
  const c = p.case;
  return {
    ...c,
    inner: { w: c.w - 2 * c.t, d: c.d - 2 * c.t, r: c.r - c.t },
  };
}

/**
 * A rounded rectangle's outline (counter-clockwise from the +x side's −y end), corner arcs as
 * `steps + 1` smooth points each; `cx, cy` its centre.
 */
export function roundedRing(w: number, d: number, r: number, steps = 8, cx = 0, cy = 0): { points: [number, number][]; smooth: boolean[] } {
  const pts: [number, number][] = [];
  const corners: [number, number, number][] = [
    [w / 2 - r, -d / 2 + r, -90],
    [w / 2 - r, d / 2 - r, 0],
    [-w / 2 + r, d / 2 - r, 90],
    [-w / 2 + r, -d / 2 + r, 180],
  ];
  for (const [x, y, a0] of corners) {
    for (let i = 0; i <= steps; i++) {
      const a = ((a0 + (90 * i) / steps) * Math.PI) / 180;
      pts.push([cx + x + r * Math.cos(a), cy + y + r * Math.sin(a)]);
    }
  }
  return { points: pts, smooth: pts.map(() => true) };
}

/**
 * The band (v2's low tray: two clean pieces, far and near): a ring between the outer and the
 * inner outline, split where the far half (−x side, −y end) meets the near half, at the middle of
 * the (+x, −y) and (−x, +y) corners. Each half is one concave polygon (outer path, then the
 * inner path back), so no joint shows but those two, on the silhouette.
 */
export function bandHalves(p: PhoneLayout = PHONE, steps = 8) {
  const c = caseDims(p);
  const outer = roundedRing(c.w, c.d, c.r, steps).points;
  const inner = roundedRing(c.inner.w, c.inner.d, c.inner.r, steps).points;
  const per = steps + 1;
  const half = Math.round(steps / 2);
  // Corner k's arc starts at k·per; the split points: corner 0 (+x, −y) and corner 2 (−x, +y).
  const s0 = 0 * per + half;
  const s2 = 2 * per + half;
  const piece = (from: number, to: number) => {
    const o: [number, number][] = [];
    const i: [number, number][] = [];
    for (let k = from; k <= to; k++) {
      o.push(outer[k % outer.length]!);
      i.push(inner[k % inner.length]!);
    }
    const polygon = [...o, ...i.reverse()];
    // Every point is on a curve or a straight run: no creases except the cut ends.
    const smooth = polygon.map((_, k) => k !== 0 && k !== o.length - 1 && k !== o.length && k !== polygon.length - 1);
    return { polygon, smooth };
  };
  return { near: piece(s0, s2), far: piece(s2, s0 + outer.length) };
}

/** The display's plans (shifted): OLED inset 3, glass inset 0.8; their heights. */
export function displayDims(p: PhoneLayout = PHONE) {
  const c = p.case;
  const [sx, sy] = p.shift;
  const DZ = p.displayZ;
  const Z1 = DZ + 3.4;
  const Z2 = Z1 + 1.6;
  // The screen art (v2: laid out for a 130-wide display, scale s; the logo above the middle).
  const SW = c.w - 13;
  const SD = c.d - 13;
  const s = SW / 130;
  return { c, sx, sy, DZ, Z1, Z2, SW, SD, SR: c.r - 6.5, s, LY: -SD * 0.04 };
}

export function dispenserDims(p: PhoneLayout = PHONE) {
  const g = dispenserGeometry(p);
  const [dx, dy] = p.dispenser;
  const VB = { x0: dx - 7, x1: dx + 7, y0: dy - 6, y1: dy + 6, z0: g.valve[0], z1: g.valve[1] };
  return { g, dx, dy, VB, VC: [dx, VB.y1, g.valveMid] as V3, cageR: 4.4, rod: 0.45 };
}

/** The screen meter's cells (v2 controls: 4 cells under the logo, right of the play button). */
export const METER_CELLS = 4;
/** Whether the screen shows the meter (M11, the user: hidden; the code stays). */
export const SCREEN_METER = false;
/**
 * M12: the iOS status bar on the screen (`statusBar.ts`, traced from the simulator's), so the loop
 * video's splash continues into the simulator's real one. 'film': only in film mode (at the normal
 * `phone` view it would sit well below the rendered island, where the splash framing puts it).
 */
export const SCREEN_STATUS_BAR: boolean | 'film' = 'film';
/**
 * M12: with the status bar, the island is drawn as the simulator's Dynamic Island (flat black,
 * no camera dot): 94.8 × 36.8 pt, centre 32.3 pt down in the recording at the splash camera C0
 * (zoom 1.42002 pt/unit), so the hardware island the simulator draws over the recording hides it.
 * Screen-art units: size, centre y, corner radius (a stadium).
 */
export const FILM_ISLAND = { w: 66.78, h: 25.94, y: -347.9 } as const;
