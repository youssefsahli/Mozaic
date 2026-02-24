import { describe, it, expect } from "vitest";
import { applyKinematic, applyGravity, ecsTick } from "../engine/ecs.js";
import {
  createStateBuffer,
  readInt8,
  writeInt8,
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
  ENTITY_DATA_START,
} from "../engine/memory.js";
import type { EngineState } from "../engine/loop.js";
import type { MscDocument } from "../parser/msc.js";

function makeState(buffer?: Uint8ClampedArray): EngineState {
  return {
    buffer: buffer ?? createStateBuffer(),
    width: 64,
    height: 64,
    frameCount: 0,
  };
}

// ── applyKinematic ────────────────────────────────────────────

describe("applyKinematic", () => {
  it("adds velocity to position", () => {
    const buf = createStateBuffer();
    const ptr = MEMORY_BLOCKS.entityPool.startByte;

    writeSignedInt16(buf, ptr + ENTITY_POS_X, 100);
    writeSignedInt16(buf, ptr + ENTITY_POS_Y, 200);
    writeSignedInt16(buf, ptr + ENTITY_VEL_X, 3);
    writeSignedInt16(buf, ptr + ENTITY_VEL_Y, -5);

    applyKinematic(buf, ptr);

    expect(readSignedInt16(buf, ptr + ENTITY_POS_X)).toBe(103);
    expect(readSignedInt16(buf, ptr + ENTITY_POS_Y)).toBe(195);
  });

  it("handles zero velocity (no movement)", () => {
    const buf = createStateBuffer();
    const ptr = MEMORY_BLOCKS.entityPool.startByte;

    writeSignedInt16(buf, ptr + ENTITY_POS_X, 50);
    writeSignedInt16(buf, ptr + ENTITY_POS_Y, 50);
    writeSignedInt16(buf, ptr + ENTITY_VEL_X, 0);
    writeSignedInt16(buf, ptr + ENTITY_VEL_Y, 0);

    applyKinematic(buf, ptr);

    expect(readSignedInt16(buf, ptr + ENTITY_POS_X)).toBe(50);
    expect(readSignedInt16(buf, ptr + ENTITY_POS_Y)).toBe(50);
  });

  it("handles negative velocity", () => {
    const buf = createStateBuffer();
    const ptr = MEMORY_BLOCKS.entityPool.startByte;

    writeSignedInt16(buf, ptr + ENTITY_POS_X, 10);
    writeSignedInt16(buf, ptr + ENTITY_POS_Y, 20);
    writeSignedInt16(buf, ptr + ENTITY_VEL_X, -3);
    writeSignedInt16(buf, ptr + ENTITY_VEL_Y, -7);

    applyKinematic(buf, ptr);

    expect(readSignedInt16(buf, ptr + ENTITY_POS_X)).toBe(7);
    expect(readSignedInt16(buf, ptr + ENTITY_POS_Y)).toBe(13);
  });
});

// ── applyGravity ──────────────────────────────────────────────

describe("applyGravity", () => {
  it("adds force to velocity Y", () => {
    const buf = createStateBuffer();
    const ptr = MEMORY_BLOCKS.entityPool.startByte;

    writeSignedInt16(buf, ptr + ENTITY_VEL_Y, 0);
    applyGravity(buf, ptr, 5, 100);

    expect(readSignedInt16(buf, ptr + ENTITY_VEL_Y)).toBe(5);
  });

  it("clamps to terminal velocity", () => {
    const buf = createStateBuffer();
    const ptr = MEMORY_BLOCKS.entityPool.startByte;

    writeSignedInt16(buf, ptr + ENTITY_VEL_Y, 90);
    applyGravity(buf, ptr, 20, 100);

    expect(readSignedInt16(buf, ptr + ENTITY_VEL_Y)).toBe(100);
  });

  it("does not clamp when below terminal velocity", () => {
    const buf = createStateBuffer();
    const ptr = MEMORY_BLOCKS.entityPool.startByte;

    writeSignedInt16(buf, ptr + ENTITY_VEL_Y, 10);
    applyGravity(buf, ptr, 5, 100);

    expect(readSignedInt16(buf, ptr + ENTITY_VEL_Y)).toBe(15);
  });
});

// ── ecsTick ───────────────────────────────────────────────────

