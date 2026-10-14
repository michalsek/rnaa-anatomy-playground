/**
 * The speaker's throat and wiring (v2 speaker.mjs L172–215): the throat box on the +x side with
 * its seam, the mouth on its +x face (a packet slides in through it, hidden behind the face by
 * depth) with two screws, the feed ledge; the 6-LED level meter in a dark window on the throat's
 * top (each LED a live part that blends dark → mint, the top one → amber, E2); the terminal block
 * and tabs under the dish, two wires down to a plug on the base (`stand`) or up to a connector
 * under the baffle.
 */
import type { SpeakerGeometry } from '@anatomy/engine';
import { Box, Group, Marks, Tube } from '../../blocks/blocks.tsx';
import { type V3, corners, dots, faceScrews } from '../kit.ts';
import { Opening } from '../Opening.tsx';
import type { Driver } from './dims.ts';

export function Throat({ g, d }: { g: SpeakerGeometry; d: Driver }) {
  const T = g.throat;
  const M = g.mouth;
  const L = g.ledge;
  const m = d.meter;
  const screwsAt: V3[] = [
    [T.x1, -5.5, T.z0 + 1.2],
    [T.x1, 5.5, T.z0 + 1.2],
  ];
  return (
    <Group id="throat">
      <Box id="box" material="steel" {...corners([T.x0, -T.y, T.z0], [T.x1, T.y, T.z1])} r={1} seams={[T.z1 - 2]} />
      <Opening id="mouth" lo={[T.x1 - 0.05, -M.y, M.z0]} hi={[T.x1 + 0.02, M.y, M.z1]} from={[T.x1, 0, M.z0]} to={[T.x1, 0, M.z1]} />
      <Marks id="screws" material="steel" {...faceScrews('x', screwsAt, 0.6, 0.35)} />
      <Box id="ledge" material="steel" outline="lo" {...corners([L.x0, -5.6, L.z - 1.2], [L.x1, 5.6, L.z])} r={0.4} />
      <Group id="meter">
        <Box id="plate" material="graphite" {...corners([m.x0, -m.y, m.z0], [m.x1, m.y, m.z1])} r={0.8} />
        <Box id="window" material="rubber" {...corners([m.x0 + 0.5, -3.4, m.z1 - 0.02], [m.x1 - 0.5, 3.4, m.z1 + 0.04])} r={0.6} />
        {m.leds.map((led, i) => (
          <Box
            key={i}
            id={`led${i}`}
            live
            material="rubber"
            outline="lo"
            blend={{ material: i === m.leds.length - 1 ? 'amber' : 'pkAudio', outline: 'lo' }}
            {...corners([led.x0, -2.6, m.z1 + 0.04], [led.x1, 2.6, m.z1 + 0.14])}
            r={0.4}
          />
        ))}
      </Group>
    </Group>
  );
}

export function Wiring({ d, stand }: { d: Driver; stand: boolean }) {
  const tb = d.terminal;
  const ZB = d.ZB;
  const yWire = stand ? 30 : 31.4;
  const zEnd = stand ? 8 : ZB - 7;
  return (
    <Group id="wiring">
      <Box id="terminal" material="graphite" {...corners([tb.x0, tb.y0, tb.z0], [tb.x1, tb.y1, tb.z1])} r={0.4} />
      {[-2.6, 2.6].map((x, i) => (
        <Box key={i} id={`tab${i}`} material="steel" outline="hi" {...corners([x - 1.2, tb.y1, tb.z0 + 0.8], [x + 1.2, tb.y1 + 3, tb.z0 + 3.2])} r={0.2} />
      ))}
      {[-2.6, 2.6].map((x, i) => (
        <Tube key={i} id={`wire${i}`} material={i === 0 ? 'steel' : 'graphite'} path={[[x, tb.y1 + 3, tb.z0 + 2], [x, yWire, tb.z0 + 2], [x, yWire, zEnd]]} radius={0.6} bend={3} sides={10} />
      ))}
      {stand ? (
        <>
          <Box id="plug" material="graphite" {...corners([-6, 26, 3], [6, 34, 8])} r={0.8} />
          <Marks id="plug-dots" material="graphite" dots={dots([[-2.6, 30, 8], [2.6, 30, 8]], [0, 0, 1], 0.5, 'mid')} />
        </>
      ) : (
        <>
          <Box id="connector" material="graphite" {...corners([-6, 29.6, ZB - 7], [6, 33.2, ZB - 2])} r={0.6} seams={[ZB - 3.4]} />
          <Marks id="connector-dots" material="graphite" dots={dots([[-2.6, 31.4, ZB - 7], [2.6, 31.4, ZB - 7]], [0, 0, -1], 0.45, 'mid')} />
        </>
      )}
    </Group>
  );
}
