/**
 * State Buffer Memory Manager
 *
 * Provides fixed-layout access helpers for Mozaic's RGBA-backed state buffer.
 */

export const STATE_GRID_WIDTH = 64;
export const STATE_GRID_HEIGHT = 64;
export const CHANNELS_PER_PIXEL = 4;
export const STATE_BUFFER_BYTES =
  STATE_GRID_WIDTH * STATE_GRID_HEIGHT * CHANNELS_PER_PIXEL;

export interface MemoryBlock {
  name: "header" | "globals" | "entityPool" | "audioFx";
  startByte: number;
  endByte: number;
}

export const MEMORY_BLOCKS: Record<MemoryBlock["name"], MemoryBlock> = {
  header: { name: "header", startByte: 0, endByte: 63 },
  globals: { name: "globals", startByte: 64, endByte: 511 },
  entityPool: { name: "entityPool", startByte: 512, endByte: 12287 },
  audioFx: { name: "audioFx", startByte: 12288, endByte: 16383 },
};

export function createStateBuffer(
  width = STATE_GRID_WIDTH,
  height = STATE_GRID_HEIGHT
): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * CHANNELS_PER_PIXEL);
}

export function pixelByteOffset(
  x: number,
  y: number,
  width = STATE_GRID_WIDTH
): number {
  if (x < 0 || y < 0 || x >= width) {
    throw new RangeError(`Pixel out of bounds at (${x}, ${y})`);
  }
  return (y * width + x) * CHANNELS_PER_PIXEL;
}

export function readInt8(buffer: Uint8ClampedArray, byteOffset: number): number {
  assertOffset(buffer, byteOffset);
  return buffer[byteOffset];
}

export function writeInt8(
  buffer: Uint8ClampedArray,
  byteOffset: number,
  value: number
): void {
  assertOffset(buffer, byteOffset);
  buffer[byteOffset] = clampByte(value);
}

export function readInt16(buffer: Uint8ClampedArray, byteOffset: number): number {
  assertOffset(buffer, byteOffset + 1);
  const high = buffer[byteOffset];
  const low = buffer[byteOffset + 1];
  return (high << 8) | low;
}

export function writeInt16(
  buffer: Uint8ClampedArray,
  byteOffset: number,
  value: number
): void {
  assertOffset(buffer, byteOffset + 1);
  const normalized = value & 0xffff;
  buffer[byteOffset] = (normalized >> 8) & 0xff;
  buffer[byteOffset + 1] = normalized & 0xff;
}

export function readInt24(buffer: Uint8ClampedArray, byteOffset: number): number {
  assertOffset(buffer, byteOffset + 2);
  const b0 = buffer[byteOffset];
  const b1 = buffer[byteOffset + 1];
  const b2 = buffer[byteOffset + 2];
  return (b0 << 16) | (b1 << 8) | b2;
}

export function writeInt24(
  buffer: Uint8ClampedArray,
  byteOffset: number,
  value: number
): void {
  assertOffset(buffer, byteOffset + 2);
  const normalized = value & 0xffffff;
  buffer[byteOffset] = (normalized >> 16) & 0xff;
  buffer[byteOffset + 1] = (normalized >> 8) & 0xff;
  buffer[byteOffset + 2] = normalized & 0xff;
}

export function assertBlockOffset(
  block: MemoryBlock,
  byteOffset: number,
  byteLength = 1
): void {
  if (byteOffset < block.startByte || byteOffset + byteLength - 1 > block.endByte) {
    throw new RangeError(
      `Offset ${byteOffset} (len=${byteLength}) exceeds block ${block.name} bounds`
    );
  }
}

function assertOffset(buffer: Uint8ClampedArray, byteOffset: number): void {
  if (byteOffset < 0 || byteOffset >= buffer.length) {
    throw new RangeError(`Byte offset ${byteOffset} out of bounds`);
  }
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}
