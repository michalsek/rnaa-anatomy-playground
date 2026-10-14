/**
 * The elevator's boot (v2 elevator.mjs L51–85): the housing with its seam and the feed opening on
 * its +y face, the top flange with the two run slots and screws, the inspection door and handle;
 * the in-feed chute from belt D (floor, two walls, its leg with `stand`); the take-up on the +x
 * wall (bars, guides, slide, rod and jam nut, the flanged bearing and the shaft's end).
 */
import { Box, Extrude, Group, Lathe, Marks } from '../../blocks/blocks.tsx';
import { FX, type V3, corners, faceScrews, rod, screws, turned } from '../kit.ts';
import { Opening, TopOpening } from '../Opening.tsx';
import { BOOT, CHUTE, EL, FEED_HOLE, FLANGE, SLOTS } from './dims.ts';

export function Boot({ stand }: { stand: boolean }) {
  const B = BOOT;
  const FL = FLANGE;
  const y1 = B.y1;
  const flangeScrews: [number, number][] = [
    [-7, -25.5],
    [7, -25.5],
    [-7, 25.5],
    [7, 25.5],
    [-7, 0],
    [7, 0],
  ];
  const door = { x: 5, y: y1 + 0.6, z0: 4, z1: 18 };
  const doorScrews: V3[] = [
    [-4, door.y, 5.2],
    [4, door.y, 5.2],
    [-4, door.y, 16.8],
    [4, door.y, 16.8],
  ];
  const zb = EL.zb;
  return (
    <Group id="boot">
      <Box id="housing" material="steel" {...corners([B.x0, B.y0, 0], [B.x1, B.y1, B.z1])} r={B.r} seams={[4]} />
      <Opening id="feedHole" lo={[-FEED_HOLE.x, y1 - 0.05, FEED_HOLE.z0]} hi={[FEED_HOLE.x, y1 + 0.02, FEED_HOLE.z1]} from={[0, y1, FEED_HOLE.z0]} to={[0, y1, FEED_HOLE.z1]} />
      <Box id="flange" material="steel" {...corners([FL.x0, FL.y0, FL.z0], [FL.x1, FL.y1, FL.z1])} r={FL.r} />
      <TopOpening id="slotF" x0={-SLOTS.x} x1={SLOTS.x} y0={SLOTS.front[0]} y1={SLOTS.front[1]} z={FL.z1} />
      <TopOpening id="slotB" x0={-SLOTS.x} x1={SLOTS.x} y0={SLOTS.back[0]} y1={SLOTS.back[1]} z={FL.z1} />
      <Marks id="flange-screws" material="steel" {...screws(flangeScrews, FL.z1, 0.5, 0.3)} />
      <Box id="door" material="steel" {...corners([-door.x, y1, door.z0], [door.x, door.y, door.z1])} r={0.4} />
      <Marks id="door-screws" material="steel" {...faceScrews('y', doorScrews, 0.5, 0.3)} />
      <Box id="handle" material="steel" outline="hi" {...corners([-1.5, door.y, 10.4], [1.5, door.y + 1.2, 11.6])} r={0.3} />
      <Group id="chute">
        {stand && <Box id="leg" material="steel" {...corners([-1, CHUTE.y1 - 3, 0], [1, CHUTE.y1 - 1, CHUTE.floor[0]])} r={0.3} />}
        <Box id="floor" material="steel" {...corners([-CHUTE.half, CHUTE.y0, CHUTE.floor[0]], [CHUTE.half, CHUTE.y1, CHUTE.floor[1]])} r={0.3} />
        {[-1, 1].map((side) => (
          <Box
            key={side}
            id={`wall${side > 0 ? 'R' : 'L'}`}
            material="steel"
            {...corners([side > 0 ? CHUTE.half : -CHUTE.half - CHUTE.wall, CHUTE.y0, CHUTE.floor[0]], [side > 0 ? CHUTE.half + CHUTE.wall : -CHUTE.half, CHUTE.y1, CHUTE.wallTop])}
            r={0.3}
          />
        ))}
      </Group>
      <Group id="takeup">
        <Box id="bottom" material="steel" {...corners([7.5, -5.5, 14], [9.5, 5.5, 16])} r={0.3} />
        <Box id="guideB" material="steel" {...corners([7.5, -5.5, 16], [9.5, -4, 34])} r={0.3} />
        <Box id="guideF" material="steel" {...corners([7.5, 4, 16], [9.5, 5.5, 34])} r={0.3} />
        <Box id="top" material="steel" {...corners([7.5, -5.5, 34], [9.5, 5.5, 36])} r={0.3} />
        <Marks id="top-screws" material="steel" {...screws([[8.5, -4.8], [8.5, 4.8]], 36, 0.45, 0.28)} />
        <Box id="slide" material="steel" {...corners([7.5, -4, 22], [10, 4, 30])} r={0.3} />
        <Lathe id="rod" material="steel" profile={rod(0.6, 30, 31)} steps={12} position={[8.75, 0, 0]} />
        <Lathe id="rodTop" material="steel" profile={rod(0.6, 32.2, 34)} steps={12} position={[8.75, 0, 0]} />
        <Extrude id="nut" material="steel" plan={{ circle: 1.2, steps: 6 }} z={31} height={1.2} position={[8.75, 0, 0]} />
        <Group id="bearing" {...FX(10, 0, zb)}>
          <Lathe id="body" material="steel" profile={turned([[0, 2.7], [0.8, 2.7], [0.8, 2.1], [1.6, 2.1]])} steps={24} />
          <Marks id="bolts" material="steel" dots={[0, 1, 2, 3, 4, 5].map((k) => ({ at: [2.4 * Math.cos((k * Math.PI) / 3), 2.4 * Math.sin((k * Math.PI) / 3), 0.8] as V3, size: 0.28, normal: [0, 0, 1] as V3 }))} />
          <Lathe id="shaft" material="steel" outline="hi" profile={turned([[1.6, 1.4], [2.8, 1.4]])} steps={16} />
        </Group>
      </Group>
    </Group>
  );
}
