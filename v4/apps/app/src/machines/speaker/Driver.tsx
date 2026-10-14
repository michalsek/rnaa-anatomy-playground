/**
 * The speaker's driver and its mount (v2 speaker.mjs L27–170): the stand (`stand`: base plate with
 * its seam and halo, four posts on feet with seam rings, tabs from the baffle to the posts) or,
 * without it, four short mounting ears with open holes; the graphite baffle in four ring quarters
 * (the baffle and everything below are drawn in the driver's frame, scaled by `d.k`);
 * the motor (back plate, magnet, top plate), the stamped dish with its dots, the spider with its
 * corrugation rings, the voice-coil former, four basket arms; the mounting ring with four screw
 * slots, the rubber roll surround; the mint cone (`cone`, moved along +z by the frame hook) with
 * its rings and lit rim, and the dust cap (`cap`, moved 1.35× as far).
 */
import { Box, Extrude, Group, Halo, Lathe, Marks, Tube } from '../../blocks/blocks.tsx';
import { type V3, add, circle, cross, disc, placeFrame, scale, unit } from '../kit.ts';
import { TopOpening } from '../Opening.tsx';
import { type Driver, SPK } from './dims.ts';

const UP: V3 = [0, 0, 1];
const QUARTERS = [0, 1, 2, 3];
const DIAG = [45, 135, 225, 315];
const rad = (deg: number) => (deg * Math.PI) / 180;
/** An annulus revolved about z (r0..r1, z0..z1). */
const annulus = (r0: number, r1: number, z0: number, z1: number) =>
  [
    [r0, z0],
    [r1, z0],
    [r1, z1],
    [r0, z1],
    [r0, z0],
  ] as const;

/** The stand (at the speaker's scale): base plate with its seam and halo, four posts on feet. */
export function Stand({ d }: { d: Driver }) {
  const { ZB, HB, post } = d;
  return (
    <Group id="stand">
      <Halo id="halo" plan={{ w: 2 * HB + 8, d: 2 * HB + 8, r: 8 }} />
      <Box id="base" material="steel" outline="lo" size={[2 * HB, 2 * HB, 3]} center={[0, 0, 1.5]} r={4} seams={[1.5]} />
      {DIAG.map((deg, i) => {
        const [x, y] = [post * Math.cos(rad(deg)), post * Math.sin(rad(deg))];
        return (
          <Group key={i} id={`post${i}`} position={[x, y, 0]}>
            <Lathe id="foot" material="steel" profile={disc(4.2, 3, 5)} steps={28} />
            <Lathe id="post" material="steel" profile={disc(2.4, 5, ZB - 2 * d.k)} seams={[8, ZB - 5 * d.k]} steps={20} />
          </Group>
        );
      })}
    </Group>
  );
}

/**
 * The graphite baffle in four ring quarters, with tabs out to the posts (`stand`) or four short
 * mounting ears with open holes; drawn in the driver's (scaled) frame.
 */
export function Baffle({ d, stand }: { d: Driver; stand: boolean }) {
  const { ZB } = d;
  // The posts' radius in the driver's frame.
  const post = d.post / d.k;
  return (
    <Group id="baffle">
      {QUARTERS.map((q) => (
        <Extrude key={q} id={`q${q}`} material="graphite" plan={{ sector: { r0: SPK.hole, r1: SPK.ringOut, a0: q * 90, a1: q * 90 + 90 }, steps: 18 }} z={ZB - 2} height={2} />
      ))}
      {DIAG.map((deg, q) => {
        const reach = stand ? post + 4.5 / d.k : SPK.ringOut + 7.5;
        return (
          <Group key={q} id={`${stand ? 'tab' : 'ear'}${q}`} rotation={[0, 0, deg]}>
            <Extrude id="plate" material="graphite" plan={{ polygon: [[SPK.ringOut - 0.4, -4], [reach, -4], [reach, 4], [SPK.ringOut - 0.4, 4]] }} z={ZB - 2} height={2} />
            {stand ? (
              <Marks id="post-top" material="graphite" segments={circle([post, 0, ZB], 1.6, UP, 'lo', 12)} dots={[{ at: [post, 0, ZB], size: 0.5, normal: UP }]} />
            ) : (
              <Lathe id="hole" material="rubber" outline="lo" profile={[[1.5, ZB + 0.02], [0, ZB + 0.02]]} steps={14} position={[SPK.ringOut + 4, 0, 0]} />
            )}
          </Group>
        );
      })}
    </Group>
  );
}

