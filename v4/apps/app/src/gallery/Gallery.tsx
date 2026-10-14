/**
 * The M2 gallery: every building block once, in rows from back to front.
 *   m1        the M1 composition (regression check)
 *   ext       extrudes: rect box, rounded slab with seams, circle post, sector rim, rotated gusset
 *   lathe     smooth dome with line sets, sphere, closed ring tube, open pipe, belt over pulleys
 *   inst      instances: spinner (carousel + 10 vanes + bolt circle), packet pool (3 materials)
 *   marks     needle on a moving group, polyline rules, dots on a box top
 *   contact   post through ring, ribs sunk into a drum, saddle pad on a cylinder, flush control
 */
import {
  type GroupHandle,
  type PoolHandle,
  type ProfilePoint,
  type Vec3,
  type ViewPreset,
  boltCircle,
  polyline,
  sphereProfile,
} from '@anatomy/engine';
import {
  Belt,
  Box,
  Extrude,
  Group,
  Instances,
  Lathe,
  Marks,
  Tube,
  useFrame,
  useNode,
} from '../blocks/blocks.tsx';
import { M1Row, m1Views } from './M1Row.tsx';

/** Screen right and toward the viewer on the ground, at the kit view (yaw 45°). */
const RIGHT: Vec3 = [Math.SQRT1_2, -Math.SQRT1_2, 0];
const FRONT: Vec3 = [Math.SQRT1_2, Math.SQRT1_2, 0];
const CELL = 24;
/** Row depth (toward the viewer); rows are spaced by the height of the row in front. */
const ROW_AT = { m1: 0, ext: 44, lathe: 76, inst: 108, marks: 140, contact: 172 } as const;
type Row = keyof typeof ROW_AT;

const cell = (row: Row, col: number): [number, number, number] => {
  const u = (col - 2) * CELL;
  const w = ROW_AT[row];
  return [RIGHT[0] * u + FRONT[0] * w, RIGHT[1] * u + FRONT[1] * w, 0];
};
const local = (row: Row, col: number): Vec3 => {
  const [x, y] = cell(row, col);
  const [ox, oy] = cell(row, 2);
  return [x - ox, y - oy, 0];
};

const lift = (p: Vec3, z: number): Vec3 => [p[0], p[1], z];

// ---- row: extrudes --------------------------------------------------------------------------

function Extrudes() {
  return (
    <Group id="ext" position={cell('ext', 2)}>
      <Box id="rect" material="steel" size={[8, 6, 5]} center={[0, 0, 2.5]} position={local('ext', 0)} />
      <Extrude
        id="slab"
        material="steel"
        plan={{ rect: [10, 6], r: 1.5 }}
        height={3}
        seams={[1, 2]}
        position={local('ext', 1)}
      />
      <Extrude id="post" material="graphite" plan={{ circle: 2 }} height={9} position={local('ext', 2)} />
      {/* The gap faces the viewer (yaw 45°). */}
      <Extrude
        id="rim"
        material="steel"
        plan={{ sector: { r0: 5, r1: 6.5, a0: 75, a1: 375 } }}
        height={3}
        position={local('ext', 3)}
      />
      {/* A prism in the xz plane: its model z is horizontal, so it falls back to bands. */}
      <Extrude
        id="gusset"
        material="react"
        outline="hi"
        plan={{ polygon: [[-4, 0], [4, 0], [-4, 7]] }}
        z={-0.6}
        height={1.2}
        rotation={[90, 0, 0]}
        position={local('ext', 4)}
      />
    </Group>
  );
}

// ---- row: lathes and tubes ------------------------------------------------------------------

const DOME: ProfilePoint[] = [
  [0, 0],
  [6, 0],
  [6, 3.5], // segment 1: ribs
  [5.7, 5, true],
  [4.6, 6.5, true],
  [2.8, 7.5, true],
  [1.6, 7.8],
  [1.6, 8.6],
  [0, 8.6],
];
const RIBS = {
  count: 32, phase: 0, first: 0, last: 31, majorEvery: 0, minor: 'lo', major: 'lo',
  width: 0.6, majorWidth: 0.6, fade: [0.1, 0.55],
} as const;
const PULLEY = (r: number): ProfilePoint[] => [
  [0, 0],
  [r + 0.3, 0],
  [r + 0.3, 0.4],
  [r, 0.7],
  [r, 1.3],
  [r + 0.3, 1.6],
  [r + 0.3, 2],
  [0, 2],
];
const circlePath = (r: number, z: number, n = 48): Vec3[] =>
  Array.from({ length: n }, (_, k) => {
    const a = (2 * Math.PI * k) / n;
    return [r * Math.cos(a), r * Math.sin(a), z] as const;
  });

