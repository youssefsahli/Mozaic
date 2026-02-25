import { describe, it, expect } from "vitest";
import {
  applyKinematic,
  applyGravity,
  applyTopDownController,
  applyPlatformerController,
  applyAnimator,
  applyCollider,
  ecsTick,
} from "../engine/ecs.js";
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
import type { InputState } from "../engine/input.js";
import type { BakedAsset } from "../engine/baker.js";
import type { MscDocument } from "../parser/msc.js";

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

    ecsTick(makeState(buf), makeInput(), makeBaked(), script);

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

    ecsTick(makeState(buf), makeInput(), makeBaked(), script);

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

    ecsTick(makeState(buf), makeInput(), makeBaked(), script);

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

    ecsTick(makeState(buf), makeInput(), makeBaked(), script);

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

    ecsTick(makeState(buf), makeInput(), makeBaked(), script);

    expect(readInt8(buf, ptr + ENTITY_DATA_START)).toBe(5);
  });

  it("resolves Animator sequence from entity visual sprite definition", () => {
    const buf = createStateBuffer();
    const ptr = MEMORY_BLOCKS.entityPool.startByte;

    writeInt8(buf, ptr + ENTITY_ACTIVE, 1);
    writeInt8(buf, ptr + ENTITY_TYPE_ID, 1);
    writeInt8(buf, ptr + ENTITY_DATA_START, 1); // initial sprite
    writeInt8(buf, ptr + 12, 0); // timer = 0, so frame advances immediately
    writeInt8(buf, ptr + 13, 0); // sequence index = 0

    const script: MscDocument = {
      imports: [],
      schema: {},
      entities: {
        Player: {
          visual: "hero_walk",
          components: { Animator: { speed: 5 } },
        },
      },
      events: [],
      sprites: new Map([
        ["hero_walk", { kind: "grid", col: 0, row: 0, frames: 3 }],
      ]),
      spriteGrid: 16,
    };

    // hero_walk is sprite ID 1 with 3 frames → sequence [1, 2, 3]
    ecsTick(makeState(buf), makeInput(), makeBaked(), script);

    // Timer=0 → advances to next frame (index 1), sets sprite to 2
    expect(readInt8(buf, ptr + ENTITY_DATA_START)).toBe(2);
    expect(readInt8(buf, ptr + 12)).toBe(5); // timer reset to speed
    expect(readInt8(buf, ptr + 13)).toBe(1); // sequence index advanced
  });
});

// ── applyAnimator ─────────────────────────────────────────────

describe("applyAnimator", () => {
  it("decrements timer on each call when timer > 0", () => {
    const buf = createStateBuffer();
    const ptr = MEMORY_BLOCKS.entityPool.startByte;

    // Set timer to 3
    writeInt8(buf, ptr + 12, 3);
    writeInt8(buf, ptr + 13, 0);
    writeInt8(buf, ptr + ENTITY_DATA_START, 10); // current sprite ID

    applyAnimator(buf, ptr, [10, 20, 30], 5);

    // Timer should decrement: 3 → 2
    expect(readInt8(buf, ptr + 12)).toBe(2);
    // Sequence index and sprite ID unchanged
    expect(readInt8(buf, ptr + 13)).toBe(0);
    expect(readInt8(buf, ptr + ENTITY_DATA_START)).toBe(10);
  });

  it("advances frame and resets timer when timer reaches 0", () => {
    const buf = createStateBuffer();
    const ptr = MEMORY_BLOCKS.entityPool.startByte;

    // Timer at 0 → should advance
    writeInt8(buf, ptr + 12, 0);
    writeInt8(buf, ptr + 13, 0);
    writeInt8(buf, ptr + ENTITY_DATA_START, 10);

    applyAnimator(buf, ptr, [10, 20, 30], 5);

    // Timer reset to speed
    expect(readInt8(buf, ptr + 12)).toBe(5);
    // Index advanced: 0 → 1
    expect(readInt8(buf, ptr + 13)).toBe(1);
    // Sprite ID updated to sequenceArray[1]
    expect(readInt8(buf, ptr + ENTITY_DATA_START)).toBe(20);
  });

  it("wraps sequence index around when reaching end", () => {
    const buf = createStateBuffer();
    const ptr = MEMORY_BLOCKS.entityPool.startByte;

    // Timer at 0, index at last position (2 in a 3-element array)
    writeInt8(buf, ptr + 12, 0);
    writeInt8(buf, ptr + 13, 2);
    writeInt8(buf, ptr + ENTITY_DATA_START, 30);

    applyAnimator(buf, ptr, [10, 20, 30], 4);

    // Index wraps: (2 + 1) % 3 = 0
    expect(readInt8(buf, ptr + 13)).toBe(0);
    // Sprite ID set to sequenceArray[0]
    expect(readInt8(buf, ptr + ENTITY_DATA_START)).toBe(10);
    // Timer reset
    expect(readInt8(buf, ptr + 12)).toBe(4);
  });

  it("updates bytes 11, 12, 13 correctly over consecutive ticks", () => {
    const buf = createStateBuffer();
    const ptr = MEMORY_BLOCKS.entityPool.startByte;
    const seq = [5, 15, 25];
    const speed = 2;

    // Initial state: timer=0, index=0
    writeInt8(buf, ptr + 12, 0);
    writeInt8(buf, ptr + 13, 0);
    writeInt8(buf, ptr + ENTITY_DATA_START, 0);

    // Tick 1: timer=0 → advance to index 1, reset timer to 2
    applyAnimator(buf, ptr, seq, speed);
    expect(readInt8(buf, ptr + ENTITY_DATA_START)).toBe(15); // byte 11
    expect(readInt8(buf, ptr + 12)).toBe(2);                 // byte 12
    expect(readInt8(buf, ptr + 13)).toBe(1);                 // byte 13

    // Tick 2: timer=2 → decrement to 1
    applyAnimator(buf, ptr, seq, speed);
    expect(readInt8(buf, ptr + ENTITY_DATA_START)).toBe(15);
    expect(readInt8(buf, ptr + 12)).toBe(1);
    expect(readInt8(buf, ptr + 13)).toBe(1);

    // Tick 3: timer=1 → decrement to 0
    applyAnimator(buf, ptr, seq, speed);
    expect(readInt8(buf, ptr + ENTITY_DATA_START)).toBe(15);
    expect(readInt8(buf, ptr + 12)).toBe(0);
    expect(readInt8(buf, ptr + 13)).toBe(1);

    // Tick 4: timer=0 → advance to index 2, reset timer to 2
    applyAnimator(buf, ptr, seq, speed);
    expect(readInt8(buf, ptr + ENTITY_DATA_START)).toBe(25); // byte 11
    expect(readInt8(buf, ptr + 12)).toBe(2);                 // byte 12
    expect(readInt8(buf, ptr + 13)).toBe(2);                 // byte 13

    // Tick 5: timer=2 → decrement to 1
    applyAnimator(buf, ptr, seq, speed);
    expect(readInt8(buf, ptr + 12)).toBe(1);

    // Tick 6: timer=1 → decrement to 0
    applyAnimator(buf, ptr, seq, speed);
    expect(readInt8(buf, ptr + 12)).toBe(0);

    // Tick 7: timer=0 → advance, wraps to index 0
    applyAnimator(buf, ptr, seq, speed);
    expect(readInt8(buf, ptr + ENTITY_DATA_START)).toBe(5);  // byte 11
    expect(readInt8(buf, ptr + 12)).toBe(2);                 // byte 12
    expect(readInt8(buf, ptr + 13)).toBe(0);                 // byte 13
  });
});

