// Display-list binary format (documented byte-exactly in notes/DL-FORMAT.md). Isomorphic and dependency-free (the
// gate page inlines it). Every record is little-endian 4-byte words; record strides are multiples of 8 so each
// section can be bound directly as a WGSL array<struct> storage buffer or used as a vertex buffer.

export const MAGIC = 0x4c444e52; // "RNDL" read as a little-endian u32
export const VERSION = 1;
export const SECTION_ALIGN = 16;

// field types: f = f32, u = u32. Order is the byte order inside the record.
export const LAYOUTS = {
  prims: { stride: 32, fields: [["kind", "u"], ["item", "u"], ["layer", "u"], ["paint", "u"], ["alpha", "f"], ["first", "u"], ["count", "u"], ["flags", "u"]] },
  fillVertices: { stride: 24, fields: [["x", "f"], ["y", "f"], ["item", "u"], ["paint", "u"], ["layer", "u"], ["alpha", "f"]] },
  fillIndices: { stride: 4, fields: [["index", "u"]] },
  segments: { stride: 48, fields: [["x0", "f"], ["y0", "f"], ["x1", "f"], ["y1", "f"], ["item", "u"], ["paint", "u"], ["layer", "u"], ["alpha", "f"], ["width", "f"], ["flags", "u"], ["prim", "u"], ["pad", "u"]] },
  dots: { stride: 32, fields: [["cx", "f"], ["cy", "f"], ["r", "f"], ["item", "u"], ["paint", "u"], ["layer", "u"], ["alpha", "f"], ["prim", "u"]] },
};
export const SECTIONS = Object.keys(LAYOUTS);

export const PRIM_KIND = { fill: 0, stroke: 1, dot: 2 };
export const PRIM_FLAG = { halo: 1, blend: 2, gradient: 4, seamless: 8, groupOpacity: 16 };
export const SEG_FLAG = { start: 1, end: 2, closed: 4, capRound: 8, joinRound: 16, widthOverride: 32 };
export const PAINT_GRADIENT = 0x80000000; // paint id with this bit set: gradient index in the low bits

const HEADER_WORDS = 4 + SECTIONS.length * 4; // magic, version, sectionCount, headerBytes, then per section: offset, byteLength, count, stride
const align = (n) => Math.ceil(n / SECTION_ALIGN) * SECTION_ALIGN;

// pack({ prims: [record…], fillVertices: […], … }) → { buffer: ArrayBuffer, table: [{ name, offset, byteLength, count, stride }] }
export function pack(sections) {
  const table = [];
  let offset = align(HEADER_WORDS * 4);
  for (const name of SECTIONS) {
    const { stride } = LAYOUTS[name];
    const count = sections[name].length;
    table.push({ name, offset, byteLength: count * stride, count, stride });
    offset = align(offset + count * stride);
  }
  const buffer = new ArrayBuffer(offset);
  const view = new DataView(buffer);
  [MAGIC, VERSION, SECTIONS.length, HEADER_WORDS * 4].forEach((word, i) => view.setUint32(i * 4, word, true));
  table.forEach((entry, s) => {
    [entry.offset, entry.byteLength, entry.count, entry.stride].forEach((word, i) => view.setUint32((4 + s * 4 + i) * 4, word, true));
    const { fields, stride } = LAYOUTS[entry.name];
    sections[entry.name].forEach((record, r) => {
      fields.forEach(([field, type], f) => {
        const at = entry.offset + r * stride + f * 4;
        const value = (typeof record === "number" ? record : record[field]) ?? 0; // single-field sections may hold bare numbers
        if (type === "f") view.setFloat32(at, value, true);
        else view.setUint32(at, value >>> 0, true);
      });
    });
  });
  return { buffer, table };
}

// sectionsOf(buffer) → { name: { offset, byteLength, count, stride, f32: Float32Array, u32: Uint32Array } } (views, no copy)
export function sectionsOf(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) throw new Error("dl: bad magic");
  if (view.getUint32(4, true) !== VERSION) throw new Error(`dl: version ${view.getUint32(4, true)}, expected ${VERSION}`);
  const out = {};
  const count = view.getUint32(8, true);
  for (let s = 0; s < count; s++) {
    const word = (i) => view.getUint32((4 + s * 4 + i) * 4, true);
    const entry = { name: SECTIONS[s], offset: word(0), byteLength: word(1), count: word(2), stride: word(3) };
    entry.f32 = new Float32Array(buffer, entry.offset, entry.byteLength / 4);
    entry.u32 = new Uint32Array(buffer, entry.offset, entry.byteLength / 4);
    out[entry.name] = entry;
  }
  return out;
}

// recordAt(section, i) → plain object (debug / tools; renderers read the typed arrays directly)
export function recordAt(section, i) {
  const { fields, stride } = LAYOUTS[section.name];
  const base = (i * stride) / 4;
  return Object.fromEntries(fields.map(([field, type], f) => [field, type === "f" ? section.f32[base + f] : section.u32[base + f]]));
}
