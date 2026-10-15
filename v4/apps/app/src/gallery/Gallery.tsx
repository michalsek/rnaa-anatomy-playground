/**
 * The M2 gallery: every building block once, in rows from back to front.
 *   m1        the M1 composition (regression check)
 *   ext       extrudes: rect box, rounded slab with seams, circle post, sector rim, rotated gusset
 *   lathe     smooth dome with line sets, sphere, closed ring tube, open pipe, belt over pulleys
 *   inst      instances: spinner (carousel + 10 vanes + bolt circle), packet pool (3 materials)
 *   marks     needle on a moving group, polyline rules, dots on a box top
 *   contact   post through ring, ribs sunk into a drum, saddle pad on a cylinder, flush control
 *   fx        halo under a box, glow on a lit lens, gradient void in a lip, strobe sectors
 *   belt      M5: scrolling slats on a band (E1), cleats pitched round a stadium (E3 path),
 *             a packet blending control → garbage (E2), a packet squashed by axis scale (E3)
 */
import {
  type GeoSpec,
  type GroupHandle,
  type PartHandle,
  type PoolHandle,
  type SpriteHandle,
  type ProfilePoint,
  type Vec3,
  boltCircle,
  pathPoint,
  polyline,
  sphereProfile,
  helix,
  stadium,
  tilt,
} from '@anatomy/engine';
import {
  Band,
  Belt,
  Box,
  Extrude,
  Glow,
  Group,
  Halo,
  Instances,
  Lathe,
  Marks,
  Tube,
  useFrame,
  useNode,
} from '../blocks/blocks.tsx';
import { useState } from 'react';
import { M1Row } from './M1Row.tsx';
import { cell, lift, local } from './views.ts';

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
      {/* Radial bolts round the dial's side: hidden behind, fading toward the limbs. */}
      <Marks
        id="rim-bolts"
        material="graphite"
        dots={boltCircle({ center: [0, 0, 0.6], r: 4.5, count: 24, radial: true, tone: 'hi', size: 0.7 })}
        position={local('marks', 1)}
      />
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

// ---- row: effects ---------------------------------------------------------------------------

const polar = (deg: number, r: number, z: number): Vec3 => [
  r * Math.cos((deg * Math.PI) / 180),
  r * Math.sin((deg * Math.PI) / 180),
  z,
];
const STROBE: ProfilePoint[] = [
  [0, 0],
  [5, 0],
  [5, 1],
  [4.5, 1],
  [4.3, 1], // segment 4: sectors
  [1.5, 1],
  [1.2, 1],
  [0, 1],
];

function Effects() {
  const strobe = useNode<GroupHandle>('fx.strobe');
  const glow = useNode<SpriteHandle>('fx.lamp.glow');
  const soft = useNode<SpriteHandle>('fx.lamp.soft');
  useFrame(({ t }) => {
    strobe().spin('z', t * 0.4);
    const level = 0.45 + 0.4 * Math.max(0, Math.sin(t * 2));
    glow().level = level;
    soft().level = level;
  });
  return (
    <Group id="fx" position={cell('fx', 2)}>
      <Group id="shadow" position={local('fx', 0)}>
        <Halo id="halo" plan={{ w: 8, d: 8, r: 2 }} sigma={1.2} shift={0.4} />
        <Box id="block" material="steel" size={[8, 8, 4]} center={[0, 0, 3]} />
      </Group>
      <Group id="lamp" position={local('fx', 1)}>
        <Box id="body" material="graphite" size={[6, 6, 3]} center={[0, 0, 1.5]} />
        <Lathe id="lens" material="lit" outline="hi" profile={sphereProfile(2.1, 10)} subdivisions={2} position={[0, 0, 3]} />
        <Glow id="soft" fx="glowSoft" radius={2.4} grow={3.2} opacity={0.35} blend="normal" bias={2.2} level={0.45} position={[0, 0, 3]} />
        <Glow id="glow" fx="glow" radius={1.6} opacity={0.85} cap={0.85} blend="glow" bias={2.2} level={0.45} position={[0, 0, 3]} />
      </Group>
      <Group id="void" position={local('fx', 2)}>
        <Lathe id="lip" material="steel" profile={[[0, 0], [5.5, 0], [5.5, 2], [0, 2]]} />
        <Lathe
          id="hole"
          material="steel"
          outline="lo"
          tone="gradient"
          gradient={{ from: polar(225, 4.5, 2.02), to: polar(45, 4.5, 2.02), stops: ['void0', 'void1', 'void2'], mid: 0.55 }}
          profile={[[4.5, 2.02], [0, 2.02]]}
          contacts={false}
        />
      </Group>
      <Group id="strobe" moves position={local('fx', 3)}>
        <Lathe
          id="disc"
          material="steel"
          outline="hi"
          crease="lo"
          profile={STROBE}
          marks={[3, 6]}
          lineSets={[{ segment: 4, lines: { count: 10, phase: 0, first: 0, last: 9, majorEvery: 0, minor: 'lo', major: 'lo', width: 0, majorWidth: 0, fade: [0, 0], kind: 'sectors', duty: 0.5, fill: 'strobe' } }]}
        />
      </Group>
    </Group>
  );
}

// ---- row: belt (M5: E1–E3) ---------------------------------------------------------------------

const BAND = { axis: 'x', dir: 1, L: 12, R: 2.4, thickness: 0.5, across: 5, zc: 2.4 } as const;
const BAND_TOTAL = 2 * BAND.L + 2 * Math.PI * BAND.R;
const LOOP = stadium({ L: BAND.L, R: BAND.R, zc: BAND.zc, dir: 1 });
const CLEATS = 6;
const SLATS = { count: Math.round(BAND_TOTAL / 1.2), phase: 0, first: 0, last: Math.round(BAND_TOTAL / 1.2) - 1, majorEvery: 0, minor: 'lo', major: 'lo', width: 0.5, majorWidth: 0.5, fade: [0.02, 0.12] } as const;

