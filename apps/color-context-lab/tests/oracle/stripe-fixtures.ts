import { TINY } from './color-fixtures.ts';
import type { Raster } from '../../src/types.ts';

export const STRIPE_A = [224, 112, 32, 255];
export const STRIPE_B = [32, 64, 192, 255];
export const STRIPE_SETTINGS = { border: 6, colorA: '#e07020', colorB: '#2040c0', cellSize: 4 };

// Original fixed rows/columns: no renderer, validator or production parity logic.
export function tinyStripe(direction: 'horizontal' | 'vertical'): Raster {
  const width = 15, height = 14, rgba = new Uint8ClampedArray(width * height * 4);
  const columns = 'AAAABBBBAAAABBB', rows = 'AAAABBBBAAAABB';
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    if (x >= 6 && x < 9 && y >= 6 && y < 8) {
      const source = ((y - 6) * 3 + x - 6) * 4;
      rgba.set(TINY.subarray(source, source + 4), at);
    } else rgba.set((direction === 'horizontal' ? rows[y] : columns[x]) === 'A' ? STRIPE_A : STRIPE_B, at);
  }
  return { width, height, rgba };
}
