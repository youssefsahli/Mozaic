import { describe, it, expect } from "vitest";
import {
  ComponentRegistry,
  createDefaultRegistry,
  gravityComponent,
  kinematicComponent,
  colliderComponent,
  frictionComponent,
  playerControllerComponent,
  navigatorComponent,
  healthComponent,
  lifetimeComponent,
  screenShakeComponent,
  spriteAnimatorComponent,
  particleEmitterComponent,
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
    expect(registry.get("Test")).toBe(dummy);
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
});

describe("createDefaultRegistry", () => {
  it("registers all 11 built-in components", () => {
    const registry = createDefaultRegistry();
    const ids = [
      "Gravity",
      "Kinematic",
      "Collider",
      "Friction",
      "PlayerController",
      "Navigator",
      "Health",
      "Lifetime",
      "ScreenShake",
      "SpriteAnimator",
      "ParticleEmitter",
    ];
    for (const id of ids) {
      expect(registry.has(id)).toBe(true);
    }
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
  it("cycles type ID when frame delay is reached", () => {
    const buf = createStateBuffer();
    writeInt8(buf, ENTITY_PTR + ENTITY_TYPE_ID, 0);

    // Run enough frames to trigger a cycle (frameDelay = 2, count = 3)
    for (let i = 0; i < 2; i++) {
      spriteAnimatorComponent(buf, ENTITY_PTR, { frames: 2, count: 3 }, makeInput(), makeBaked(), makeState(buf));
    }

    expect(readInt8(buf, ENTITY_PTR + ENTITY_TYPE_ID)).toBe(1);
  });

  it("wraps type ID back to zero", () => {
    const buf = createStateBuffer();
    writeInt8(buf, ENTITY_PTR + ENTITY_TYPE_ID, 2);

    // Trigger a cycle with count=3 (2 → 0)
    for (let i = 0; i < 2; i++) {
      spriteAnimatorComponent(buf, ENTITY_PTR, { frames: 2, count: 3 }, makeInput(), makeBaked(), makeState(buf));
    }

    expect(readInt8(buf, ENTITY_PTR + ENTITY_TYPE_ID)).toBe(0);
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
