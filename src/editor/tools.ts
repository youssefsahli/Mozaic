/**
 * Pixel Editor — Tool System
 *
 * Implements the strategy pattern for pixel editing tools. Each tool
 * provides three lifecycle callbacks:
 *
 * - **onDown** — Called when the pointer is pressed. Sets up initial
 *   state and may perform immediate operations (e.g., flood fill).
 * - **onMove** — Called on pointer movement. Handles continuous
 *   drawing operations with Bresenham line interpolation.
 * - **onUp** — Called when the pointer is released. Finalizes the
 *   stroke and triggers any post-processing.
 *
 * ## Available Tools
 *
 * | Type    | Name     | Description                                    |
 * |---------|----------|------------------------------------------------|
 * | Draw(0) | Pencil   | Pixel-precise drawing with pressure support    |
 * | Erase(1)| Eraser   | Marks pixels for removal with visual feedback  |
 * | Fill(2) | Fill     | Stack-based flood fill modifying imageData     |
 * | Select(3)| Select  | Rectangle selection with marching ants preview |
 * | Pipette(4)| Pipette| Color picker from canvas pixels                |
 *
 * ## Rendering Pipeline
 *
 * Draw and Erase tools render to the draft canvas overlay. When the
 * stroke ends, the orchestrator merges the draft layer into the
 * document ImageData. Fill operates directly on imageData for
 * immediate feedback.
 */

import type {
  ToolType,
  PointerInfo,
  BrushSettings,
  CameraState,
  SelectionRect,
} from "./types.js";
import type { MscEntity } from "../parser/msc.js";

export interface ToolContext {
  imageData: ImageData;
  draftCtx: CanvasRenderingContext2D;
  camera: CameraState;
  brush: BrushSettings;
  /** Bitmap for tracking erased document pixels. */
  eraseBitmap: Uint8Array;
  eraseBitmapW: number;
  eraseBitmapH: number;
  /** Callbacks from the orchestrator. */
  onColorPicked: (hex: string) => void;
  onSelectionChange: (rect: SelectionRect | null) => void;
  /** Entity brush: available entity definitions and spawn callback. */
  entityDefs: Record<string, MscEntity>;
  activeEntityType: string | null;
  onEntityPlace: (entityType: string, docX: number, docY: number) => void;
}

export interface Tool {
  type: ToolType;
  onDown(info: PointerInfo, ctx: ToolContext): void;
  onMove(info: PointerInfo, ctx: ToolContext): void;
  onUp(info: PointerInfo, ctx: ToolContext): void;
  cursor: string;
}

// ── Shared helpers ─────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace("#", "");
  return [
    parseInt(c.slice(0, 2), 16),
    parseInt(c.slice(2, 4), 16),
    parseInt(c.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/**
 * Compute effective brush radius based on pressure mode.
 * Returns the radius in document pixels.
 */
function effectiveRadius(brush: BrushSettings, pressure: number): number {
  if (brush.pressureMode === "size") {
    const scale = Math.max(0.2, pressure);
    return Math.max(0, Math.floor((brush.size * scale - 1) / 2));
  }
  return Math.max(0, Math.floor((brush.size - 1) / 2));
}

/** Whether a pixel should be drawn in dither mode based on pressure. */
function ditherCheck(brush: BrushSettings, pressure: number): boolean {
  if (brush.pressureMode !== "dither") return true;
  return Math.random() < Math.max(0.1, pressure);
}

// ── Last position tracking for Bresenham lines ──

let _lastDocX = -1;
let _lastDocY = -1;

function resetLastPos(): void {
  _lastDocX = -1;
  _lastDocY = -1;
}

/**
 * Iterate over pixel positions from (x0,y0) to (x1,y1) using
 * Bresenham's line algorithm. Calls `cb` for each position.
 */
function bresenhamLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cb: (x: number, y: number) => void
): void {
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  for (;;) {
    cb(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/**
 * Draw a brush stamp at document position (docX, docY) onto the draft canvas.
 */
function stampBrush(
  docX: number,
  docY: number,
  info: PointerInfo,
  ctx: ToolContext
): void {
  const { draftCtx, camera, brush, imageData } = ctx;
  const radius = effectiveRadius(brush, info.pressure);
  const [r, g, b] = hexToRgb(brush.color);

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = docX + dx;
      const py = docY + dy;
      if (px < 0 || py < 0 || px >= imageData.width || py >= imageData.height) continue;
      if (!ditherCheck(brush, info.pressure)) continue;

      // Convert document pixel to screen pixel for draft canvas
      const sx = Math.floor((px - camera.x) * camera.zoom);
      const sy = Math.floor((py - camera.y) * camera.zoom);
      const size = Math.ceil(camera.zoom);

      draftCtx.fillStyle = `rgb(${r},${g},${b})`;
      draftCtx.fillRect(sx, sy, size, size);
    }
  }
}

/**
 * Stamp erase at document position (docX, docY).
 * Marks pixels in the erase bitmap instead of drawing to draft.
 */
function stampErase(
  docX: number,
  docY: number,
  info: PointerInfo,
  ctx: ToolContext
): void {
  const { camera, brush, imageData, eraseBitmap, eraseBitmapW, draftCtx } = ctx;
  const radius = effectiveRadius(brush, info.pressure);

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = docX + dx;
      const py = docY + dy;
      if (px < 0 || py < 0 || px >= imageData.width || py >= imageData.height) continue;

      eraseBitmap[py * eraseBitmapW + px] = 1;

      // Visual feedback: draw semi-transparent indicator on draft
      const sx = Math.floor((px - camera.x) * camera.zoom);
      const sy = Math.floor((py - camera.y) * camera.zoom);
      const size = Math.ceil(camera.zoom);
      draftCtx.fillStyle = "rgba(255,50,50,0.3)";
      draftCtx.fillRect(sx, sy, size, size);
    }
  }
}

