import { describe, it, expect } from "vitest";
import {
  ComponentRegistry,
  createDefaultRegistry,
  gravityComponent,
  kinematicComponent,
  kinematicEngineComponent,
  colliderComponent,
  frictionComponent,
  playerControllerComponent,
  navigatorComponent,
  healthComponent,
  healthEngineComponent,
  lifetimeComponent,
  hitboxComponent,
  platformControllerEngineComponent,
  wandererComponent,
  chaserComponent,
  spawnerComponent,
  interactableEngineComponent,
  areaTriggerEngineComponent,
  screenShakeComponent,
  spriteAnimatorComponent,
  particleEmitterComponent,
  cameraEngineComponent,
  parseHexTint,
} from "../engine/components.js";
import {
  createStateBuffer,
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
} from "../engine/memory.js";
import type { EngineState } from "../engine/loop.js";
import type { InputState } from "../engine/input.js";
import type { BakedAsset } from "../engine/baker.js";

function makeState(buffer?: Uint8ClampedArray): EngineState {
  return {
    buffer: buffer ?? createStateBuffer(),
    width: 64,
    height: 64,
    frameCount: 0,
    tickCount: 0,
    camera: { x: 0, y: 0, zoom: 1, shake: 0, tint: [1, 1, 1, 1] },
  };
}

function makeInput(active: string[] = []): InputState {
  return { active: new Set(active) };
}

function makeBaked(overrides?: Partial<BakedAsset>): BakedAsset {
  return {
    width: 64,
    height: 64,
    collisionPolygons: [],
    bezierPaths: [],
    sequencerGrids: [],
    ...overrides,
  };
}

// Use the entity pool start for a stable entity pointer
const ENTITY_PTR = MEMORY_BLOCKS.entityPool.startByte;

// ── ComponentRegistry ─────────────────────────────────────────

describe("ComponentRegistry", () => {
  it("registers and retrieves components by ID", () => {
    const registry = new ComponentRegistry();
    const dummy = () => {};
    registry.register("Test", dummy);
    const comp = registry.get("Test");
    expect(comp).toBeDefined();
    expect(comp!.tick).toBe(dummy);
    expect(registry.has("Test")).toBe(true);
  });

  it("returns undefined for unregistered components", () => {
    const registry = new ComponentRegistry();
    expect(registry.get("Missing")).toBeUndefined();
    expect(registry.has("Missing")).toBe(false);
  });

  it("unregisters a component by ID", () => {
    const registry = new ComponentRegistry();
    const dummy = () => {};
    registry.register("Test", dummy);
    expect(registry.unregister("Test")).toBe(true);
    expect(registry.has("Test")).toBe(false);
    expect(registry.get("Test")).toBeUndefined();
  });

  it("returns false when unregistering an unknown ID", () => {
    const registry = new ComponentRegistry();
    expect(registry.unregister("Missing")).toBe(false);
  });

  it("lists all registered component IDs", () => {
    const registry = new ComponentRegistry();
    registry.register("A", () => {});
    registry.register("B", () => {});
    registry.register("C", () => {});
    expect(registry.list().sort()).toEqual(["A", "B", "C"]);
  });

  it("returns an empty list when no components are registered", () => {
    const registry = new ComponentRegistry();
    expect(registry.list()).toEqual([]);
  });

  it("registers an EngineComponent with getContext", () => {
    const registry = new ComponentRegistry();
    registry.register("Kinematic", kinematicEngineComponent);
    const comp = registry.get("Kinematic");
    expect(comp).toBeDefined();
    expect(comp!.tick).toBe(kinematicComponent);
    expect(comp!.getContext).toBeDefined();
  });
});

describe("createDefaultRegistry", () => {
  it("registers all built-in components", () => {
    const registry = createDefaultRegistry();
    const ids = [
      "Gravity",
      "Kinematic",
      "Collider",
      "Friction",
      "PlayerController",
      "TopDownController",
      "Navigator",
      "Health",
      "Lifetime",
      "Hitbox",
      "PlatformController",
      "Wanderer",
      "Chaser",
      "Spawner",
      "Interactable",
      "AreaTrigger",
      "SineWave",
      "Patrol",
      "Blink",
      "ScreenShake",
      "SpriteAnimator",
      "ParticleEmitter",
      "Camera",
    ];
    for (const id of ids) {
      expect(registry.has(id)).toBe(true);
    }
  });

  it("Kinematic component exposes getContext", () => {
    const registry = createDefaultRegistry();
    const comp = registry.get("Kinematic");
    expect(comp).toBeDefined();
    expect(comp!.getContext).toBeDefined();
  });

  it("Health component exposes getContext with $hp and $maxHp", () => {
    const registry = createDefaultRegistry();
    const comp = registry.get("Health");
    expect(comp).toBeDefined();
    expect(comp!.getContext).toBeDefined();
  });

  it("PlatformController exposes getContext with $isGrounded and $vy", () => {
    const registry = createDefaultRegistry();
    const comp = registry.get("PlatformController");
    expect(comp).toBeDefined();
    expect(comp!.getContext).toBeDefined();
  });

  it("Interactable exposes getContext with $triggered", () => {
    const registry = createDefaultRegistry();
    const comp = registry.get("Interactable");
    expect(comp).toBeDefined();
    expect(comp!.getContext).toBeDefined();
  });

  it("AreaTrigger exposes getContext with $triggered", () => {
    const registry = createDefaultRegistry();
    const comp = registry.get("AreaTrigger");
    expect(comp).toBeDefined();
    expect(comp!.getContext).toBeDefined();
  });
});

