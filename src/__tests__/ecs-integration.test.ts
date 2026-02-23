import { describe, it, expect } from "vitest";
import { tokenizeMsc } from "../parser/lexer.js";
import { buildMscAst } from "../parser/ast.js";
import {
  buildEvaluatorLogic,
  readSchemaVar,
} from "../engine/evaluator.js";
import { createDefaultRegistry } from "../engine/components.js";
import {
  createStateBuffer,
  readInt8,
  writeInt8,
  readInt16,
  writeInt16,
  readSignedInt16,
  writeSignedInt16,
  MEMORY_BLOCKS,
  ENTITY_SLOT_SIZE,
  ENTITY_ACTIVE,
  ENTITY_TYPE_ID,
  ENTITY_POS_X,
  ENTITY_POS_Y,
  ENTITY_VEL_X,
  ENTITY_VEL_Y,
  ENTITY_HEALTH,
} from "../engine/memory.js";
import type { EngineState } from "../engine/loop.js";
import type { InputState } from "../engine/input.js";
import type { BakedAsset } from "../engine/baker.js";
import type { MscDocument, MscSchema } from "../parser/msc.js";

function makeState(buffer?: Uint8ClampedArray): EngineState {
  return {
    buffer: buffer ?? createStateBuffer(),
    width: 64,
    height: 64,
    frameCount: 0,
  };
}

function makeInput(active: string[] = []): InputState {
  return { active: new Set(active) };
}

function makeBaked(): BakedAsset {
  return {
    width: 64,
    height: 64,
    collisionPolygons: [],
    bezierPaths: [],
    sequencerGrids: [],
  };
}

// ── AST: Component Parsing ────────────────────────────────────

describe("buildMscAst — component parsing", () => {
  it("parses component definitions from entity blocks", () => {
    const source = `
Entity.Hero:
  Visual: "hero.png"
  Gravity: { force: 2 }
  Kinematic: {}
`;
    const ast = buildMscAst(tokenizeMsc(source));

    expect(ast.entities["Hero"].visual).toBe("hero.png");
    expect(ast.entities["Hero"].components).toEqual({
      Gravity: { force: 2 },
      Kinematic: {},
    });
  });

  it("parses components with multiple properties", () => {
    const source = `
Entity.Bullet:
  Lifetime: { frames: 30 }
  Friction: { factor: 0.8 }
`;
    const ast = buildMscAst(tokenizeMsc(source));

    expect(ast.entities["Bullet"].components).toEqual({
      Lifetime: { frames: 30 },
      Friction: { factor: 0.8 },
    });
  });

  it("preserves existing entity parsing alongside components", () => {
    const source = `
Entity.Hero:
  Visual: "hero.png"
  Gravity: { force: 1 }
  Input:
    - Key_Space -> Action.Jump
`;
    const ast = buildMscAst(tokenizeMsc(source));

    expect(ast.entities["Hero"].visual).toBe("hero.png");
    expect(ast.entities["Hero"].inputs).toContainEqual({
      key: "Key_Space",
      action: "Action.Jump",
    });
    expect(ast.entities["Hero"].components).toEqual({
      Gravity: { force: 1 },
    });
  });

  it("handles entities without components gracefully", () => {
    const source = `
Entity.StaticProp:
  Visual: "tree.png"
`;
    const ast = buildMscAst(tokenizeMsc(source));
    expect(ast.entities["StaticProp"].components).toBeUndefined();
  });
});

// ── ECS Tick Integration ──────────────────────────────────────