// ── Draw Tool ──────────────────────────────────────────────────

export const drawTool: Tool = {
  type: 0 as ToolType,
  cursor: "crosshair",

  onDown(info: PointerInfo, ctx: ToolContext): void {
    resetLastPos();
    const docX = Math.floor(info.docX);
    const docY = Math.floor(info.docY);
    stampBrush(docX, docY, info, ctx);
    _lastDocX = docX;
    _lastDocY = docY;
  },

  onMove(info: PointerInfo, ctx: ToolContext): void {
    const docX = Math.floor(info.docX);
    const docY = Math.floor(info.docY);
    if (_lastDocX >= 0 && _lastDocY >= 0) {
      bresenhamLine(_lastDocX, _lastDocY, docX, docY, (x, y) => {
        stampBrush(x, y, info, ctx);
      });
    } else {
      stampBrush(docX, docY, info, ctx);
    }
    _lastDocX = docX;
    _lastDocY = docY;
  },

  onUp(): void {
    resetLastPos();
  },
};

// ── Erase Tool ─────────────────────────────────────────────────

export const eraseTool: Tool = {
  type: 1 as ToolType,
  cursor: "crosshair",

  onDown(info: PointerInfo, ctx: ToolContext): void {
    resetLastPos();
    const docX = Math.floor(info.docX);
    const docY = Math.floor(info.docY);
    stampErase(docX, docY, info, ctx);
    _lastDocX = docX;
    _lastDocY = docY;
  },

  onMove(info: PointerInfo, ctx: ToolContext): void {
    const docX = Math.floor(info.docX);
    const docY = Math.floor(info.docY);
    if (_lastDocX >= 0 && _lastDocY >= 0) {
      bresenhamLine(_lastDocX, _lastDocY, docX, docY, (x, y) => {
        stampErase(x, y, info, ctx);
      });
    } else {
      stampErase(docX, docY, info, ctx);
    }
    _lastDocX = docX;
    _lastDocY = docY;
  },

  onUp(): void {
    resetLastPos();
  },
};

// ── Fill Tool ──────────────────────────────────────────────────

/** Pre-allocated visited array — reused with .fill(0). */
let _fillVisited: Uint8Array | null = null;

