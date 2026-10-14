/**
 * The packer's static body (v2 packer.mjs L46–232): the stand (`stand`: legs on feet with screws,
 * heads, two stringer rings, diagonal braces, the shelf with the air receiver on saddles, its gauge,
 * and the vacuum pump with its motor); the deck with its tabs, seam, T-slots and edge screws; the
 * lane (two turned columns with bolt circles, the bed with the beam's slot, the far guide rail on
 * posts); the magazine (posts, gate, hopper with its window, cap, knob); the pusher cylinder; the
 * erector bridge over S0; the gutter (post, floor with pocket rings, far wall with the emitters,
 * stop, lip, near wall with the receivers and their LEDs) and v4's transfer plate from belt A's head;
 * the two arm pedestals (stepped columns, graphite turrets, slewing rings, cable bosses); the
 * graphite drive box, cabinet and valve manifold; the cables and the pusher's hoses.
 */
import { Box, Extrude, Group, Halo, Lathe, Marks, Tube } from '../../blocks/blocks.tsx';
import { type V3, circle, closed, corners, frameAlong, rod, screws } from '../kit.ts';
import { DECK, GT, P, PEDESTALS, PK, type PedestalSpec, deckBolts, deckRing, pbox, standAt, stepped } from './dims.ts';

/** A bolt circle on a face with normal n (dots only), centred at c. */
const boltCircle = (c: V3, r: number, count: number, n: V3 = [0, 0, 1], size = 0.42, phase = 0) =>
  Array.from({ length: count }, (_, k) => {
    const a = phase + (2 * Math.PI * k) / count;
    return { at: [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), c[2]] as V3, size, normal: n };
  });

/** Screws (ring + dot) at plan points on a horizontal face at z. */
const planScrews = (pts: readonly (readonly [number, number])[], z: number, ring: number, size: number) =>
  screws(
    pts.map(([x, y]) => [x - 100, y + 118] as const),
    z,
    ring,
    size,
  );

// ---- stand ---------------------------------------------------------------------------------------

