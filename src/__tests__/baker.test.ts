import { describe, it, expect } from "vitest";
import {
  marchingSquares,
  pixelsToBezier,
  detectSequencerGrids,
  bake,
} from "../engine/baker.js";

function makeImageData(
  width: number,
  height: number,
  fillFn: (x: number, y: number) => [number, number, number, number]
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fillFn(x, y);
      const base = (y * width + x) * 4;
      data[base] = r;
      data[base + 1] = g;
      data[base + 2] = b;
      data[base + 3] = a;
    }
  }
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

describe("marchingSquares", () => {
  it("returns no polygons for a fully transparent image", () => {
    const img = makeImageData(8, 8, () => [0, 0, 0, 0]);
    expect(marchingSquares(img)).toHaveLength(0);
  });

  it("returns no polygons for a fully opaque image", () => {
    const img = makeImageData(8, 8, () => [255, 255, 255, 255]);
    expect(marchingSquares(img)).toHaveLength(0);
  });

  it("returns at least one polygon for a mixed image", () => {
    // Fill a checkerboard pattern so there are plenty of boundary cells
    const img = makeImageData(
      8,
      8,
      (x, y) => ((x + y) % 2 === 0 ? [255, 255, 255, 255] : [0, 0, 0, 0])
    );
    expect(marchingSquares(img).length).toBeGreaterThan(0);
  });
});

describe("pixelsToBezier", () => {
  it("returns a copy for a single point", () => {
    const pts = [{ x: 1, y: 2 }];
    expect(pixelsToBezier(pts)).toEqual(pts);
  });

  it("returns at least 2 points for a 2-point input", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(pixelsToBezier(pts).length).toBeGreaterThanOrEqual(2);
  });

  it("includes start and end points", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 5, y: 3 },
      { x: 10, y: 0 },
    ];
    const result = pixelsToBezier(pts);
    expect(result[0]).toEqual(pts[0]);
    expect(result[result.length - 1]).toEqual(pts[pts.length - 1]);
  });
});

describe("detectSequencerGrids", () => {
  it("detects a 16x16 grid when image is at least 16x16", () => {
    const img = makeImageData(16, 16, () => [255, 128, 0, 255]);
    const grids = detectSequencerGrids(img);
    expect(grids.some((g) => g.size === 16)).toBe(true);
  });

  it("detects a 32x32 grid when image is at least 32x32", () => {
    const img = makeImageData(32, 32, () => [0, 200, 100, 255]);
    const grids = detectSequencerGrids(img);
    expect(grids.some((g) => g.size === 32)).toBe(true);
  });

  it("does not detect a 32x32 grid in a 16x16 image", () => {
    const img = makeImageData(16, 16, () => [0, 0, 0, 255]);
    const grids = detectSequencerGrids(img);
    expect(grids.some((g) => g.size === 32)).toBe(false);
  });
});

describe("bake", () => {
  it("returns a BakedAsset with correct dimensions", () => {
    const img = makeImageData(4, 4, () => [255, 0, 0, 255]);
    const asset = bake(img);
    expect(asset.width).toBe(4);
    expect(asset.height).toBe(4);
  });

  it("returns arrays for collisionPolygons and bezierPaths", () => {
    const img = makeImageData(4, 4, () => [255, 0, 0, 128]);
    const asset = bake(img);
    expect(Array.isArray(asset.collisionPolygons)).toBe(true);
    expect(Array.isArray(asset.bezierPaths)).toBe(true);
  });
});
