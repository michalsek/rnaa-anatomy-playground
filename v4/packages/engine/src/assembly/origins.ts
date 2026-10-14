/**
 * Where each machine's local frame sits in the factory (its sim origin, world): views and the
 * reveal are authored per machine in local coordinates and placed from here. Plain TS.
 */
import { type V3, quarterTurn } from '../sim/ports.ts';
import { type FactoryLayout, type MachineId } from './factory.ts';

/** A machine of the factory, or the phone (case, display, dispenser: the world frame). */
export type PlaceId = MachineId | 'phone';

export function machineOrigins(l: FactoryLayout): Record<PlaceId, V3> {
  return {
    phone: [0, 0, 0],
    dispenser: [0, 0, 0],
    beltA: l.input.beltA.origin,
    packer: l.input.packer,
    beltB: l.beltB.origin,
    centrifuge: l.centrifuge,
    scanner: l.read.scanner,
    audio: l.audio.origin,
    beltC: l.garbage.beltC.origin,
    crusher: l.garbage.crusher,
    beltD: l.read.beltD.origin,
    elevator: l.output.elevator,
    speaker: l.output.speaker,
  };
}

/** Each machine's turn about z (degrees, a multiple of 90; M11: the speaker, the crusher). */
export function machineYaws(l: FactoryLayout): Record<PlaceId, number> {
  const y = Object.fromEntries(Object.keys(machineOrigins(l)).map((k) => [k, 0])) as Record<PlaceId, number>;
  y.speaker = l.output.speakerYaw;
  y.crusher = l.garbage.yaw ?? 0;
  return y;
}

/** A box (min, max corners). */
export type Box3 = readonly [readonly [number, number, number], readonly [number, number, number]];

/** A box translated by `o`. */
export const shiftBox = (b: Box3, o: readonly number[]): Box3 => [
  [b[0][0] + o[0]!, b[0][1] + o[1]!, b[0][2] + o[2]!],
  [b[1][0] + o[0]!, b[1][1] + o[1]!, b[1][2] + o[2]!],
];

/** A machine-local box placed in the world: turned by `yaw` (a multiple of 90) about the origin, then moved by `o`. */
export function placeBox(b: Box3, o: readonly number[], yaw = 0): Box3 {
  const [c, s] = quarterTurn(yaw);
  const xs = [b[0][0], b[1][0]];
  const ys = [b[0][1], b[1][1]];
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const x of xs) {
    for (const y of ys) {
      const wx = c * x - s * y;
      const wy = s * x + c * y;
      x0 = Math.min(x0, wx);
      x1 = Math.max(x1, wx);
      y0 = Math.min(y0, wy);
      y1 = Math.max(y1, wy);
    }
  }
  return [
    [x0 + o[0]!, y0 + o[1]!, b[0][2] + o[2]!],
    [x1 + o[0]!, y1 + o[1]!, b[1][2] + o[2]!],
  ];
}
