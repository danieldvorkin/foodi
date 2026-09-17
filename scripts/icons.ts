/**
 * Draw foodi's app icons (the sage mark from Logo.tsx) as PNGs with no image library:
 * client/public/icon-192.png, icon-512.png (maskable: full-bleed) and apple-touch-icon.png (180).
 * Run: npx tsx scripts/icons.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodePng } from '../server/src/lib/png.ts';

const SAGE: [number, number, number] = [0x5a, 0x6b, 0x4b];
const INK: [number, number, number] = [0xfa, 0xfa, 0xf8];

/** Coverage of the ring + dot at a point in the 32-unit logo space (0..1), supersampled by the caller. */
function mark(u: number, v: number): number {
  const d = Math.hypot(u - 16, v - 16);
  const ring = d >= 5.75 && d <= 8.25 ? 1 : 0;
  const dot = d <= 2.2 ? 1 : 0;
  return Math.max(ring, dot);
}

function draw(size: number, inset: number): Buffer {
  const ss = 4;
  return encodePng(size, size, (x, y) => {
    let cover = 0;
    for (let sy = 0; sy < ss; sy++)
      for (let sx = 0; sx < ss; sx++) {
        const px = x + (sx + 0.5) / ss;
        const py = y + (sy + 0.5) / ss;
        // Map the pixel into logo space, shrunk by `inset` so the ring clears a maskable icon's safe zone.
        const scale = (32 * (1 + 2 * inset)) / size;
        cover += mark(px * scale - 32 * inset, py * scale - 32 * inset);
      }
    const a = cover / (ss * ss);
    return [Math.round(SAGE[0] + (INK[0] - SAGE[0]) * a), Math.round(SAGE[1] + (INK[1] - SAGE[1]) * a), Math.round(SAGE[2] + (INK[2] - SAGE[2]) * a)];
  });
}

const out = resolve(import.meta.dirname, '../client/public');
writeFileSync(resolve(out, 'icon-192.png'), draw(192, 0.1));
writeFileSync(resolve(out, 'icon-512.png'), draw(512, 0.1));
writeFileSync(resolve(out, 'apple-touch-icon.png'), draw(180, 0.06));
console.log('icons written to', out);
