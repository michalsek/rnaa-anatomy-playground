// Static layer cache: the static scene is rendered once (resolved) and reused; each frame redraws only the region the
// live slots cover.
//
// Exactness. The redraw region R of a frame is the union of the slots' current extents (padded boxes). A cached frame
// clears its targets, marks R in the stencil, copies the cached resolved colour into every sample outside R, and
// redraws inside R (stencil test) the slots and every static primitive that may cover a sample of R, in the normal
// order with the normal depth. Outside R no slot draws, so the cached static frame is the frame (all samples equal →
// the resolve returns the cached colour unchanged); inside R every primitive covering a sample is drawn in painter
// order, as in an uncached frame. The static primitives that may reach R are selected once per partition, against the
// slot envelopes (every cell any extent of the slot has touched, see SlotEnvelopes): a primitive, segment or triangle
// is per-frame exactly when its conservative coverage (segment capsules, triangle / fill / halo boxes, padded for
// anti-aliasing) touches an envelope. The envelopes contain every current extent, since an extent outside its
// envelope grows it and re-partitions before that frame is drawn.
import type { PainterStep } from './draw-list.ts';
import type { SlotExtent } from './slots.ts';
import { FillWriter } from './fills.ts';
import { FILL_VERTEX_RECORD, SEG, SEG_RECORD } from './schemas.ts';
import { emptyBox, isEmptyBox, unionBox, type Box, type OpaqueFill, type StaticEntry } from './static-geometry.ts';

/** Box in device px (half-open: [x0, x1) × [y0, y1)). */
export interface DeviceRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Device px added around every box: anti-aliasing ramps, MSAA sample offsets and the stroke quads' padding. */
export const PARTITION_MARGIN_PX = 3;
/** Cell size (device px) of the occupancy grid the partition tests overlaps on. */
const GRID_CELL_PX = 4;
/**
 * Envelope cell size (viewBox units). An envelope is the set of these cells any of the slot's extents has touched, so
 * content travelling along a path (a parcel down a chute) claims a band, not the path's bounding box; the cell size
 * doubles as slack (content re-grows the envelope once per cell, not once per frame).
 */
const ENVELOPE_CELL = 8;
/** The envelope grid extends this fraction of the viewBox beyond each side (content outside it is clamped in). */
const ENVELOPE_MARGIN = 0.25;

/**
 * Every cell each slot's extents have touched, grown adaptively (growth invalidates the cache partition). The cells
 * cover the viewBox plus ENVELOPE_MARGIN on each side; an extent reaching beyond that grid cannot be covered by cells,
 * so its slot is "off-grid" until its extent is back inside, and frames are full redraws meanwhile.
 */
export class SlotEnvelopes {
  private readonly cells: (Uint8Array | null)[];
  private readonly halfWidths: number[];
  /** Growth events per slot (diagnostics). */
  readonly growths: number[];
  private added: { slot: number; box: Box }[] = [];
  private readonly x0: number;
  private readonly y0: number;
  private readonly columns: number;
  private readonly rows: number;
  /** Per slot: its current extent reaches beyond the grid. */
  private readonly offGrid: Uint8Array;
  private offGridCount = 0;
  /** Bumped on every growth. */
  version = 0;

  constructor(slotCount: number, viewBox: [number, number, number, number]) {
    const [vx, vy, vw, vh] = viewBox;
    this.x0 = vx - vw * ENVELOPE_MARGIN;
    this.y0 = vy - vh * ENVELOPE_MARGIN;
    this.columns = Math.ceil((vw * (1 + 2 * ENVELOPE_MARGIN)) / ENVELOPE_CELL);
    this.rows = Math.ceil((vh * (1 + 2 * ENVELOPE_MARGIN)) / ENVELOPE_CELL);
    this.cells = Array.from({ length: slotCount }, () => null);
    this.halfWidths = new Array<number>(slotCount).fill(0);
    this.growths = new Array<number>(slotCount).fill(0);
    this.offGrid = new Uint8Array(slotCount);
  }

  /** Some slot's current extent reaches beyond the envelope grid: no envelope covers it. */
  get anyOffGrid() {
    return this.offGridCount > 0;
  }

  /** Bounding box of the slot's envelope (null before its first content). */
  get(slot: number): SlotExtent | null {
    const box = emptyBox();
    for (const cell of this.rectsOf(slot)) unionBox(box, cell);
    return isEmptyBox(box) ? null : { box, halfWidth: this.halfWidths[slot] };
  }

