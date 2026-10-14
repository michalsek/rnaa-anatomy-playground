/**
 * The phone (v2 `parts/screen/phone.mjs`): the low case the factory stands in, the display
 * floating above it with the React screen, and the fluff dispenser hanging under the display. Its
 * sim is the dispenser (`Dispenser` in the scene's graph); one frame hook turns the valve's rotor,
 * writes the beads, turns the logo (pulsing the nucleus on a tap) and fills the screen's meter
 * cells with the scanner's reads (one cell per read, four per audio packet).
 */
import { type Dispenser as DispenserSim, type DispenserOutputs, type GroupHandle, type PartHandle, type PoolHandle, dispenserOutputs } from '@anatomy/engine';
import { useState } from 'react';
import { Group, useFrame, useNode, useNodes } from '../../blocks/blocks.tsx';
import type { LiveHandle } from '../../factory/live.ts';
import { Case } from './Case.tsx';
import { Display } from './Display.tsx';
import { Dispenser } from './Dispenser.tsx';
import { METER_CELLS } from './dims.ts';

declare const __DEV__: boolean;

interface PhoneProps {
  /** The factory's reveal: the display is the lid, the dispenser moves on its own (and is clipped). */
  reveal?: boolean;
  live: LiveHandle;
  sim: () => DispenserSim;
  /** Scanner reads landed in the preamp so far (the meter shows them % 4, as the preamp's cells). */
  reads: () => number;
}

const CELL_IDS = Array.from({ length: METER_CELLS }, (_, i) => `display.art.meter.cell${i}`);

function Frame({ live, sim, reads }: PhoneProps) {
  const rotor = useNode<GroupHandle>('dispenser.rotor');
  const logo = useNode<GroupHandle>('display.art.logo');
  const nucleus = useNode<GroupHandle>('display.art.nucleus');
  const cells = useNodes<PartHandle>(CELL_IDS);
  const beads = useNode<PoolHandle>('dispenser.beads');
  const [w] = useState(() => {
    const o: DispenserOutputs = dispenserOutputs();
    let pool: PoolHandle | null = null;
    let n = 0;
    let warned = false;
    const bead = (_i: number, x: number, y: number, z: number) => {
      if (n >= pool!.capacity) {
        if (__DEV__ && !warned) {
          warned = true;
          console.warn('[pool] dispenser beads: more than the pool holds; skipped');
        }
        return;
      }
      pool!.pose(n++, x, y, z);
    };
    return {
      o,
      beads(d: DispenserSim, p: PoolHandle) {
        pool = p;
        n = 0;
        d.beads(bead);
        p.count = n;
      },
    };
  });
  useFrame((info) => {
    live.step(info);
    const d = sim();
    d.outputs(w.o);
    rotor().spin('y', -w.o.rotor);
    logo().spin('z', w.o.spin);
    nucleus().set({ scale: 1 + 0.2 * Math.exp(-w.o.tap / 0.18) });
    const k = reads() % METER_CELLS;
    const cs = cells();
    for (let i = 0; i < cs.length; i++) cs[i]!.mix = i < k ? 1 : 0;
    w.beads(d, beads());
  });
  return null;
}

export function Phone(props: PhoneProps) {
  const d = props.sim();
  return (
    <Group id="phone" position={[...d.origin]}>
      <Frame {...props} />
      <Case />
      <Display reveal={props.reveal === true} />
      <Dispenser beads={d.pools.beads} reveal={props.reveal === true} />
    </Group>
  );
}