/** The stand on a floor at z (v2 `floor`; the standalone page raises it to 120). */
export function Stand({ floor = 0 }: { floor?: number }) {
  const { legs, legTop, lowZ, highZ, shelfZ, tall } = standAt(floor);
  const [[ax, ay], [bx], , [, dy]] = legs;
  const ring = (z: number, tag: string) => (
    <Group id={tag}>
      <Box id="a" material="graphite" {...pbox([ax + 1.8, ay - 1, z], [bx - 1.8, ay + 1, z + 2])} r={0.3} />
      <Box id="d" material="graphite" {...pbox([ax + 1.8, dy - 1, z], [bx - 1.8, dy + 1, z + 2])} r={0.3} />
      <Box id="b" material="graphite" {...pbox([bx - 1, ay + 1.8, z + 2], [bx + 1, dy - 1.8, z + 4])} r={0.3} />
      <Box id="c" material="graphite" {...pbox([ax - 1, ay + 1.8, z + 2], [ax + 1, dy - 1.8, z + 4])} r={0.3} />
    </Group>
  );
  const z0 = lowZ + 4.5;
  const z1 = highZ - 0.5;
  const zs = lowZ + 6.4;
  const braces: [V3, V3][] = [
    [P(ax + 1.8, ay, z0), P(bx - 1.8, ay, z1)],
    [P(ax + 1.8, dy, z1), P(bx - 1.8, dy, z0)],
    [P(bx, ay + 1.8, z1), P(bx, dy - 1.8, zs)],
    [P(ax, ay + 1.8, zs), P(ax, dy - 1.8, z1)],
  ];
  // The air receiver along x at y −127 (plan), on two saddles.
  const TR = 4.5;
  const tankZ = shelfZ + 1.2 + 2 + TR;
  const TF = frameAlong(P(82, -127, tankZ), [1, 0, 0]);
  const neck = P(96, -127 + Math.sqrt(TR * TR - 0.49), tankZ);
  const gauge: V3 = [neck[0], neck[1] + 1.8, neck[2]];
  const pumpAt = P(116, -116, shelfZ + 1.2);
  return (
    <Group id="stand">
      <Halo id="halo" plan={{ w: 62, d: 48, r: 4 }} position={P(100, -127, floor)} />
      {legs.map(([x, y], i) => (
        <Group key={i} id={`leg${i}`}>
          <Box id="foot" material="graphite" {...pbox([x - 3.6, y - 3.6, floor], [x + 3.6, y + 3.6, floor + 1.2])} r={0.8} />
          <Marks id="foot-screws" material="graphite" {...planScrews([[x - 2.4, y - 2.4], [x + 2.4, y - 2.4], [x - 2.4, y + 2.4], [x + 2.4, y + 2.4]], floor + 1.2, 0.6, 0.35)} />
          <Box id="leg" material="graphite" {...pbox([x - 1.8, y - 1.8, floor + 1.2], [x + 1.8, y + 1.8, legTop - 1])} r={0.3} />
          <Box id="head" material="graphite" {...pbox([x - 3, y - 3, legTop - 1], [x + 3, y + 3, legTop])} r={0.5} />
        </Group>
      ))}
      {ring(lowZ, 'stringers')}
      {tall && ring(highZ, 'rails')}
      {tall &&
        braces.map(([a, b], i) => (
        <Tube key={i} id={`brace${i}`} material="graphite" path={[a, b]} radius={0.45} sides={10} caps={[true, true]} />
      ))}
      <Box id="shelf" material="graphite" {...pbox([ax - 1, ay + 2, shelfZ], [bx + 1, dy - 2, shelfZ + 1.2])} r={0.4} />
      <Marks id="shelf-screws" material="graphite" {...planScrews([[ax + 3, ay + 4.5], [bx - 3, ay + 4.5], [ax + 3, dy - 4.5], [bx - 3, dy - 4.5]], shelfZ + 1.2, 0.6, 0.32)} />
      {[88, 104].map((x) => (
        <Box key={x} id={`saddle${x}`} material="steel" outline="lo" {...pbox([x - 1.5, -131.5, shelfZ + 1.2], [x + 1.5, -122.5, shelfZ + 3.2])} r={0.3} />
      ))}
      <Lathe
        id="tank"
        material="steel"
        profile={[[0, 0], [1.2, 0], [1.2, 0.8], [2.6, 0.8], [3.7, 1.5, true], [4.3, 2.3, true], [TR, 3.2, true], [TR, 28.8, true], [4.3, 29.7, true], [3.7, 30.5, true], [2.6, 31.2], [1.2, 31.2], [1.2, 32], [0, 32]]}
        seams={[9, 23]}
        steps={40}
        {...TF}
      />
      <Lathe id="neck" material="steel" profile={rod(0.7, 0, 1.8)} steps={14} {...frameAlong(neck, [0, 1, 0])} />
      <Lathe id="gauge" material="steel" profile={rod(2.2, 0, 1.2)} steps={28} {...frameAlong(gauge, [0, 1, 0])} />
      <Marks
        id="gauge-face"
        material="steel"
        segments={[...circle([gauge[0], gauge[1] + 1.2, gauge[2]], 1.6, [0, 1, 0], 'faint', 24), { a: [gauge[0], gauge[1] + 1.2, gauge[2]], b: [gauge[0] + 0.9, gauge[1] + 1.2, gauge[2] + 0.9], tone: 'lo', normal: [0, 1, 0] }]}
      />
      <Lathe id="pump" material="steel" profile={stepped([[0, 1, 3.8], [1, 7.5, 3], [7.5, 9, 2.2]])} steps={32} position={pumpAt} />
      <Lathe id="pumpMotor" material="steel" profile={stepped([[0, 7, 2.2], [7, 8, 1.6]])} steps={24} {...frameAlong(P(116, -119, shelfZ + 5), [0, -1, 0])} />
    </Group>
  );
}

// ---- deck, lane, magazine, pusher, bridge --------------------------------------------------------

export function Deck() {
  const ring = deckRing();
  const D = DECK;
  const tslot = (y: number) => {
    const [x0, ly] = P(D.X0 + 4, y, 0);
    const [x1] = P(D.X1 - 4, y, 0);
    const pts: V3[] = [];
    for (let i = 0; i <= 6; i++) pts.push([x1 - 0.8 + 0.8 * Math.cos(-Math.PI / 2 + (i * Math.PI) / 6), ly + 0.8 * Math.sin(-Math.PI / 2 + (i * Math.PI) / 6), D.top]);
    for (let i = 0; i <= 6; i++) pts.push([x0 + 0.8 + 0.8 * Math.cos(Math.PI / 2 + (i * Math.PI) / 6), ly + 0.8 * Math.sin(Math.PI / 2 + (i * Math.PI) / 6), D.top]);
    return closed(pts, [0, 0, 1], 'lo');
  };
  const bolts = deckBolts();
  return (
    <Group id="deck">
      <Extrude id="plate" material="steel" plan={ring} z={D.z} height={D.top - D.z} seams={[D.z + 3]} />
      <Marks id="marks" material="steel" segments={[...tslot(-128), ...tslot(-121), ...tslot(-114), ...screws(bolts, D.top, 0.7, 0.35).segments]} dots={screws(bolts, D.top, 0.7, 0.35).dots} />
    </Group>
  );
}

