/**
 * Pixel Editor — Input Handler
 *
 * Routes pointer/wheel/keyboard events to either the camera
 * (navigation) or the active tool (drawing), based on palm
 * rejection settings and input type.
 *
 * Gesture support:
 *  - Two-finger pinch-to-zoom with midpoint panning
 *  - Scroll wheel zoom at cursor pivot
 *  - Middle-mouse / Space+drag panning
 *  - Stylus-only mode: touch → navigate, pen → draw
 */

import type { CameraState, EditorConfig, PointerInfo } from "./types.js";
import { screenToDocMut, zoomAtPoint, pan, snapZoom } from "./camera.js";

export interface InputCallbacks {
  onToolDown(info: PointerInfo): void;
  onToolMove(info: PointerInfo): void;
  onToolUp(info: PointerInfo): void;
  onCameraChange(): void;
  onAltClick(info: PointerInfo): void;
}

export interface InputHandler {
  dispose(): void;
}

/** Pre-allocated PointerInfo reused every event (zero alloc). */
const _pointerInfo: PointerInfo = {
  canvasX: 0,
  canvasY: 0,
  docX: 0,
  docY: 0,
  pressure: 0,
  tiltX: 0,
  tiltY: 0,
  pointerType: "mouse",
  button: 0,
  pointerId: 0,
};

/** Pre-allocated Vec2 for camera transforms. */
const _docPos = { x: 0, y: 0 };

function fillPointerInfo(
  e: PointerEvent,
  cam: CameraState,
  rect: DOMRect
): PointerInfo {
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  _pointerInfo.canvasX = sx;
  _pointerInfo.canvasY = sy;
  screenToDocMut(cam, sx, sy, _docPos);
  _pointerInfo.docX = _docPos.x;
  _pointerInfo.docY = _docPos.y;
  _pointerInfo.pressure = e.pressure;
  _pointerInfo.tiltX = e.tiltX;
  _pointerInfo.tiltY = e.tiltY;
  _pointerInfo.pointerType = e.pointerType;
  _pointerInfo.button = e.button;
  _pointerInfo.pointerId = e.pointerId;
  return _pointerInfo;
}

function tryRelease(el: HTMLElement, pointerId: number): void {
  try {
    el.releasePointerCapture(pointerId);
  } catch {
    // Already released or never captured
  }
}

/**
 * Attach input handlers to the event target element.
 * Returns a dispose function to remove all listeners.
 */
