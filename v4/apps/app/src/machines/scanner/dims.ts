/**
 * Scanner dimensions, from v2 `parts/scanner/scanner.mjs` (build L21–147). The live numbers are
 * the sim's (`SC` in the engine); the static parts are v2's, written in v2's design frame and
 * shifted by `W` into the scanner's local frame (origin = the foot of the arm's pivot axis; the
 * arm points along +y at rest, toward the loop).
 *
 * v2's `polar(r, deg)` (about the pivot, deg 0 = −y, turning toward −x) is the angle −90 − deg
 * counter-clockwise from +x: `phi`. Plain module (no components).
 */
import { SC, SCANNER_CABLE, type SegmentSpec } from '@anatomy/engine';
import { type V3, closed } from '../kit.ts';

export { SC, SCANNER_CABLE };

/** v2 design frame → local. */
export const W = (x: number, y: number, z: number): V3 => [x + 30, y - 32, z];

/** v2 `polar(r, deg)` as a standard angle (degrees CCW from +x). */
export const phi = (deg: number) => -90 - deg;
/** v2 `polar(r, deg)` → local (x, y). */
export const polar = (r: number, deg: number): [number, number] => [-r * Math.sin((deg * Math.PI) / 180), -r * Math.cos((deg * Math.PI) / 180)];

/** v2 plan(x0, y0, x1, y1) in local coordinates. */
const plan = (x0: number, y0: number, x1: number, y1: number) => {
  const a = W(x0, y0, 0);
  const b = W(x1, y1, 0);
  return { x0: a[0], y0: a[1], x1: b[0], y1: b[1] };
};

/** The floor plate and the deck casting (same plan), the label plate, the pedestal column. */
export const BASE = { ...plan(-46, 6, -12, 40), r: 3 };
export const LABEL = plan(-22, 31, -14.5, 37.5);
export const COLUMN = { x: W(-29, 0, 0)[0], y: W(0, 23, 0)[1] };

/** The flex bracket (box), its cable boss, the park ramp (bar, post, tongue). */
export const BRACKET = { lo: W(-16, 28, 86), hi: W(-11, 37, 96.5) };
export const BOSS = W(-11, 32.5, 90);
export const RAMP = {
  bar: [W(-16, 40, 85), W(-14, 51, 88)] as const,
  post: [W(-17, 51, 85), W(-13, 55, 96)] as const,
  tongue: [W(-16.6, 55, 94.2), W(-13.4, 63.5, 96)] as const,
};

/** The arm, in its own frame (x = across, y = along the arm from the pivot): v2 `armAt` rings. */
const ring = (pts: readonly (readonly [number, number])[]) => pts.map(([s, c]) => [c, s] as const);
export const ARM = {
  blade: ring([[2, -3.6], [23, -1.2], [23, 1.2], [2, 3.6]]),
  slotA: ring([[7, -1.3], [12, -1.05], [12, 1.05], [7, 1.3]]),
  slotB: ring([[14, -0.95], [18, -0.75], [18, 0.75], [14, 0.95]]),
  trace: [[2.1, 5], [0.8, 21.5]] as const,
  beam: ring([[22.4, -1.1], [29.6, -0.55], [29.6, 0.55], [22.4, 1.1]]),
  slider: ring([[SC.reach - 0.8, -0.9], [SC.reach + 0.8, -0.9], [SC.reach + 0.8, 0.9], [SC.reach - 0.8, 0.9]]),
  fork: ring([[-3.4, -2.6], [-9.6, -2.2], [-9.6, 2.2], [-3.4, 2.6]]),
};

/** The preamp's legs (box corners inset 2), the 7 fins, the window's 4 cells. */
export const PRE = SC.preamp;
export const PRE_LEGS = ([[PRE.x0 + 2, PRE.y0 + 2], [PRE.x1 - 2, PRE.y0 + 2], [PRE.x0 + 2, PRE.y1 - 2], [PRE.x1 - 2, PRE.y1 - 2]] as const);
export const FINS = Array.from({ length: 7 }, (_, i) => PRE.x0 + 2.2 + i * 2.25);
export const CELLS = Array.from({ length: SC.perPacket }, (_, i) => {
  const y0 = SC.win.y0 + 0.5 + i * 1.95;
  return { y0, y1: y0 + 1.45, z0: SC.win.z0 + 0.5, z1: SC.win.z1 - 0.5 };
});
/** The preamp's input boss (on its +x face, toward the cable). */
export const PRE_IN = W(-98, 51, 24);

/** A rounded rectangle's outline (v2 `planOutline` of an inset plan) on a horizontal face at z. */
export function planOutline(x0: number, y0: number, x1: number, y1: number, r: number, z: number, tone: SegmentSpec['tone'] = 'faint'): SegmentSpec[] {
  const pts: V3[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let k = 0; k <= 4; k++) {
      const a = ((a0 + k * 22.5) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), z]);
    }
  };
  corner(x1 - r, y0 + r, -90);
  corner(x1 - r, y1 - r, 0);
  corner(x0 + r, y1 - r, 90);
  corner(x0 + r, y0 + r, 180);
  return closed(pts, [0, 0, 1], tone);
}

/**
 * The round cable cut into pieces (each a live part the pulse blends mint, E2): arc-length ranges
 * along the cable's centreline (the Tube's own) and each piece's middle as a fraction of the cable.
 */
export const CABLE_PIECES = (() => {
  const total = SCANNER_CABLE.total;
  const n = Math.max(1, Math.round(total / 7));
  return Array.from({ length: n }, (_, i) => {
    const a = (total * i) / n;
    const b = (total * (i + 1)) / n;
    return { range: [i === 0 ? 0 : a, i === n - 1 ? total + 1 : b] as const, mid: (a + b) / 2 / total };
  });
})();
