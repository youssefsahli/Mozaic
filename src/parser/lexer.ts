export type MscLineKind = "empty" | "comment" | "mapping" | "list" | "other";

export interface MscLineToken {
  line: number;
  raw: string;
  trimmed: string;
  indent: number;
  kind: MscLineKind;
  key?: string;
  value?: string;
  listValue?: string;
}

export function tokenizeMsc(source: string): MscLineToken[] {
  const lines = source.split("\n");
  return lines.map((raw, index) => tokenizeLine(raw, index + 1));
}

function tokenizeLine(raw: string, line: number): MscLineToken {
  const trimmed = raw.trimStart();
  const indent = raw.length - trimmed.length;

  if (!trimmed) {
    return { line, raw, trimmed, indent, kind: "empty" };
  }

  if (trimmed.startsWith("#")) {
    return { line, raw, trimmed, indent, kind: "comment" };
  }

  if (trimmed.startsWith("- ")) {
    return {
      line,
      raw,
      trimmed,
      indent,
      kind: "list",
      listValue: trimmed.slice(2).trim(),
    };
  }

  const colonIdx = findMappingColon(trimmed);
  if (colonIdx !== -1) {
    return {
      line,
      raw,
      trimmed,
      indent,
      kind: "mapping",
      key: trimmed.slice(0, colonIdx).trim(),
      value: trimmed.slice(colonIdx + 1).trim(),
    };
  }

  return { line, raw, trimmed, indent, kind: "other" };
}

/**
 * Find the first colon that is not inside parentheses or braces.
 * This handles values like `{ force: 2 }` and triggers like
 * `Collision(Hero:#FFFF00, Level:#FF0000):` correctly.
 */
function findMappingColon(str: string): number {
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === "(" || c === "{") depth++;
    else if (c === ")" || c === "}") depth--;
    else if (c === ":" && depth === 0) return i;
  }
  return -1;
}
