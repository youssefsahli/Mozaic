/**
 * ECS Component Registry & Built-in Components
 *
 * Components are pure, stateless functions that read an entity's memory
 * block, perform math, and write back.  They are stored in a
 * ComponentRegistry keyed by a string ID so that the evaluator can
 * look them up at runtime.
 *
 * Built-in libraries:
 *   1. Physics & Kinematics  — Gravity, Kinematic, Collider, Friction
 *   2. Gameplay & AI         — PlayerController, Navigator, Health, Lifetime
 *   3. Drawing & Effects     — ScreenShake, SpriteAnimator, ParticleEmitter
 */

import type { InputState } from "./input.js";
import type { BakedAsset } from "./baker.js";
import type { EngineState } from "./loop.js";
import { pointInPolygon } from "./physics.js";
import {
  readInt8,
  writeInt8,
  readInt16,
  writeInt16,
  readSignedInt16,
  writeSignedInt16,
  ENTITY_SLOT_SIZE,
  ENTITY_ACTIVE,
  ENTITY_TYPE_ID,
  ENTITY_POS_X,
  ENTITY_POS_Y,
  ENTITY_VEL_X,
  ENTITY_VEL_Y,
  ENTITY_HEALTH,
  ENTITY_DATA_START,
  CAMERA_SHAKE_X,
  CAMERA_SHAKE_Y,
  MEMORY_BLOCKS,
} from "./memory.js";

// ── Component Function Interface ──────────────────────────────

/**
 * Signature every component must follow.
 *
 * @param buffer    — the raw state buffer
 * @param entityPtr — byte offset of this entity's slot in the buffer
 * @param props     — property bag parsed from the AST definition
 * @param input     — current frame's input state
 * @param baked     — baked asset data (collision polygons, paths, etc.)
 * @param state     — full engine state (buffer, dimensions, frame count)
 */
export type ComponentFn = (
  buffer: Uint8ClampedArray,
  entityPtr: number,
  props: Record<string, number>,
  input: InputState,
  baked: BakedAsset,
  state: EngineState
) => void;

// ── Component Registry ────────────────────────────────────────

export class ComponentRegistry {
  private readonly components = new Map<string, ComponentFn>();

  register(id: string, fn: ComponentFn): void {
    this.components.set(id, fn);
  }

  get(id: string): ComponentFn | undefined {
    return this.components.get(id);
  }

  has(id: string): boolean {
    return this.components.has(id);
  }
}

// ── Library 1: Physics & Kinematics ───────────────────────────

/** Applies a constant downward force to the entity's Y-Velocity. */
export const gravityComponent: ComponentFn = (buffer, entityPtr, props) => {
  const force = props.force ?? 1;
  const vy = readSignedInt16(buffer, entityPtr + ENTITY_VEL_Y);
  writeSignedInt16(buffer, entityPtr + ENTITY_VEL_Y, vy + force);
};

/** Adds X/Y-Velocity to X/Y-Position every frame. */
export const kinematicComponent: ComponentFn = (buffer, entityPtr) => {
  const px = readInt16(buffer, entityPtr + ENTITY_POS_X);
  const py = readInt16(buffer, entityPtr + ENTITY_POS_Y);
  const vx = readSignedInt16(buffer, entityPtr + ENTITY_VEL_X);
  const vy = readSignedInt16(buffer, entityPtr + ENTITY_VEL_Y);
  writeInt16(buffer, entityPtr + ENTITY_POS_X, px + vx);
  writeInt16(buffer, entityPtr + ENTITY_POS_Y, py + vy);
};

/** Halts velocity when the entity collides with baked polygons. */
export const colliderComponent: ComponentFn = (
  buffer,
  entityPtr,
  _props,
  _input,
  baked
) => {
  const px = readInt16(buffer, entityPtr + ENTITY_POS_X);
  const py = readInt16(buffer, entityPtr + ENTITY_POS_Y);
  for (const poly of baked.collisionPolygons) {
    if (pointInPolygon({ x: px, y: py }, poly)) {
      writeSignedInt16(buffer, entityPtr + ENTITY_VEL_X, 0);
      writeSignedInt16(buffer, entityPtr + ENTITY_VEL_Y, 0);
      break;
    }
  }
};

/** Gradually reduces X/Y-Velocity toward zero. */
export const frictionComponent: ComponentFn = (buffer, entityPtr, props) => {
  const factor = props.factor ?? 0.9;
  const vx = readSignedInt16(buffer, entityPtr + ENTITY_VEL_X);
  const vy = readSignedInt16(buffer, entityPtr + ENTITY_VEL_Y);
  writeSignedInt16(buffer, entityPtr + ENTITY_VEL_X, Math.trunc(vx * factor));
  writeSignedInt16(buffer, entityPtr + ENTITY_VEL_Y, Math.trunc(vy * factor));
};

// ── Library 2: Gameplay & AI ──────────────────────────────────

/** Maps directional input actions to entity velocity. */
export const playerControllerComponent: ComponentFn = (
  buffer,
  entityPtr,
  props,
  input
) => {
  const speed = props.speed ?? 1;
  let vx = 0;
  let vy = 0;
  if (input.active.has("Action.Left")) vx -= speed;
  if (input.active.has("Action.Right")) vx += speed;
  if (input.active.has("Action.Up")) vy -= speed;
  if (input.active.has("Action.Down")) vy += speed;
  writeSignedInt16(buffer, entityPtr + ENTITY_VEL_X, vx);
  writeSignedInt16(buffer, entityPtr + ENTITY_VEL_Y, vy);
};

