/**
 * Packer dimensions, from v2 `parts/packer/packer.mjs` (build L22–280) and `rig.mjs`, in the
 * packer's local frame: v2's plan minus ANCHOR [100, −118, 0] (origin = the floor point under the
 * lane axis on the gutter line). The constants the sim shares live in the engine's `PK`; `P`
 * transcribes v2's plan coordinates. Plain module (no components).
 */
import { PK } from '@anatomy/engine';
import type { V3 } from '../kit.ts';

export { PK };

/** v2 plan → local. */
export const P = (x: number, y: number, z: number): V3 => [x - 100, y + 118, z];
/** A box from two plan corners. */
export const pbox = (a: readonly [number, number, number], b: readonly [number, number, number]) => {
  const lo = P(...a);
  const hi = P(...b);
  return { size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] as V3, center: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2] as V3 };
};

/** Deck (plan): plate x 70..130, y −150..−104, z 176..182; tabs for the two pedestals. */
export const DECK = { X0: 70, X1: 130, Y0: -150, Y1: -104, TX: 88, TY: -97.5, RX: 112, RY: -93.5, z: 176, top: 182, R: 1.6 };

/** The deck's outline (plan → local), rounded corners as 5 smooth points each. */
export function deckRing(): { polygon: [number, number][]; smooth: boolean[] } {
  const { X0, X1, Y0, Y1, TX, TY, RX, RY, R } = DECK;
  const pts: [number, number][] = [];
  const smooth: boolean[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i < 5; i++) {
      const a = a0 + (i * Math.PI) / 8;
      const [x, y] = P(cx + R * Math.cos(a), cy + R * Math.sin(a), 0);
      pts.push([x, y]);
      smooth.push(true);
    }
  };
  const sharp = (x: number, y: number) => {
    const [lx, ly] = P(x, y, 0);
    pts.push([lx, ly]);
    smooth.push(false);
  };
  corner(X1 - R, Y0 + R, -Math.PI / 2);
  corner(X1 - R, RY - R, 0);
  corner(RX + R, RY - R, Math.PI / 2);
  sharp(RX, Y1);
  sharp(TX, Y1);
  corner(TX - R, TY - R, 0);
  corner(X0 + R, TY - R, Math.PI / 2);
  corner(X0 + R, Y0 + R, Math.PI);
  return { polygon: pts, smooth };
}

/** Deck screws along its edges (plan x, y). */
export function deckBolts(): [number, number][] {
  const { X0, X1, Y0, Y1, TX, TY, RX, RY } = DECK;
  const out: [number, number][] = [];
  for (let x = TX + 4; x <= RX - 3; x += 6) out.push([x, Y1 - 1.8]);
  for (let y = Y0 + 4; y <= RY - 3; y += 6.5) out.push([X1 - 1.8, y]);
  for (let x = X0 + 4; x <= TX - 3; x += 6.5) out.push([x, TY - 1.8]);
  for (let x = RX + 4; x <= X1 - 4; x += 6.5) out.push([x, RY - 1.8]);
  return out.map(([x, y]) => [x - 100, y + 118]);
}

/** Stand (plan) on a floor at z: the four legs, the leg tops; the two stringer rings and the shelf. */
export function standAt(floor: number) {
  const legTop = DECK.z;
  const lowZ = floor + Math.max(6.5, (legTop - floor) * 0.22);
  const highZ = legTop - 1 - 8;
  return { legs: [[73, -147], [127, -147], [73, -107], [127, -107]] as const, floor, legTop, lowZ, highZ, shelfZ: lowZ + 4, tall: highZ - lowZ > 30 };
}

/** Gutter (plan, from the sim's `PK.gutter`): x 74.6..92 at y −118, floor top 228; pockets (the far one first). */
const toPlanX = (x: number) => x + 100;
export const GT = {
  x0: toPlanX(PK.gutter.x0),
  x1: toPlanX(PK.gutter.x1),
  y: PK.gutter.y - 118,
  z: PK.gutter.z,
  pockets: PK.gutter.pockets.map(toPlanX),
};

/** A pedestal: plan base, yoke height, foot, column and turret radii. */
export interface PedestalSpec {
  base: readonly [number, number];
  yokeZ: number;
  foot: number;
  col: number;
  tr: number;
}
/** The pedestals stand under the arms' shoulders (the sim's `PK.*.arm`: S, yokeZ, yokeR). */
const pedestal = (arm: (typeof PK)['picker' | 'folder']['arm']): PedestalSpec => ({
  base: [toPlanX(arm.S[0]), arm.S[1] - 118],
  yokeZ: arm.yokeZ,
  foot: 5.4,
  col: 2.9,
  tr: arm.yokeR,
});
export const PEDESTALS: Record<'picker' | 'folder', PedestalSpec> = { picker: pedestal(PK.picker.arm), folder: pedestal(PK.folder.arm) };

/** v2 `stadium(len, r)`: a slot from p = 0 to len with round ends (in the link's (a, v) plane). */
export function stadium(len: number, r: number, steps = 10): { polygon: [number, number][]; smooth: boolean[] } {
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / steps;
    pts.push([len + r * Math.cos(a), r * Math.sin(a)]);
  }
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / steps;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return { polygon: pts, smooth: pts.map(() => true) };
}

/** The carton (sim `PK.carton`): flap lengths and half widths (v2 rig `flapSvg`). */
export const CARTON = {
  ...PK.carton,
  minor: { len: 3.6, half: PK.carton.d / 2 - PK.carton.wall - 0.1 },
  major: { len: PK.carton.d / 2, half: PK.carton.w / 2 },
};

/** Drag chain on a link (v2 rig `chain`): link pitch, links between s0 and s1. */
export function chainLinks(s0: number, s1: number) {
  const pitch = 1.25;
  const count = Math.max(3, Math.floor((s1 - s0) / pitch));
  return { pitch, count, end: s0 + count * pitch };
}

/** A stepped turned part: one radius per run [s0, s1, r] along the model axis. */
export function stepped(segs: readonly (readonly [number, number, number])[]) {
  const out: [number, number][] = [[0, segs[0]![0]]];
  for (const [s0, s1, r] of segs) out.push([r, s0], [r, s1]);
  out.push([0, segs[segs.length - 1]![1]]);
  return out;
}

/** Live part ids: the pocket LEDs, the picker's vacuum lamp (in its tool group), the cabinet's lamp. */
export const LED_IDS = GT.pockets.map((_, i) => `gutter.led${i}`);
export const VACUUM_LAMP = 'lamp';
export const CAB_LAMP = 'cabinet.lamp';