function Lathes() {
  const beltA: Vec3 = [-3.5, 2, 1];
  const beltB: Vec3 = [4, -2, 1];
  return (
    <Group id="lathe" position={cell('lathe', 2)}>
      <Lathe
        id="dome"
        material="steel"
        profile={DOME}
        marks={[2]}
        lineSets={[{ segment: 1, lines: RIBS }]}
        position={local('lathe', 0)}
      />
      <Lathe id="sphere" material="react" outline="hi" profile={sphereProfile(3.5)} position={lift(local('lathe', 1), 3.5)} />
      <Tube id="ring" material="steel" path={circlePath(4, 0.8)} radius={0.8} bend={0} closed position={local('lathe', 2)} />
      <Tube
        id="pipe"
        material="graphite"
        path={[[-1, 4, 0.8], [-1, -2, 0.8], [-1, -2, 7]]}
        radius={0.8}
        caps={[false, false]}
        position={local('lathe', 3)}
      />
      <Group id="drive" position={local('lathe', 4)}>
        <Lathe id="pa" material="steel" profile={PULLEY(3)} position={[beltA[0], beltA[1], 0]} />
        <Lathe id="pb" material="steel" profile={PULLEY(1.8)} position={[beltB[0], beltB[1], 0]} />
        <Belt id="belt" material="graphite" a={beltA} ra={3.36} b={beltB} rb={2.16} radius={0.35} contacts={false} />
      </Group>
    </Group>
  );
}

// ---- row: instances -------------------------------------------------------------------------

const CAROUSEL: ProfilePoint[] = [
  [0, 0],
  [6, 0],
  [6, 1.2],
  [2, 1.2],
  [2, 3],
  [0, 3],
];
const VANES = 10;
const PACKET_CAPACITY = 16;

function Spinner() {
  const spinner = useNode<GroupHandle>('spinner');
  const vanes = useNode<PoolHandle>('spinner.vanes');
  useFrame(({ t }) => {
    spinner().spin('z', t * 0.6);
    const pool = vanes();
    pool.count = VANES;
    for (let i = 0; i < VANES; i++) {
      const a = (2 * Math.PI * i) / VANES;
      pool.pose(i, [4 * Math.cos(a), 4 * Math.sin(a), 1.2], a);
    }
  });
  return (
    <Group id="spinner" moves position={local('inst', 1)}>
      <Lathe id="carousel" material="steel" profile={CAROUSEL} />
      <Instances
        id="vanes"
        geo={{ kind: 'box', size: [3, 0.4, 2.4], center: [0, 0, 1.2] }}
        styles={[{ material: 'steel' }]}
        capacity={VANES}
      />
      <Marks id="bolts" material="steel" dots={boltCircle({ center: [0, 0, 1.2], r: 5.4, count: 10, phase: 18, tone: 'hi', size: 0.7 })} />
    </Group>
  );
}

function Packets() {
  const packets = useNode<PoolHandle>('packets');
  useFrame(({ t }) => {
    const pool = packets();
    // 0 → 12 → 0 every 6 s.
    const phase = (t % 6) / 6;
    pool.count = Math.round(12 * (1 - Math.abs(1 - 2 * phase)));
    for (let i = 0; i < PACKET_CAPACITY; i++) {
      pool.pose(i, [(i % 4) * 3.2 - 4.8, Math.floor(i / 4) * 3.2 - 4.8, 0.6], 0);
      pool.style(i, i % 3);
    }
  });
  return (
    <>
      <Box id="plate" material="steel" size={[14, 14, 0.6]} center={[0, 0, 0.3]} position={local('inst', 3)} />
      <Instances
        id="packets"
        geo={{ kind: 'box', size: [2.5, 2, 1.75], r: 0.4, center: [0, 0, 0.875], seams: [0.875] }}
        styles={[{ material: 'steel' }, { material: 'graphite' }, { material: 'react', outline: 'hi' }]}
        capacity={PACKET_CAPACITY}
        position={local('inst', 3)}
      />
    </>
  );
}