// ── Signed Int16 helpers ──────────────────────────────────────

describe("readSignedInt16 / writeSignedInt16", () => {
  it("round-trips positive values", () => {
    const buf = createStateBuffer();
    writeSignedInt16(buf, 64, 100);
    expect(readSignedInt16(buf, 64)).toBe(100);
  });

  it("round-trips negative values", () => {
    const buf = createStateBuffer();
    writeSignedInt16(buf, 64, -5);
    expect(readSignedInt16(buf, 64)).toBe(-5);
  });

  it("round-trips zero", () => {
    const buf = createStateBuffer();
    writeSignedInt16(buf, 64, 0);
    expect(readSignedInt16(buf, 64)).toBe(0);
  });
});

// ── Library 1: Physics & Kinematics ───────────────────────────

describe("gravityComponent", () => {
  it("increases Y-velocity by the force property", () => {
    const buf = createStateBuffer();
    writeInt8(buf, ENTITY_PTR + ENTITY_ACTIVE, 1);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y, 0);

    gravityComponent(buf, ENTITY_PTR, { force: 3 }, makeInput(), makeBaked(), makeState(buf));

    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y)).toBe(3);
  });

  it("defaults to force=1 when not specified", () => {
    const buf = createStateBuffer();
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y, 0);

    gravityComponent(buf, ENTITY_PTR, {}, makeInput(), makeBaked(), makeState(buf));

    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y)).toBe(1);
  });

  it("accumulates over multiple frames", () => {
    const buf = createStateBuffer();
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y, 5);

    gravityComponent(buf, ENTITY_PTR, { force: 2 }, makeInput(), makeBaked(), makeState(buf));

    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y)).toBe(7);
  });
});

describe("kinematicComponent", () => {
  it("adds velocity to position", () => {
    const buf = createStateBuffer();
    writeInt16(buf, ENTITY_PTR + ENTITY_POS_X, 10);
    writeInt16(buf, ENTITY_PTR + ENTITY_POS_Y, 20);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_X, 3);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y, -2);

    kinematicComponent(buf, ENTITY_PTR, {}, makeInput(), makeBaked(), makeState(buf));

    expect(readInt16(buf, ENTITY_PTR + ENTITY_POS_X)).toBe(13);
    expect(readInt16(buf, ENTITY_PTR + ENTITY_POS_Y)).toBe(18);
  });
});

describe("kinematicEngineComponent.getContext", () => {
  it("exposes $vx, $vy, $px, $py from entity memory", () => {
    const buf = createStateBuffer();
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_POS_X, 100);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_POS_Y, 200);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_X, -3);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y, 5);

    const ctx = kinematicEngineComponent.getContext!(buf, ENTITY_PTR, {});
    expect(ctx).toEqual({ $vx: -3, $vy: 5, $px: 100, $py: 200 });
  });
});

describe("colliderComponent", () => {
  it("halts velocity when inside a collision polygon", () => {
    const buf = createStateBuffer();
    writeInt16(buf, ENTITY_PTR + ENTITY_POS_X, 5);
    writeInt16(buf, ENTITY_PTR + ENTITY_POS_Y, 5);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_X, 3);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y, 4);

    const polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const baked = makeBaked({ collisionPolygons: [polygon] });

    colliderComponent(buf, ENTITY_PTR, {}, makeInput(), baked, makeState(buf));

    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_X)).toBe(0);
    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y)).toBe(0);
  });

  it("preserves velocity when outside collision polygons", () => {
    const buf = createStateBuffer();
    writeInt16(buf, ENTITY_PTR + ENTITY_POS_X, 50);
    writeInt16(buf, ENTITY_PTR + ENTITY_POS_Y, 50);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_X, 3);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y, 4);

    const polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const baked = makeBaked({ collisionPolygons: [polygon] });

    colliderComponent(buf, ENTITY_PTR, {}, makeInput(), baked, makeState(buf));

    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_X)).toBe(3);
    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y)).toBe(4);
  });
});

describe("frictionComponent", () => {
  it("reduces velocity by the factor", () => {
    const buf = createStateBuffer();
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_X, 100);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y, -100);

    frictionComponent(buf, ENTITY_PTR, { factor: 0.5 }, makeInput(), makeBaked(), makeState(buf));

    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_X)).toBe(50);
    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y)).toBe(-50);
  });
});

// ── Library 2: Gameplay & AI ──────────────────────────────────

describe("playerControllerComponent", () => {
  it("sets velocity based on active input actions", () => {
    const buf = createStateBuffer();

    playerControllerComponent(
      buf,
      ENTITY_PTR,
      { speed: 5 },
      makeInput(["Action.Right", "Action.Down"]),
      makeBaked(),
      makeState(buf)
    );

    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_X)).toBe(5);
    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y)).toBe(5);
  });

  it("sets velocity to zero when no input is active", () => {
    const buf = createStateBuffer();
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_X, 10);

    playerControllerComponent(buf, ENTITY_PTR, { speed: 5 }, makeInput([]), makeBaked(), makeState(buf));

    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_X)).toBe(0);
    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y)).toBe(0);
  });

  it("handles opposing directions (left + right cancel out)", () => {
    const buf = createStateBuffer();

    playerControllerComponent(
      buf,
      ENTITY_PTR,
      { speed: 3 },
      makeInput(["Action.Left", "Action.Right"]),
      makeBaked(),
      makeState(buf)
    );

    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_X)).toBe(0);
  });
});

