/**
 * PNGs for the asset catalogues: SVG rendered by resvg (@resvg/resvg-js), encoded by pngjs. The
 * bytes depend only on the input. pngjs filters each row the same way every time, and deflates
 * with Z_RLE, which never consults the hash that zlib's forks implement differently (Node's
 * Chromium zlib gives other bytes than canonical zlib for the default strategy, but the same for
 * Z_RLE), so `pnpm mobile:check` agrees with what any machine generates.
 */
import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';

export interface Rendered {
  width: number;
  height: number;
  /** Four bytes a pixel, red, green, blue and alpha, row by row from the top left. */
  rgba: Uint8Array;
}

/** `svg` rendered `width` pixels wide, its height in proportion. */
export function render(svg: string, width: number): Rendered {
  const image = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render();
  return { width: image.width, height: image.height, rgba: new Uint8Array(image.pixels) };
}

/** Whether every pixel is fully opaque. */
export function opaque(image: Rendered): boolean {
  for (let i = 3; i < image.rgba.length; i += 4) if (image.rgba[i] !== 255) return false;
  return true;
}

/**
 * `image` as a PNG: 8 bits a channel, RGBA, or RGB with no alpha channel when `alpha` is false,
 * which only an opaque image may be.
 */
export function encodePng(image: Rendered, alpha: boolean): Uint8Array {
  if (!alpha && !opaque(image)) {
    throw new Error('An image with transparent pixels needs its alpha channel');
  }
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.rgba);
  return new Uint8Array(PNG.sync.write(png, { colorType: alpha ? 6 : 2, inputHasAlpha: true }));
}

export interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  /** 2 is RGB, 6 RGBA (PNG specification, section 11.2.2). */
  colourType: number;
  /** Every chunk's type, in order. */
  chunks: string[];
}

/** What a PNG's chunks say about it, without decoding the pixels. Throws if it isn't a PNG. */
export function pngHeader(bytes: Uint8Array): PngHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || signature.some((b, i) => bytes[i] !== b)) {
    throw new Error('Not a PNG');
  }
  const chunks: string[] = [];
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = view.getUint32(at);
    chunks.push(String.fromCharCode(...bytes.subarray(at + 4, at + 8)));
    at += 12 + length;
  }
  if (chunks[0] !== 'IHDR') throw new Error('Not a PNG');
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    bitDepth: bytes[24]!,
    colourType: bytes[25]!,
    chunks,
  };
}
