import { describe, it, expect } from "vitest";
import { tokenizeMsc } from "../parser/lexer.js";
import { buildMscAst } from "../parser/ast.js";

const SOURCE = `
Source: "level_1.mzk"
Import: "core_physics.msc"
Schema:
  - $PlayerX: { addr: 0, type: Int16 }
Entity.Hero:
  Visual: "hero.png"
  Input:
    - Key_Space -> Action.Jump
Events:
  Collision(Hero:#Feet, Level:#FFFF00):
    - State.$PlayerX = 1
`;

describe("buildMscAst", () => {
  it("builds core sections from token stream", () => {
    const ast = buildMscAst(tokenizeMsc(SOURCE));

    expect(ast.source).toBe("level_1.mzk");
    expect(ast.imports).toContain("core_physics.msc");
    expect(ast.schema["$PlayerX"]).toEqual({ addr: 0, type: "Int16" });
    expect(ast.entities["Hero"].visual).toBe("hero.png");
    expect(ast.entities["Hero"].inputs).toContainEqual({
      key: "Key_Space",
      action: "Action.Jump",
    });
    expect(ast.events[0].trigger).toBe("Collision(Hero:#Feet, Level:#FFFF00)");
  });

  it("skips empty Import values", () => {
    const ast = buildMscAst(tokenizeMsc('Import: ""\nImport: "valid.msc"\n'));
    expect(ast.imports).toEqual(["valid.msc"]);
  });

  it("skips schema entries with negative addr", () => {
    const src = 'Schema:\n  - $Bad: { addr: -1, type: Int8 }\n  - $Good: { addr: 0, type: Int8 }\n';
    const ast = buildMscAst(tokenizeMsc(src));
    expect(ast.schema["$Bad"]).toBeUndefined();
    expect(ast.schema["$Good"]).toBeDefined();
  });

  it("parses Sprites $Grid setting", () => {
    const src = "Sprites:\n  $Grid: 16\n";
    const ast = buildMscAst(tokenizeMsc(src));
    expect(ast.spriteGrid).toBe(16);
    expect(ast.sprites.size).toBe(0);
  });

  it("parses grid single-frame sprite [col, row]", () => {
    const src = "Sprites:\n  $Grid: 16\n  hero_idle: [0, 0]\n";
    const ast = buildMscAst(tokenizeMsc(src));
    expect(ast.sprites.get("hero_idle")).toEqual({
      kind: "grid",
      col: 0,
      row: 0,
      frames: 1,
    });
  });

  it("parses grid animation strip [col, row, frames]", () => {
    const src = "Sprites:\n  $Grid: 16\n  hero_run: [1, 0, 3]\n";
    const ast = buildMscAst(tokenizeMsc(src));
    expect(ast.sprites.get("hero_run")).toEqual({
      kind: "grid",
      col: 1,
      row: 0,
      frames: 3,
    });
  });

  it("parses absolute sprite definition with origin", () => {
    const src = "Sprites:\n  boss: { x: 128, y: 64, w: 64, h: 64, ox: 32, oy: 64 }\n";
    const ast = buildMscAst(tokenizeMsc(src));
    expect(ast.sprites.get("boss")).toEqual({
      kind: "absolute",
      x: 128,
      y: 64,
      w: 64,
      h: 64,
      ox: 32,
      oy: 64,
    });
  });

  it("defaults ox/oy to 0 when omitted in absolute sprite", () => {
    const src = "Sprites:\n  item: { x: 0, y: 0, w: 16, h: 16 }\n";
    const ast = buildMscAst(tokenizeMsc(src));
    expect(ast.sprites.get("item")).toEqual({
      kind: "absolute",
      x: 0,
      y: 0,
      w: 16,
      h: 16,
      ox: 0,
      oy: 0,
    });
  });

  it("parses mixed Sprites block with $Grid, grid and absolute entries", () => {
    const src = [
      "Sprites:",
      "  $Grid: 16",
      "  hero_idle: [0, 0]",
      "  hero_run: [1, 0, 3]",
      "  boss: { x: 128, y: 64, w: 64, h: 64, ox: 32, oy: 64 }",
      "",
    ].join("\n");
    const ast = buildMscAst(tokenizeMsc(src));
    expect(ast.spriteGrid).toBe(16);
    expect(ast.sprites.size).toBe(3);
    expect(ast.sprites.get("hero_idle")!.kind).toBe("grid");
    expect(ast.sprites.get("hero_run")!.kind).toBe("grid");
    expect(ast.sprites.get("boss")!.kind).toBe("absolute");
  });

  it("initializes sprites as empty Map when no Sprites block", () => {
    const ast = buildMscAst(tokenizeMsc(SOURCE));
    expect(ast.sprites).toBeInstanceOf(Map);
    expect(ast.sprites.size).toBe(0);
    expect(ast.spriteGrid).toBe(0);
  });
});