describe("navigatorComponent", () => {
  it("moves entity along a bezier path", () => {
    const buf = createStateBuffer();
    const path = [
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ];
    const baked = makeBaked({ bezierPaths: [path] });

    navigatorComponent(buf, ENTITY_PTR, { speed: 1, pathIndex: 0 }, makeInput(), baked, makeState(buf));

    expect(readInt16(buf, ENTITY_PTR + ENTITY_POS_X)).toBe(10);
    expect(readInt16(buf, ENTITY_PTR + ENTITY_POS_Y)).toBe(20);
  });

  it("does nothing when pathIndex is out of range", () => {
    const buf = createStateBuffer();
    writeInt16(buf, ENTITY_PTR + ENTITY_POS_X, 5);

    navigatorComponent(buf, ENTITY_PTR, { pathIndex: 99 }, makeInput(), makeBaked(), makeState(buf));

    expect(readInt16(buf, ENTITY_PTR + ENTITY_POS_X)).toBe(5);
  });
});

describe("healthComponent", () => {
  it("kills entity when health is zero", () => {
    const buf = createStateBuffer();
    writeInt8(buf, ENTITY_PTR + ENTITY_ACTIVE, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_HEALTH, 0);

    healthComponent(buf, ENTITY_PTR, {}, makeInput(), makeBaked(), makeState(buf));

    expect(readInt8(buf, ENTITY_PTR + ENTITY_ACTIVE)).toBe(0);
  });

  it("keeps entity alive when health is above zero", () => {
    const buf = createStateBuffer();
    writeInt8(buf, ENTITY_PTR + ENTITY_ACTIVE, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_HEALTH, 50);

    healthComponent(buf, ENTITY_PTR, {}, makeInput(), makeBaked(), makeState(buf));

    expect(readInt8(buf, ENTITY_PTR + ENTITY_ACTIVE)).toBe(1);
  });
});

describe("healthEngineComponent.getContext", () => {
  it("exposes $hp and $maxHp from entity memory and props", () => {
    const buf = createStateBuffer();
    writeInt8(buf, ENTITY_PTR + ENTITY_HEALTH, 75);

    const ctx = healthEngineComponent.getContext!(buf, ENTITY_PTR, { maxHp: 100 });
    expect(ctx).toEqual({ $hp: 75, $maxHp: 100 });
  });

  it("defaults $maxHp to 100 when not specified", () => {
    const buf = createStateBuffer();
    writeInt8(buf, ENTITY_PTR + ENTITY_HEALTH, 50);

    const ctx = healthEngineComponent.getContext!(buf, ENTITY_PTR, {});
    expect(ctx.$maxHp).toBe(100);
  });
});

describe("hitboxComponent", () => {
  it("applies damage to overlapping entities", () => {
    const buf = createStateBuffer();
    const entityA = ENTITY_PTR;
    const entityB = ENTITY_PTR + ENTITY_SLOT_SIZE;

    // Set up attacker
    writeInt8(buf, entityA + ENTITY_ACTIVE, 1);
    writeSignedInt16(buf, entityA + ENTITY_POS_X, 50);
    writeSignedInt16(buf, entityA + ENTITY_POS_Y, 50);

    // Set up target (overlapping)
    writeInt8(buf, entityB + ENTITY_ACTIVE, 1);
    writeInt8(buf, entityB + ENTITY_HEALTH, 10);
    writeSignedInt16(buf, entityB + ENTITY_POS_X, 55);
    writeSignedInt16(buf, entityB + ENTITY_POS_Y, 50);
    writeSignedInt16(buf, entityB + ENTITY_VEL_X, 0);
    writeSignedInt16(buf, entityB + ENTITY_VEL_Y, 0);

    hitboxComponent(buf, entityA, { width: 16, height: 16, damage: 3, knockback: 4 }, makeInput(), makeBaked(), makeState(buf));

    expect(readInt8(buf, entityB + ENTITY_HEALTH)).toBe(7);
    // Knockback should push B away from A (positive X direction)
    expect(readSignedInt16(buf, entityB + ENTITY_VEL_X)).toBeGreaterThan(0);
  });

  it("does not damage entities outside the hitbox", () => {
    const buf = createStateBuffer();
    const entityA = ENTITY_PTR;
    const entityB = ENTITY_PTR + ENTITY_SLOT_SIZE;

    writeInt8(buf, entityA + ENTITY_ACTIVE, 1);
    writeSignedInt16(buf, entityA + ENTITY_POS_X, 50);
    writeSignedInt16(buf, entityA + ENTITY_POS_Y, 50);

    writeInt8(buf, entityB + ENTITY_ACTIVE, 1);
    writeInt8(buf, entityB + ENTITY_HEALTH, 10);
    writeSignedInt16(buf, entityB + ENTITY_POS_X, 200);
    writeSignedInt16(buf, entityB + ENTITY_POS_Y, 200);

    hitboxComponent(buf, entityA, { width: 16, height: 16, damage: 3 }, makeInput(), makeBaked(), makeState(buf));

    expect(readInt8(buf, entityB + ENTITY_HEALTH)).toBe(10);
  });

  it("does not reduce health below zero", () => {
    const buf = createStateBuffer();
    const entityA = ENTITY_PTR;
    const entityB = ENTITY_PTR + ENTITY_SLOT_SIZE;

    writeInt8(buf, entityA + ENTITY_ACTIVE, 1);
    writeSignedInt16(buf, entityA + ENTITY_POS_X, 50);
    writeSignedInt16(buf, entityA + ENTITY_POS_Y, 50);

    writeInt8(buf, entityB + ENTITY_ACTIVE, 1);
    writeInt8(buf, entityB + ENTITY_HEALTH, 1);
    writeSignedInt16(buf, entityB + ENTITY_POS_X, 50);
    writeSignedInt16(buf, entityB + ENTITY_POS_Y, 50);

    hitboxComponent(buf, entityA, { damage: 5 }, makeInput(), makeBaked(), makeState(buf));

    expect(readInt8(buf, entityB + ENTITY_HEALTH)).toBe(0);
  });
});

