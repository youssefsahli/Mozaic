/**
 * Shape Atlas Generator
 *
 * When a script uses generative shape sprites (kind: "shape"), this module
 * creates a synthetic ImageData that contains the rendered shape pixels and
 * converts each shape sprite def into an absolute sprite def that references
 * the correct position within that ImageData.
 *
 * Layout (for a 64-pixel-wide atlas):
 *   - Rows  0–63  : state-buffer area (zero-initialised)
 *   - Rows 64+    : shape sprites, 4 per row at gridSize column intervals
 */

import type { MscSpriteDef, MscSpriteShape } from "../parser/ast.js";

/** Width of the synthetic atlas (matches the canonical state-buffer width). */
const ATLAS_WIDTH = 64;

/** Shapes per row in the atlas (4 × 16 = 64px). */
const SHAPES_PER_ROW = 4;

/** First row available for shape pixels (after the 64-row state area). */
const SHAPE_ROW_OFFSET = 64;

/**
 * Check whether the sprites map contains at least one shape sprite.
 */
export function hasShapeSprites(sprites: Map<string, MscSpriteDef>): boolean {
  for (const def of sprites.values()) {
    if (def.kind === "shape") return true;
  }
  return false;
}

/**
 * Paint shape pixels into the supplied `data` array (RGBA, width = ATLAS_WIDTH)
 * and return an updated sprites Map where every shape sprite def has been
 * replaced with an absolute sprite def.
 *
 * @param data         Raw RGBA pixel array.  Must be at least
 *                     `ATLAS_WIDTH × (SHAPE_ROW_OFFSET + shapeRows) × 4` bytes.
 * @param sprites      The parsed sprites Map.
 * @param gridSize     Sprite cell size in pixels (default 16).
 */
export function paintShapesIntoBuffer(
  data: Uint8ClampedArray,
  atlasHeight: number,
  sprites: Map<string, MscSpriteDef>,
  gridSize: number
): Map<string, MscSpriteDef> {
  const updated = new Map<string, MscSpriteDef>();

  let shapeIndex = 0;

  for (const [name, def] of sprites) {
    if (def.kind !== "shape") {
      updated.set(name, def);
      continue;
    }

    const col = shapeIndex % SHAPES_PER_ROW;
    const shapeRow = Math.floor(shapeIndex / SHAPES_PER_ROW);
    const cellX = col * gridSize;
    const cellY = SHAPE_ROW_OFFSET + shapeRow * gridSize;

    if (cellY + gridSize > atlasHeight) {
      // Out of bounds — skip (shouldn't happen if atlas was sized correctly)
      shapeIndex++;
      continue;
    }

    paintShape(data, ATLAS_WIDTH, cellX, cellY, gridSize, def);

    updated.set(name, {
      kind: "absolute",
      x: cellX,
      y: cellY,
      w: gridSize,
      h: gridSize,
      ox: 0,
      oy: 0,
    });

    shapeIndex++;
  }

  return updated;
}

/** Draw a single shape primitive into the RGBA pixel array. */
function paintShape(
  data: Uint8ClampedArray,
  width: number,
  cellX: number,
  cellY: number,
  gridSize: number,
  def: MscSpriteShape
): void {
  const rgba = hexToRgba(def.color);
  const halfGrid = gridSize / 2;
  const cx = cellX + halfGrid;
  const cy = cellY + halfGrid;
  const r = Math.min(def.size / 2, halfGrid - 1);

  for (let py = cellY; py < cellY + gridSize; py++) {
    for (let px = cellX; px < cellX + gridSize; px++) {
      const dx = px - cx + 0.5; // centre of pixel
      const dy = py - cy + 0.5;
      let inside = false;

      if (def.shapeType === "circle") {
        inside = dx * dx + dy * dy <= r * r;
      } else if (def.shapeType === "rect") {
        inside = Math.abs(dx) <= r && Math.abs(dy) <= r;
      } else if (def.shapeType === "diamond") {
        inside = Math.abs(dx) + Math.abs(dy) <= r;
      }

      if (inside) {
        const idx = (py * width + px) * 4;
        data[idx]     = rgba[0];
        data[idx + 1] = rgba[1];
        data[idx + 2] = rgba[2];
        data[idx + 3] = rgba[3];
      }
    }
  }
}