function InstancesRow() {
  return (
    <Group id="inst" position={cell('inst', 2)}>
      <Spinner />
      <Packets />
    </Group>
  );
}

// ---- row: marks -----------------------------------------------------------------------------

const DIAL: ProfilePoint[] = [
  [0, 0],
  [4.5, 0],
  [4.5, 1.2],
  [4.1, 1.2],
  [4.1, 0.9],
  [0, 0.9],
];

function MarksRow() {
  const needle = useNode<GroupHandle>('marks.needle');
  useFrame(({ t }) => {
    // Sweep 270° (−135° … +135° around the gap) and back.
    const s = 0.5 - 0.5 * Math.cos(t * 0.9);
    needle().spin('z', ((-135 + 270 * s) * Math.PI) / 180 - Math.PI / 4);
  });
  const rules = [1.5, 3, 4.5].flatMap((z) =>
    polyline([[0.51, -4, z], [0.51, 4, z]], { normal: [1, 0, 0], tone: 'mid' }),
  );
  const frame = polyline(
    [[0.51, -4.6, 0.6], [0.51, 4.6, 0.6], [0.51, 4.6, 5.4], [0.51, -4.6, 5.4]],
    { normal: [1, 0, 0], tone: 'lo', closed: true },
  );
  const tones = ['hi', 'mid', 'lo', 'faint'] as const;
  const dots = Array.from({ length: 16 }, (_, i) => ({
    at: [(i % 4) * 2 - 3, Math.floor(i / 4) * 2 - 3, 3] as Vec3,
    normal: [0, 0, 1] as Vec3,
    tone: tones[Math.floor(i / 4)]!,
    size: 0.8,
  }));
  return (
    <Group id="marks" position={cell('marks', 2)}>
      <Lathe id="dial" material="graphite" profile={DIAL} position={local('marks', 1)} />
      <Group id="needle" moves position={lift(local('marks', 1), 0.9)}>
        <Marks
          id="hand"
          material="graphite"
          segments={[{ a: [0, 0, 0], b: [3.6, 0, 0], width: 1.0, tone: 'hi', normal: [0, 0, 1] }]}
          dots={[{ at: [0, 0, 0], size: 0.8, tone: 'hi', normal: [0, 0, 1] }]}
        />
      </Group>
      <Group id="plate" position={local('marks', 2)}>
        <Box id="board" material="steel" size={[1, 10, 6]} center={[0, 0, 3]} />
        <Marks id="rules" material="steel" segments={[...rules, ...frame]} />
      </Group>
      <Group id="top" position={local('marks', 3)}>
        <Box id="block" material="steel" size={[8, 8, 3]} center={[0, 0, 1.5]} />
        <Marks id="dots" material="steel" dots={dots} />
      </Group>
    </Group>
  );
}

// ---- row: contacts --------------------------------------------------------------------------

function Contacts() {
  const posts = [45, 135, 225, 315].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return [3 * Math.cos(a), 3 * Math.sin(a), 0] as Vec3;
  });
  const ribs = [-20, 20, 45, 70, 110].map((deg) => deg);
  return (
    <Group id="contact" position={cell('contact', 2)}>
      <Group id="cage" position={local('contact', 0)}>
        <Tube id="ring" material="steel" path={circlePath(3, 5)} radius={0.5} bend={0} closed />
        {posts.map((p, k) => (
          <Extrude key={k} id={`post${k}`} material="steel" plan={{ circle: 0.35, steps: 24 }} height={7} position={p} />
        ))}
      </Group>
      <Group id="drum" position={local('contact', 1)}>
        <Lathe id="body" material="steel" profile={[[0, 0], [4, 0], [4, 6], [0, 6]]} />
        {ribs.map((deg, k) => (
          <Extrude
            key={k}
            id={`rib${k}`}
            material="steel"
            plan={{ polygon: [[3.95, -0.25], [5.2, -0.25], [5.2, 0.25], [3.95, 0.25]] }}
            z={0}
            height={5}
            rotation={[0, 0, deg]}
          />
        ))}
      </Group>
      <Group id="saddle" position={local('contact', 2)}>
        <Lathe id="pipe" material="steel" profile={[[0, -5], [2.5, -5], [2.5, 5], [0, 5]]} rotation={[0, 90, 0]} position={[0, 0, 2.5]} />
        <Box id="pad" material="graphite" size={[3, 3, 1.2]} center={[0, 0, 0.6]} position={[0, 0, 4.7]} />
      </Group>
      <Group id="flush" position={local('contact', 3)}>
        <Box id="base" material="steel" size={[5, 5, 2]} center={[0, 0, 1]} />
        <Box id="top" material="steel" size={[2.5, 2.5, 2]} center={[0, 0, 3]} />
      </Group>
    </Group>
  );
}