  halfWidthOf(slot: number) {
    return this.halfWidths[slot];
  }

  /** Whether the slot's envelope covers `extent` (every cell the box touches is claimed, and the box is on the grid). */
  covers(slot: number, extent: SlotExtent): boolean {
    const cells = this.cells[slot];
    if (!cells || !this.onGrid(extent.box) || extent.halfWidth > this.halfWidths[slot]) return false;
    const b = extent.box;
    for (let r = this.rowOf(b.y0); r <= this.rowOf(b.y1); r++) for (let c = this.columnOf(b.x0); c <= this.columnOf(b.x1); c++) if (!cells[r * this.columns + c]) return false;
    return true;
  }

  /** Every slot's envelope as row runs of cells (a new partition reads them all). */
  allCells(): { slot: number; box: Box }[] {
    return this.cells.flatMap((_, slot) => this.rectsOf(slot).map((box) => ({ slot, box })));
  }

  /** The envelope as row runs of cells (viewBox units). */
  rectsOf(slot: number): Box[] {
    const cells = this.cells[slot];
    const rects: Box[] = [];
    if (!cells) return rects;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.columns; c++) {
        if (!cells[r * this.columns + c]) continue;
        const start = c;
        while (c + 1 < this.columns && cells[r * this.columns + c + 1]) c++;
        rects.push({ x0: this.x0 + start * ENVELOPE_CELL, y0: this.y0 + r * ENVELOPE_CELL, x1: this.x0 + (c + 1) * ENVELOPE_CELL, y1: this.y0 + (r + 1) * ENVELOPE_CELL });
      }
    }
    return rects;
  }

  /**
   * Makes the slot's envelope contain `extent` (as far as the grid reaches; the part beyond it marks the slot
   * off-grid); returns whether it had to grow.
   */
  include(slot: number, extent: SlotExtent | null): boolean {
    const empty = !extent || isEmptyBox(extent.box);
    this.setOffGrid(slot, !empty && !this.onGrid(extent.box));
    if (empty) return false;
    let cells = this.cells[slot];
    if (!cells) cells = this.cells[slot] = new Uint8Array(this.columns * this.rows);
    const b = extent.box;
    let grew = extent.halfWidth > this.halfWidths[slot];
    if (grew) {
      this.halfWidths[slot] = extent.halfWidth;
      // a wider stroke pads every cell of the slot more: all of them count as added
      for (const box of this.rectsOf(slot)) this.added.push({ slot, box });
    }
    // an extent that leaves the envelope claims its cells and their neighbours: moving content then crosses into
    // claimed cells for a while instead of re-growing the envelope every few frames
    if (!this.claims(cells, b)) {
      grew = true;
      for (let r = this.rowOf(b.y0 - ENVELOPE_CELL); r <= this.rowOf(b.y1 + ENVELOPE_CELL); r++)
        for (let c = this.columnOf(b.x0 - ENVELOPE_CELL); c <= this.columnOf(b.x1 + ENVELOPE_CELL); c++) {
          if (cells[r * this.columns + c]) continue;
          cells[r * this.columns + c] = 1;
          this.added.push({ slot, box: this.cellBox(c, r) });
        }
    }
    if (grew) {
      this.version++;
      this.growths[slot]++;
    }
    return grew;
  }

  /** Whether every grid cell the box touches (clamped to the grid) is claimed. */
  private claims(cells: Uint8Array, b: Box) {
    for (let r = this.rowOf(b.y0); r <= this.rowOf(b.y1); r++) for (let c = this.columnOf(b.x0); c <= this.columnOf(b.x1); c++) if (!cells[r * this.columns + c]) return false;
    return true;
  }

  private onGrid(b: Box) {
    return b.x0 >= this.x0 && b.y0 >= this.y0 && b.x1 <= this.x0 + this.columns * ENVELOPE_CELL && b.y1 <= this.y0 + this.rows * ENVELOPE_CELL;
  }

  private setOffGrid(slot: number, off: boolean) {
    if (this.offGrid[slot] === Number(off)) return;
    this.offGrid[slot] = Number(off);
    this.offGridCount += off ? 1 : -1;
  }

  /** Grid column / row of a coordinate, clamped to the grid. */
  private columnOf(x: number) {
    return Math.min(this.columns - 1, Math.max(0, Math.floor((x - this.x0) / ENVELOPE_CELL)));
  }

  private rowOf(y: number) {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.y0) / ENVELOPE_CELL)));
  }

  /** Cells added to the envelopes since the last call (viewBox units, with their slot). */
  takeAdded(): { slot: number; box: Box }[] {
    const added = this.added;
    this.added = [];
    return added;
  }

  /** Forgets the added-cell log (a full partition reads every envelope). */
  clearAdded() {
    this.added = [];
  }

  private cellBox(c: number, r: number): Box {
    return { x0: this.x0 + c * ENVELOPE_CELL, y0: this.y0 + r * ENVELOPE_CELL, x1: this.x0 + (c + 1) * ENVELOPE_CELL, y1: this.y0 + (r + 1) * ENVELOPE_CELL };
  }
}