describe("buildEvaluatorLogic — ECS entity tick", () => {
  it("executes components on active entities by type ID", () => {
    const buf = createStateBuffer();
    const poolStart = MEMORY_BLOCKS.entityPool.startByte;

    // Set up an active entity at slot 0, type ID 0
    writeInt8(buf, poolStart + ENTITY_ACTIVE, 1);
    writeInt8(buf, poolStart + ENTITY_TYPE_ID, 0);
    writeSignedInt16(buf, poolStart + ENTITY_VEL_Y, 0);

    // Script: Entity type 0 = "Hero" with Gravity
    const script: MscDocument = {
      imports: [],
      schema: {},
      entities: {
        Hero: {
          visual: "hero.png",
          components: { Gravity: { force: 5 } },
        },
      },
      events: [],
    };

    const registry = createDefaultRegistry();
    const logic = buildEvaluatorLogic(registry);
    logic(makeState(buf), makeInput(), makeBaked(), script);

    expect(readSignedInt16(buf, poolStart + ENTITY_VEL_Y)).toBe(5);
  });

  it("skips dead entities (active flag = 0)", () => {
    const buf = createStateBuffer();
    const poolStart = MEMORY_BLOCKS.entityPool.startByte;

    // Dead entity
    writeInt8(buf, poolStart + ENTITY_ACTIVE, 0);
    writeInt8(buf, poolStart + ENTITY_TYPE_ID, 0);
    writeSignedInt16(buf, poolStart + ENTITY_VEL_Y, 0);

    const script: MscDocument = {
      imports: [],
      schema: {},
      entities: {
        Hero: {
          components: { Gravity: { force: 10 } },
        },
      },
      events: [],
    };

    const registry = createDefaultRegistry();
    const logic = buildEvaluatorLogic(registry);
    logic(makeState(buf), makeInput(), makeBaked(), script);

    // Velocity should remain zero (entity was dead)
    expect(readSignedInt16(buf, poolStart + ENTITY_VEL_Y)).toBe(0);
  });

  it("processes multiple entity types correctly", () => {
    const buf = createStateBuffer();
    const poolStart = MEMORY_BLOCKS.entityPool.startByte;
    const slot0 = poolStart;
    const slot1 = poolStart + ENTITY_SLOT_SIZE;

    // Entity 0: type 0 (Hero) with Gravity
    writeInt8(buf, slot0 + ENTITY_ACTIVE, 1);
    writeInt8(buf, slot0 + ENTITY_TYPE_ID, 0);

    // Entity 1: type 1 (Enemy) with Gravity force=3
    writeInt8(buf, slot1 + ENTITY_ACTIVE, 1);
    writeInt8(buf, slot1 + ENTITY_TYPE_ID, 1);

    const script: MscDocument = {
      imports: [],
      schema: {},
      entities: {
        Hero: { components: { Gravity: { force: 1 } } },
        Enemy: { components: { Gravity: { force: 3 } } },
      },
      events: [],
    };

    const registry = createDefaultRegistry();
    const logic = buildEvaluatorLogic(registry);
    logic(makeState(buf), makeInput(), makeBaked(), script);

    expect(readSignedInt16(buf, slot0 + ENTITY_VEL_Y)).toBe(1);
    expect(readSignedInt16(buf, slot1 + ENTITY_VEL_Y)).toBe(3);
  });

  it("coexists with event-based logic", () => {
    const buf = createStateBuffer();
    const poolStart = MEMORY_BLOCKS.entityPool.startByte;

    // Entity with Gravity
    writeInt8(buf, poolStart + ENTITY_ACTIVE, 1);
    writeInt8(buf, poolStart + ENTITY_TYPE_ID, 0);

    const schema: MscSchema = { $Score: { addr: 64, type: "Int8" } };
    const script: MscDocument = {
      imports: [],
      schema,
      entities: {
        Hero: { components: { Gravity: { force: 2 } } },
      },
      events: [
        { trigger: "OnFrame", actions: ["State.$Score += 1"] },
      ],
    };

    const registry = createDefaultRegistry();
    const logic = buildEvaluatorLogic(registry);
    logic(makeState(buf), makeInput(), makeBaked(), script);

    // Event-based: score incremented
    expect(readSchemaVar(buf, schema, "$Score")).toBe(1);
    // ECS: gravity applied
    expect(readSignedInt16(buf, poolStart + ENTITY_VEL_Y)).toBe(2);
  });

  it("works without a registry (backward compatible)", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = { $X: { addr: 64, type: "Int8" } };
    const script: MscDocument = {
      imports: [],
      schema,
      entities: {},
      events: [{ trigger: "OnFrame", actions: ["State.$X = 42"] }],
    };

    const logic = buildEvaluatorLogic();
    logic(makeState(buf), makeInput(), makeBaked(), script);

    expect(readSchemaVar(buf, schema, "$X")).toBe(42);
  });

  it("survives a throwing component without crashing the frame", () => {
    const buf = createStateBuffer();
    const poolStart = MEMORY_BLOCKS.entityPool.startByte;

    writeInt8(buf, poolStart + ENTITY_ACTIVE, 1);
    writeInt8(buf, poolStart + ENTITY_TYPE_ID, 0);
    writeSignedInt16(buf, poolStart + ENTITY_VEL_Y, 0);

    const registry = createDefaultRegistry();
    registry.register("Boom", () => {
      throw new Error("kaboom");
    });

    const script: MscDocument = {
      imports: [],
      schema: {},
      entities: {
        Hero: {
          components: { Boom: {}, Gravity: { force: 7 } },
        },
      },
      events: [],
    };

    const logic = buildEvaluatorLogic(registry);
    // Should not throw; the broken component is swallowed
    expect(() =>
      logic(makeState(buf), makeInput(), makeBaked(), script)
    ).not.toThrow();

    // Gravity component after Boom should still have run
    expect(readSignedInt16(buf, poolStart + ENTITY_VEL_Y)).toBe(7);
  });
});
