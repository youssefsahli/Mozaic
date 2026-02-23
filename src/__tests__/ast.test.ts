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
});