export function Lane() {
  const top = DECK.top;
  return (
    <Group id="lane">
      {[-136, -112].map((y) => {
        const at = P(100, y, top);
        return (
          <Group key={y} id={`column${y < -120 ? 0 : 1}`}>
            <Lathe id="column" material="steel" profile={stepped([[0, 1.4, 5.4], [1.4, 12.6, 3], [12.6, 14, 5.4]])} steps={40} position={at} />
            <Marks id="bolts" material="steel" dots={[...boltCircle([at[0], at[1], top + 1.4], 4.4, 8), ...boltCircle([at[0], at[1], top + 14], 4.4, 8)]} />
          </Group>
        );
      })}
      <Box id="bed" material="steel" {...pbox([93, -140, 196], [107, -95.3, 200])} r={0.8} seams={[198]} />
      <Marks
        id="slot"
        material="steel"
        segments={(() => {
          const [x, y0] = P(100, -131.6, 200);
          const [, y1] = P(100, -96, 200);
          const pts: V3[] = [];
          for (let i = 0; i <= 6; i++) pts.push([x + Math.cos((i * Math.PI) / 6), y1 - 1 + Math.sin((i * Math.PI) / 6), 200]);
          for (let i = 0; i <= 6; i++) pts.push([x + Math.cos(Math.PI + (i * Math.PI) / 6), y0 + 1 + Math.sin(Math.PI + (i * Math.PI) / 6), 200]);
          return closed(pts, [0, 0, 1], 'lo');
        })()}
      />
      {[-126, -112, -99].map((y, i) => (
        <Lathe key={y} id={`railpost${i}`} material="steel" profile={rod(0.5, 200, 203.5)} steps={16} position={[...P(93.6, y, 0)]} />
      ))}
      <Box id="rail" material="steel" {...pbox([93.1, -128.5, 203.5], [94.1, -97.5, 205])} r={0.3} />
    </Group>
  );
}

export function Magazine() {
  const hz = PK.magazine.hopperZ;
  const window: V3[] = [P(96, -130, 209), P(104, -130, 209), P(104, -130, 215.5), P(96, -130, 215.5)];
  return (
    <Group id="magazine">
      {[[94.4, -139.5], [105.6, -139.5], [94.4, -130.5], [105.6, -130.5]].map(([x, y], i) => (
        <Box key={i} id={`post${i}`} material="steel" {...pbox([x! - 0.5, y! - 0.5, 200], [x! + 0.5, y! + 0.5, hz])} r={0.15} />
      ))}
      <Box id="gate" material="steel" {...pbox([94.9, -130.9, 201.4], [105.1, -130.1, 202.6])} r={0.2} />
      <Box id="hopper" material="steel" {...pbox([93.9, -140, hz], [106.1, -130, hz + 11])} r={0.6} seams={[hz + 1.2]} />
      <Marks
        id="hopper-marks"
        material="steel"
        segments={[...closed(window.map((p) => [p[0], p[1] + 0.01, p[2]] as V3), [0, 1, 0], 'lo'), ...planScrews([[94.8, -130.9], [105.2, -130.9], [94.8, -139.1], [105.2, -139.1]], hz + 11, 0.5, 0.3).segments]}
        dots={planScrews([[94.8, -130.9], [105.2, -130.9], [94.8, -139.1], [105.2, -139.1]], hz + 11, 0.5, 0.3).dots}
      />
      <Box id="cap" material="steel" {...pbox([95, -138.6, hz + 11], [105, -131.4, hz + 12])} r={0.6} />
      <Lathe id="knob" material="steel" profile={rod(1.2, hz + 12, hz + 13.4)} steps={20} position={[...P(100, -135, 0)]} />
    </Group>
  );
}

