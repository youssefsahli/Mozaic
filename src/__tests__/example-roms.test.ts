import { describe, it, expect } from "vitest";
import {
  exampleScriptForVariant,
  ROM_VARIANT_LABELS,
  type RomVariant,
} from "../editor/example-roms.js";

describe("example-roms", () => {
  // ── exampleScriptForVariant ──────────────────────────────

  it("returns a Source line referencing the given mzk name", () => {
    const variants: RomVariant[] = ["empty", "platformer", "top-down", "particles"];
    for (const v of variants) {
      const script = exampleScriptForVariant(v, "test.mzk");
      expect(script).toContain('Source: "test.mzk"');
    }
  });

  it("platformer script contains expected components", () => {
    const script = exampleScriptForVariant("platformer", "level.mzk");
    expect(script).toContain("PlatformController:");
    expect(script).toContain("Gravity:");
    expect(script).toContain("Entity.Hero:");
    expect(script).toContain("Entity.Coin:");
    expect(script).toContain("Schema:");
  });

  it("top-down script contains expected components", () => {
    const script = exampleScriptForVariant("top-down", "map.mzk");
    expect(script).toContain("TopDownController:");
    expect(script).toContain("Wanderer:");
    expect(script).toContain("AreaTrigger:");
    expect(script).toContain("Entity.Player:");
    expect(script).toContain("Entity.NPC:");
  });

  it("particles script contains expected components", () => {
    const script = exampleScriptForVariant("particles", "fx.mzk");
    expect(script).toContain("ParticleEmitter:");
    expect(script).toContain("SpriteAnimator:");
    expect(script).toContain("Blink:");
    expect(script).toContain("Entity.Emitter:");
    expect(script).toContain("Entity.Spark:");
  });

  it("non-example variants return the default starter script", () => {
    for (const v of ["empty", "amiga", "checkerboard"] as RomVariant[]) {
      const script = exampleScriptForVariant(v, "sprite.mzk");
      expect(script).toContain('Source: "sprite.mzk"');
      expect(script).toContain("$Score");
    }
  });

  // ── ROM_VARIANT_LABELS ────────────────────────────────────

  it("provides a label for every variant", () => {
    const expected: RomVariant[] = [
      "empty", "amiga", "checkerboard",
      "platformer", "top-down", "particles",
    ];
    for (const v of expected) {
      expect(ROM_VARIANT_LABELS[v]).toBeTruthy();
    }
  });
});
