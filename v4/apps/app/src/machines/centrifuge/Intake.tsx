/**
 * The intake (v2 L473–518): two bars on the ring carry the funnel flange, the flared funnel and
 * its lip; the funnel's mouth is a void with the v2 gradient (light at the back, dark in front).
 */
import { type ProfilePoint, boltCircle } from '@anatomy/engine';
import { Box, Group, Lathe, Marks } from '../../blocks/blocks.tsx';
import { AZ, FUNNEL, Z, corners, disc, polar } from './dims.ts';

/** v2's flare r = 7 + 4.5·t^1.7 over z 171 → 184, as smooth knots (a ring at the flare's foot). */
const FUNNEL_PROFILE: ProfilePoint[] = [
  [0, Z.funnelFoot + 1.2],
  [7, Z.funnelFoot + 1.2],
  [7, 171, true],
  [7.43, 174.25, true],
  [8.39, 177.5, true],
  [9.81, 180.75, true],
  [11.5, 184],
  [0, 184],
];
const UP = [0, 0, 1] as const;
const VOID_R = 11;
const VOID_Z = Z.mouth + 0.02;

export function Intake() {
  return (
    <Group id="intake">
      {[-1, 1].map((sx) => (
        <Box
          key={sx}
          id={`funnel-bar${sx > 0 ? 1 : 0}`}
          material="steel"
          {...corners([sx > 0 ? 7.5 : -10.5, FUNNEL[1] - 11, Z.plate[0]], [sx > 0 ? 10.5 : -7.5, FUNNEL[1] + 6, Z.funnelFoot])}
          r={0.4}
        />
      ))}
      <Marks
        id="funnel-bar-dots"
        material="steel"
        dots={[-1, 1].flatMap((sx) => [
          { at: [sx * 9, FUNNEL[1] - 8.4, Z.funnelFoot] as const, size: 0.38, normal: UP },
          { at: [sx * 9, FUNNEL[1] + 4, Z.funnelFoot] as const, size: 0.38, normal: UP },
        ])}
      />
      <Group id="funnel" position={FUNNEL}>
        <Lathe id="flange" material="steel" profile={disc(9.5, Z.funnelFoot, Z.funnelFoot + 1.2)} />
        <Marks id="flange-dots" material="steel" dots={boltCircle({ center: [0, 0, Z.funnelFoot + 1.2], r: 8.4, count: 8, phase: 22.5, size: 0.38 })} />
        <Lathe id="body" material="steel" profile={FUNNEL_PROFILE} marks={[2]} subdivisions={4} />
        <Lathe id="lip" material="steel" profile={disc(12.2, 184, Z.mouth)} />
        <Marks id="lip-dots" material="steel" dots={boltCircle({ center: [0, 0, Z.mouth], r: 11.6, count: 16, size: 0.36 })} />
        {/* The mouth: an open disc just above the lip, shaded by the void gradient. */}
        <Lathe
          id="void"
          material="steel"
          outline="lo"
          tone="gradient"
          gradient={{
            from: polar(AZ + 180, VOID_R, VOID_Z),
            to: polar(AZ, VOID_R, VOID_Z),
            stops: ['void0', 'void1', 'void2'],
            mid: 0.55,
          }}
          profile={[
            [VOID_R, VOID_Z],
            [0, VOID_Z],
          ]}
        />
      </Group>
    </Group>
  );
}
