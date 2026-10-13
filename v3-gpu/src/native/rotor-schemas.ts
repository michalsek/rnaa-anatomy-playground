// GPU records of the native rotor: one RotorPart per drawn prism (vane or packet), one RotorStyle per paint set, the
// projection uniform. The CPU packer addresses fields through the word offsets derived here (as src/core/schemas.ts).
import * as d from 'typegpu/data';

/**
 * A prism: the template ring `ring[ringFirst … ringFirst + ringCount)` (part-local x, y) turned by `rotation` (cos, sin)
 * about `centre` (world x, y), extruded from `z0` by `height`. Facing / seam / shade bits come from the CPU (kit-mirror),
 * so the GPU never re-decides a classification. Output slots: `segFirst` (6 · ringCount + 1 Seg records) and
 * `vertexFirst` (3 · (3 · ringCount − 2) fill vertices).
 */
export const RotorPart = d.struct({
  centre: d.vec2f,
  rotation: d.vec2f,
  z0: d.f32,
  height: d.f32,
  /** z of the tape band (seam), when PART_FLAG.band. */
  bandZ: d.f32,
  /** Inset of the top bevel line (world units); 0 = no bevel. */
  bevel: d.f32,
  /** Half-length of the strap over the top, along the part's x axis; 0 = no strap. */
  strap: d.f32,
  ringFirst: d.u32,
  ringCount: d.u32,
  flags: d.u32,
  facing: d.u32,
  seamFacing: d.u32,
  shades: d.u32,
  style: d.u32,
  /** Slot pseudo-item (depth base, explode offset). */
  item: d.u32,
  /** First depth layer of the part inside its slot (PART_LAYER offsets are added). */
  layer: d.u32,
  segFirst: d.u32,
  vertexFirst: d.u32,
}).$name('RotorPart');

/** Paint ids (shared palette) and stroke widths of one kind of prism. */
export const RotorStyle = d.struct({
  shade: d.vec4u,
  top: d.u32,
  crease: d.u32,
  bevel: d.u32,
  edge: d.u32,
  line: d.u32,
  creaseWidth: d.f32,
  bevelWidth: d.f32,
  edgeWidth: d.f32,
  lineWidth: d.f32,
}).$name('RotorStyle');

/** kit iso() as an affine map: viewBox = origin + x · xAxis + y · yAxis + (0, z · zAxis). */
export const RotorProjection = d.struct({
  origin: d.vec2f,
  xAxis: d.vec2f,
  yAxis: d.vec2f,
  zAxis: d.f32,
}).$name('RotorProjection');

export const PART_FLAG = {
  /** kit signedArea(ring) > 0 (outward normal orientation, for the bevel inset). */
  counter: 1,
  /** The tape band is drawn. */
  band: 2,
} as const;

/** Depth layers of a part, in v2's document order (solidSvg, then the packet's line path). */
export const PART_LAYER = {
  /** shade s → shade + s */
  shade: 1,
  top: 5,
  crease: 6,
  bevel: 7,
  edge: 8,
  line: 9,
  count: 10,
} as const;

/** Seg slots of a part with an n-point ring: crease, bevel, back top, front bottom, verticals, band (n each), strap. */
export const segSlotsOf = (ringCount: number) => 6 * ringCount + 1;
/** Fill vertices of a part: top fan (n − 2 triangles) and two triangles per side face. */
export const vertexSlotsOf = (ringCount: number) => 3 * (3 * ringCount - 2);

const wordOf = <T extends d.BaseData>(schema: T, accessor: (proxy: d.Infer<T>) => unknown) => {
  const { offset } = d.memoryLayoutOf(schema, accessor);
  if (offset % 4) throw new Error(`rotor schemas: field at byte ${offset} is not word-aligned`);
  return offset / 4;
};

export const PART_RECORD = {
  bytes: d.sizeOf(RotorPart),
  words: d.sizeOf(RotorPart) / 4,
  centre: wordOf(RotorPart, (p) => p.centre),
  rotation: wordOf(RotorPart, (p) => p.rotation),
  z0: wordOf(RotorPart, (p) => p.z0),
  height: wordOf(RotorPart, (p) => p.height),
  bandZ: wordOf(RotorPart, (p) => p.bandZ),
  bevel: wordOf(RotorPart, (p) => p.bevel),
  strap: wordOf(RotorPart, (p) => p.strap),
  ringFirst: wordOf(RotorPart, (p) => p.ringFirst),
  ringCount: wordOf(RotorPart, (p) => p.ringCount),
  flags: wordOf(RotorPart, (p) => p.flags),
  facing: wordOf(RotorPart, (p) => p.facing),
  seamFacing: wordOf(RotorPart, (p) => p.seamFacing),
  shades: wordOf(RotorPart, (p) => p.shades),
  style: wordOf(RotorPart, (p) => p.style),
  item: wordOf(RotorPart, (p) => p.item),
  layer: wordOf(RotorPart, (p) => p.layer),
  segFirst: wordOf(RotorPart, (p) => p.segFirst),
  vertexFirst: wordOf(RotorPart, (p) => p.vertexFirst),
};

export const STYLE_RECORD = {
  bytes: d.sizeOf(RotorStyle),
  words: d.sizeOf(RotorStyle) / 4,
  shade: wordOf(RotorStyle, (s) => s.shade),
  top: wordOf(RotorStyle, (s) => s.top),
  crease: wordOf(RotorStyle, (s) => s.crease),
  bevel: wordOf(RotorStyle, (s) => s.bevel),
  edge: wordOf(RotorStyle, (s) => s.edge),
  line: wordOf(RotorStyle, (s) => s.line),
  creaseWidth: wordOf(RotorStyle, (s) => s.creaseWidth),
  bevelWidth: wordOf(RotorStyle, (s) => s.bevelWidth),
  edgeWidth: wordOf(RotorStyle, (s) => s.edgeWidth),
  lineWidth: wordOf(RotorStyle, (s) => s.lineWidth),
};