describe("lifetimeComponent", () => {
  it("initializes timer on first call, then decrements", () => {
    const buf = createStateBuffer();
    writeInt8(buf, ENTITY_PTR + ENTITY_ACTIVE, 1);

    // First call: initialize timer
    lifetimeComponent(buf, ENTITY_PTR, { frames: 5 }, makeInput(), makeBaked(), makeState(buf));
    expect(readInt8(buf, ENTITY_PTR + ENTITY_DATA_START)).toBe(5);

    // Second call: decrement
    lifetimeComponent(buf, ENTITY_PTR, { frames: 5 }, makeInput(), makeBaked(), makeState(buf));
    expect(readInt8(buf, ENTITY_PTR + ENTITY_DATA_START)).toBe(4);
  });

  it("kills entity when timer reaches zero", () => {
    const buf = createStateBuffer();
    writeInt8(buf, ENTITY_PTR + ENTITY_ACTIVE, 1);
    writeInt8(buf, ENTITY_PTR + ENTITY_DATA_START, 1);

    lifetimeComponent(buf, ENTITY_PTR, {}, makeInput(), makeBaked(), makeState(buf));

    expect(readInt8(buf, ENTITY_PTR + ENTITY_ACTIVE)).toBe(0);
    expect(readInt8(buf, ENTITY_PTR + ENTITY_DATA_START)).toBe(0);
  });
});

// ── Platformer Pack ───────────────────────────────────────────

describe("platformControllerEngineComponent", () => {
  it("sets horizontal velocity from MoveLeft/MoveRight input", () => {
    const buf = createStateBuffer();
    const baked = makeBaked();

    platformControllerEngineComponent.tick!(
      buf, ENTITY_PTR, { speed: 3 },
      makeInput(["Action.MoveRight"]), baked, makeState(buf)
    );

    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_X)).toBe(3);
  });

  it("sets isGrounded=1 when entity is above a collision polygon", () => {
    const buf = createStateBuffer();
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_POS_X, 5);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_POS_Y, 5);

    const ground = [
      { x: 0, y: 5 }, { x: 10, y: 5 },
      { x: 10, y: 15 }, { x: 0, y: 15 },
    ];
    const baked = makeBaked({ collisionPolygons: [ground] });

    platformControllerEngineComponent.tick!(
      buf, ENTITY_PTR, {}, makeInput(), baked, makeState(buf)
    );

    const ctx = platformControllerEngineComponent.getContext!(buf, ENTITY_PTR, {});
    expect(ctx.$isGrounded).toBe(1);
  });

  it("sets isGrounded=0 when entity is in the air", () => {
    const buf = createStateBuffer();
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_POS_X, 5);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_POS_Y, 5);

    const ground = [
      { x: 0, y: 100 }, { x: 10, y: 100 },
      { x: 10, y: 110 }, { x: 0, y: 110 },
    ];
    const baked = makeBaked({ collisionPolygons: [ground] });

    platformControllerEngineComponent.tick!(
      buf, ENTITY_PTR, {}, makeInput(), baked, makeState(buf)
    );

    const ctx = platformControllerEngineComponent.getContext!(buf, ENTITY_PTR, {});
    expect(ctx.$isGrounded).toBe(0);
  });

  it("allows jump only when grounded", () => {
    const buf = createStateBuffer();
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_POS_X, 5);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_POS_Y, 5);

    const ground = [
      { x: 0, y: 5 }, { x: 10, y: 5 },
      { x: 10, y: 15 }, { x: 0, y: 15 },
    ];
    const baked = makeBaked({ collisionPolygons: [ground] });

    platformControllerEngineComponent.tick!(
      buf, ENTITY_PTR, { jumpForce: 8 },
      makeInput(["Action.Jump"]), baked, makeState(buf)
    );

    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y)).toBe(-8);
  });

  it("ignores jump when in the air", () => {
    const buf = createStateBuffer();
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_POS_X, 5);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_POS_Y, 5);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y, 3);

    const baked = makeBaked(); // no polygons = not grounded

    platformControllerEngineComponent.tick!(
      buf, ENTITY_PTR, { jumpForce: 8 },
      makeInput(["Action.Jump"]), baked, makeState(buf)
    );

    // vy should remain unchanged (no jump applied)
    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y)).toBe(3);
  });

  it("getContext exposes $isGrounded and $vy", () => {
    const buf = createStateBuffer();
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y, -5);
    writeInt8(buf, ENTITY_PTR + ENTITY_DATA_START + 3, 1);

    const ctx = platformControllerEngineComponent.getContext!(buf, ENTITY_PTR, {});
    expect(ctx).toEqual({ $isGrounded: 1, $vy: -5 });
  });
});

