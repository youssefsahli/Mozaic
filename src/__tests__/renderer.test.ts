import { describe, it, expect } from "vitest";
import { compileSpriteAtlas, type BakedSprite } from "../engine/renderer.js";
import type { MscSpriteDef } from "../parser/ast.js";

describe("compileSpriteAtlas", () => {
  it("returns [null] for an empty sprites map", () => {
    const atlas = compileSpriteAtlas(new Map(), 16, 256, 256);
    expect(atlas).toEqual([null]);
  });

  it("assigns TypeID 1 to the first sprite and 2 to the second", () => {
    const sprites = new Map<string, MscSpriteDef>([
      ["hero_idle", { kind: "grid", col: 0, row: 0, frames: 1 }],
      ["item", { kind: "absolute", x: 32, y: 0, w: 8, h: 8, ox: 0, oy: 0 }],
    ]);
    const atlas = compileSpriteAtlas(sprites, 16, 256, 256);
    expect(atlas[0]).toBeNull();
    expect(atlas[1]).not.toBeNull();
    expect(atlas[2]).not.toBeNull();
    expect(atlas.length).toBe(3);
  });

  it("resolves grid sprite to correct pixel and UV coordinates", () => {
    const sprites = new Map<string, MscSpriteDef>([
      ["hero", { kind: "grid", col: 2, row: 3, frames: 1 }],
    ]);
    const atlas = compileSpriteAtlas(sprites, 16, 256, 256);
    const sprite = atlas[1] as BakedSprite;

    // x = 2*16 = 32, y = 3*16 = 48
    expect(sprite.u0).toBeCloseTo(32 / 256);
    expect(sprite.v0).toBeCloseTo(48 / 256);
    expect(sprite.u1).toBeCloseTo(48 / 256);
    expect(sprite.v1).toBeCloseTo(64 / 256);
    expect(sprite.w).toBe(16);
    expect(sprite.h).toBe(16);
    expect(sprite.ox).toBe(0);
    expect(sprite.oy).toBe(0);
  });

  it("expands multi-frame grid sprites into consecutive entries", () => {
    const sprites = new Map<string, MscSpriteDef>([
      ["hero_run", { kind: "grid", col: 1, row: 0, frames: 3 }],
    ]);
    const atlas = compileSpriteAtlas(sprites, 16, 256, 256);

    // 3 frames → 3 entries (TypeIDs 1, 2, 3) + null at index 0
    expect(atlas.length).toBe(4);

    // Frame 0: col=1 → x=16
    const f0 = atlas[1] as BakedSprite;
    expect(f0.u0).toBeCloseTo(16 / 256);
    expect(f0.u1).toBeCloseTo(32 / 256);

    // Frame 1: col=2 → x=32
    const f1 = atlas[2] as BakedSprite;
    expect(f1.u0).toBeCloseTo(32 / 256);
    expect(f1.u1).toBeCloseTo(48 / 256);

    // Frame 2: col=3 → x=48
    const f2 = atlas[3] as BakedSprite;
    expect(f2.u0).toBeCloseTo(48 / 256);
    expect(f2.u1).toBeCloseTo(64 / 256);
  });

  it("resolves absolute sprite with origin offsets", () => {
    const sprites = new Map<string, MscSpriteDef>([
      ["boss", { kind: "absolute", x: 128, y: 64, w: 64, h: 64, ox: 32, oy: 64 }],
    ]);
    const atlas = compileSpriteAtlas(sprites, 16, 256, 256);
    const sprite = atlas[1] as BakedSprite;

    expect(sprite.u0).toBeCloseTo(128 / 256);
    expect(sprite.v0).toBeCloseTo(64 / 256);
    expect(sprite.u1).toBeCloseTo(192 / 256);
    expect(sprite.v1).toBeCloseTo(128 / 256);
    expect(sprite.w).toBe(64);
    expect(sprite.h).toBe(64);
    expect(sprite.ox).toBe(32);
    expect(sprite.oy).toBe(64);
  });

  it("handles mixed grid and absolute sprites with correct TypeID ordering", () => {
    const sprites = new Map<string, MscSpriteDef>([
      ["hero_idle", { kind: "grid", col: 0, row: 0, frames: 1 }],
      ["hero_run", { kind: "grid", col: 1, row: 0, frames: 3 }],
      ["boss", { kind: "absolute", x: 128, y: 64, w: 64, h: 64, ox: 32, oy: 64 }],
    ]);
    const atlas = compileSpriteAtlas(sprites, 16, 256, 256);

    // hero_idle: 1 frame → TypeID 1
    // hero_run: 3 frames → TypeIDs 2, 3, 4
    // boss: 1 entry → TypeID 5
    expect(atlas.length).toBe(6);
    expect(atlas[0]).toBeNull();
    expect((atlas[1] as BakedSprite).w).toBe(16); // hero_idle
    expect((atlas[2] as BakedSprite).w).toBe(16); // hero_run frame 0
    expect((atlas[3] as BakedSprite).w).toBe(16); // hero_run frame 1
    expect((atlas[4] as BakedSprite).w).toBe(16); // hero_run frame 2
    expect((atlas[5] as BakedSprite).w).toBe(64); // boss
  });

  it("normalizes UVs correctly for non-square atlas dimensions", () => {
    const sprites = new Map<string, MscSpriteDef>([
      ["wide", { kind: "absolute", x: 0, y: 0, w: 32, h: 16, ox: 0, oy: 0 }],
    ]);
    const atlas = compileSpriteAtlas(sprites, 16, 512, 128);
    const sprite = atlas[1] as BakedSprite;

    expect(sprite.u0).toBeCloseTo(0);
    expect(sprite.v0).toBeCloseTo(0);
    expect(sprite.u1).toBeCloseTo(32 / 512);
    expect(sprite.v1).toBeCloseTo(16 / 128);
  });

  it("grid sprite with [col, row] (1 frame) produces single entry", () => {
    const sprites = new Map<string, MscSpriteDef>([
      ["single", { kind: "grid", col: 0, row: 0, frames: 1 }],
    ]);
    const atlas = compileSpriteAtlas(sprites, 16, 256, 256);
    expect(atlas.length).toBe(2); // [null, sprite]
  });
});
