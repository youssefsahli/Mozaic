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

  it("parses Backgrounds block (inline form)", () => {
    const src = [
      'Backgrounds:',
      '  - { source: "sky.mzk", parallaxX: 0.1, parallaxY: 0.2 }',
      '  - { source: "mountains.mzk", parallaxX: 0.5, parallaxY: 0.3 }',
      '',
    ].join("\n");
    const ast = buildMscAst(tokenizeMsc(src));
    expect(ast.backgrounds).toBeDefined();
    expect(ast.backgrounds!.length).toBe(2);
    expect(ast.backgrounds![0]).toEqual({
      source: "sky.mzk",
      parallaxX: 0.1,
      parallaxY: 0.2,
    });
    expect(ast.backgrounds![1]).toEqual({
      source: "mountains.mzk",
      parallaxX: 0.5,
      parallaxY: 0.3,
    });
  });

  it("parses Backgrounds block (multi-line form)", () => {
    const src = [
      'Backgrounds:',
      '  - source: "sky.mzk"',
      '    parallaxX: 0.1',
      '    parallaxY: 0.2',
      '  - source: "clouds.mzk"',
      '    parallaxX: 0.3',
      '    parallaxY: 0.4',
      '',
    ].join("\n");
    const ast = buildMscAst(tokenizeMsc(src));
    expect(ast.backgrounds).toBeDefined();
    expect(ast.backgrounds!.length).toBe(2);
    expect(ast.backgrounds![0]).toEqual({
      source: "sky.mzk",
      parallaxX: 0.1,
      parallaxY: 0.2,
    });
    expect(ast.backgrounds![1]).toEqual({
      source: "clouds.mzk",
      parallaxX: 0.3,
      parallaxY: 0.4,
    });
  });

  it("defaults parallax to 1 when omitted in multi-line form", () => {
    const src = [
      'Backgrounds:',
      '  - source: "layer.mzk"',
      '',
    ].join("\n");
    const ast = buildMscAst(tokenizeMsc(src));
    expect(ast.backgrounds).toBeDefined();
    expect(ast.backgrounds![0]).toEqual({
      source: "layer.mzk",
      parallaxX: 1,
      parallaxY: 1,
    });
  });

  it("preserves Backgrounds order (painter's algorithm)", () => {
    const src = [
      'Backgrounds:',
      '  - { source: "far.mzk", parallaxX: 0.1, parallaxY: 0.1 }',
      '  - { source: "mid.mzk", parallaxX: 0.5, parallaxY: 0.5 }',
      '  - { source: "near.mzk", parallaxX: 0.9, parallaxY: 0.9 }',
      '',
    ].join("\n");
    const ast = buildMscAst(tokenizeMsc(src));
    expect(ast.backgrounds!.map(b => b.source)).toEqual([
      "far.mzk",
      "mid.mzk",
      "near.mzk",
    ]);
  });

  it("does not set backgrounds when Backgrounds block is absent", () => {
    const ast = buildMscAst(tokenizeMsc(SOURCE));
    expect(ast.backgrounds).toBeUndefined();
  });

  it("parses global Input block", () => {
    const src = [
      'Input:',
      '  - Key_W -> Action.MoveUp',
      '  - Key_S -> Action.MoveDown',
      ''
    ].join("\n");
    const ast = buildMscAst(tokenizeMsc(src));
    expect(ast.inputs).toBeDefined();
    expect(ast.inputs).toHaveLength(2);
    expect(ast.inputs![0]).toEqual({ key: "Key_W", action: "Action.MoveUp" });
    expect(ast.inputs![1]).toEqual({ key: "Key_S", action: "Action.MoveDown" });
  });

  it("does not set layers when Layers block is absent", () => {
    const ast = buildMscAst(tokenizeMsc(SOURCE));
    expect(ast.layers).toBeUndefined();
  });

  it("parses Layers block with Parallax multi-line form", () => {
    const src = [
      'Layers:',
      '  - Parallax:',
      '      source: "sky.mzk"',
      '      repeat: true',
      '      parallaxX: 0.1',
      '      parallaxY: 0.2',
      '',
    ].join("\n");
    const ast = buildMscAst(tokenizeMsc(src));
    expect(ast.layers).toBeDefined();
    expect(ast.layers!.length).toBe(1);
    expect(ast.layers![0]).toEqual({
      Parallax: { source: "sky.mzk", repeat: true, parallaxX: 0.1, parallaxY: 0.2 },
    });
  });

  it("parses Layers block with Terrain layer", () => {
    const src = [
      'Layers:',
      '  - Terrain:',
      '      source: "ground.mzk"',
      '      repeat: true',
      '',
    ].join("\n");
    const ast = buildMscAst(tokenizeMsc(src));
    expect(ast.layers).toBeDefined();
    expect(ast.layers!.length).toBe(1);
    expect(ast.layers![0]).toEqual({
      Terrain: { source: "ground.mzk", repeat: true },
    });
  });

  it("parses Layers block with bare Entities string", () => {
    const src = [
      'Layers:',
      '  - Entities',
      '',
    ].join("\n");
    const ast = buildMscAst(tokenizeMsc(src));
    expect(ast.layers).toBeDefined();
    expect(ast.layers!.length).toBe(1);
    expect(ast.layers![0]).toBe("Entities");
  });

  it("parses Layers block with Entities: {} form", () => {
    const src = [
      'Layers:',
      '  - Entities: {}',
      '',
    ].join("\n");
    const ast = buildMscAst(tokenizeMsc(src));
    expect(ast.layers).toBeDefined();
    expect(ast.layers!.length).toBe(1);
    expect(ast.layers![0]).toEqual({ Entities: {} });
  });

  it("parses Layers block with UI layer", () => {
    const src = [
      'Layers:',
      '  - UI:',
      '      source: "hud.mzk"',
      '',
    ].join("\n");
    const ast = buildMscAst(tokenizeMsc(src));
    expect(ast.layers).toBeDefined();
    expect(ast.layers!.length).toBe(1);
    expect(ast.layers![0]).toEqual({ UI: { source: "hud.mzk" } });
  });

  it("preserves Layers order (painter's algorithm)", () => {
    const src = [
      'Layers:',
      '  - Parallax:',
      '      source: "sky.mzk"',
      '      parallaxX: 0.1',
      '      parallaxY: 0.1',
      '  - Terrain:',
      '      source: "ground.mzk"',
      '  - Entities',
      '  - UI:',
      '      source: "hud.mzk"',
      '',
    ].join("\n");
    const ast = buildMscAst(tokenizeMsc(src));
    expect(ast.layers).toBeDefined();
    expect(ast.layers!.length).toBe(4);
    // Check order: Parallax, Terrain, Entities, UI
    expect("Parallax" in (ast.layers![0] as any)).toBe(true);
    expect("Terrain" in (ast.layers![1] as any)).toBe(true);
    expect(ast.layers![2]).toBe("Entities");
    expect("UI" in (ast.layers![3] as any)).toBe(true);
  });

  it("parses Parallax layer without optional fields", () => {
    const src = [
      'Layers:',
      '  - Parallax:',
      '      source: "sky.mzk"',
      '',
    ].join("\n");
    const ast = buildMscAst(tokenizeMsc(src));
    expect(ast.layers).toBeDefined();
    const layer = ast.layers![0] as { Parallax: any };
    expect(layer.Parallax.source).toBe("sky.mzk");
    expect(layer.Parallax.repeat).toBeUndefined();
    expect(layer.Parallax.parallaxX).toBeUndefined();
    expect(layer.Parallax.parallaxY).toBeUndefined();
  });

  it("parses Terrain layer without repeat", () => {
    const src = [
      'Layers:',
      '  - Terrain:',
      '      source: "tiles.mzk"',
      '',
    ].join("\n");
    const ast = buildMscAst(tokenizeMsc(src));
    expect(ast.layers).toBeDefined();
    const layer = ast.layers![0] as { Terrain: any };
    expect(layer.Terrain.source).toBe("tiles.mzk");
    expect(layer.Terrain.repeat).toBeUndefined();
  });
});
