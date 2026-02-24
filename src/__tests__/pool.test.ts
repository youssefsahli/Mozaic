import { describe, it, expect } from "vitest";
import {
  createStateBuffer,
  readInt8,
  readInt16,
  writeInt8,
  writeInt16,
  MEMORY_BLOCKS,
  ENTITY_SLOT_SIZE,
  ENTITY_ACTIVE,
  ENTITY_TYPE_ID,
  ENTITY_POS_X,
  ENTITY_POS_Y,
} from "../engine/memory.js";
import { spawnEntity, eraseEntityAt } from "../engine/pool.js";

const POOL_START = MEMORY_BLOCKS.entityPool.startByte;
const POOL_END = MEMORY_BLOCKS.entityPool.endByte;
const MAX_SLOTS = Math.floor((POOL_END - POOL_START + 1) / ENTITY_SLOT_SIZE);

describe("spawnEntity", () => {
  it("claims the first empty slot and writes correct fields", () => {
    const buf = createStateBuffer();
    const ok = spawnEntity(buf, 42, 100, 200);

    expect(ok).toBe(true);
    expect(readInt8(buf, POOL_START + ENTITY_ACTIVE)).toBe(1);
    expect(readInt8(buf, POOL_START + ENTITY_TYPE_ID)).toBe(42);
    expect(readInt16(buf, POOL_START + ENTITY_POS_X)).toBe(100);
    expect(readInt16(buf, POOL_START + ENTITY_POS_Y)).toBe(200);
  });

  it("zeroes bytes 6–15 of the claimed slot", () => {
    const buf = createStateBuffer();

    // Pre-fill slot with garbage data in bytes 6–15
    for (let i = 6; i < ENTITY_SLOT_SIZE; i++) {
      buf[POOL_START + i] = 0xff;
    }

    spawnEntity(buf, 1, 0, 0);

    for (let i = 6; i < ENTITY_SLOT_SIZE; i++) {
      expect(buf[POOL_START + i]).toBe(0);
    }
  });

  it("skips occupied slots and finds the first empty one", () => {
    const buf = createStateBuffer();

    // Occupy slot 0
    writeInt8(buf, POOL_START + ENTITY_ACTIVE, 1);

    const ok = spawnEntity(buf, 7, 10, 20);

    expect(ok).toBe(true);
    // Slot 0 should still be occupied with its original data
    expect(readInt8(buf, POOL_START + ENTITY_ACTIVE)).toBe(1);
    // Slot 1 should now be claimed
    const slot1 = POOL_START + ENTITY_SLOT_SIZE;
    expect(readInt8(buf, slot1 + ENTITY_ACTIVE)).toBe(1);
    expect(readInt8(buf, slot1 + ENTITY_TYPE_ID)).toBe(7);
    expect(readInt16(buf, slot1 + ENTITY_POS_X)).toBe(10);
    expect(readInt16(buf, slot1 + ENTITY_POS_Y)).toBe(20);
  });

  it("returns false when the pool is full", () => {
    const buf = createStateBuffer();

    // Fill every slot
    for (let i = 0; i < MAX_SLOTS; i++) {
      const ptr = POOL_START + i * ENTITY_SLOT_SIZE;
      writeInt8(buf, ptr + ENTITY_ACTIVE, 1);
    }

    const ok = spawnEntity(buf, 1, 0, 0);
    expect(ok).toBe(false);
  });

  it("can spawn multiple entities sequentially", () => {
    const buf = createStateBuffer();

    expect(spawnEntity(buf, 1, 10, 20)).toBe(true);
    expect(spawnEntity(buf, 2, 30, 40)).toBe(true);
    expect(spawnEntity(buf, 3, 50, 60)).toBe(true);

    // Verify all three
    for (let i = 0; i < 3; i++) {
      const ptr = POOL_START + i * ENTITY_SLOT_SIZE;
      expect(readInt8(buf, ptr + ENTITY_ACTIVE)).toBe(1);
      expect(readInt8(buf, ptr + ENTITY_TYPE_ID)).toBe(i + 1);
    }
  });
});

describe("eraseEntityAt", () => {
  it("erases an entity whose bounding box contains the click", () => {
    const buf = createStateBuffer();
    spawnEntity(buf, 1, 100, 200);

    // Click inside the 16×16 box starting at (100, 200)
    const erased = eraseEntityAt(buf, 108, 208);
    expect(erased).toBe(true);
    expect(readInt8(buf, POOL_START + ENTITY_ACTIVE)).toBe(0);
  });

  it("returns false when no entity is under the click", () => {
    const buf = createStateBuffer();
    spawnEntity(buf, 1, 100, 200);

    // Click outside the bounding box
    const erased = eraseEntityAt(buf, 50, 50);
    expect(erased).toBe(false);
    // Entity should still be active
    expect(readInt8(buf, POOL_START + ENTITY_ACTIVE)).toBe(1);
  });

  it("only erases the first matching entity", () => {
    const buf = createStateBuffer();
    // Two overlapping entities at the same position
    spawnEntity(buf, 1, 100, 200);
    spawnEntity(buf, 2, 100, 200);

    const erased = eraseEntityAt(buf, 105, 205);
    expect(erased).toBe(true);

    // First entity erased, second still active
    expect(readInt8(buf, POOL_START + ENTITY_ACTIVE)).toBe(0);
    const slot1 = POOL_START + ENTITY_SLOT_SIZE;
    expect(readInt8(buf, slot1 + ENTITY_ACTIVE)).toBe(1);
  });

  it("hit-tests the 16×16 bounding box edges correctly", () => {
    const buf = createStateBuffer();
    spawnEntity(buf, 1, 100, 200);

    // Exact position (top-left corner) → hit
    expect(eraseEntityAt(buf, 100, 200)).toBe(true);

    // Re-spawn for more edge tests
    spawnEntity(buf, 1, 100, 200);

    // Just outside bottom-right corner → miss
    expect(eraseEntityAt(buf, 116, 216)).toBe(false);

    // Bottom-right corner (inclusive of 15 offset) → hit
    expect(eraseEntityAt(buf, 115, 215)).toBe(true);
  });

  it("returns false on an empty pool", () => {
    const buf = createStateBuffer();
    expect(eraseEntityAt(buf, 100, 200)).toBe(false);
  });
});
