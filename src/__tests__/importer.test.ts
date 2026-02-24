import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  STATE_BUFFER_BYTES,
  CHANNELS_PER_PIXEL,
} from "../engine/memory";
import { HEADER_PIXELS } from "../editor/exporter";
import { buildDataStrip, calcExportDimensions } from "../editor/exporter";
import { parseSpriteROM, type ParsedSpriteROM } from "../editor/importer";

// ── Canvas 2D mock ──────────────────────────────────────────
// jsdom does not support CanvasRenderingContext2D. We mock the
// canvas element and its context so parseSpriteROM can operate
// on synthetic ImageData without a real GPU.

const IMG_WIDTH = 256;
const IMG_HEIGHT = 256;

/** Build a fake .mzk image pixel buffer (visual + barcode strip). */
function buildMzkImageData(
  width: number,
  visHeight: number,
  stateBuffer: Uint8ClampedArray,
): { data: Uint8ClampedArray; totalHeight: number } {
  const { extraRows, totalHeight } = calcExportDimensions(
    width,
    visHeight,
    stateBuffer.length,
  );
  const totalPixels = width * totalHeight * CHANNELS_PER_PIXEL;
  const data = new Uint8ClampedArray(totalPixels);

  // Fill visual area with a recognisable pattern (0xAA)
  const visualBytes = width * visHeight * CHANNELS_PER_PIXEL;
  data.fill(0xaa, 0, visualBytes);

  // Build barcode strip and copy it into the bottom rows
  const strip = buildDataStrip(width, extraRows, stateBuffer);
  data.set(strip, visualBytes);

  return { data, totalHeight };
}

/** Create a mock HTMLImageElement + canvas mocks for parseSpriteROM. */
function setupMockEnvironment(
  fullData: Uint8ClampedArray,
  width: number,
  totalHeight: number,
): HTMLImageElement {
  // Accumulated putImageData data so toDataURL can reference it
  let putData: Uint8ClampedArray | null = null;
  let putWidth = 0;
  let putHeight = 0;

  const mockCtx = {
    drawImage: vi.fn(),
    getImageData: vi.fn(
      (sx: number, sy: number, sw: number, sh: number) => {
        // If putData was set (for the crop canvas), return that
        if (putData) {
          return { data: new Uint8ClampedArray(putData), width: putWidth, height: putHeight };
        }
        // Slice the correct region from fullData
        const rowBytes = width * CHANNELS_PER_PIXEL;
        const result = new Uint8ClampedArray(sw * sh * CHANNELS_PER_PIXEL);
        for (let row = 0; row < sh; row++) {
          const srcOffset = (sy + row) * rowBytes + sx * CHANNELS_PER_PIXEL;
          const dstOffset = row * sw * CHANNELS_PER_PIXEL;
          result.set(
            fullData.slice(srcOffset, srcOffset + sw * CHANNELS_PER_PIXEL),
            dstOffset,
          );
        }
        return { data: result, width: sw, height: sh };
      },
    ),
    putImageData: vi.fn((imageData: { data: Uint8ClampedArray; width: number; height: number }) => {
      putData = imageData.data;
      putWidth = imageData.width;
      putHeight = imageData.height;
    }),
  };

  // Track canvas creation calls – first = full canvas, second = crop canvas
  let canvasCallCount = 0;
  const origCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") {
      canvasCallCount++;
      const fakeCanvas = origCreateElement("canvas") as HTMLCanvasElement;
      // For the crop canvas, reset putData so a fresh context is used
      if (canvasCallCount > 1) {
        putData = null;
      }
      (fakeCanvas as any).getContext = () => mockCtx;
      (fakeCanvas as any).toDataURL = () =>
        `data:image/png;base64,MOCK_${canvasCallCount}`;
      return fakeCanvas;
    }
    return origCreateElement(tag);
  });

  // Mock HTMLImageElement
  const img = origCreateElement("img") as HTMLImageElement;
  Object.defineProperty(img, "naturalWidth", { value: width });
  Object.defineProperty(img, "naturalHeight", { value: totalHeight });

  return img;
}

// ── Tests ────────────────────────────────────────────────────

