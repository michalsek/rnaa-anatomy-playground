/**
 * The crusher's control box (v2 crusher.mjs L292–372): a cabinet with a seam and vents on a
 * pedestal (`stand`), the eye cable to the photo-eye, the door with hinges, the step-counter dial
 * (20 ticks, 4 majors, a moving needle), label plate, start/stop buttons and key, the amber lamp
 * on top (its lens blends lit → amber with the lamp level, E2, with an amber glow), the conduit
 * and floor boxes, and the motor cable.
 */
import type { SegmentSpec } from '@anatomy/engine';
import { Box, Glow, Group, Halo, Lathe, Marks, Tube } from '../../blocks/blocks.tsx';
import { type V3, corners, screws } from '../kit.ts';
import { turned } from '../conveyor/dims.ts';
import { CR, FY, FZ, LENS, circle, slot } from './dims.ts';

const D = CR.DIAL;
const L = CR.LAMP;
const M = CR.MOTOR;

const spokes = (count: number, r0: number, r1: number, s: number, tone: 'lo' | 'mid'): SegmentSpec[] =>
  Array.from({ length: count }, (_, i) => {
    const a = (i / count) * 2 * Math.PI;
    return { a: [r0 * Math.cos(a), r0 * Math.sin(a), s] as V3, b: [r1 * Math.cos(a), r1 * Math.sin(a), s] as V3, tone, normal: [0, 0, 1] as const };
  });

export function Control({ stand }: { stand: boolean }) {
  const vents = [18.6, 20, 21.4, 22.8].flatMap((z) => slot([-26, 5, z], [0, 1, 0], [0, 0, 1], 3.6, 0.4, [1, 0, 0]));
  const face = D.face;
  return (
    <Group id="control">
      <Halo id="halo" plan={{ w: 8, d: 8, r: 2 }} position={[-32, 5, 0]} />
      {stand && (
        <>
          <Box id="base" material="steel" outline="lo" {...corners([-35, 2, 0], [-29, 8, 0.8])} r={0.5} />
          <Marks id="base-screws" material="steel" {...screws([[-34, 3], [-30, 3], [-34, 7], [-30, 7]], 0.8, 0.5, 0.35)} />
          <Box id="column" material="steel" {...corners([-33.4, 3.6, 0.8], [-30.6, 6.4, 16])} r={0.3} />
        </>
      )}
      <Box id="cabinet" material="steel" {...corners([-38, -1, 16], [-26, 11, 32])} r={1.2} seams={[30.4]} />
      <Marks id="vents" material="steel" segments={vents} />
      <Tube id="eyeCable" material="steel" path={[[-26, 2, 27.4], [-22.4, 2, 27.4], [-22.4, 2, 32.2], [-17.2, 2, 32.2]]} radius={0.45} bend={1.6} />
      <Box id="door" material="steel" {...corners([-37, 11, 17], [-27, 11.6, 31])} r={0.4} />
      {[19, 26.6].map((z) => (
        <Lathe key={z} id={`hinge${z}`} material="steel" outline="lo" profile={turned([[0, 0.45], [2.4, 0.45]])} steps={12} {...FZ(-37.2, 11.9, z)} />
      ))}
      <Group id="dial" {...FY(D.x, D.y, D.z)}>
        <Lathe id="face" material="steel" outline="hi" profile={turned([[0, D.r], [face, D.r]])} />
        <Marks id="ticks" material="steel" segments={[...circle([0, 0, face], 3.0, [0, 0, 1], 'lo', 28), ...spokes(20, 2.35, 2.85, face, 'lo'), ...spokes(4, 1.9, 2.85, face, 'mid')]} />
        <Group id="needle" moves>
          <Marks
            id="hand"
            material="steel"
            segments={[{ a: [0, 0, face + 0.05], b: [2.5, 0, face + 0.05], tone: 'hi', width: 0.8, normal: [0, 0, 1] }]}
            dots={[{ at: [0, 0, face + 0.05], size: 0.7, tone: 'hi', normal: [0, 0, 1] }]}
          />
        </Group>
      </Group>
      <Box id="label" material="steel" outline="lo" {...corners([-36.2, 11.6, 18.2], [-31, 11.9, 21.8])} r={0.3} />
      <Marks
        id="label-rules"
        material="steel"
        segments={([[-35.4, 21, -32.2], [-35.4, 20, -33.2], [-35.4, 19, -32.8]] as const).map(([x0, z, x1]) => ({ a: [x0, 11.9, z] as V3, b: [x1, 11.9, z] as V3, tone: 'lo' as const, normal: [0, 1, 0] as const }))}
      />
      <Lathe id="start" material="steel" profile={turned([[0, 1.1], [0.5, 1.1], [0.5, 0.85], [1.0, 0.85]])} steps={20} {...FY(-28.8, 11.6, 21.2)} />
      <Lathe id="stop" material="steel" outline="lo" profile={turned([[0, 0.8], [0.5, 0.8], [0.5, 1.2], [1.1, 1.2]])} steps={20} {...FY(-28.8, 11.6, 18.6)} />
      <Lathe id="key" material="steel" outline="lo" profile={turned([[0, 0.7], [0.5, 0.7]])} steps={16} {...FY(-28.8, 11.6, 29.2)} />
      <Marks id="key-slot" material="steel" segments={[{ a: [-28.8, 12.1, 28.75], b: [-28.8, 12.1, 29.65], tone: 'hi', normal: [0, 1, 0] }]} />
      <Group id="lamp" {...FZ(L.x, L.y, L.z)}>
        <Lathe id="base" material="steel" profile={turned([[0, 2.4], [1.1, 2.4], [1.1, 1.7], [1.8, 1.7]])} steps={24} />
        <Lathe id="lens" live material="lit" outline="hi" blend={{ material: 'amber', outline: 'hi' }} profile={LENS} subdivisions={2} steps={24} />
        <Glow id="glowSoft" fx="amberSoft" radius={2.6} grow={3.0} opacity={0.4} blend="normal" bias={3} level={0} position={[0, 0, 3.6]} />
        <Glow id="glow" fx="amber" radius={1.8} grow={1.2} opacity={0.85} cap={0.85} blend="glow" bias={3} level={0} position={[0, 0, 3.6]} />
      </Group>
      <Box id="floorbox" material="steel" outline="lo" {...corners([-29.4, 7.4, 0], [-25.6, 11.4, 1.4])} r={0.4} />
      <Tube id="conduit" material="steel" path={[[-27.5, 9.4, 16], [-27.5, 9.4, 1.4]]} radius={0.7} />
      <Box id="motorFloorbox" material="steel" outline="lo" {...corners([31, -36, 0], [35, -32, 1.4])} r={0.4} />
      <Tube id="motorCable" material="steel" path={[[32.6, -27, M.z + 6.6], [32.6, -30.5, M.z + 6.6], [32.6, -34, M.z + 2], [32.6, -34, 1.4]]} radius={0.55} bend={2.4} />
    </Group>
  );
}
