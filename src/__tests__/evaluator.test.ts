import { describe, it, expect } from "vitest";
import {
  buildEvaluatorLogic,
  readSchemaVar,
  writeSchemaVar,
} from "../engine/evaluator.js";
import { createStateBuffer } from "../engine/memory.js";
import type { EngineState } from "../engine/loop.js";
import type { InputState } from "../engine/input.js";
import type { BakedAsset } from "../engine/baker.js";
import type { MscDocument, MscSchema } from "../parser/msc.js";

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

function makeBaked(): BakedAsset {
  return {
    width: 64,
    height: 64,
    collisionPolygons: [],
    bezierPaths: [],
    sequencerGrids: [],
  };
}

function makeScript(
  schema: MscSchema,
  events: MscDocument["events"] = []
): MscDocument {
  return { imports: [], schema, entities: {}, events, sprites: new Map(), spriteGrid: 0 };
}

// ── readSchemaVar / writeSchemaVar ───────────────────────────

describe("readSchemaVar / writeSchemaVar", () => {
  it("reads and writes Int8 schema variable", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {
      $HP: { addr: 64, type: "Int8" },
    };
    writeSchemaVar(buf, schema, "$HP", 42);
    expect(readSchemaVar(buf, schema, "$HP")).toBe(42);
  });

  it("reads and writes Int16 schema variable", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {
      $Score: { addr: 64, type: "Int16" },
    };
    writeSchemaVar(buf, schema, "$Score", 1000);
    expect(readSchemaVar(buf, schema, "$Score")).toBe(1000);
  });

  it("returns 0 for unknown variable names", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {};
    expect(readSchemaVar(buf, schema, "$Unknown")).toBe(0);
  });
});

// ── buildEvaluatorLogic ───────────────────────────────────────

describe("buildEvaluatorLogic — OnFrame trigger", () => {
  it("increments a counter variable every frame", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = { $Count: { addr: 64, type: "Int8" } };
    const script = makeScript(schema, [
      { trigger: "OnFrame", actions: ["State.$Count = State.$Count + 1"] },
    ]);

    const logic = buildEvaluatorLogic();
    let state = makeState(buf);

    state = logic(state, makeInput(), makeBaked(), script);
    expect(readSchemaVar(buf, schema, "$Count")).toBe(1);

    state = logic(state, makeInput(), makeBaked(), script);
    expect(readSchemaVar(buf, schema, "$Count")).toBe(2);

    state = logic(state, makeInput(), makeBaked(), script);
    expect(readSchemaVar(buf, schema, "$Count")).toBe(3);
  });

  it("assigns a literal value each frame", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = { $X: { addr: 64, type: "Int16" } };
    const script = makeScript(schema, [
      { trigger: "OnFrame", actions: ["State.$X = 255"] },
    ]);

    const logic = buildEvaluatorLogic();
    logic(makeState(buf), makeInput(), makeBaked(), script);
    expect(readSchemaVar(buf, schema, "$X")).toBe(255);
  });

  it("subtracts via compound -= action", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = { $HP: { addr: 64, type: "Int8" } };
    writeSchemaVar(buf, schema, "$HP", 10);

    const script = makeScript(schema, [
      { trigger: "OnFrame", actions: ["State.$HP -= 3"] },
    ]);

    const logic = buildEvaluatorLogic();
    logic(makeState(buf), makeInput(), makeBaked(), script);
    expect(readSchemaVar(buf, schema, "$HP")).toBe(7);
  });

  it("adds via compound += action", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = { $MP: { addr: 64, type: "Int8" } };
    writeSchemaVar(buf, schema, "$MP", 5);

    const script = makeScript(schema, [
      { trigger: "OnFrame", actions: ["State.$MP += 2"] },
    ]);

    const logic = buildEvaluatorLogic();
    logic(makeState(buf), makeInput(), makeBaked(), script);
    expect(readSchemaVar(buf, schema, "$MP")).toBe(7);
  });

  it("skips actions for unknown schema variables gracefully", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {};
    const script = makeScript(schema, [
      { trigger: "OnFrame", actions: ["State.$Ghost = 1"] },
    ]);
    const logic = buildEvaluatorLogic();
    expect(() => logic(makeState(buf), makeInput(), makeBaked(), script)).not.toThrow();
  });
});

describe("buildEvaluatorLogic — Input trigger", () => {
  it("fires action only when the action is active", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = { $Jumped: { addr: 64, type: "Int8" } };
    const script = makeScript(schema, [
      { trigger: "Input(Action.Jump)", actions: ["State.$Jumped = 1"] },
    ]);

    const logic = buildEvaluatorLogic();

    // No input — action should not fire
    logic(makeState(buf), makeInput([]), makeBaked(), script);
    expect(readSchemaVar(buf, schema, "$Jumped")).toBe(0);

    // With input — action should fire
    logic(makeState(buf), makeInput(["Action.Jump"]), makeBaked(), script);
    expect(readSchemaVar(buf, schema, "$Jumped")).toBe(1);
  });
});

