/**
 * ECS Tick
 *
 * Pure functions that operate on the Uint8ClampedArray entity memory.
 *
 *   applyKinematic  — adds velocity to position
 *   applyGravity    — accelerates Y velocity, clamped to terminal velocity
 *   ecsTick         — per-frame loop over the entity pool
 */

import type { EngineState } from "./loop.js";
import type { MscDocument } from "../parser/msc.js";
import {
  readInt8,
  writeInt8,
  readSignedInt16,
  writeSignedInt16,
  ENTITY_SLOT_SIZE,
  ENTITY_ACTIVE,
  ENTITY_TYPE_ID,
  ENTITY_POS_X,
  ENTITY_POS_Y,
  ENTITY_VEL_X,
  ENTITY_VEL_Y,
  ENTITY_DATA_START,
  MEMORY_BLOCKS,
} from "./memory.js";

// ── Component Systems ─────────────────────────────────────────

/**
 * Add velocity to position.
 *
 * Reads VelX (ptr+6), VelY (ptr+8), PosX (ptr+2), PosY (ptr+4),
 * writes updated PosX and PosY back.
 */
export function applyKinematic(
  buffer: Uint8ClampedArray,
  ptr: number
): void {
  const vx = readSignedInt16(buffer, ptr + ENTITY_VEL_X);
  const vy = readSignedInt16(buffer, ptr + ENTITY_VEL_Y);
  const px = readSignedInt16(buffer, ptr + ENTITY_POS_X);
  const py = readSignedInt16(buffer, ptr + ENTITY_POS_Y);
  writeSignedInt16(buffer, ptr + ENTITY_POS_X, px + vx);
  writeSignedInt16(buffer, ptr + ENTITY_POS_Y, py + vy);
}

/**
 * Apply downward acceleration, clamped to a terminal velocity.
 *
 * Reads VelY (ptr+8), adds `force`, clamps to `terminalVelocity`,
 * writes updated VelY back.
 */
export function applyGravity(
  buffer: Uint8ClampedArray,
  ptr: number,
  force: number,
  terminalVelocity: number
): void {
  let vy = readSignedInt16(buffer, ptr + ENTITY_VEL_Y);
  vy += force;
  if (vy > terminalVelocity) vy = terminalVelocity;
  writeSignedInt16(buffer, ptr + ENTITY_VEL_Y, vy);
}

// ── Main ECS Tick ─────────────────────────────────────────────

/**
 * Run one frame of ECS logic over the entity pool.
 *
 * For each active entity:
 *  1. Map its Entity Type ID (byte 1) to the script entity definition.
 *  2. Initialise its Sprite ID (byte 11) from the default visual if needed.
 *  3. Execute any attached components (Gravity, Kinematic).
 */
export function ecsTick(state: EngineState, script: MscDocument): void {
  const { buffer } = state;
  const { entities, sprites } = script;

  // Build a mapping from integer Type ID → entity name.
  // First entity parsed → ID 1, second → ID 2, etc.
  const entityNames = Object.keys(entities);

  // Build a mapping from sprite name → sprite atlas index (1-based).
  const spriteNameToId = new Map<string, number>();
  let spriteIdx = 1;
  for (const [name, def] of sprites) {
    spriteNameToId.set(name, spriteIdx);
    spriteIdx += def.kind === "grid" ? def.frames : 1;
  }

  const poolStart = MEMORY_BLOCKS.entityPool.startByte;
  const poolEnd = MEMORY_BLOCKS.entityPool.endByte;

  for (
    let ptr = poolStart;
    ptr + ENTITY_SLOT_SIZE - 1 <= poolEnd;
    ptr += ENTITY_SLOT_SIZE
  ) {
    if (readInt8(buffer, ptr + ENTITY_ACTIVE) === 0) continue;

    const typeId = readInt8(buffer, ptr + ENTITY_TYPE_ID);
    // Type IDs are 1-based; map to entityNames index (0-based)
    if (typeId === 0 || typeId > entityNames.length) continue;

    const entityDef = entities[entityNames[typeId - 1]];
    if (!entityDef) continue;

    // ── Sprite Initialisation ─────────────────────────────────
    const currentSpriteId = readInt8(buffer, ptr + ENTITY_DATA_START);
    if (currentSpriteId === 0 && entityDef.visual) {
      const sid = spriteNameToId.get(entityDef.visual);
      if (sid !== undefined) {
        writeInt8(buffer, ptr + ENTITY_DATA_START, sid);
      }
    }

    // ── Component Execution ───────────────────────────────────
    const components = entityDef.components;
    if (!components) continue;

    if (components.Gravity) {
      applyGravity(
        buffer,
        ptr,
        components.Gravity.force ?? 1,
        components.Gravity.terminalVelocity ?? 255
      );
    }

    if (components.Kinematic) {
      applyKinematic(buffer, ptr);
    }
  }
}