export interface PartitionView {
  scale: number;
  translate: [number, number];
  dpr: number;
  width: number;
  height: number;
  /** Explode offsets (viewBox units), x and y per item: static items, then one pseudo-item per slot (its anchor's). */
  offsets: Float32Array;
  /** Item index of slot 0's pseudo-item. */
  slotItemBase: number;
  haloBox(halo: number): DeviceRect;
}

/**
 * Which device-px cells the region covers. Marked first, then sealed into a summed-area table, so every box test is
 * O(1); coverage tests run per segment capsule and per triangle box, conservatively.
 */
export class OccupancyGrid {
  private readonly cells: Uint8Array;
  private sums: Uint32Array | null = null;
  private readonly columns: number;
  private readonly rows: number;

  constructor(width: number, height: number) {
    this.columns = Math.max(1, Math.ceil(width / GRID_CELL_PX));
    this.rows = Math.max(1, Math.ceil(height / GRID_CELL_PX));
    this.cells = new Uint8Array(this.columns * this.rows);
  }

  mark(x0: number, y0: number, x1: number, y1: number) {
    if (this.sums) throw new Error('occupancy grid: marked after sealing');
    const c0 = Math.max(0, Math.floor(x0 / GRID_CELL_PX)), c1 = Math.min(this.columns - 1, Math.floor(x1 / GRID_CELL_PX));
    const r0 = Math.max(0, Math.floor(y0 / GRID_CELL_PX)), r1 = Math.min(this.rows - 1, Math.floor(y1 / GRID_CELL_PX));
    for (let r = r0; r <= r1; r++) this.cells.fill(1, r * this.columns + c0, r * this.columns + c1 + 1);
  }

  /** Whether any marked cell lies in the box (seals the grid on first use). */
  test(x0: number, y0: number, x1: number, y1: number): boolean {
    const sums = this.sums ?? this.seal();
    const c0 = Math.max(0, Math.floor(x0 / GRID_CELL_PX)), c1 = Math.min(this.columns - 1, Math.floor(x1 / GRID_CELL_PX));
    const r0 = Math.max(0, Math.floor(y0 / GRID_CELL_PX)), r1 = Math.min(this.rows - 1, Math.floor(y1 / GRID_CELL_PX));
    if (c1 < c0 || r1 < r0) return false;
    const w = this.columns + 1;
    return sums[(r1 + 1) * w + c1 + 1] - sums[r0 * w + c1 + 1] - sums[(r1 + 1) * w + c0] + sums[r0 * w + c0] > 0;
  }

  private seal(): Uint32Array {
    const w = this.columns + 1;
    const sums = new Uint32Array(w * (this.rows + 1));
    for (let r = 0; r < this.rows; r++) {
      let row = 0;
      for (let c = 0; c < this.columns; c++) {
        row += this.cells[r * this.columns + c];
        sums[(r + 1) * w + c + 1] = sums[r * w + c + 1] + row;
      }
    }
    this.sums = sums;
    return sums;
  }
}

/** Explode offset of an item / slot pseudo-item. */
export const offsetOf = (view: PartitionView, item: number): [number, number] => [view.offsets[item * 2], view.offsets[item * 2 + 1]];

/** Device box of a slot extent (or envelope) placed at its explode offset, padded for strokes and anti-aliasing. */
export const slotRectOf = (extent: SlotExtent, offset: [number, number], view: PartitionView) => deviceRectOf(extent.box, offset, extent.halfWidth, view);

function deviceRectOf(box: Box, offset: [number, number], halfWidthCss: number, view: PartitionView): DeviceRect {
  const pad = halfWidthCss * view.dpr + PARTITION_MARGIN_PX;
  return {
    x0: (box.x0 + offset[0]) * view.scale + view.translate[0] - pad,
    y0: (box.y0 + offset[1]) * view.scale + view.translate[1] - pad,
    x1: (box.x1 + offset[0]) * view.scale + view.translate[0] + pad,
    y1: (box.y1 + offset[1]) * view.scale + view.translate[1] + pad,
  };
}

