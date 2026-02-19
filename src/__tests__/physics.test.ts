import { describe, it, expect } from "vitest";
import {
  polygonAABB,
  aabbOverlap,
  pointInPolygon,
  parseHexColor,
  detectColorCollision,
} from "../engine/physics.js";

describe("polygonAABB", () => {
  it("computes correct bounding box", () => {
    const poly = [
      { x: 1, y: 2 },
      { x: 5, y: 3 },
      { x: 3, y: 8 },
    ];
    const bb = polygonAABB(poly);
    expect(bb).toEqual({ x: 1, y: 2, width: 4, height: 6 });
  });
});

describe("aabbOverlap", () => {
  it("detects overlapping AABBs", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 5, y: 5, width: 10, height: 10 };
    expect(aabbOverlap(a, b)).toBe(true);
  });

  it("detects non-overlapping AABBs", () => {
    const a = { x: 0, y: 0, width: 5, height: 5 };
    const b = { x: 10, y: 10, width: 5, height: 5 };
    expect(aabbOverlap(a, b)).toBe(false);
  });
});

describe("pointInPolygon", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("returns true for a point inside the polygon", () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
  });

  it("returns false for a point outside the polygon", () => {
    expect(pointInPolygon({ x: 15, y: 15 }, square)).toBe(false);
  });
});

describe("parseHexColor", () => {
  it("parses 6-digit hex", () => {
    expect(parseHexColor("#FF8000")).toEqual([255, 128, 0]);
  });

  it("parses 3-digit hex", () => {
    expect(parseHexColor("#F80")).toEqual([255, 136, 0]);
  });

  it("strips leading #", () => {
    expect(parseHexColor("FFFFFF")).toEqual([255, 255, 255]);
  });
});

describe("detectColorCollision", () => {
  function makeState(
    pixels: Array<[number, number, number, number]>
  ): Uint8ClampedArray {
    const buf = new Uint8ClampedArray(pixels.length * 4);
    pixels.forEach(([r, g, b, a], i) => {
      buf[i * 4] = r;
      buf[i * 4 + 1] = g;
      buf[i * 4 + 2] = b;
      buf[i * 4 + 3] = a;
    });
    return buf;
  }

  it("detects adjacent color regions", () => {
    // 2 pixels wide: pixel 0 = yellow (#FFFF00), pixel 1 = red (#FF0000)
    const state = makeState([
      [255, 255, 0, 255],
      [255, 0, 0, 255],
    ]);
    expect(detectColorCollision(state, 2, "#FFFF00", "#FF0000")).toBe(true);
  });

  it("returns false when colors are not adjacent", () => {
    // 4 pixels in a row: yellow, empty, empty, red
    const state = makeState([
      [255, 255, 0, 255],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [255, 0, 0, 255],
    ]);
    expect(detectColorCollision(state, 4, "#FFFF00", "#FF0000")).toBe(false);
  });
});