export function attachInputHandler(
  eventTarget: HTMLElement,
  camera: CameraState,
  config: EditorConfig,
  callbacks: InputCallbacks
): InputHandler {
  // ── Drawing state ───────────────────────────────────────────
  let isDrawing = false;
  let drawingPointerId: number | null = null;

  // ── Panning state ───────────────────────────────────────────
  let isPanning = false;
  let panPointerId: number | null = null;
  let panLastX = 0;
  let panLastY = 0;
  let spaceHeld = false;

  // ── Multi-touch (pinch/pan) state ───────────────────────────
  // Only touch-type pointers go here (pen excluded when stylusOnly)
  const touchPointers = new Map<number, { x: number; y: number }>();
  let isPinching = false;
  let pinchLastDist = 0;
  let pinchLastMidX = 0;
  let pinchLastMidY = 0;

  // ── Helpers ─────────────────────────────────────────────────

  /** Should this pointer be treated as a navigator (not a tool)? */
  function isNavigationPointer(e: PointerEvent): boolean {
    if (config.stylusOnly && e.pointerType === "touch") return true;
    if (e.button === 1) return true; // middle mouse
    if (spaceHeld) return true;
    return false;
  }

  /** Should this pointer participate in multi-touch gesture detection? */
  function isGesturePointer(e: PointerEvent): boolean {
    // In stylusOnly mode, only touch pointers form gestures
    if (config.stylusOnly) return e.pointerType === "touch";
    // Otherwise, any pointer can form gestures (touch + mouse)
    // but pen still participates in gestures when stylusOnly is off
    return e.pointerType === "touch";
  }

  /**
   * Finalize any in-progress drawing stroke.
   * Called when transitioning from drawing to a gesture.
   */
  function finalizeStroke(): void {
    if (!isDrawing || drawingPointerId === null) return;
    const rect = eventTarget.getBoundingClientRect();
    // Use the last known position (already filled from the most recent event)
    callbacks.onToolUp(_pointerInfo);
    tryRelease(eventTarget, drawingPointerId);
    isDrawing = false;
    drawingPointerId = null;
  }

  // ── Pointer events ─────────────────────────────────────────

  function onPointerDown(e: PointerEvent): void {
    const rect = eventTarget.getBoundingClientRect();
    const info = fillPointerInfo(e, camera, rect);

    // Alt+click for debug layer selection
    if (e.altKey) {
      callbacks.onAltClick(info);
      return;
    }

    // Track touch pointers for gesture detection
    if (isGesturePointer(e)) {
      touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // Two-finger gesture detection
      if (touchPointers.size >= 2) {
        // If we were drawing, finalize the stroke first
        finalizeStroke();
        // Cancel any single-finger pan
        isPanning = false;
        panPointerId = null;
        // Enter pinch mode
        startPinch();
        return;
      }
    }

    // Navigation routing (palm rejection, middle mouse, space)
    if (isNavigationPointer(e)) {
      isPanning = true;
      panPointerId = e.pointerId;
      panLastX = e.clientX;
      panLastY = e.clientY;
      eventTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // Right-click: route to tool (orchestrator checks button for pipette)
    if (e.button === 2) {
      callbacks.onToolDown(info);
      return;
    }

    // Primary button: route to tool
    if (e.button === 0) {
      isDrawing = true;
      drawingPointerId = e.pointerId;
      eventTarget.setPointerCapture(e.pointerId);
      callbacks.onToolDown(info);
    }
  }

  function onPointerMove(e: PointerEvent): void {
    const rect = eventTarget.getBoundingClientRect();
    fillPointerInfo(e, camera, rect);

    // Update touch pointer tracking
    if (touchPointers.has(e.pointerId)) {
      touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // Handle pinch-zoom + two-finger pan
    if (isPinching && touchPointers.size >= 2) {
      handlePinchMove(rect);
      return;
    }

    // Single-finger panning
    if (isPanning && e.pointerId === panPointerId) {
      const dx = e.clientX - panLastX;
      const dy = e.clientY - panLastY;
      panLastX = e.clientX;
      panLastY = e.clientY;
      pan(camera, dx, dy);
      callbacks.onCameraChange();
      return;
    }

    // Drawing
    if (isDrawing && e.pointerId === drawingPointerId) {
      callbacks.onToolMove(_pointerInfo);
    }
  }

  function onPointerUp(e: PointerEvent): void {
    // Remove from touch tracking
    touchPointers.delete(e.pointerId);

    // End pinch if fewer than 2 touch pointers remain
    if (isPinching && touchPointers.size < 2) {
      isPinching = false;
      pinchLastDist = 0;

      // Snap zoom to nearest integer for crisp pixel rendering
      snapZoom(camera);
      callbacks.onCameraChange();

      // If one touch remains, transition it to a single-finger pan
      if (touchPointers.size === 1) {
        const remaining = touchPointers.entries().next().value;
        if (remaining) {
          isPanning = true;
          panPointerId = remaining[0];
          panLastX = remaining[1].x;
          panLastY = remaining[1].y;
        }
      }
      return;
    }

    // End panning
    if (isPanning && e.pointerId === panPointerId) {
      isPanning = false;
      panPointerId = null;
      tryRelease(eventTarget, e.pointerId);
      return;
    }

    // End drawing
    if (isDrawing && e.pointerId === drawingPointerId) {
      const rect = eventTarget.getBoundingClientRect();
      fillPointerInfo(e, camera, rect);
      isDrawing = false;
      drawingPointerId = null;
      callbacks.onToolUp(_pointerInfo);
      tryRelease(eventTarget, e.pointerId);
    }
  }

  function onPointerCancel(e: PointerEvent): void {
    touchPointers.delete(e.pointerId);

    if (isPinching && touchPointers.size < 2) {
      isPinching = false;
      pinchLastDist = 0;
    }
    if (isPanning && e.pointerId === panPointerId) {
      isPanning = false;
      panPointerId = null;
    }
    if (isDrawing && e.pointerId === drawingPointerId) {
      isDrawing = false;
      drawingPointerId = null;
    }
  }

  // ── Pinch-zoom + two-finger pan ─────────────────────────────

  /**
   * Minimum distance (px) between two touch points to consider it
   * a valid pinch gesture. Avoids jittery zoom when fingers are
   * nearly touching.
   */
  const PINCH_MIN_DISTANCE = 10;

  /**
   * Smoothing factor applied to the pinch scale ratio each frame.
   * 0 = no smoothing (raw), 1 = fully damped (frozen).
   * 0.25 gives a responsive-yet-smooth feel.
   */
  const PINCH_SMOOTHING = 0.25;

  function startPinch(): void {
    const pts = Array.from(touchPointers.values());
    if (pts.length < 2) return;
    isPinching = true;
    pinchLastDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    pinchLastMidX = (pts[0].x + pts[1].x) / 2;
    pinchLastMidY = (pts[0].y + pts[1].y) / 2;
  }

  function handlePinchMove(rect: DOMRect): void {
    const pts = Array.from(touchPointers.values());
    if (pts.length < 2) return;

    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    const midX = (pts[0].x + pts[1].x) / 2;
    const midY = (pts[0].y + pts[1].y) / 2;

    // Two-finger pan: track midpoint movement
    const panDx = midX - pinchLastMidX;
    const panDy = midY - pinchLastMidY;
    if (Math.abs(panDx) > 0.5 || Math.abs(panDy) > 0.5) {
      pan(camera, panDx, panDy);
    }

    // Pinch zoom: smooth fractional scaling
    if (pinchLastDist > PINCH_MIN_DISTANCE && dist > PINCH_MIN_DISTANCE) {
      const rawScale = dist / pinchLastDist;
      // Apply exponential smoothing to dampen sensor noise
      const smoothedScale = 1 + (rawScale - 1) * (1 - PINCH_SMOOTHING);
      const newZoom = camera.zoom * smoothedScale;
      zoomAtPoint(camera, midX - rect.left, midY - rect.top, newZoom);
    }

    // Update tracking for next frame
    pinchLastDist = dist;
    pinchLastMidX = midX;
    pinchLastMidY = midY;

    callbacks.onCameraChange();
  }

  // ── Wheel zoom ─────────────────────────────────────────────

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = eventTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // deltaY < 0 = scroll up = zoom in
    const zoomDelta = e.deltaY < 0 ? 1 : -1;
    const newZoom = camera.zoom + zoomDelta;
    zoomAtPoint(camera, sx, sy, newZoom);
    callbacks.onCameraChange();
  }

  // ── Keyboard (space for pan mode) ──────────────────────────

  function onKeyDown(e: KeyboardEvent): void {
    if (e.code === "Space") {
      spaceHeld = true;
      e.preventDefault();
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (e.code === "Space") {
      spaceHeld = false;
    }
  }

  // Prevent context menu on the editor
  function onContextMenu(e: Event): void {
    e.preventDefault();
  }

  // ── Attach listeners ──────────────────────────────────────

  eventTarget.addEventListener("pointerdown", onPointerDown);
  eventTarget.addEventListener("pointermove", onPointerMove);
  eventTarget.addEventListener("pointerup", onPointerUp);
  eventTarget.addEventListener("pointercancel", onPointerCancel);
  eventTarget.addEventListener("wheel", onWheel, { passive: false });
  eventTarget.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  return {
    dispose(): void {
      eventTarget.removeEventListener("pointerdown", onPointerDown);
      eventTarget.removeEventListener("pointermove", onPointerMove);
      eventTarget.removeEventListener("pointerup", onPointerUp);
      eventTarget.removeEventListener("pointercancel", onPointerCancel);
      eventTarget.removeEventListener("wheel", onWheel);
      eventTarget.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      touchPointers.clear();
    },
  };
}
