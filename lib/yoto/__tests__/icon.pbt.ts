/**
 * Property-based tests for lib/yoto/icon.ts
 *
 * Feature: yoto-integration
 * Validates: Requirements 7.1
 */

import { describe, it } from "vitest";
import { expect } from "vitest";
import * as fc from "fast-check";
import { PNG } from "pngjs";
import { generateIcon } from "../icon";

// ---------------------------------------------------------------------------
// Property 5: Icon fill rows match goal progress
// ---------------------------------------------------------------------------

describe("Property 5: Icon fill rows match goal progress", () => {
  it("number of bottom rows with green pixels equals Math.round(p / 100 * 16) ±1", () => {
    // Feature: yoto-integration, Property 5: Icon fill rows match goal progress
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (p) => {
        const buffer = generateIcon(p);
        const png = PNG.sync.read(buffer);

        const HEIGHT = 16;
        const WIDTH = 16;

        // Count rows from the bottom that contain at least one green pixel
        // Green = r:74, g:222, b:128 (FILLED colour defined in icon.ts)
        let greenRowCount = 0;
        for (let row = HEIGHT - 1; row >= 0; row--) {
          let rowIsGreen = false;
          for (let col = 0; col < WIDTH; col++) {
            const idx = (row * WIDTH + col) * 4;
            if (
              png.data[idx + 0] === 74 &&
              png.data[idx + 1] === 222 &&
              png.data[idx + 2] === 128
            ) {
              rowIsGreen = true;
              break;
            }
          }
          if (rowIsGreen) {
            greenRowCount++;
          } else {
            // Rows are filled from the bottom upward; stop at first non-green row
            break;
          }
        }

        const expectedRows = Math.round((p / 100) * HEIGHT);
        expect(Math.abs(greenRowCount - expectedRows)).toBeLessThanOrEqual(1);
      }),
      { numRuns: 101 } // covers all integers 0–100
    );
  });
});