describe("buildEvaluatorLogic — Collision trigger", () => {
  it("fires when two adjacent hex-color regions are present", () => {
    const buf = createStateBuffer();
    // Place a yellow pixel (0,0) and a red pixel (1,0) in the state buffer
    buf[0] = 255; buf[1] = 255; buf[2] = 0; buf[3] = 255;   // #FFFF00
    buf[4] = 255; buf[5] = 0;   buf[6] = 0; buf[7] = 255;   // #FF0000

    const schema: MscSchema = { $Hit: { addr: 64, type: "Int8" } };
    const script = makeScript(schema, [
      {
        trigger: "Collision(Hero:#FFFF00, Level:#FF0000)",
        actions: ["State.$Hit = 1"],
      },
    ]);

    const state = makeState(buf);
    const logic = buildEvaluatorLogic();
    logic(state, makeInput(), makeBaked(), script);
    expect(readSchemaVar(buf, schema, "$Hit")).toBe(1);
  });

  it("does not fire when the colors are not adjacent", () => {
    const buf = createStateBuffer();
    // Yellow at pixel 0, red at pixel 10 (no adjacency)
    buf[0] = 255; buf[1] = 255; buf[2] = 0; buf[3] = 255; // #FFFF00 at (0,0)
    buf[40] = 255; buf[41] = 0; buf[42] = 0; buf[43] = 255; // #FF0000 at pixel 10

    const schema: MscSchema = { $Hit: { addr: 64, type: "Int8" } };
    const script = makeScript(schema, [
      {
        trigger: "Collision(Hero:#FFFF00, Level:#FF0000)",
        actions: ["State.$Hit = 1"],
      },
    ]);

    const state = makeState(buf);
    const logic = buildEvaluatorLogic();
    logic(state, makeInput(), makeBaked(), script);
    expect(readSchemaVar(buf, schema, "$Hit")).toBe(0);
  });
});

describe("buildEvaluatorLogic — State trigger", () => {
  it("fires when state condition is met (greater than)", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {
      $Score: { addr: 64, type: "Int8" },
      $Won: { addr: 65, type: "Int8" },
    };
    writeSchemaVar(buf, schema, "$Score", 100);

    const script = makeScript(schema, [
      { trigger: "State($Score >= 100)", actions: ["State.$Won = 1"] },
    ]);

    const logic = buildEvaluatorLogic();
    logic(makeState(buf), makeInput(), makeBaked(), script);
    expect(readSchemaVar(buf, schema, "$Won")).toBe(1);
  });

  it("does not fire when state condition is not met", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {
      $Score: { addr: 64, type: "Int8" },
      $Won: { addr: 65, type: "Int8" },
    };
    writeSchemaVar(buf, schema, "$Score", 50);

    const script = makeScript(schema, [
      { trigger: "State($Score >= 100)", actions: ["State.$Won = 1"] },
    ]);

    const logic = buildEvaluatorLogic();
    logic(makeState(buf), makeInput(), makeBaked(), script);
    expect(readSchemaVar(buf, schema, "$Won")).toBe(0);
  });

  it("supports equality comparison", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {
      $HP: { addr: 64, type: "Int8" },
      $Dead: { addr: 65, type: "Int8" },
    };
    writeSchemaVar(buf, schema, "$HP", 0);

    const script = makeScript(schema, [
      { trigger: "State($HP == 0)", actions: ["State.$Dead = 1"] },
    ]);

    const logic = buildEvaluatorLogic();
    logic(makeState(buf), makeInput(), makeBaked(), script);
    expect(readSchemaVar(buf, schema, "$Dead")).toBe(1);
  });

  it("supports inequality comparison", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {
      $HP: { addr: 64, type: "Int8" },
      $Alive: { addr: 65, type: "Int8" },
    };
    writeSchemaVar(buf, schema, "$HP", 5);

    const script = makeScript(schema, [
      { trigger: "State($HP != 0)", actions: ["State.$Alive = 1"] },
    ]);

    const logic = buildEvaluatorLogic();
    logic(makeState(buf), makeInput(), makeBaked(), script);
    expect(readSchemaVar(buf, schema, "$Alive")).toBe(1);
  });

  it("supports less-than comparison", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {
      $HP: { addr: 64, type: "Int8" },
      $Low: { addr: 65, type: "Int8" },
    };
    writeSchemaVar(buf, schema, "$HP", 3);

    const script = makeScript(schema, [
      { trigger: "State($HP < 5)", actions: ["State.$Low = 1"] },
    ]);

    const logic = buildEvaluatorLogic();
    logic(makeState(buf), makeInput(), makeBaked(), script);
    expect(readSchemaVar(buf, schema, "$Low")).toBe(1);
  });

  it("compares two state variables against each other", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {
      $HP: { addr: 64, type: "Int8" },
      $MaxHP: { addr: 65, type: "Int8" },
      $Full: { addr: 66, type: "Int8" },
    };
    writeSchemaVar(buf, schema, "$HP", 10);
    writeSchemaVar(buf, schema, "$MaxHP", 10);

    const script = makeScript(schema, [
      { trigger: "State($HP == $MaxHP)", actions: ["State.$Full = 1"] },
    ]);

    const logic = buildEvaluatorLogic();
    logic(makeState(buf), makeInput(), makeBaked(), script);
    expect(readSchemaVar(buf, schema, "$Full")).toBe(1);
  });

  it("supports State.$VAR syntax in conditions", () => {
    const buf = createStateBuffer();
    const schema: MscSchema = {
      $HP: { addr: 64, type: "Int8" },
      $Dead: { addr: 65, type: "Int8" },
    };
    writeSchemaVar(buf, schema, "$HP", 0);

    const script = makeScript(schema, [
      { trigger: "State(State.$HP <= 0)", actions: ["State.$Dead = 1"] },
    ]);

    const logic = buildEvaluatorLogic();
    logic(makeState(buf), makeInput(), makeBaked(), script);
    expect(readSchemaVar(buf, schema, "$Dead")).toBe(1);
  });
});
