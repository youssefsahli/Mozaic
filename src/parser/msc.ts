/**
 * MSC (.msc) Language Parser
 *
 * Parses the Mozaic Script DSL that acts as the "Linker" between
 * the visual SpriteROM data and the engine's processing core.
 * The language is indentation-sensitive and strictly declarative.
 */

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

/**
 * Parse a Mozaic Script (.msc) string into a structured document.
 */
export function parseMsc(source: string): MscDocument {
  const doc: MscDocument = {
    imports: [],
    schema: {},
    entities: {},
    events: [],
  };

  const lines = source.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (!trimmed || trimmed.startsWith("#")) {
      i++;
      continue;
    }

    const indent = line.length - trimmed.length;

    if (indent === 0) {
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) {
        i++;
        continue;
      }

      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();

      if (key === "Source") {
        doc.source = stripQuotes(value);
        i++;
      } else if (key === "Import") {
        doc.imports.push(stripQuotes(value));
        i++;
      } else if (key === "Schema") {
        i = parseSchemaBlock(lines, i + 1, doc.schema);
      } else if (key.startsWith("Entity.")) {
        const entityName = key.slice("Entity.".length);
        const entity: MscEntity = { inputs: [], physics: [] };
        i = parseEntityBlock(lines, i + 1, entity);
        doc.entities[entityName] = entity;
      } else if (key === "Events") {
        i = parseEventsBlock(lines, i + 1, doc.events);
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  return doc;
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

function parseSchemaBlock(
  lines: string[],
  start: number,
  schema: MscSchema
): number {
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    const indent = line.length - trimmed.length;
    if (indent === 0) break;

    // e.g. "  - $PlayerX:  { addr: 0, type: Int16 }"
    const schemaMatch = trimmed.match(
      /^-\s+(\$\w+):\s*\{\s*addr:\s*(\d+),\s*type:\s*(Int8|Int16|Int32)\s*\}/
    );
    if (schemaMatch) {
      schema[schemaMatch[1]] = {
        addr: parseInt(schemaMatch[2], 10),
        type: schemaMatch[3] as "Int8" | "Int16" | "Int32",
      };
    }
    i++;
  }
  return i;
}

function parseEntityBlock(
  lines: string[],
  start: number,
  entity: MscEntity
): number {
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    const indent = line.length - trimmed.length;
    if (indent === 0) break;

    if (indent >= 2) {
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx !== -1) {
        const key = trimmed.slice(0, colonIdx).trim();
        const value = trimmed.slice(colonIdx + 1).trim();
        if (key === "Visual") {
          entity.visual = stripQuotes(value);
        }
      } else if (trimmed.startsWith("- ")) {
        // Input mapping: "- Key_Space -> Action.Jump"
        const inputMatch = trimmed.match(/^-\s+(\S+)\s+->\s+(\S+)/);
        if (inputMatch && entity.inputs) {
          entity.inputs.push({ key: inputMatch[1], action: inputMatch[2] });
        }
        // Physics shape: "- shape: auto_alpha"
        const shapeMatch = trimmed.match(/^-\s+shape:\s+(\S+)/);
        if (shapeMatch && entity.physics) {
          entity.physics.push({
            shape: shapeMatch[1],
            solid: false,
          });
        }
        const solidMatch = trimmed.match(/^-\s+solid:\s+(true|false)/);
        if (solidMatch && entity.physics && entity.physics.length > 0) {
          entity.physics[entity.physics.length - 1].solid =
            solidMatch[1] === "true";
        }
      }
    }
    i++;
  }
  return i;
}

function parseEventsBlock(
  lines: string[],
  start: number,
  events: MscEvent[]
): number {
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    const indent = line.length - trimmed.length;
    if (indent === 0) break;

    if (indent >= 2) {
      const colonIdx = trimmed.lastIndexOf(":");
      if (colonIdx !== -1) {
        const trigger = trimmed.slice(0, colonIdx).trim();
        const event: MscEvent = { trigger, actions: [] };
        i++;
        // Collect action lines
        while (i < lines.length) {
          const actionLine = lines[i];
          const actionTrimmed = actionLine.trimStart();
          const actionIndent = actionLine.length - actionTrimmed.length;
          if (
            !actionTrimmed ||
            actionTrimmed.startsWith("#") ||
            actionIndent <= indent
          )
            break;
          if (actionTrimmed.startsWith("- ")) {
            event.actions.push(actionTrimmed.slice(2).trim());
          }
          i++;
        }
        events.push(event);
        continue;
      }
    }
    i++;
  }
  return i;
}
