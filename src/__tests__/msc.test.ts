import { describe, it, expect } from "vitest";
import { parseMsc } from "../parser/msc.js";

const SAMPLE_MSC = `
# Mozaic Script Example
Source: "level_1.mzk"
Import: "core_physics.msc"

Schema:
  - $PlayerX:  { addr: 0, type: Int16 }
  - $PlayerHP: { addr: 2, type: Int8 }

Entity.Hero:
  Visual: "hero.png"
  Physics:
    - shape: auto_alpha
    - solid: true
  Input:
    - Key_Space -> Action.Jump
    - Pad_A     -> Action.Jump

Events:
  Collision(Hero:#Feet, Level:#FFFF00):
    - State.$PlayerHP = State.$PlayerHP - 1
`;

describe("parseMsc", () => {
  it("parses Source field", () => {
    const doc = parseMsc(SAMPLE_MSC);
    expect(doc.source).toBe("level_1.mzk");
  });

  it("parses Import field", () => {
    const doc = parseMsc(SAMPLE_MSC);
    expect(doc.imports).toContain("core_physics.msc");
  });

  it("parses Schema fields", () => {
    const doc = parseMsc(SAMPLE_MSC);
    expect(doc.schema["$PlayerX"]).toEqual({ addr: 0, type: "Int16" });
    expect(doc.schema["$PlayerHP"]).toEqual({ addr: 2, type: "Int8" });
  });

  it("parses Entity visual", () => {
    const doc = parseMsc(SAMPLE_MSC);
    expect(doc.entities["Hero"]?.visual).toBe("hero.png");
  });

  it("parses Entity input bindings", () => {
    const doc = parseMsc(SAMPLE_MSC);
    const inputs = doc.entities["Hero"]?.inputs ?? [];
    expect(inputs).toContainEqual({ key: "Key_Space", action: "Action.Jump" });
    expect(inputs).toContainEqual({ key: "Pad_A", action: "Action.Jump" });
  });

  it("parses Events block", () => {
    const doc = parseMsc(SAMPLE_MSC);
    expect(doc.events.length).toBeGreaterThan(0);
    expect(doc.events[0].trigger).toBe("Collision(Hero:#Feet, Level:#FFFF00)");
  });

  it("returns empty doc for empty input", () => {
    const doc = parseMsc("");
    expect(doc.source).toBeUndefined();
    expect(doc.imports).toHaveLength(0);
    expect(Object.keys(doc.schema)).toHaveLength(0);
  });

  it("filters out empty import paths", () => {
    const doc = parseMsc('Import: ""\nImport: "valid.msc"\n');
    expect(doc.imports).toEqual(["valid.msc"]);
  });

  it("parses Instances block (multi-line form)", () => {
    const msc = `
Entity.TinyHero:
  Visual: "hero_idle"

Entity.FallingCrate:
  Visual: "crate"

Instances:
  - entity: "TinyHero"
    x: 32
    y: 32
  - entity: "FallingCrate"
    x: 100
    y: -10
`;
    const doc = parseMsc(msc);
    expect(doc.instances).toBeDefined();
    expect(doc.instances).toHaveLength(2);
    expect(doc.instances![0]).toEqual({ entity: "TinyHero", x: 32, y: 32 });
    expect(doc.instances![1]).toEqual({ entity: "FallingCrate", x: 100, y: -10 });
  });

  it("parses Instances block (inline form)", () => {
    const msc = `
Entity.TinyHero:
  Visual: "hero_idle"

Instances:
  - { entity: "TinyHero", x: 20, y: 20 }
`;
    const doc = parseMsc(msc);
    expect(doc.instances).toBeDefined();
    expect(doc.instances).toHaveLength(1);
    expect(doc.instances![0]).toEqual({ entity: "TinyHero", x: 20, y: 20 });
  });

  it("returns no instances field when Instances block is absent", () => {
    const doc = parseMsc(SAMPLE_MSC);
    expect(doc.instances).toBeUndefined();
  });
});
