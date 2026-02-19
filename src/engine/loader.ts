/**
 * Dual-Layer Loader
 *
 * Loads Mozaic assets from:
 *   - Images: .mzk (Mozaic Kinetic Asset) | .png | .jpg
 *   - Scripts: .msc (Mozaic Script)        | .txt | .yaml
 *
 * Sidecar Rule: loading "asset.png" automatically searches for
 *   "asset.msc" or "asset.txt" in the same directory.
 *
 * Steganographic Headers: .png files that encode [M, S, K, 1] in
 *   the first 4 pixels are treated as Mozaic assets.
 */

import { parseMsc, type MscDocument } from "../parser/msc.js";

export const MOZAIC_SIGNATURE = [77, 83, 75, 1] as const; // [M, S, K, 1]

export interface LoadedAsset {
  imageData: ImageData;
  script?: MscDocument;
  scriptText?: string;
  hasMozaicSignature: boolean;
}

/**
 * Check whether an ImageData's first 4 pixels carry the Mozaic signature.
 */
export function hasMozaicSignature(imageData: ImageData): boolean {
  const { data } = imageData;
  return (
    data[0] === MOZAIC_SIGNATURE[0] &&
    data[4] === MOZAIC_SIGNATURE[1] &&
    data[8] === MOZAIC_SIGNATURE[2] &&
    data[12] === MOZAIC_SIGNATURE[3]
  );
}

/**
 * Derive the sidecar script URL candidates from an image URL.
 * e.g. "assets/level_1.png" -> ["assets/level_1.msc", "assets/level_1.txt"]
 */
export function sidecarUrls(imageUrl: string): string[] {
  const base = imageUrl.replace(/\.[^.]+$/, "");
  return [`${base}.msc`, `${base}.txt`];
}

/**
 * Load an image as ImageData using an OffscreenCanvas or a regular Canvas.
 */
async function loadImageData(url: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not get 2D context"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/**
 * Attempt to fetch a text resource, returning null if not found (404).
 */
async function tryFetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

/**
 * Load a Mozaic asset (image + optional sidecar script).
 */
export async function loadAsset(imageUrl: string): Promise<LoadedAsset> {
  const imageData = await loadImageData(imageUrl);
  const signature = hasMozaicSignature(imageData);

  let script: MscDocument | undefined;
  let scriptText: string | undefined;
  for (const candidate of sidecarUrls(imageUrl)) {
    const text = await tryFetchText(candidate);
    if (text !== null) {
      scriptText = text;
      script = parseMsc(text);
      break;
    }
  }

  return { imageData, script, scriptText, hasMozaicSignature: signature };
}
