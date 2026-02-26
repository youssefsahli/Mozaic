import { describe, it, expect } from "vitest";
import { buildEvaluatorLogic } from "../engine/evaluator.js";
import { createDefaultRegistry } from "../engine/components.js";
import {
  createStateBuffer,
  writeSignedInt16,
  ENTITY_VEL_X,
  ENTITY_VEL_Y,
  ENTITY_ACTIVE,
  ENTITY_TYPE_ID,
  ENTITY_DATA_START,
  MEMORY_BLOCKS
} from "../engine/memory.js";
import type { MscDocument } from "../parser/msc.js";
import type { EngineState } from "../engine/loop.js";

const ENTITY_PTR = MEMORY_BLOCKS.entityPool.startByte;

function makeState(buffer?: Uint8ClampedArray): EngineState {
  return {
    buffer: buffer ?? createStateBuffer(),
    width: 64,
    height: 64,
    frameCount: 0,
    tickCount: 0,
    camera: { x: 0, y: 0, zoom: 1, shake: 0, tint: [1, 1, 1, 1] },
  };
}

describe("Evaluator Logic - Logical Operators", () => {
  it("evaluates OR (||) conditions correctly", () => {
    // 1. Setup Script
    const script: MscDocument = {
      imports: [],
      schema: {},
      events: [],
      sprites: new Map([
        ["idle", { kind: "grid", col: 0, row: 0, frames: 1 }],
        ["walk", { kind: "grid", col: 1, row: 0, frames: 1 }],
      ]),
      spriteGrid: 16,
      entities: {
        "Hero": {
          visual: "idle",
          components: { 
            Kinematic: {},
            Animator: { speed: 1 }
          },
          states: {
            walking: {
              condition: "$vx != 0 || $vy != 0",
              visual: "walk",
              components: { Animator: { speed: 1 } }
            },
          },
        },
      },
    };

    // 2. Setup Engine State
    const buffer = createStateBuffer();
    // Activate entity at first slot
    buffer[ENTITY_PTR + ENTITY_ACTIVE] = 1;
    buffer[ENTITY_PTR + ENTITY_TYPE_ID] = 1; // Hero is index 0 -> TypeID 1

    const state = makeState(buffer);
    const registry = createDefaultRegistry();
    const logic = buildEvaluatorLogic(registry);
    const input = { active: new Set<string>() };
    const baked = {
      width: 64, height: 64,
      collisionPolygons: [], bezierPaths: [], sequencerGrids: []
    };

    // 3. Run Logic (Initial state: vx=0, vy=0 -> idle)
    // Wait, first tick might not update if Animator doesn't run or condition fails.
    // Animator needs a sprite ID.
    // Logic will see "idle" visual, map "idle"->1.
    // Sprite ID 0 -> logic sets it to 1.
    
    // We need to map sprite names to indices ourselves because logic logic does it internally.
    // Actually, logic builds spriteNameToId map internally.
    // Map order: idle (1), walk (2).
    
    logic(state, input, baked as any, script);
    
    expect(buffer[ENTITY_PTR + ENTITY_DATA_START]).toBe(1); // idle

    // 4. Change State (vx=10 -> walking)
    writeSignedInt16(buffer, ENTITY_PTR + ENTITY_VEL_X, 10);
    
    logic(state, input, baked as any, script);
    
    expect(buffer[ENTITY_PTR + ENTITY_DATA_START]).toBe(2); // walk

    // 5. Change State (vx=0, vy=-5 -> walking)
    writeSignedInt16(buffer, ENTITY_PTR + ENTITY_VEL_X, 0);
    writeSignedInt16(buffer, ENTITY_PTR + ENTITY_VEL_Y, -5);
    
    logic(state, input, baked as any, script);
    
    expect(buffer[ENTITY_PTR + ENTITY_DATA_START]).toBe(2); // walk

    // 6. Change State (vx=0, vy=0 -> idle)
    writeSignedInt16(buffer, ENTITY_PTR + ENTITY_VEL_X, 0);
    writeSignedInt16(buffer, ENTITY_PTR + ENTITY_VEL_Y, 0);
    
    logic(state, input, baked as any, script);
    
    expect(buffer[ENTITY_PTR + ENTITY_DATA_START]).toBe(1); // idle
  });
});
