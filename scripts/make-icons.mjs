#!/usr/bin/env node
/**
 * Renders the PWA icons, apple-touch-icon and favicon.ico from each site's favicon.svg:
 * public/ for isithot.today, public/wet/ for isitwet.today, public/snow/ for willitsnow.today and
 * public/wind/ for isitwindy.today.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const render = (source, size) =>
  new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();

/** A one-image .ico holding a 32×32 PNG. */
function ico(png) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(32, 6);
  header.writeUInt8(32, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

const pub = new URL('../apps/web/public/', import.meta.url);
for (const dir of [pub, new URL('wet/', pub), new URL('snow/', pub), new URL('wind/', pub)]) {
  const svg = readFileSync(new URL('favicon.svg', dir), 'utf8');
  // Maskable icons need the artwork inside the central 80% safe zone, on a full-bleed background.
  const maskable = svg
    .replace(
      '<rect width="120" height="120" rx="26" fill="url(#g)"/>',
      '<rect width="120" height="120" fill="url(#g)"/>',
    )
    .replace('<g fill="none"', '<g transform="translate(12 12) scale(.8)" fill="none"');
  if (maskable === svg) throw new Error(`${dir.pathname}favicon.svg: unexpected structure`);

  mkdirSync(new URL('icons/', dir), { recursive: true });
  writeFileSync(new URL('icons/icon-192.png', dir), render(svg, 192));
  writeFileSync(new URL('icons/icon-512.png', dir), render(svg, 512));
  writeFileSync(new URL('icons/icon-maskable-512.png', dir), render(maskable, 512));
  writeFileSync(new URL('apple-touch-icon.png', dir), render(maskable, 180));
  writeFileSync(new URL('favicon.ico', dir), ico(render(svg, 32)));
}
console.log('icons written');
