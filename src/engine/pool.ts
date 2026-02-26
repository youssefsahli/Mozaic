/**
 * Dynamic Object Pooling — Zero-Allocation Runtime Primitives
 *
 * Three pooling strategies to eliminate per-frame GC pressure:
 *   1. RingBuffer<T>  — circular buffer for ephemeral objects (collision events, etc.)
 *   2. ObjectPool<T>  — free-list pool with dynamic reallocation for reusable objects
 *   3. EntityFreeList — O(1) slot manager for the state-buffer entity region
 *
 * Also provides direct state-buffer helpers for spawning / erasing entities
 * in the entityPool memory region (bytes 512–12287).
 */

import {
  MEMORY_BLOCKS,
  ENTITY_SLOT_SIZE,
  ENTITY_ACTIVE,
  ENTITY_TYPE_ID,
  ENTITY_POS_X,
  ENTITY_POS_Y,
  readInt8,
  writeInt8,
  readSignedInt16,
  writeSignedInt16,
} from "./memory.js";

/**
 * Spawn an entity into the first available slot of the entityPool region.
 *
 * Iterates through the entity pool starting at offset 512, stepping by 16,
 * up to 12287.  When an empty slot (ActiveFlag === 0) is found it is
 * claimed and initialised with the provided type and position.
 *
 * @returns `true` if an empty slot was found and written, `false` if the
 *          pool is full.
 */
export function spawnEntity(
  buffer: Uint8ClampedArray,
  typeId: number,
  x: number,
  y: number,
): boolean {
  const { startByte, endByte } = MEMORY_BLOCKS.entityPool;

  for (let ptr = startByte; ptr + ENTITY_SLOT_SIZE - 1 <= endByte; ptr += ENTITY_SLOT_SIZE) {
    if (readInt8(buffer, ptr + ENTITY_ACTIVE) === 0) {
      writeInt8(buffer, ptr + ENTITY_ACTIVE, 1);
      writeInt8(buffer, ptr + ENTITY_TYPE_ID, typeId);
      writeSignedInt16(buffer, ptr + ENTITY_POS_X, x);
      writeSignedInt16(buffer, ptr + ENTITY_POS_Y, y);

      // Zero residual bytes (velocity, health, data) to prevent stale data
      for (let i = 6; i < ENTITY_SLOT_SIZE; i++) {
        buffer[ptr + i] = 0;
      }

      return true;
    }
  }

  return false;
}

/**
 * Erase the first active entity whose 16×16 bounding box contains (x, y).
 *
 * Iterates through the entity pool.  For each active entity the stored
 * position is read and a hit-test is performed against a 16×16 region
 * anchored at that position.  On hit the entity's ActiveFlag is cleared
 * and the function returns `true`.
 *
 * @returns `true` if an entity was erased, `false` otherwise.
 */
export function eraseEntityAt(
  buffer: Uint8ClampedArray,
  x: number,
  y: number,
): boolean {
  const { startByte, endByte } = MEMORY_BLOCKS.entityPool;

  for (let ptr = startByte; ptr + ENTITY_SLOT_SIZE - 1 <= endByte; ptr += ENTITY_SLOT_SIZE) {
    if (readInt8(buffer, ptr + ENTITY_ACTIVE) !== 1) continue;

    const ex = readSignedInt16(buffer, ptr + ENTITY_POS_X);
    const ey = readSignedInt16(buffer, ptr + ENTITY_POS_Y);

    if (x >= ex && x < ex + 16 && y >= ey && y < ey + 16) {
      writeInt8(buffer, ptr + ENTITY_ACTIVE, 0);
      return true;
    }
  }

  return false;
}

/**
 * Ring buffer for ephemeral objects that are written once and
 * overwritten on the next cycle.  Zero alloc/dealloc after init.
 *
 * Usage:
 *   const ring = new RingBuffer(64, () => ({ x: 0, y: 0 }));
 *   const pt = ring.next();   // returns pre-allocated slot
 *   pt.x = 10; pt.y = 20;    // caller mutates in place
 */
export class RingBuffer<T> {
  readonly capacity: number;
  private cursor = 0;
  private readonly items: T[];

  constructor(capacity: number, factory: () => T) {
    if (capacity < 1) throw new RangeError("RingBuffer capacity must be >= 1");
    this.capacity = capacity;
    this.items = new Array<T>(capacity);
    for (let i = 0; i < capacity; i++) {
      this.items[i] = factory();
    }
  }

  /** Return the next pre-allocated slot (advances the cursor). */
  next(): T {
    const item = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.capacity;
    return item;
  }

