import type { MscLineToken } from "./lexer.js";

export interface MscSchema {
  [variable: string]: { addr: number; type: "Int8" | "Int16" | "Int32" };
}

export interface MscInput {
  key: string;
  action: string;
}

export interface MscEntityPhysics {
  shape: "auto_alpha" | string;
  solid: boolean;
}

export interface MscEntity {
  visual?: string;
  physics?: MscEntityPhysics[];
  inputs?: MscInput[];
  components?: Record<string, Record<string, number>>;
}

export interface MscEvent {
  trigger: string;
  actions: string[];
}

export interface MscDocument {
  source?: string;
  imports: string[];
  schema: MscSchema;
  entities: Record<string, MscEntity>;
  events: MscEvent[];
}

export function buildMscAst(tokens: MscLineToken[]): MscDocument {
  const doc: MscDocument = {
    imports: [],
    schema: {},
    entities: {},
    events: [],
  };

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (
      token.kind === "empty" ||
      token.kind === "comment" ||
      token.indent !== 0 ||
      token.kind !== "mapping"
    ) {
      i++;
      continue;
    }

    const key = token.key ?? "";
    const value = token.value ?? "";

    if (key === "Source") {
      doc.source = stripQuotes(value);
      i++;
      continue;
    }

    if (key === "Import") {
      doc.imports.push(stripQuotes(value));
      i++;
      continue;
    }

    if (key === "Schema") {
      i = parseSchema(tokens, i + 1, doc.schema);
      continue;
    }

    if (key.startsWith("Entity.")) {
      const entityName = key.slice("Entity.".length);
      const entity: MscEntity = { inputs: [], physics: [] };
      i = parseEntity(tokens, i + 1, entity);
      doc.entities[entityName] = entity;
      continue;
    }

    if (key === "Events") {
      i = parseEvents(tokens, i + 1, doc.events);
      continue;
    }

    i++;
  }

  return doc;
}

function parseSchema(
  tokens: MscLineToken[],
  start: number,
  schema: MscSchema
): number {
  let i = start;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.kind === "empty" || token.kind === "comment") {
      i++;
      continue;
    }
    if (token.indent === 0) break;

    if (token.kind === "list") {
      const line = token.listValue ?? "";
      const schemaMatch = line.match(
        /^(\$\w+):\s*\{\s*addr:\s*(\d+),\s*type:\s*(Int8|Int16|Int32)\s*\}$/
      );
      if (schemaMatch) {
        schema[schemaMatch[1]] = {
          addr: parseInt(schemaMatch[2], 10),
          type: schemaMatch[3] as "Int8" | "Int16" | "Int32",
        };
      }
    }

    i++;
  }
  return i;
}

function parseEntity(
  tokens: MscLineToken[],
  start: number,
  entity: MscEntity
): number {
  let i = start;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.kind === "empty" || token.kind === "comment") {
      i++;
      continue;
    }
    if (token.indent === 0) break;

    if (token.indent >= 2 && token.kind === "mapping") {
      const key = token.key ?? "";
      const value = token.value ?? "";
      if (key === "Visual") {
        entity.visual = stripQuotes(value);
      } else if (value) {
        const props = parseComponentProps(value);
        if (props !== null) {
          if (!entity.components) entity.components = {};
          entity.components[key] = props;
        }
      }
      i++;
      continue;
    }

    if (token.indent >= 2 && token.kind === "list") {
      const line = token.listValue ?? "";
      const inputMatch = line.match(/^(\S+)\s+->\s+(\S+)$/);
      if (inputMatch && entity.inputs) {
        entity.inputs.push({ key: inputMatch[1], action: inputMatch[2] });
      }

      const shapeMatch = line.match(/^shape:\s+(\S+)$/);
      if (shapeMatch && entity.physics) {
        entity.physics.push({ shape: shapeMatch[1], solid: false });
      }

      const solidMatch = line.match(/^solid:\s+(true|false)$/);
      if (solidMatch && entity.physics && entity.physics.length > 0) {
        entity.physics[entity.physics.length - 1].solid = solidMatch[1] === "true";
      }
    }

    i++;
  }
  return i;
}

function parseEvents(
  tokens: MscLineToken[],
  start: number,
  events: MscEvent[]
): number {
  let i = start;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.kind === "empty" || token.kind === "comment") {
      i++;
      continue;
    }
    if (token.indent === 0) break;

    if (token.indent >= 2 && token.kind === "mapping") {
      const trigger = token.key ?? "";
      const event: MscEvent = { trigger, actions: [] };
      i++;
      while (i < tokens.length) {
        const actionToken = tokens[i];
        if (actionToken.kind === "empty" || actionToken.kind === "comment") {
          i++;
          continue;
        }
        if (actionToken.indent <= token.indent) break;
        if (actionToken.kind === "list") {
          event.actions.push(actionToken.listValue ?? "");
        }
        i++;
      }
      events.push(event);
      continue;
    }

    i++;
  }

  return i;
}

function parseComponentProps(value: string): Record<string, number> | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return {};

  const props: Record<string, number> = {};
  const parts = inner.split(",");
  for (const part of parts) {
    const colonIdx = part.indexOf(":");
    if (colonIdx === -1) return null;
    const key = part.slice(0, colonIdx).trim();
    const val = Number(part.slice(colonIdx + 1).trim());
    if (!key || Number.isNaN(val)) return null;
    props[key] = val;
  }
  return props;
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}
