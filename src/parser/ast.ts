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

export interface MscEntityState {
  condition?: string;
  visual?: string;
  components?: Record<string, Record<string, number | string>>;
}

export interface MscCameraComponent {
  zoom?: number;       // Default: 1.0 (1x scale)
  shake?: number;      // Default: 0.0 (intensity of screen shake)
  tint?: string;       // Default: "#FFFFFF" (hex color multiplier)
  followSpeed?: number; // Optional polish: for lerping camera position
}

export interface MscComponents {
  Camera?: MscCameraComponent;
  [key: string]: Record<string, number | string> | MscCameraComponent | undefined;
}

export interface MscEntity {
  visual?: string;
  physics?: MscEntityPhysics[];
  inputs?: MscInput[];
  components?: Record<string, Record<string, number | string>>;
  states?: Record<string, MscEntityState>;
}

export interface MscEvent {
  trigger: string;
  actions: string[];
}

export interface MscSpriteGrid {
  kind: "grid";
  col: number;
  row: number;
  frames: number;
}

export interface MscSpriteAbsolute {
  kind: "absolute";
  x: number;
  y: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
}

export type MscSpriteDef = MscSpriteGrid | MscSpriteAbsolute;

export interface MscBackgroundLayer {
  source: string;
  parallaxX: number;
  parallaxY: number;
}

export interface MscInstance {
  entity: string;
  x: number;
  y: number;
}

export interface MscDocument {
  source?: string;
  imports: string[];
  schema: MscSchema;
  entities: Record<string, MscEntity>;
  events: MscEvent[];
  sprites: Map<string, MscSpriteDef>;
  spriteGrid: number;
  animations?: number[][];
  instances?: MscInstance[];
  backgrounds?: MscBackgroundLayer[];
}

export function buildMscAst(tokens: MscLineToken[]): MscDocument {
  const doc: MscDocument = {
    imports: [],
    schema: {},
    entities: {},
    events: [],
    sprites: new Map(),
    spriteGrid: 0,
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
      const importPath = stripQuotes(value);
      if (importPath) {
        doc.imports.push(importPath);
      }
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

    if (key === "Sprites") {
      i = parseSprites(tokens, i + 1, doc);
      continue;
    }

    if (key === "Instances") {
      const instances: MscInstance[] = [];
      i = parseInstances(tokens, i + 1, instances);
      if (instances.length > 0) {
        doc.instances = instances;
      }
      continue;
    }

    if (key === "Backgrounds") {
      const backgrounds: MscBackgroundLayer[] = [];
      i = parseBackgrounds(tokens, i + 1, backgrounds);
      if (backgrounds.length > 0) {
        doc.backgrounds = backgrounds;
      }
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
        const addr = parseInt(schemaMatch[2], 10);
        if (!Number.isNaN(addr) && addr >= 0) {
          schema[schemaMatch[1]] = {
            addr,
            type: schemaMatch[3] as "Int8" | "Int16" | "Int32",
          };
        }
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
      } else if (key === "Components") {
        i = parseNestedComponents(tokens, i + 1, token.indent, entity);
        continue;
      } else if (key === "States") {
        i = parseStates(tokens, i + 1, token.indent, entity);
        continue;
      } else {
        let props: Record<string, number | string> = {};

        if (value) {
          const parsed = parseComponentProps(value);
          if (parsed) props = parsed;
        }

        // Check for nested properties (higher indent)
        const componentIndent = token.indent;
        let j = i + 1;
        while (j < tokens.length) {
          const sub = tokens[j];
          if (sub.kind === "empty" || sub.kind === "comment") {
            j++;
            continue;
          }
          if (sub.indent <= componentIndent) break;

          if (sub.kind === "mapping") {
            const pk = sub.key ?? "";
            const pv = sub.value ?? "";
            if (pv.startsWith('"') || pv.startsWith("'")) {
              props[pk] = stripQuotes(pv);
            } else {
              const n = parseFloat(pv);
              props[pk] = Number.isNaN(n) ? pv : n;
            }
          }
          j++;
        }

        // Only add if we found props or if it's explicitly an empty object/component
        // But exclude known keys if any (none here as we handled Visual etc)
        if (Object.keys(props).length > 0 || value === "" || value === "{}") {
          if (!entity.components) entity.components = {};
          entity.components[key] = { ...(entity.components[key] || {}), ...props };
        }

        i = j;
        continue;
      }
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

function parseSprites(
  tokens: MscLineToken[],
  start: number,
  doc: MscDocument
): number {
  let i = start;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.kind === "empty" || token.kind === "comment") {
      i++;
      continue;
    }
    if (token.indent === 0) break;

    if (token.kind === "mapping") {
      const key = token.key ?? "";
      const value = token.value ?? "";

      if (key === "$Grid") {
        const grid = parseInt(value, 10);
        if (!Number.isNaN(grid) && grid > 0) {
          doc.spriteGrid = grid;
        }
        i++;
        continue;
      }

      const def = parseSpriteValue(value);
      if (def !== null) {
        doc.sprites.set(key, def);
      }
    }

    i++;
  }
  return i;
}

