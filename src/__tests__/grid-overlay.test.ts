import { describe, it, expect } from "vitest";
import { inspectPixelAt } from "../editor/grid-overlay.js";
import type { MscSchema } from "../parser/msc.js";

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