export const fillTool: Tool = {
  type: 2 as ToolType,
  cursor: "crosshair",

  onDown(info: PointerInfo, ctx: ToolContext): void {
    const { imageData } = ctx;
    const docX = Math.floor(info.docX);
    const docY = Math.floor(info.docY);
    if (docX < 0 || docY < 0 || docX >= imageData.width || docY >= imageData.height) return;

    const w = imageData.width;
    const h = imageData.height;
    const data = imageData.data;
    const totalPixels = w * h;

    // Ensure visited array is large enough
    if (!_fillVisited || _fillVisited.length < totalPixels) {
      _fillVisited = new Uint8Array(totalPixels);
    }
    _fillVisited.fill(0);

    // Target color at click position
    const targetIdx = (docY * w + docX) * 4;
    const tR = data[targetIdx];
    const tG = data[targetIdx + 1];
    const tB = data[targetIdx + 2];
    const tA = data[targetIdx + 3];

    const [fR, fG, fB] = hexToRgb(ctx.brush.color);

    // Don't fill if target is already the fill color
    if (tR === fR && tG === fG && tB === fB && tA === 255) return;

    // Stack-based flood fill
    // Each pixel can push at most 4 neighbours (2 values each), but the
    // visited bitmap prevents re-queuing, so 2× totalPixels is a safe cap.
    const stack: number[] = [docX, docY];
    const maxStackSize = totalPixels * 2;

    while (stack.length > 0) {
      if (stack.length > maxStackSize) break;
      const cy = stack.pop()!;
      const cx = stack.pop()!;
      const ci = cy * w + cx;

      if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
      if (_fillVisited[ci]) continue;
      _fillVisited[ci] = 1;

      const bi = ci * 4;
      if (data[bi] !== tR || data[bi + 1] !== tG || data[bi + 2] !== tB || data[bi + 3] !== tA) {
        continue;
      }

      data[bi] = fR;
      data[bi + 1] = fG;
      data[bi + 2] = fB;
      data[bi + 3] = 255;

      stack.push(cx - 1, cy);
      stack.push(cx + 1, cy);
      stack.push(cx, cy - 1);
      stack.push(cx, cy + 1);
    }
  },

  onMove(): void {},
  onUp(): void {},
};

// ── Select Tool ────────────────────────────────────────────────

let _selectAnchorX = 0;
let _selectAnchorY = 0;

export const selectTool: Tool = {
  type: 3 as ToolType,
  cursor: "crosshair",

  onDown(info: PointerInfo, ctx: ToolContext): void {
    _selectAnchorX = Math.floor(info.docX);
    _selectAnchorY = Math.floor(info.docY);
    ctx.onSelectionChange(null);
  },

  onMove(info: PointerInfo, ctx: ToolContext): void {
    const docX = Math.floor(info.docX);
    const docY = Math.floor(info.docY);

    const x = Math.min(_selectAnchorX, docX);
    const y = Math.min(_selectAnchorY, docY);
    const w = Math.abs(docX - _selectAnchorX);
    const h = Math.abs(docY - _selectAnchorY);

    // Draw selection rectangle on draft canvas
    const { draftCtx, camera } = ctx;
    draftCtx.clearRect(0, 0, draftCtx.canvas.width, draftCtx.canvas.height);

    const sx = (x - camera.x) * camera.zoom;
    const sy = (y - camera.y) * camera.zoom;
    const sw = w * camera.zoom;
    const sh = h * camera.zoom;

    draftCtx.strokeStyle = "rgba(85,187,153,0.8)";
    draftCtx.lineWidth = 1;
    draftCtx.setLineDash([4, 4]);
    draftCtx.strokeRect(sx + 0.5, sy + 0.5, sw, sh);
    draftCtx.setLineDash([]);

    // Semi-transparent fill
    draftCtx.fillStyle = "rgba(85,187,153,0.1)";
    draftCtx.fillRect(sx, sy, sw, sh);

    ctx.onSelectionChange({ x, y, w, h });
  },

  onUp(info: PointerInfo, ctx: ToolContext): void {
    const docX = Math.floor(info.docX);
    const docY = Math.floor(info.docY);
    const x = Math.min(_selectAnchorX, docX);
    const y = Math.min(_selectAnchorY, docY);
    const w = Math.abs(docX - _selectAnchorX);
    const h = Math.abs(docY - _selectAnchorY);

    if (w > 0 && h > 0) {
      ctx.onSelectionChange({ x, y, w, h });
    } else {
      ctx.onSelectionChange(null);
    }
  },
};

// ── Pipette Tool ───────────────────────────────────────────────

export const pipetteTool: Tool = {
  type: 4 as ToolType,
  cursor: "crosshair",

  onDown(info: PointerInfo, ctx: ToolContext): void {
    pickColor(info, ctx);
  },

  onMove(info: PointerInfo, ctx: ToolContext): void {
    pickColor(info, ctx);
  },

  onUp(): void {},
};