export function Gallery() {
  return (
    <>
      <M1Row id="m1" at={cell('m1', 2)} />
      <Extrudes />
      <Lathes />
      <InstancesRow />
      <MarksRow />
      <Contacts />
    </>
  );
}

const rowView = (row: Row, zoom = 2.6): ViewPreset => {
  const [x, y] = cell(row, 2);
  return { name: `row ${row}`, yaw: 45, elevation: 30, zoom, focus: [x, y, 3] };
};
/** Pairs of neighbouring cells, close up. */
const pairView = (row: Row, col: number, zoom = 5.5): ViewPreset => {
  const [x0, y0] = cell(row, col);
  const [x1, y1] = cell(row, col + 1);
  return { name: `${row} ${col}+${col + 1}`, yaw: 45, elevation: 30, zoom, focus: [(x0 + x1) / 2, (y0 + y1) / 2, 3] };
};
const at = (row: Row, col: number, p: Vec3): [number, number, number] => {
  const [x, y] = cell(row, col);
  return [x + p[0], y + p[1], p[2]];
};

export const GALLERY_VIEWS: ViewPreset[] = [
  { name: 'fit', yaw: 45, elevation: 30, zoom: 1 },
  { name: 'yaw 160', yaw: 160, elevation: 30, zoom: 1 },
  rowView('m1', 3),
  pairView('ext', 0),
  pairView('ext', 2),
  pairView('ext', 3),
  pairView('lathe', 0),
  pairView('lathe', 2),
  pairView('lathe', 3),
  pairView('inst', 1, 4.5),
  pairView('marks', 1),
  pairView('marks', 2),
  pairView('contact', 0),
  pairView('contact', 2),
  // Close-ups (zoom relative to the whole gallery's fit).
  { name: 'close cage', yaw: 45, elevation: 30, zoom: 16, focus: at('contact', 0, [0, 0, 5]) },
  { name: 'close ribs', yaw: 45, elevation: 30, zoom: 16, focus: at('contact', 1, [3, 3, 3]) },
  { name: 'close saddle', yaw: 45, elevation: 30, zoom: 16, focus: at('contact', 2, [0, 0, 4.5]) },
  { name: 'close flush', yaw: 45, elevation: 30, zoom: 16, focus: at('contact', 3, [0, 0, 2]) },
  { name: 'close tube bend', yaw: 45, elevation: 30, zoom: 16, focus: at('lathe', 3, [-1, -2, 1.5]) },
  { name: 'close extrude corner', yaw: 45, elevation: 30, zoom: 16, focus: at('ext', 1, [4, 2, 2]) },
  { name: 'close spinner', yaw: 45, elevation: 30, zoom: 12, focus: at('inst', 1, [0, 0, 2]) },
  { name: 'close packets', yaw: 45, elevation: 30, zoom: 10, focus: at('inst', 3, [0, 0, 1]) },
  { name: 'close needle', yaw: 45, elevation: 30, zoom: 14, focus: at('marks', 1, [0, 0, 1]) },
  { name: 'close dots', yaw: 45, elevation: 30, zoom: 12, focus: at('marks', 3, [0, 0, 3]) },
  ...m1Views(cell('m1', 2), 'm1 '),
];
