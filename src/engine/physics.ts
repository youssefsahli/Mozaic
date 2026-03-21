/**
 * Physics & Collision System
 *
 * At runtime the engine only tests entity positions against the cached
 * Marching Squares polygons — never raw pixels.
 *
 * Color triggers fire when two hex-color regions overlap, as declared
 * in the .msc DSL:  Collision(#FFFF00, #FF0000)
 *
 * Entity-name triggers fire when bounding boxes of two entity types overlap:
 *   Collision("Player", "NPC")
 */

import type { Point } from "./baker.js";
import {
  readInt8,
  readSignedInt16,
  ENTITY_SLOT_SIZE,
  ENTITY_ACTIVE,
  ENTITY_TYPE_ID,
  ENTITY_POS_X,
  ENTITY_POS_Y,
  MEMORY_BLOCKS,
} from "./memory.js";

export interface AABB {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Simple polygon bounding-box test used as a broad phase.
 */
export function polygonAABB(polygon: Point[]): AABB {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const { x, y } of polygon) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Check whether two AABBs overlap.
 */
export function aabbOverlap(a: AABB, b: AABB): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Point-in-polygon test using the ray-casting algorithm.
 */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  const { x, y } = point;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y;
    const xj = polygon[j].x,
      yj = polygon[j].y;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Parse a hex color string (#RRGGBB or #RGB) into [r, g, b]. */
export function parseHexColor(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16),
      parseInt(clean[1] + clean[1], 16),
      parseInt(clean[2] + clean[2], 16),
    ];
  }
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

/**
 * Check whether a pixel in the state buffer matches a target hex color.
 * Each pixel is 4 bytes (RGBA) in the Uint8ClampedArray.
 */
export function pixelMatchesColor(
  state: Uint8ClampedArray,
  pixelIndex: number,
  hex: string
): boolean {
  const [r, g, b] = parseHexColor(hex);
  const base = pixelIndex * 4;
  return state[base] === r && state[base + 1] === g && state[base + 2] === b;
}

export interface CollisionEvent {
  triggerA: string;
  triggerB: string;
}

/** Module-level cached set reused across calls to avoid GC pressure. */
const _pixelSetCache = new Set<number>();

/**
 * Detect color-trigger collisions between two hex regions in the state buffer.
 * Returns true if at least one pixel of colorA overlaps with colorB.
 */
export function detectColorCollision(
  state: Uint8ClampedArray,
  width: number,
  colorA: string,
  colorB: string
): boolean {
  _pixelSetCache.clear();
  const pixelCount = state.length / 4;

  for (let i = 0; i < pixelCount; i++) {
    if (pixelMatchesColor(state, i, colorA)) _pixelSetCache.add(i);
  }

  // Check if any colorB pixel is adjacent to a colorA pixel
  for (let i = 0; i < pixelCount; i++) {
    if (!pixelMatchesColor(state, i, colorB)) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    // Check 4-connected neighbours
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0) continue;
      const ni = ny * width + nx;
      if (_pixelSetCache.has(ni)) return true;
    }
  }

  return false;
}

/**
 * Detect collision between two entity types by name using AABB overlap.
 *
 * Entity names are mapped to 1-based type IDs using the order of
 * `Object.keys(entities)`.  Each entity's bounding box is gridSize × gridSize
 * pixels centered at its position.
 *
 * @returns true if any entity of typeA overlaps with any entity of typeB.
 */
export function detectEntityCollision(
  buffer: Uint8ClampedArray,
  entityNames: string[],
  nameA: string,
  nameB: string,
  gridSize: number
): boolean {
  const typeA = entityNames.indexOf(nameA) + 1;
  const typeB = entityNames.indexOf(nameB) + 1;
  if (typeA === 0 || typeB === 0) return false;

  const poolStart = MEMORY_BLOCKS.entityPool.startByte;
  const poolEnd = MEMORY_BLOCKS.entityPool.endByte;

  // Collect positions of type A entities
  const positionsA: { x: number; y: number }[] = [];

  for (
    let ptr = poolStart;
    ptr + ENTITY_SLOT_SIZE - 1 <= poolEnd;
    ptr += ENTITY_SLOT_SIZE
  ) {
    if (readInt8(buffer, ptr + ENTITY_ACTIVE) === 0) continue;
    const tid = readInt8(buffer, ptr + ENTITY_TYPE_ID);
    if (tid === typeA) {
      positionsA.push({
        x: readSignedInt16(buffer, ptr + ENTITY_POS_X),
        y: readSignedInt16(buffer, ptr + ENTITY_POS_Y),
      });
    }
  }

  if (positionsA.length === 0) return false;

  // Check type B entities against collected type A positions
  for (
    let ptr = poolStart;
    ptr + ENTITY_SLOT_SIZE - 1 <= poolEnd;
    ptr += ENTITY_SLOT_SIZE
  ) {
    if (readInt8(buffer, ptr + ENTITY_ACTIVE) === 0) continue;
    const tid = readInt8(buffer, ptr + ENTITY_TYPE_ID);
    if (tid !== typeB) continue;

    const bx = readSignedInt16(buffer, ptr + ENTITY_POS_X);
    const by = readSignedInt16(buffer, ptr + ENTITY_POS_Y);

    for (const a of positionsA) {
      if (Math.abs(a.x - bx) < gridSize && Math.abs(a.y - by) < gridSize) {
        return true;
      }
    }
  }

  return false;
}