export function Basket({ d }: { d: Driver }) {
  const { M0, dish, spider, former, arm, ring } = d;
  return (
    <Group id="basket">
      <Lathe id="backplate" material="steel" profile={disc(14.6, M0 - 12, M0 - 10)} steps={56} />
      <Lathe id="magnet" material="graphite" profile={disc(14, M0 - 10, M0 - 2)} seams={[M0 - 6]} steps={56} />
      <Lathe id="topplate" material="steel" profile={disc(14.6, M0 - 2, M0)} steps={56} />
      <Lathe id="dish" material="steel" profile={annulus(dish.r0, dish.r1, dish.z0, dish.z1)} steps={64} />
      <Marks id="dish-dots" material="steel" dots={[0, 1, 2, 3, 4, 5].map((k) => ({ at: [15.6 * Math.cos((k * Math.PI) / 3), 15.6 * Math.sin((k * Math.PI) / 3), dish.z1] as V3, size: 0.4, tone: 'lo' as const, normal: UP }))} />
      <Lathe id="spider" material="graphite" profile={annulus(spider.r0, spider.r1, spider.z0, spider.z1)} steps={72} />
      <Marks id="spider-rings" material="graphite" segments={[11.2, 13.8, 16.4, 19, 21.4].flatMap((r) => circle([0, 0, spider.z1], r, UP, 'faint', 48))} />
      <Lathe id="former" material="graphite" profile={disc(former.r, former.z0, former.z1)} steps={40} />
      {DIAG.map((deg, i) => {
        const a = rad(deg);
        const radial: V3 = [Math.cos(a), Math.sin(a), 0];
        const p0 = add([0, 0, arm.z0], scale(radial, arm.r0));
        const p1 = add([0, 0, arm.z1], scale(radial, arm.r1));
        const dir = unit([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]);
        const u: V3 = [-Math.sin(a), Math.cos(a), 0];
        const v = cross(dir, u);
        const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
        // The dot on the arm's upper face (v or −v, whichever looks up).
        const up = v[2] >= 0 ? v : scale(v, -1);
        const dot = add(add(p0, scale(dir, len / 2)), scale(up, 0.62));
        return (
          <Group key={i} id={`arm${i}`}>
            <Extrude id="arm" material="steel" plan={{ polygon: [[-3, -0.6], [3, -0.6], [3, 0.6], [-3, 0.6]] }} height={len} {...placeFrame(p0, dir, u)} />
            <Marks id="dot" material="steel" dots={[{ at: dot, size: 0.4, tone: 'lo', normal: up }]} />
          </Group>
        );
      })}
      <Lathe id="ring" material="steel" outline="hi" profile={annulus(ring.r0, ring.r1, ring.z0, ring.z1)} steps={80} />
      {DIAG.map((deg, i) => (
        <Group key={i} id={`slot${i}`} rotation={[0, 0, deg]}>
          <TopOpening id="slot" x0={ring.slotR - 1} x1={ring.slotR + 1} y0={-2.4} y1={2.4} z={ring.z1} />
          <Marks id="head" material="steel" dots={[{ at: [ring.slotR, 0, ring.z1 + 0.02], size: 0.6, tone: 'mid', normal: UP }]} />
        </Group>
      ))}
    </Group>
  );
}

/** The rubber roll surround (a closed tube on the ring). */
export function Surround({ d }: { d: Driver }) {
  const s = d.surround;
  const path = Array.from({ length: 64 }, (_, i) => [s.r * Math.cos((i / 64) * Math.PI * 2), s.r * Math.sin((i / 64) * Math.PI * 2), s.z] as V3);
  return <Tube id="surround" material="rubber" path={path} radius={s.tube} closed sides={16} />;
}

/** The cone (mint shell: outer surface up from the apex, back down the inside) and the dust cap. */
export function Cone({ d }: { d: Driver }) {
  const c = d.cone;
  const zAt = (r: number) => c.z0 + ((r - c.r0) / (c.r1 - c.r0)) * (c.z1 - c.z0);
  const rings = [0.78, 0.58, 0.4].map((f) => c.r0 + (c.r1 - c.r0) * f);
  return (
    <>
      <Group id="cone" moves>
        <Lathe
          id="shell"
          material="mint"
          outline="lit"
          profile={[[0, c.z0 - 1], [c.r0, c.z0 - 1], [c.r1, c.z1], [c.r1 - 1, c.z1], [c.r0, c.z0], [0, c.z0]]}
          steps={96}
        />
        <Marks id="rings" material="mint" segments={rings.flatMap((r) => circle([0, 0, zAt(r) + 0.05], r, UP, 'lo', 64))} />
      </Group>
      <Group id="cap" moves>
        <Lathe
          id="dome"
          material="pkAudio"
          outline="lit"
          profile={[[0, c.z0], [c.r0, c.z0], [c.r0 - 0.3, c.z0 + 1, true], [c.r0 - 1.8, c.z0 + 2.2, true], [c.r0 - 4.2, c.z0 + 3.1, true], [0, c.z0 + 3.5]]}
          subdivisions={2}
          steps={48}
        />
      </Group>
    </>
  );
}

