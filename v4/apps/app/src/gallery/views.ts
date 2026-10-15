/**
 * Gallery and M1 layout constants and view presets. Kept out of the component modules, so those
 * export only components and Fast Refresh can patch them in place (a module that also exports
 * plain values propagates an edit up to the App, which would rebuild the store and device).
 */
import type { Vec3, ViewPreset } from '@anatomy/engine';

// ---- M1 row ------------------------------------------------------------------------------------

export const M1 = (() => {
  const BOX_AT: Vec3 = [-13, 13, 0];
  const ROTOR_AT: Vec3 = [13, -13, 0];
  const STANDOFF = 0.02;
  return {
    BOX_AT,
    ROTOR_AT,
    STANDOFF,
    TACH_AT: [BOX_AT[0], BOX_AT[1] + 6 + STANDOFF, 5] as Vec3,
  };
})();

const add = (a: Vec3, b: Vec3): [number, number, number] => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** The M1 views, around a row placed at `at`. */
export function m1Views(at: Vec3 = [0, 0, 0], prefix = ''): ViewPreset[] {
  const { BOX_AT, ROTOR_AT, TACH_AT } = M1;
  const tachFace: Vec3 = [TACH_AT[0], TACH_AT[1] + 1.52, TACH_AT[2]];
  const limb: Vec3 = [ROTOR_AT[0] + 8.5 * Math.SQRT1_2, ROTOR_AT[1] - 8.5 * Math.SQRT1_2, 6];
  const focus = (p: Vec3) => add(p, at);
  return [
    { name: `${prefix}4× box corner`, yaw: 45, elevation: 30, zoom: 4, focus: focus([BOX_AT[0] + 6, BOX_AT[1] + 6, 10]) },
    { name: `${prefix}4× tach`, yaw: 45, elevation: 30, zoom: 4, focus: focus(tachFace) },
    { name: `${prefix}4× rotor limb`, yaw: 45, elevation: 30, zoom: 4, focus: focus(limb) },
    { name: `${prefix}4× tube bend`, yaw: 45, elevation: 30, zoom: 4, focus: focus([-1.6, 11, 11.2]) },
  ];
}

/** The M1 scene on its own: the row at the origin with the M1 view list. */
export const M1_VIEWS: ViewPreset[] = [
  { name: 'fit', yaw: 45, elevation: 30, zoom: 1 },
  { name: 'yaw 20', yaw: 20, elevation: 30, zoom: 1 },
  { name: 'yaw 70', yaw: 70, elevation: 30, zoom: 1 },
  { name: 'yaw 160', yaw: 160, elevation: 30, zoom: 1 },
  { name: 'elev 10', yaw: 45, elevation: 10, zoom: 1 },
  { name: 'elev 60', yaw: 45, elevation: 60, zoom: 1 },
  { name: '0.5× thin', yaw: 45, elevation: 30, zoom: 0.5 },
  ...m1Views(),
];

// ---- gallery grid ------------------------------------------------------------------------------

/** Screen right and toward the viewer on the ground, at the kit view (yaw 45°). */
const RIGHT: Vec3 = [Math.SQRT1_2, -Math.SQRT1_2, 0];
const FRONT: Vec3 = [Math.SQRT1_2, Math.SQRT1_2, 0];
const CELL = 24;
/** Row depth (toward the viewer); rows are spaced by the height of the row in front. */
const ROW_AT = { m1: 0, ext: 44, lathe: 76, inst: 108, marks: 140, contact: 172, fx: 204, belt: 236 } as const;
export type Row = keyof typeof ROW_AT;

export const cell = (row: Row, col: number): [number, number, number] => {
  const u = (col - 2) * CELL;
  const w = ROW_AT[row];
  return [RIGHT[0] * u + FRONT[0] * w, RIGHT[1] * u + FRONT[1] * w, 0];
};
/** A cell relative to its row's centre cell (rows are groups placed at cell 2). */
export const local = (row: Row, col: number): Vec3 => {
  const [x, y] = cell(row, col);
  const [ox, oy] = cell(row, 2);
  return [x - ox, y - oy, 0];
};
export const lift = (p: Vec3, z: number): Vec3 => [p[0], p[1], z];

const rowView = (row: Row, zoom = 2.6): ViewPreset => {
  const [x, y] = cell(row, 2);
  return { name: `row ${row}`, yaw: 45, elevation: 30, zoom, focus: [x, y, 3] };
};
/** Pairs of neighbouring cells, close up. */
const pairView = (row: Row, col: number, zoom = 3.5): ViewPreset => {
  const [x0, y0] = cell(row, col);
  const [x1, y1] = cell(row, col + 1);
  return { name: `${row} ${col}+${col + 1}`, yaw: 45, elevation: 30, zoom, focus: [(x0 + x1) / 2, (y0 + y1) / 2, 3] };
};
const at = (row: Row, col: number, p: Vec3): [number, number, number] => {
  const [x, y] = cell(row, col);
  return [x + p[0], y + p[1], p[2]];
};

export const GALLERY_VIEWS: ViewPreset[] = [
  { name: 'fit', yaw: 45, elevation: 30, zoom: 1 },
  { name: 'yaw 160', yaw: 160, elevation: 30, zoom: 1 },
  rowView('m1', 2),
  pairView('ext', 0),
  pairView('ext', 2),
  pairView('ext', 3),
  pairView('lathe', 0),
  pairView('lathe', 2),
  pairView('lathe', 3),
  pairView('inst', 1, 3),
  pairView('marks', 1),
  pairView('marks', 2),
  pairView('contact', 0),
  pairView('contact', 2),
  pairView('fx', 0),
  pairView('fx', 2),
  pairView('belt', 0),
  pairView('belt', 2),
  // Close-ups (zoom relative to the whole gallery's fit).
  { name: 'close cage', yaw: 45, elevation: 30, zoom: 10, focus: at('contact', 0, [0, 0, 5]) },
  { name: 'close ribs', yaw: 45, elevation: 30, zoom: 10, focus: at('contact', 1, [3, 3, 3]) },
  { name: 'close saddle', yaw: 45, elevation: 30, zoom: 10, focus: at('contact', 2, [0, 0, 4.5]) },
  { name: 'close flush', yaw: 45, elevation: 30, zoom: 10, focus: at('contact', 3, [0, 0, 2]) },
  { name: 'close tube bend', yaw: 45, elevation: 30, zoom: 10, focus: at('lathe', 3, [-1, -2, 1.5]) },
  { name: 'close extrude corner', yaw: 45, elevation: 30, zoom: 10, focus: at('ext', 1, [4, 2, 2]) },
  { name: 'close spinner', yaw: 45, elevation: 30, zoom: 8, focus: at('inst', 1, [0, 0, 2]) },
  { name: 'close packets', yaw: 45, elevation: 30, zoom: 6, focus: at('inst', 3, [0, 0, 1]) },
  { name: 'close needle', yaw: 45, elevation: 30, zoom: 9, focus: at('marks', 1, [0, 0, 1]) },
  { name: 'close dots', yaw: 45, elevation: 30, zoom: 8, focus: at('marks', 3, [0, 0, 3]) },
  ...m1Views(cell('m1', 2), 'm1 '),
];