// ── AI & Logic Pack ───────────────────────────────────────────

describe("wandererComponent", () => {
  it("sets velocity based on random direction", () => {
    const buf = createStateBuffer();
    // Force a non-idle direction by setting direction byte directly
    writeInt8(buf, ENTITY_PTR + ENTITY_DATA_START + 4, 2); // right

    wandererComponent(buf, ENTITY_PTR, { speed: 3, interval: 255 }, makeInput(), makeBaked(), makeState(buf));

    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_X)).toBe(3);
    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y)).toBe(0);
  });

  it("sets zero velocity when direction is idle (0)", () => {
    const buf = createStateBuffer();
    writeInt8(buf, ENTITY_PTR + ENTITY_DATA_START + 4, 0); // idle

    wandererComponent(buf, ENTITY_PTR, { speed: 2, interval: 255 }, makeInput(), makeBaked(), makeState(buf));

    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_X)).toBe(0);
    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_Y)).toBe(0);
  });
});

describe("chaserComponent", () => {
  it("moves toward target entity", () => {
    const buf = createStateBuffer();
    const chaserPtr = ENTITY_PTR;
    const targetPtr = ENTITY_PTR + ENTITY_SLOT_SIZE;

    // Chaser at (0, 0)
    writeInt8(buf, chaserPtr + ENTITY_ACTIVE, 1);
    writeSignedInt16(buf, chaserPtr + ENTITY_POS_X, 0);
    writeSignedInt16(buf, chaserPtr + ENTITY_POS_Y, 0);

    // Target at (100, 0), type 1
    writeInt8(buf, targetPtr + ENTITY_ACTIVE, 1);
    writeInt8(buf, targetPtr + ENTITY_TYPE_ID, 1);
    writeSignedInt16(buf, targetPtr + ENTITY_POS_X, 100);
    writeSignedInt16(buf, targetPtr + ENTITY_POS_Y, 0);

    chaserComponent(buf, chaserPtr, { speed: 5, targetType: 1 }, makeInput(), makeBaked(), makeState(buf));

    // Should move right toward target
    expect(readSignedInt16(buf, chaserPtr + ENTITY_VEL_X)).toBe(5);
    expect(readSignedInt16(buf, chaserPtr + ENTITY_VEL_Y)).toBe(0);
  });

  it("does nothing when no matching target exists", () => {
    const buf = createStateBuffer();
    writeInt8(buf, ENTITY_PTR + ENTITY_ACTIVE, 1);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_X, 0);

    chaserComponent(buf, ENTITY_PTR, { speed: 5, targetType: 99 }, makeInput(), makeBaked(), makeState(buf));

    expect(readSignedInt16(buf, ENTITY_PTR + ENTITY_VEL_X)).toBe(0);
  });
});

describe("spawnerComponent", () => {
  it("spawns an entity when interval is reached", () => {
    const buf = createStateBuffer();
    const spawnerPtr = ENTITY_PTR;
    writeInt8(buf, spawnerPtr + ENTITY_ACTIVE, 1);
    writeSignedInt16(buf, spawnerPtr + ENTITY_POS_X, 50);
    writeSignedInt16(buf, spawnerPtr + ENTITY_POS_Y, 60);

    // Set timer to interval - 1 so next tick triggers spawn
    writeInt8(buf, spawnerPtr + ENTITY_DATA_START + 3, 2);

    spawnerComponent(buf, spawnerPtr, { entity: 5, interval: 3, speedX: 4, speedY: -2 }, makeInput(), makeBaked(), makeState(buf));

    // Find spawned entity
    const childPtr = ENTITY_PTR + ENTITY_SLOT_SIZE;
    expect(readInt8(buf, childPtr + ENTITY_ACTIVE)).toBe(1);
    expect(readInt8(buf, childPtr + ENTITY_TYPE_ID)).toBe(5);
    expect(readInt16(buf, childPtr + ENTITY_POS_X)).toBe(50);
    expect(readInt16(buf, childPtr + ENTITY_POS_Y)).toBe(60);
    expect(readSignedInt16(buf, childPtr + ENTITY_VEL_X)).toBe(4);
    expect(readSignedInt16(buf, childPtr + ENTITY_VEL_Y)).toBe(-2);
  });

  it("does not spawn before interval is reached", () => {
    const buf = createStateBuffer();
    writeInt8(buf, ENTITY_PTR + ENTITY_ACTIVE, 1);

    spawnerComponent(buf, ENTITY_PTR, { entity: 5, interval: 60 }, makeInput(), makeBaked(), makeState(buf));

    // No entity should be spawned yet
    const childPtr = ENTITY_PTR + ENTITY_SLOT_SIZE;
    expect(readInt8(buf, childPtr + ENTITY_ACTIVE)).toBe(0);
  });
});

// ── Interaction Pack ──────────────────────────────────────────

