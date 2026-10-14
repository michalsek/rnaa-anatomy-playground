/**
 * The phone's display (v2 phone.mjs L162–227), floating face up over the case at its shift: the
 * graphite OLED slab with its seam, the glass (an opaque near-black slab: the screen, a glow
 * band through the logo), and the screen art on it: the React logo (three orbit rings, flat
 * half-annuli, on a `logo` group that turns; the nucleus on its own group that pulses on a tap),
 * the island with its camera dot, the home indicator, and the four meter cells (E2: they fill
 * mint per scanner read; behind `SCREEN_METER`, off since M11). Cut (M10 plan §1): text, the ripple, the playback controls, the glare.
 */
import { Box, Extrude, Group, Lathe, Marks } from '../../blocks/blocks.tsx';
import { type V3, closed } from '../kit.ts';
import { METER_CELLS, SCREEN_METER, displayDims, roundedRing } from './dims.ts';

/** Half an elliptic ring (θ from a0 to a0 + π) as one polygon, turned by `deg` (art units). */
function halfRing(rx: number, ry: number, band: number, deg: number, a0: number, n = 36) {
  const c = Math.cos((deg * Math.PI) / 180);
  const sn = Math.sin((deg * Math.PI) / 180);
  const at = (a: number, b: number, th: number): [number, number] => {
    const x = a * Math.cos(th);
    const y = b * Math.sin(th);
    return [x * c - y * sn, x * sn + y * c];
  };
  const outer: [number, number][] = [];
  const inner: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const th = a0 + (Math.PI * i) / n;
    outer.push(at(rx + band / 2, ry + band / 2, th));
    inner.push(at(rx - band / 2, ry - band / 2, th));
  }
  const polygon = [...outer, ...inner.reverse()];
  return { polygon, smooth: polygon.map((_, k) => k !== 0 && k !== n && k !== n + 1 && k !== polygon.length - 1) };
}

const LOGO_RINGS = [90, 30, 150] as const;

export function Display({ reveal = false }: { reveal?: boolean }) {
  const D = displayDims();
  const { c, sx, sy, DZ, Z1, Z2, SW, SD, SR, s, LY } = D;
  const top = -SD / 2;
  const edge = roundedRing(SW, SD, SR, 8).points.map(([x, y]) => [x, y, 0.02] as V3);
  return (
    <Group id="display" position={[sx, sy, 0]} moves={reveal} rare={reveal} contacts={false}>
      <Extrude id="oled" material="graphite" outline="mid" plan={{ rect: [c.w - 6, c.d - 6], r: c.r - 3, steps: 10 }} position={[0, 0, DZ]} height={Z1 - DZ} seams={[1.6]} />
      <Extrude
        id="glass"
        material="screen"
        outline="hi"
        plan={{ rect: [c.w - 1.6, c.d - 1.6], r: c.r - 0.8, steps: 10 }}
        position={[0, 0, Z1]}
        height={Z2 - Z1}
        tone="gradient"
        gradient={{ from: [0, top, Z2 - Z1], to: [0, -top, Z2 - Z1], stops: ['screenEdge', 'screenGlow', 'screenEdge'], mid: (LY - top) / SD }}
      />
      <Group id="art" position={[0, 0, Z2]}>
        <Marks id="edge" material="screen" segments={closed(edge, [0, 0, 1], 'faint')} />
        <Group id="logo" moves position={[0, LY, 0]}>
          {LOGO_RINGS.flatMap((deg, k) =>
            [0, Math.PI].map((a0, h) => (
              <Extrude
                key={`${k}${h}`}
                id={`ring${k}${h}`}
                material="logo"
                width={0}
                plan={halfRing(43 * s, 16.4 * s, 3.8 * s, deg, a0)}
                position={[0, 0, 0.06 * k]}
                height={0.3}
              />
            )),
          )}
        </Group>
        <Group id="nucleus" moves position={[0, LY, 0]}>
          <Lathe id="disc" material="logo" width={0} profile={[[0, 0], [7.8 * s, 0], [7.8 * s, 0.5], [0, 0.5]]} steps={48} />
        </Group>
        {/* The island and its camera, the home indicator. */}
        <Box id="island" material="screen" outline="mid" size={[31 * s, 9 * s, 0.3]} center={[0, top + 9.5 * s, 0.15]} r={4.5 * s} />
        <Lathe id="camera" material="screen" outline="mid" profile={[[0, 0], [1.7 * s, 0], [1.7 * s, 0.4], [0, 0.4]]} position={[9.6 * s, top + 9.5 * s, 0]} steps={20} />
        <Box id="home" material="pkData" outline="lo" size={[44 * s, 2.2 * s, 0.25]} center={[0, SD / 2 - 6.1 * s, 0.125]} r={1.1 * s} />
        {SCREEN_METER && (
          <Group id="meter" position={[0, LY + 64 * s, 0]}>
            {Array.from({ length: METER_CELLS }, (_, i) => (
              <Box
                key={i}
                id={`cell${i}`}
                material="graphite"
                outline="mid"
                live
                blend={{ material: 'pkAudio', outline: 'hi' }}
                size={[5.2 * s, 3.6 * s, 0.3]}
                center={[(17 + i * 6.2 + 2.6) * s, 0, 0.15]}
                r={0.8 * s}
              />
            ))}
          </Group>
        )}
      </Group>
    </Group>
  );
}
