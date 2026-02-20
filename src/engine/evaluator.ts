/**
 * MSC Script Evaluator
 *
 * Interprets a compiled MscDocument against the current engine state,
 * firing event actions when their triggers are satisfied.
 *
 * Supported triggers:
 *   - OnFrame                           — fires every frame
 *   - Input(ActionName)                 — fires while an action is held
 *   - Collision(A:#RRGGBB, B:#RRGGBB)   — fires when two hex regions touch
 *
 * Supported actions:
 *   - State.$VAR = EXPR
 *   - State.$VAR += EXPR
 *   - State.$VAR -= EXPR
 *
 * Expressions:
 *   - Numeric literal         (e.g. 1, -5)
 *   - State.$VAR              (read a schema variable)
 *   - ATOM OP ATOM            (binary: +, -, *, /)
 */

import type { EngineState, LogicFn } from "./loop.js";
import type { InputState } from "./input.js";
import type { BakedAsset } from "./baker.js";
import type { MscDocument, MscSchema } from "../parser/msc.js";
import { detectColorCollision } from "./physics.js";
import {
  readInt8,
  writeInt8,
  readInt16,
  writeInt16,
  readInt32,
  writeInt32,
} from "./memory.js";

// ── Memory helpers ────────────────────────────────────────────

type SchemaType = "Int8" | "Int16" | "Int32";

function readTyped(
  buffer: Uint8ClampedArray,
  addr: number,
  type: SchemaType
): number {
  switch (type) {
    case "Int8":
      return readInt8(buffer, addr);
    case "Int16":
      return readInt16(buffer, addr);
    case "Int32":
      return readInt32(buffer, addr);
  }
}

function writeTyped(
  buffer: Uint8ClampedArray,
  addr: number,
  type: SchemaType,
  value: number
): void {
  switch (type) {
    case "Int8":
      writeInt8(buffer, addr, value);
      break;
    case "Int16":
      writeInt16(buffer, addr, value);
      break;
    case "Int32":
      writeInt32(buffer, addr, value);
      break;
  }
}

// ── Expression evaluation ─────────────────────────────────────

const ATOM_RE = /^(State\.\$\w+|\d+(?:\.\d+)?)$/;
const BINARY_RE =
  /^(State\.\$\w+|\d+(?:\.\d+)?)\s*([+\-*/])\s*(State\.\$\w+|\d+(?:\.\d+)?)$/;

function evalAtom(
  token: string,
  schema: MscSchema,
  buffer: Uint8ClampedArray
): number {
  const t = token.trim();
  if (t.startsWith("State.$")) {
    const varName = t.slice("State.".length); // "$VAR"
    const entry = schema[varName];
    if (!entry) return 0;
    return readTyped(buffer, entry.addr, entry.type);
  }
  const n = Number(t);
  return Number.isNaN(n) ? 0 : n;
}

function evalExpr(
  expr: string,
  schema: MscSchema,
  buffer: Uint8ClampedArray
): number {
  const t = expr.trim();

  const binMatch = t.match(BINARY_RE);
  if (binMatch) {
    const lhs = evalAtom(binMatch[1], schema, buffer);
    const rhs = evalAtom(binMatch[3], schema, buffer);
    switch (binMatch[2]) {
      case "+":
        return lhs + rhs;
      case "-":
        return lhs - rhs;
      case "*":
        return lhs * rhs;
      case "/":
        return rhs !== 0 ? lhs / rhs : 0;
    }
  }

  if (ATOM_RE.test(t)) return evalAtom(t, schema, buffer);
  return 0;
}

// ── Action execution ──────────────────────────────────────────

/** Compound assignment regex: State.$VAR [+|-]= EXPR */
const ACTION_RE = /^State\.(\$\w+)\s*(\+|-)?=\s*(.+)$/;

function execAction(
  action: string,
  schema: MscSchema,
  buffer: Uint8ClampedArray
): void {
  const m = action.trim().match(ACTION_RE);
  if (!m) return;

  const varName = m[1]; // "$VAR"
  const compound = m[2]; // "+" | "-" | undefined
  const exprStr = m[3];

  const entry = schema[varName];
  if (!entry) return;

  const rhs = evalExpr(exprStr, schema, buffer);

  if (compound === "+") {
    const cur = readTyped(buffer, entry.addr, entry.type);
    writeTyped(buffer, entry.addr, entry.type, cur + rhs);
  } else if (compound === "-") {
    const cur = readTyped(buffer, entry.addr, entry.type);
    writeTyped(buffer, entry.addr, entry.type, cur - rhs);
  } else {
    writeTyped(buffer, entry.addr, entry.type, rhs);
  }
}

// ── Trigger evaluation ────────────────────────────────────────

/** Extract a #RRGGBB hex colour from a trigger operand like "Hero:#FFFF00". */
function extractColor(operand: string): string | null {
  const m = operand.match(/#([0-9A-Fa-f]{6})$/);
  return m ? `#${m[1]}` : null;
}

function isTriggerFired(
  trigger: string,
  state: EngineState,
  input: InputState,
  _baked: BakedAsset
): boolean {
  const t = trigger.trim();

  if (t === "OnFrame") return true;

  // Input(ActionName)
  const inputMatch = t.match(/^Input\((\S+)\)$/);
  if (inputMatch) {
    return input.active.has(inputMatch[1]);
  }

  // Collision(EntityA:#COLOR, EntityB:#COLOR)
  const collMatch = t.match(/^Collision\(([^,]+),\s*(.+)\)$/);
  if (collMatch) {
    const colorA = extractColor(collMatch[1].trim());
    const colorB = extractColor(collMatch[2].trim());
    if (colorA && colorB) {
      return detectColorCollision(state.buffer, state.width, colorA, colorB);
    }
  }

  return false;
}

// ── Public API ────────────────────────────────────────────────

/**
 * Build a LogicFn that executes a compiled MscDocument against the engine state.
 * Pass the return value as the `logic` option to EngineLoop instead of identityLogic.
 */
export function buildEvaluatorLogic(): LogicFn {
  return (
    state: EngineState,
    input: InputState,
    baked: BakedAsset,
    script: MscDocument
  ): EngineState => {
    const { buffer } = state;
    const { schema, events } = script;

    for (const event of events) {
      if (!isTriggerFired(event.trigger, state, input, baked)) continue;
      for (const action of event.actions) {
        execAction(action, schema, buffer);
      }
    }

    return state;
  };
}

/**
 * Read a schema variable directly from the state buffer.
 */
export function readSchemaVar(
  buffer: Uint8ClampedArray,
  schema: MscSchema,
  varName: string
): number {
  const entry = schema[varName];
  if (!entry) return 0;
  return readTyped(buffer, entry.addr, entry.type);
}

/**
 * Write a schema variable directly to the state buffer.
 */
export function writeSchemaVar(
  buffer: Uint8ClampedArray,
  schema: MscSchema,
  varName: string,
  value: number
): void {
  const entry = schema[varName];
  if (!entry) return;
  writeTyped(buffer, entry.addr, entry.type, value);
}
