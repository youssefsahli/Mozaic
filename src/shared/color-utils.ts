/**
 * Shared Color Utilities
 *
 * Provides common hex↔RGB conversion helpers used across both the editor
 * and engine subsystems.
 */

/** Parse a CSS hex color (`#rgb` or `#rrggbb`) into an `[r, g, b]` tuple. */
export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean.split("").map((c) => c + c).join("")
      : clean;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** Convert an RGB triplet back to a lowercase `#rrggbb` string. */
export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}
