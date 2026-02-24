/**
 * MZK Exporter
 *
 * Exports the visual canvas and ECS state buffer as a single .mzk file
 * (physically a .png image). The state data is encoded as a "barcode"
 * strip appended to the bottom of the visual image.
 *
 * Layout:
 *   ┌──────────────────────┐
 *   │   Visual Canvas       │  original height
 *   ├──────────────────────┤
 *   │ MZK1 │  State Data    │  extra rows (data strip)
 *   └──────────────────────┘
 *
 * The first 4 pixels of the data strip contain the MZK1 signature,
 * followed by the 16KB state buffer encoded at 4 bytes per pixel (RGBA).
 */

import {
  STATE_BUFFER_BYTES,
  CHANNELS_PER_PIXEL,
} from "../engine/memory";

// ── Constants ────────────────────────────────────────────────

/** Number of pixels reserved for the MZK1 file signature header. */
export const HEADER_PIXELS = 4;

/** MZK1 magic bytes written into the first pixel's RGBA channels. */
const MZK1_MAGIC = [0x4d, 0x5a, 0x4b, 0x31] as const; // 'M','Z','K','1'

// ── Pure helpers ─────────────────────────────────────────────

/**
 * Calculate the dimensions for the exported MZK image.
 *
 * @param canvasWidth  Width of the visual canvas (pixels).
 * @param canvasHeight Height of the visual canvas (pixels).
 * @param stateBytes   Size of the state buffer in bytes (default 16 384).
 * @returns totalDataPixels, extraRows, and totalHeight.
 */
export function calcExportDimensions(
  canvasWidth: number,
  canvasHeight: number,
  stateBytes: number = STATE_BUFFER_BYTES,
) {
  const statePixels = stateBytes / CHANNELS_PER_PIXEL;
  const totalDataPixels = statePixels + HEADER_PIXELS;
  const extraRows = Math.ceil(totalDataPixels / canvasWidth);
  const totalHeight = canvasHeight + extraRows;
  return { totalDataPixels, extraRows, totalHeight };
}

/**
 * Build the data-strip pixel buffer containing the MZK1 header
 * followed by the raw state bytes.
 *
 * @param width       Row width in pixels (must match the visual canvas).
 * @param extraRows   Number of rows in the data strip.
 * @param stateBuffer The 16 KB ECS state buffer.
 * @returns A Uint8ClampedArray suitable for constructing an ImageData.
 */
export function buildDataStrip(
  width: number,
  extraRows: number,
  stateBuffer: Uint8ClampedArray,
): Uint8ClampedArray {
  const stripBytes = width * extraRows * CHANNELS_PER_PIXEL;
  const data = new Uint8ClampedArray(stripBytes);

  // ── MZK1 signature (first pixel) ──────────────────────────
  data[0] = MZK1_MAGIC[0];
  data[1] = MZK1_MAGIC[1];
  data[2] = MZK1_MAGIC[2];
  data[3] = MZK1_MAGIC[3];

  // Pixels 1-3 of the header are reserved (zeroed).

  // ── State buffer (starts after header) ────────────────────
  const headerBytes = HEADER_PIXELS * CHANNELS_PER_PIXEL;
  data.set(stateBuffer, headerBytes);

  return data;
}

// ── Main export function ─────────────────────────────────────

/**
 * Export the visual canvas and ECS state buffer as a downloadable
 * `.mzk` file (PNG image with an appended data barcode).
 *
 * @param visualCanvas The HTML canvas containing the game's visual art.
 * @param stateBuffer  The 16 KB Uint8ClampedArray holding ECS state.
 * @param filename     Output filename (default `"game.mzk"`).
 */
export function exportSpriteROM(
  visualCanvas: HTMLCanvasElement,
  stateBuffer: Uint8ClampedArray,
  filename: string = "game.mzk",
): void {
  const canvasWidth = visualCanvas.width;
  const canvasHeight = visualCanvas.height;

  // ── Dimension calculation ─────────────────────────────────
  const { extraRows, totalHeight } = calcExportDimensions(
    canvasWidth,
    canvasHeight,
    stateBuffer.length,
  );

  // ── Offscreen staging canvas ──────────────────────────────
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = canvasWidth;
  exportCanvas.height = totalHeight;
  const ctx = exportCanvas.getContext("2d")!;

  // Draw the visual artwork at the top
  ctx.drawImage(visualCanvas, 0, 0);

  // ── Write the data barcode strip ──────────────────────────
  const stripData = buildDataStrip(canvasWidth, extraRows, stateBuffer);
  const stripImage = new ImageData(
    new Uint8ClampedArray(stripData.buffer as ArrayBuffer),
    canvasWidth,
    extraRows,
  );
  ctx.putImageData(stripImage, 0, canvasHeight);

  // ── Trigger browser download ──────────────────────────────
  exportCanvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}
