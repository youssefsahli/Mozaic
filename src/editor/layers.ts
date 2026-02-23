/**
 * Pixel Editor — Multi-Canvas Layer Manager
 *
 * Manages the 4-layer canvas stack:
 *   1. Background  (checkerboard)
 *   2. Document    (pixel data via camera transform)
 *   3. Draft       (stroke-in-progress)
 *   4. Grid/Debug  (overlay, existing #pixel-grid-overlay)
 */

import type { CameraState } from "./types.js";

export interface LayerStack {
  container: HTMLElement;
  bgCanvas: HTMLCanvasElement;
  bgCtx: CanvasRenderingContext2D;
  docCanvas: HTMLCanvasElement;
  docCtx: CanvasRenderingContext2D;
  draftCanvas: HTMLCanvasElement;
  draftCtx: CanvasRenderingContext2D;
  gridCanvas: HTMLCanvasElement;
  gridCtx: CanvasRenderingContext2D;
  /** Offscreen 1:1 document buffer for camera-transformed rendering. */
  offscreen: HTMLCanvasElement;
  offscreenCtx: CanvasRenderingContext2D;
  /** Pre-computed checkerboard pattern. */
  checkerPattern: CanvasPattern | null;
  /** Bitmap tracking erased pixels during a draft stroke. */
  eraseBitmap: Uint8Array;
  /** Document dimensions for the erase bitmap. */
  eraseBitmapW: number;
  eraseBitmapH: number;
  width: number;
  height: number;
}

const CHECKER_SIZE = 8;
const CHECKER_LIGHT = "#1a1a1a";
const CHECKER_DARK = "#111111";

/**
 * Initialize the multi-canvas layer stack inside the given container.
 * The container should be `#pixel-stage`. Existing canvases
 * (`#pixel-editor` and `#pixel-grid-overlay`) are reused.
 */
export function initLayers(
  container: HTMLElement,
  docCanvas: HTMLCanvasElement,
  gridCanvas: HTMLCanvasElement,
  imageData: ImageData
): LayerStack {
  const w = container.clientWidth || 256;
  const h = container.clientHeight || 256;

  // Background layer
  const bgCanvas = document.createElement("canvas");
  bgCanvas.id = "pixel-bg-layer";
  bgCanvas.width = w;
  bgCanvas.height = h;
  bgCanvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
  container.insertBefore(bgCanvas, container.firstChild);

  // Draft layer
  const draftCanvas = document.createElement("canvas");
  draftCanvas.id = "pixel-draft-layer";
  draftCanvas.width = w;
  draftCanvas.height = h;
  draftCanvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  // Insert draft after doc, before grid
  container.insertBefore(draftCanvas, gridCanvas);

  // Configure existing canvases for absolute positioning
  docCanvas.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;image-rendering:pixelated;";
  gridCanvas.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;image-rendering:pixelated;";

  // Offscreen 1:1 document buffer
  const offscreen = document.createElement("canvas");
  offscreen.width = imageData.width;
  offscreen.height = imageData.height;
  const offscreenCtx = offscreen.getContext("2d")!;
  offscreenCtx.imageSmoothingEnabled = false;

  // Build checkerboard pattern
  const checkerPattern = buildCheckerPattern(bgCanvas);

  const layers: LayerStack = {
    container,
    bgCanvas,
    bgCtx: bgCanvas.getContext("2d")!,
    docCanvas,
    docCtx: docCanvas.getContext("2d")!,
    draftCanvas,
    draftCtx: draftCanvas.getContext("2d")!,
    gridCanvas,
    gridCtx: gridCanvas.getContext("2d")!,
    offscreen,
    offscreenCtx,
    checkerPattern,
    eraseBitmap: new Uint8Array(imageData.width * imageData.height),
    eraseBitmapW: imageData.width,
    eraseBitmapH: imageData.height,
    width: w,
    height: h,
  };

  docCanvas.width = w;
  docCanvas.height = h;
  gridCanvas.width = w;
  gridCanvas.height = h;

  layers.docCtx.imageSmoothingEnabled = false;

  return layers;
}

/** Resize all layer canvases to match the container. */
export function resizeLayers(layers: LayerStack): void {
  const w = layers.container.clientWidth || 256;
  const h = layers.container.clientHeight || 256;
  if (w === layers.width && h === layers.height) return;

  layers.width = w;
  layers.height = h;

  for (const canvas of [layers.bgCanvas, layers.docCanvas, layers.draftCanvas, layers.gridCanvas]) {
    canvas.width = w;
    canvas.height = h;
  }

  layers.docCtx.imageSmoothingEnabled = false;
}

/** Update the offscreen buffer when imageData changes externally. */
export function updateOffscreen(layers: LayerStack, imageData: ImageData): void {
  if (layers.offscreen.width !== imageData.width || layers.offscreen.height !== imageData.height) {
    layers.offscreen.width = imageData.width;
    layers.offscreen.height = imageData.height;
    layers.offscreenCtx.imageSmoothingEnabled = false;
    layers.eraseBitmap = new Uint8Array(imageData.width * imageData.height);
    layers.eraseBitmapW = imageData.width;
    layers.eraseBitmapH = imageData.height;
  }
  layers.offscreenCtx.putImageData(imageData, 0, 0);
}

