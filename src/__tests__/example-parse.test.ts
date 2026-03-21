import { describe, it, expect } from "vitest";
import { parseMsc } from "../parser/msc.js";
// @ts-expect-error — Node-only fs module; vitest runs in Node
import { readFileSync } from "fs";

describe("example ROM parsing with instances", () => {
  it("platformer.msc parses with instances", () => {
    const text = readFileSync("public/examples/platformer.msc", "utf-8");
    const doc = parseMsc(text);
    expect(Object.keys(doc.entities)).toEqual(["Hero", "Coin"]);
    expect(doc.sprites.has("Hero")).toBe(true);
    expect(doc.sprites.has("Coin")).toBe(true);
    expect(doc.instances).toBeDefined();
    expect(doc.instances).toHaveLength(4);
    expect(doc.instances![0]).toEqual({ entity: "Hero", x: 8, y: 40 });
    expect(doc.instances![1]).toEqual({ entity: "Coin", x: 32, y: 24 });
    expect(doc.instances![2]).toEqual({ entity: "Coin", x: 48, y: 36 });
    expect(doc.instances![3]).toEqual({ entity: "Coin", x: 16, y: 52 });
    expect(doc.events).toHaveLength(1);
  });

  it("top-down.msc parses with instances", () => {
    const text = readFileSync("public/examples/top-down.msc", "utf-8");
    const doc = parseMsc(text);
    expect(Object.keys(doc.entities)).toEqual(["Player", "NPC", "Chest"]);
    expect(doc.instances).toBeDefined();
    expect(doc.instances).toHaveLength(3);
    expect(doc.instances![0]).toEqual({ entity: "Player", x: 8, y: 32 });
    expect(doc.instances![1]).toEqual({ entity: "NPC", x: 40, y: 40 });
    expect(doc.instances![2]).toEqual({ entity: "Chest", x: 44, y: 12 });
  });

  it("particles.msc parses with instances", () => {
    const text = readFileSync("public/examples/particles.msc", "utf-8");
    const doc = parseMsc(text);
    expect(Object.keys(doc.entities)).toEqual(["Emitter", "Spark"]);
    expect(doc.instances).toBeDefined();
    expect(doc.instances).toHaveLength(1);
    expect(doc.instances![0]).toEqual({ entity: "Emitter", x: 24, y: 20 });
  });

  it("all instance entity names match defined entities", () => {
    for (const file of ["platformer", "top-down", "particles"]) {
      const text = readFileSync(`public/examples/${file}.msc`, "utf-8");
      const doc = parseMsc(text);
      const entityNames = Object.keys(doc.entities);
      for (const inst of doc.instances ?? []) {
        expect(entityNames).toContain(inst.entity);
      }
    }
  });
});