/** Device boxes to test coverage against: a plain list when there are few, an occupancy grid otherwise. */
class RectRegion {
  private readonly grid: OccupancyGrid | null;

  constructor(private readonly rects: DeviceRect[], width: number, height: number) {
    if (rects.length <= RECT_LIST_LIMIT) {
      this.grid = null;
      return;
    }
    this.grid = new OccupancyGrid(width, height);
    for (const r of rects) this.grid.mark(r.x0, r.y0, r.x1, r.y1);
  }

  test(x0: number, y0: number, x1: number, y1: number): boolean {
    if (this.grid) return this.grid.test(x0, y0, x1, y1);
    for (const r of this.rects) if (x0 < r.x1 && r.x0 < x1 && y0 < r.y1 && r.y0 < y1) return true;
    return false;
  }

  /**
   * Whether the region lies within `pad` of segment a–b: boxes around points at most one grid cell apart along it (a
   * diagonal hairline's bounding box would claim a whole square).
   */
  testSegment(ax: number, ay: number, bx: number, by: number, pad: number): boolean {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / GRID_CELL_PX));
    const reach = pad + GRID_CELL_PX / 2;
    for (let i = 0; i <= steps; i++) {
      const x = ax + ((bx - ax) * i) / steps;
      const y = ay + ((by - ay) * i) / steps;
      if (this.test(x - reach, y - reach, x + reach, y + reach)) return true;
    }
    return false;
  }
}

/** Region rects up to this many are tested one by one; more go into an occupancy grid. */
const RECT_LIST_LIMIT = 16;

/**
 * The per-frame lists of the static cache (see the file comment): which painter steps, segments and opaque triangles a
 * cached frame redraws. Envelopes only grow, so a partition only grows too: `include` takes the cells added since the
 * last call and selects what newly reaches them, without revisiting the rest. A layout change (order, depth, size,
 * explode share, paint classes) starts a new partition.
 */
export class CachePartition {
  /** Per painter step: 1 = drawn in a cached frame (slots, and the static entries reaching the envelopes). */
  readonly perFrame: Uint8Array;
  /** Per static segment: 1 = its capsule reaches an envelope. */
  readonly segmentMask: Uint8Array;
  /** The opaque triangles reaching an envelope (append-only; their order does not matter, they write depth). */
  readonly regionOpaque = new FillWriter();
  /** Device boxes of the envelope cells and of the per-frame static entries (debug overlay). */
  readonly regionRects: DeviceRect[] = [];
  readonly entryRects: DeviceRect[] = [];
  perFrameEntries = 0;
  private readonly triangleMask: Uint8Array;
  private readonly stepRects: (DeviceRect | null)[];
  private readonly fillRects: DeviceRect[];

  constructor(
    private readonly steps: PainterStep[],
    private readonly entries: StaticEntry[][],
    private readonly segs: { f32: Float32Array; u32: Uint32Array; count: number },
    private readonly opaque: FillWriter,
    private readonly opaqueFills: OpaqueFill[],
    private readonly view: PartitionView,
  ) {
    this.perFrame = new Uint8Array(steps.length);
    this.segmentMask = new Uint8Array(segs.count);
    this.triangleMask = new Uint8Array(Math.ceil(opaque.count / 3));
    steps.forEach((step, s) => {
      if (step.item < 0) this.perFrame[s] = 1;
    });
    this.stepRects = steps.map((step) => {
      if (step.item < 0) return null;
      const entry = entries[step.item][step.index];
      return entry.kind === 'halo' ? { ...view.haloBox(entry.halo) } : deviceRectOf(entry.bounds, offsetOf(view, step.item), entry.halfWidth, view);
    });
    this.fillRects = opaqueFills.map((fill) => deviceRectOf(fill.bounds, offsetOf(view, fill.item), 0, view));
  }

  get cachedEntries() {
    return this.stepRects.filter(Boolean).length - this.perFrameEntries;
  }

