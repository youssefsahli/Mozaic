/**
 * Pixel Editor — Virtual Camera
 *
 * Pure functions for viewport transforms. All operate on a mutable
 * CameraState object — zero allocation per call.
 *
 * ## Zoom Behaviour
 *
 * Zoom values are fractional during gestures (pinch-to-zoom) for
 * smooth visual feedback, and may be snapped to integers on gesture
 * end via {@link snapZoom}. The valid range is {@link MIN_ZOOM} to
 * {@link MAX_ZOOM}.
 */

import type { CameraState, Vec2 } from "./types.js";

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 64;

/** Convert screen (viewport) coordinates to document pixel coordinates. */
export function screenToDoc(cam: CameraState, sx: number, sy: number): Vec2 {
  return {
    x: sx / cam.zoom + cam.x,
    y: sy / cam.zoom + cam.y,
  };
}

/**
 * Convert screen coordinates to document pixel coordinates.
 * Writes into an existing Vec2 to avoid allocation.
 */
export function screenToDocMut(cam: CameraState, sx: number, sy: number, out: Vec2): void {
  out.x = sx / cam.zoom + cam.x;
  out.y = sy / cam.zoom + cam.y;
}

/** Convert document pixel coordinates to screen (viewport) coordinates. */
export function docToScreen(cam: CameraState, dx: number, dy: number): Vec2 {
  return {
    x: (dx - cam.x) * cam.zoom,
    y: (dy - cam.y) * cam.zoom,
  };
}

/**
 * Zoom the camera so the document point under (pivotSX, pivotSY)
 * remains at the same screen position.
 */
export function zoomAtPoint(
  cam: CameraState,
  pivotSX: number,
  pivotSY: number,
  newZoom: number
): void {
  const clamped = clampZoom(newZoom);
  // Document position under the pivot before zoom
  const docX = pivotSX / cam.zoom + cam.x;
  const docY = pivotSY / cam.zoom + cam.y;
  // After zoom, adjust cam so the same doc point maps to the same screen pos
  cam.x = docX - pivotSX / clamped;
  cam.y = docY - pivotSY / clamped;
  cam.zoom = clamped;
}

/** Pan the camera by screen-space delta. */
export function pan(cam: CameraState, deltaScreenX: number, deltaScreenY: number): void {
  cam.x -= deltaScreenX / cam.zoom;
  cam.y -= deltaScreenY / cam.zoom;
}

/** Set zoom clamped to valid range. Does NOT adjust centering. */
export function setZoom(cam: CameraState, newZoom: number): void {
  cam.zoom = clampZoom(newZoom);
}

/** Center the camera on a document region. */
export function centerOn(
  cam: CameraState,
  docX: number,
  docY: number,
  docW: number,
  docH: number,
  viewportW: number,
  viewportH: number
): void {
  const fitZoom = Math.min(viewportW / docW, viewportH / docH);
  cam.zoom = clampZoom(Math.floor(fitZoom));
  cam.x = docX + docW / 2 - viewportW / (2 * cam.zoom);
  cam.y = docY + docH / 2 - viewportH / (2 * cam.zoom);
}

/** Create a default camera centered on a document. */
export function createCamera(
  docW: number,
  docH: number,
  viewportW: number,
  viewportH: number
): CameraState {
  const cam: CameraState = { x: 0, y: 0, zoom: 8 };
  centerOn(cam, 0, 0, docW, docH, viewportW, viewportH);
  return cam;
}

/** Clamp zoom to the valid range, guarding against NaN / Infinity. */
export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Round zoom to the nearest integer (post-gesture snap). */
export function snapZoom(cam: CameraState): void {
  cam.zoom = clampZoom(Math.round(cam.zoom));
}