describe("ecsTick", () => {
  it("applies Kinematic to active entities", () => {
    const buf = createStateBuffer();
    const ptr = MEMORY_BLOCKS.entityPool.startByte;

    writeInt8(buf, ptr + ENTITY_ACTIVE, 1);
    writeInt8(buf, ptr + ENTITY_TYPE_ID, 1);
    writeSignedInt16(buf, ptr + ENTITY_POS_X, 10);
    writeSignedInt16(buf, ptr + ENTITY_POS_Y, 20);
    writeSignedInt16(buf, ptr + ENTITY_VEL_X, 2);
    writeSignedInt16(buf, ptr + ENTITY_VEL_Y, 3);

    const script: MscDocument = {
      imports: [],
      schema: {},
      entities: { Player: { components: { Kinematic: {} } } },
      events: [],
      sprites: new Map(),
      spriteGrid: 0,
    };

    ecsTick(makeState(buf), script);

    expect(readSignedInt16(buf, ptr + ENTITY_POS_X)).toBe(12);
    expect(readSignedInt16(buf, ptr + ENTITY_POS_Y)).toBe(23);
  });

  it("applies Gravity then Kinematic in order", () => {
    const buf = createStateBuffer();
    const ptr = MEMORY_BLOCKS.entityPool.startByte;

    writeInt8(buf, ptr + ENTITY_ACTIVE, 1);
    writeInt8(buf, ptr + ENTITY_TYPE_ID, 1);
    writeSignedInt16(buf, ptr + ENTITY_POS_X, 0);
    writeSignedInt16(buf, ptr + ENTITY_POS_Y, 0);
    writeSignedInt16(buf, ptr + ENTITY_VEL_X, 0);
    writeSignedInt16(buf, ptr + ENTITY_VEL_Y, 0);

    const script: MscDocument = {
      imports: [],
      schema: {},
      entities: {
        Player: {
          components: {
            Gravity: { force: 2, terminalVelocity: 100 },
            Kinematic: {},
          },
        },
      },
      events: [],
      sprites: new Map(),
      spriteGrid: 0,
    };

    ecsTick(makeState(buf), script);

    // Gravity adds 2 to VelY → VelY=2, then Kinematic adds VelY to PosY
    expect(readSignedInt16(buf, ptr + ENTITY_VEL_Y)).toBe(2);
    expect(readSignedInt16(buf, ptr + ENTITY_POS_Y)).toBe(2);
  });

  it("skips dead entities", () => {
    const buf = createStateBuffer();
    const ptr = MEMORY_BLOCKS.entityPool.startByte;

    writeInt8(buf, ptr + ENTITY_ACTIVE, 0);
    writeInt8(buf, ptr + ENTITY_TYPE_ID, 1);
    writeSignedInt16(buf, ptr + ENTITY_VEL_Y, 0);

    const script: MscDocument = {
      imports: [],
      schema: {},
      entities: { Player: { components: { Gravity: { force: 10 } } } },
      events: [],
      sprites: new Map(),
      spriteGrid: 0,
    };

    ecsTick(makeState(buf), script);

    expect(readSignedInt16(buf, ptr + ENTITY_VEL_Y)).toBe(0);
  });

  it("initialises Sprite ID from entity visual", () => {
    const buf = createStateBuffer();
    const ptr = MEMORY_BLOCKS.entityPool.startByte;

    writeInt8(buf, ptr + ENTITY_ACTIVE, 1);
    writeInt8(buf, ptr + ENTITY_TYPE_ID, 1);
    writeInt8(buf, ptr + ENTITY_DATA_START, 0); // no sprite yet

    const script: MscDocument = {
      imports: [],
      schema: {},
      entities: { Player: { visual: "hero_idle" } },
      events: [],
      sprites: new Map([
        ["hero_idle", { kind: "grid", col: 0, row: 0, frames: 1 }],
      ]),
      spriteGrid: 16,
    };

    ecsTick(makeState(buf), script);

    // hero_idle is the first sprite → Sprite ID 1
    expect(readInt8(buf, ptr + ENTITY_DATA_START)).toBe(1);
  });

  it("does not overwrite existing Sprite ID", () => {
    const buf = createStateBuffer();
    const ptr = MEMORY_BLOCKS.entityPool.startByte;

    writeInt8(buf, ptr + ENTITY_ACTIVE, 1);
    writeInt8(buf, ptr + ENTITY_TYPE_ID, 1);
    writeInt8(buf, ptr + ENTITY_DATA_START, 5); // already set

    const script: MscDocument = {
      imports: [],
      schema: {},
      entities: { Player: { visual: "hero_idle" } },
      events: [],
      sprites: new Map([
        ["hero_idle", { kind: "grid", col: 0, row: 0, frames: 1 }],
      ]),
      spriteGrid: 16,
    };

    ecsTick(makeState(buf), script);

    expect(readInt8(buf, ptr + ENTITY_DATA_START)).toBe(5);
  });
});
