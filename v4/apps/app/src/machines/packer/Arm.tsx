/**
 * The packer's two arms (v2 `rig.mjs` `armSvg`, `chain`; `live.src.js` `pickerTool`, `folderTool`)
 * as nested `moves` groups, posed by the engine's `solveArm` from the sim's tool points:
 * - `turret` (yaw about z): the yoke plate with its bolts, the cheeks round the shoulder, the
 *   shoulder cap and the servo can on the far cheek;
 * - `link1` (pitch −a1 about y, at the shoulder): the stadium link with its recess outline, its
 *   drag chain on the far face, the elbow servo and caps;
 * - `link2` (−(a2 − a1), at the elbow): link 2 beside link 1, its drag chain and elbow cap;
 * - `wrist` (+a2: level again, at the wrist): the wrist caps;
 * - `tool` (−yaw, offset `off` along n): world-aligned, so the picker's bar stays along x. The
 *   picker carries a React-blue vacuum bar with three bellows cups and a lamp on its vacuum
 *   generator (lit while it holds); the folder carries the block with plough fingers, the roller
 *   on its brackets and the tape roll.
 *
 * In the arm's frames x runs along the link, z is the link's "up" in the arm plane, and the plane's
 * normal n is `side`·y (v2 lays the parts out in layers along n).
 */
import type { ArmSpec, SegmentSpec } from '@anatomy/engine';
import { Box, Extrude, Group, Lathe, Marks } from '../../blocks/blocks.tsx';
import { type V3, closed, corners, frameAlong, placeFrame, rod } from '../kit.ts';
import { VACUUM_LAMP, chainLinks, stadium } from './dims.ts';

/** A plate in the arm's (a, v) plane, from u0 to u1 along n (model z = y: the polygon's v is mirrored). */
function NPlate({ id, polygon, smooth, u0, u1, side, material = 'steel' }: { id: string; polygon: readonly (readonly [number, number])[]; smooth?: readonly boolean[]; u0: number; u1: number; side: number; material?: 'steel' | 'graphite' }) {
  const ys = [side * u0, side * u1];
  return (
    <Extrude
      id={id}
      material={material}
      plan={{ polygon: polygon.map(([p, q]) => [p, -q] as const), ...(smooth && { smooth }) }}
      z={Math.min(ys[0]!, ys[1]!)}
      height={Math.abs(u1 - u0)}
      {...placeFrame([0, 0, 0], [0, 1, 0], [1, 0, 0])}
    />
  );
}

/** A disc about n at (x, z) of the arm frame, from u0 to u1 along n. */
function NCap({ id, x = 0, z = 0, u0, u1, r, side, material = 'steel' }: { id: string; x?: number; z?: number; u0: number; u1: number; r: number; side: number; material?: 'steel' | 'graphite' }) {
  return <Lathe id={id} material={material} profile={rod(r, u0, u1)} steps={r > 2 ? 32 : 20} {...frameAlong([x, 0, z], [0, side, 0])} />;
}

/** A link: the stadium plate (0..len along x, half width r) and its recess outline on both faces. */
function Link({ id, len, r, u0, u1, inset, side }: { id: string; len: number; r: number; u0: number; u1: number; inset: number; side: number }) {
  const outline = stadium(len - 2 * r, r - inset, 8).polygon;
  const face = (u: number): SegmentSpec[] =>
    closed(
      outline.map(([p, q]) => [p + r, side * u, q] as V3),
      [0, side * Math.sign(u - (u0 + u1) / 2), 0],
      'faint',
    );
  return (
    <Group id={id}>
      <NPlate id="plate" {...stadium(len, r)} u0={u0} u1={u1} side={side} />
      <Marks id="recess" material="steel" segments={[...face(u0 - 0.01), ...face(u1 + 0.01)]} />
    </Group>
  );
}

