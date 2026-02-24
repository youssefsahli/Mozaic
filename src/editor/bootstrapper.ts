/**
 * Bootstrapper — Compiler Console & Boot Sequence
 *
 * Provides a visual "Compiler Console" overlay and orchestrates the
 * full boot sequence when the user clicks "Run":
 *   1. Clear / show console
 *   2. Fetch & parse the master script (with error feedback)
 *   3. Clone the live editor buffer (Uint8ClampedArray)
 *   4. Initialize the EngineLoop
 *   5. Start the loop and auto-hide console
 */

import { bake, type BakedAsset } from "../engine/baker.js";
import { Renderer } from "../engine/renderer.js";
import { InputManager } from "../engine/input.js";
import { EngineLoop, createInitialState } from "../engine/loop.js";
import { buildEvaluatorLogic } from "../engine/evaluator.js";
import { createDefaultRegistry } from "../engine/components.js";
import { parseMsc, type MscDocument } from "../parser/msc.js";
import { parseWithImports } from "../engine/import-resolver.js";
import { spawnEntity } from "../engine/pool.js";
import type { ProjectFiles } from "./file-system.js";
import {
  findNode,
  resolveImportPath,
  findNodeByPath,
  dataUrlToImageData,
} from "./file-system.js";

// ── Console helpers ─────────────────────────────────────────

export type ConsoleMessageType = "info" | "success" | "error";

/** Delay (ms) before the compiler console auto-hides after boot. */
const CONSOLE_AUTO_HIDE_DELAY_MS = 2000;

/**
 * Append a styled message to the compiler console element.
 */