// ── applyCollider ─────────────────────────────────────────────

describe("applyCollider", () => {
  it("clamps PosX to 0 when negative", () => {
    const buf = createStateBuffer();
    const ptr = MEMORY_BLOCKS.entityPool.startByte;
    const state = makeState(buf);

    writeSignedInt16(buf, ptr + ENTITY_POS_X, -5);
    writeSignedInt16(buf, ptr + ENTITY_VEL_X, -3);

    applyCollider(state, buf, ptr);

    expect(readSignedInt16(buf, ptr + ENTITY_POS_X)).toBe(0);
    expect(readSignedInt16(buf, ptr + ENTITY_VEL_X)).toBe(0);
  });

  it("clamps PosX to width - 16 when exceeding right boundary", () => {
    const buf = createStateBuffer();
    const ptr = MEMORY_BLOCKS.entityPool.startByte;
    const state = makeState(buf); // width = 64

    writeSignedInt16(buf, ptr + ENTITY_POS_X, 60);
    writeSignedInt16(buf, ptr + ENTITY_VEL_X, 5);

    applyCollider(state, buf, ptr);

    expect(readSignedInt16(buf, ptr + ENTITY_POS_X)).toBe(48); // 64 - 16
    expect(readSignedInt16(buf, ptr + ENTITY_VEL_X)).toBe(0);
  });

  it("clamps PosY to 0 when negative", () => {
    const buf = createStateBuffer();
    const ptr = MEMORY_BLOCKS.entityPool.startByte;
    const state = makeState(buf);

    writeSignedInt16(buf, ptr + ENTITY_POS_Y, -10);
    writeSignedInt16(buf, ptr + ENTITY_VEL_Y, -2);

    applyCollider(state, buf, ptr);

    expect(readSignedInt16(buf, ptr + ENTITY_POS_Y)).toBe(0);
    expect(readSignedInt16(buf, ptr + ENTITY_VEL_Y)).toBe(0);
  });

  it("clamps PosY to height - 16 when exceeding bottom boundary", () => {
    const buf = createStateBuffer();
    const ptr = MEMORY_BLOCKS.entityPool.startByte;
    const state = makeState(buf); // height = 64

    writeSignedInt16(buf, ptr + ENTITY_POS_Y, 55);
    writeSignedInt16(buf, ptr + ENTITY_VEL_Y, 4);

    applyCollider(state, buf, ptr);

    expect(readSignedInt16(buf, ptr + ENTITY_POS_Y)).toBe(48); // 64 - 16
    expect(readSignedInt16(buf, ptr + ENTITY_VEL_Y)).toBe(0);
  });

  it("does not modify position when within bounds", () => {
    const buf = createStateBuffer();
    const ptr = MEMORY_BLOCKS.entityPool.startByte;
    const state = makeState(buf);

    writeSignedInt16(buf, ptr + ENTITY_POS_X, 20);
    writeSignedInt16(buf, ptr + ENTITY_POS_Y, 30);
    writeSignedInt16(buf, ptr + ENTITY_VEL_X, 2);
    writeSignedInt16(buf, ptr + ENTITY_VEL_Y, 3);

    applyCollider(state, buf, ptr);

    expect(readSignedInt16(buf, ptr + ENTITY_POS_X)).toBe(20);
    expect(readSignedInt16(buf, ptr + ENTITY_POS_Y)).toBe(30);
    expect(readSignedInt16(buf, ptr + ENTITY_VEL_X)).toBe(2);
    expect(readSignedInt16(buf, ptr + ENTITY_VEL_Y)).toBe(3);
  });
});