/** Render the checkerboard background through the camera transform. */
export function renderBackground(layers: LayerStack, cam: CameraState): void {
  const { bgCtx, width, height, checkerPattern } = layers;
  bgCtx.clearRect(0, 0, width, height);
  if (!checkerPattern) return;
  const zoom = cam.zoom || 1;

  bgCtx.save();
  bgCtx.setTransform(zoom, 0, 0, zoom, -cam.x * zoom, -cam.y * zoom);
  bgCtx.fillStyle = checkerPattern;
  // Fill enough area to cover the viewport in document space
  const docLeft = cam.x - 1;
  const docTop = cam.y - 1;
  const docW = width / zoom + 2;
  const docH = height / zoom + 2;
  bgCtx.fillRect(docLeft, docTop, docW, docH);
  bgCtx.restore();
}

/** Render the document pixels through the camera transform. */
export function renderDocument(layers: LayerStack, cam: CameraState, imageData: ImageData): void {
  const { docCtx, offscreen, offscreenCtx, width, height } = layers;

  // Update offscreen with current imageData
  offscreenCtx.putImageData(imageData, 0, 0);

  docCtx.clearRect(0, 0, width, height);
  docCtx.save();
  docCtx.imageSmoothingEnabled = false;
  docCtx.setTransform(cam.zoom, 0, 0, cam.zoom, -cam.x * cam.zoom, -cam.y * cam.zoom);
  docCtx.drawImage(offscreen, 0, 0);
  docCtx.restore();
}

/** Clear the draft canvas. */
export function clearDraft(layers: LayerStack): void {
  layers.draftCtx.clearRect(0, 0, layers.width, layers.height);
  layers.eraseBitmap.fill(0);
}

/**
 * Merge draft layer pixels into the document ImageData.
 * Iterates over document pixels, forward-maps to screen coordinates
 * (matching stampBrush), and reads from the draft canvas.
 * Also applies erase bitmap. Clears the draft afterwards.
 */
export function mergeDraftToDocument(layers: LayerStack, imageData: ImageData): boolean {
  const { draftCtx, width, height, eraseBitmap, eraseBitmapW, eraseBitmapH } = layers;
  const draftData = draftCtx.getImageData(0, 0, width, height);
  const cam = getCamFromTransform(layers);
  let changed = false;

  const docW = imageData.width;
  const docH = imageData.height;

  // Iterate document pixels and forward-map to screen coordinates.
  // This uses the same transform as stampBrush, avoiding rounding errors
  // from inverse mapping that caused strokes to widen on commit.
  for (let docY = 0; docY < docH; docY++) {
    for (let docX = 0; docX < docW; docX++) {
      const sx = Math.floor((docX - cam.x) * cam.zoom);
      const sy = Math.floor((docY - cam.y) * cam.zoom);
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;

      const di = (sy * width + sx) * 4;
      if (draftData.data[di + 3] === 0) continue;

      const oi = (docY * docW + docX) * 4;
      imageData.data[oi] = draftData.data[di];
      imageData.data[oi + 1] = draftData.data[di + 1];
      imageData.data[oi + 2] = draftData.data[di + 2];
      imageData.data[oi + 3] = draftData.data[di + 3];
      changed = true;
    }
  }

  // Apply erase bitmap
  for (let i = 0; i < eraseBitmapW * eraseBitmapH; i++) {
    if (eraseBitmap[i]) {
      const oi = i * 4;
      if (oi + 3 < imageData.data.length) {
        imageData.data[oi] = 0;
        imageData.data[oi + 1] = 0;
        imageData.data[oi + 2] = 0;
        imageData.data[oi + 3] = 0;
        changed = true;
      }
    }
  }

  clearDraft(layers);
  return changed;
}

/** Store camera ref for merge (set externally by orchestrator). */
let _mergeCamera: CameraState = { x: 0, y: 0, zoom: 1 };

export function setMergeCamera(cam: CameraState): void {
  _mergeCamera = cam;
}

function getCamFromTransform(_layers: LayerStack): CameraState {
  return _mergeCamera;
}

function buildCheckerPattern(canvas: HTMLCanvasElement): CanvasPattern | null {
  const tile = document.createElement("canvas");
  tile.width = CHECKER_SIZE * 2;
  tile.height = CHECKER_SIZE * 2;
  const ctx = tile.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = CHECKER_LIGHT;
  ctx.fillRect(0, 0, CHECKER_SIZE * 2, CHECKER_SIZE * 2);
  ctx.fillStyle = CHECKER_DARK;
  ctx.fillRect(0, 0, CHECKER_SIZE, CHECKER_SIZE);
  ctx.fillRect(CHECKER_SIZE, CHECKER_SIZE, CHECKER_SIZE, CHECKER_SIZE);

  const bgCtx = canvas.getContext("2d");
  return bgCtx?.createPattern(tile, "repeat") ?? null;
}

/** Dispose dynamically created canvases. */
export function disposeLayers(layers: LayerStack): void {
  layers.bgCanvas.remove();
  layers.draftCanvas.remove();
}
