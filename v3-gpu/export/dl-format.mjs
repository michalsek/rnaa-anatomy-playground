// Display-list binary format (documented byte-exactly in notes/DL-FORMAT.md). Isomorphic and dependency-free (the
// gate page bundles it, the renderer may import it). Every record is little-endian 4-byte words. Struct sections have
// strides that are multiples of 8 (vec2f pairs stay 8-aligned); fillIndices is a plain u32 array (stride 4). Sections
// start at SECTION_ALIGN-byte offsets, WebGPU's default minStorageBufferOffsetAlignment, so one uploaded GPUBuffer can
// bind each section as a storage-buffer sub-range.

export const MAGIC = 0x4c444e52; // "RNDL" read as a little-endian u32
export const VERSION = 1;
export const SECTION_ALIGN = 256;

// field types: f = f32, u = u32. Order is the word order inside the record.
export const LAYOUTS = {
  prims: { stride: 32, fields: [["kind", "u"], ["item", "u"], ["layer", "u"], ["paint", "u"], ["alpha", "f"], ["first", "u"], ["count", "u"], ["flags", "u"]] },
  fillVertices: { stride: 24, fields: [["x", "f"], ["y", "f"], ["item", "u"], ["paint", "u"], ["layer", "u"], ["alpha", "f"]] },
  fillIndices: { stride: 4, fields: [["index", "u"]] },
  segments: { stride: 48, fields: [["x0", "f"], ["y0", "f"], ["x1", "f"], ["y1", "f"], ["item", "u"], ["paint", "u"], ["layer", "u"], ["alpha", "f"], ["width", "f"], ["flags", "u"], ["prim", "u"], ["pad", "u"]] },
  dots: { stride: 32, fields: [["cx", "f"], ["cy", "f"], ["r", "f"], ["item", "u"], ["paint", "u"], ["layer", "u"], ["alpha", "f"], ["prim", "u"]] },
};
export const SECTIONS = Object.keys(LAYOUTS);

// Word index of every field inside its record and the record size in words, for readers of the typed-array views:
// sections.segments.f32[s * STRIDE_WORDS.segments + FIELD_WORD.segments.width]
export const FIELD_WORD = Object.fromEntries(SECTIONS.map((name) => [name, Object.fromEntries(LAYOUTS[name].fields.map(([field], word) => [field, word]))]));
export const STRIDE_WORDS = Object.fromEntries(SECTIONS.map((name) => [name, LAYOUTS[name].stride / 4]));

export const PRIM_KIND = { fill: 0, stroke: 1, dot: 2 };
export const PRIM_FLAG = { halo: 1, blend: 2, gradient: 4, seamless: 8, groupOpacity: 16 };
export const SEG_FLAG = { start: 1, end: 2, closed: 4, capRound: 8, joinRound: 16, widthOverride: 32 };

// A paint id is a palette id, or a gradient index tagged with the top bit. `PAINT_GRADIENT | index` is a negative
// int32 in JS, so the tagged id is always built and read through these helpers.
export const PAINT_GRADIENT = 0x80000000;
const MAX_GRADIENT_INDEX = 0x7fffffff;
export function gradientPaint(index) {
  if (!Number.isInteger(index) || index < 0 || index > MAX_GRADIENT_INDEX) throw new Error(`dl: gradient index ${index} out of range`);
  return (PAINT_GRADIENT | index) >>> 0;
}
export const isGradientPaint = (paintId) => paintId >= PAINT_GRADIENT;
export const gradientIndexOf = (paintId) => paintId - PAINT_GRADIENT;

const HEADER_FIELDS = ["magic", "version", "sectionCount", "headerBytes"];
const SECTION_ENTRY_FIELDS = ["offset", "byteLength", "count", "stride"];
export const HEADER_BYTES = (HEADER_FIELDS.length + SECTIONS.length * SECTION_ENTRY_FIELDS.length) * 4;
const MAX_U32 = 0xffffffff;
const OPTIONAL_FIELDS = new Set(["pad"]); // written as 0 when absent

const alignUp = (n) => Math.ceil(n / SECTION_ALIGN) * SECTION_ALIGN;
const isLittleEndianHost = () => new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