describe("interactableEngineComponent", () => {
  it("sets triggered=1 when player is in range and input is active", () => {
    const buf = createStateBuffer();
    const interactablePtr = ENTITY_PTR;
    const playerPtr = ENTITY_PTR + ENTITY_SLOT_SIZE;

    writeInt8(buf, interactablePtr + ENTITY_ACTIVE, 1);
    writeSignedInt16(buf, interactablePtr + ENTITY_POS_X, 50);
    writeSignedInt16(buf, interactablePtr + ENTITY_POS_Y, 50);

    writeInt8(buf, playerPtr + ENTITY_ACTIVE, 1);
    writeInt8(buf, playerPtr + ENTITY_TYPE_ID, 1);
    writeSignedInt16(buf, playerPtr + ENTITY_POS_X, 55);
    writeSignedInt16(buf, playerPtr + ENTITY_POS_Y, 50);

    interactableEngineComponent.tick!(
      buf, interactablePtr, { radius: 16, targetType: 1 },
      makeInput(["Action.Interact"]), makeBaked(), makeState(buf)
    );

    const ctx = interactableEngineComponent.getContext!(buf, interactablePtr, {});
    expect(ctx.$triggered).toBe(1);
  });

  it("does not trigger when input is not active", () => {
    const buf = createStateBuffer();
    const interactablePtr = ENTITY_PTR;
    const playerPtr = ENTITY_PTR + ENTITY_SLOT_SIZE;

    writeInt8(buf, interactablePtr + ENTITY_ACTIVE, 1);
    writeSignedInt16(buf, interactablePtr + ENTITY_POS_X, 50);
    writeSignedInt16(buf, interactablePtr + ENTITY_POS_Y, 50);

    writeInt8(buf, playerPtr + ENTITY_ACTIVE, 1);
    writeInt8(buf, playerPtr + ENTITY_TYPE_ID, 1);
    writeSignedInt16(buf, playerPtr + ENTITY_POS_X, 55);
    writeSignedInt16(buf, playerPtr + ENTITY_POS_Y, 50);

    interactableEngineComponent.tick!(
      buf, interactablePtr, { radius: 16, targetType: 1 },
      makeInput(), makeBaked(), makeState(buf)
    );

    const ctx = interactableEngineComponent.getContext!(buf, interactablePtr, {});
    expect(ctx.$triggered).toBe(0);
  });

  it("does not trigger when player is out of range", () => {
    const buf = createStateBuffer();
    const interactablePtr = ENTITY_PTR;
    const playerPtr = ENTITY_PTR + ENTITY_SLOT_SIZE;

    writeInt8(buf, interactablePtr + ENTITY_ACTIVE, 1);
    writeSignedInt16(buf, interactablePtr + ENTITY_POS_X, 50);
    writeSignedInt16(buf, interactablePtr + ENTITY_POS_Y, 50);

    writeInt8(buf, playerPtr + ENTITY_ACTIVE, 1);
    writeInt8(buf, playerPtr + ENTITY_TYPE_ID, 1);
    writeSignedInt16(buf, playerPtr + ENTITY_POS_X, 200);
    writeSignedInt16(buf, playerPtr + ENTITY_POS_Y, 200);

    interactableEngineComponent.tick!(
      buf, interactablePtr, { radius: 16, targetType: 1 },
      makeInput(["Action.Interact"]), makeBaked(), makeState(buf)
    );

    const ctx = interactableEngineComponent.getContext!(buf, interactablePtr, {});
    expect(ctx.$triggered).toBe(0);
  });
});