function parseSpriteValue(value: string): MscSpriteDef | null {
  const trimmed = value.trim();

  // Array form: [col, row] or [col, row, frames]
  const arrayMatch = trimmed.match(
    /^\[\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d+)\s*)?\]$/
  );
  if (arrayMatch) {
    const col = parseInt(arrayMatch[1], 10);
    const row = parseInt(arrayMatch[2], 10);
    const frames = arrayMatch[3] !== undefined ? parseInt(arrayMatch[3], 10) : 1;
    return { kind: "grid", col, row, frames };
  }

  // Object form: { x, y, w, h, ox, oy }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const inner = trimmed.slice(1, -1).trim();
    const props: Record<string, number> = {};
    for (const part of inner.split(",")) {
      const colonIdx = part.indexOf(":");
      if (colonIdx === -1) return null;
      const k = part.slice(0, colonIdx).trim();
      const v = Number(part.slice(colonIdx + 1).trim());
      if (!k || Number.isNaN(v)) return null;
      props[k] = v;
    }
    if (
      props.x === undefined ||
      props.y === undefined ||
      props.w === undefined ||
      props.h === undefined
    )
      return null;
    return {
      kind: "absolute",
      x: props.x,
      y: props.y,
      w: props.w,
      h: props.h,
      ox: props.ox ?? 0,
      oy: props.oy ?? 0,
    };
  }

  return null;
}

function parseComponentProps(value: string): Record<string, number | string> | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return {};

  const props: Record<string, number | string> = {};
  const parts = inner.split(",");
  for (const part of parts) {
    const colonIdx = part.indexOf(":");
    if (colonIdx === -1) return null;
    const key = part.slice(0, colonIdx).trim();
    const rawVal = part.slice(colonIdx + 1).trim();
    if (!key) return null;

    if (rawVal.startsWith('"') || rawVal.startsWith("'")) {
      props[key] = stripQuotes(rawVal);
    } else {
      const n = Number(rawVal);
      props[key] = Number.isNaN(n) ? rawVal : n;
    }
  }
  return props;
}

function parseInstances(
  tokens: MscLineToken[],
  start: number,
  instances: MscInstance[]
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

      // Inline form: { entity: "TinyHero", x: 32, y: 32 }
      const inlineMatch = line.match(
        /^\{\s*entity:\s*"([^"]+)"\s*,\s*x:\s*(-?\d+)\s*,\s*y:\s*(-?\d+)\s*\}$/
      );
      if (inlineMatch) {
        instances.push({
          entity: inlineMatch[1],
          x: parseInt(inlineMatch[2], 10),
          y: parseInt(inlineMatch[3], 10),
        });
        i++;
        continue;
      }

      // Multi-line form first line: entity: "TinyHero"
      const entityMatch = line.match(/^entity:\s*"([^"]+)"$/);
      if (entityMatch) {
        const entry: MscInstance = { entity: entityMatch[1], x: 0, y: 0 };
        i++;
        while (i < tokens.length) {
          const propToken = tokens[i];
          if (propToken.kind === "empty" || propToken.kind === "comment") {
            i++;
            continue;
          }
          if (propToken.indent <= token.indent) break;
          if (propToken.kind === "mapping") {
            const pk = propToken.key ?? "";
            const pv = propToken.value ?? "";
            if (pk === "x") {
              const n = parseInt(pv, 10);
              if (!Number.isNaN(n)) entry.x = n;
            } else if (pk === "y") {
              const n = parseInt(pv, 10);
              if (!Number.isNaN(n)) entry.y = n;
            }
          }
          i++;
        }
        instances.push(entry);
        continue;
      }
    }

    i++;
  }
  return i;
}

