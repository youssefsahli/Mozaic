import { describe, it, expect } from "vitest";
import { tokenizeMsc } from "../parser/lexer.js";
import { buildMscAst } from "../parser/ast.js";
import {
  buildEvaluatorLogic,
  readSchemaVar,
  writeSchemaVar,
} from "../engine/evaluator.js";
import { createDefaultRegistry } from "../engine/components.js";
import {
  createStateBuffer,
  readInt8,
  writeInt8,
  readSignedInt16,
  writeSignedInt16,
  MEMORY_BLOCKS,
  ENTITY_ACTIVE,
  ENTITY_TYPE_ID,
  ENTITY_POS_X,
  ENTITY_POS_Y,
  ENTITY_VEL_X,
  ENTITY_VEL_Y,
  ENTITY_DATA_START,
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
    tickCount: 0,
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

const ENTITY_PTR = MEMORY_BLOCKS.entityPool.startByte;

// ── AST: Entity State Parsing ─────────────────────────────────

describe("buildMscAst — entity state parsing", () => {
  it("parses States block with conditions and visuals", () => {
    const source = `
Entity.Hero:
  Visual: "hero_idle"
  Animator: { speed: 5 }
  States:
    walking:
      condition: "$isWalking == 1"
      Visual: "hero_walk"
    jumping:
      condition: "$isJumping == 1"
      Visual: "hero_jump"
`;
    const ast = buildMscAst(tokenizeMsc(source));

    expect(ast.entities["Hero"].states).toBeDefined();
    expect(ast.entities["Hero"].states!.walking).toEqual({
      condition: "$isWalking == 1",
      visual: "hero_walk",
    });
    expect(ast.entities["Hero"].states!.jumping).toEqual({
      condition: "$isJumping == 1",
      visual: "hero_jump",
    });
  });

  it("parses States block with component overrides", () => {
    const source = `
Entity.Hero:
  Visual: "hero_idle"
  Gravity: { force: 2 }
  States:
    flying:
      condition: "$isFlying == 1"
      Gravity: { force: 0 }
`;
    const ast = buildMscAst(tokenizeMsc(source));

    expect(ast.entities["Hero"].states!.flying).toEqual({
      condition: "$isFlying == 1",
      components: { Gravity: { force: 0 } },
    });
  });

  it("parses States with both visual and component overrides", () => {
    const source = `
Entity.Hero:
  Visual: "hero_idle"
  Gravity: { force: 2 }
  Animator: { speed: 10 }
  States:
    running:
      condition: "$speed > 0"
      Visual: "hero_run"
      Animator: { speed: 3 }
`;
    const ast = buildMscAst(tokenizeMsc(source));

    expect(ast.entities["Hero"].states!.running).toEqual({
      condition: "$speed > 0",
      visual: "hero_run",
      components: { Animator: { speed: 3 } },
    });
  });

  it("handles entities without states gracefully", () => {
    const source = `
Entity.StaticProp:
  Visual: "tree.png"
`;
    const ast = buildMscAst(tokenizeMsc(source));
    expect(ast.entities["StaticProp"].states).toBeUndefined();
  });

  it("preserves existing entity fields alongside states", () => {
    const source = `
Entity.Hero:
  Visual: "hero.png"
  Gravity: { force: 1 }
  States:
    hurt:
      condition: "$health < 50"
      Visual: "hero_hurt"
`;
    const ast = buildMscAst(tokenizeMsc(source));

    expect(ast.entities["Hero"].visual).toBe("hero.png");
    expect(ast.entities["Hero"].components).toEqual({ Gravity: { force: 1 } });
    expect(ast.entities["Hero"].states!.hurt.condition).toBe("$health < 50");
  });
});

// ── Evaluator: State-aware Animator ───────────────────────────

describe("buildEvaluatorLogic — state-aware Animator", () => {
  it("switches animation sequence based on active entity state", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {
      $isWalking: { addr: 64, type: "Int8" },
    };

    writeInt8(buf, ENTITY_PTR + ENTITY_ACTIVE, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_TYPE_ID, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_DATA_START, 1);

    const script: MscDocument = {
      imports: [],
      schema,
      entities: {
        Hero: {
          visual: "hero_idle",
          components: { Animator: { speed: 5 } },
          states: {
            walking: {
              condition: "$isWalking == 1",
              visual: "hero_walk",
            },
          },
        },
      },
      events: [],
      sprites: new Map([
        ["hero_idle", { kind: "grid" as const, col: 0, row: 0, frames: 2 }],
        ["hero_walk", { kind: "grid" as const, col: 0, row: 1, frames: 3 }],
      ]),
      spriteGrid: 16,
    };

    const registry = createDefaultRegistry();
    const logic = buildEvaluatorLogic(registry);
    const state = makeState(buf);

    // Default state: hero_idle (sprite IDs 1, 2)
    // hero_idle is first sprite → base ID 1, 2 frames
    // tickCount=0 → frameIndex = 0 → sprite 1
    state.tickCount = 0;
    logic(state, makeInput(), makeBaked(), script);
    expect(readInt8(buf, ENTITY_PTR + ENTITY_DATA_START)).toBe(1);

    // tickCount=5 → frameIndex = 1 → sprite 2
    state.tickCount = 5;
    logic(state, makeInput(), makeBaked(), script);
    expect(readInt8(buf, ENTITY_PTR + ENTITY_DATA_START)).toBe(2);

    // Now activate walking state
    writeSchemaVar(buf, schema, "$isWalking", 1);

    // Walking state: hero_walk (base ID = 1 + 2 = 3, 3 frames → [3, 4, 5])
    // tickCount=0 → frameIndex = 0 → sprite 3
    state.tickCount = 0;
    logic(state, makeInput(), makeBaked(), script);
    expect(readInt8(buf, ENTITY_PTR + ENTITY_DATA_START)).toBe(3);

    // tickCount=5 → frameIndex = 1 → sprite 4
    state.tickCount = 5;
    logic(state, makeInput(), makeBaked(), script);
    expect(readInt8(buf, ENTITY_PTR + ENTITY_DATA_START)).toBe(4);
  });

  it("falls back to default visual when no state condition matches", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {
      $isWalking: { addr: 64, type: "Int8" },
    };

    writeInt8(buf, ENTITY_PTR + ENTITY_ACTIVE, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_TYPE_ID, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_DATA_START, 1);

    const script: MscDocument = {
      imports: [],
      schema,
      entities: {
        Hero: {
          visual: "hero_idle",
          components: { Animator: { speed: 5 } },
          states: {
            walking: {
              condition: "$isWalking == 1",
              visual: "hero_walk",
            },
          },
        },
      },
      events: [],
      sprites: new Map([
        ["hero_idle", { kind: "grid" as const, col: 0, row: 0, frames: 2 }],
        ["hero_walk", { kind: "grid" as const, col: 0, row: 1, frames: 3 }],
      ]),
      spriteGrid: 16,
    };

    const registry = createDefaultRegistry();
    const logic = buildEvaluatorLogic(registry);
    const state = makeState(buf);

    // $isWalking defaults to 0, so no state matches → use hero_idle
    state.tickCount = 0;
    logic(state, makeInput(), makeBaked(), script);
    expect(readInt8(buf, ENTITY_PTR + ENTITY_DATA_START)).toBe(1); // hero_idle base
  });

  it("uses first matching state when multiple conditions match", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {
      $speed: { addr: 64, type: "Int8" },
    };

    writeInt8(buf, ENTITY_PTR + ENTITY_ACTIVE, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_TYPE_ID, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_DATA_START, 1);

    // Set $speed to 5 — both states should match, but first wins
    writeSchemaVar(buf, schema, "$speed", 5);

    const script: MscDocument = {
      imports: [],
      schema,
      entities: {
        Hero: {
          visual: "hero_idle",
          components: { Animator: { speed: 5 } },
          states: {
            walking: {
              condition: "$speed > 0",
              visual: "hero_walk",
            },
            running: {
              condition: "$speed > 3",
              visual: "hero_run",
            },
          },
        },
      },
      events: [],
      sprites: new Map([
        ["hero_idle", { kind: "grid" as const, col: 0, row: 0, frames: 1 }],
        ["hero_walk", { kind: "grid" as const, col: 0, row: 1, frames: 1 }],
        ["hero_run", { kind: "grid" as const, col: 0, row: 2, frames: 1 }],
      ]),
      spriteGrid: 16,
    };

    const registry = createDefaultRegistry();
    const logic = buildEvaluatorLogic(registry);
    const state = makeState(buf);

    state.tickCount = 0;
    logic(state, makeInput(), makeBaked(), script);

    // hero_idle = ID 1, hero_walk = ID 2, hero_run = ID 3
    // First matching state is "walking" → hero_walk → sprite 2
    expect(readInt8(buf, ENTITY_PTR + ENTITY_DATA_START)).toBe(2);
  });
});

