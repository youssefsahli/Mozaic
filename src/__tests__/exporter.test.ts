import { describe, it, expect } from "vitest";
import {
  calcExportDimensions,
  buildDataStrip,
  HEADER_PIXELS,
} from "../editor/exporter";
import {
  STATE_BUFFER_BYTES,
  CHANNELS_PER_PIXEL,
} from "../engine/memory";

// ── calcExportDimensions ─────────────────────────────────────

describe("calcExportDimensions", () => {
  it("calculates correct pixel counts for a 256px-wide canvas", () => {
    const { totalDataPixels, extraRows, totalHeight } =
      calcExportDimensions(256, 256);

    // 16384 / 4 = 4096 state pixels + 4 header pixels
    expect(totalDataPixels).toBe(4100);
    // 4100 / 256 = 16.015… → 17 rows
    expect(extraRows).toBe(Math.ceil(4100 / 256));
    expect(totalHeight).toBe(256 + extraRows);
  });

  it("handles canvas width that evenly divides data pixels", () => {
    // 4100 / 100 = 41 exactly
    const { extraRows } = calcExportDimensions(100, 200);
    expect(extraRows).toBe(41);
  });

  it("handles canvas width that does not evenly divide data pixels", () => {
    // 4100 / 300 = 13.666… → 14
    const { extraRows } = calcExportDimensions(300, 100);
    expect(extraRows).toBe(14);
  });

  it("uses STATE_BUFFER_BYTES by default", () => {
    const { totalDataPixels } = calcExportDimensions(128, 128);
    expect(totalDataPixels).toBe(STATE_BUFFER_BYTES / CHANNELS_PER_PIXEL + HEADER_PIXELS);
  });

  it("accepts a custom state buffer size", () => {
    const customBytes = 1024;
    const { totalDataPixels } = calcExportDimensions(64, 64, customBytes);
    expect(totalDataPixels).toBe(customBytes / CHANNELS_PER_PIXEL + HEADER_PIXELS);
  });
});

// ── buildDataStrip ───────────────────────────────────────────

describe("buildDataStrip", () => {
  const width = 256;
  const stateBuffer = new Uint8ClampedArray(STATE_BUFFER_BYTES);

  it("returns a Uint8ClampedArray of the correct length", () => {
    const { extraRows } = calcExportDimensions(width, 0);
    const strip = buildDataStrip(width, extraRows, stateBuffer);
    expect(strip).toBeInstanceOf(Uint8ClampedArray);
    expect(strip.length).toBe(width * extraRows * CHANNELS_PER_PIXEL);
  });

  it("writes the MZK1 magic bytes in the first pixel", () => {
    const { extraRows } = calcExportDimensions(width, 0);
    const strip = buildDataStrip(width, extraRows, stateBuffer);
    // 'M' = 0x4D, 'Z' = 0x5A, 'K' = 0x4B, '1' = 0x31
    expect(strip[0]).toBe(0x4d);
    expect(strip[1]).toBe(0x5a);
    expect(strip[2]).toBe(0x4b);
    expect(strip[3]).toBe(0x31);
  });

  it("reserves header pixels 1-3 as zeros", () => {
    const { extraRows } = calcExportDimensions(width, 0);
    const strip = buildDataStrip(width, extraRows, stateBuffer);
    for (let i = 4; i < HEADER_PIXELS * CHANNELS_PER_PIXEL; i++) {
      expect(strip[i]).toBe(0);
    }
  });

  it("copies the state buffer after the header", () => {
    const buf = new Uint8ClampedArray(STATE_BUFFER_BYTES);
    // Write a recognisable pattern
    buf[0] = 0xde;
    buf[1] = 0xad;
    buf[2] = 0xbe;
    buf[3] = 0xef;
    buf[STATE_BUFFER_BYTES - 1] = 0x42;

    const { extraRows } = calcExportDimensions(width, 0);
    const strip = buildDataStrip(width, extraRows, buf);
    const offset = HEADER_PIXELS * CHANNELS_PER_PIXEL;

    expect(strip[offset]).toBe(0xde);
    expect(strip[offset + 1]).toBe(0xad);
    expect(strip[offset + 2]).toBe(0xbe);
    expect(strip[offset + 3]).toBe(0xef);
    expect(strip[offset + STATE_BUFFER_BYTES - 1]).toBe(0x42);
  });

  it("preserves the full state buffer byte-for-byte", () => {
    const buf = new Uint8ClampedArray(STATE_BUFFER_BYTES);
    for (let i = 0; i < buf.length; i++) buf[i] = i & 0xff;

    const { extraRows } = calcExportDimensions(width, 0);
    const strip = buildDataStrip(width, extraRows, buf);
    const offset = HEADER_PIXELS * CHANNELS_PER_PIXEL;

    for (let i = 0; i < buf.length; i++) {
      expect(strip[offset + i]).toBe(buf[i]);
    }
  });
});