function parseBackgrounds(
  tokens: MscLineToken[],
  start: number,
  backgrounds: MscBackgroundLayer[]
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

      // Inline form: { source: "sky.mzk", parallaxX: 0.1, parallaxY: 0.1 }
      const inlineMatch = line.match(
        /^\{\s*source:\s*"([^"]+)"\s*,\s*parallaxX:\s*(-?[\d.]+)\s*,\s*parallaxY:\s*(-?[\d.]+)\s*\}$/
      );
      if (inlineMatch) {
        backgrounds.push({
          source: inlineMatch[1],
          parallaxX: parseFloat(inlineMatch[2]),
          parallaxY: parseFloat(inlineMatch[3]),
        });
        i++;
        continue;
      }

      // Multi-line form first line: source: "sky.mzk"
      const sourceMatch = line.match(/^source:\s*"([^"]+)"$/);
      if (sourceMatch) {
        const entry: MscBackgroundLayer = {
          source: sourceMatch[1],
          parallaxX: 1,
          parallaxY: 1,
        };
        i++;
        while (i < tokens.length) {
          const propToken = tokens[i];
          if (propToken.kind === "empty" || propToken.kind === "comment") {
            i++;
            continue;
          }
          if (propToken.indent <= token.indent) break;
          if (propToken.kind === "mapping") {
            const pk = propToken.key ?? "";
            const pv = propToken.value ?? "";
            if (pk === "parallaxX") {
              const n = parseFloat(pv);
              if (!Number.isNaN(n)) entry.parallaxX = n;
            } else if (pk === "parallaxY") {
              const n = parseFloat(pv);
              if (!Number.isNaN(n)) entry.parallaxY = n;
            }
          }
          i++;
        }
        backgrounds.push(entry);
        continue;
      }
    }

    i++;
  }
  return i;
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

function parseStates(
  tokens: MscLineToken[],
  start: number,
  parentIndent: number,
  entity: MscEntity
): number {
  let i = start;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.kind === "empty" || token.kind === "comment") {
      i++;
      continue;
    }
    if (token.indent <= parentIndent) break;

    if (token.kind === "mapping") {
      const stateName = token.key ?? "";
      const stateIndent = token.indent;
      const stateDef: MscEntityState = {};
      i++;

      while (i < tokens.length) {
        const sub = tokens[i];
        if (sub.kind === "empty" || sub.kind === "comment") {
          i++;
          continue;
        }
        if (sub.indent <= stateIndent) break;

        if (sub.kind === "mapping") {
          const sk = sub.key ?? "";
          const sv = sub.value ?? "";
          if (sk === "condition") {
            stateDef.condition = stripQuotes(sv);
          } else if (sk === "Visual") {
            stateDef.visual = stripQuotes(sv);
          } else if (sv) {
            const props = parseComponentProps(sv);
            if (props !== null) {
              if (!stateDef.components) stateDef.components = {};
              stateDef.components[sk] = props;
            }
          }
        }
        i++;
      }

      if (!entity.states) entity.states = {};
      entity.states[stateName] = stateDef;
      continue;
    }

    i++;
  }
  return i;
}

function parseNestedComponents(
  tokens: MscLineToken[],
  start: number,
  parentIndent: number,
  entity: MscEntity
): number {
  let i = start;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.kind === "empty" || token.kind === "comment") {
      i++;
      continue;
    }
    if (token.indent <= parentIndent) break;

    if (token.kind === "mapping") {
      const compName = token.key ?? "";
      const compVal = token.value ?? "";

      let props: Record<string, number | string> = {};

      if (compVal) {
        const parsed = parseComponentProps(compVal);
        if (parsed) props = parsed;
      }

      // Check for nested properties (higher indent)
      // e.g. ComponentName:
      //        prop: 1
      const componentIndent = token.indent;
      let j = i + 1;
      while (j < tokens.length) {
        const sub = tokens[j];
        if (sub.kind === "empty" || sub.kind === "comment") {
          j++;
          continue;
        }
        if (sub.indent <= componentIndent) break;

        if (sub.kind === "mapping") {
          const pk = sub.key ?? "";
          const pv = sub.value ?? "";
          if (pv.startsWith('"') || pv.startsWith("'")) {
             props[pk] = stripQuotes(pv);
          } else {
            const n = parseFloat(pv);
            props[pk] = Number.isNaN(n) ? pv : n;
          }
        }
        j++;
      }

      if (!entity.components) entity.components = {};
      entity.components[compName] = {
        ...(entity.components[compName] || {}),
        ...props,
      };

      // Advance main loop to where we left off
      i = j;
      continue;
    }

    i++;
  }
  return i;
}
