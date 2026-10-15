/**
 * The cage (v2 L354–399, L621–629): eight posts on feet carrying the top ring (a closed tube),
 * the graphite spider on three arms, the bearing cartridge with its grease nipple, and the oiler
 * with its oil line to the bearing.
 */
import { boltCircle, sphereProfile } from '@anatomy/engine';
import { Extrude, Group, Lathe, Marks, Tube } from '../../blocks/blocks.tsx';
import { R, Z, dir, disc, frameAlong, polar, radial } from './dims.ts';

const POSTS = Array.from({ length: 8 }, (_, i) => 22.5 + 45 * i);
/** Posts end on the ring's underside, at their own radius off the ring's centreline. */
const POST_TOP = Z.ring - Math.sqrt(R.ring ** 2 - R.post ** 2);
const RING = Array.from({ length: 96 }, (_, k) => polar((360 * k) / 96, R.postAt, Z.ring));
const UP = [0, 0, 1] as const;
const NIPPLE_DEG = 20;
const NIPPLE = frameAlong(polar(NIPPLE_DEG, 4.9, 170.6), dir(NIPPLE_DEG));
const OILER = polar(120, 20, 0);

export function Cage() {
  return (
    <Group id="cage">
      {POSTS.map((deg, i) => {
        const p = polar(deg, R.postAt, 0);
        return (
          <Group key={i} id={`post${i}`} position={p}>
            <Extrude id="foot" material="steel" plan={{ circle: 2.3, steps: 24 }} z={Z.top[1]} height={1} />
            <Extrude id="post" material="steel" plan={{ circle: R.post, steps: 24 }} z={Z.top[1] + 1} height={POST_TOP - Z.top[1] - 1} seams={[141]} contacts />
          </Group>
        );
      })}
      <Tube id="ring" material="steel" path={RING} radius={R.ring} sides={16} bend={0} closed contacts />
      <Lathe id="spider" material="graphite" profile={disc(8, Z.spider[0], Z.spider[1])} />
      <Marks id="spider-dots" material="graphite" dots={boltCircle({ center: [0, 0, Z.spider[1]], r: 6.6, count: 6, phase: 30, size: 0.4 })} />
      {[0, 120, 240].map((deg) => (
        <Extrude
          key={deg}
          id={`arm${deg}`}
          material="steel"
          plan={radial(8, R.postAt - R.ring, 1.5)}
          z={Z.arm[0]}
          height={Z.arm[1] - Z.arm[0]}
          rotation={[0, 0, deg]}
        />
      ))}
      <Marks id="arm-dots" material="steel" dots={[0, 120, 240].map((deg) => ({ at: polar(deg, 28, Z.arm[1]), size: 0.4, normal: UP }))} />
      {/* The bearing cartridge: flange, a bright body, collar and cap. */}
      <Lathe id="bearing-flange" material="steel" profile={disc(7.2, Z.bearing[0], 165.6)} />
      <Marks id="bearing-flange-dots" material="steel" dots={boltCircle({ center: [0, 0, 165.6], r: 6.3, count: 6, size: 0.38 })} />
      <Lathe id="bearing-body" material="steel" outline="hi" profile={disc(5, 165.6, 172.6)} seams={[169.6]} contacts />
      <Lathe id="bearing-collar" material="steel" outline="hi" profile={disc(5.8, 172.6, 174)} />
      <Lathe id="bearing-cap" material="steel" profile={disc(4.2, 174, Z.bearing[1])} />
      <Group id="nipple" {...NIPPLE}>
        <Lathe id="stem" material="steel" profile={disc(0.55, 0, 1.5)} steps={16} contacts />
        <Lathe id="ball" material="steel" profile={sphereProfile(0.75, 10)} steps={16} subdivisions={2} position={[0, 0, 1.5 + Math.sqrt(0.75 ** 2 - 0.45 ** 2)]} />
      </Group>
      {/* The oiler on the 120° arm, and its line to the bearing body. */}
      <Group id="oiler" position={OILER}>
        <Extrude id="base" material="steel" plan={{ circle: 1.6, steps: 20 }} z={Z.arm[1]} height={168.8 - Z.arm[1]} />
        <Extrude id="glass" material="steel" outline="hi" plan={{ circle: 1.3, steps: 20 }} z={168.8} height={3.2} seams={[170.1]} />
        <Extrude id="cap" material="steel" plan={{ circle: 1.6, steps: 20 }} z={172} height={0.8} />
      </Group>
      <Tube id="oil-line" material="steel" path={[polar(120, 18.4, 168), polar(120, 5, 168)]} radius={0.5} sides={12} />
    </Group>
  );
}