/** Moves entity along a cached Bezier path. Uses data byte 13 for progress. */
export const navigatorComponent: ComponentFn = (
  buffer,
  entityPtr,
  props,
  _input,
  baked
) => {
  const speed = props.speed ?? 1;
  const pathIndex = props.pathIndex ?? 0;
  if (pathIndex >= baked.bezierPaths.length) return;
  const path = baked.bezierPaths[pathIndex];
  if (path.length === 0) return;

  const progressByte = entityPtr + ENTITY_DATA_START + 2;
  const progress = readInt8(buffer, progressByte);
  const pointIdx = progress % path.length;
  const target = path[pointIdx];

  writeInt16(buffer, entityPtr + ENTITY_POS_X, Math.round(target.x));
  writeInt16(buffer, entityPtr + ENTITY_POS_Y, Math.round(target.y));
  writeInt8(buffer, progressByte, (progress + speed) & 0xff);
};

/** Sets entity to dead when health byte reaches zero. */
export const healthComponent: ComponentFn = (buffer, entityPtr) => {
  const hp = readInt8(buffer, entityPtr + ENTITY_HEALTH);
  if (hp === 0) {
    writeInt8(buffer, entityPtr + ENTITY_ACTIVE, 0);
  }
};

/** Countdown timer that destroys the entity when it expires. Uses data byte 11. */
export const lifetimeComponent: ComponentFn = (buffer, entityPtr, props) => {
  const timerByte = entityPtr + ENTITY_DATA_START;
  let timer = readInt8(buffer, timerByte);

  if (timer === 0) {
    timer = Math.min(props.frames ?? 60, 255);
    writeInt8(buffer, timerByte, timer);
    return;
  }

  timer--;
  if (timer <= 0) {
    writeInt8(buffer, entityPtr + ENTITY_ACTIVE, 0);
    writeInt8(buffer, timerByte, 0);
  } else {
    writeInt8(buffer, timerByte, timer);
  }
};

// ── Library 3: Drawing & Effects ──────────────────────────────

/** Temporarily modifies global camera offsets by a random intensity. */
export const screenShakeComponent: ComponentFn = (
  buffer,
  _entityPtr,
  props
) => {
  const intensity = props.intensity ?? 2;
  const shakeX = Math.round((Math.random() - 0.5) * 2 * intensity);
  const shakeY = Math.round((Math.random() - 0.5) * 2 * intensity);
  writeSignedInt16(buffer, CAMERA_SHAKE_X, shakeX);
  writeSignedInt16(buffer, CAMERA_SHAKE_Y, shakeY);
};

/** Cycles the entity's Type ID to animate between visual states. Uses data byte 12. */
export const spriteAnimatorComponent: ComponentFn = (
  buffer,
  entityPtr,
  props
) => {
  const frameDelay = props.frames ?? 10;
  const count = props.count ?? 2;
  const timerByte = entityPtr + ENTITY_DATA_START + 1;
  let timer = readInt8(buffer, timerByte);

  timer++;
  if (timer >= frameDelay) {
    timer = 0;
    const typeId = readInt8(buffer, entityPtr + ENTITY_TYPE_ID);
    writeInt8(buffer, entityPtr + ENTITY_TYPE_ID, (typeId + 1) % count);
  }
  writeInt8(buffer, timerByte, timer);
};

/** Spawns child entities with random velocities in empty entity slots. */
export const particleEmitterComponent: ComponentFn = (
  buffer,
  entityPtr,
  props
) => {
  const rate = props.rate ?? 1;
  const lifetime = props.lifetime ?? 30;
  const typeId = props.typeId ?? 0;
  const px = readInt16(buffer, entityPtr + ENTITY_POS_X);
  const py = readInt16(buffer, entityPtr + ENTITY_POS_Y);

  const poolStart = MEMORY_BLOCKS.entityPool.startByte;
  const poolEnd = MEMORY_BLOCKS.entityPool.endByte;
  let spawned = 0;

  for (
    let ptr = poolStart;
    ptr + ENTITY_SLOT_SIZE - 1 <= poolEnd && spawned < rate;
    ptr += ENTITY_SLOT_SIZE
  ) {
    if (ptr === entityPtr) continue;
    if (readInt8(buffer, ptr + ENTITY_ACTIVE) !== 0) continue;

    writeInt8(buffer, ptr + ENTITY_ACTIVE, 1);
    writeInt8(buffer, ptr + ENTITY_TYPE_ID, typeId);
    writeInt16(buffer, ptr + ENTITY_POS_X, px);
    writeInt16(buffer, ptr + ENTITY_POS_Y, py);

    const vx = Math.round((Math.random() - 0.5) * 4);
    const vy = Math.round((Math.random() - 0.5) * 4);
    writeSignedInt16(buffer, ptr + ENTITY_VEL_X, vx);
    writeSignedInt16(buffer, ptr + ENTITY_VEL_Y, vy);

    writeInt8(buffer, ptr + ENTITY_DATA_START, Math.min(lifetime, 255));

    spawned++;
  }
};

// ── Default Registry ──────────────────────────────────────────

/** Create a ComponentRegistry pre-loaded with all built-in components. */
export function createDefaultRegistry(): ComponentRegistry {
  const registry = new ComponentRegistry();

  // Physics & Kinematics
  registry.register("Gravity", gravityComponent);
  registry.register("Kinematic", kinematicComponent);
  registry.register("Collider", colliderComponent);
  registry.register("Friction", frictionComponent);

  // Gameplay & AI
  registry.register("PlayerController", playerControllerComponent);
  registry.register("Navigator", navigatorComponent);
  registry.register("Health", healthComponent);
  registry.register("Lifetime", lifetimeComponent);

  // Drawing & Effects
  registry.register("ScreenShake", screenShakeComponent);
  registry.register("SpriteAnimator", spriteAnimatorComponent);
  registry.register("ParticleEmitter", particleEmitterComponent);

  return registry;
}