/** The pusher's cylinder (its rod and plate are live, in `Live.tsx`). */
export function PusherBody() {
  return (
    <Group id="pusher">
      <Box id="block" material="steel" {...pbox([98, -146.6, DECK.top], [102, -141.6, 198.7])} r={0.4} seams={[190]} />
      <Lathe id="body" material="steel" profile={stepped([[0, 0.7, 1.3], [0.7, 5.5, 1.8], [5.5, 6.2, 1.3]])} steps={24} {...frameAlong(P(100, -147.2, 200.5), [0, 1, 0])} />
      <Lathe id="gland" material="steel" profile={rod(0.95, 0, 0.6)} steps={16} {...frameAlong(P(100, -141, 200.5), [0, 1, 0])} />
      {[-145.6, -142.4].map((y, i) => (
        <Lathe key={y} id={`port${i}`} material="steel" profile={rod(0.9, 0, 1.2)} steps={14} {...frameAlong(P(101.8, y, 200.5), [1, 0, 0])} />
      ))}
    </Group>
  );
}

/** The erector bridge over S0 (its rod and pad are live). */
export function Bridge() {
  const S0 = -124;
  const top = DECK.top;
  return (
    <Group id="bridge">
      {[90.5, 109.5].map((x, i) => {
        const at = P(x, S0, top);
        return (
          <Group key={x} id={`post${i}`}>
            <Lathe id="post" material="steel" profile={stepped([[0, 1, 2.2], [1, 32, 1.1]])} steps={20} position={at} />
            <Marks id="bolts" material="steel" dots={boltCircle([at[0], at[1], top + 1], 1.7, 4, [0, 0, 1], 0.32, Math.PI / 4)} />
          </Group>
        );
      })}
      <Box id="beam" material="steel" {...pbox([89.2, S0 - 1.3, 214], [110.8, S0 + 1.3, 216.4])} r={0.4} />
      <Marks id="beam-screws" material="steel" {...planScrews([[90.5, S0], [109.5, S0]], 216.4, 0.6, 0.3)} />
      <Lathe id="cylinder" material="steel" profile={stepped([[0, 0.7, 1.5], [0.7, 6.4, 2], [6.4, 7.4, 1.4]])} seams={[3.6]} steps={28} position={P(100, S0, 216.4)} />
      <Lathe id="gland" material="steel" profile={rod(0.9, 0, 0.7)} steps={16} {...frameAlong(P(100, S0, 214), [0, 0, -1])} />
    </Group>
  );
}

// ---- gutter and the transfer plate -----------------------------------------------------------------

export function Gutter() {
  const gz = GT.z;
  const y = GT.y;
  const post = P(86, y, DECK.top);
  return (
    <Group id="gutter">
      <Lathe id="post" material="steel" profile={stepped([[0, 0.9, 2.6], [0.9, 43.6, 1.3], [43.6, 44.6, 2.2]])} steps={24} position={post} />
      <Marks id="post-bolts" material="steel" dots={boltCircle([post[0], post[1], DECK.top + 0.9], 2, 4, [0, 0, 1], 0.32, Math.PI / 4)} />
      <Box id="floor" material="steel" {...pbox([GT.x0, y - 3, gz - 1.4], [GT.x1, y + 3, gz])} r={0.2} />
      <Marks id="pockets" material="steel" segments={GT.pockets.flatMap((x) => circle(P(x, y, gz), 2.1, [0, 0, 1], 'faint', 28))} />
      <Box id="wall" material="steel" {...pbox([GT.x0, y - 3.6, gz - 1.4], [GT.x1, y - 3, gz + 3.6])} r={0.1} />
      {GT.pockets.map((x, i) => (
        <Box key={x} id={`eye${i}`} material="steel" {...pbox([x - 0.7, y - 3.5, gz + 3.6], [x + 0.7, y - 3.1, gz + 4.6])} r={0.1} />
      ))}
      <Box id="stop" material="steel" {...pbox([GT.x1, y - 3.6, gz - 1.4], [GT.x1 + 0.8, y + 3.6, gz + 3.6])} r={0.1} />
      <Lathe id="lip" material="steel" profile={rod(0.8, 0, 6)} steps={16} {...frameAlong(P(GT.x0 - 0.8, y - 3, gz - 0.8), [0, 1, 0])} />
      <Box id="near" material="steel" {...pbox([GT.x0, y + 3, gz - 1.4], [GT.x1, y + 3.6, gz + 1.4])} r={0.1} />
      {GT.pockets.map((x, i) => (
        <Group key={x} id={`receiver${i}`}>
          <Box id="block" material="steel" {...pbox([x - 0.8, y + 3, gz + 1.4], [x + 0.8, y + 3.8, gz + 2.8])} r={0.15} />
        </Group>
      ))}
      {GT.pockets.map((x, i) => (
        <Lathe key={`led${i}`} id={`led${i}`} material="steel" outline="lo" profile={rod(0.42, 0, 0.25)} steps={14} live blend={{ material: 'react' }} {...frameAlong(P(x, y + 3.8, gz + 2.1), [0, 1, 0])} />
      ))}
      <Transfer />
    </Group>
  );
}