/** A drag chain on a link face: carrier strip, fine links, end brackets (v2 rig `chain`). */
function Chain({ s0, s1, u0, u1, side }: { s0: number; s1: number; u0: number; u1: number; side: number }) {
  const { pitch, count, end } = chainLinks(s0, s1);
  const um = u0 + (u1 - u0) * 0.4;
  const y = (a: number, b: number): [number, number] => [Math.min(side * a, side * b), Math.max(side * a, side * b)];
  const [c0, c1] = y(u0, um);
  const [l0, l1] = y(um - 0.1, u1);
  const [b0, b1] = y(u0 - 0.1, u1 + 0.1);
  return (
    <Group id="chain">
      <Box id="carrier" material="graphite" outline="lo" {...corners([s0, c0, -0.5], [end, c1, 0.5])} />
      {Array.from({ length: count }, (_, i) => (
        <Box key={i} id={`link${i}`} material="graphite" {...corners([s0 + i * pitch + 0.1, l0, -0.8], [s0 + (i + 1) * pitch - 0.1, l1, 0.8])} r={0.1} />
      ))}
      {[s0 - 1, end + 0.2].map((p, i) => (
        <Box key={i} id={`bracket${i}`} material="steel" {...corners([p, b0, -1.1], [p + 0.8, b1, 1.1])} />
      ))}
    </Group>
  );
}

/** The cheek's outline round the shoulder (a, v), from the yoke plate up. */
const cheek = (below: number) => {
  const arcPts = Array.from({ length: 11 }, (_, i) => [2.6 * Math.cos((Math.PI * i) / 10), 2.6 * Math.sin((Math.PI * i) / 10)] as const);
  return { polygon: [[-2.6, below] as const, [2.6, below] as const, ...arcPts], smooth: [false, false, ...arcPts.map(() => true)] };
};

export type ToolKind = 'picker' | 'folder';

/** One arm at its pedestal (local), its groups named for the frame hook. */
export function Arm({ id, spec, tool }: { id: string; spec: ArmSpec; tool: ToolKind }) {
  const side = spec.side;
  const [sx, sy, sz] = spec.S;
  const below = spec.yokeZ + 1.1 - sz;
  const yoke = spec.yokeZ + 1.1;
  return (
    <Group id={id} position={[sx, sy, 0]}>
      <Group id="turret" moves>
        <Lathe id="yoke" material="steel" profile={rod(spec.yokeR, spec.yokeZ, yoke)} steps={40} />
        <Marks id="yoke-bolts" material="steel" dots={[[3.8, 0], [-3.8, 0], [0, 3.8], [0, -3.8]].map(([x, y]) => ({ at: [x!, y!, yoke] as V3, size: 0.45, normal: [0, 0, 1] as V3 }))} />
        <Group id="shoulder" position={[0, 0, sz]}>
          <NPlate id="cheekFar" {...cheek(below)} u0={-3.0} u1={-1.8} side={side} />
          <NPlate id="cheekNear" {...cheek(below)} u0={1.8} u1={3.0} side={side} />
          <NCap id="pin" u0={3.0} u1={3.6} r={1.5} side={side} />
          <NCap id="servo" u0={-6.8} u1={-3.0} r={2.3} side={side} />
          <NCap id="servoCap" u0={-7.4} u1={-6.8} r={1.6} side={side} />
        </Group>
        <Group id="link1" moves position={[0, 0, sz]}>
          <Link id="link" len={spec.L1} r={spec.r1} u0={-1.6} u1={1.6} inset={0.7} side={side} />
          <Chain s0={6} s1={spec.L1 - 5} u0={-3.0} u1={-1.8} side={side} />
          <NCap id="elbowCap" x={spec.L1} u0={-2.2} u1={-1.6} r={1.6} side={side} />
          <NCap id="elbowServo" x={spec.L1} u0={-4.9} u1={-2.2} r={2.0} side={side} />
          <Group id="link2" moves position={[spec.L1, 0, 0]}>
            <Link id="link" len={spec.L2} r={spec.r2} u0={1.8} u1={4.4} inset={0.6} side={side} />
            <Chain s0={4} s1={spec.L2 - 5} u0={4.4} u1={5.6} side={side} />
            <NCap id="elbowPin" u0={4.4} u1={5.0} r={1.4} side={side} />
            <Group id="wrist" moves position={[spec.L2, 0, 0]}>
              <NCap id="pinIn" u0={1.2} u1={1.8} r={1.3} side={side} />
              <NCap id="pinOut" u0={4.4} u1={5.0} r={1.3} side={side} />
              <NCap id="rotator" u0={5.0} u1={7.0} r={1.7} side={side} />
              <Group id="tool" moves position={[0, side * spec.off, 0]}>
                {tool === 'picker' ? <PickerTool /> : <FolderTool />}
              </Group>
            </Group>
          </Group>
        </Group>
      </Group>
    </Group>
  );
}

