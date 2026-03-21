import { describe, it, expect } from "vitest";
import { buildActionMap, InputManager, normalizeCode } from "../engine/input.js";

describe("normalizeCode", () => {
  it("normalizes KeyW to Key_W", () => {
    expect(normalizeCode("KeyW")).toBe("Key_W");
  });
  it("normalizes Space to Key_Space", () => {
    expect(normalizeCode("Space")).toBe("Key_Space");
  });
  it("normalizes ArrowUp to Key_ArrowUp", () => {
    expect(normalizeCode("ArrowUp")).toBe("Key_ArrowUp");
  });
  it("normalizes Digit1 to Key_Digit1", () => {
    expect(normalizeCode("Digit1")).toBe("Key_Digit1");
  });
  it("leaves Key_W unchanged", () => {
    expect(normalizeCode("Key_W")).toBe("Key_W");
  });
  it("leaves Key_ArrowUp unchanged", () => {
    expect(normalizeCode("Key_ArrowUp")).toBe("Key_ArrowUp");
  });
  it("leaves Pad_A unchanged", () => {
    expect(normalizeCode("Pad_A")).toBe("Pad_A");
  });
});

describe("buildActionMap", () => {
  it("creates an action map from bindings", () => {
    const map = buildActionMap([
      { key: "Key_Space", action: "Action.Jump" },
      { key: "Pad_A", action: "Action.Jump" },
      { key: "ArrowLeft", action: "Action.MoveLeft" },
    ]);

    expect(map.has("Action.Jump")).toBe(true);
    expect(map.get("Action.Jump")).toContain("Key_Space");
    expect(map.get("Action.Jump")).toContain("Pad_A");
    expect(map.has("Action.MoveLeft")).toBe(true);
    // ArrowLeft should be normalized to Key_ArrowLeft
    expect(map.get("Action.MoveLeft")).toContain("Key_ArrowLeft");
  });

  it("normalizes Key_ArrowUp in bindings", () => {
    const map = buildActionMap([
      { key: "Key_ArrowUp", action: "Action.MoveUp" },
    ]);
    // Already-prefixed key stays unchanged
    expect(map.get("Action.MoveUp")).toContain("Key_ArrowUp");
  });

  it("returns empty map for empty bindings", () => {
    expect(buildActionMap([])).toHaveProperty("size", 0);
  });
});

describe("InputManager.sample", () => {
  it("returns no active actions when no keys are held", () => {
    const mgr = new InputManager([
      { key: "Key_Space", action: "Action.Jump" },
    ]);
    const state = mgr.sample();
    expect(state.active.has("Action.Jump")).toBe(false);
  });

  it("normalizes browser KeyW to MSC Key_W and activates action", () => {
    const mgr = new InputManager([
      { key: "Key_W", action: "Action.MoveUp" },
    ]);

    // Simulate keydown with browser code "KeyW" (no underscore)
    const event = new KeyboardEvent("keydown", { code: "KeyW" });
    window.dispatchEvent(event);

    const state = mgr.sample();
    expect(state.active.has("Action.MoveUp")).toBe(true);

    // Simulate keyup
    const upEvent = new KeyboardEvent("keyup", { code: "KeyW" });
    window.dispatchEvent(upEvent);

    const state2 = mgr.sample();
    expect(state2.active.has("Action.MoveUp")).toBe(false);

    mgr.dispose();
  });

  it("does not break non-letter codes like ArrowLeft", () => {
    const mgr = new InputManager([
      { key: "ArrowLeft", action: "Action.MoveLeft" },
    ]);

    // Both ArrowLeft binding and ArrowLeft browser code normalize to Key_ArrowLeft
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft" }));
    expect(mgr.sample().active.has("Action.MoveLeft")).toBe(true);

    window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowLeft" }));
    expect(mgr.sample().active.has("Action.MoveLeft")).toBe(false);

    mgr.dispose();
  });

  it("matches Key_ArrowUp binding with browser ArrowUp code", () => {
    const mgr = new InputManager([
      { key: "Key_ArrowUp", action: "Action.MoveUp" },
    ]);

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowUp" }));
    expect(mgr.sample().active.has("Action.MoveUp")).toBe(true);

    window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowUp" }));
    expect(mgr.sample().active.has("Action.MoveUp")).toBe(false);

    mgr.dispose();
  });

  it("normalizes browser Space to MSC Key_Space and activates action", () => {
    const mgr = new InputManager([
      { key: "Key_Space", action: "Action.Jump" },
    ]);

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    expect(mgr.sample().active.has("Action.Jump")).toBe(true);

    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
    expect(mgr.sample().active.has("Action.Jump")).toBe(false);

    mgr.dispose();
  });
});
