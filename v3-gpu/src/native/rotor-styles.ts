// Paints of the native rotor: the very palette entries the markup path resolves for the same elements. Template markup
// with v2's exact element and attribute structure (kit solidSvg as vane() / packet() call it; only the path data is a
// dummy) goes through the live path's own SlotGeometryBuilder with the slot probe chain, so roles, probe recipes and
// palette keys cannot drift from what the adapter would build from v2's strings. tools/test-native.mjs compares the
// templates with recorded v2 rotor markup.
import type { ChainNode, PaintTable } from '../core/paint.ts';
import { SEG, SEG_RECORD } from '../core/schemas.ts';
import { CollectedSlot, SlotGeometryBuilder } from '../live/geometry.ts';
import { STYLE_RECORD } from './rotor-schemas.ts';

const FILL = 'M0 0L1 0L1 1Z';
const LINE = 'M0 0L1 0';
const shades = [0, 1, 2, 3].map((shade) => `<path class="iso-shade" data-shade="${shade}" d="${FILL}"/>`).join('');
const solid = (lines: string) => `<g class="iso-solid"><path class="iso-fill" d="${FILL}"/>${shades}<path class="iso-top" d="${FILL}"/>${lines}</g>`;
const line = (classes: string, tone: string) => `<path class="${classes}" data-tone="${tone}" d="${LINE}"/>`;

/** v2 vane(): solidSvg(extrude(…), { tone: "mid" }). */
export const VANE_TEMPLATE = solid(line('iso-line iso-crease', 'faint') + line('iso-line iso-edge', 'mid'));
/** v2 packet(kind, …) at full opacity: the bevelled solid (tone hi) and the band + strap line (tone lo). */
export const packetTemplate = (kind: string) =>
  `<g class="pk" data-kind="${kind}">${solid(line('iso-line iso-crease', 'faint') + line('iso-line iso-bevel', 'faint') + line('iso-line iso-edge', 'hi'))}${line('iso-line', 'lo')}</g>`;

/** Primitive order of a template: hull, 4 shades, top, then its lines. */
const HULL = 0, FIRST_SHADE = 1, TOP = 5, FIRST_LINE = 6;

export class RotorStyles {
  /** Packed RotorStyle records (style 0 = vane, then packet kinds in order of first sight). */
  records = new Uint32Array(8 * STYLE_RECORD.words);
  count = 0;
  /** Bumped when a style is added. */
  version = 0;
  /** Widest stroke half-width (CSS px). */
  maxHalfWidth = 0;
  /** Every fill paint the styles use (the hull's included: it must classify like the rest). */
  readonly fillPaints: number[] = [];
  readonly strokePaints: number[] = [];
  /** The hull fill (`.iso-fill`) of every style: the markup path draws it under the faces, the native path does not. */
  readonly hullPaints: number[] = [];
  private readonly byKind = new Map<string, number>();
  private readonly builder: SlotGeometryBuilder;
  private readonly collected = new CollectedSlot();

  constructor(paints: PaintTable, slotChain: ChainNode[]) {
    this.builder = new SlotGeometryBuilder(paints, slotChain);
    this.add(VANE_TEMPLATE, false);
  }

  /** Style index of a packet kind; the first sight registers its paints (resolved by the next `resolvePending`). */
  styleOf(kind: string): number {
    const known = this.byKind.get(kind);
    if (known !== undefined) return known;
    const style = this.add(packetTemplate(kind), true);
    this.byKind.set(kind, style);
    return style;
  }

  private add(markup: string, packet: boolean): number {
    const collected = this.collected;
    this.builder.collect(markup, collected);
    const expected = packet ? FIRST_LINE + 4 : FIRST_LINE + 2;
    if (collected.count !== expected) throw new Error(`native rotor: template collected ${collected.count} primitives, expected ${expected}`);
    const prim = (i: number) => collected.prims[i].prim;
    const lineOf = (i: number) => {
      const p = prim(i);
      if (p.kind !== 'segs') throw new Error(`native rotor: template primitive ${i} is not a stroke`);
      const words = p.words;
      if (!(words[SEG_RECORD.flags] & SEG.roundStart)) throw new Error('native rotor: rotor lines must have round caps');
      const width = new Float32Array(words.buffer, words.byteOffset, words.length)[SEG_RECORD.width];
      this.maxHalfWidth = Math.max(this.maxHalfWidth, width / 2);
      this.strokePaints.push(p.paint);
      return { paint: p.paint, width };
    };
    this.hullPaints.push(prim(HULL).paint);
    for (let i = HULL; i <= TOP; i++) {
      if (prim(i).kind !== 'fill') throw new Error(`native rotor: template primitive ${i} is not a fill`);
      this.fillPaints.push(prim(i).paint);
    }
    const crease = lineOf(FIRST_LINE);
    const bevel = packet ? lineOf(FIRST_LINE + 1) : crease;
    const edge = lineOf(packet ? FIRST_LINE + 2 : FIRST_LINE + 1);
    const tape = packet ? lineOf(FIRST_LINE + 3) : edge;
    const style = this.count++;
    if ((style + 1) * STYLE_RECORD.words > this.records.length) {
      const grown = new Uint32Array(this.records.length * 2);
      grown.set(this.records);
      this.records = grown;
    }
    const u32 = this.records;
    const f32 = new Float32Array(u32.buffer);
    const o = style * STYLE_RECORD.words;
    for (let s = 0; s < 4; s++) u32[o + STYLE_RECORD.shade + s] = prim(FIRST_SHADE + s).paint;
    u32[o + STYLE_RECORD.top] = prim(TOP).paint;
    u32[o + STYLE_RECORD.crease] = crease.paint;
    u32[o + STYLE_RECORD.bevel] = bevel.paint;
    u32[o + STYLE_RECORD.edge] = edge.paint;
    u32[o + STYLE_RECORD.line] = tape.paint;
    f32[o + STYLE_RECORD.creaseWidth] = crease.width;
    f32[o + STYLE_RECORD.bevelWidth] = bevel.width;
    f32[o + STYLE_RECORD.edgeWidth] = edge.width;
    f32[o + STYLE_RECORD.lineWidth] = tape.width;
    this.version++;
    return style;
  }
}
