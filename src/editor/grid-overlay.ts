/**
 * Pixel Editor — Grid & Debug Overlay Rendering
 *
 * Renders grid lines and bake-debug overlays (collision polygons,
 * Bezier paths) onto the grid overlay canvas through the virtual camera.
 */

import type { Point, BakedAsset } from "../engine/baker.js";
import type { MscSchema } from "../parser/msc.js";
import type { CameraState } from "./types.js";

export interface OverlayOptions {
  inlineGrid: boolean;
  customGrid: boolean;
  gridSize: number;
  gridMajor: number;
  showCollision: boolean;
  showPaths: boolean;
  showPoints: boolean;
  showIds: boolean;
  selectedCollisionIndex: number | null;
  selectedPathIndex: number | null;
}

/** Render all overlays onto the given context using the camera transform. */
export function renderOverlay(
  ctx: CanvasRenderingContext2D,
  cam: CameraState,
  docW: number,
  docH: number,
  baked: BakedAsset | null,
  options: OverlayOptions
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.save();
  ctx.setTransform(cam.zoom, 0, 0, cam.zoom, -cam.x * cam.zoom, -cam.y * cam.zoom);

  if (options.inlineGrid) {
    drawGridLines(ctx, docW, docH, 1, "rgba(255,255,255,0.12)", 0.5);
  }

  if (options.customGrid) {
    const step = options.gridSize;
    const majorEvery = options.gridMajor;
    drawGridLines(ctx, docW, docH, step, "rgba(255,255,255,0.12)", 0.5);
    if (majorEvery > 1) {
      drawGridLines(ctx, docW, docH, step * majorEvery, "rgba(255,255,255,0.50)", 1);
    }
  }

  // Draw document boundary rectangle
  drawDocumentBorder(ctx, docW, docH);

  if (baked) {
    renderBakeDebugOverlay(ctx, baked, options);
  }

  ctx.restore();
}

function renderBakeDebugOverlay(
  ctx: CanvasRenderingContext2D,
  baked: BakedAsset,
  options: OverlayOptions
): void {
  const { selectedCollisionIndex, selectedPathIndex, showPoints, showIds } = options;

  if (options.showCollision) {
    baked.collisionPolygons.forEach((polygon, index) => {
      const isSelected = selectedCollisionIndex === index;
      const stroke =
        selectedCollisionIndex === null || isSelected
          ? "rgba(64,255,140,0.95)"
          : "rgba(64,255,140,0.35)";
      drawPolyline(ctx, polygon, stroke, true);
      if (showPoints) {
        drawPoints(ctx, polygon, stroke, isSelected ? 2 : 1);
      }
      if (showIds) {
        const anchor = polygonCentroid(polygon);
        drawOverlayLabel(ctx, `C${index}`, anchor.x, anchor.y, stroke, isSelected);
      }
    });
  }

  if (options.showPaths) {
    baked.bezierPaths.forEach((path, index) => {
      const isSelected = selectedPathIndex === index;
      const stroke =
        selectedPathIndex === null || isSelected
          ? "rgba(255,190,64,0.95)"
          : "rgba(255,190,64,0.35)";
      drawPolyline(ctx, path, stroke, false);
      if (showPoints) {
        drawPoints(ctx, path, stroke, isSelected ? 2 : 1);
      }
      if (showIds && path.length > 0) {
        drawOverlayLabel(ctx, `P${index}`, path[0].x, path[0].y, stroke, isSelected);
      }
    });
  }
}

function drawGridLines(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  step: number,
  stroke: string,
  screenLineWidth = 1
): void {
  if (step <= 0) return;
  const scaleA = ctx.getTransform().a || 1;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = screenLineWidth / scaleA;
  ctx.beginPath();
  for (let x = step; x < width; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = step; y < height; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
}

function drawDocumentBorder(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  const scaleA = ctx.getTransform().a || 1;
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 1.5 / scaleA;
  ctx.strokeRect(0, 0, width, height);
}

function drawPolyline(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  stroke: string,
  closePath: boolean
): void {
  if (points.length < 2) return;
  const scaleA = ctx.getTransform().a || 1;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1 / scaleA;
  ctx.beginPath();
  ctx.moveTo(points[0].x + 0.5, points[0].y + 0.5);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x + 0.5, points[i].y + 0.5);
  }
  if (closePath) ctx.closePath();
  ctx.stroke();
}

function drawPoints(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  fill: string,
  radius = 1
): void {
  ctx.fillStyle = fill;
  const scaleA = ctx.getTransform().a || 1;
  const invScale = 1 / scaleA;
  const size = (radius * 2 + 1) * invScale;
  for (const point of points) {
    ctx.fillRect(
      point.x - radius * invScale,
      point.y - radius * invScale,
      size,
      size
    );
  }
}

function drawOverlayLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  strong = false
): void {
  ctx.save();
  const scaleA = ctx.getTransform().a || 1;
  const invScale = 1 / scaleA;
  const fontSize = (strong ? 7 : 6) * invScale;
  ctx.font = `${fontSize}px monospace`;
  ctx.fillStyle = color;
  ctx.fillText(text, x + invScale, y - invScale);
  ctx.restore();
}

export function polygonCentroid(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  let sumX = 0;
  let sumY = 0;
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
  }
  return { x: sumX / points.length, y: sumY / points.length };
}

/**
 * Find the nearest debug layer (collision or path) to a document-space point.
 * Returns the type and index, or null if nothing is close enough.
 */
export function selectDebugLayer(
  docX: number,
  docY: number,
  baked: BakedAsset,
  options: OverlayOptions
): { type: "collision" | "path"; index: number } | null {
  const point: Point = { x: docX, y: docY };
  let bestType: "collision" | "path" | null = null;
  let bestIndex = -1;
  let bestDistance = Infinity;

  if (options.showCollision) {
    baked.collisionPolygons.forEach((polygon, index) => {
      const distance = distanceToPolyline(point, polygon, true);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestType = "collision";
        bestIndex = index;
      }
    });
  }

  if (options.showPaths) {
    baked.bezierPaths.forEach((path, index) => {
      const distance = distanceToPolyline(path.length > 0 ? point : point, path, false);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestType = "path";
        bestIndex = index;
      }
    });
  }

  const threshold = 3.2;
  if (bestType && bestDistance <= threshold) {
    return { type: bestType, index: bestIndex };
  }
  return null;
}

export function distanceToPolyline(
  point: Point,
  polyline: Point[],
  closePath: boolean
): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1) {
    return Math.hypot(point.x - polyline[0].x, point.y - polyline[0].y);
  }

  let minDistance = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const dist = pointToSegmentDistance(point, polyline[i], polyline[i + 1]);
    if (dist < minDistance) minDistance = dist;
  }

  if (closePath) {
    const tail = pointToSegmentDistance(point, polyline[polyline.length - 1], polyline[0]);
    if (tail < minDistance) minDistance = tail;
  }

  return minDistance;
}

export function pointToSegmentDistance(point: Point, a: Point, b: Point): number {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const apX = point.x - a.x;
  const apY = point.y - a.y;
  const abLenSq = abX * abX + abY * abY;

  if (abLenSq === 0) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }

  const t = Math.max(0, Math.min(1, (apX * abX + apY * abY) / abLenSq));
  const projX = a.x + abX * t;
  const projY = a.y + abY * t;
  return Math.hypot(point.x - projX, point.y - projY);
}

// ── State Inspector ───────────────────────────────────────────

/**
 * Translate a document pixel to a human-readable label for the state inspector.
 *
 * If the pixel's byte address matches the start of a schema variable, the
 * variable name and current value are returned (e.g. "$PlayerX: 42").
 * Otherwise the raw RGBA bytes are returned (e.g. "Pixel 3,7 = RGBA(255,0,0,255)").
 *
 * @param docX  Document-space X coordinate (integer pixel)
 * @param docY  Document-space Y coordinate (integer pixel)
 * @param bufferWidth  Width of the state buffer in pixels (usually 64)
 * @param buffer  The engine state buffer (Uint8ClampedArray, RGBA layout)
 * @param schema  Optional MSC schema for named variable lookup
 */
export function inspectPixelAt(
  docX: number,
  docY: number,
  bufferWidth: number,
  buffer: Uint8ClampedArray,
  schema?: MscSchema
): string {
  const byteAddr = (docY * bufferWidth + docX) * 4;
  if (byteAddr < 0 || byteAddr + 3 >= buffer.length) {
    return `Pixel ${docX},${docY}`;
  }

  if (schema) {
    for (const [name, entry] of Object.entries(schema)) {
      if (entry.addr !== byteAddr) continue;
      let value: number;
      switch (entry.type) {
        case "Int8":
          value = buffer[byteAddr];
          break;
        case "Int16":
          value = (buffer[byteAddr] << 8) | buffer[byteAddr + 1];
          break;
        default: // Int32 — read all 4 bytes (big-endian unsigned)
          value =
            (((buffer[byteAddr] << 24) |
              (buffer[byteAddr + 1] << 16) |
              (buffer[byteAddr + 2] << 8) |
              buffer[byteAddr + 3]) >>>
              0);
      }
      return `${name}: ${value}`;
    }
  }

  const r = buffer[byteAddr];
  const g = buffer[byteAddr + 1];
  const b = buffer[byteAddr + 2];
  const a = buffer[byteAddr + 3];
  return `Pixel ${docX},${docY} = RGBA(${r}, ${g}, ${b}, ${a})`;
}