/** Parse a CSS hex color string (#RGB / #RRGGBB) into [r, g, b, a]. */
function hexToRgba(hex: string): [number, number, number, number] {
  const h = (hex.startsWith("#") ? hex.slice(1) : hex).trim();
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
      255,
    ];
  }
  if (h.length >= 6) {
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      255,
    ];
  }
  return [255, 255, 255, 255];
}

/**
 * Create a synthetic atlas ImageData for scripts that use shape sprites but
 * have no Source image.
 *
 * Layout:
 *   - width:  64 pixels
 *   - height: 64 (state area) + ceil(shapeCount / 4) × gridSize
 *
 * Returns a new ImageData with shapes painted in, and an updated sprites Map.
 */
export function createShapeAtlas(
  sprites: Map<string, MscSpriteDef>,
  gridSize: number
): { imageData: ImageData; updatedSprites: Map<string, MscSpriteDef> } {
  const shapeCount = [...sprites.values()].filter((d) => d.kind === "shape").length;
  const shapeRows = Math.max(1, Math.ceil(shapeCount / SHAPES_PER_ROW));
  const atlasHeight = SHAPE_ROW_OFFSET + shapeRows * gridSize;

  const data = new Uint8ClampedArray(ATLAS_WIDTH * atlasHeight * 4);
  const updatedSprites = paintShapesIntoBuffer(data, atlasHeight, sprites, gridSize);

  return {
    imageData: new ImageData(new Uint8ClampedArray(data), ATLAS_WIDTH, atlasHeight),
    updatedSprites,
  };
}

/**
 * Extend an existing ImageData to accommodate shape sprites that don't fit
 * within its current height.
 *
 * Returns the (potentially expanded) ImageData and updated sprites Map.
 * If the source image is already tall enough (≥ SHAPE_ROW_OFFSET + shapeRows × gridSize),
 * it is used as-is (no new allocation).
 */
export function extendImageDataWithShapes(
  imageData: ImageData,
  sprites: Map<string, MscSpriteDef>,
  gridSize: number
): { imageData: ImageData; updatedSprites: Map<string, MscSpriteDef> } {
  const shapeCount = [...sprites.values()].filter((d) => d.kind === "shape").length;
  const shapeRows = Math.max(1, Math.ceil(shapeCount / SHAPES_PER_ROW));
  const neededHeight = SHAPE_ROW_OFFSET + shapeRows * gridSize;

  let data: Uint8ClampedArray;
  let width = imageData.width;
  let height = imageData.height;

  if (width === ATLAS_WIDTH && height >= neededHeight) {
    // Re-use existing buffer directly
    data = new Uint8ClampedArray(imageData.data);
  } else {
    // Expand: create new buffer tall enough, copy original pixels
    const newWidth = Math.max(width, ATLAS_WIDTH);
    const newHeight = Math.max(height, neededHeight);
    data = new Uint8ClampedArray(newWidth * newHeight * 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const src = (y * width + x) * 4;
        const dst = (y * newWidth + x) * 4;
        data[dst]     = imageData.data[src];
        data[dst + 1] = imageData.data[src + 1];
        data[dst + 2] = imageData.data[src + 2];
        data[dst + 3] = imageData.data[src + 3];
      }
    }

    width = newWidth;
    height = newHeight;
  }

  const updatedSprites = paintShapesIntoBuffer(data, height, sprites, gridSize);
  return {
    imageData: new ImageData(new Uint8ClampedArray(data), width, height),
    updatedSprites,
  };
}