describe("areaTriggerEngineComponent", () => {
  it("sets triggered=1 when target entity enters area", () => {
    const buf = createStateBuffer();
    const triggerPtr = ENTITY_PTR;
    const playerPtr = ENTITY_PTR + ENTITY_SLOT_SIZE;

    writeInt8(buf, triggerPtr + ENTITY_ACTIVE, 1);
    writeSignedInt16(buf, triggerPtr + ENTITY_POS_X, 50);
    writeSignedInt16(buf, triggerPtr + ENTITY_POS_Y, 50);

    writeInt8(buf, playerPtr + ENTITY_ACTIVE, 1);
    writeInt8(buf, playerPtr + ENTITY_TYPE_ID, 1);
    writeSignedInt16(buf, playerPtr + ENTITY_POS_X, 52);
    writeSignedInt16(buf, playerPtr + ENTITY_POS_Y, 50);

    areaTriggerEngineComponent.tick!(
      buf, triggerPtr, { width: 16, height: 16, targetType: 1 },
      makeInput(), makeBaked(), makeState(buf)
    );

    const ctx = areaTriggerEngineComponent.getContext!(buf, triggerPtr, {});
    expect(ctx.$triggered).toBe(1);
  });

  it("sets triggered=0 when target entity is outside area", () => {
    const buf = createStateBuffer();
    const triggerPtr = ENTITY_PTR;
    const playerPtr = ENTITY_PTR + ENTITY_SLOT_SIZE;

    writeInt8(buf, triggerPtr + ENTITY_ACTIVE, 1);
    writeSignedInt16(buf, triggerPtr + ENTITY_POS_X, 50);
    writeSignedInt16(buf, triggerPtr + ENTITY_POS_Y, 50);

    writeInt8(buf, playerPtr + ENTITY_ACTIVE, 1);
    writeInt8(buf, playerPtr + ENTITY_TYPE_ID, 1);
    writeSignedInt16(buf, playerPtr + ENTITY_POS_X, 200);
    writeSignedInt16(buf, playerPtr + ENTITY_POS_Y, 200);

    areaTriggerEngineComponent.tick!(
      buf, triggerPtr, { width: 16, height: 16, targetType: 1 },
      makeInput(), makeBaked(), makeState(buf)
    );

    const ctx = areaTriggerEngineComponent.getContext!(buf, triggerPtr, {});
    expect(ctx.$triggered).toBe(0);
  });

  it("resets triggered when entity leaves the area", () => {
    const buf = createStateBuffer();
    const triggerPtr = ENTITY_PTR;
    const playerPtr = ENTITY_PTR + ENTITY_SLOT_SIZE;

    writeInt8(buf, triggerPtr + ENTITY_ACTIVE, 1);
    writeSignedInt16(buf, triggerPtr + ENTITY_POS_X, 50);
    writeSignedInt16(buf, triggerPtr + ENTITY_POS_Y, 50);

    writeInt8(buf, playerPtr + ENTITY_ACTIVE, 1);
    writeInt8(buf, playerPtr + ENTITY_TYPE_ID, 1);

    // First: player inside
    writeSignedInt16(buf, playerPtr + ENTITY_POS_X, 52);
    writeSignedInt16(buf, playerPtr + ENTITY_POS_Y, 50);
    areaTriggerEngineComponent.tick!(
      buf, triggerPtr, { width: 16, height: 16, targetType: 1 },
      makeInput(), makeBaked(), makeState(buf)
    );
    expect(areaTriggerEngineComponent.getContext!(buf, triggerPtr, {}).$triggered).toBe(1);

    // Then: player outside
    writeSignedInt16(buf, playerPtr + ENTITY_POS_X, 200);
    writeSignedInt16(buf, playerPtr + ENTITY_POS_Y, 200);
    areaTriggerEngineComponent.tick!(
      buf, triggerPtr, { width: 16, height: 16, targetType: 1 },
      makeInput(), makeBaked(), makeState(buf)
    );
    expect(areaTriggerEngineComponent.getContext!(buf, triggerPtr, {}).$triggered).toBe(0);
  });
});

// ── Library 3: Drawing & Effects ──────────────────────────────

describe("screenShakeComponent", () => {
  it("writes camera offsets to global memory", () => {
    const buf = createStateBuffer();
    writeSignedInt16(buf, CAMERA_SHAKE_X, 0);
    writeSignedInt16(buf, CAMERA_SHAKE_Y, 0);

    // Run multiple times to ensure it writes something (random, so check range)
    screenShakeComponent(buf, ENTITY_PTR, { intensity: 5 }, makeInput(), makeBaked(), makeState(buf));

    const sx = readSignedInt16(buf, CAMERA_SHAKE_X);
    const sy = readSignedInt16(buf, CAMERA_SHAKE_Y);
    expect(sx).toBeGreaterThanOrEqual(-5);
    expect(sx).toBeLessThanOrEqual(5);
    expect(sy).toBeGreaterThanOrEqual(-5);
    expect(sy).toBeLessThanOrEqual(5);
  });
});

describe("spriteAnimatorComponent", () => {
  it("cycles sprite ID when frame delay is reached", () => {
    const buf = createStateBuffer();
    writeInt8(buf, ENTITY_PTR + ENTITY_DATA_START, 0);

    // Run enough frames to trigger a cycle (frameDelay = 2, count = 3)
    for (let i = 0; i < 2; i++) {
      spriteAnimatorComponent(buf, ENTITY_PTR, { frames: 2, count: 3 }, makeInput(), makeBaked(), makeState(buf));
    }

    expect(readInt8(buf, ENTITY_PTR + ENTITY_DATA_START)).toBe(1);
  });

  it("wraps sprite ID back to zero", () => {
    const buf = createStateBuffer();
    writeInt8(buf, ENTITY_PTR + ENTITY_DATA_START, 2);

    // Trigger a cycle with count=3 (2 → 0)
    for (let i = 0; i < 2; i++) {
      spriteAnimatorComponent(buf, ENTITY_PTR, { frames: 2, count: 3 }, makeInput(), makeBaked(), makeState(buf));
    }

    expect(readInt8(buf, ENTITY_PTR + ENTITY_DATA_START)).toBe(0);
  });

  it("does not modify entity type ID during animation", () => {
    const buf = createStateBuffer();
    writeInt8(buf, ENTITY_PTR + ENTITY_TYPE_ID, 5);
    writeInt8(buf, ENTITY_PTR + ENTITY_DATA_START, 0);

    for (let i = 0; i < 4; i++) {
      spriteAnimatorComponent(buf, ENTITY_PTR, { frames: 2, count: 3 }, makeInput(), makeBaked(), makeState(buf));
    }

    // Type ID must remain unchanged
    expect(readInt8(buf, ENTITY_PTR + ENTITY_TYPE_ID)).toBe(5);
  });
});