// ── Evaluator: State-aware Components ─────────────────────────

describe("buildEvaluatorLogic — state-aware components", () => {
  it("overrides component props when entity state is active", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {
      $isFlying: { addr: 64, type: "Int8" },
    };

    writeInt8(buf, ENTITY_PTR + ENTITY_ACTIVE, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_TYPE_ID, 1);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y, 0);

    const script: MscDocument = {
      imports: [],
      schema,
      entities: {
        Hero: {
          components: { Gravity: { force: 5 } },
          states: {
            flying: {
              condition: "$isFlying == 1",
              components: { Gravity: { force: 0 } },
            },
          },
        },
      },
      events: [],
      sprites: new Map(),
      spriteGrid: 0,
    };

    const registry = createDefaultRegistry();
    const logic = buildEvaluatorLogic(registry);

    // Default state: gravity force = 5
    logic(makeState(buf), makeInput(), makeBaked(), script);
    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y)).toBe(5);

    // Activate flying state: gravity force = 0
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y, 0);
    writeSchemaVar(buf, schema, "$isFlying", 1);
    logic(makeState(buf), makeInput(), makeBaked(), script);
    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y)).toBe(0);
  });

  it("uses base component props when no state matches", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {
      $mode: { addr: 64, type: "Int8" },
    };

    writeInt8(buf, ENTITY_PTR + ENTITY_ACTIVE, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_TYPE_ID, 1);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y, 0);

    const script: MscDocument = {
      imports: [],
      schema,
      entities: {
        Hero: {
          components: { Gravity: { force: 3 } },
          states: {
            special: {
              condition: "$mode == 99",
              components: { Gravity: { force: 10 } },
            },
          },
        },
      },
      events: [],
      sprites: new Map(),
      spriteGrid: 0,
    };

    const registry = createDefaultRegistry();
    const logic = buildEvaluatorLogic(registry);

    // $mode = 0, no state matches → base gravity = 3
    logic(makeState(buf), makeInput(), makeBaked(), script);
    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y)).toBe(3);
  });

  it("state can introduce new components not in base definition", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {
      $hasGravity: { addr: 64, type: "Int8" },
    };

    writeInt8(buf, ENTITY_PTR + ENTITY_ACTIVE, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_TYPE_ID, 1);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y, 0);

    const script: MscDocument = {
      imports: [],
      schema,
      entities: {
        Hero: {
          components: { Kinematic: {} },
          states: {
            heavy: {
              condition: "$hasGravity == 1",
              components: { Gravity: { force: 7 } },
            },
          },
        },
      },
      events: [],
      sprites: new Map(),
      spriteGrid: 0,
    };

    const registry = createDefaultRegistry();
    const logic = buildEvaluatorLogic(registry);

    // Default: no gravity → vel Y stays 0
    logic(makeState(buf), makeInput(), makeBaked(), script);
    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y)).toBe(0);

    // Activate heavy state → gravity force = 7
    writeSchemaVar(buf, schema, "$hasGravity", 1);
    logic(makeState(buf), makeInput(), makeBaked(), script);
    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y)).toBe(7);
  });

  it("state-driven Animator speed override changes animation speed", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {
      $isFast: { addr: 64, type: "Int8" },
    };

    writeInt8(buf, ENTITY_PTR + ENTITY_ACTIVE, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_TYPE_ID, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_DATA_START, 1);

    const script: MscDocument = {
      imports: [],
      schema,
      entities: {
        Hero: {
          visual: "hero_walk",
          components: { Animator: { speed: 10 } },
          states: {
            fast: {
              condition: "$isFast == 1",
              components: { Animator: { speed: 2 } },
            },
          },
        },
      },
      events: [],
      sprites: new Map([
        ["hero_walk", { kind: "grid" as const, col: 0, row: 0, frames: 3 }],
      ]),
      spriteGrid: 16,
    };

    const registry = createDefaultRegistry();
    const logic = buildEvaluatorLogic(registry);

    // Default: speed=10, tickCount=5 → floor(5/10) % 3 = 0 → sprite 1
    const state = makeState(buf);
    state.tickCount = 5;
    logic(state, makeInput(), makeBaked(), script);
    expect(readInt8(buf, ENTITY_PTR + ENTITY_DATA_START)).toBe(1);

    // Activate fast state: speed=2, tickCount=5 → floor(5/2) % 3 = 2 → sprite 3
    writeSchemaVar(buf, schema, "$isFast", 1);
    state.tickCount = 5;
    logic(state, makeInput(), makeBaked(), script);
    expect(readInt8(buf, ENTITY_PTR + ENTITY_DATA_START)).toBe(3);
  });
});

