import { PNG } from "pngjs";

// Icon dimensions
const WIDTH = 16;
const HEIGHT = 16;

// Penni green — filled row colour (#4ade80, fully opaque)
const FILLED = { r: 74, g: 222, b: 128, a: 255 };

// Dark background — unfilled row colour (#1f2937, fully opaque)
const UNFILLED = { r: 31, g: 41, b: 55, a: 255 };

/**
 * Generates a 16×16 32-bit RGBA PNG that represents a vertical progress bar.
 *
 * Rows are filled from the bottom upward:
 *   filledRows = Math.round((goalProgressPercent ?? 100) / 100 * 16)
 *
 * A pixel in row `r` (0 = top, 15 = bottom) is filled when:
 *   r >= (HEIGHT - filledRows)
 *
 * When `goalProgressPercent` is `undefined`, all 16 rows are filled
 * (returns the static "full" icon).
 *
 * @param goalProgressPercent - Integer 0–100, or undefined for full fill.
 * @returns PNG file contents as a Node.js Buffer.
 */
export function generateIcon(goalProgressPercent: number | undefined): Buffer {
  const pct = goalProgressPercent ?? 100;
  const filledRows = Math.round((pct / 100) * HEIGHT);

  // First row index (0-based, top-down) that should be filled
  const fillFromRow = HEIGHT - filledRows;

  const png = new PNG({ width: WIDTH, height: HEIGHT, filterType: -1 });

  for (let row = 0; row < HEIGHT; row++) {
    const isFilled = row >= fillFromRow;
    const colour = isFilled ? FILLED : UNFILLED;

    for (let col = 0; col < WIDTH; col++) {
      // pngjs stores pixels in a flat RGBA byte array, row-major order
      const idx = (row * WIDTH + col) * 4;
      png.data[idx + 0] = colour.r;
      png.data[idx + 1] = colour.g;
      png.data[idx + 2] = colour.b;
      png.data[idx + 3] = colour.a;
    }
  }

  return PNG.sync.write(png);
}
