import { describe, it, expect, vi } from "vitest";
import { inspectPixelAt, polygonCentroid, pointToSegmentDistance, distanceToPolyline, renderOverlay, type OverlayOptions } from "../editor/grid-overlay.js";
import type { MscSchema } from "../parser/msc.js";
import type { CameraState } from "../editor/types.js";

function makeBuffer(pixels: Array<[number, number, number, number]>): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b, a], i) => {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = a;
  });
  return buf;
}

describe("inspectPixelAt", () => {
  it("returns RGBA string when no schema is provided", () => {
    const buf = makeBuffer([[255, 0, 128, 255]]);
    const result = inspectPixelAt(0, 0, 1, buf);
    expect(result).toBe("Pixel 0,0 = RGBA(255, 0, 128, 255)");
  });

  it("returns RGBA string when no schema variable matches", () => {
    const buf = makeBuffer([[10, 20, 30, 255]]);
    const schema: MscSchema = { $HP: { addr: 4, type: "Int8" } };
    const result = inspectPixelAt(0, 0, 1, buf, schema);
    expect(result).toBe("Pixel 0,0 = RGBA(10, 20, 30, 255)");
  });

  it("shows schema variable name and Int8 value when address matches", () => {
    const buf = makeBuffer([
      [0, 0, 0, 0],   // pixel 0 (byte 0)
      [42, 0, 0, 0],  // pixel 1 (byte 4) — $HP starts here
    ]);
    const schema: MscSchema = { $HP: { addr: 4, type: "Int8" } };
    const result = inspectPixelAt(1, 0, 2, buf, schema);
    expect(result).toBe("$HP: 42");
  });

  it("shows Int16 value (two-byte read)", () => {
    // Int16 value 0x0102 = 258 stored at byte 0
    const buf = makeBuffer([[1, 2, 0, 0]]);
    const schema: MscSchema = { $Score: { addr: 0, type: "Int16" } };
    const result = inspectPixelAt(0, 0, 1, buf, schema);
    expect(result).toBe("$Score: 258");
  });

  it("returns safe fallback for out-of-bounds pixel", () => {
    const buf = makeBuffer([[0, 0, 0, 0]]);
    // docX=5 is beyond the 1-pixel-wide, 1-pixel-tall buffer
    const result = inspectPixelAt(5, 0, 1, buf);
    expect(result).toBe("Pixel 5,0");
  });
});

describe("polygonCentroid", () => {
  it("returns origin for empty polygon", () => {
    expect(polygonCentroid([])).toEqual({ x: 0, y: 0 });
  });

  it("returns the point for a single-point polygon", () => {
    expect(polygonCentroid([{ x: 5, y: 10 }])).toEqual({ x: 5, y: 10 });
  });
});

describe("pointToSegmentDistance", () => {
  it("handles zero-length segment (coincident endpoints)", () => {
    const dist = pointToSegmentDistance({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(dist).toBe(5);
  });
});

describe("distanceToPolyline", () => {
  it("returns Infinity for empty polyline", () => {
    expect(distanceToPolyline({ x: 0, y: 0 }, [], false)).toBe(Infinity);
  });

  it("returns distance for single-point polyline", () => {
    expect(distanceToPolyline({ x: 3, y: 4 }, [{ x: 0, y: 0 }], false)).toBe(5);
  });
});

// ── ECS overlay tests ──────────────────────────────────────
function mockCtx(): CanvasRenderingContext2D {
  const ctx: any = {
    canvas: { width: 256, height: 256 },
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    getTransform: vi.fn(() => ({ a: 1 })),
    strokeStyle: "",
    lineWidth: 0,
    fillStyle: "",
    font: "",
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    closePath: vi.fn(),
  };
  return ctx as CanvasRenderingContext2D;
}

function defaultOptions(overrides: Partial<OverlayOptions> = {}): OverlayOptions {
  return {
    inlineGrid: false,
    customGrid: false,
    gridSize: 8,
    gridMajor: 4,
    showCollision: false,
    showPaths: false,
    showPoints: false,
    showIds: false,
    showEcs: false,
    selectedCollisionIndex: null,
    selectedPathIndex: null,
    ...overrides,
  };
}

describe("renderOverlay ECS debug", () => {
  it("draws bounding boxes for active entities when showEcs is true", () => {
    const ctx = mockCtx();
    const cam: CameraState = { x: 0, y: 0, zoom: 1 };
    // Create a buffer large enough for the entity pool (at least 12288 bytes)
    const buf = new Uint8ClampedArray(12288);
    // Place an active entity at ptr=512 (first entity slot)
    buf[512 + 0] = 1;  // ActiveFlag = 1
    buf[512 + 1] = 5;  // TypeID = 5
    buf[512 + 2] = 0;  // PosX high byte (big-endian)
    buf[512 + 3] = 10; // PosX low byte → PosX = 10
    buf[512 + 4] = 0;  // PosY high byte (big-endian)
    buf[512 + 5] = 20; // PosY low byte → PosY = 20

    renderOverlay(ctx, cam, 64, 64, null, defaultOptions({ showEcs: true }), buf);

    expect(ctx.strokeRect).toHaveBeenCalledWith(10, 20, 16, 16);
    expect(ctx.fillText).toHaveBeenCalledWith("ID: 5", 10, 18);
  });

  it("skips inactive entities (ActiveFlag === 0)", () => {
    const ctx = mockCtx();
    const cam: CameraState = { x: 0, y: 0, zoom: 1 };
    const buf = new Uint8ClampedArray(12288);
    // All zeros — inactive entity at ptr=512
    buf[512 + 0] = 0;

    renderOverlay(ctx, cam, 64, 64, null, defaultOptions({ showEcs: true }), buf);

    // strokeRect is called once for the document border, but not for any entity
    expect(ctx.strokeRect).toHaveBeenCalledTimes(1); // only document border
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it("does not draw ECS boxes when showEcs is false", () => {
    const ctx = mockCtx();
    const cam: CameraState = { x: 0, y: 0, zoom: 1 };
    const buf = new Uint8ClampedArray(12288);
    buf[512 + 0] = 1; // active

    renderOverlay(ctx, cam, 64, 64, null, defaultOptions({ showEcs: false }), buf);

    // strokeRect is called once for the document border only
    expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
  });

  it("applies camera offset and zoom to entity positions", () => {
    const ctx = mockCtx();
    const cam: CameraState = { x: 5, y: 5, zoom: 2 };
    const buf = new Uint8ClampedArray(12288);
    buf[512 + 0] = 1;  // active
    buf[512 + 1] = 3;  // TypeID
    buf[512 + 2] = 0;  buf[512 + 3] = 15; // PosX = 15
    buf[512 + 4] = 0;  buf[512 + 5] = 25; // PosY = 25

    renderOverlay(ctx, cam, 64, 64, null, defaultOptions({ showEcs: true }), buf);

    // sx = (15 - 5) * 2 = 20, sy = (25 - 5) * 2 = 40
    expect(ctx.strokeRect).toHaveBeenCalledWith(20, 40, 32, 32);
    expect(ctx.fillText).toHaveBeenCalledWith("ID: 3", 20, 38);
  });
});
