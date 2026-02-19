import { describe, it, expect } from "vitest";
import { tokenizeMsc } from "../parser/lexer.js";

describe("tokenizeMsc", () => {
  it("classifies top-level mappings and list items", () => {
    const tokens = tokenizeMsc(`Source: "level.mzk"\nSchema:\n  - $X: { addr: 0, type: Int16 }`);

    expect(tokens[0].kind).toBe("mapping");
    expect(tokens[0].key).toBe("Source");
    expect(tokens[1].kind).toBe("mapping");
    expect(tokens[1].key).toBe("Schema");
    expect(tokens[2].kind).toBe("list");
    expect(tokens[2].listValue).toContain("$X");
  });

  it("tracks indentation and comments", () => {
    const tokens = tokenizeMsc(`# comment\n  Visual: "hero.png"`);
    expect(tokens[0].kind).toBe("comment");
    expect(tokens[1].indent).toBe(2);
  });
});
