/**
 * Coolant (v2 L595–619): a finned cooler along +y on two cradles on the shelf, and two pipes
 * from pads on the bowl down into ports on top of it, each with a bolted flange at both ends.
 */
import { type Vec3, boltCircle } from '@anatomy/engine';
import { Box, Extrude, Group, Lathe, Marks, Tube } from '../../blocks/blocks.tsx';
import { COOL_DEGS, R, SHELF_TOP, add, corners, dir, disc, faceFrame, frameAlong, polar, scale } from './dims.ts';

const COOLER = { x: 41.5, y: -22, cradle: 2.4 };
const COOLER_Z = SHELF_TOP + COOLER.cradle + 5.5;
/** The cooler's axis is +y: model z → world +y. */
const ALONG_Y = { position: [COOLER.x, COOLER.y, COOLER_Z] as Vec3, rotation: [-90, 0, 0] as Vec3 };
const PIPE_R = 1.5;
const FLANGE_R = PIPE_R * 1.6;
const FLANGE_T = Math.max(0.9, PIPE_R * 0.6);
const PORT_TOP = COOLER_Z + 6.9;
/** v2 `toward` (the bolts go on the flange face the viewer sees). */
const TOWARD: Vec3 = [Math.SQRT1_2 * Math.cos(Math.PI / 6), Math.SQRT1_2 * Math.cos(Math.PI / 6), 0.5];

function Flange({ id, center, axis }: { id: string; center: Vec3; axis: Vec3 }) {
  const facing = axis[0] * TOWARD[0] + axis[1] * TOWARD[1] + axis[2] * TOWARD[2];
  const s = facing > 0 ? FLANGE_T / 2 : -FLANGE_T / 2;
  return (
    <>
      <Lathe id={id} material="steel" profile={disc(FLANGE_R, -FLANGE_T / 2, FLANGE_T / 2)} steps={24} {...frameAlong(center, axis)} />
      {Math.abs(facing) > 0.12 && (
        <Marks
          id={`${id}-dots`}
          material="steel"
          dots={boltCircle({ center: add(center, scale(axis, s)), axis: scale(axis, Math.sign(s)), r: FLANGE_R * 0.72, count: 6, size: 0.36 })}
        />
      )}
    </>
  );
}

function Pipe({ k, deg }: { k: number; deg: number }) {
  const face = polar(deg, 35.6, 114);
  const reach = (COOLER.x - face[0]) / Math.cos((deg * Math.PI) / 180);
  const out = add(face, scale(dir(deg), reach));
  const end: Vec3 = [out[0], out[1], PORT_TOP];
  return (
    <Group id={`pipe${k}`}>
      <Lathe id="pad" material="steel" profile={disc(2.6, Math.sqrt(R.bowl ** 2 - 2.6 ** 2) - 1, 35.6)} {...faceFrame(deg, 114)} contacts />
      <Extrude id="port" material="steel" plan={{ circle: 2.4, steps: 24 }} z={COOLER_Z} height={PORT_TOP - COOLER_Z} position={[out[0], out[1], 0]} contacts />
      <Tube id="pipe" material="steel" path={[face, out, end]} radius={PIPE_R} sides={16} bend={3.9} />
      <Flange id="flange0" center={add(face, scale(dir(deg), FLANGE_T / 2))} axis={dir(deg)} />
      <Flange id="flange1" center={add(end, [0, 0, FLANGE_T / 2])} axis={[0, 0, -1]} />
    </Group>
  );
}

export function Coolant() {
  return (
    <Group id="coolant">
      <Group id="cooler" {...ALONG_Y}>
        <Lathe id="cap0" material="steel" profile={disc(5.9, 0, 1.2)} />
        <Lathe id="body" material="steel" profile={disc(5.5, 1.2, 30.8)} seams={Array.from({ length: 13 }, (_, i) => 3.6 + i * 2)} contacts />
        <Lathe id="cap1" material="steel" profile={disc(5.9, 30.8, 32)} />
        <Marks id="cap1-dots" material="steel" dots={boltCircle({ center: [0, 0, 32], r: 4.8, count: 8, phase: 22.5, size: 0.38 })} />
      </Group>
      {[5, 27].map((s, k) => {
        const c: Vec3 = [COOLER.x, COOLER.y + s, SHELF_TOP];
        const top = SHELF_TOP + COOLER.cradle;
        return (
          <Group key={k} id={`cradle${k}`}>
            <Box id="cradle" material="steel" {...corners([c[0] - 4.6, c[1] - 1.2, SHELF_TOP], [c[0] + 4.6, c[1] + 1.2, top])} r={0.3} />
            <Marks
              id="cradle-dots"
              material="steel"
              dots={[-3.6, 3.6].map((dx) => ({ at: [c[0] + dx, c[1], top] as const, size: 0.36, normal: [0, 0, 1] as const }))}
            />
          </Group>
        );
      })}
      {COOL_DEGS.map((deg, k) => (
        <Pipe key={k} k={k} deg={deg} />
      ))}
    </Group>
  );
}