function BeltRow() {
  const band = useNode<PartHandle>('belt.band.belt');
  const cleats = useNode<PoolHandle>('belt.loop.cleats');
  const blended = useNode<PoolHandle>('belt.blend.packet');
  const squashed = useNode<PoolHandle>('belt.squash.packet');
  const ball = useNode<PoolHandle>('belt.squash.ball');
  const coil = useNode<PoolHandle>('belt.squash.coil');
  const [q] = useState(pathPoint);
  useFrame(({ t }) => {
    // E1: the slats run at 4 units/s.
    const u = (t * 4) / BAND_TOTAL;
    band().uShift = u - Math.floor(u);
    // E3: cleats ride the stadium, pitched to its normal round the drums.
    const pool = cleats();
    pool.count = CLEATS;
    for (let k = 0; k < CLEATS; k++) {
      LOOP.at((k * LOOP.total) / CLEATS + t * 4, LOOP.R, q);
      pool.pose(k, q.s - LOOP.L / 2, 0, q.z, 0, tilt('x', q.ns, q.nz), 0);
    }
    // E2: control → garbage and back.
    const mix = 0.5 - 0.5 * Math.cos(t * 1.2);
    const b = blended();
    b.count = 1;
    b.pose(0, 0, 0, 0.6, 0);
    b.style(0, 0);
    b.blend(0, 1, mix);
    // E3: squash by axis scale on a rounded box, a sphere and a coil (turned, so the scale is
    // not along the world axes): normals are R·S⁻¹·n, so bevels and curves keep their tones.
    const sq = squashed();
    sq.count = 1;
    sq.pose(0, -1.4, 1.6, 0.6, 0.5);
    sq.scale(0, 1 + 0.3 * mix, 1 + 0.3 * mix, 1 - 0.6 * mix);
    const bl = ball();
    bl.count = 1;
    bl.pose(0, 2.0, -1.8, 0.6 + 1.6 * (1 - 0.55 * mix), 0.5);
    bl.scale(0, 1 + 0.25 * mix, 1 - 0.3 * mix, 1 - 0.55 * mix);
    const co = coil();
    co.count = 1;
    co.pose(0, -2.6, -2.4, 1.6, 0.8, Math.PI / 2, 0);
    co.scale(0, 1, 1, 1 - 0.5 * mix);
  });
  const packetGeo: GeoSpec = { kind: 'box', size: [5, 4, 3.5], r: 0.4, center: [0, 0, 1.75], seams: [1.9] };
  const packetStyles = [{ material: 'pkControl', outline: 'hi' }, { material: 'pkGarbage', outline: 'hi' }] as const;
  return (
    <Group id="belt" position={cell('belt', 2)}>
      <Group id="band" position={local('belt', 0)}>
        <Band id="belt" live material="steel" {...BAND} position={[-BAND.L / 2, 0, 0]} lines={{ outer: SLATS }} />
        {[0, BAND.L].map((s, i) => (
          <Lathe key={i} id={`drum${i}`} material="steel" outline="lo" profile={[[0, -2.6], [BAND.R - BAND.thickness, -2.6], [BAND.R - BAND.thickness, 2.6], [0, 2.6]]} steps={24} rotation={[-90, 0, 0]} position={[s - BAND.L / 2, 0, BAND.zc]} />
        ))}
      </Group>
      <Group id="loop" position={local('belt', 1)}>
        <Band id="belt" material="steel" {...BAND} position={[-BAND.L / 2, 0, 0]} />
        {[0, BAND.L].map((s, i) => (
          <Lathe key={i} id={`drum${i}`} material="graphite" profile={[[0, -2.6], [BAND.R - BAND.thickness, -2.6], [BAND.R - BAND.thickness, 2.6], [0, 2.6]]} steps={24} rotation={[-90, 0, 0]} position={[s - BAND.L / 2, 0, BAND.zc]} />
        ))}
        <Instances id="cleats" geo={{ kind: 'box', size: [0.8, 4.4, 0.7], r: 0.15, center: [0, 0, 0.35] }} styles={[{ material: 'steel', outline: 'lo' }]} capacity={CLEATS} />
      </Group>
      <Group id="blend" position={local('belt', 2)}>
        <Box id="plate" material="steel" size={[8, 8, 0.6]} center={[0, 0, 0.3]} />
        <Instances id="packet" geo={packetGeo} styles={[...packetStyles]} capacity={1} marks={{ material: 'pkControl', segments: [{ a: [-2.5, 0, 3.5], b: [2.5, 0, 3.5], tone: 'lo', normal: [0, 0, 1] }] }} />
      </Group>
      <Group id="squash" position={local('belt', 3)}>
        <Box id="plate" material="steel" size={[8, 8, 0.6]} center={[0, 0, 0.3]} />
        <Instances id="packet" geo={{ ...packetGeo, r: 1.4 }} styles={[...packetStyles]} capacity={1} scalable />
        <Instances id="ball" geo={{ kind: 'lathe', profile: sphereProfile(1.6), subdivisions: 1 }} styles={[{ material: 'react', outline: 'hi' }]} capacity={1} scalable />
        <Instances id="coil" geo={{ kind: 'tube', path: helix({ from: [0, 0, 0], to: [0, 0, 5], r: 1, turns: 5 }), radius: 0.25, sides: 8, bend: 0 }} styles={[{ material: 'steel', outline: 'lo' }]} capacity={1} scalable />
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
      <Effects />
      <BeltRow />
    </>
  );
}
