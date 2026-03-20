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
 *   3. Combat & Status       — Hitbox
 *   4. Platformer            — PlatformController
 *   5. AI & Logic            — Wanderer, Chaser, Spawner
 *   6. Interaction           — Interactable, AreaTrigger
 *   7. Drawing & Effects     — ScreenShake, SpriteAnimator, ParticleEmitter
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
 * Signature every component tick must follow.
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
  props: Record<string, number | string>,
  input: InputState,
  baked: BakedAsset,
  state: EngineState
) => void;

/**
 * Structured component definition.  Components may optionally expose
 * variables to the state-machine evaluation context via `getContext`.
 */
export interface EngineComponent {
  name: string;
  tick?: ComponentFn;
  getContext?: (
    buffer: Uint8ClampedArray,
    ptr: number,
    props: Record<string, number | string>
  ) => Record<string, number>;
}

// ── Component Registry ────────────────────────────────────────

export class ComponentRegistry {
  private readonly components = new Map<string, EngineComponent>();

  register(id: string, component: ComponentFn | EngineComponent): void {
    if (typeof component === "function") {
      this.components.set(id, { name: id, tick: component });
    } else {
      this.components.set(id, component);
    }
  }

  unregister(id: string): boolean {
    return this.components.delete(id);
  }

  get(id: string): EngineComponent | undefined {
    return this.components.get(id);
  }

  has(id: string): boolean {
    return this.components.has(id);
  }

  /** Return all registered component IDs. */
  list(): string[] {
    return Array.from(this.components.keys());
  }
}

// ── Library 1: Physics & Kinematics ───────────────────────────

/** Applies a constant downward force to the entity's Y-Velocity. */
export const gravityComponent: ComponentFn = (buffer, entityPtr, props) => {
  const force = (props.force as number) ?? 1;
  const vy = readSignedInt16(buffer, entityPtr + ENTITY_VEL_Y);
  writeSignedInt16(buffer, entityPtr + ENTITY_VEL_Y, vy + force);
};

/** Adds X/Y-Velocity to X/Y-Position every frame. */
export const kinematicComponent: ComponentFn = (buffer, entityPtr) => {
  const px = readSignedInt16(buffer, entityPtr + ENTITY_POS_X);
  const py = readSignedInt16(buffer, entityPtr + ENTITY_POS_Y);
  const vx = readSignedInt16(buffer, entityPtr + ENTITY_VEL_X);
  const vy = readSignedInt16(buffer, entityPtr + ENTITY_VEL_Y);
  writeSignedInt16(buffer, entityPtr + ENTITY_POS_X, px + vx);
  writeSignedInt16(buffer, entityPtr + ENTITY_POS_Y, py + vy);
};

/** Kinematic as an EngineComponent — exposes $vx, $vy, $px, $py via getContext. */
export const kinematicEngineComponent: EngineComponent = {
  name: "Kinematic",
  tick: kinematicComponent,
  getContext: (buffer, ptr) => ({
    $vx: readSignedInt16(buffer, ptr + ENTITY_VEL_X),
    $vy: readSignedInt16(buffer, ptr + ENTITY_VEL_Y),
    $px: readSignedInt16(buffer, ptr + ENTITY_POS_X),
    $py: readSignedInt16(buffer, ptr + ENTITY_POS_Y),
  }),
};

/** Halts velocity when the entity collides with baked polygons. */
export const colliderComponent: ComponentFn = (
  buffer,
  entityPtr,
  _props,
  _input,
  baked
) => {
  const px = readSignedInt16(buffer, entityPtr + ENTITY_POS_X);
  const py = readSignedInt16(buffer, entityPtr + ENTITY_POS_Y);
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
  const factor = (props.factor as number) ?? 0.9;
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
  const speed = (props.speed as number) ?? 1;
  let vx = 0;
  let vy = 0;
  if (input.active.has("Action.Left")) vx -= speed;
  if (input.active.has("Action.Right")) vx += speed;
  if (input.active.has("Action.Up")) vy -= speed;
  if (input.active.has("Action.Down")) vy += speed;
  writeSignedInt16(buffer, entityPtr + ENTITY_VEL_X, vx);
  writeSignedInt16(buffer, entityPtr + ENTITY_VEL_Y, vy);
};