describe("parseSpriteROM", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns stateBuffer: null for an image without MZK1 signature", () => {
    // Create a plain image (no barcode)
    const plainData = new Uint8ClampedArray(
      IMG_WIDTH * IMG_HEIGHT * CHANNELS_PER_PIXEL,
    );
    plainData.fill(0xcc);

    const img = setupMockEnvironment(plainData, IMG_WIDTH, IMG_HEIGHT);
    const result = parseSpriteROM(img);

    expect(result.stateBuffer).toBeNull();
    expect(result.width).toBe(IMG_WIDTH);
    expect(result.height).toBe(IMG_HEIGHT);
    expect(result.visualDataUrl).toContain("data:image/png");
  });

  it("extracts state buffer from a valid MZK1 cartridge", () => {
    const stateBuffer = new Uint8ClampedArray(STATE_BUFFER_BYTES);
    stateBuffer[0] = 0xde;
    stateBuffer[1] = 0xad;
    stateBuffer[2] = 0xbe;
    stateBuffer[3] = 0xef;
    stateBuffer[STATE_BUFFER_BYTES - 1] = 0x42;

    const { data, totalHeight } = buildMzkImageData(
      IMG_WIDTH,
      IMG_HEIGHT,
      stateBuffer,
    );
    const img = setupMockEnvironment(data, IMG_WIDTH, totalHeight);
    const result = parseSpriteROM(img);

    expect(result.stateBuffer).not.toBeNull();
    expect(result.stateBuffer!.length).toBe(STATE_BUFFER_BYTES);
    expect(result.stateBuffer![0]).toBe(0xde);
    expect(result.stateBuffer![1]).toBe(0xad);
    expect(result.stateBuffer![2]).toBe(0xbe);
    expect(result.stateBuffer![3]).toBe(0xef);
    expect(result.stateBuffer![STATE_BUFFER_BYTES - 1]).toBe(0x42);
  });

  it("returns the correct cropped dimensions for a valid cartridge", () => {
    const stateBuffer = new Uint8ClampedArray(STATE_BUFFER_BYTES);
    const { data, totalHeight } = buildMzkImageData(
      IMG_WIDTH,
      IMG_HEIGHT,
      stateBuffer,
    );
    const img = setupMockEnvironment(data, IMG_WIDTH, totalHeight);
    const result = parseSpriteROM(img);

    expect(result.width).toBe(IMG_WIDTH);
    expect(result.height).toBe(IMG_HEIGHT);
  });

  it("preserves the full state buffer byte-for-byte", () => {
    const stateBuffer = new Uint8ClampedArray(STATE_BUFFER_BYTES);
    for (let i = 0; i < stateBuffer.length; i++) {
      stateBuffer[i] = i & 0xff;
    }

    const { data, totalHeight } = buildMzkImageData(
      IMG_WIDTH,
      IMG_HEIGHT,
      stateBuffer,
    );
    const img = setupMockEnvironment(data, IMG_WIDTH, totalHeight);
    const result = parseSpriteROM(img);

    expect(result.stateBuffer).not.toBeNull();
    for (let i = 0; i < STATE_BUFFER_BYTES; i++) {
      expect(result.stateBuffer![i]).toBe(stateBuffer[i]);
    }
  });

  it("returns a visual data URL for a valid cartridge", () => {
    const stateBuffer = new Uint8ClampedArray(STATE_BUFFER_BYTES);
    const { data, totalHeight } = buildMzkImageData(
      IMG_WIDTH,
      IMG_HEIGHT,
      stateBuffer,
    );
    const img = setupMockEnvironment(data, IMG_WIDTH, totalHeight);
    const result = parseSpriteROM(img);

    expect(result.visualDataUrl).toContain("data:image/png");
  });

  it("works with a non-256 canvas width", () => {
    const w = 100;
    const h = 100;
    const stateBuffer = new Uint8ClampedArray(STATE_BUFFER_BYTES);
    stateBuffer[0] = 0xff;

    const { data, totalHeight } = buildMzkImageData(w, h, stateBuffer);
    const img = setupMockEnvironment(data, w, totalHeight);
    const result = parseSpriteROM(img);

    expect(result.stateBuffer).not.toBeNull();
    expect(result.stateBuffer![0]).toBe(0xff);
    expect(result.width).toBe(w);
    expect(result.height).toBe(h);
  });
});
