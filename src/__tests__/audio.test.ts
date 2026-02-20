import { describe, it, expect } from "vitest";
import { parseSequencerGrid, hexToWaveform } from "../engine/audio.js";

function makeGrid(
  size: 16 | 32,
  fillFn: (x: number, y: number) => [number, number, number, number]
): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = fillFn(x, y);
      const base = (y * size + x) * 4;
      buf[base] = r;
      buf[base + 1] = g;
      buf[base + 2] = b;
      buf[base + 3] = a;
    }
  }
  return buf;
}

describe("parseSequencerGrid", () => {
  it("returns no notes for a fully transparent grid", () => {
    const data = makeGrid(16, () => [0, 0, 0, 0]);
    expect(parseSequencerGrid(data, 16)).toHaveLength(0);
  });

  it("returns no notes for a fully black opaque grid", () => {
    const data = makeGrid(16, () => [0, 0, 0, 255]);
    expect(parseSequencerGrid(data, 16)).toHaveLength(0);
  });

  it("returns notes for bright pixels", () => {
    // Single bright pixel at (3, 5)
    const data = makeGrid(16, (x, y) =>
      x === 3 && y === 5 ? [255, 200, 100, 255] : [0, 0, 0, 0]
    );
    const notes = parseSequencerGrid(data, 16);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ step: 3, pitch: 5 });
    expect(notes[0].velocity).toBeGreaterThan(0);
    expect(notes[0].velocity).toBeLessThanOrEqual(1);
  });

  it("computes velocity from brightness", () => {
    // Full-brightness white pixel
    const data = makeGrid(16, (x, y) =>
      x === 0 && y === 0 ? [255, 255, 255, 255] : [0, 0, 0, 0]
    );
    const notes = parseSequencerGrid(data, 16);
    expect(notes[0].velocity).toBeCloseTo(1, 5);
  });
});

describe("hexToWaveform", () => {
  it("maps #00ffff to square", () => {
    expect(hexToWaveform("#00ffff")).toBe("square");
  });

  it("maps #ffa500 to sine", () => {
    expect(hexToWaveform("#ffa500")).toBe("sine");
  });

  it("maps #ff00ff to sawtooth", () => {
    expect(hexToWaveform("#ff00ff")).toBe("sawtooth");
  });

  it("maps uppercase hex correctly", () => {
    expect(hexToWaveform("#00FFFF")).toBe("square");
  });

  it("falls back to sine for unmapped colours", () => {
    expect(hexToWaveform("#123456")).toBe("sine");
  });
});
