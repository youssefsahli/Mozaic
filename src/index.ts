/**
 * Mozaic Engine — Entry Point
 *
 * Bootstraps the engine against the #mozaic-canvas element.
 * A SpriteROM is loaded by passing the image URL as the `src` query
 * parameter:  ?src=level_1.mzk
 */

import { loadAsset } from "./engine/loader.js";
import { bake } from "./engine/baker.js";
import { Renderer } from "./engine/renderer.js";
import { InputManager } from "./engine/input.js";
import {
  EngineLoop,
  createInitialState,
  identityLogic,
} from "./engine/loop.js";
import type { MscDocument } from "./parser/msc.js";

async function main(): Promise<void> {
  const canvas = document.getElementById(
    "mozaic-canvas"
  ) as HTMLCanvasElement | null;
  if (!canvas) throw new Error("Canvas element #mozaic-canvas not found");

  const params = new URLSearchParams(window.location.search);
  const src = params.get("src");

  if (!src) {
    // No ROM loaded — display a placeholder message
    const ctx = canvas.getContext("2d");
    if (ctx) {
      canvas.width = 320;
      canvas.height = 240;
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#aaa";
      ctx.font = "14px monospace";
      ctx.fillText("Mozaic Engine ready.", 16, 24);
      ctx.fillText("Load a ROM with ?src=<file.mzk>", 16, 44);
    }
    return;
  }

  const asset = await loadAsset(src);
  const { imageData, script } = asset;

  canvas.width = imageData.width;
  canvas.height = imageData.height;

  const baked = bake(imageData);

  const bindings = collectBindings(script);
  const inputManager = new InputManager(bindings);
  const renderer = new Renderer(canvas);
  const initialState = createInitialState(imageData);

  const loop = new EngineLoop(initialState, {
    baked,
    script: script ?? emptyScript(),
    logic: identityLogic,
    renderer,
    inputManager,
  });

  loop.start();
}

function collectBindings(
  script: MscDocument | undefined
): Array<{ key: string; action: string }> {
  if (!script) return [];
  return Object.values(script.entities).flatMap((e) => e.inputs ?? []);
}

function emptyScript(): MscDocument {
  return { imports: [], schema: {}, entities: {}, events: [] };
}

main().catch(console.error);
