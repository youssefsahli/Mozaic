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
import type { ComponentRegistry } from "./components.js";
import {
  readInt8,
  writeInt8,
  readInt16,
  writeInt16,
  readInt32,
  writeInt32,
  MEMORY_BLOCKS,
  ENTITY_SLOT_SIZE,
  ENTITY_ACTIVE,
  ENTITY_TYPE_ID,
  ENTITY_DATA_START,
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

/**
 * Evaluate a state condition like "$health <= 0" or "$score >= 100".
 *
 * Supported comparators: ==, !=, >, <, >=, <=
 * Operands: State.$VAR references or numeric literals.
 */
const STATE_COND_RE =
  /^(State\.\$\w+|\$\w+|\d+(?:\.\d+)?)\s*(==|!=|>=|<=|>|<)\s*(State\.\$\w+|\$\w+|\d+(?:\.\d+)?)$/;

function resolveCondAtom(
  token: string,
  schema: MscSchema,
  buffer: Uint8ClampedArray
): number {
  const t = token.trim();
  if (t.startsWith("State.$")) {
    return evalAtom(t, schema, buffer);
  }
  if (t.startsWith("$")) {
    return evalAtom(`State.${t}`, schema, buffer);
  }
  const n = Number(t);
  return Number.isNaN(n) ? 0 : n;
}

function evalStateCondition(
  condition: string,
  schema: MscSchema,
  buffer: Uint8ClampedArray
): boolean {
  const m = condition.match(STATE_COND_RE);
  if (!m) return false;

  const lhs = resolveCondAtom(m[1], schema, buffer);
  const op = m[2];
  const rhs = resolveCondAtom(m[3], schema, buffer);

  switch (op) {
    case "==":
      return lhs === rhs;
    case "!=":
      return lhs !== rhs;
    case ">":
      return lhs > rhs;
    case "<":
      return lhs < rhs;
    case ">=":
      return lhs >= rhs;
    case "<=":
      return lhs <= rhs;
    default:
      return false;
  }
}

function isTriggerFired(
  trigger: string,
  state: EngineState,
  input: InputState,
  _baked: BakedAsset,
  schema: MscSchema
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

  // State(EXPR COMPARATOR EXPR) — e.g. State($health <= 0)
  const stateMatch = t.match(/^State\((.+)\)$/);
  if (stateMatch) {
    return evalStateCondition(stateMatch[1].trim(), schema, state.buffer);
  }

  return false;
}

// ── Public API ────────────────────────────────────────────────

/**
 * Build a LogicFn that executes a compiled MscDocument against the engine state.
 * Pass the return value as the `logic` option to EngineLoop instead of identityLogic.
 *
 * When a ComponentRegistry is provided, the evaluator also iterates
 * through the entity pool, skips dead entities, looks up each entity's
 * AST definition by Type ID, and executes all attached components.
 */
export function buildEvaluatorLogic(registry?: ComponentRegistry): LogicFn {
  return (
    state: EngineState,
    input: InputState,
    baked: BakedAsset,
    script: MscDocument
  ): EngineState => {
    const { buffer } = state;
    const { schema, events, entities, sprites } = script;

    for (const event of events) {
      if (!isTriggerFired(event.trigger, state, input, baked, schema)) continue;
      for (const action of event.actions) {
        execAction(action, schema, buffer);
      }
    }

    // ── ECS entity tick ───────────────────────────────────────
    if (registry) {
      const entityNames = Object.keys(entities);
      const poolStart = MEMORY_BLOCKS.entityPool.startByte;
      const poolEnd = MEMORY_BLOCKS.entityPool.endByte;

      // Build sprite name → 1-based ID mapping (filter $Grid metadata key)
      const spriteNameToId = new Map<string, number>();
      let spriteIdx = 1;
      for (const [name, def] of sprites) {
        if (name === "$Grid") continue;
        spriteNameToId.set(name, spriteIdx);
        spriteIdx += def.kind === "grid" ? def.frames : 1;
      }

      for (
        let ptr = poolStart;
        ptr + ENTITY_SLOT_SIZE - 1 <= poolEnd;
        ptr += ENTITY_SLOT_SIZE
      ) {
        if (readInt8(buffer, ptr + ENTITY_ACTIVE) === 0) continue;

        const typeId = readInt8(buffer, ptr + ENTITY_TYPE_ID);
        // Type IDs are 1-based; map to entityNames index (0-based)
        if (typeId === 0 || typeId > entityNames.length) continue;

        const entityDef = entities[entityNames[typeId - 1]];
        if (!entityDef) continue;

        // ── Sprite Initialization ───────────────────────────────
        const currentSpriteId = readInt8(buffer, ptr + ENTITY_DATA_START);
        if (currentSpriteId === 0 && entityDef.visual) {
          const sid = spriteNameToId.get(entityDef.visual);
          if (sid !== undefined) {
            writeInt8(buffer, ptr + ENTITY_DATA_START, sid);
          }
        }

        // ── Component Execution ─────────────────────────────────
        if (entityDef.components) {
          for (const [componentId, props] of Object.entries(
            entityDef.components
          )) {
            // Animator is handled specially below (needs sprite data)
            if (componentId === "Animator") continue;

            const fn = registry.get(componentId);
            if (!fn) continue;
            try {
              fn(buffer, ptr, props, input, baked, state);
            } catch (err) {
              console.warn(
                `[Mozaic ECS] Component "${componentId}" threw on entity at offset ${ptr}:`,
                err
              );
            }
          }

          // ── Animator ────────────────────────────────────────────
          if (entityDef.components.Animator) {
            const animSpeed = entityDef.components.Animator.speed ?? 10;
            const seqName = entityDef.visual;
            if (seqName) {
              const baseSpriteId = spriteNameToId.get(seqName);
              if (baseSpriteId !== undefined) {
                const spriteDef = sprites.get(seqName);
                const frames = spriteDef && spriteDef.kind === "grid" ? spriteDef.frames : 1;
                const sequenceArray = Array.from({length: frames}, (_, i) => baseSpriteId + i);
                const frameIndex = Math.floor(state.tickCount / animSpeed) % sequenceArray.length;
                writeInt8(buffer, ptr + ENTITY_DATA_START, sequenceArray[frameIndex]);
              }
            }
          }
        }
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
