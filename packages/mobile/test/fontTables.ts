import { readSfnt } from '../src/exportFont';

/**
 * The code points a font's Windows Unicode BMP cmap (format 4) gives a glyph, as Core Text finds
 * them. Every font the app bundles has one, the text faces only that, the answer font a copy of it
 * for the Unicode platform too. Shared by the tests that ask what a face can draw
 * (exportFont.test.ts, titleFont.test.ts).
 */
export function cmapCodePoints(ttf: Uint8Array): Set<number> {
  const cmap = readSfnt(ttf).tables.get('cmap');
  if (!cmap) throw new Error('The font has no cmap table');
  const view = new DataView(cmap.buffer, cmap.byteOffset, cmap.byteLength);
  const found = new Set<number>();
  for (let i = 0; i < view.getUint16(2); i++) {
    const record = 4 + 8 * i;
    if (view.getUint16(record) !== 3 || view.getUint16(record + 2) !== 1) continue;
    const table = view.getUint32(record + 4);
    const format = view.getUint16(table);
    if (format !== 4) throw new Error(`The font's Windows BMP cmap is format ${format}, not 4`);
    const segments = view.getUint16(table + 6) / 2;
    const ends = table + 14;
    const starts = ends + 2 * segments + 2;
    const deltas = starts + 2 * segments;
    const rangeOffsets = deltas + 2 * segments;
    for (let s = 0; s < segments; s++) {
      const [start, end] = [view.getUint16(starts + 2 * s), view.getUint16(ends + 2 * s)];
      const delta = view.getUint16(deltas + 2 * s);
      const rangeOffset = view.getUint16(rangeOffsets + 2 * s);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let glyph: number;
        if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
        else {
          const at = rangeOffsets + 2 * s + rangeOffset + 2 * (c - start);
          const raw = view.getUint16(at);
          glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
        }
        if (glyph !== 0) found.add(c);
      }
    }
  }
  return found;
}