function pickColor(info: PointerInfo, ctx: ToolContext): void {
  const { imageData } = ctx;
  const docX = Math.floor(info.docX);
  const docY = Math.floor(info.docY);
  if (docX < 0 || docY < 0 || docX >= imageData.width || docY >= imageData.height) return;

  const idx = (docY * imageData.width + docX) * 4;
  const hex = rgbToHex(imageData.data[idx], imageData.data[idx + 1], imageData.data[idx + 2]);
  ctx.onColorPicked(hex);
}

// ── Entity Brush Tool ─────────────────────────────────────────

export const entityBrushTool: Tool = {
  type: 5 as ToolType,
  cursor: "crosshair",

  onDown(info: PointerInfo, ctx: ToolContext): void {
    if (!ctx.activeEntityType) return;
    const docX = Math.floor(info.docX);
    const docY = Math.floor(info.docY);
    ctx.onEntityPlace(ctx.activeEntityType, docX, docY);

    // Visual feedback: draw a small marker on the draft canvas
    const { draftCtx, camera } = ctx;
    const sx = (docX - camera.x) * camera.zoom;
    const sy = (docY - camera.y) * camera.zoom;
    const size = Math.max(4, camera.zoom);
    draftCtx.strokeStyle = "rgba(64,200,255,0.9)";
    draftCtx.lineWidth = 1;
    draftCtx.strokeRect(sx - size / 2, sy - size / 2, size, size);
    draftCtx.fillStyle = "rgba(64,200,255,0.3)";
    draftCtx.fillRect(sx - size / 2, sy - size / 2, size, size);
  },

  onMove(): void {},
  onUp(): void {},
};

// ── Clipboard operations for Select tool ──────────────────────

export interface ClipboardBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Copy pixels within the selection rectangle from imageData. */
export function copySelection(
  imageData: ImageData,
  sel: SelectionRect
): ClipboardBuffer | null {
  if (sel.w <= 0 || sel.h <= 0) return null;
  const x0 = Math.max(0, sel.x);
  const y0 = Math.max(0, sel.y);
  const x1 = Math.min(imageData.width, sel.x + sel.w);
  const y1 = Math.min(imageData.height, sel.y + sel.h);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return null;

  const data = new Uint8ClampedArray(w * h * 4);
  for (let dy = 0; dy < h; dy++) {
    const srcOff = ((y0 + dy) * imageData.width + x0) * 4;
    const dstOff = dy * w * 4;
    data.set(imageData.data.subarray(srcOff, srcOff + w * 4), dstOff);
  }
  return { data, width: w, height: h };
}

/** Clear pixels within the selection rectangle. */
export function clearSelection(
  imageData: ImageData,
  sel: SelectionRect
): void {
  const x0 = Math.max(0, sel.x);
  const y0 = Math.max(0, sel.y);
  const x1 = Math.min(imageData.width, sel.x + sel.w);
  const y1 = Math.min(imageData.height, sel.y + sel.h);
  for (let dy = y0; dy < y1; dy++) {
    const off = (dy * imageData.width + x0) * 4;
    imageData.data.fill(0, off, off + (x1 - x0) * 4);
  }
}

/** Paste clipboard buffer into imageData at the given position. */
export function pasteClipboard(
  imageData: ImageData,
  clip: ClipboardBuffer,
  destX: number,
  destY: number
): void {
  for (let dy = 0; dy < clip.height; dy++) {
    const ty = destY + dy;
    if (ty < 0 || ty >= imageData.height) continue;
    for (let dx = 0; dx < clip.width; dx++) {
      const tx = destX + dx;
      if (tx < 0 || tx >= imageData.width) continue;
      const srcOff = (dy * clip.width + dx) * 4;
      const dstOff = (ty * imageData.width + tx) * 4;
      // Only paste non-transparent pixels
      if (clip.data[srcOff + 3] > 0) {
        imageData.data[dstOff] = clip.data[srcOff];
        imageData.data[dstOff + 1] = clip.data[srcOff + 1];
        imageData.data[dstOff + 2] = clip.data[srcOff + 2];
        imageData.data[dstOff + 3] = clip.data[srcOff + 3];
      }
    }
  }
}

// ── Tool registry ──────────────────────────────────────────────

export const TOOLS: Tool[] = [drawTool, eraseTool, fillTool, selectTool, pipetteTool, entityBrushTool];

export function getToolByType(type: ToolType): Tool {
  return TOOLS[type as number] ?? drawTool;
}
