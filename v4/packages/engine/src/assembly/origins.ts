/**
 * Where each machine's local frame sits in the factory (its sim origin, world): views and the
 * reveal are authored per machine in local coordinates and placed from here. Plain TS.
 */
import type { V3 } from '../sim/ports.ts';
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

/** A box (min, max corners). */
export type Box3 = readonly [readonly [number, number, number], readonly [number, number, number]];

/** A box translated by `o`. */
export const shiftBox = (b: Box3, o: readonly number[]): Box3 => [
  [b[0][0] + o[0]!, b[0][1] + o[1]!, b[0][2] + o[2]!],
  [b[1][0] + o[0]!, b[1][1] + o[1]!, b[1][2] + o[2]!],
];
