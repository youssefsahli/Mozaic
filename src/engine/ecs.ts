/**
 * ECS Tick
 *
 * Pure functions that operate on the Uint8ClampedArray entity memory.
 *
 *   applyKinematic           — adds velocity to position
 *   applyGravity             — accelerates Y velocity, clamped to terminal velocity
 *   applyTopDownController   — sets velocity from 4-directional input
 *   applyPlatformerController — sets horizontal velocity and jump from input
 *   applyAnimator            — cycles Sprite ID over time using a sequence array
 *   applyCollider            — clamps entity position to screen boundaries
 *   ecsTick                  — per-frame loop over the entity pool
 */

import type { EngineState } from "./loop.js";
import type { InputState } from "./input.js";
import type { BakedAsset } from "./baker.js";
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

// ── Input Controllers ─────────────────────────────────────────

/**
 * Top-down 4-directional controller.
 *
 * Reads directional input and overwrites VelX (ptr+6) and VelY (ptr+8).
 * If opposing keys (or no keys) are pressed on an axis, that axis is set to 0.
 */
export function applyTopDownController(
  buffer: Uint8ClampedArray,
  ptr: number,
  input: InputState,
  speed: number
): void {
  let vx = 0;
  let vy = 0;
  const left = input.active.has("Action.MoveLeft");
  const right = input.active.has("Action.MoveRight");
  const up = input.active.has("Action.MoveUp");
  const down = input.active.has("Action.MoveDown");
  if (left && !right) vx = -speed;
  else if (right && !left) vx = speed;
  if (up && !down) vy = -speed;
  else if (down && !up) vy = speed;
  writeSignedInt16(buffer, ptr + ENTITY_VEL_X, vx);
  writeSignedInt16(buffer, ptr + ENTITY_VEL_Y, vy);
}

/**
 * Side-scrolling platformer controller.
 *
 * Sets horizontal velocity from left/right input and applies
 * jump force when Action.Jump is active.
 */
export function applyPlatformerController(
  buffer: Uint8ClampedArray,
  ptr: number,
  input: InputState,
  speed: number,
  jumpForce: number
): void {
  let vx = 0;
  const left = input.active.has("Action.MoveLeft");
  const right = input.active.has("Action.MoveRight");
  if (left && !right) vx = -speed;
  else if (right && !left) vx = speed;
  writeSignedInt16(buffer, ptr + ENTITY_VEL_X, vx);
  if (input.active.has("Action.Jump")) {
    writeSignedInt16(buffer, ptr + ENTITY_VEL_Y, -jumpForce);
  }
}

// ── Animator ──────────────────────────────────────────────────

/**
 * Cycle the Sprite ID (ptr+11) over time through a sequence array.
 *
 * Uses ptr+12 (Int8) as the Timer and ptr+13 (Int8) as the Sequence Index.
 */
export function applyAnimator(
  buffer: Uint8ClampedArray,
  ptr: number,
  sequenceArray: number[],
  speed: number
): void {
  let timer = readInt8(buffer, ptr + 12);
  if (timer > 0) {
    timer--;
    writeInt8(buffer, ptr + 12, timer);
  } else {
    writeInt8(buffer, ptr + 12, speed);
    let idx = readInt8(buffer, ptr + 13);
    idx = (idx + 1) % sequenceArray.length;
    writeInt8(buffer, ptr + 13, idx);
    writeInt8(buffer, ptr + ENTITY_DATA_START, sequenceArray[idx]);
  }
}

// ── Collider (Screen Bounds) ──────────────────────────────────

/**
 * Clamp entity position to screen boundaries.
 *
 * Prevents entities from moving off-screen and zeroes velocity on contact.
 */
export function applyCollider(
  state: EngineState,
  buffer: Uint8ClampedArray,
  ptr: number
): void {
  let px = readSignedInt16(buffer, ptr + ENTITY_POS_X);
  let py = readSignedInt16(buffer, ptr + ENTITY_POS_Y);

  if (px < 0) {
    writeSignedInt16(buffer, ptr + ENTITY_POS_X, 0);
    writeSignedInt16(buffer, ptr + ENTITY_VEL_X, 0);
  } else if (px > state.width - 16) {
    writeSignedInt16(buffer, ptr + ENTITY_POS_X, state.width - 16);
    writeSignedInt16(buffer, ptr + ENTITY_VEL_X, 0);
  }

  if (py < 0) {
    writeSignedInt16(buffer, ptr + ENTITY_POS_Y, 0);
    writeSignedInt16(buffer, ptr + ENTITY_VEL_Y, 0);
  } else if (py > state.height - 16) {
    writeSignedInt16(buffer, ptr + ENTITY_POS_Y, state.height - 16);
    writeSignedInt16(buffer, ptr + ENTITY_VEL_Y, 0);
  }
}

// ── Main ECS Tick ─────────────────────────────────────────────

/**
 * Run one frame of ECS logic over the entity pool.
 *
 * For each active entity:
 *  1. Map its Entity Type ID (byte 1) to the script entity definition.
 *  2. Initialize its Sprite ID (byte 11) from the default visual if needed.
 *  3. Execute any attached components (Gravity, TopDownController,
 *     PlatformerController, Kinematic, Collider, Animator).
 */
export function ecsTick(state: EngineState, input: InputState, baked: BakedAsset, script: MscDocument): void {
  const { buffer } = state;
  const { entities, sprites } = script;

  // Build a mapping from integer Type ID → entity name.
  // First entity parsed → ID 1, second → ID 2, etc.
  const entityNames = Object.keys(entities);

  // Build a mapping from sprite name → sprite atlas index (1-based).
  // Filter out the $Grid metadata key so it does not offset SpriteID math.
  const spriteNameToId = new Map<string, number>();
  let spriteIdx = 1;
  for (const [name, def] of sprites) {
    if (name === "$Grid") continue;
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

    // ── Sprite Initialization ──────────────────────────────────
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
        Number(components.Gravity.force ?? 1),
        Number(components.Gravity.terminalVelocity ?? 255)
      );
    }

    if (components.TopDownController) {
      applyTopDownController(
        buffer,
        ptr,
        input,
        Number(components.TopDownController.speed ?? 1)
      );
    }

    if (components.PlatformerController) {
      applyPlatformerController(
        buffer,
        ptr,
        input,
        Number(components.PlatformerController.speed ?? 1),
        Number(components.PlatformerController.jumpForce ?? 5)
      );
    }

    if (components.Kinematic) {
      applyKinematic(buffer, ptr);
    }

    if (components.Collider) {
      applyCollider(state, buffer, ptr);
    }

    if (components.Animator) {
      const animSpeed = Number(components.Animator.speed ?? 10);
      const seqName = entityDef.visual;
      if (seqName) {
        const baseSpriteId = spriteNameToId.get(seqName);
        if (baseSpriteId !== undefined) {
          const spriteDef = sprites.get(seqName);
          const frames = spriteDef && spriteDef.kind === "grid" ? spriteDef.frames : 1;
          const sequenceArray = Array.from({length: frames}, (_, i) => baseSpriteId + i);
          const frameIndex = Math.floor(state.tickCount / animSpeed) % sequenceArray.length;
          const currentSpriteId = sequenceArray[frameIndex];
          writeInt8(buffer, ptr + ENTITY_DATA_START, currentSpriteId);
        }
      }
    }
  }
}