  /** Adds envelope cells (viewBox boxes of `slot`); returns whether anything new became per-frame. */
  include(cells: { slot: number; box: Box }[], envelopes: SlotEnvelopes): boolean {
    const view = this.view;
    const rects: DeviceRect[] = [];
    for (const { slot, box } of cells) {
      const rect = clippedRectOf(slotRectOf({ box, halfWidth: envelopes.halfWidthOf(slot) }, offsetOf(view, view.slotItemBase + slot), view), view);
      if (rect) rects.push(rect);
    }
    if (!rects.length) return false;
    this.regionRects.push(...rects);
    const region = new RectRegion(rects, view.width, view.height);
    let changed = false;
    this.steps.forEach((step, s) => {
      const rect = this.stepRects[s];
      if (!rect || !region.test(rect.x0, rect.y0, rect.x1, rect.y1)) return;
      const entry = this.entries[step.item][step.index];
      if (entry.kind === 'segs' && !this.selectSegments(entry, offsetOf(view, step.item), region)) return;
      if (entry.kind !== 'segs' && this.perFrame[s]) return;
      changed = true;
      if (this.perFrame[s]) return;
      this.perFrame[s] = 1;
      this.perFrameEntries++;
      this.entryRects.push(rect);
    });
    this.opaqueFills.forEach((fill, f) => {
      const rect = this.fillRects[f];
      if (!region.test(rect.x0, rect.y0, rect.x1, rect.y1)) return;
      if (this.selectTriangles(fill, region)) changed = true;
    });
    return changed;
  }

  /** Marks the unmarked segments of a stroke entry whose capsule reaches the region; true when it marked any. */
  private selectSegments(entry: StaticEntry & { kind: 'segs' }, offset: [number, number], region: RectRegion) {
    const { view, segs } = this;
    const W = SEG_RECORD.words;
    const strokePad = entry.halfWidth * view.dpr + PARTITION_MARGIN_PX;
    let selected = false;
    for (let i = entry.first; i < entry.first + entry.count; i++) {
      if (this.segmentMask[i]) continue;
      const o = i * W;
      const dot = (segs.u32[o + SEG_RECORD.flags] & SEG.dot) !== 0;
      const pad = dot ? segs.f32[o + SEG_RECORD.width] * view.scale + PARTITION_MARGIN_PX : strokePad;
      const ax = (segs.f32[o + SEG_RECORD.p0] + offset[0]) * view.scale + view.translate[0];
      const ay = (segs.f32[o + SEG_RECORD.p0 + 1] + offset[1]) * view.scale + view.translate[1];
      const bx = (segs.f32[o + SEG_RECORD.p1] + offset[0]) * view.scale + view.translate[0];
      const by = (segs.f32[o + SEG_RECORD.p1 + 1] + offset[1]) * view.scale + view.translate[1];
      if (region.testSegment(ax, ay, bx, by, pad)) {
        this.segmentMask[i] = 1;
        selected = true;
      }
    }
    return selected;
  }

  /** Appends the unmarked triangles of an opaque fill whose box reaches the region; true when it appended any. */
  private selectTriangles(fill: OpaqueFill, region: RectRegion) {
    const { view } = this;
    const { f32 } = this.opaque;
    const W = FILL_VERTEX_RECORD.words;
    const ox = view.offsets[fill.item * 2], oy = view.offsets[fill.item * 2 + 1];
    let selected = false;
    for (let v = fill.first; v + 2 < fill.first + fill.count; v += 3) {
      const t = v / 3;
      if (this.triangleMask[t]) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const o = (v + k) * W;
        const x = (f32[o + FILL_VERTEX_RECORD.pos] + ox) * view.scale + view.translate[0];
        const y = (f32[o + FILL_VERTEX_RECORD.pos + 1] + oy) * view.scale + view.translate[1];
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      if (!region.test(x0 - PARTITION_MARGIN_PX, y0 - PARTITION_MARGIN_PX, x1 + PARTITION_MARGIN_PX, y1 + PARTITION_MARGIN_PX)) continue;
      this.triangleMask[t] = 1;
      this.regionOpaque.copyFrom(this.opaque, v, 3);
      selected = true;
    }
    return selected;
  }
}

/** The rect clipped to the target, in whole device px; null when nothing is left. */
export function clippedRectOf(rect: DeviceRect, view: { width: number; height: number }): DeviceRect | null {
  const clipped = { x0: Math.max(0, Math.floor(rect.x0)), y0: Math.max(0, Math.floor(rect.y0)), x1: Math.min(view.width, Math.ceil(rect.x1)), y1: Math.min(view.height, Math.ceil(rect.y1)) };
  return clipped.x1 > clipped.x0 && clipped.y1 > clipped.y0 ? clipped : null;
}