/** The cups' bellows (v2 `pickerTool` profile, along −z from the bar's underside at −9). */
const CUP: [number, number, boolean?][] = [
  [0, -12.6],
  [1.35, -12.6],
  [0.85, -11.9, true],
  [0.8, -11.6, true],
  [1.05, -11.2, true],
  [0.8, -10.8, true],
  [1.05, -10.4, true],
  [0.85, -10],
  [0.45, -10],
  [0.45, -9],
  [0, -9],
];
const CUP_DX = [-4.8, 0, 4.8] as const;

/** v2 `pickerTool`, about the tool point W (world axes). */
function PickerTool() {
  return (
    <>
      <Lathe id="spindle" material="steel" profile={rod(1.3, -4.2, -1.9)} steps={20} />
      <Lathe id="collar" material="steel" profile={rod(1.8, -5.0, -4.2)} steps={24} />
      <Lathe id="flange" material="steel" profile={rod(2.6, -5.7, -5.0)} steps={32} />
      <Lathe id="hub" material="steel" profile={rod(1.4, -7.6, -7.0)} steps={20} />
      <Box id="bar" material="react" outline="lo" {...corners([-6.6, -0.9, -9], [6.6, 0.9, -7.6])} r={0.2} />
      <Box id="generator" material="react" outline="lo" {...corners([1.4, -0.7, -7.6], [4.4, 0.7, -6.8])} r={0.15} />
      <Lathe id={VACUUM_LAMP} material="steel" outline="lo" profile={rod(0.38, 0, 0.12)} steps={14} live blend={{ material: 'lit' }} {...frameAlong([2.9, 0.7, -7.2], [0, 1, 0])} />
      {CUP_DX.map((dx, i) => (
        <Lathe key={i} id={`cup${i}`} material="steel" profile={CUP} steps={24} position={[dx, 0, 0]} />
      ))}
    </>
  );
}

/** v2 `folderTool`, about the tool point W (world axes); the roller leads on −x. */
function FolderTool() {
  return (
    <>
      <Lathe id="spindle" material="steel" profile={rod(1.3, -3.8, -1.8)} steps={20} />
      <Lathe id="collar" material="steel" profile={rod(1.7, -4.4, -3.8)} steps={24} />
      <Box id="block" material="steel" {...corners([-3.4, -1.5, -7.4], [3.4, 1.5, -4.4])} r={0.3} />
      {[-3, 3].map((x, i) => (
        <Box key={x} id={`finger${i}`} material="steel" outline="lo" {...corners([x - 0.3, -1.2, -8.6], [x + 0.3, 1.2, -7.4])} r={0.1} />
      ))}
      {[-1, 1].map((s, i) => (
        <Box key={s} id={`bracket${i}`} material="steel" {...corners([-2.9, s * 1.3 - 0.1, -8.1], [-1.9, s * 1.3 + 0.1, -7.4])} />
      ))}
      <Lathe id="roller" material="steel" profile={rod(0.9, 0, 2.4)} steps={20} {...frameAlong([-2.4, -1.2, -8.1], [0, 1, 0])} />
      <Lathe id="tape" material="steel" profile={rod(1.9, 0, 1.2)} steps={28} {...frameAlong([1.2, 1.5, -5.4], [0, 1, 0])} />
      <Marks id="tape-core" material="steel" segments={closed(Array.from({ length: 20 }, (_, k) => [1.2 + 0.8 * Math.cos((2 * Math.PI * k) / 20), 2.71, -5.4 + 0.8 * Math.sin((2 * Math.PI * k) / 20)] as V3), [0, 1, 0], 'lo')} />
    </>
  );
}