// ── Evaluator: Built-in Context Variables ($vx, $vy, $px, $py) ──

describe("buildEvaluatorLogic — component getContext variables", () => {
  it("resolves $vx and $vy from Kinematic getContext for state conditions", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {};

    writeInt8(buf, ENTITY_PTR + ENTITY_ACTIVE, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_TYPE_ID, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_DATA_START, 1);

    // Set velocity: vx=3, vy=0
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_X, 3);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y, 0);

    const script: MscDocument = {
      imports: [],
      schema,
      entities: {
        Hero: {
          visual: "hero_idle",
          components: { Kinematic: {}, Animator: { speed: 5 } },
          states: {
            moving: {
              condition: "$vx != 0",
              visual: "hero_walk",
            },
          },
        },
      },
      events: [],
      sprites: new Map([
        ["hero_idle", { kind: "grid" as const, col: 0, row: 0, frames: 1 }],
        ["hero_walk", { kind: "grid" as const, col: 0, row: 1, frames: 1 }],
      ]),
      spriteGrid: 16,
    };

    const registry = createDefaultRegistry();
    const logic = buildEvaluatorLogic(registry);
    const state = makeState(buf);

    state.tickCount = 0;
    logic(state, makeInput(), makeBaked(), script);
    // hero_idle = ID 1, hero_walk = ID 2; $vx=3 != 0 → moving → hero_walk → sprite 2
    expect(readInt8(buf, ENTITY_PTR + ENTITY_DATA_START)).toBe(2);
  });

  it("handles negative velocity values correctly", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {};

    writeInt8(buf, ENTITY_PTR + ENTITY_ACTIVE, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_TYPE_ID, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_DATA_START, 1);

    // Set velocity: vx=-5
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_X, -5);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y, 0);

    const script: MscDocument = {
      imports: [],
      schema,
      entities: {
        Hero: {
          visual: "hero_idle",
          components: { Kinematic: {}, Animator: { speed: 5 } },
          states: {
            movingLeft: {
              condition: "$vx < 0",
              visual: "hero_walk",
            },
          },
        },
      },
      events: [],
      sprites: new Map([
        ["hero_idle", { kind: "grid" as const, col: 0, row: 0, frames: 1 }],
        ["hero_walk", { kind: "grid" as const, col: 0, row: 1, frames: 1 }],
      ]),
      spriteGrid: 16,
    };

    const registry = createDefaultRegistry();
    const logic = buildEvaluatorLogic(registry);
    const state = makeState(buf);

    state.tickCount = 0;
    logic(state, makeInput(), makeBaked(), script);
    // $vx=-5 < 0 → movingLeft → hero_walk → sprite 2
    expect(readInt8(buf, ENTITY_PTR + ENTITY_DATA_START)).toBe(2);
  });

  it("resolves $px and $py from Kinematic getContext", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {};

    writeInt8(buf, ENTITY_PTR + ENTITY_ACTIVE, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_TYPE_ID, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_DATA_START, 1);

    // Set position: px=100, py=50
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_POS_X, 100);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_POS_Y, 50);

    const script: MscDocument = {
      imports: [],
      schema,
      entities: {
        Hero: {
          visual: "hero_idle",
          components: { Kinematic: {}, Animator: { speed: 5 } },
          states: {
            farRight: {
              condition: "$px > 50",
              visual: "hero_walk",
            },
          },
        },
      },
      events: [],
      sprites: new Map([
        ["hero_idle", { kind: "grid" as const, col: 0, row: 0, frames: 1 }],
        ["hero_walk", { kind: "grid" as const, col: 0, row: 1, frames: 1 }],
      ]),
      spriteGrid: 16,
    };

    const registry = createDefaultRegistry();
    const logic = buildEvaluatorLogic(registry);
    const state = makeState(buf);

    state.tickCount = 0;
    logic(state, makeInput(), makeBaked(), script);
    // $px=100 > 50 → farRight → hero_walk → sprite 2
    expect(readInt8(buf, ENTITY_PTR + ENTITY_DATA_START)).toBe(2);
  });

  it("falls back to schema variable when no component provides the variable", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {
      $health: { addr: 64, type: "Int8" },
    };

    writeInt8(buf, ENTITY_PTR + ENTITY_ACTIVE, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_TYPE_ID, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_DATA_START, 1);
    writeSchemaVar(buf, schema, "$health", 0);

    const script: MscDocument = {
      imports: [],
      schema,
      entities: {
        Hero: {
          visual: "hero_idle",
          components: { Animator: { speed: 5 } },
          states: {
            dead: {
              condition: "$health == 0",
              visual: "hero_dead",
            },
          },
        },
      },
      events: [],
      sprites: new Map([
        ["hero_idle", { kind: "grid" as const, col: 0, row: 0, frames: 1 }],
        ["hero_dead", { kind: "grid" as const, col: 0, row: 1, frames: 1 }],
      ]),
      spriteGrid: 16,
    };

    const registry = createDefaultRegistry();
    const logic = buildEvaluatorLogic(registry);
    const state = makeState(buf);

    state.tickCount = 0;
    logic(state, makeInput(), makeBaked(), script);
    // $health=0 == 0 → dead → hero_dead → sprite 2
    expect(readInt8(buf, ENTITY_PTR + ENTITY_DATA_START)).toBe(2);
  });

  it("does not match when component context variable condition is not met", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {};

    writeInt8(buf, ENTITY_PTR + ENTITY_ACTIVE, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_TYPE_ID, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_DATA_START, 1);

    // Set velocity: vx=0, vy=0 (not moving)
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_X, 0);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y, 0);

    const script: MscDocument = {
      imports: [],
      schema,
      entities: {
        Hero: {
          visual: "hero_idle",
          components: { Kinematic: {}, Animator: { speed: 5 } },
          states: {
            moving: {
              condition: "$vx != 0",
              visual: "hero_walk",
            },
          },
        },
      },
      events: [],
      sprites: new Map([
        ["hero_idle", { kind: "grid" as const, col: 0, row: 0, frames: 1 }],
        ["hero_walk", { kind: "grid" as const, col: 0, row: 1, frames: 1 }],
      ]),
      spriteGrid: 16,
    };

    const registry = createDefaultRegistry();
    const logic = buildEvaluatorLogic(registry);
    const state = makeState(buf);

    state.tickCount = 0;
    logic(state, makeInput(), makeBaked(), script);
    // $vx=0 → no state matches → hero_idle → sprite 1
    expect(readInt8(buf, ENTITY_PTR + ENTITY_DATA_START)).toBe(1);
  });

  it("does not provide context variables when entity lacks component with getContext", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {};

    writeInt8(buf, ENTITY_PTR + ENTITY_ACTIVE, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_TYPE_ID, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_DATA_START, 1);

    // Set velocity in buffer, but entity has no Kinematic component
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_X, 5);

    const script: MscDocument = {
      imports: [],
      schema,
      entities: {
        Hero: {
          visual: "hero_idle",
          components: { Animator: { speed: 5 } },
          states: {
            moving: {
              condition: "$vx != 0",
              visual: "hero_walk",
            },
          },
        },
      },
      events: [],
      sprites: new Map([
        ["hero_idle", { kind: "grid" as const, col: 0, row: 0, frames: 1 }],
        ["hero_walk", { kind: "grid" as const, col: 0, row: 1, frames: 1 }],
      ]),
      spriteGrid: 16,
    };

    const registry = createDefaultRegistry();
    const logic = buildEvaluatorLogic(registry);
    const state = makeState(buf);

    state.tickCount = 0;
    logic(state, makeInput(), makeBaked(), script);
    // No Kinematic component → $vx not in context → falls back to schema → 0 → no match
    expect(readInt8(buf, ENTITY_PTR + ENTITY_DATA_START)).toBe(1);
  });
});
