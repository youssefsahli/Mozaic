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
 */
export const cameraEngineComponent: EngineComponent = {
  name: "Camera",
  tick: (buffer, entityPtr, props, _input, _baked, state) => {
    const zoom = (props.zoom as number) ?? 1;
    const shake = (props.shake as number) ?? 0;
    const tint = parseHexTint((props.tint as string) ?? "#FFFFFF");
    const followSpeed = Math.min(1, Math.max(0, (props.followSpeed as number) ?? 1)); // clamp to [0, 1]

    const px = readSignedInt16(buffer, entityPtr + ENTITY_POS_X);
    const py = readSignedInt16(buffer, entityPtr + ENTITY_POS_Y);

    // Target camera position: center entity on screen
    const targetX = px - state.width / (2 * zoom);
    const targetY = py - state.height / (2 * zoom);

    // Lerp toward target (followSpeed=1 → instant snap)
    state.camera.x += (targetX - state.camera.x) * followSpeed;
    state.camera.y += (targetY - state.camera.y) * followSpeed;

    state.camera.zoom = zoom;
    state.camera.shake = shake;
    state.camera.tint = tint;
  },
};

// ── Default Registry ──────────────────────────────────────────

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
  registry.register("Health", healthComponent);
  registry.register("Lifetime", lifetimeComponent);

  // Drawing & Effects
  registry.register("ScreenShake", screenShakeComponent);
  registry.register("SpriteAnimator", spriteAnimatorComponent);
  registry.register("ParticleEmitter", particleEmitterComponent);

  // Camera
  registry.register("Camera", cameraEngineComponent);

  return registry;
}