export function logToConsole(
  consoleEl: HTMLElement,
  message: string,
  type: ConsoleMessageType = "info"
): void {
  const line = document.createElement("div");
  line.className = `cc-line cc-${type}`;
  line.textContent = message;
  consoleEl.appendChild(line);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

/**
 * Clear all messages from the compiler console and make it visible.
 */
export function clearConsole(consoleEl: HTMLElement): void {
  consoleEl.innerHTML = "";
  consoleEl.classList.add("is-visible");
}

/**
 * Hide the compiler console overlay.
 */
export function hideConsole(consoleEl: HTMLElement): void {
  consoleEl.classList.remove("is-visible");
}

// ── Boot context ────────────────────────────────────────────

export interface BootContext {
  /** The compiler console DOM element. */
  consoleEl: HTMLElement;
  /** The game canvas element. */
  canvas: HTMLCanvasElement;
  /** The WebGL renderer (shared, not recreated). */
  renderer: Renderer;
  /** The project file tree. */
  project: ProjectFiles;
  /**
   * Live editor ImageData.  When no entry-point Source is resolved,
   * this is used as the fallback image.
   */
  editorImageData: ImageData | null;
  /** Timer ID returned by auto-hide setTimeout (for cleanup). */
  hideTimer: number | null;
}

export interface BootResult {
  loop: EngineLoop;
  inputManager: InputManager;
  imageData: ImageData;
  baked: BakedAsset;
}

// ── Boot sequence ───────────────────────────────────────────

/**
 * Execute the full boot sequence.
 *
 * Returns a {@link BootResult} on success, or `null` if the boot was
 * aborted (e.g. because of a parse error or missing image).
 */
export async function bootProject(
  ctx: BootContext,
  existingLoop: EngineLoop | null,
  existingInput: InputManager | null
): Promise<BootResult | null> {
  const { consoleEl, canvas, renderer, project } = ctx;

  // ── 1. Clear & show console ──────────────────────────────
  clearConsole(consoleEl);
  if (ctx.hideTimer !== null) {
    clearTimeout(ctx.hideTimer);
    ctx.hideTimer = null;
  }
  logToConsole(consoleEl, "Initializing boot sequence...", "info");

  // ── Stop any previous loop ───────────────────────────────
  existingLoop?.stop();
  existingInput?.dispose();

  // ── 2. Fetch the master script ───────────────────────────
  let script: MscDocument;
  let imageData: ImageData | null = null;

  if (project.entryPointId) {
    const epNode = findNode(project.root, project.entryPointId);
    if (!epNode || epNode.fileType !== "script") {
      logToConsole(consoleEl, "Entry point not found — aborting.", "error");
      return null;
    }

    logToConsole(consoleEl, `Compiling script: ${epNode.name}...`, "info");

    const scriptText = epNode.content ?? "";
    const { document: doc, errors } = parseWithImports(
      scriptText,
      epNode.id,
      project
    );
    if (errors.length > 0) {
      for (const err of errors) {
        logToConsole(consoleEl, err, "error");
      }
    }
    script = doc;

    // Resolve Source image from script
    if (script.source) {
      const imgNode =
        resolveImportPath(project.root, epNode.id, script.source) ??
        findNodeByPath(project.root, script.source);
      if (imgNode && imgNode.fileType === "image" && imgNode.content) {
        try {
          imageData = await dataUrlToImageData(imgNode.content);
        } catch {
          logToConsole(
            consoleEl,
            `Failed to decode source image: ${script.source}`,
            "error"
          );
        }
      } else {
        logToConsole(
          consoleEl,
          `Source image "${script.source}" not found in project.`,
          "error"
        );
      }
    }
  } else {
    // No entry point — fallback: try to parse any active script file
    logToConsole(consoleEl, "No entry point configured — using fallback.", "info");
    logToConsole(consoleEl, "Compiling script...", "info");

    try {
      script = parseMsc("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logToConsole(consoleEl, msg, "error");
      return null;
    }
  }

  const entityCount = Object.keys(script.entities).length;
  const spriteCount = script.sprites.size;
  logToConsole(
    consoleEl,
    `Compiled successfully: ${entityCount} entities, ${spriteCount} sprites found.`,
    "success"
  );

  // ── 3. Fetch the live memory state ───────────────────────
  if (!imageData) {
    if (!ctx.editorImageData) {
      logToConsole(consoleEl, "No image available — aborting.", "error");
      return null;
    }
    imageData = ctx.editorImageData;
  }

  // Clone the buffer so the engine cannot mutate the editor's undo history
  const clonedData = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height
  );

  // ── 3b. Spawn script-defined instances ───────────────────
  if (script.instances && script.instances.length > 0) {
    const entityKeys = Object.keys(script.entities);
    let spawned = 0;
    for (const inst of script.instances) {
      const typeId = entityKeys.indexOf(inst.entity) + 1;
      if (typeId > 0) {
        if (spawnEntity(clonedData.data as Uint8ClampedArray, typeId, inst.x, inst.y)) {
          spawned++;
        } else {
          logToConsole(consoleEl, "Entity pool full — skipping remaining instances.", "error");
          break;
        }
      }
    }
    if (spawned > 0) {
      logToConsole(consoleEl, `Spawned ${spawned} instance(s) from script.`, "info");
    }
  }

  // ── 4. Initialize the engine ─────────────────────────────
  logToConsole(consoleEl, "Mounting EngineLoop...", "info");

  canvas.width = clonedData.width;
  canvas.height = clonedData.height;

  const baked = bake(clonedData);
  const bindings = collectBindings(script);
  const inputManager = new InputManager(bindings);
  const loop = new EngineLoop(createInitialState(clonedData), {
    baked,
    script,
    logic: buildEvaluatorLogic(createDefaultRegistry()),
    renderer,
    inputManager,
  });

  // ── 5. Start ─────────────────────────────────────────────
  loop.start();
  logToConsole(consoleEl, "Engine running.", "success");

  // Auto-hide the console after a short delay
  ctx.hideTimer = window.setTimeout(() => {
    hideConsole(consoleEl);
    ctx.hideTimer = null;
  }, CONSOLE_AUTO_HIDE_DELAY_MS);

  return { loop, inputManager, imageData: clonedData, baked };
}

// ── Stop sequence ───────────────────────────────────────────

/**
 * Stop the engine loop and clean up resources.
 */
export function stopProject(
  loop: EngineLoop | null,
  inputManager: InputManager | null,
  consoleEl: HTMLElement | null,
  hideTimer: number | null
): void {
  loop?.stop();
  inputManager?.dispose();

  if (hideTimer !== null) {
    clearTimeout(hideTimer);
  }
  if (consoleEl) {
    hideConsole(consoleEl);
  }
}

// ── Helpers ─────────────────────────────────────────────────

function collectBindings(
  script: MscDocument | undefined
): Array<{ key: string; action: string }> {
  if (!script) return [];
  return Object.values(script.entities).flatMap((e) => e.inputs ?? []);
}
