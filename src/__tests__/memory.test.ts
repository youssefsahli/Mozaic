import { describe, it, expect } from "vitest";
import {
  MEMORY_BLOCKS,
  STATE_BUFFER_BYTES,
  assertBlockOffset,
  createStateBuffer,
  pixelByteOffset,
  readInt8,
  readInt16,
  readInt24,
  writeInt8,
  writeInt16,
  writeInt24,
} from "../engine/memory.js";

describe("memory blocks", () => {
  it("covers full 64x64 RGBA buffer without gaps", () => {
    const blocks = [
      MEMORY_BLOCKS.header,
      MEMORY_BLOCKS.globals,
      MEMORY_BLOCKS.entityPool,
      MEMORY_BLOCKS.audioFx,
    ];

    expect(blocks[0].startByte).toBe(0);
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i].startByte).toBe(blocks[i - 1].endByte + 1);
    }
    expect(blocks[blocks.length - 1].endByte + 1).toBe(STATE_BUFFER_BYTES);
  });

  it("validates bounds for a block", () => {
    expect(() => assertBlockOffset(MEMORY_BLOCKS.header, 16, 4)).not.toThrow();
    expect(() => assertBlockOffset(MEMORY_BLOCKS.header, 62, 2)).not.toThrow();
    expect(() => assertBlockOffset(MEMORY_BLOCKS.header, 63, 2)).toThrow();
  });
});

describe("pixelByteOffset", () => {
  it("maps (x, y) to RGBA byte index", () => {
    expect(pixelByteOffset(0, 0)).toBe(0);
    expect(pixelByteOffset(1, 0)).toBe(4);
    expect(pixelByteOffset(0, 1)).toBe(64 * 4);
  });
});

describe("int encoding", () => {
  it("reads and writes Int8", () => {
    const state = createStateBuffer();
    writeInt8(state, 64, 200);
    expect(readInt8(state, 64)).toBe(200);
  });

  it("reads and writes Int16 using R/G bytes", () => {
    const state = createStateBuffer();
    writeInt16(state, 128, 0xabcd);
    expect(state[128]).toBe(0xab);
    expect(state[129]).toBe(0xcd);
    expect(readInt16(state, 128)).toBe(0xabcd);
  });

  it("reads and writes Int24 using R/G/B bytes", () => {
    const state = createStateBuffer();
    writeInt24(state, 256, 0x123456);
    expect(state[256]).toBe(0x12);
    expect(state[257]).toBe(0x34);
    expect(state[258]).toBe(0x56);
    expect(readInt24(state, 256)).toBe(0x123456);
  });
});
