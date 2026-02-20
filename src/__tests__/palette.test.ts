import { describe, it, expect } from "vitest";
import {
  createPaletteState,
  addColor,
  removeColor,
  setColorName,
  updateColorHex,
  exportHex,
  importHex,
  applyIndexedColorChange,
  getActiveColor,
} from "../editor/palette.js";

describe("setColorName", () => {
  it("assigns a name to a palette slot", () => {
    const state = createPaletteState(["#ff0000"]);
    setColorName(state, 0, "Player");
    expect(state.colors[0].name).toBe("Player");
  });

  it("clears the name when given an empty string", () => {
    const state = createPaletteState(["#ff0000"]);
    setColorName(state, 0, "Hero");
    setColorName(state, 0, "");
    expect(state.colors[0].name).toBeUndefined();
  });

  it("clears the name when given a whitespace-only string", () => {
    const state = createPaletteState(["#ff0000"]);
    setColorName(state, 0, "Hero");
    setColorName(state, 0, "   ");
    expect(state.colors[0].name).toBeUndefined();
  });

  it("does nothing for an out-of-bounds index", () => {
    const state = createPaletteState(["#ff0000"]);
    expect(() => setColorName(state, 5, "Oops")).not.toThrow();
    expect(state.colors[0].name).toBeUndefined();
  });
});

describe("updateColorHex", () => {
  it("updates the hex and returns the old hex", () => {
    const state = createPaletteState(["#ff0000"]);
    const old = updateColorHex(state, 0, "#00ff00");
    expect(old).toBe("#ff0000");
    expect(state.colors[0].hex).toBe("#00ff00");
  });

  it("returns null when the hex is unchanged", () => {
    const state = createPaletteState(["#ff0000"]);
    const old = updateColorHex(state, 0, "#ff0000");
    expect(old).toBeNull();
  });

  it("normalises the new hex to lowercase", () => {
    const state = createPaletteState(["#ff0000"]);
    updateColorHex(state, 0, "#AABBCC");
    expect(state.colors[0].hex).toBe("#aabbcc");
  });

  it("returns null for an out-of-bounds index", () => {
    const state = createPaletteState(["#ff0000"]);
    expect(updateColorHex(state, 9, "#00ff00")).toBeNull();
  });

  it("preserves the name when updating the hex", () => {
    const state = createPaletteState(["#ff0000"]);
    setColorName(state, 0, "Wall");
    updateColorHex(state, 0, "#0000ff");
    expect(state.colors[0].name).toBe("Wall");
    expect(state.colors[0].hex).toBe("#0000ff");
  });
});

describe("applyIndexedColorChange", () => {
  function makeImageData(w: number, h: number, hex: string): ImageData {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
    return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
  }

  it("replaces all matching pixels", () => {
    const img = makeImageData(2, 2, "#ff0000");
    const changed = applyIndexedColorChange(img, "#ff0000", "#0000ff");
    expect(changed).toBe(true);
    expect(img.data[0]).toBe(0);
    expect(img.data[2]).toBe(255);
  });

  it("returns false when no pixels match", () => {
    const img = makeImageData(2, 2, "#ff0000");
    const changed = applyIndexedColorChange(img, "#00ff00", "#0000ff");
    expect(changed).toBe(false);
  });
});

describe("palette round-trip", () => {
  it("exportHex/importHex preserves colors", () => {
    const state = createPaletteState(["#ff0000", "#00ff00", "#0000ff"]);
    const hex = exportHex(state);
    const imported = importHex(hex);
    expect(imported.map((c) => c.hex)).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
  });

  it("getActiveColor returns fallback for empty palette", () => {
    const state = createPaletteState([]);
    expect(getActiveColor(state)).toBe("#ff00ff");
  });

  it("addColor skips duplicates", () => {
    const state = createPaletteState(["#ff0000"]);
    addColor(state, "#ff0000");
    expect(state.colors.length).toBe(1);
  });

  it("removeColor adjusts activeIndex", () => {
    const state = createPaletteState(["#ff0000", "#00ff00"]);
    state.activeIndex = 1;
    removeColor(state, 1);
    expect(state.activeIndex).toBe(0);
  });
});