/**
 * v4's transfer plate (not in v2, which flung beads across the gap): a sloped plate with low side
 * guards from over belt A's head drum down onto the gutter's lip, on a cross bar over belt A's rails.
 */
function Transfer() {
  const T = PK.transfer;
  const [x0, z0] = T.lip;
  const [x1, z1] = T.end;
  const len = Math.hypot(x1 - x0, z1 - z0);
  const deg = (Math.atan2(z0 - z1, x1 - x0) * 180) / Math.PI;
  const s = Math.sin((deg * Math.PI) / 180);
  const c = Math.cos((deg * Math.PI) / 180);
  // Ry(+deg) tips +x down: a box centred on the plate's mid line, its top on the bead path.
  const mid = (dz: number, dy: number): V3 => [(x0 + x1) / 2 - s * dz, dy, (z0 + z1) / 2 + c * dz];
  const barX = -38;
  const barZ = z0 + ((barX - x0) / (x1 - x0)) * (z1 - z0) - 0.6;
  return (
    <Group id="transfer">
      <Box id="plate" material="steel" size={[len, 6, 0.6]} position={mid(-0.3, 0)} rotation={[0, deg, 0]} />
      {[-1, 1].map((side) => (
        <Box key={side} id={`guard${side > 0 ? 1 : 0}`} material="steel" size={[len, 0.5, 1.6]} position={mid(0.2, side * 3.25)} rotation={[0, deg, 0]} />
      ))}
      <Box id="bar" material="steel" {...corners([barX - 1, -14, barZ - 0.8], [barX + 1, 14, barZ])} r={0.2} />
    </Group>
  );
}

// ---- pedestals, cabinet, manifold, cables ----------------------------------------------------------

function Pedestal({ id, p }: { id: string; p: PedestalSpec }) {
  const top = p.yokeZ - DECK.top;
  const mid = Math.round(top * 0.45);
  const at = P(p.base[0], p.base[1], DECK.top);
  const segs = [
    [0, 1.4, p.foot],
    [1.4, 2.6, p.col + 0.9],
    [2.6, mid - 0.7, p.col],
    [mid - 0.7, mid + 0.7, p.col + 0.7],
    [mid + 0.7, top - 10.2, p.col - 0.5],
    [top - 10.2, top - 9, p.col + 0.3],
    [top - 9, top - 8, p.tr + 0.4],
  ] as const;
  const c = (s: number): V3 => [at[0], at[1], DECK.top + s];
  return (
    <Group id={id}>
      <Lathe id="pedestal" material="steel" profile={stepped(segs)} steps={40} position={at} />
      <Marks id="bolts" material="steel" dots={[...boltCircle(c(1.4), p.foot - 1.1, 10), ...boltCircle(c(mid + 0.7), p.col + 0.2, 6, [0, 0, 1], 0.3), ...boltCircle(c(top - 8), p.tr - 0.5, 8, [0, 0, 1], 0.34)]} />
      <Lathe id="turret" material="graphite" profile={rod(p.tr, p.yokeZ - 8, p.yokeZ - 0.8)} seams={[p.yokeZ - 4.4]} steps={40} position={[at[0], at[1], 0]} />
      <Lathe id="slew" material="steel" profile={rod(p.tr + 0.4, p.yokeZ - 0.8, p.yokeZ)} steps={40} position={[at[0], at[1], 0]} />
      <Lathe id="port" material="steel" profile={rod(1.1, 0, 1.4)} steps={16} {...frameAlong(P(p.base[0], p.base[1] - 2.9, 190), [0, -1, 0])} />
    </Group>
  );
}

export function Pedestals() {
  return (
    <>
      <Pedestal id="pickerBase" p={PEDESTALS.picker} />
      <Pedestal id="folderBase" p={PEDESTALS.folder} />
    </>
  );
}