  /** Reset the cursor to the beginning. */
  reset(): void {
    this.cursor = 0;
  }
}

/**
 * Generic free-list object pool with dynamic reallocation.
 *
 * Objects are pre-allocated at construction.  `acquire()` pops an
 * object from the free stack in O(1) and calls the reset function.
 * `release()` pushes it back in O(1).
 *
 * When the pool is exhausted, it doubles its capacity and logs a
 * warning so the developer can tune the initial size.
 */
export class ObjectPool<T> {
  private objects: T[];
  private freeStack: number[];
  private readonly factory: () => T;
  private readonly resetFn: (obj: T) => void;

  constructor(
    initialCapacity: number,
    factory: () => T,
    reset: (obj: T) => void
  ) {
    if (initialCapacity < 1) throw new RangeError("ObjectPool capacity must be >= 1");
    this.factory = factory;
    this.resetFn = reset;
    this.objects = new Array<T>(initialCapacity);
    this.freeStack = new Array<number>(initialCapacity);
    for (let i = 0; i < initialCapacity; i++) {
      this.objects[i] = factory();
      this.freeStack[i] = i;
    }
  }

  /** Number of objects currently in use. */
  get activeCount(): number {
    return this.objects.length - this.freeStack.length;
  }

  /** Number of objects available for acquisition. */
  get freeCount(): number {
    return this.freeStack.length;
  }

  /**
   * Acquire an object from the pool.
   * If the pool is exhausted, it grows automatically (with a warning).
   */
  acquire(): T {
    if (this.freeStack.length === 0) {
      this.grow(this.objects.length * 2);
    }
    const index = this.freeStack.pop()!;
    const obj = this.objects[index];
    this.resetFn(obj);
    return obj;
  }

  /** Release an object back to the pool. */
  release(obj: T): void {
    const index = this.objects.indexOf(obj);
    if (index === -1) return;
    this.freeStack.push(index);
  }

  /** Grow the pool to a new capacity (Dynamic Reallocation Protocol). */
  grow(newCapacity: number): void {
    const oldCapacity = this.objects.length;
    if (newCapacity <= oldCapacity) return;
    console.warn(
      `[Mozaic Pool] Pool exhausted — growing from ${oldCapacity} to ${newCapacity}. ` +
      `Consider increasing initial capacity.`
    );
    for (let i = oldCapacity; i < newCapacity; i++) {
      this.objects.push(this.factory());
      this.freeStack.push(i);
    }
  }
}

/**
 * Manages entity slot allocation within a contiguous byte region
 * of the state buffer (the entityPool block in memory.ts).
 *
 * Each slot is a fixed number of bytes.  A free-list stack
 * provides O(1) allocate and deallocate operations.
 */
export class EntityFreeList {
  readonly maxSlots: number;
  readonly slotSize: number;
  private readonly startByte: number;
  private readonly buffer: Uint8ClampedArray;
  private freeStack: number[];

  constructor(
    buffer: Uint8ClampedArray,
    startByte: number,
    endByte: number,
    slotSize: number
  ) {
    if (slotSize < 1) throw new RangeError("Slot size must be >= 1");
    this.buffer = buffer;
    this.startByte = startByte;
    this.slotSize = slotSize;
    const regionSize = endByte - startByte + 1;
    this.maxSlots = Math.floor(regionSize / slotSize);
    this.freeStack = new Array<number>(this.maxSlots);
    for (let i = 0; i < this.maxSlots; i++) {
      this.freeStack[i] = i;
    }
  }

  /** Number of slots currently in use. */
  get usedSlots(): number {
    return this.maxSlots - this.freeStack.length;
  }

  /**
   * Allocate a slot.  Returns the slot index, or -1 if the pool
   * is fully occupied.
   */
  allocate(): number {
    if (this.freeStack.length === 0) return -1;
    return this.freeStack.pop()!;
  }

  /** Deallocate a slot, returning it to the free list. */
  deallocate(slotIndex: number): void {
    if (slotIndex < 0 || slotIndex >= this.maxSlots) return;
    this.freeStack.push(slotIndex);
  }

  /** Return the byte offset within the buffer for a given slot index. */
  slotOffset(slotIndex: number): number {
    return this.startByte + slotIndex * this.slotSize;
  }

  /** Mark all slots free and zero the entity region. */
  clear(): void {
    this.freeStack.length = this.maxSlots;
    for (let i = 0; i < this.maxSlots; i++) {
      this.freeStack[i] = i;
    }
    const regionEnd = this.startByte + this.maxSlots * this.slotSize;
    this.buffer.fill(0, this.startByte, regionEnd);
  }
}
