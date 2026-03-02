/**
 * MZK Importer
 *
 * Reverses the exporter process: extracts the visual canvas and ECS
 * state buffer from a .mzk file (physically a .png image with a
 * "barcode" data strip appended at the bottom).
 *
 * Layout expected from the exporter:
 *   ┌──────────────────────┐
 *   │   Visual Canvas       │  originalHeight
 *   ├──────────────────────┤
 *   │ MZK1 │  State Data    │  extraRows (data strip)
 *   └──────────────────────┘
 */

import {
  STATE_BUFFER_BYTES,
  CHANNELS_PER_PIXEL,
} from "../engine/memory.js";
import { HEADER_PIXELS } from "./exporter.js";

// ── Constants ────────────────────────────────────────────────

/** MZK1 magic bytes expected in the first pixel's RGBA channels. */
const MZK1_MAGIC = [0x4d, 0x5a, 0x4b, 0x31] as const; // 'M','Z','K','1'

// ── Main parser ──────────────────────────────────────────────

export interface ParsedSpriteROM {
  /** DataURL of the visual portion (barcode strip removed). */
  visualDataUrl: string;
  /** Extracted 16 KB ECS state buffer, or null for a standard image. */
  stateBuffer: Uint8ClampedArray | null;
  /** Width of the visual image. */
  width: number;
  /** Height of the visual image (excluding barcode rows). */
  height: number;
}

/**
 * Parse an HTMLImageElement that may be a .mzk cartridge.
 *
 * If the image contains the MZK1 signature in its data strip, the
 * visual portion is cropped and the 16 KB state buffer is extracted.
 * Otherwise the full image is returned as-is with stateBuffer: null.
 */
export function parseSpriteROM(img: HTMLImageElement): ParsedSpriteROM {
  const fullWidth = img.naturalWidth || img.width;
  const fullHeight = img.naturalHeight || img.height;

  // Draw the full image onto an offscreen canvas
  const canvas = document.createElement("canvas");
  canvas.width = fullWidth;
  canvas.height = fullHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  const fullData = ctx.getImageData(0, 0, fullWidth, fullHeight);

  // Calculate expected barcode geometry
  const statePixels = STATE_BUFFER_BYTES / CHANNELS_PER_PIXEL;
  const totalDataPixels = statePixels + HEADER_PIXELS;
  const extraRows = Math.ceil(totalDataPixels / fullWidth);
  const originalHeight = fullHeight - extraRows;

  // Guard: image must be tall enough to contain a barcode strip
  if (originalHeight <= 0) {
    return {
      visualDataUrl: canvas.toDataURL("image/png"),
      stateBuffer: null,
      width: fullWidth,
      height: fullHeight,
    };
  }

  // Extract the barcode strip data
  const barcodeData = ctx.getImageData(0, originalHeight, fullWidth, extraRows);
  const bd = barcodeData.data;

  // Check pixel 0 for MZK1 magic signature
  const hasMagic =
    bd[0] === MZK1_MAGIC[0] &&
    bd[1] === MZK1_MAGIC[1] &&
    bd[2] === MZK1_MAGIC[2] &&
    bd[3] === MZK1_MAGIC[3];

  if (!hasMagic) {
    // Standard image — return the full image as-is
    return {
      visualDataUrl: canvas.toDataURL("image/png"),
      stateBuffer: null,
      width: fullWidth,
      height: fullHeight,
    };
  }

  // ── Extract the state buffer ────────────────────────────────
  const headerBytes = HEADER_PIXELS * CHANNELS_PER_PIXEL;
  const stateBuffer = new Uint8ClampedArray(STATE_BUFFER_BYTES);
  stateBuffer.set(bd.slice(headerBytes, headerBytes + STATE_BUFFER_BYTES));

  // ── Crop the visual portion ─────────────────────────────────
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = fullWidth;
  cropCanvas.height = originalHeight;
  const cropCtx = cropCanvas.getContext("2d")!;
  cropCtx.putImageData(
    ctx.getImageData(0, 0, fullWidth, originalHeight),
    0,
    0,
  );

  return {
    visualDataUrl: cropCanvas.toDataURL("image/png"),
    stateBuffer,
    width: fullWidth,
    height: originalHeight,
  };
}
