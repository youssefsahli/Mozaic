import { describe, it, expect, vi, beforeAll } from "vitest";
import {
  hasShapeSprites,
  createShapeAtlas,
  extendImageDataWithShapes,
  paintShapesIntoBuffer,
} from "../engine/shape-atlas.js";
import type { MscSpriteDef } from "../parser/ast.js";

// ── ImageData polyfill for jsdom (which doesn't provide a real ImageData ctor) ──
class MockImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  colorSpace: "srgb" = "srgb";
  constructor(data: Uint8ClampedArray | number, width: number, height?: number) {
    if (typeof data === "number") {
      this.width = data;
      this.height = width;
      this.data = new Uint8ClampedArray(data * width * 4);
    } else {
      this.data = new Uint8ClampedArray(data);
      this.width = width;
      this.height = height ?? Math.floor(data.length / (width * 4));
    }
  }
}

beforeAll(() => {
  vi.stubGlobal("ImageData", MockImageData);
});

describe("hasShapeSprites", () => {
  it("returns false for empty Map", () => {
    expect(hasShapeSprites(new Map())).toBe(false);
  });

  it("returns false when no shape sprites", () => {
    const sprites = new Map<string, MscSpriteDef>([
      ["Hero", { kind: "grid", col: 0, row: 0, frames: 1 }],
    ]);
    expect(hasShapeSprites(sprites)).toBe(false);
  });

  it("returns true when at least one shape sprite is present", () => {
    const sprites = new Map<string, MscSpriteDef>([
      ["Hero", { kind: "shape", shapeType: "circle", color: "#FF0000", size: 12 }],
    ]);
    expect(hasShapeSprites(sprites)).toBe(true);
  });

  it("returns true when mixed grid and shape sprites", () => {
    const sprites = new Map<string, MscSpriteDef>([
      ["Tile", { kind: "grid", col: 0, row: 0, frames: 1 }],
      ["Player", { kind: "shape", shapeType: "rect", color: "#00FF00", size: 8 }],
    ]);
    expect(hasShapeSprites(sprites)).toBe(true);
  });
});

describe("createShapeAtlas", () => {
  it("creates imageData with correct width (64)", () => {
    const sprites = new Map<string, MscSpriteDef>([
      ["Hero", { kind: "shape", shapeType: "circle", color: "#4488FF", size: 12 }],
    ]);
    const { imageData } = createShapeAtlas(sprites, 16);
    expect(imageData.width).toBe(64);
  });

  it("height = 64 (state area) + shape rows", () => {
    const sprites = new Map<string, MscSpriteDef>([
      ["A", { kind: "shape", shapeType: "circle", color: "#FFF", size: 8 }],
      ["B", { kind: "shape", shapeType: "rect", color: "#F00", size: 8 }],
    ]);
    const { imageData } = createShapeAtlas(sprites, 16);
    // 2 shapes → 1 row → 64 + 16 = 80
    expect(imageData.height).toBe(80);
  });

  it("converts shape sprites to absolute kind in updatedSprites", () => {
    const sprites = new Map<string, MscSpriteDef>([
      ["Hero", { kind: "shape", shapeType: "circle", color: "#4488FF", size: 12 }],
    ]);
    const { updatedSprites } = createShapeAtlas(sprites, 16);
    const def = updatedSprites.get("Hero");
    expect(def?.kind).toBe("absolute");
  });

  it("non-shape sprites pass through unchanged", () => {
    const sprites = new Map<string, MscSpriteDef>([
      ["Tile", { kind: "grid", col: 0, row: 0, frames: 1 }],
      ["Hero", { kind: "shape", shapeType: "circle", color: "#FFF", size: 10 }],
    ]);
    const { updatedSprites } = createShapeAtlas(sprites, 16);
    expect(updatedSprites.get("Tile")?.kind).toBe("grid");
    expect(updatedSprites.get("Hero")?.kind).toBe("absolute");
  });

  it("paints non-zero alpha pixels for a circle shape", () => {
    const sprites = new Map<string, MscSpriteDef>([
      ["Dot", { kind: "shape", shapeType: "circle", color: "#FF0000", size: 12 }],
    ]);
    const { imageData, updatedSprites } = createShapeAtlas(sprites, 16);
    const def = updatedSprites.get("Dot");
    if (def?.kind !== "absolute") throw new Error("expected absolute");
    // Check center pixel of the sprite cell has alpha > 0
    const cx = def.x + 8;
    const cy = def.y + 8;
    const idx = (cy * imageData.width + cx) * 4;
    expect(imageData.data[idx + 3]).toBeGreaterThan(0);
  });

  it("paints correct color for a rect shape", () => {
    const sprites = new Map<string, MscSpriteDef>([
      ["Box", { kind: "shape", shapeType: "rect", color: "#FF4400", size: 12 }],
    ]);
    const { imageData, updatedSprites } = createShapeAtlas(sprites, 16);
    const def = updatedSprites.get("Box");
    if (def?.kind !== "absolute") throw new Error("expected absolute");
    const cx = def.x + 8;
    const cy = def.y + 8;
    const idx = (cy * imageData.width + cx) * 4;
    expect(imageData.data[idx]).toBe(0xFF);       // R
    expect(imageData.data[idx + 1]).toBe(0x44);   // G
    expect(imageData.data[idx + 2]).toBe(0x00);   // B
    expect(imageData.data[idx + 3]).toBe(255);    // A
  });
});

describe("extendImageDataWithShapes", () => {
  it("expands a 64×64 source image to include shape rows", () => {
    const sourceData = new ImageData(64, 64);
    const sprites = new Map<string, MscSpriteDef>([
      ["Hero", { kind: "shape", shapeType: "circle", color: "#0F0", size: 10 }],
    ]);
    const { imageData } = extendImageDataWithShapes(sourceData, sprites, 16);
    expect(imageData.width).toBe(64);
    expect(imageData.height).toBeGreaterThanOrEqual(80);
  });

  it("preserves original pixels from source image", () => {
    // Write a sentinel value into the source image at (0, 0)
    const sourceData = new ImageData(64, 64);
    sourceData.data[0] = 123; // R of pixel (0,0)
    sourceData.data[3] = 255; // A of pixel (0,0)
    const sprites = new Map<string, MscSpriteDef>([
      ["A", { kind: "shape", shapeType: "rect", color: "#F00", size: 8 }],
    ]);
    const { imageData } = extendImageDataWithShapes(sourceData, sprites, 16);
    expect(imageData.data[0]).toBe(123);
  });
});

describe("paintShapesIntoBuffer – diamond shape", () => {
  it("paints non-zero alpha at the center of a diamond", () => {
    const gridSize = 16;
    const atlasWidth = 64;
    const atlasHeight = 80;
    const data = new Uint8ClampedArray(atlasWidth * atlasHeight * 4);
    const sprites = new Map<string, MscSpriteDef>([
      ["Gem", { kind: "shape", shapeType: "diamond", color: "#FFDD00", size: 12 }],
    ]);
    paintShapesIntoBuffer(data, atlasHeight, sprites, gridSize);
    // The first shape goes at col=0, row=64 in 64-wide atlas
    const cx = 8; // center of 16×16 cell at x=0
    const cy = 64 + 8; // center of cell at row 64
    const idx = (cy * atlasWidth + cx) * 4;
    expect(data[idx + 3]).toBeGreaterThan(0);
  });
});
