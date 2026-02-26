/**
 * MSC parser façade.
 *
 * Phase 2 compiler split:
 *  - lexer.ts tokenizes source text
 *  - ast.ts converts tokens into runtime AST
 */

import { tokenizeMsc } from "./lexer.js";
import {
  buildMscAst,
  type MscDocument,
  type MscEntity,
  type MscEntityPhysics,
  type MscEntityState,
  type MscEvent,
  type MscInput,
  type MscInstance,
  type MscSchema,
  type MscBackgroundLayer,
  type MscLayer,
} from "./ast.js";

export type {
  MscDocument,
  MscEntity,
  MscEntityPhysics,
  MscEntityState,
  MscEvent,
  MscInput,
  MscInstance,
  MscSchema,
  MscBackgroundLayer,
  MscLayer,
};

export function parseMsc(source: string): MscDocument {
  const tokens = tokenizeMsc(source);
  return buildMscAst(tokens);
}
