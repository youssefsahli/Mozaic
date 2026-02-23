import { describe, it, expect } from "vitest";
import {
  screenToDoc,
  screenToDocMut,
  docToScreen,
  zoomAtPoint,
  pan,
  setZoom,
  centerOn,
  createCamera,
  clampZoom,
  snapZoom,
  MIN_ZOOM,
  MAX_ZOOM,
} from "../editor/camera.js";
import type { CameraState, Vec2 } from "../editor/types.js";

// ── clampZoom ──────────────────────────────────────────────────

describe("clampZoom", () => {
  it("returns value within range untouched", () => {
    expect(clampZoom(8)).toBe(8);
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(64)).toBe(64);
  });

  it("clamps fractional values within range", () => {
    expect(clampZoom(4.5)).toBe(4.5);
    expect(clampZoom(0.5)).toBe(MIN_ZOOM);
    expect(clampZoom(65.5)).toBe(MAX_ZOOM);
  });

  it("clamps below minimum", () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(-5)).toBe(MIN_ZOOM);
  });

  it("clamps above maximum", () => {
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(999)).toBe(MAX_ZOOM);
  });

  it("handles NaN and Infinity", () => {
    expect(clampZoom(NaN)).toBe(MIN_ZOOM);
    expect(clampZoom(Infinity)).toBe(MIN_ZOOM);
    expect(clampZoom(-Infinity)).toBe(MIN_ZOOM);
  });
});

// ── snapZoom ───────────────────────────────────────────────────

describe("snapZoom", () => {
  it("rounds fractional zoom to nearest integer", () => {
    const cam: CameraState = { x: 0, y: 0, zoom: 4.3 };
    snapZoom(cam);
    expect(cam.zoom).toBe(4);
  });

  it("rounds up when fractional part >= 0.5", () => {
    const cam: CameraState = { x: 0, y: 0, zoom: 4.7 };
    snapZoom(cam);
    expect(cam.zoom).toBe(5);
  });

  it("clamps after rounding", () => {
    const cam: CameraState = { x: 0, y: 0, zoom: 0.4 };
    snapZoom(cam);
    expect(cam.zoom).toBe(MIN_ZOOM);
  });
});

// ── screenToDoc / screenToDocMut ───────────────────────────────

describe("screenToDoc", () => {
  it("converts screen to doc at zoom 1, origin 0", () => {
    const cam: CameraState = { x: 0, y: 0, zoom: 1 };
    const result = screenToDoc(cam, 10, 20);
    expect(result.x).toBe(10);
    expect(result.y).toBe(20);
  });

  it("accounts for zoom", () => {
    const cam: CameraState = { x: 0, y: 0, zoom: 8 };
    const result = screenToDoc(cam, 80, 160);
    expect(result.x).toBe(10);
    expect(result.y).toBe(20);
  });

  it("accounts for camera offset", () => {
    const cam: CameraState = { x: 5, y: 10, zoom: 4 };
    const result = screenToDoc(cam, 40, 40);
    expect(result.x).toBe(15);
    expect(result.y).toBe(20);
  });
});

describe("screenToDocMut", () => {
  it("writes into existing Vec2 without allocation", () => {
    const cam: CameraState = { x: 0, y: 0, zoom: 2 };
    const out: Vec2 = { x: 0, y: 0 };
    screenToDocMut(cam, 20, 40, out);
    expect(out.x).toBe(10);
    expect(out.y).toBe(20);
  });
});

// ── docToScreen ────────────────────────────────────────────────

describe("docToScreen", () => {
  it("converts doc to screen at zoom 1, origin 0", () => {
    const cam: CameraState = { x: 0, y: 0, zoom: 1 };
    const result = docToScreen(cam, 10, 20);
    expect(result.x).toBe(10);
    expect(result.y).toBe(20);
  });

  it("accounts for zoom", () => {
    const cam: CameraState = { x: 0, y: 0, zoom: 8 };
    const result = docToScreen(cam, 10, 20);
    expect(result.x).toBe(80);
    expect(result.y).toBe(160);
  });
});

// ── zoomAtPoint ────────────────────────────────────────────────

describe("zoomAtPoint", () => {
  it("preserves the document point under the pivot", () => {
    const cam: CameraState = { x: 0, y: 0, zoom: 4 };
    // Before zoom: screen (40,40) => doc (10, 10)
    const docBefore = screenToDoc(cam, 40, 40);
    zoomAtPoint(cam, 40, 40, 8);
    const docAfter = screenToDoc(cam, 40, 40);

    expect(docAfter.x).toBeCloseTo(docBefore.x, 10);
    expect(docAfter.y).toBeCloseTo(docBefore.y, 10);
  });

  it("clamps zoom to valid range", () => {
    const cam: CameraState = { x: 0, y: 0, zoom: 4 };
    zoomAtPoint(cam, 0, 0, 200);
    expect(cam.zoom).toBe(MAX_ZOOM);

    zoomAtPoint(cam, 0, 0, -5);
    expect(cam.zoom).toBe(MIN_ZOOM);
  });

  it("supports fractional zoom values (for pinch-zoom)", () => {
    const cam: CameraState = { x: 0, y: 0, zoom: 4 };
    zoomAtPoint(cam, 100, 100, 6.5);
    expect(cam.zoom).toBe(6.5);
  });
});

// ── pan ────────────────────────────────────────────────────────

describe("pan", () => {
  it("moves camera by screen delta divided by zoom", () => {
    const cam: CameraState = { x: 10, y: 10, zoom: 4 };
    pan(cam, 40, 20);
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(5);
  });

  it("handles negative deltas", () => {
    const cam: CameraState = { x: 0, y: 0, zoom: 2 };
    pan(cam, -20, -10);
    expect(cam.x).toBe(10);
    expect(cam.y).toBe(5);
  });
});

// ── setZoom ────────────────────────────────────────────────────

describe("setZoom", () => {
  it("sets zoom with clamping", () => {
    const cam: CameraState = { x: 0, y: 0, zoom: 1 };
    setZoom(cam, 32);
    expect(cam.zoom).toBe(32);
  });

  it("clamps out-of-range values", () => {
    const cam: CameraState = { x: 0, y: 0, zoom: 8 };
    setZoom(cam, 0);
    expect(cam.zoom).toBe(MIN_ZOOM);
    setZoom(cam, 100);
    expect(cam.zoom).toBe(MAX_ZOOM);
  });
});

// ── centerOn ───────────────────────────────────────────────────

describe("centerOn", () => {
  it("centers camera on a document region", () => {
    const cam: CameraState = { x: 0, y: 0, zoom: 1 };
    centerOn(cam, 0, 0, 64, 64, 512, 512);
    // fitZoom = floor(min(512/64, 512/64)) = 8
    expect(cam.zoom).toBe(8);
  });
});

// ── createCamera ───────────────────────────────────────────────

describe("createCamera", () => {
  it("returns a camera with valid zoom", () => {
    const cam = createCamera(64, 64, 512, 512);
    expect(cam.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
    expect(cam.zoom).toBeLessThanOrEqual(MAX_ZOOM);
  });
});