/** Top-down 4-directional controller using Action.Move* input actions. */
export const topDownControllerComponent: ComponentFn = (
  buffer,
  entityPtr,
  props,
  input
) => {
  const speed = (props.speed as number) ?? 1;
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
  const speed = (props.speed as number) ?? 1;
  const pathIndex = (props.pathIndex as number) ?? 0;
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

/** Health as an EngineComponent — exposes $hp, $maxHp via getContext. */
export const healthEngineComponent: EngineComponent = {
  name: "Health",
  tick: healthComponent,
  getContext: (buffer, ptr, props) => ({
    $hp: readInt8(buffer, ptr + ENTITY_HEALTH),
    $maxHp: (props.maxHp as number) ?? 100,
  }),
};

/** Countdown timer that destroys the entity when it expires. Uses data byte 11. */
export const lifetimeComponent: ComponentFn = (buffer, entityPtr, props) => {
  const timerByte = entityPtr + ENTITY_DATA_START;
  let timer = readInt8(buffer, timerByte);

  if (timer === 0) {
    timer = Math.min((props.frames as number) ?? 60, 255);
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

/**
 * Hitbox — checks for overlapping entities in the pool and applies damage/knockback.
 *
 * Props: width (default 16), height (default 16), damage (default 1), knockback (default 4)
 */
export const hitboxComponent: ComponentFn = (buffer, entityPtr, props) => {
  const w = (props.width as number) ?? 16;
  const h = (props.height as number) ?? 16;
  const damage = (props.damage as number) ?? 1;
  const knockback = (props.knockback as number) ?? 4;

  const ax = readSignedInt16(buffer, entityPtr + ENTITY_POS_X);
  const ay = readSignedInt16(buffer, entityPtr + ENTITY_POS_Y);
  const halfW = w / 2;
  const halfH = h / 2;

  const poolStart = MEMORY_BLOCKS.entityPool.startByte;
  const poolEnd = MEMORY_BLOCKS.entityPool.endByte;
  for (
    let ptr = poolStart;
    ptr + ENTITY_SLOT_SIZE - 1 <= poolEnd;
    ptr += ENTITY_SLOT_SIZE
  ) {
    if (ptr === entityPtr) continue;
    if (readInt8(buffer, ptr + ENTITY_ACTIVE) === 0) continue;

    const bx = readSignedInt16(buffer, ptr + ENTITY_POS_X);
    const by = readSignedInt16(buffer, ptr + ENTITY_POS_Y);
    if (
      Math.abs(ax - bx) < halfW &&
      Math.abs(ay - by) < halfH
    ) {
      // Apply damage
      const hp = readInt8(buffer, ptr + ENTITY_HEALTH);
      if (hp > 0) {
        writeInt8(buffer, ptr + ENTITY_HEALTH, Math.max(0, hp - damage));
      }
      // Apply knockback away from attacker
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const kx = Math.round((dx / len) * knockback);
      const ky = Math.round((dy / len) * knockback);
      const ovx = readSignedInt16(buffer, ptr + ENTITY_VEL_X);
      const ovy = readSignedInt16(buffer, ptr + ENTITY_VEL_Y);
      writeSignedInt16(buffer, ptr + ENTITY_VEL_X, ovx + kx);
      writeSignedInt16(buffer, ptr + ENTITY_VEL_Y, ovy + ky);
    }
  }
};

// ── Platformer Pack ───────────────────────────────────────────

/**
 * PlatformController — side-scrolling controller with jump mechanics.
 *
 * Listens for Action.Jump and Action.MoveLeft/Right.
 * Checks if entity is touching the ground before allowing a jump.
 *
 * Props: speed (default 1), jumpForce (default 5)
 * Uses data byte 14 for isGrounded flag.
 * Context Exposed: $isGrounded (0 or 1), $vy.
 */
export const platformControllerEngineComponent: EngineComponent = {
  name: "PlatformController",
  tick: (buffer, entityPtr, props, input, baked) => {
    const speed = (props.speed as number) ?? 1;
    const jumpForce = (props.jumpForce as number) ?? 5;
    const groundedByte = entityPtr + ENTITY_DATA_START + 3;

    // Check grounded: a point just below the entity is inside a collision polygon
    const px = readSignedInt16(buffer, entityPtr + ENTITY_POS_X);
    const py = readSignedInt16(buffer, entityPtr + ENTITY_POS_Y);
    let grounded = 0;
    for (const poly of baked.collisionPolygons) {
      if (pointInPolygon({ x: px, y: py + 1 }, poly)) {
        grounded = 1;
        break;
      }
    }
    writeInt8(buffer, groundedByte, grounded);

    // Horizontal movement
    let vx = 0;
    if (input.active.has("Action.MoveLeft")) vx -= speed;
    if (input.active.has("Action.MoveRight")) vx += speed;
    writeSignedInt16(buffer, entityPtr + ENTITY_VEL_X, vx);

    // Jump (only when grounded)
    if (grounded === 1 && input.active.has("Action.Jump")) {
      writeSignedInt16(buffer, entityPtr + ENTITY_VEL_Y, -jumpForce);
    }
  },
  getContext: (buffer, ptr) => ({
    $isGrounded: readInt8(buffer, ptr + ENTITY_DATA_START + 3),
    $vy: readSignedInt16(buffer, ptr + ENTITY_VEL_Y),
  }),
};

// ── AI & Logic Pack ───────────────────────────────────────────

/**
 * Wanderer — randomly picks a direction, walks, then stops and picks again.
 *
 * Props: speed (default 1), interval (frames between direction changes, default 60)
 * Uses data byte 14 for timer, byte 15 for direction (0=idle, 1=left, 2=right, 3=up, 4=down).
 */
export const wandererComponent: ComponentFn = (buffer, entityPtr, props) => {
  const speed = (props.speed as number) ?? 1;
  const interval = Math.min((props.interval as number) ?? 60, 255);
  const timerByte = entityPtr + ENTITY_DATA_START + 3;
  const dirByte = entityPtr + ENTITY_DATA_START + 4;

  let timer = readInt8(buffer, timerByte);
  timer++;

  if (timer >= interval) {
    timer = 0;
    // Pick a random direction: 0=idle, 1=left, 2=right, 3=up, 4=down
    const dir = Math.floor(Math.random() * 5);
    writeInt8(buffer, dirByte, dir);
  }
  writeInt8(buffer, timerByte, timer);

  const dir = readInt8(buffer, dirByte);
  let vx = 0;
  let vy = 0;
  if (dir === 1) vx = -speed;
  else if (dir === 2) vx = speed;
  else if (dir === 3) vy = -speed;
  else if (dir === 4) vy = speed;
  writeSignedInt16(buffer, entityPtr + ENTITY_VEL_X, vx);
  writeSignedInt16(buffer, entityPtr + ENTITY_VEL_Y, vy);
};

/**
 * Chaser — moves toward the first active entity matching targetType.
 *
 * Props: speed (default 1), targetType (type ID to chase, default 1)
 */
export const chaserComponent: ComponentFn = (buffer, entityPtr, props) => {
  const speed = (props.speed as number) ?? 1;
  const targetType = (props.targetType as number) ?? 1;

  const poolStart = MEMORY_BLOCKS.entityPool.startByte;
  const poolEnd = MEMORY_BLOCKS.entityPool.endByte;
  let tx = 0;
  let ty = 0;
  let found = false;

  for (
    let ptr = poolStart;
    ptr + ENTITY_SLOT_SIZE - 1 <= poolEnd;
    ptr += ENTITY_SLOT_SIZE
  ) {
    if (ptr === entityPtr) continue;
    if (readInt8(buffer, ptr + ENTITY_ACTIVE) === 0) continue;
    if (readInt8(buffer, ptr + ENTITY_TYPE_ID) === targetType) {
      tx = readSignedInt16(buffer, ptr + ENTITY_POS_X);
      ty = readSignedInt16(buffer, ptr + ENTITY_POS_Y);
      found = true;
      break;
    }
  }

  if (!found) return;

  const px = readSignedInt16(buffer, entityPtr + ENTITY_POS_X);
  const py = readSignedInt16(buffer, entityPtr + ENTITY_POS_Y);
  const dx = tx - px;
  const dy = ty - py;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  writeSignedInt16(buffer, entityPtr + ENTITY_VEL_X, Math.round((dx / len) * speed));
  writeSignedInt16(buffer, entityPtr + ENTITY_VEL_Y, Math.round((dy / len) * speed));
};

/**
 * Spawner — emits a new entity at regular intervals.
 *
 * Props: entity (type ID, default 0), interval (frames, default 60),
 *        speedX (default 0), speedY (default 0)
 * Uses data byte 14 for timer.
 */
export const spawnerComponent: ComponentFn = (buffer, entityPtr, props) => {
  const typeId = (props.entity as number) ?? 0;
  const interval = Math.min((props.interval as number) ?? 60, 255);
  const speedX = (props.speedX as number) ?? 0;
  const speedY = (props.speedY as number) ?? 0;
  const timerByte = entityPtr + ENTITY_DATA_START + 3;

  let timer = readInt8(buffer, timerByte);
  timer++;
  if (timer < interval) {
    writeInt8(buffer, timerByte, timer);
    return;
  }

  // Reset timer and spawn
  writeInt8(buffer, timerByte, 0);

  const px = readSignedInt16(buffer, entityPtr + ENTITY_POS_X);
  const py = readSignedInt16(buffer, entityPtr + ENTITY_POS_Y);

  const poolStart = MEMORY_BLOCKS.entityPool.startByte;
  const poolEnd = MEMORY_BLOCKS.entityPool.endByte;
  for (
    let ptr = poolStart;
    ptr + ENTITY_SLOT_SIZE - 1 <= poolEnd;
    ptr += ENTITY_SLOT_SIZE
  ) {
    if (ptr === entityPtr) continue;
    if (readInt8(buffer, ptr + ENTITY_ACTIVE) !== 0) continue;

    writeInt8(buffer, ptr + ENTITY_ACTIVE, 1);
    writeInt8(buffer, ptr + ENTITY_TYPE_ID, typeId);
    writeInt16(buffer, ptr + ENTITY_POS_X, px);
    writeInt16(buffer, ptr + ENTITY_POS_Y, py);
    writeSignedInt16(buffer, ptr + ENTITY_VEL_X, speedX);
    writeSignedInt16(buffer, ptr + ENTITY_VEL_Y, speedY);
    break;
  }
};

// ── Interaction Pack ──────────────────────────────────────────

/**
 * Interactable — defines a radius; if a player-type entity is within range
 * and a specific input action is active, sets a triggered flag.
 *
 * Props: radius (default 16), action (input action name, default "Action.Interact"),
 *        targetType (type ID of interactor, default 1)
 * Uses data byte 14 for triggered flag (0 or 1).
 * Context Exposed: $triggered (0 or 1).
 */
export const interactableEngineComponent: EngineComponent = {
  name: "Interactable",
  tick: (buffer, entityPtr, props, input) => {
    const radius = (props.radius as number) ?? 16;
    const action = (props.action as string) ?? "Action.Interact";
    const targetType = (props.targetType as number) ?? 1;
    const triggeredByte = entityPtr + ENTITY_DATA_START + 3;

    const ax = readSignedInt16(buffer, entityPtr + ENTITY_POS_X);
    const ay = readSignedInt16(buffer, entityPtr + ENTITY_POS_Y);

    const poolStart = MEMORY_BLOCKS.entityPool.startByte;
    const poolEnd = MEMORY_BLOCKS.entityPool.endByte;
    let inRange = false;

    for (
      let ptr = poolStart;
      ptr + ENTITY_SLOT_SIZE - 1 <= poolEnd;
      ptr += ENTITY_SLOT_SIZE
    ) {
      if (ptr === entityPtr) continue;
      if (readInt8(buffer, ptr + ENTITY_ACTIVE) === 0) continue;
      if (readInt8(buffer, ptr + ENTITY_TYPE_ID) !== targetType) continue;

      const bx = readSignedInt16(buffer, ptr + ENTITY_POS_X);
      const by = readSignedInt16(buffer, ptr + ENTITY_POS_Y);
      const dx = ax - bx;
      const dy = ay - by;
      if (dx * dx + dy * dy <= radius * radius) {
        inRange = true;
        break;
      }
    }

    if (inRange && input.active.has(action)) {
      writeInt8(buffer, triggeredByte, 1);
    } else {
      writeInt8(buffer, triggeredByte, 0);
    }
  },
  getContext: (buffer, ptr) => ({
    $triggered: readInt8(buffer, ptr + ENTITY_DATA_START + 3),
  }),
};

/**
 * AreaTrigger — fires when a player-type entity enters the area.
 *
 * Props: width (default 16), height (default 16),
 *        targetType (type ID to detect, default 1)
 * Uses data byte 14 for triggered flag (0 or 1).
 * Context Exposed: $triggered (0 or 1).
 */
export const areaTriggerEngineComponent: EngineComponent = {
  name: "AreaTrigger",
  tick: (buffer, entityPtr, props) => {
    const w = (props.width as number) ?? 16;
    const h = (props.height as number) ?? 16;
    const targetType = (props.targetType as number) ?? 1;
    const triggeredByte = entityPtr + ENTITY_DATA_START + 3;

    const ax = readSignedInt16(buffer, entityPtr + ENTITY_POS_X);
    const ay = readSignedInt16(buffer, entityPtr + ENTITY_POS_Y);
    const halfW = w / 2;
    const halfH = h / 2;

    const poolStart = MEMORY_BLOCKS.entityPool.startByte;
    const poolEnd = MEMORY_BLOCKS.entityPool.endByte;

    for (
      let ptr = poolStart;
      ptr + ENTITY_SLOT_SIZE - 1 <= poolEnd;
      ptr += ENTITY_SLOT_SIZE
    ) {
      if (ptr === entityPtr) continue;
      if (readInt8(buffer, ptr + ENTITY_ACTIVE) === 0) continue;
      if (readInt8(buffer, ptr + ENTITY_TYPE_ID) !== targetType) continue;

      const bx = readSignedInt16(buffer, ptr + ENTITY_POS_X);
      const by = readSignedInt16(buffer, ptr + ENTITY_POS_Y);
      if (
        Math.abs(ax - bx) < halfW &&
        Math.abs(ay - by) < halfH
      ) {
        writeInt8(buffer, triggeredByte, 1);
        return;
      }
    }

    writeInt8(buffer, triggeredByte, 0);
  },
  getContext: (buffer, ptr) => ({
    $triggered: readInt8(buffer, ptr + ENTITY_DATA_START + 3),
  }),
};

// ── Library 3: Drawing & Effects ──────────────────────────────

/** Temporarily modifies global camera offsets by a random intensity. */
export const screenShakeComponent: ComponentFn = (
  buffer,
  _entityPtr,
  props
) => {
  const intensity = (props.intensity as number) ?? 2;
  const shakeX = Math.round((Math.random() - 0.5) * 2 * intensity);
  const shakeY = Math.round((Math.random() - 0.5) * 2 * intensity);
  writeSignedInt16(buffer, CAMERA_SHAKE_X, shakeX);
  writeSignedInt16(buffer, CAMERA_SHAKE_Y, shakeY);
};

/** Cycles the entity's Sprite ID to animate between visual states. Uses data byte 12. */
export const spriteAnimatorComponent: ComponentFn = (
  buffer,
  entityPtr,
  props
) => {
  const frameDelay = (props.frames as number) ?? 10;
  const count = (props.count as number) ?? 2;
  const timerByte = entityPtr + ENTITY_DATA_START + 1;
  let timer = readInt8(buffer, timerByte);

  timer++;
  if (timer >= frameDelay) {
    timer = 0;
    const spriteId = readInt8(buffer, entityPtr + ENTITY_DATA_START);
    writeInt8(buffer, entityPtr + ENTITY_DATA_START, (spriteId + 1) % count);
  }
  writeInt8(buffer, timerByte, timer);
};

/** Spawns child entities with random velocities in empty entity slots. */
export const particleEmitterComponent: ComponentFn = (
  buffer,
  entityPtr,
  props
) => {
  const rate = (props.rate as number) ?? 1;
  const lifetime = (props.lifetime as number) ?? 30;
  const typeId = (props.typeId as number) ?? 0;
  const px = readSignedInt16(buffer, entityPtr + ENTITY_POS_X);
  const py = readSignedInt16(buffer, entityPtr + ENTITY_POS_Y);

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

    writeInt8(buffer, ptr + ENTITY_DATA_START, Math.min(lifetime as number, 255));

    spawned++;
  }
};

// ── Library 4: Camera ─────────────────────────────────────────

/** Parse a hex color string (e.g. "#FF0000") to normalized RGBA [0..1]. */
export function parseHexTint(hex: string): [number, number, number, number] {
  if (typeof hex !== "string" || hex.length < 4) return [1, 1, 1, 1];
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  let r = 1, g = 1, b = 1;
  if (h.length === 3) {
    r = parseInt(h[0] + h[0], 16) / 255;
    g = parseInt(h[1] + h[1], 16) / 255;
    b = parseInt(h[2] + h[2], 16) / 255;
  } else if (h.length >= 6) {
    r = parseInt(h.slice(0, 2), 16) / 255;
    g = parseInt(h.slice(2, 4), 16) / 255;
    b = parseInt(h.slice(4, 6), 16) / 255;
  }
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return [1, 1, 1, 1];
  return [r, g, b, 1];
}

/**
 * Camera component — reads entity position and updates global camera state.
 *
 * Props:
 *   zoom        — scale factor (default 1.0)
 *   shake       — screen shake intensity (default 0.0)
 *   tint        — hex color multiplier (default "#FFFFFF")
 *   followSpeed — lerp speed for smooth camera follow (default 1.0 = instant)
 *   zoomSpeed   — lerp speed for smooth camera zoom (default 1.0 = instant)
 */
export const cameraEngineComponent: EngineComponent = {
  name: "Camera",
  tick: (buffer, entityPtr, props, _input, _baked, state) => {
    const zoom = (props.zoom as number) ?? 1;
    const shake = (props.shake as number) ?? 0;
    const tint = parseHexTint((props.tint as string) ?? "#FFFFFF");
    const followSpeed = Math.min(1, Math.max(0, (props.followSpeed as number) ?? 1)); // clamp to [0, 1]
    
    // Optional zoom smoothing (can also use 'lerp' or 'transition' generic props)
    const zoomSpeed = Math.min(1, Math.max(0, 
      (props.zoomSpeed as number) ?? 
      (props.transition as number) ?? 
      1
    ));

    const px = readSignedInt16(buffer, entityPtr + ENTITY_POS_X);
    const py = readSignedInt16(buffer, entityPtr + ENTITY_POS_Y);

    // Target camera position: center entity on screen
    const targetX = px - state.width / (2 * zoom);
    const targetY = py - state.height / (2 * zoom);

    // Lerp toward target (followSpeed=1 → instant snap)
    state.camera.x += (targetX - state.camera.x) * followSpeed;
    state.camera.y += (targetY - state.camera.y) * followSpeed;

    state.camera.zoom += (zoom - state.camera.zoom) * zoomSpeed;
    state.camera.shake = shake;
    state.camera.tint = tint;
  },
};

// ── Library 5: Experimental Components ────────────────────────

/**
 * Applies sine-wave velocity.
 * Props: frequency (default 0.1), amplitude (default 1), axis (default "y")
 */
export const sineWaveComponent: ComponentFn = (buffer, entityPtr, props, _input, _baked, state) => {
  const freq = (props.frequency as number) ?? 0.1;
  const amp = (props.amplitude as number) ?? 1;
  const axis = (props.axis as string) ?? "y";

  const val = Math.round(Math.cos(state.tickCount * freq) * amp);
  
  if (axis === "x") {
    writeSignedInt16(buffer, entityPtr + ENTITY_VEL_X, val);
  } else {
    writeSignedInt16(buffer, entityPtr + ENTITY_VEL_Y, val);
  }
};

/**
 * Patrols back and forth. Reverses direction when blocked (velocity becomes 0).
 * Props: speed (default 1), axis (default "x")
 * State: Uses Byte 14 for direction (1 or 255/-1).
 */
export const patrolComponent: ComponentFn = (buffer, entityPtr, props) => {
  const speed = (props.speed as number) ?? 1;
  const axis = (props.axis as string) ?? "x";
  
  const dirByte = entityPtr + 14;
  let dir = readInt8(buffer, dirByte);
  const velOffset = axis === "x" ? ENTITY_VEL_X : ENTITY_VEL_Y;
  
  if (dir === 0) {
    // First tick: initialize direction and velocity without flipping.
    dir = 1;
    writeInt8(buffer, dirByte, dir);
    writeSignedInt16(buffer, entityPtr + velOffset, speed);
    return;
  }
  
  const mathDir = dir === 255 ? -1 : 1;
  const currentVel = readSignedInt16(buffer, entityPtr + velOffset);

  // If velocity is 0, assume blocked — reverse direction.
  if (currentVel === 0) {
     const newDir = mathDir === 1 ? 255 : 1;
     writeInt8(buffer, dirByte, newDir);
     writeSignedInt16(buffer, entityPtr + velOffset, (newDir === 255 ? -1 : 1) * speed);
  } else {
     writeSignedInt16(buffer, entityPtr + velOffset, mathDir * speed);
  }
};

/**
 * Blinks the entity visibility on/off.
 * Props: interval (frames, default 30)
 * State: Byte 15 (timer), Byte 13 (original sprite ID)
 *
 * Note: Uses byte 13 for the stored sprite backup to avoid conflict
 * with Patrol (byte 14) and SpriteAnimator timer (byte 12).
 */
export const blinkComponent: ComponentFn = (buffer, entityPtr, props) => {
  const interval = (props.interval as number) ?? 30;
  const timerByte = entityPtr + 15;
  let timer = readInt8(buffer, timerByte);
  
  timer++;
  if (timer > interval) {
    timer = 0;
    
    const spriteByte = entityPtr + ENTITY_DATA_START; // 11
    const currentSprite = readInt8(buffer, spriteByte);
    const storedByte = entityPtr + ENTITY_DATA_START + 2; // 13
    const storedSprite = readInt8(buffer, storedByte);
    
    // Toggle
    if (currentSprite !== 0) {
      // Hide
      writeInt8(buffer, storedByte, currentSprite);
      writeInt8(buffer, spriteByte, 0);
    } else if (storedSprite !== 0) {
      // Show
      writeInt8(buffer, spriteByte, storedSprite);
      writeInt8(buffer, storedByte, 0);
    }
  }
  writeInt8(buffer, timerByte, timer);
};



// ── Roguelike Components ──────────────────────────────────────

/**
 * TurnBased — processes movement only when an input action fires.
 * Props: budget (max actions per turn, default 1)
 * State: Byte 11 (action counter, resets each turn)
 * Exposes: $turnReady (1 when waiting for input, 0 during cooldown)
 */
export const turnBasedComponent: ComponentFn = (buffer, entityPtr, props, input) => {
  const budget = (props.budget as number) ?? 1;
  const counterByte = entityPtr + ENTITY_DATA_START;
  let counter = readInt8(buffer, counterByte);

  const hasInput =
    input.active.has("Action.MoveLeft") ||
    input.active.has("Action.MoveRight") ||
    input.active.has("Action.MoveUp") ||
    input.active.has("Action.MoveDown") ||
    input.active.has("Action.Interact");

  if (hasInput && counter < budget) {
    counter++;
    writeInt8(buffer, counterByte, counter);
  }

  // When budget is exhausted, freeze velocity and reset for next turn
  if (counter >= budget) {
    writeSignedInt16(buffer, entityPtr + ENTITY_VEL_X, 0);
    writeSignedInt16(buffer, entityPtr + ENTITY_VEL_Y, 0);
    writeInt8(buffer, counterByte, 0); // reset for next turn
  }
};

export const turnBasedEngineComponent: EngineComponent = {
  name: "TurnBased",
  tick: turnBasedComponent,
  getContext: (buffer, ptr, props) => ({
    $turnReady: readInt8(buffer, ptr + ENTITY_DATA_START) < ((props.budget as number) ?? 1) ? 1 : 0,
  }),
};

/**
 * GridMovement — snaps entity position to a tile grid on each step.
 * Props: gridSize (pixels per tile, default 16)
 * Works with TurnBased for turn-by-turn tile movement.
 */
export const gridMovementComponent: ComponentFn = (buffer, entityPtr, props, input) => {
  const gridSize = (props.gridSize as number) ?? 16;

  let dx = 0;
  let dy = 0;
  if (input.active.has("Action.MoveLeft"))  dx = -1;
  if (input.active.has("Action.MoveRight")) dx = 1;
  if (input.active.has("Action.MoveUp"))    dy = -1;
  if (input.active.has("Action.MoveDown"))  dy = 1;

  if (dx !== 0 || dy !== 0) {
    const px = readSignedInt16(buffer, entityPtr + ENTITY_POS_X);
    const py = readSignedInt16(buffer, entityPtr + ENTITY_POS_Y);
    writeSignedInt16(buffer, entityPtr + ENTITY_POS_X, px + dx * gridSize);
    writeSignedInt16(buffer, entityPtr + ENTITY_POS_Y, py + dy * gridSize);
  }

  // Zero velocity — movement is discrete, not continuous
  writeSignedInt16(buffer, entityPtr + ENTITY_VEL_X, 0);
  writeSignedInt16(buffer, entityPtr + ENTITY_VEL_Y, 0);
};

/**
 * FieldOfView — marks an entity as visible/hidden based on distance
 * to a target entity type (the "viewer").
 * Props: range (tiles, default 5), viewerType (entity type ID, default 1)
 * State: Byte 12 (visible flag)
 * Exposes: $visible (1 if within range, 0 otherwise)
 */
export const fieldOfViewComponent: ComponentFn = (buffer, entityPtr, props) => {
  const range = (props.range as number) ?? 5;
  const viewerType = (props.viewerType as number) ?? 1;
  const visibleByte = entityPtr + ENTITY_DATA_START + 1; // byte 12

  const myX = readSignedInt16(buffer, entityPtr + ENTITY_POS_X);
  const myY = readSignedInt16(buffer, entityPtr + ENTITY_POS_Y);

  let visible = 0;

  // Scan entity pool for the viewer
  for (
    let ptr = MEMORY_BLOCKS.entityPool.startByte;
    ptr + ENTITY_SLOT_SIZE - 1 <= MEMORY_BLOCKS.entityPool.endByte;
    ptr += ENTITY_SLOT_SIZE
  ) {
    if (ptr === entityPtr) continue;
    if (readInt8(buffer, ptr + ENTITY_ACTIVE) === 0) continue;
    if (readInt8(buffer, ptr + ENTITY_TYPE_ID) !== viewerType) continue;

    const vx = readSignedInt16(buffer, ptr + ENTITY_POS_X);
    const vy = readSignedInt16(buffer, ptr + ENTITY_POS_Y);
    const dist = Math.abs(myX - vx) + Math.abs(myY - vy); // Manhattan distance
    if (dist <= range * 16) {
      visible = 1;
      break;
    }
  }

  writeInt8(buffer, visibleByte, visible);
};

export const fieldOfViewEngineComponent: EngineComponent = {
  name: "FieldOfView",
  tick: fieldOfViewComponent,
  getContext: (buffer, ptr) => ({
    $visible: readInt8(buffer, ptr + ENTITY_DATA_START + 1),
  }),
};

/**
 * Inventory — gives an entity item slots stored in state memory.
 * Props: slots (number of item slots, default 4, max 4)
 * State: Bytes 12-15 (up to 4 item type IDs, 0 = empty)
 * Exposes: $slot0..$slot3 (item type ID in each slot)
 */
export const inventoryComponent: ComponentFn = (buffer, entityPtr, props, input) => {
  const slots = Math.min((props.slots as number) ?? 4, 4);

  // On interact action, pick up nearby items
  if (input.active.has("Action.Interact")) {
    const myX = readSignedInt16(buffer, entityPtr + ENTITY_POS_X);
    const myY = readSignedInt16(buffer, entityPtr + ENTITY_POS_Y);
    const pickupRange = 16;

    for (
      let ptr = MEMORY_BLOCKS.entityPool.startByte;
      ptr + ENTITY_SLOT_SIZE - 1 <= MEMORY_BLOCKS.entityPool.endByte;
      ptr += ENTITY_SLOT_SIZE
    ) {
      if (ptr === entityPtr) continue;
      if (readInt8(buffer, ptr + ENTITY_ACTIVE) === 0) continue;

      const ix = readSignedInt16(buffer, ptr + ENTITY_POS_X);
      const iy = readSignedInt16(buffer, ptr + ENTITY_POS_Y);
      if (Math.abs(myX - ix) + Math.abs(myY - iy) > pickupRange) continue;

      const itemType = readInt8(buffer, ptr + ENTITY_TYPE_ID);

      // Find first empty slot
      for (let s = 0; s < slots; s++) {
        const slotByte = entityPtr + ENTITY_DATA_START + 1 + s;
        if (readInt8(buffer, slotByte) === 0) {
          writeInt8(buffer, slotByte, itemType);
          writeInt8(buffer, ptr + ENTITY_ACTIVE, 0); // despawn item
          break;
        }
      }
    }
  }
};

export const inventoryEngineComponent: EngineComponent = {
  name: "Inventory",
  tick: inventoryComponent,
  getContext: (buffer, ptr) => ({
    $slot0: readInt8(buffer, ptr + ENTITY_DATA_START + 1),
    $slot1: readInt8(buffer, ptr + ENTITY_DATA_START + 2),
    $slot2: readInt8(buffer, ptr + ENTITY_DATA_START + 3),
    $slot3: readInt8(buffer, ptr + ENTITY_DATA_START + 4),
  }),
};

// ── Library 6: Persistence ────────────────────────────────────

/** localStorage key prefix for Mozaic save slots. */
const SAVE_SLOT_PREFIX = "mozaic:save:";

/** Number of bytes in the globals memory block (bytes 64–511). */
const GLOBALS_BLOCK_SIZE =
  MEMORY_BLOCKS.globals.endByte - MEMORY_BLOCKS.globals.startByte + 1;

/**
 * SaveState — serialises the globals memory block to localStorage when
 * the specified action fires.
 *
 * Props:
 *   slot    — save-slot name (default "default")
 *   trigger — input action that triggers the save (default "Action.Save")
 *   addr    — start byte to save (default: globals start = 64)
 *   len     — number of bytes to save (default: full globals block)
 */
export const saveStateComponent: ComponentFn = (buffer, _entityPtr, props, input) => {
  const slotKey = SAVE_SLOT_PREFIX + ((props.slot as string) ?? "default");
  const trigger = (props.trigger as string) ?? "Action.Save";
  if (!input.active.has(trigger)) return;

  const startAddr = Math.max(0, (props.addr as number) ?? MEMORY_BLOCKS.globals.startByte);
  const len = Math.max(1, (props.len as number) ?? GLOBALS_BLOCK_SIZE);
  const slice = Array.from(buffer.subarray(startAddr, startAddr + len));
  try {
    localStorage.setItem(slotKey, JSON.stringify(slice));
  } catch {
    /* storage full or unavailable */
  }
};

/**
 * LoadState — reads a previously saved globals block from localStorage.
 *
 * The load can happen automatically on the first tick (`autoLoad: 1`) and/or
 * when the specified action fires.
 *
 * Props:
 *   slot      — save-slot name (default "default")
 *   trigger   — input action that triggers a manual load (default "Action.Load")
 *   autoLoad  — if 1, also load on the very first tick (default 0)
 *   addr      — start byte to restore (default: globals start = 64)
 */
export const loadStateComponent: ComponentFn = (buffer, _entityPtr, props, input, _baked, state) => {
  const slotKey = SAVE_SLOT_PREFIX + ((props.slot as string) ?? "default");
  const trigger = (props.trigger as string) ?? "Action.Load";
  const autoLoad = (props.autoLoad as number) ?? 0;

  const shouldLoad =
    input.active.has(trigger) ||
    (autoLoad === 1 && state.tickCount === 1);

  if (!shouldLoad) return;

  const startAddr = Math.max(0, (props.addr as number) ?? MEMORY_BLOCKS.globals.startByte);
  try {
    const raw = localStorage.getItem(slotKey);
    if (!raw) return;
    const data = JSON.parse(raw) as number[];
    for (let i = 0; i < data.length; i++) {
      const byteAddr = startAddr + i;
      if (byteAddr < buffer.length) {
        buffer[byteAddr] = data[i] & 0xff;
      }
    }
  } catch {
    /* parse error or unavailable */
  }
};

/** Create a ComponentRegistry pre-loaded with all built-in components. */
export function createDefaultRegistry(): ComponentRegistry {
  const registry = new ComponentRegistry();

  // Physics & Kinematics
  registry.register("Gravity", gravityComponent);
  registry.register("Kinematic", kinematicEngineComponent);
  registry.register("Collider", colliderComponent);
  registry.register("Friction", frictionComponent);

  // Gameplay & AI
  registry.register("PlayerController", playerControllerComponent);
  registry.register("TopDownController", topDownControllerComponent);
  registry.register("Navigator", navigatorComponent);
  registry.register("Health", healthEngineComponent);
  registry.register("Lifetime", lifetimeComponent);

  // Combat & Status
  registry.register("Hitbox", hitboxComponent);

  // Platformer
  registry.register("PlatformController", platformControllerEngineComponent);

  // AI & Logic
  registry.register("Wanderer", wandererComponent);
  registry.register("Chaser", chaserComponent);
  registry.register("Spawner", spawnerComponent);

  // Interaction
  registry.register("Interactable", interactableEngineComponent);
  registry.register("AreaTrigger", areaTriggerEngineComponent);
  
  // Experimental
  registry.register("SineWave", sineWaveComponent);
  registry.register("Patrol", patrolComponent);
  registry.register("Blink", blinkComponent);

  // Roguelike
  registry.register("TurnBased", turnBasedEngineComponent);
  registry.register("GridMovement", gridMovementComponent);
  registry.register("FieldOfView", fieldOfViewEngineComponent);
  registry.register("Inventory", inventoryEngineComponent);

  // Drawing & Effects
  registry.register("ScreenShake", screenShakeComponent);
  registry.register("SpriteAnimator", spriteAnimatorComponent);
  registry.register("ParticleEmitter", particleEmitterComponent);

  // Camera
  registry.register("Camera", cameraEngineComponent);

  // Persistence
  registry.register("SaveState", saveStateComponent);
  registry.register("LoadState", loadStateComponent);

  return registry;
}