export function Cabinet() {
  const top = DECK.top;
  const door: V3[] = [P(116.4, -131.99, 184), P(126.6, -131.99, 184), P(126.6, -131.99, 197), P(116.4, -131.99, 197)];
  const louvre = (z: number): V3[] => [P(128.31, -146, z), P(128.31, -138, z), P(128.31, -138, z + 0.7), P(128.31, -146, z + 0.7)];
  const label = (z: number, x1: number) => ({ a: P(128.31, -144.2, z), b: P(128.31, x1, z), tone: 'lo' as const, normal: [1, 0, 0] as V3 });
  const valves = [-145.6, -142.4];
  // Cables: the drive box's and the cabinet's glands to the pedestals' bosses, sagging onto the deck.
  const pk = PEDESTALS.picker.base;
  const fd = PEDESTALS.folder.base;
  const cable = (x: number, y0: number, y1: number): V3[] => [P(x, y0, 190), P(x, y0 + 2.5, 186.2), P(x, y1 - 2.5, 186.2), P(x, y1, 190)];
  const hose = (y: number): V3[] => [P(108, y, 188.6), P(108, y, 195), P(108, y, 200.5), P(105, y, 200.5), P(103, y, 200.5)];
  return (
    <Group id="cabinet">
      <Group id="drive">
        <Box id="box" material="graphite" {...pbox([71.5, -147, top], [80.5, -137, top + 13])} r={0.6} seams={[top + 10]} />
        <Marks id="screws" material="graphite" {...planScrews([[72.5, -146], [79.5, -146], [72.5, -138], [79.5, -138]], top + 13, 0.5, 0.3)} />
        <Lathe id="gland" material="steel" profile={rod(1.1, 0, 1.2)} steps={16} {...frameAlong(P(78, -137, 190), [0, 1, 0])} />
      </Group>
      <Box id="body" material="graphite" {...pbox([115, -148, top], [128, -132, top + 17])} r={0.8} />
      <Marks
        id="body-marks"
        material="graphite"
        segments={[
          ...closed(door, [0, 1, 0], 'lo'),
          ...[184.2, 185.6, 187, 188.4].flatMap((z) => closed(louvre(z), [1, 0, 0], 'lo')),
          label(194.9, -137.8),
          label(193.7, -139.6),
          label(192.6, -141.4),
          ...planScrews([[116, -147], [127, -147], [116, -133], [127, -133]], top + 17, 0.5, 0.3).segments,
        ]}
        dots={planScrews([[116, -147], [127, -147], [116, -133], [127, -133]], top + 17, 0.5, 0.3).dots}
      />
      <Box id="handle" material="steel" {...pbox([124.6, -132, 189.2], [125.6, -131.4, 192.4])} r={0.2} />
      <Box id="hinge0" material="steel" outline="lo" {...pbox([116.8, -132, 186], [117.6, -131.6, 188])} r={0.1} />
      <Box id="hinge1" material="steel" outline="lo" {...pbox([116.8, -132, 193], [117.6, -131.6, 195])} r={0.1} />
      <Box id="label" material="steel" {...pbox([128, -145, 192], [128.3, -137, 196])} />
      <Box id="vent" material="graphite" {...pbox([128, -146.6, 183.4], [128.3, -137.4, 189.6])} />
      <Lathe id="lamp" material="steel" outline="lo" profile={rod(0.7, 0, 0.6)} steps={16} live blend={{ material: 'lit' }} {...frameAlong(P(128, -134.6, 196.6), [1, 0, 0])} />
      <Lathe id="gland" material="steel" profile={rod(1.1, 0, 1.2)} steps={16} {...frameAlong(P(121, -132, 190), [0, 1, 0])} />
      <Box id="manifold" material="graphite" {...pbox([105, -147.4, top], [111, -141.4, 185.4])} r={0.4} />
      <Marks id="manifold-screws" material="graphite" {...planScrews([[105.8, -146.6], [110.2, -146.6], [105.8, -142.2], [110.2, -142.2]], 185.4, 0.4, 0.28)} />
      {valves.map((y, i) => (
        <Group key={y} id={`valve${i}`}>
          <Box id="body" material="steel" {...pbox([106.2, y - 1.2, 185.4], [109.8, y + 1.2, 187.6])} r={0.3} />
          <Lathe id="coil" material="steel" profile={rod(1, 187.6, 188.6)} steps={18} position={[...P(108, y, 0)]} />
          <Tube id="hose" material="graphite" path={hose(y)} radius={0.5} sides={10} bend={1.2} />
        </Group>
      ))}
      <Tube id="cablePicker" material="graphite" path={cable(pk[0], -135.8, pk[1] - 4.3)} radius={0.75} sides={12} bend={2} />
      <Tube id="cableFolder" material="graphite" path={cable(fd[0], -130.8, fd[1] - 4.3)} radius={0.75} sides={12} bend={2} />
    </Group>
  );
}