function wordOf(section, index, record, field, type) {
  // single-field sections (fillIndices) may hold bare numbers
  const value = typeof record === "number" ? record : record[field];
  if (value === undefined && OPTIONAL_FIELDS.has(field)) return 0;
  const where = `dl pack: ${section}[${index}].${field} = ${value}`;
  if (type === "f") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${where}: not a finite number`);
  } else if (!Number.isInteger(value) || value < 0 || value > MAX_U32) {
    throw new Error(`${where}: not a u32`);
  }
  return value;
}

// pack({ prims: [record…], fillVertices: […], … }) → { buffer: ArrayBuffer, table: [{ name, offset, byteLength, count, stride }] }
// Every field of every record is required (except pad) and must fit its type; anything else throws.
export function pack(sections) {
  const table = [];
  let offset = alignUp(HEADER_BYTES);
  for (const name of SECTIONS) {
    if (!Array.isArray(sections[name])) throw new Error(`dl pack: section ${name} missing`);
    const { stride } = LAYOUTS[name];
    const count = sections[name].length;
    table.push({ name, offset, byteLength: count * stride, count, stride });
    offset = alignUp(offset + count * stride);
  }
  const buffer = new ArrayBuffer(offset);
  const view = new DataView(buffer);
  [MAGIC, VERSION, SECTIONS.length, HEADER_BYTES].forEach((word, i) => view.setUint32(i * 4, word, true));
  table.forEach((entry, s) => {
    const entryWords = [entry.offset, entry.byteLength, entry.count, entry.stride];
    entryWords.forEach((word, i) => view.setUint32((HEADER_FIELDS.length + s * SECTION_ENTRY_FIELDS.length + i) * 4, word, true));
    const { fields, stride } = LAYOUTS[entry.name];
    sections[entry.name].forEach((record, r) => {
      fields.forEach(([field, type], f) => {
        const at = entry.offset + r * stride + f * 4;
        const value = wordOf(entry.name, r, record, field, type);
        if (type === "f") view.setFloat32(at, value, true);
        else view.setUint32(at, value, true);
      });
    });
  });
  return { buffer, table };
}

// sectionsOf(ArrayBuffer | ArrayBufferView) → { name: { name, offset, byteLength, count, stride, f32, u32 } }.
// Views share the bytes (no copy) unless a view's byteOffset is not 4-aligned. Validates the header against LAYOUTS
// and the buffer bounds and throws on any mismatch. Offsets are checked for 4-byte alignment only: files written
// before SECTION_ALIGN became 256 (16-aligned, same version) still load.
export function sectionsOf(source) {
  if (!isLittleEndianHost()) throw new Error("dl: the typed-array views need a little-endian host");
  let buffer = source;
  let base = 0;
  const length = source.byteLength;
  if (ArrayBuffer.isView(source)) {
    if (source.byteOffset % 4) buffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    else [buffer, base] = [source.buffer, source.byteOffset];
  } else if (!(source instanceof ArrayBuffer)) {
    throw new Error("dl: expected an ArrayBuffer or ArrayBufferView");
  }
  if (length < HEADER_BYTES) throw new Error(`dl: ${length} bytes is shorter than the ${HEADER_BYTES}-byte header`);
  const view = new DataView(buffer, base, length);
  const word = (i) => view.getUint32(i * 4, true);
  if (word(0) !== MAGIC) throw new Error("dl: bad magic");
  if (word(1) !== VERSION) throw new Error(`dl: version ${word(1)}, expected ${VERSION}`);
  if (word(2) !== SECTIONS.length) throw new Error(`dl: ${word(2)} sections, expected ${SECTIONS.length}`);
  if (word(3) !== HEADER_BYTES) throw new Error(`dl: header bytes ${word(3)}, expected ${HEADER_BYTES}`);
  const out = {};
  let previousEnd = HEADER_BYTES;
  SECTIONS.forEach((name, s) => {
    const at = HEADER_FIELDS.length + s * SECTION_ENTRY_FIELDS.length;
    const entry = { name, offset: word(at), byteLength: word(at + 1), count: word(at + 2), stride: word(at + 3) };
    const bad = (problem) => new Error(`dl: section ${name} ${problem} (${JSON.stringify(entry)})`);
    if (entry.stride !== LAYOUTS[name].stride) throw bad(`stride, expected ${LAYOUTS[name].stride}`);
    if (entry.byteLength !== entry.count * entry.stride) throw bad("byteLength ≠ count × stride");
    if (entry.offset % 4) throw bad("offset not 4-aligned");
    if (entry.offset < previousEnd) throw bad("overlaps the header or the previous section");
    if (entry.offset + entry.byteLength > length) throw bad(`runs past the end of the ${length}-byte buffer`);
    previousEnd = entry.offset + entry.byteLength;
    entry.f32 = new Float32Array(buffer, base + entry.offset, entry.byteLength / 4);
    entry.u32 = new Uint32Array(buffer, base + entry.offset, entry.byteLength / 4);
    out[name] = entry;
  });
  return out;
}

// recordAt(section, i) → plain object (debug / tools; renderers read the typed arrays directly)
export function recordAt(section, i) {
  const { fields } = LAYOUTS[section.name];
  const base = i * STRIDE_WORDS[section.name];
  return Object.fromEntries(fields.map(([field, type], f) => [field, type === "f" ? section.f32[base + f] : section.u32[base + f]]));
}