describe("particleEmitterComponent", () => {
  it("spawns entities in empty slots", () => {
    const buf = createStateBuffer();
    const emitterPtr = ENTITY_PTR;

    // Set up emitter entity
    writeInt8(buf, emitterPtr + ENTITY_ACTIVE, 1);
    writeInt16(buf, emitterPtr + ENTITY_POS_X, 32);
    writeInt16(buf, emitterPtr + ENTITY_POS_Y, 32);

    particleEmitterComponent(
      buf,
      emitterPtr,
      { rate: 2, lifetime: 10 },
      makeInput(),
      makeBaked(),
      makeState(buf)
    );

    // Check that 2 entities were spawned (skip the emitter slot)
    let spawned = 0;
    const poolStart = MEMORY_BLOCKS.entityPool.startByte;
    const poolEnd = MEMORY_BLOCKS.entityPool.endByte;
    for (let ptr = poolStart; ptr + ENTITY_SLOT_SIZE <= poolEnd + 1; ptr += ENTITY_SLOT_SIZE) {
      if (ptr === emitterPtr) continue;
      if (readInt8(buf, ptr + ENTITY_ACTIVE) === 1) spawned++;
    }
    expect(spawned).toBe(2);
  });
});

// ── Library 4: Camera ─────────────────────────────────────────

describe("parseHexTint", () => {
  it("parses a full 6-digit hex color", () => {
    expect(parseHexTint("#FF0000")).toEqual([1, 0, 0, 1]);
  });

  it("parses a 3-digit shorthand hex color", () => {
    const [r, g, b, a] = parseHexTint("#F00");
    expect(r).toBeCloseTo(1);
    expect(g).toBeCloseTo(0);
    expect(b).toBeCloseTo(0);
    expect(a).toBe(1);
  });

  it("returns white for invalid input", () => {
    expect(parseHexTint("")).toEqual([1, 1, 1, 1]);
    expect(parseHexTint("xyz")).toEqual([1, 1, 1, 1]);
  });

  it("handles white (#FFFFFF)", () => {
    expect(parseHexTint("#FFFFFF")).toEqual([1, 1, 1, 1]);
  });

  it("handles black (#000000)", () => {
    expect(parseHexTint("#000000")).toEqual([0, 0, 0, 1]);
  });

  it("handles hex without hash prefix", () => {
    expect(parseHexTint("00FF00")).toEqual([0, 1, 0, 1]);
  });
});

describe("cameraEngineComponent", () => {
  it("updates state.camera position to center entity on screen", () => {
    const buf = createStateBuffer();
    const state = makeState(buf);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_POS_X, 100);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_POS_Y, 80);

    cameraEngineComponent.tick!(buf, ENTITY_PTR, {}, makeInput(), makeBaked(), state);

    // targetX = 100 - 64 / (2*1) = 100 - 32 = 68
    // targetY = 80 - 64 / (2*1) = 80 - 32 = 48
    expect(state.camera.x).toBe(68);
    expect(state.camera.y).toBe(48);
  });

  it("applies zoom factor", () => {
    const buf = createStateBuffer();
    const state = makeState(buf);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_POS_X, 100);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_POS_Y, 80);

    cameraEngineComponent.tick!(buf, ENTITY_PTR, { zoom: 2 }, makeInput(), makeBaked(), state);

    // targetX = 100 - 64 / (2*2) = 100 - 16 = 84
    // targetY = 80 - 64 / (2*2) = 80 - 16 = 64
    expect(state.camera.x).toBe(84);
    expect(state.camera.y).toBe(64);
    expect(state.camera.zoom).toBe(2);
  });

  it("writes shake to state.camera", () => {
    const buf = createStateBuffer();
    const state = makeState(buf);

    cameraEngineComponent.tick!(buf, ENTITY_PTR, { shake: 5 }, makeInput(), makeBaked(), state);

    expect(state.camera.shake).toBe(5);
  });

  it("parses tint hex color to normalized RGBA", () => {
    const buf = createStateBuffer();
    const state = makeState(buf);

    cameraEngineComponent.tick!(buf, ENTITY_PTR, { tint: "#FF0000" }, makeInput(), makeBaked(), state);

    expect(state.camera.tint).toEqual([1, 0, 0, 1]);
  });

  it("defaults to white tint when not specified", () => {
    const buf = createStateBuffer();
    const state = makeState(buf);

    cameraEngineComponent.tick!(buf, ENTITY_PTR, {}, makeInput(), makeBaked(), state);

    expect(state.camera.tint).toEqual([1, 1, 1, 1]);
  });

  it("lerps position with followSpeed < 1", () => {
    const buf = createStateBuffer();
    const state = makeState(buf);
    state.camera.x = 0;
    state.camera.y = 0;
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_POS_X, 100);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_POS_Y, 80);

    cameraEngineComponent.tick!(buf, ENTITY_PTR, { followSpeed: 0.5 }, makeInput(), makeBaked(), state);

    // targetX = 68, from 0: 0 + (68 - 0) * 0.5 = 34
    // targetY = 48, from 0: 0 + (48 - 0) * 0.5 = 24
    expect(state.camera.x).toBe(34);
    expect(state.camera.y).toBe(24);
  });

  it("snaps instantly with followSpeed = 1 (default)", () => {
    const buf = createStateBuffer();
    const state = makeState(buf);
    state.camera.x = 999;
    state.camera.y = 999;
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_POS_X, 100);
    writeSignedInt16(buf, ENTITY_PTR + ENTITY_POS_Y, 80);

    cameraEngineComponent.tick!(buf, ENTITY_PTR, {}, makeInput(), makeBaked(), state);

    expect(state.camera.x).toBe(68);
    expect(state.camera.y).toBe(48);
  });
});
