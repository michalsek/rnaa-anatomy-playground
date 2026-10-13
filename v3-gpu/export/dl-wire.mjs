// Compact, lossless transport of a display-list binary (notes/DL-FORMAT.md) inside an HTML page.
//
// The binary is mostly records whose neighbouring values are close (item / paint / layer ids repeated over runs of
// records, sequential indices, coordinates of one outline). Gzip alone sees them interleaved and keeps 19 % of the
// bytes; rewritten column by column it keeps 9.5 %:
//   1. every section is rewritten column-major (all records' word 0, then word 1, …) — the header and the padding
//      between sections stay where they are, so the result has the binary's exact length and offsets;
//   2. each column is delta-coded as unsigned 32-bit words (f32 columns too: their bit patterns change slowly);
//   3. each column's words are split into four byte planes (low bytes of every word first).
// The page gets base64(gzip(packed)) and decodes it with the platform's DecompressionStream. Unpacking restores the
// original bytes exactly, so a page built from the packed form draws bit-identical geometry.
// Dependency-free ES (Node and browser).

/** Value of the `data-encoding` attribute on the page's binary script element. */
export const DL_WIRE_ENCODING = "rnaa-dl-columns-delta+gzip+base64";

const HEADER_SECTION_COUNT_BYTE = 8;
const HEADER_TABLE_BYTE = 16;
const TABLE_ENTRY_BYTES = 16;
const WORD_BYTES = 4;

/** Section placement read from the binary's own header: `[offset, count, strideWords]` per section. */
function sectionPlacements(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sectionCount = view.getUint32(HEADER_SECTION_COUNT_BYTE, true);
  const placements = [];
  for (let section = 0; section < sectionCount; section++) {
    const entry = HEADER_TABLE_BYTE + section * TABLE_ENTRY_BYTES;
    const offset = view.getUint32(entry, true);
    const count = view.getUint32(entry + 8, true);
    const stride = view.getUint32(entry + 12, true);
    if (stride % WORD_BYTES || offset % WORD_BYTES || offset + count * stride > bytes.byteLength) throw new Error(`dl-wire: section ${section} does not fit the binary`);
    placements.push([offset, count, stride / WORD_BYTES]);
  }
  return placements;
}

/** The packed form of a display-list binary (same length; header verbatim). */
export function packDlBinary(binary) {
  const source = new Uint8Array(binary.buffer ?? binary, binary.byteOffset ?? 0, binary.byteLength);
  const words = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const packed = source.slice();
  for (const [offset, count, strideWords] of sectionPlacements(source)) {
    let out = offset;
    for (let column = 0; column < strideWords; column++) {
      for (let plane = 0; plane < WORD_BYTES; plane++) {
        let previous = 0;
        for (let record = 0; record < count; record++) {
          const word = words.getUint32(offset + (record * strideWords + column) * WORD_BYTES, true);
          packed[out++] = ((word - previous) >>> (8 * plane)) & 0xff;
          previous = word;
        }
      }
    }
  }
  return packed;
}

/** Inverse of `packDlBinary`: the original binary as a fresh ArrayBuffer. */
export function unpackDlBinary(packed) {
  const source = new Uint8Array(packed.buffer ?? packed, packed.byteOffset ?? 0, packed.byteLength);
  const binary = source.slice();
  const words = new DataView(binary.buffer);
  for (const [offset, count, strideWords] of sectionPlacements(source)) {
    const planeBytes = count;
    const columnBytes = count * WORD_BYTES;
    for (let column = 0; column < strideWords; column++) {
      const columnStart = offset + column * columnBytes;
      let previous = 0;
      for (let record = 0; record < count; record++) {
        const at = columnStart + record;
        const delta = source[at] | (source[at + planeBytes] << 8) | (source[at + 2 * planeBytes] << 16) | (source[at + 3 * planeBytes] << 24);
        previous = (previous + delta) >>> 0;
        words.setUint32(offset + (record * strideWords + column) * WORD_BYTES, previous, true);
      }
    }
  }
  return binary.buffer;
}

function bytesOfBase64(base64) {
  const text = atob(base64.trim());
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/** Decodes the page transport (`DL_WIRE_ENCODING`) back to the display-list binary. */
export async function decodeDlWire(base64) {
  const compressed = new Blob([bytesOfBase64(base64)]).stream().pipeThrough(new DecompressionStream("gzip"));
  return unpackDlBinary(new Uint8Array(await new Response(compressed).arrayBuffer()));
}
