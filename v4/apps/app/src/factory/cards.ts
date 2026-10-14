/**
 * The factory's cards (M10 §6): one card whose text follows the view. Each view names a card key
 * (`factoryViews.ts`); the key picks the text (the machines' own cards) and the readout format
 * over the factory graph (one readout store, re-formatted on a view change). The full caption and
 * the legend live in the "i" sheet (`overlay/InfoSheet.tsx`). Plain module (no components).
 */
import { type FactoryGraph, SC } from '@anatomy/engine';
import { CENTRIFUGE_CARD } from '../machines/centrifuge/views.ts';
import { CRUSHER_CARD } from '../machines/crusher/views.ts';
import { SCANNER_CARD } from '../machines/scanner/views.ts';
import type { CardKey } from './factoryViews.ts';
import { OUTPUT_CARD, PACKER_CARD } from './views.ts';

export interface CardCopy {
  fig: string;
  title: string;
  hint: string;
  label: string;
}

/** v2 A's caption (`assembly/build.mjs` L386): the "i" sheet. */
export const CAPTION =
  'How react-native-audio-api turns JavaScript calls into sound. Calls (blue beads) fall from the screen and are packed into fixed-size closures (72 bytes each): blue control events for the event scheduler (parameters, start, stop), amber graph changes (connect, disconnect), white buffers handed over. The centrifuge stands for the lock-free single-producer rings (1,024 slots in the engine): packets wait there until the audio thread drains them at the next render quantum, and nothing on either side waits on a lock. The audio belt is the render loop: each cleat-to-cleat segment is one 128-frame quantum, 375 a second at 48 kHz (shown here far slower). The scanner is the platform audio callback (CoreAudio or Oboe) reading every finished quantum; four quanta make one 512-frame device buffer, one mint packet (the four cells on the screen fill with it), which the elevator lifts to the speaker. What the audio thread swaps out turns grey and rides belt C to the crusher, the Disposer thread, so nothing is freed on the audio thread.';

/** The legend (packet and bead colours, the palette's materials). */
export const LEGEND = [
  { material: 'fluff', label: 'JS call (fluff)' },
  { material: 'pkControl', label: 'control event' },
  { material: 'pkGraph', label: 'graph change' },
  { material: 'pkData', label: 'buffer (data)' },
  { material: 'pkAudio', label: 'audio (device buffer)' },
  { material: 'pkGarbage', label: 'garbage' },
] as const;

export const CARDS: Record<CardKey, CardCopy> = {
  factory: {
    fig: 'Figure',
    title: 'Inside a React Native app',
    hint: 'calls → packets → rings → render loop → speaker',
    label: 'How react-native-audio-api turns JavaScript calls into sound.',
  },
  dispenser: {
    fig: 'Part',
    title: 'Dispenser',
    hint: 'a tap sends calls · the valve lets one go',
    label: 'Calls leave the screen: a tap drops a burst of beads into the sight cage, and the star valve lets them onto belt A one at a time.',
  },
  packer: PACKER_CARD,
  centrifuge: CENTRIFUGE_CARD,
  loop: {
    fig: 'Part',
    title: 'Render loop',
    hint: 'one cleat gap = one 128-frame quantum',
    label: 'The audio belt is the render loop: each cleat-to-cleat segment is one quantum; spent parcels drop off the head onto belt C.',
  },
  crusher: CRUSHER_CARD,
  scanner: SCANNER_CARD,
  output: OUTPUT_CARD,
};

const rpm = (g: FactoryGraph) => (Math.max(0, g.centrifuge.controller.w) * 60) / (2 * Math.PI);

/** The live line per card (from one graph status, as each machine's own scene shows it). */
export const READOUTS: Record<CardKey, (g: FactoryGraph, o: { speed: number; paused: boolean }) => string> = {
  factory: (g, o) => {
    const q = g.audio.quanta();
    const rate = o.paused ? 'paused' : `${(o.speed / q.period).toFixed(2)}/s here`;
    return `${q.count.toLocaleString('en-US')} quanta · ${rate} (375/s real) · ${g.crusher.stats().count} disposed`;
  },
  dispenser: (g) => `${g.dispenser.made} calls sent · ${g.dispenser.queued} waiting`,
  packer: (g) => `beads ${g.packer.stats.beads} · packets ${g.packer.stats.packets} · next ${g.packer.next()}`,
  centrifuge: (g) => `held ${g.centrifuge.tray.held()}/10 · ${rpm(g).toFixed(1)} rpm · ${g.centrifuge.controller.phase}`,
  loop: (g) => {
    const q = g.audio.quanta();
    return `q ${q.count} · ${(1 / q.period).toFixed(2)}/s · ${g.audio.stats.dropped} out`;
  },
  crusher: (g) => {
    const s = g.crusher.stats();
    return `${s.count} disposed · bin ${Math.round(s.fill * 100)}%${s.bin === 'home' ? '' : ' · emptying'}`;
  },
  scanner: (g) => `quanta read ${g.scanner.stats.reads} · buffer ${g.scanner.stats.delivered % SC.perPacket}/${SC.perPacket} · ${g.scanner.stats.sent} packets out`,
  output: (g) => `packets lifted ${g.elevator.stats.lifted} · ${g.speaker.stats.heard} heard · boot ${g.elevator.stats.queue}`,
};

/** The phase word (the accessible live region): the centrifuge's on its cards, else running. */
export const PHASES: Record<CardKey, (g: FactoryGraph) => string> = {
  factory: (g) => g.centrifuge.controller.phase,
  dispenser: () => 'running',
  packer: () => 'running',
  centrifuge: (g) => g.centrifuge.controller.phase,
  loop: () => 'running',
  crusher: (g) => g.crusher.stats().bin,
  scanner: () => 'running',
  output: () => 'running',
};
