import { describe, it, expect } from "vitest";
import { buildActionMap, InputManager } from "../engine/input.js";

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
});
