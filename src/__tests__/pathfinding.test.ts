import { describe, it, expect } from "vitest";
import { catmullRomSpline, tracePixelPath } from "../engine/pathfinding.js";

describe("catmullRomSpline", () => {
  it("returns the same points for a single point", () => {
    const pts = [{ x: 5, y: 5 }];
    expect(catmullRomSpline(pts)).toEqual(pts);
  });

  it("produces more points than the input for smoothing", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
    ];
    expect(catmullRomSpline(pts, 10).length).toBeGreaterThan(pts.length);
  });

  it("first point equals the start", () => {
    const pts = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ];
    const spline = catmullRomSpline(pts);
    expect(spline[0]).toEqual(pts[0]);
  });
});

describe("tracePixelPath", () => {
  function makeImageData(
    width: number,
    height: number,
    pixels: Array<[number, number, number, number]>
  ): ImageData {
    const data = new Uint8ClampedArray(pixels.length * 4);
    pixels.forEach(([r, g, b, a], i) => {
      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = a;
    });
    return { data, width, height, colorSpace: "srgb" } as ImageData;
  }

  it("returns empty array when no start pixel found", () => {
    const img = makeImageData(2, 2, [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const path = tracePixelPath(img, {
      startColor: "#00FF00",
      pathColor: "#0000FF",
      nodeColor: "#FF0000",
    });
    expect(path).toHaveLength(0);
  });

  it("traces a 1-pixel start to adjacent node", () => {
    // Row: [start=green][node=red]
    const img = makeImageData(2, 1, [
      [0, 255, 0, 255], // #00FF00 start
      [255, 0, 0, 255], // #FF0000 node
    ]);
    const path = tracePixelPath(img, {
      startColor: "#00FF00",
      pathColor: "#0000FF",
      nodeColor: "#FF0000",
    });
    expect(path.length).toBeGreaterThanOrEqual(1);
    expect(path[0]).toEqual({ x: 0, y: 0 });
  });
});
