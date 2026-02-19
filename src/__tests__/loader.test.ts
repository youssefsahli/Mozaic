import { describe, it, expect } from "vitest";
import {
  hasMozaicSignature,
  sidecarUrls,
  MOZAIC_SIGNATURE,
} from "../engine/loader.js";

function makeImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number
): ImageData {
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

describe("hasMozaicSignature", () => {
  it("detects a valid Mozaic signature", () => {
    // 4 pixels = 16 bytes; signature is in R channel of pixels 0-3
    const data = new Uint8ClampedArray(16);
    data[0] = MOZAIC_SIGNATURE[0];  // pixel 0 R = M
    data[4] = MOZAIC_SIGNATURE[1];  // pixel 1 R = S
    data[8] = MOZAIC_SIGNATURE[2];  // pixel 2 R = K
    data[12] = MOZAIC_SIGNATURE[3]; // pixel 3 R = 1
    const img = makeImageData(data, 4, 1);
    expect(hasMozaicSignature(img)).toBe(true);
  });

  it("returns false for a standard PNG without signature", () => {
    const data = new Uint8ClampedArray(16); // all zeros
    const img = makeImageData(data, 4, 1);
    expect(hasMozaicSignature(img)).toBe(false);
  });
});

describe("sidecarUrls", () => {
  it("generates .msc and .txt candidates", () => {
    const urls = sidecarUrls("assets/level_1.png");
    expect(urls).toContain("assets/level_1.msc");
    expect(urls).toContain("assets/level_1.txt");
  });

  it("works with .mzk extension", () => {
    const urls = sidecarUrls("game.mzk");
    expect(urls).toContain("game.msc");
    expect(urls).toContain("game.txt");
  });
});
